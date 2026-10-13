// worker/ludmilla/src/email/index.ts
import { classificarErroEmail, razaoDeFalhaDeArquivo } from '../erros.js';
import {
  abrirTentativaEmail, anexoDeEmail, anexoEnviado, anexoErro, credencialDaCaixa, finalizarRun,
  mensagemPendente, protocolosDoEmail, registrarEmailLido, regrasDoEmail, subirDocumento,
  type ProtocoloDeProjeto, type Run,
} from '../fila.js';
import { modoAtual } from '../local.js';
import { abrirCaixa, type Caixa, type EnvelopeLido, type MensagemLida } from './caixa.js';
import {
  casaEndereco, casaTitular, comparavelTitular, destinoNoBucket, ehImagem, ocorrenciasPorNome, pdfDoParecer,
  ehPdf, protocoloDoAssunto, protocolosNoAssunto, recomendacaoDoVeredito, regraQueCasa, separarPorProtocolo,
  tirarDeOutroProtocolo, type RegraEmail, type Veredito,
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
 *
 * NADA de dado de cliente vai para o log. Nome, endereço, assunto e nome de
 * arquivo ficam no banco (`portal_email_mensagens.motivo`, `portal_updates.raw`),
 * que é de onde a tela lê. O log vai para o journald da VPS, que não é lugar
 * para isso — só código do projeto, protocolo e o que foi conferido.
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
 * Titular e endereço são REFORÇO, e conferem **só contra o que a IA extraiu do
 * PDF** — nunca contra o corpo do e-mail. Num corpo longo as palavras se
 * espalham e casam por acidente: "JOSÉ … SANTOS" casa com um corpo que diga
 * "Av. São José" e "Santos/SP", e saía o selo mais forte sem nada conferido de
 * verdade. Sem PDF lido, o selo é `protocolo`, que é o mínimo da spec.
 *
 * Os dois lados não pesam igual:
 *  - titular do PDF de OUTRA pessoa é alarme → bloqueia (o único bloqueio);
 *  - endereço divergente NÃO bloqueia, só deixa a ressalva registrada. Quase
 *    sempre é cadastro nosso desatualizado ou formato diferente ("RUA X 120
 *    APTO 45" × "Rua X, 120"), e bloquear faria o parecer certo não chegar ao
 *    card — o oposto do que se quer.
 *
 * Nome que não dá para comparar (menos de duas palavras úteis, de qualquer um
 * dos dois lados) é FALTA DE DADO, nunca divergência: projeto cujo titular é
 * "Ivanildo" não pode bloquear um PDF que diz "IVANILDO PEREIRA DOS SANTOS".
 */
export function conferir(
  p: ProtocoloDeProjeto,
  doPdf: { titular: string | null; endereco: string | null },
): Conferencia {
  const doSistema = p.titular;
  const doParecer = doPdf.titular;
  if (doSistema && doParecer && comparavelTitular(doSistema) && comparavelTitular(doParecer)) {
    if (casaTitular(doSistema, doParecer)) return { ok: true, por: 'titular', motivo: null };
    return {
      ok: false, por: 'titular',
      motivo: `o parecer é de "${doParecer}" e o projeto é de "${doSistema}"`,
    };
  }
  if (p.endereco && doPdf.endereco) {
    if (casaEndereco(p.endereco, doPdf.endereco)) return { ok: true, por: 'endereco', motivo: null };
    return {
      ok: true, por: 'protocolo',
      motivo: `o endereço do parecer ("${doPdf.endereco}") não confere com o do cadastro ("${p.endereco}") — anexei pelo protocolo, confira o cadastro`,
    };
  }
  return { ok: true, por: 'protocolo', motivo: null };
}

export interface ParecerLido {
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
 * Anthropic) — isso é FALHA passageira, a mensagem fica pendente e um run
 * futuro tenta de novo; `ok:true` com veredito inconclusivo é a IA que leu e
 * não concluiu (PDF ilegível), caminho normal e definitivo.
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

export interface Tratamento {
  /**
   *  · `tratado`   — seguiu o caminho normal;
   *  · `ignorado`  — nenhuma regra casou;
   *  · `bloqueado` — o titular do parecer não é o do projeto (a ÚNICA razão: é o
   *                  que a tela rotula como "não anexei: titular divergiu");
   *  · `sem_dono`  — o e-mail tem arquivos e nenhum é seguramente DESTE protocolo:
   *                  ou cita vários protocolos e nenhum nome traz o número
   *                  deste, ou todos os nomes trazem o número de OUTRO protocolo.
   *                  Não dá para dizer de quem é o documento.
   */
  situacao: 'tratado' | 'ignorado' | 'bloqueado' | 'sem_dono';
  /** arquivos que chegaram ao card de verdade NESTE run */
  anexados: number;
  /** imagens puladas (assinatura de e-mail) */
  imagensIgnoradas: number;
  /** arquivos que o bucket não aceita (tipo ou tamanho): ignorados, nunca falhados */
  recusados: number;
  /** anexos sem nome de arquivo, que não dá para identificar nem anexar */
  semNome: number;
  /**
   * ARQUIVOS (não mensagens) que não foram para este projeto porque o nome traz o
   * número de um protocolo que o e-mail não serve (E1b). É contagem de arquivo, ao
   * contrário de `sem_dono`, que é de mensagem: uma mensagem `tratado` que anexou
   * o genérico e barrou o de outro conta 1 aqui e nada em `sem_dono`. Não conta a
   * divisão normal de um e-mail de vários protocolos NOSSOS (o arquivo do B visto
   * ao tratar o A).
   */
  deOutroProtocolo: number;
  /**
   * false = falha passageira; a mensagem fica pendente e um run futuro tenta de
   * novo. O que conta como concluído está logo abaixo, no corpo da função.
   */
  concluida: boolean;
}

/**
 * As dependências de fora (banco, storage, IA) entram por parâmetro porque é
 * aqui que moram as três decisões caras — ler ou não o PDF, anexar ou não,
 * recomendar ou não — e elas precisam de teste sem banco e sem rede.
 */
export interface DepsTratamento {
  abrirTentativa: typeof abrirTentativaEmail;
  anexoDeEmail: typeof anexoDeEmail;
  subirDocumento: typeof subirDocumento;
  anexoEnviado: typeof anexoEnviado;
  anexoErro: typeof anexoErro;
  registrarEmailLido: typeof registrarEmailLido;
  lerParecer: (pdf: Buffer, protocolo: string, tenantId: string) => Promise<ParecerLido>;
}

export const DEPS_REAIS: DepsTratamento = {
  abrirTentativa: abrirTentativaEmail,
  anexoDeEmail, subirDocumento, anexoEnviado, anexoErro, registrarEmailLido, lerParecer,
};

/**
 * Trata UMA mensagem para UM projeto.
 *
 * `protocolosDaConta` são todos os protocolos que o run está procurando: é com
 * eles que se sabe QUANTOS projetos o e-mail serve. O laço do run trata um
 * protocolo por vez; se o assunto cita dois, esta função roda duas vezes para a
 * mesma mensagem, e cada vez só pode levar para o card o arquivo DAQUELE
 * protocolo (E1). Com um só protocolo citado nada disso entra em jogo. Sem a
 * lista (chamada antiga), vale o caso de um protocolo.
 */
export async function tratarMensagem(
  run: Run, p: ProtocoloDeProjeto, m: MensagemLida, regras: RegraEmail[],
  deps: DepsTratamento = DEPS_REAIS,
  protocolosDaConta: string[] = [p.protocolo],
): Promise<Tratamento> {
  const regra = regraQueCasa(regras, m.assunto, m.remetente);
  const comum = {
    runId: run.id, accountId: run.account_id, messageId: m.messageId, protocolo: p.protocolo,
    assunto: m.assunto, remetente: m.remetente, recebidoEm: m.recebidoEm?.toISOString() ?? null,
  };

  // A TENTATIVA É CONTADA AQUI, antes de qualquer gasto: de IA, de storage ou de
  // banco. Se o tratamento morrer no meio (anexo com erro permanente, projeto
  // apagado entre a listagem e o registro), a linha já existe com
  // `concluida = false` e `tentativas` incrementado — então o run seguinte tenta
  // de novo, e o teto de 5 é real em vez de depender de o tratamento chegar
  // vivo até o fim. Sem isto, todo run baixava o corpo e chamava a IA outra vez,
  // pagando o parecer indefinidamente, em silêncio.
  const tentativa = await deps.abrirTentativa({ ...comum, projectId: p.project_id });

  if (!regra) {
    // Nenhuma regra casou é CONFIGURAÇÃO, não falha passageira: fica concluída,
    // porque insistir faria a robô rebaixar o mesmo e-mail duas vezes por dia
    // para sempre. A linha aparece na tela com o motivo, e a recuperação é a
    // ação "reler" — que é só limpar `concluida` no banco.
    await deps.registrarEmailLido({
      ...comum, projectId: null, tipoDocumento: null, veredito: null, resumo: null,
      anexos: 0, motivo: 'nenhuma regra casa com este assunto/remetente', recomendacao: null,
      concluida: true, arquivoLido: null,
    });
    return { situacao: 'ignorado', anexados: 0, imagensIgnoradas: 0, recusados: 0, semNome: 0, deOutroProtocolo: 0, concluida: true };
  }

  // O índice de "este é o 2º arquivo de mesmo nome" sai da mensagem INTEIRA,
  // antes de qualquer filtro: tem de ser o mesmo em todo run para a retentativa
  // retomar a mesma linha de `portal_anexos` em vez de anexar de novo (E5).
  const ocorrencias = ocorrenciasPorNome(m.anexos);
  const todos = m.anexos.map((a, i) => ({ ...a, ocorrencia: ocorrencias[i] }));

  // Imagem não é documento: a assinatura HTML da EDP traz image001.png…004.png,
  // e cada uma virava documento do projeto e comentário no card do cliente.
  const semImagem = todos.filter(a => !ehImagem(a));
  const imagensIgnoradas = todos.length - semImagem.length;
  const semNome = m.anexosSemNome;

  // E1 — quantos projetos NOSSOS este e-mail serve. Com mais de um, o arquivo só
  // vai para o card do protocolo cujo número está no NOME dele, e a IA lê o PDF
  // desse protocolo (não o maior do e-mail, que pode ser o de outro cliente).
  // Uma regra que não anexa nem lê não depende de arquivo nenhum: aí não há o que
  // separar, e bloquear seria punir o que não tem risco.
  const citados = protocolosNoAssunto(m.assunto, protocolosDaConta);
  const varios = citados.length > 1;
  const dependeDeArquivo = regra.anexar || regra.ler_pdf;

  // E1b — o NOME do arquivo é olhado SEMPRE, não só quando o assunto cita vários:
  // arquivo cujo nome traz o número de um protocolo DIFERENTE do que se trata não
  // vai para este projeto. Cobre o que a contagem do assunto não vê — o outro
  // protocolo do assunto não é nosso (concluído, de outra conta, fora do teto de
  // 80: a contagem dá 1) ou o assunto cita um só e o arquivo é de OUTRO projeto
  // nosso. Nome sem número reconhecível não é sinal e segue como sempre.
  const { ficam, deOutro, inesperados } = dependeDeArquivo
    ? tirarDeOutroProtocolo(semImagem, p.protocolo, citados)
    : { ficam: semImagem, deOutro: [], inesperados: [] };
  const doProtocolo = varios && dependeDeArquivo
    ? separarPorProtocolo(ficam, p.protocolo, citados).meus
    : ficam;

  const ressalvaImagens = imagensIgnoradas > 0
    ? [`${imagensIgnoradas} imagem(ns) do e-mail não foram anexadas (assinatura)`] : [];
  const ressalvaSemNome = semNome > 0
    ? [`${semNome} anexo(s) sem nome de arquivo não foram anexados`] : [];
  // os nomes vão para o banco (de onde a tela lê); no log só a contagem
  const ressalvaDeOutro = inesperados.length > 0
    ? [`${inesperados.length} arquivo(s) não anexado(s): o nome traz o número de outro protocolo, diferente do deste projeto (${descreverNomes(inesperados.map(a => a.nome))})`] : [];

  if (dependeDeArquivo && semImagem.length > 0 && doProtocolo.length === 0) {
    // Nenhum arquivo é seguramente DESTE protocolo — ou o e-mail cita vários e
    // nenhum nome traz o número deste, ou todos os nomes trazem o de outro. Não há
    // como dizer de quem é o documento, e anexar "por via das dúvidas" é entregar o
    // de um cliente no card de outro. Não é falha passageira (insistir dá o mesmo):
    // concluída, com o motivo na tela. A IA nem é chamada — pagaria para ler o PDF
    // talvez errado.
    const explicacao = varios
      ? `o e-mail cita ${citados.length} protocolos e não consegui dizer qual documento é de qual (nenhum arquivo traz o número deste protocolo no nome) — confira à mão`
      : `nenhum arquivo do e-mail é deste protocolo: todos trazem no nome o número de outro protocolo (${descreverNomes(deOutro.map(a => a.nome))}) — confira à mão`;
    await deps.registrarEmailLido({
      ...comum, projectId: p.project_id, tipoDocumento: regra.tipo_documento,
      veredito: null, resumo: null, anexos: 0,
      motivo: [
        'não anexei', explicacao,
        // no caso de um protocolo só a explicação já nomeia os arquivos
        ...(varios ? ressalvaDeOutro : []), ...ressalvaImagens, ...ressalvaSemNome,
      ].join(' · '),
      recomendacao: null, concluida: true, arquivoLido: null,
    });
    log(varios
      ? 'nada anexado: o e-mail cita mais de um protocolo e nenhum arquivo traz o número deste'
      : 'nada anexado: todos os arquivos do e-mail trazem no nome o número de outro protocolo',
    { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, protocolos_no_assunto: citados.length,
      arquivos: semImagem.length, de_outro_protocolo: inesperados.length });
    return {
      situacao: 'sem_dono', anexados: 0, imagensIgnoradas, recusados: 0, semNome,
      deOutroProtocolo: inesperados.length, concluida: true,
    };
  }

  if (inesperados.length > 0) {
    // Só a contagem: o nome do arquivo e o número do outro protocolo são dado de
    // outro cliente e ficam no banco (`motivo`), nunca no journald.
    log('arquivo não anexado: o nome traz o número de outro protocolo, diferente do deste projeto',
      { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, de_outro_protocolo: inesperados.length });
  }

  // O que o bucket de fato aceita (E2). Só vale quando a regra anexa: arquivo
  // que a regra nem queria anexar não foi "recusado" por ninguém.
  const aceitos: (typeof doProtocolo[number] & { mime: string })[] = [];
  const recusados: { nome: string; motivo: 'tipo' | 'tamanho' }[] = [];
  if (regra.anexar) {
    for (const a of doProtocolo) {
      const destino = destinoNoBucket(a);
      if (destino.aceito) aceitos.push({ ...a, mime: destino.mime });
      else recusados.push({ nome: a.nome, motivo: destino.motivo });
    }
  }

  // O parecer é lido ANTES de anexar: o titular que ele traz entra na
  // conferência. O PDF escolhido é o MAIOR, não o primeiro da lista — entre os
  // arquivos DESTE protocolo quando o e-mail serve vários. Ler o que o bucket
  // recusa (um PDF acima de 10 MB) continua valendo: a recusa é de anexar.
  const pdf = pdfDoParecer(doProtocolo);
  const parecer = regra.ler_pdf && pdf
    ? await deps.lerParecer(pdf.bytes, p.protocolo, run.tenant_id)
    : SEM_LEITURA;
  // só é "lido" o que a IA de fato leu — leitura que falhou não vira registro
  const arquivoLido = pdf && parecer.ok && parecer.veredito !== null ? pdf.nome : null;
  if (!parecer.ok) log('não consegui ler o parecer', { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, erro: parecer.erro });

  // tudo o que a pessoa precisa saber sobre esta mensagem, em uma frase
  const ressalvas: string[] = [];
  if (varios && dependeDeArquivo && semImagem.length > 0) {
    ressalvas.push(`o e-mail cita ${citados.length} protocolos: usei só ${doProtocolo.length} de ${semImagem.length} arquivo(s), os que trazem o número deste protocolo no nome`);
  }
  if (regra.ler_pdf && !pdf) {
    // dizer "não trouxe PDF" de e-mail que trouxe PDF de outro protocolo seria mentira
    ressalvas.push(varios && semImagem.length > 0
      ? 'a regra pede a leitura do parecer, mas nenhum PDF traz o número deste protocolo no nome'
      : semImagem.some(ehPdf)
        ? 'a regra pede a leitura do parecer, mas nenhum PDF do e-mail é deste protocolo (o nome traz o número de outro)'
        : 'a regra pede a leitura do parecer, mas o e-mail não trouxe PDF');
  }
  ressalvas.push(...ressalvaDeOutro);
  if (parecer.erro) ressalvas.push(`não consegui ler o parecer: ${parecer.erro}`);
  ressalvas.push(...ressalvaImagens, ...ressalvaSemNome);

  const c = conferir(p, { titular: parecer.titular, endereco: parecer.endereco });
  if (c.motivo) ressalvas.push(c.motivo);

  if (!c.ok) {
    // Bloqueio por titular é DECISÃO, não falha passageira: tentar de novo daria
    // o mesmo resultado duas vezes por dia. Fica concluída, com o motivo na tela.
    await deps.registrarEmailLido({
      ...comum, projectId: p.project_id, tipoDocumento: regra.tipo_documento,
      veredito: parecer.veredito, resumo: parecer.resumo || null, anexos: 0,
      motivo: ['não anexei', ...ressalvas].join(' · '), recomendacao: null,
      concluida: true, arquivoLido,
    });
    log('anexo bloqueado: o titular do parecer não é o do projeto',
      { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, por: c.por });
    return { situacao: 'bloqueado', anexados: 0, imagensIgnoradas, recusados: 0, semNome, deOutroProtocolo: inesperados.length, concluida: true };
  }

  if (recusados.length > 0) {
    // O nome do arquivo vai para o motivo (banco, de onde a tela lê); no log só a
    // contagem — nome de arquivo às vezes traz o titular.
    ressalvas.push(`${recusados.length} arquivo(s) não anexado(s): o armazenamento do projeto só aceita pdf, xls, xlsx e docx de até 10 MB (${descreverRecusados(recusados)})`);
    log('arquivo não anexado: o armazenamento do projeto não aceita o tipo ou o tamanho',
      { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, recusados: recusados.length });
  }

  let anexados = 0;
  let anexoFalhou = false;
  if (regra.anexar) {
    for (const a of aceitos) {
      const aberto = await deps.anexoDeEmail(
        run.account_id, p.protocolo, p.project_id, m.messageId, a.nome, c.por, a.ocorrencia);
      if (aberto.situacao === 'ja_resolvido') {
        // A linha já está `enviado` ou `bloqueado` NESTE projeto; nada a refazer.
        // (A RPC devolve `aberto` de novo quando ela ficou `pendente` ou `erro`,
        // justamente para a retentativa servir para algo.) Aviso, não silêncio.
        log('anexo já estava resolvido no card; não subi de novo',
          { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, mime: a.mime });
        continue;
      }
      if (aberto.situacao === 'projeto_inexistente') {
        // Dizer "já resolvido no card" aqui seria mentira: o card nem existe.
        log('o projeto deste protocolo não existe mais (ou não é desta conta); não anexei',
          { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, mime: a.mime });
        continue;
      }
      const pendente = aberto.anexo;
      try {
        const caminho = await deps.subirDocumento(pendente, a.bytes, a.mime);
        await deps.anexoEnviado(pendente.id, caminho, a.mime);
        anexados++;
      } catch (e) {
        anexoFalhou = true;
        // O texto COMPLETO vai para o banco (é o que a tela mostra); no log vai
        // só a razão curta. A mensagem crua do storage traz o caminho, e o
        // caminho traz o nome do arquivo — que às vezes traz o titular.
        await deps.anexoErro(pendente.id, (e as Error).message);
        log('anexo falhou ao subir', {
          nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, mime: a.mime,
          razao: razaoDeFalhaDeArquivo(e),
        });
      }
    }
  }

  // Sem leitura da IA não sai recomendação de etapa: o documento chega ao card
  // de todo jeito e a pessoa decide. Recomendar sem ter lido seria chute.
  const recomendacao = parecer.ok ? recomendacaoDoVeredito(regra.tipo_documento, parecer.veredito) : null;

  // Concluída só quando não há mais nada a tentar: a regra casou, a leitura que
  // a regra pedia aconteceu (ou não havia PDF para ler) e todo anexo que devia
  // subir subiu. IA que falhou ou anexo que deu erro deixam a mensagem PENDENTE
  // — é o que faz a recomendação de etapa, que é a entrega da funcionalidade,
  // acontecer no run seguinte em vez de desaparecer em silêncio.
  const concluida = parecer.ok && !anexoFalhou;

  await deps.registrarEmailLido({
    ...comum, projectId: p.project_id, tipoDocumento: regra.tipo_documento,
    veredito: parecer.veredito, resumo: parecer.resumo || null, anexos: anexados,
    motivo: ressalvas.length > 0 ? ressalvas.join(' · ') : null, recomendacao,
    concluida, arquivoLido,
  });
  log('e-mail tratado', {
    projeto: p.codigo, protocolo: p.protocolo, tipo: regra.tipo_documento,
    veredito: parecer.veredito, conferido_por: c.por, anexados,
    imagens_ignoradas: imagensIgnoradas, recusados: recusados.length, sem_nome: semNome,
    de_outro_protocolo: inesperados.length,
    protocolos_no_assunto: citados.length, recomendacao, concluida, tentativa,
  });
  return { situacao: 'tratado', anexados, imagensIgnoradas, recusados: recusados.length, semNome, deOutroProtocolo: inesperados.length, concluida };
}

/** Até três nomes, com o motivo de cada um; o resto vira "e mais N". Vai para o banco, nunca para o log. */
function descreverRecusados(r: { nome: string; motivo: 'tipo' | 'tamanho' }[]): string {
  const nomes = r.slice(0, 3).map(x => `${x.nome} [${x.motivo}]`).join(', ');
  return r.length > 3 ? `${nomes} e mais ${r.length - 3}` : nomes;
}

/** Até três nomes; o resto vira "e mais N". Vai para o banco, nunca para o log. */
function descreverNomes(nomes: string[]): string {
  const mostrados = nomes.slice(0, 3).join(', ');
  return nomes.length > 3 ? `${mostrados} e mais ${nomes.length - 3}` : mostrados;
}

/** O que a triagem decidiu, com as contagens que entram no `resultado`. */
export interface Triagem {
  /** uid → envelope das mensagens que valem baixar */
  aprovados: Map<number, EnvelopeLido>;
  /** o protocolo não está no ASSUNTO (a busca do IMAP acha no corpo também) */
  descartados: number;
  /** já concluída neste protocolo: pula sem baixar */
  pulados: number;
  /** a consulta de pendência falhou (banco) — não é falha da caixa */
  falhasTratamento: number;
}

/**
 * A triagem: descartar por assunto → consultar pendência → aprovar o uid.
 *
 * É a parte do laço onde um erro SILENCIA DOCUMENTO (uid que não entra em
 * `aprovados` nunca é baixado, e nada mais olha para ele neste run), e vivia
 * entrelaçada com o IMAP e com o banco — inalcançável por teste. Agora recebe
 * os envelopes já lidos e a consulta de pendência por parâmetro: as três
 * contagens são verificáveis sem rede.
 *
 * `consultarPendencia` LANÇANDO não derruba a triagem dos outros envelopes: só
 * aquele uid fica de fora, contado em `falhasTratamento`. Nenhum log leva
 * assunto — ele é dado do cliente.
 */
export async function triar(
  envelopes: EnvelopeLido[],
  p: { codigo: string; protocolo: string },
  consultarPendencia: (messageId: string) => Promise<boolean>,
): Promise<Triagem> {
  const t: Triagem = { aprovados: new Map(), descartados: 0, pulados: 0, falhasTratamento: 0 };
  for (const env of envelopes) {
    // A busca do IMAP é por texto (assunto OU corpo). Exigir o protocolo no
    // ASSUNTO é o que separa "o e-mail é deste projeto" de "o número apareceu
    // em algum lugar do corpo".
    if (!protocoloDoAssunto(env.assunto, [p.protocolo])) {
      t.descartados++;
      log('mensagem descartada: o protocolo não está no assunto',
        { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, mensagem: env.messageId });
      continue;
    }
    let pendente: boolean;
    try {
      pendente = await consultarPendencia(env.messageId);
    } catch (e) {
      t.falhasTratamento++;
      log('não consegui conferir se esta mensagem já foi tratada',
        { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, mensagem: env.messageId, erro: (e as Error).message });
      continue;
    }
    if (!pendente) {
      // Pulo SILENCIOSO foi o que escondeu o defeito que a correção C1
      // conserta: a mensagem era queimada mesmo sem nada de útil sair dela, e
      // nem o log dizia. Sem o assunto — ele é dado do cliente.
      t.pulados++;
      log('mensagem já concluída neste protocolo; pulei sem baixar',
        { nivel: 'aviso', projeto: p.codigo, protocolo: p.protocolo, mensagem: env.messageId });
      continue;
    }
    t.aprovados.set(env.uid, env);
  }
  return t;
}

/** As contas do run, para o `resultado` e para o log do fim. */
export interface Conta {
  lidos: number; tratados: number; anexados: number; ignorados: number; bloqueados: number;
  /** e-mails de vários protocolos em que nenhum arquivo dizia de quem era (E1) */
  semDono: number;
  /** arquivos que o bucket não aceita (E2) · anexos sem nome de arquivo (E6) */
  recusados: number; semNome: number;
  /** ARQUIVOS barrados porque o nome traz o número de outro protocolo (E1b) */
  deOutroProtocolo: number;
  pulados: number; descartados: number; imagens: number; a_tentar_de_novo: number;
  /** mensagens cujo CORPO o parser não conseguiu interpretar (descarte visível) */
  naoLidas: number;
  /** protocolos cuja busca na caixa deu certo */
  limpos: number;
  /** a CAIXA falhou (busca recusada, conexão caída) */
  falhasBusca: number;
  /** o TRATAMENTO falhou (banco, storage, leitura do parecer) */
  falhasTratamento: number;
}

export const contaZerada = (): Conta => ({
  lidos: 0, tratados: 0, anexados: 0, ignorados: 0, bloqueados: 0, semDono: 0, recusados: 0, semNome: 0, deOutroProtocolo: 0,
  pulados: 0, descartados: 0, imagens: 0, a_tentar_de_novo: 0, naoLidas: 0,
  limpos: 0, falhasBusca: 0, falhasTratamento: 0,
});

/**
 * Soma o que UMA mensagem tratada rendeu às contas do run. Pura e à parte do laço
 * (que precisa de IMAP e banco) para o caminho de cada contador até o `resultado`
 * ter teste: um contador que o tratamento calcula e ninguém soma não aparece em lugar nenhum.
 */
export function somarTratamento(n: Conta, r: Tratamento): void {
  n.anexados += r.anexados;
  n.imagens += r.imagensIgnoradas;
  n.recusados += r.recusados;
  n.semNome += r.semNome;
  n.deOutroProtocolo += r.deOutroProtocolo;
  if (!r.concluida) n.a_tentar_de_novo++;
  if (r.situacao === 'tratado') n.tratados++;
  else if (r.situacao === 'ignorado') n.ignorados++;
  else if (r.situacao === 'bloqueado') n.bloqueados++;
  else n.semDono++;
}

/** O `resultado` que o histórico do run guarda. `falhas` é o total (busca + tratamento). */
export function resultadoDoRun(n: Conta, protocolos: number, falhas: number): Record<string, number> {
  return {
    protocolos, lidos: n.lidos, tratados: n.tratados,
    anexados: n.anexados, ignorados: n.ignorados, bloqueados: n.bloqueados,
    pulados: n.pulados, descartados: n.descartados,
    // se um dia uma imagem legítima for descartada, é por aqui que aparece
    imagens_ignoradas: n.imagens,
    // `bloqueados` é SÓ divergência de titular (é como a tela o rotula). O e-mail
    // em que nenhum arquivo é seguramente deste protocolo vem aqui, à parte —
    // conta MENSAGENS (tratamentos).
    sem_dono: n.semDono,
    // conta ARQUIVOS: o nome traz o número de um protocolo que o e-mail não
    // serve (E1b) — o parecer de outro cliente que a robô não pôs neste card.
    // Pode ser > 0 sem `sem_dono`: o genérico do mesmo e-mail foi anexado.
    anexos_de_outro_protocolo: n.deOutroProtocolo,
    // arquivos que o bucket não aceita (p7s, dwg, zip, acima de 10 MB) e anexos
    // sem nome: descartes conhecidos, que não são falha — mas não somem
    anexos_recusados: n.recusados, anexos_sem_nome: n.semNome,
    a_tentar_de_novo: n.a_tentar_de_novo, nao_lidas: n.naoLidas,
    falhas, falhas_busca: n.falhasBusca, falhas_tratamento: n.falhasTratamento,
  };
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

    // com ela se sabe quantos projetos um e-mail serve (E1)
    const todosOsProtocolos = protocolos.map(x => x.protocolo);

    const n = contaZerada();

    for (const p of protocolos) {
      // ── 1. a busca na caixa ────────────────────────────────────────────────
      // `procurar` LANÇA quando a busca falha (resposta NO/BAD do servidor).
      // Um protocolo ruim não pode derrubar o run dos outros 79.
      let uids: number[];
      try {
        uids = await caixa.procurar(p.protocolo);
      } catch (e) {
        n.falhasBusca++;
        log('a busca na caixa de e-mail falhou para este protocolo',
          { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, erro: (e as Error).message });
        continue;
      }
      n.limpos++;
      if (uids.length === 0) continue;
      log('protocolo achado na caixa', { projeto: p.codigo, protocolo: p.protocolo, mensagens: uids.length });

      // ── 2. a triagem: só o ENVELOPE, sem baixar corpo nem anexo ────────────
      let envelopes: EnvelopeLido[];
      try {
        envelopes = [];
        for await (const env of caixa.envelopes(uids)) envelopes.push(env);
      } catch (e) {
        n.falhasBusca++;
        log('não consegui ler os envelopes deste protocolo na caixa',
          { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, erro: (e as Error).message });
        continue;
      }

      const t = await triar(envelopes, p, id => mensagemPendente(run.account_id, id, p.protocolo));
      n.descartados += t.descartados;
      n.pulados += t.pulados;
      n.falhasTratamento += t.falhasTratamento;
      const aprovados = t.aprovados;
      if (aprovados.size === 0) continue;

      // ── 3. só agora o corpo com os anexos desce ────────────────────────────
      try {
        for await (const baixada of caixa.baixar([...aprovados.keys()])) {
          const env = aprovados.get(baixada.uid);
          // o id que vale é o do envelope: foi com ele que a pendência respondeu
          const m = env ? { ...baixada, messageId: env.messageId } : baixada;
          try {
            n.lidos++;
            const r = await tratarMensagem(run, p, m, regras, DEPS_REAIS, todosOsProtocolos);
            somarTratamento(n, r);
          } catch (e) {
            // Banco, storage ou leitura do parecer estourando NÃO é falha da
            // caixa, e o log não pode dizer que é. A mensagem fica sem linha no
            // banco, então o próximo run a trata de novo.
            n.falhasTratamento++;
            log('o tratamento desta mensagem falhou (banco, arquivo ou leitura do parecer)',
              { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, mensagem: m.messageId, erro: (e as Error).message });
          }
        }
      } catch (e) {
        n.falhasBusca++;
        log('não consegui baixar as mensagens deste protocolo da caixa',
          { nivel: 'falha', projeto: p.codigo, protocolo: p.protocolo, erro: (e as Error).message });
      }
    }

    // Mensagem que o parser não interpretou não gera linha no banco (não há
    // `Message-ID` confiável para registrar), então a contagem é a única
    // visibilidade que existe. Não entra em `falhas` de propósito: a caixa foi
    // lida por inteiro, e um corpo quebrado é condição permanente — somá-la a
    // `falhas` travaria `ultima_varredura_em` para sempre.
    n.naoLidas = caixa.naoLidas();
    if (n.naoLidas > 0) log('mensagens que não consegui interpretar neste run', { run: run.id, nao_lidas: n.naoLidas });

    // Fechar como "ok" sem ter conseguido procurar NADA seria mentira (conexão
    // caída no meio, busca recusada pelo servidor): falha alto, com o número.
    if (n.limpos === 0 && n.falhasBusca > 0) {
      throw new Error(`Nenhum dos ${n.falhasBusca} protocolos pôde ser procurado na caixa de e-mail.`);
    }

    // `falhas` é o TOTAL: é o campo que o histórico mostra e é o que decide se
    // `ultima_varredura_em` sobe. A separação fica nos dois campos seguintes,
    // porque "a caixa falhou" e "o banco falhou" se consertam em lugares
    // diferentes.
    const falhas = n.falhasBusca + n.falhasTratamento;
    await finalizarRun(run.id, {
      situacao: 'ok', situacaoConta: 'ok',
      // `protocolos` = projetos conferidos · `mudancas` = documentos que
      // chegaram ao card (é o que o registro da tela mostra)
      protocolos: protocolos.length, mudancas: n.anexados,
      resultado: resultadoDoRun(n, protocolos.length, falhas),
    });
    log('varredura por e-mail ok', { run: run.id, protocolos: protocolos.length, ...n, falhas });
  } catch (e) {
    const erro = classificarErroEmail(e);
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
