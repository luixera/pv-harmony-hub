// worker/ludmilla/src/email/index.ts
import { classificarErro } from '../erros.js';
import {
  anexoDeEmail, anexoEnviado, anexoErro, credencialDaCaixa, finalizarRun, mensagemEhNova,
  protocolosDoEmail, registrarEmailLido, regrasDoEmail, subirDocumento,
  type ProtocoloDeProjeto, type Run,
} from '../fila.js';
import { modoAtual } from '../local.js';
import { abrirCaixa, type Caixa, type MensagemLida } from './caixa.js';
import {
  casaEndereco, casaTitular, protocoloDoAssunto, recomendacaoDoVeredito, regraQueCasa,
  type RegraEmail, type Veredito,
} from './util.js';

/**
 * Run `varredura_email`: parte dos PROJETOS (ao contrário do agente de e-mails,
 * que varre por remetente). Para cada protocolo em andamento, procura o número
 * na caixa, aplica as regras do banco, confere que o e-mail é mesmo daquele
 * projeto, anexa no card e RECOMENDA a etapa.
 *
 * Ela NUNCA move card e NUNCA escreve na caixa de e-mail (nem marca como lido,
 * nem move, nem responde): a caixa é compartilhada com o agente de e-mails, e
 * quem decide a etapa é a pessoa. Isso é regra, não detalhe.
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/** Os três selos que o banco aceita em `portal_anexos.conferido_por` para o e-mail. */
export type ConferidoPor = 'protocolo' | 'titular' | 'endereco';

export interface Conferencia {
  /** false = não anexa. Só divergência de TITULAR chega aqui. */
  ok: boolean;
  por: ConferidoPor;
  /** o que precisa aparecer na tela: o bloqueio, ou a ressalva de quem passou */
  motivo: string | null;
}

/**
 * Protocolo é a trava obrigatória (a RPC já descartou protocolo repetido, e o
 * número tem 8+ dígitos): se ele casa, o documento é daquele projeto.
 *
 * Titular e endereço são REFORÇO, e os dois lados não pesam igual:
 *  - titular do PDF de OUTRA pessoa é alarme → bloqueia (o único bloqueio);
 *  - endereço divergente NÃO bloqueia, só deixa a ressalva registrada. Quase
 *    sempre é cadastro nosso desatualizado ou formato diferente ("RUA X 120
 *    APTO 45" × "Rua X, 120"), e bloquear faria o parecer certo não chegar ao
 *    card — o oposto do que se quer.
 *
 * Nome que não aparece no corpo do e-mail é falta de dado, não divergência: por
 * isso só o titular vindo do PDF (dado extraído, estruturado) pode bloquear.
 */
export function conferir(
  p: ProtocoloDeProjeto,
  texto: string,
  doPdf: { titular: string | null; endereco: string | null },
): Conferencia {
  const titularEmail = doPdf.titular ?? texto;
  const enderecoEmail = doPdf.endereco ?? texto;

  if (p.titular && titularEmail) {
    if (casaTitular(p.titular, titularEmail)) return { ok: true, por: 'titular', motivo: null };
    if (doPdf.titular) {
      return {
        ok: false, por: 'titular',
        motivo: `o parecer é de "${doPdf.titular}" e o projeto é de "${p.titular}"`,
      };
    }
  }
  if (p.endereco && enderecoEmail && casaEndereco(p.endereco, enderecoEmail)) {
    return { ok: true, por: 'endereco', motivo: null };
  }
  if (p.endereco && doPdf.endereco) {
    // chegou aqui com os dois lados preenchidos = não casaram acima
    return {
      ok: true, por: 'protocolo',
      motivo: `o endereço do parecer ("${doPdf.endereco}") não confere com o do cadastro ("${p.endereco}") — anexei pelo protocolo, confira o cadastro`,
    };
  }
  return { ok: true, por: 'protocolo', motivo: null };
}

interface ParecerLido {
  /** false = a IA NÃO respondeu (sem crédito, erro da Anthropic, rede caída). */
  ok: boolean;
  veredito: Veredito | null;
  resumo: string;
  titular: string | null;
  endereco: string | null;
  /** a frase do que deu errado, quando `ok` é false */
  erro: string | null;
}

/** Não houve leitura: ou a regra não pede PDF, ou o e-mail não trouxe nenhum. */
const SEM_LEITURA: ParecerLido = { ok: true, veredito: null, resumo: '', titular: null, endereco: null, erro: null };
const falhaNaLeitura = (erro: string): ParecerLido => ({ ...SEM_LEITURA, ok: false, erro });

const VEREDITOS: readonly string[] = ['favoravel', 'pendencia', 'inconclusivo'];

/**
 * Manda o PDF para a edge function `ludmilla-parecer` ler.
 *
 * `tenant_id` é obrigatório aqui (ainda que opcional lá): sem ele o gasto de IA
 * fica FORA do extrato do console, e a regra da casa é que todo gasto de IA é
 * registrado.
 *
 * A função devolve HTTP 200 nos DOIS casos de "inconclusivo", e só o campo `ok`
 * distingue: `ok:false` é a IA que não respondeu (sem crédito, erro da
 * Anthropic) — isso é FALHA e não pode virar silêncio; `ok:true` com veredito
 * inconclusivo é a IA que leu e não concluiu (PDF ilegível), caminho normal.
 */
async function lerParecer(pdf: Buffer, protocolo: string, tenantId: string): Promise<ParecerLido> {
  const base = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave) return falhaNaLeitura('falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no ambiente do robô');

  let r: Response;
  try {
    r = await fetch(`${base}/functions/v1/ludmilla-parecer`, {
      method: 'POST',
      // a função aceita a chave de serviço no Authorization OU no apikey (a
      // chave nova `sb_secret_…` não é um JWT); manda nos dois
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${chave}`, apikey: chave },
      body: JSON.stringify({ pdf_base64: pdf.toString('base64'), protocolo, tenant_id: tenantId }),
    });
  } catch (e) {
    return falhaNaLeitura(`não consegui chamar a leitura do parecer: ${(e as Error).message}`);
  }

  const corpo = await r.json().catch(() => null) as {
    ok?: boolean; error?: string; veredito?: string; resumo?: string;
    titular?: string | null; endereco?: string | null;
  } | null;
  if (!corpo) return falhaNaLeitura(`a leitura do parecer respondeu ${r.status} sem JSON`);
  if (!r.ok || corpo.ok === false) {
    return falhaNaLeitura(corpo.error ?? `a leitura do parecer respondeu ${r.status}`);
  }

  return {
    ok: true,
    // valor fora do vocabulário quebraria o CHECK da tabela no registro
    veredito: VEREDITOS.includes(String(corpo.veredito)) ? corpo.veredito as Veredito : 'inconclusivo',
    resumo: corpo.resumo ?? '',
    titular: corpo.titular ?? null,
    endereco: corpo.endereco ?? null,
    erro: null,
  };
}

interface Tratamento {
  situacao: 'tratado' | 'ignorado' | 'bloqueado';
  /** arquivos que chegaram ao card de verdade */
  anexados: number;
}

async function tratarMensagem(
  run: Run, p: ProtocoloDeProjeto, m: MensagemLida, regras: RegraEmail[],
): Promise<Tratamento> {
  const regra = regraQueCasa(regras, m.assunto, m.remetente);
  const comum = {
    runId: run.id, accountId: run.account_id, messageId: m.messageId, protocolo: p.protocolo,
    assunto: m.assunto, remetente: m.remetente, recebidoEm: m.recebidoEm?.toISOString() ?? null,
  };
  if (!regra) {
    await registrarEmailLido({
      ...comum, projectId: null, tipoDocumento: null, veredito: null, resumo: null,
      anexos: 0, motivo: 'nenhuma regra casa com este assunto/remetente', recomendacao: null,
    });
    return { situacao: 'ignorado', anexados: 0 };
  }

  // O parecer é lido ANTES de anexar: o titular que ele traz entra na conferência.
  const pdfs = m.anexos.filter(a => /pdf$/i.test(a.mime) || /\.pdf$/i.test(a.nome));
  const parecer = regra.ler_pdf && pdfs.length > 0
    ? await lerParecer(pdfs[0].bytes, p.protocolo, run.tenant_id)
    : SEM_LEITURA;
  if (!parecer.ok) log('não consegui ler o parecer', { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, erro: parecer.erro });

  // tudo o que a pessoa precisa saber sobre esta mensagem, em uma frase
  const ressalvas: string[] = [];
  if (regra.ler_pdf && pdfs.length === 0) ressalvas.push('a regra pede a leitura do parecer, mas o e-mail não trouxe PDF');
  if (parecer.erro) ressalvas.push(`não consegui ler o parecer: ${parecer.erro}`);

  const c = conferir(p, m.texto, { titular: parecer.titular, endereco: parecer.endereco });
  if (c.motivo) ressalvas.push(c.motivo);

  if (!c.ok) {
    await registrarEmailLido({
      ...comum, projectId: p.project_id, tipoDocumento: regra.tipo_documento,
      veredito: parecer.veredito, resumo: parecer.resumo || null, anexos: 0,
      motivo: ['não anexei', ...ressalvas].join(' · '), recomendacao: null,
    });
    log('anexo bloqueado pela conferência', { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, motivo: c.motivo });
    return { situacao: 'bloqueado', anexados: 0 };
  }

  let anexados = 0;
  if (regra.anexar) {
    for (const a of m.anexos) {
      const pendente = await anexoDeEmail(run.account_id, p.protocolo, p.project_id, m.messageId, a.nome, c.por);
      if (!pendente) {
        // Vazio = o anexo já tinha linha (ON CONFLICT DO NOTHING). Pode ser
        // repetição comum (image001.png de assinatura) OU uma linha `pendente`
        // órfã de um run que morreu antes de subir o arquivo — e nesse caso o
        // PDF nunca sobe. Por isso aviso, não silêncio.
        log('anexo já tinha linha no banco; não subi de novo', { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, arquivo: a.nome });
        continue;
      }
      try {
        const caminho = await subirDocumento(pendente, a.bytes, a.mime);
        await anexoEnviado(pendente.id, caminho, a.mime);
        anexados++;
      } catch (e) {
        await anexoErro(pendente.id, (e as Error).message);
        log('anexo falhou', { nivel: 'falha', projeto: p.codigo, arquivo: a.nome, erro: (e as Error).message });
      }
    }
  }

  // Sem leitura da IA não sai recomendação de etapa: o documento chega ao card
  // de todo jeito e a pessoa decide. Recomendar sem ter lido seria chute.
  const recomendacao = parecer.ok ? recomendacaoDoVeredito(regra.tipo_documento, parecer.veredito) : null;

  await registrarEmailLido({
    ...comum, projectId: p.project_id, tipoDocumento: regra.tipo_documento,
    veredito: parecer.veredito, resumo: parecer.resumo || null, anexos: anexados,
    motivo: ressalvas.length > 0 ? ressalvas.join(' · ') : null, recomendacao,
  });
  log('e-mail tratado', {
    projeto: p.codigo, tipo: regra.tipo_documento, veredito: parecer.veredito,
    conferido_por: c.por, anexados, recomendacao,
  });
  return { situacao: 'tratado', anexados };
}

export async function executarVarreduraEmail(run: Run): Promise<void> {
  // As RPCs de e-mail não têm variante `_local`: o acompanhamento por e-mail é
  // só da VPS, de propósito ("assim não preciso deixar o computador ligado").
  // Na estação o run é recusado com a explicação, sem estourar.
  if (modoAtual() === 'local') {
    const aviso = 'O acompanhamento por e-mail roda só na VPS: as funções de e-mail do banco não têm versão da estação local. Este run precisa ser executado pelo robô da VPS.';
    log('varredura por e-mail recusada na estação local', { run: run.id });
    await finalizarRun(run.id, { situacao: 'erro', erro: aviso })
      .catch(e => log('não consegui fechar o run na estação local', { run: run.id, erro: (e as Error).message }));
    return;
  }

  log('varredura por e-mail iniciada', { run: run.id });
  let caixa: Caixa | null = null;
  try {
    const creds = await credencialDaCaixa(run.account_id);
    const protocolos = await protocolosDoEmail(run.account_id);
    const regras = await regrasDoEmail(run.account_id);
    if (regras.length === 0) {
      throw new Error('Esta concessionária não tem regras de e-mail cadastradas na tela da Ludmilla.');
    }
    caixa = await abrirCaixa(creds);

    let lidos = 0, tratados = 0, anexados = 0, ignorados = 0, bloqueados = 0, falhas = 0, limpos = 0;
    for (const p of protocolos) {
      try {
        const uids = await caixa.procurar(p.protocolo);
        if (uids.length > 0) log('protocolo achado na caixa', { projeto: p.codigo, protocolo: p.protocolo, mensagens: uids.length });
        for await (const m of caixa.baixar(uids)) {
          // A busca do IMAP é por texto (assunto OU corpo). Exigir o protocolo
          // no ASSUNTO é o que separa "o e-mail é deste projeto" de "o número
          // apareceu em algum lugar do corpo".
          if (!protocoloDoAssunto(m.assunto, [p.protocolo])) {
            log('mensagem descartada: o protocolo não está no assunto', { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, mensagem: m.messageId });
            continue;
          }
          if (!(await mensagemEhNova(run.account_id, m.messageId))) continue;
          lidos++;
          const r = await tratarMensagem(run, p, m, regras);
          anexados += r.anexados;
          if (r.situacao === 'tratado') tratados++;
          else if (r.situacao === 'ignorado') ignorados++;
          else bloqueados++;
        }
        limpos++;
      } catch (e) {
        // `procurar` LANÇA quando a busca falha (resposta NO/BAD do servidor).
        // Um protocolo ruim não pode derrubar o run dos outros 79.
        falhas++;
        log('protocolo falhou na caixa', { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, erro: (e as Error).message });
      }
    }
    // Fechar como "ok" sem ter conseguido procurar NADA seria mentira (conexão
    // caída no meio, busca recusada pelo servidor): falha alto, com o número.
    if (limpos === 0 && falhas > 0) {
      throw new Error(`Nenhum dos ${falhas} protocolos pôde ser procurado na caixa de e-mail.`);
    }

    await finalizarRun(run.id, {
      situacao: 'ok', situacaoConta: 'ok',
      // `protocolos` = projetos conferidos · `mudancas` = documentos que
      // chegaram ao card (é o que o registro da tela mostra)
      protocolos: protocolos.length, mudancas: anexados,
      resultado: { protocolos: protocolos.length, lidos, tratados, anexados, ignorados, bloqueados, falhas },
    });
    log('varredura por e-mail ok', { run: run.id, protocolos: protocolos.length, lidos, tratados, anexados, ignorados, bloqueados, falhas });
  } catch (e) {
    const erro = classificarErro(e);
    await finalizarRun(run.id, {
      situacao: 'erro', erro: erro.mensagem,
      situacaoConta: erro.situacaoConta === 'ok' ? undefined : erro.situacaoConta,
    }).catch(err => log('não consegui fechar o run', { run: run.id, erro: (err as Error).message }));
    log('varredura por e-mail com erro', { run: run.id, classe: erro.classe, mensagem: erro.mensagem });
  } finally {
    // Toda saída passa por aqui — inclusive os `throw` de "sem regras" (antes de
    // abrir, com caixa nula) e de "nenhum protocolo procurado". Conexão IMAP
    // vazada é recurso perdido num processo que roda para sempre, e o Gmail
    // limita 15 conexões por conta — a mesma conta do agente de e-mails.
    await caixa?.fechar().catch(() => undefined);
  }
}
