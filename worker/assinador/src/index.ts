import { assinar, estampar } from './assinar.js';
import { cpfMascarado, lerCertificado } from './certificado.js';
import { converterParaPdf, encerrarConversaoEmCurso, precisaConverter, temSoffice } from './preparar.js';
import {
  Trabalho, baixar, caminhoAprovado, certificadoConferido, certificadosParaConferir,
  dadosDoCertificado, nomeAssinado, passo, pedirAoZe, pegarTrabalho, recadoDoZe, sha256, subir, triar,
} from './fila.js';

/**
 * ASSINADOR — o laço.
 *
 * Três etapas, a mesma fila:
 *  - preparando → converte (se preciso) + estampa → `conferir` (espera a pessoa)
 *  - triagem    → peneira do Claudinho → `pendente` | `recusado` | `aguardando_ze`
 *  - pendente   → anexa a assinatura PAdES → `assinado`
 *
 * O original nunca é tocado. Depois do "está certo" nenhum byte é reescrito:
 * a assinatura é append sobre os bytes aprovados.
 */

const POLL_SEGUNDOS = Number(process.env.ASSINADOR_POLL_SECONDS ?? 15);
const DOCS = 'project-documents';
const CERTS = 'certificados';

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Ligado pelo SIGTERM/SIGINT: o que estiver em curso é interrompido, não é "erro do trabalho". */
let encerrando = false;

/**
 * Abre a pendência no WhatsApp do gestor. A linha já está em `aguardando_ze`
 * (o estado certo); se o aviso falhar, só registramos — não derruba a assinatura.
 */
async function avisarZe(id: string): Promise<void> {
  try {
    await pedirAoZe(id);
  } catch (e) {
    log('não consegui avisar o Zé — a assinatura segue aguardando o gestor', { assinatura: id, erro: (e as Error).message });
  }
}

/** Confere um certificado recém-cadastrado: abre o .pfx e grava os metadados. */
async function conferirCertificado(id: string): Promise<void> {
  try {
    const c = await dadosDoCertificado(id);
    const pfx = await baixar(CERTS, c.arquivo_path);
    const d = lerCertificado(pfx, c.senha);

    if (d.cpf !== c.titular_cpf) {
      await certificadoConferido(id, 'invalido', {
        erro: `O CPF do certificado (${cpfMascarado(d.cpf)}) não é o que foi informado no cadastro.`,
      });
      log('certificado com CPF divergente', { certificado: id });
      return;
    }
    const venceu = d.fim.getTime() < Date.now();
    await certificadoConferido(id, venceu ? 'vencido' : 'ok', {
      emissor: d.emissor, serial: d.serial,
      inicio: d.inicio.toISOString().slice(0, 10),
      fim: d.fim.toISOString().slice(0, 10),
      erro: venceu ? `O certificado venceu em ${d.fim.toLocaleDateString('pt-BR')}.` : undefined,
    });
    log('certificado conferido', { certificado: id, titular: d.titularNome, vence: d.fim.toISOString().slice(0, 10), venceu });
  } catch (e) {
    await certificadoConferido(id, 'invalido', { erro: (e as Error).message }).catch(() => undefined);
    log('certificado recusado', { certificado: id, erro: (e as Error).message });
  }
}

/** preparando → conferir */
async function preparar(t: Trabalho): Promise<void> {
  if (!t.file_url || !t.file_name) throw new Error('O pedido não aponta para nenhum arquivo.');
  const original = await baixar(DOCS, t.file_url);
  const base = precisaConverter(t.file_name, t.file_type)
    ? await converterParaPdf(original, t.file_name)
    : original;

  const aprovado = await estampar(base, {
    titularNome: t.titular_nome ?? '—',
    cpf: t.titular_cpf ?? '',
    codigo: t.codigo_verificacao,
    cidade: t.cidade,
    quando: new Date(),
  });
  const path = await subir(DOCS, caminhoAprovado(t), aprovado, 'application/pdf');

  await passo(t.id, 'conferir', {
    documento_aprovado_path: path,
    hash_original: sha256(original),
    hash_aprovado: sha256(aprovado),
  });
  log('preparado para conferência', { assinatura: t.id, convertido: precisaConverter(t.file_name, t.file_type) });
}

/** triagem → pendente | recusado | aguardando_ze */
async function peneirar(t: Trabalho): Promise<void> {
  if (!t.documento_aprovado_path) throw new Error('Sem PDF aprovado para triar.');
  const pdf = await baixar(DOCS, t.documento_aprovado_path);

  // Acima de 10 MB não vai para a IA: decide o gestor.
  if (pdf.length > 10 * 1024 * 1024) {
    await passo(t.id, 'aguardando_ze', { recusa: 'Arquivo grande demais para a triagem automática.' });
    await avisarZe(t.id);
    log('triagem pulada pelo tamanho', { assinatura: t.id, bytes: pdf.length });
    return;
  }

  let veredito = 'duvida';
  let motivo = 'A triagem não respondeu.';
  try {
    const r = await triar(pdf, t.tenant_id);
    veredito = r.veredito;
    motivo = r.motivo;
  } catch (e) {
    // FALHA FECHADA: sem resposta da IA, não vira 'pendente' sozinho.
    motivo = `Triagem indisponível: ${(e as Error).message}`;
  }

  if (veredito === 'projeto') {
    await passo(t.id, 'pendente', {});
    log('triagem ok', { assinatura: t.id });
  } else if (veredito === 'nao_projeto') {
    await passo(t.id, 'recusado', { recusa: motivo || 'Não tem cunho de projeto.' });
    log('triagem barrou', { assinatura: t.id, motivo });
    await recadoDoZe(t.tenant_id, `Barrei uma assinatura: ${motivo || 'o documento não tem cunho de projeto.'}`);
  } else {
    await passo(t.id, 'aguardando_ze', { recusa: motivo });
    await avisarZe(t.id);
    log('triagem em dúvida — foi para o gestor', { assinatura: t.id, motivo });
  }
}

/** pendente → assinado */
async function assinarTrabalho(t: Trabalho): Promise<void> {
  if (!t.documento_aprovado_path || !t.hash_aprovado) throw new Error('Sem PDF aprovado para assinar.');
  if (!t.certificado_id) throw new Error('O pedido não aponta para nenhum certificado.');

  const aprovado = await baixar(DOCS, t.documento_aprovado_path);
  // o que foi aprovado tem de ser exatamente o que será assinado
  if (sha256(aprovado) !== t.hash_aprovado) {
    throw new Error('O PDF mudou depois do "está certo" — não assino.');
  }

  const c = await dadosDoCertificado(t.certificado_id);
  const pfx = await baixar(CERTS, c.arquivo_path);
  const d = lerCertificado(pfx, c.senha);
  if (d.fim.getTime() < Date.now()) throw new Error(`O certificado venceu em ${d.fim.toLocaleDateString('pt-BR')}.`);
  if (d.cpf !== c.titular_cpf) throw new Error('O CPF do certificado não bate com o cadastro.');

  // `assinar` já confere o resultado por dentro (aprovado como prefixo exato,
  // /ByteRange real, /Contents preenchido) e LANÇA se algo falhar.
  const assinado = await assinar(aprovado, pfx, c.senha, { nome: d.titularNome, cidade: t.cidade });

  const nome = nomeAssinado(t.file_name ?? 'documento.pdf');
  const path = `${t.tenant_id}/${t.project_id}/assinatura/${t.id}_${nome}`;
  await subir(DOCS, path, assinado, 'application/pdf');

  // Se a linha foi movida enquanto assinávamos (ex.: recusa), o passo LANÇA e o
  // PDF assinado não é entregue.
  await passo(t.id, 'assinado', {
    file_url: path, file_name: nome, hash_assinado: sha256(assinado),
  });
  log('assinado', { assinatura: t.id, codigo: t.codigo_verificacao, bytes: assinado.length });

  await recadoDoZe(t.tenant_id,
    `Assinei ${nome} com o e-CPF de ${d.titularNome}, ` +
    `${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}. ` +
    `Código ${t.codigo_verificacao}.`);
}

async function executar(t: Trabalho): Promise<void> {
  try {
    if (t.situacao === 'preparando') return await preparar(t);
    if (t.situacao === 'triagem') return await peneirar(t);
    if (t.situacao === 'pendente') return await assinarTrabalho(t);
    log('situação inesperada na fila', { assinatura: t.id, situacao: t.situacao });
  } catch (e) {
    const erro = (e as Error).message;
    if (encerrando) {
      // Interrompido pelo SIGTERM/SIGINT (ex.: conversão cancelada): não é erro do
      // documento. A linha fica como está e a fila a devolve quando o lease vencer.
      log('trabalho interrompido pelo encerramento', { assinatura: t.id, etapa: t.situacao, erro });
      return;
    }
    // 3ª tentativa: para de insistir e deixa o erro visível na tela
    const final = t.tentativas >= 3;
    await passo(t.id, final ? 'erro' : t.situacao, { erro }).catch(() => undefined);
    log('trabalho com erro', { assinatura: t.id, etapa: t.situacao, tentativa: t.tentativas, final, erro });
  }
}

async function principal() {
  log('assinador no ar', { poll: POLL_SEGUNDOS, soffice: temSoffice() });
  if (!temSoffice()) log('aviso: LibreOffice ausente — planilha e .docx não serão convertidos');

  const encerrar = () => {
    encerrando = true;
    log('encerrando');
    // O soffice roda em grupo próprio e sobreviveria ao worker; mata junto.
    if (encerrarConversaoEmCurso()) log('conversão em curso cancelada');
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);

  while (!encerrando) {
    try {
      for (const c of await certificadosParaConferir()) await conferirCertificado(c.id);
      if (encerrando) break;
      const t = await pegarTrabalho();
      if (!t) { await dormir(POLL_SEGUNDOS * 1_000); continue; }
      await executar(t);
      await dormir(1_000);
    } catch (e) {
      log('laço tropeçou', { erro: (e as Error).message });
      await dormir(POLL_SEGUNDOS * 1_000);
    }
  }
}

principal().catch(e => { log('caiu', { erro: (e as Error).message }); process.exit(1); });
