// worker/ludmilla/src/email/enel/run.ts
import { classificarErroEmail, razaoDeFalhaDeArquivo } from '../../erros.js';
import {
  abrirTentativaEmail, anexoDeEmail, anexoEnviado, anexoErro, avisarEquipe, credencialDaCaixa,
  finalizarRun, mensagemPendente, projetosDoEmail, registrarEmailLido, regrasDoEmail, subirDocumento,
  type Run,
} from '../../fila.js';
import { abrirCaixa, type Caixa, type EnvelopeLido, type MensagemLida } from '../caixa.js';
import {
  chaveProtocolo, destinoNoBucket, ehImagem, ocorrenciasPorNome, pdfDoParecer, regraQueCasa,
  type RegraEmail, type Veredito,
} from '../util.js';
import { classificarAssunto, classificarCorpo, type Classificacao } from './classificar.js';
import {
  avisosEnel, janelaDeBusca, precisaLerPdf, recomendacaoCabe, recomendacaoEnel, remetentesDoRun,
  titularDeOutraPessoa, trocaDeProtocolo,
} from './decidir.js';
import {
  combinar, identificarPorDocumento, identificarPorTexto, nomeTrazOutroProjeto, referenciaDoProjeto,
  type Identificacao, type ProjetoEnel, type Sinal,
} from './identificar.js';

/**
 * Run `varredura_email` para conta com `identificacao = 'remetente'` (ENEL).
 * Parte do E-MAIL, pelos remetentes; descobre o projeto; anexa; sugere a etapa;
 * toca o sino nos momentos que pedem ação. NUNCA move card, NUNCA envia nada,
 * NUNCA escreve na caixa. Nenhum dado de cliente no log (nome, endereço, assunto,
 * nome de arquivo, mensagem crua de terceiro): só código do projeto e contagens.
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/**
 * A chave da linha da mensagem na ENEL é FIXA: uma linha por e-mail. Antes de
 * identificar não se sabe o projeto, e a tentativa tem de ser contada antes do
 * gasto de IA — com chave fixa, `tentativas` sobe na MESMA linha a cada retentativa
 * e o teto de 5 vale. O projeto vai em `project_id`; o cartão recebe a referência.
 */
export const CHAVE_DA_MENSAGEM_ENEL = '';

export interface ParecerEnel {
  ok: boolean; veredito: Veredito | null; resumo: string;
  /** "aprovado, porém solicitamos observar os itens abaixo": favorável, com os itens aqui */
  pendencias: string[];
  titular: string | null; endereco: string | null;
  tipo: string | null; nt: string | null; uc: string | null;
  erro: string | null;
}
const SEM_LEITURA: ParecerEnel = { ok: true, veredito: null, resumo: '', pendencias: [], titular: null, endereco: null, tipo: null, nt: null, uc: null, erro: null };
const falha = (erro: string): ParecerEnel => ({ ...SEM_LEITURA, ok: false, erro });
const VEREDITOS: readonly string[] = ['favoravel', 'pendencia', 'inconclusivo'];

/**
 * Igual à leitura da EDP (`email/index.ts`), com `concessionaria: 'enel'`. Fica
 * separada de propósito: o caminho da EDP não é alterado nesta entrega.
 */
async function lerParecerEnel(pdf: Buffer, tenantId: string): Promise<ParecerEnel> {
  const base = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave) return falha('falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no ambiente do robô');
  let r: Response;
  try {
    r = await fetch(`${base}/functions/v1/ludmilla-parecer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${chave}`, apikey: chave },
      body: JSON.stringify({ pdf_base64: pdf.toString('base64'), tenant_id: tenantId, concessionaria: 'enel' }),
    });
  } catch (e) {
    return falha(`não consegui chamar a leitura do documento: ${(e as Error).message}`);
  }
  const c = await r.json().catch(() => null) as Partial<ParecerEnel> & { error?: string } | null;
  if (!c) return falha(`a leitura do documento respondeu ${r.status} sem JSON`);
  if (!r.ok || c.ok === false) return falha(c.error ?? `a leitura do documento respondeu ${r.status}`);
  return {
    ok: true,
    veredito: VEREDITOS.includes(String(c.veredito)) ? c.veredito as Veredito : 'inconclusivo',
    resumo: c.resumo ?? '',
    pendencias: Array.isArray(c.pendencias) ? c.pendencias.map(String) : [],
    titular: c.titular ?? null, endereco: c.endereco ?? null,
    tipo: c.tipo ?? null, nt: c.nt ?? null, uc: c.uc ?? null, erro: null,
  };
}

export interface DepsEnel {
  abrirTentativa: typeof abrirTentativaEmail;
  anexoDeEmail: typeof anexoDeEmail;
  subirDocumento: typeof subirDocumento;
  anexoEnviado: typeof anexoEnviado;
  anexoErro: typeof anexoErro;
  registrarEmailLido: typeof registrarEmailLido;
  avisar: typeof avisarEquipe;
  lerParecer: (pdf: Buffer, tenantId: string) => Promise<ParecerEnel>;
}
export const DEPS_ENEL: DepsEnel = {
  abrirTentativa: abrirTentativaEmail, anexoDeEmail, subirDocumento, anexoEnviado, anexoErro,
  registrarEmailLido, avisar: avisarEquipe, lerParecer: lerParecerEnel,
};

export interface TratamentoEnel {
  situacao: 'tratado' | 'ignorado' | 'nao_identificado' | 'conflito' | 'inativo' | 'bloqueado';
  por: Sinal | null;
  anexados: number; imagensIgnoradas: number; recusados: number; semNome: number; deOutroProjeto: number;
  avisos: number;
  /** false = falha passageira: um run futuro tenta de novo (teto de 5) */
  concluida: boolean;
}

/** Até três nomes; o resto vira "e mais N". Vai para o banco, nunca para o log. */
function nomes(lista: string[]): string {
  const m = lista.slice(0, 3).join(', ');
  return lista.length > 3 ? `${m} e mais ${lista.length - 3}` : m;
}

/** A frase que entra no histórico sobre o que o texto disse. */
function anotacao(c: Classificacao): string | null {
  if (c?.tipo === 'resultado_vistoria') return c.aprovada
    ? 'vistoria virtual aprovada — falta a troca do relógio'
    : 'vistoria reprovada pela ENEL';
  if (c?.tipo === 'troca_relogio' && c.estado === 'agendada') return `troca do relógio agendada${c.prazoDias ? ` (prazo de até ${c.prazoDias} dias úteis)` : ''}`;
  if (c?.tipo === 'troca_relogio') return `a troca do relógio não foi executada${c.motivo ? `: ${c.motivo}` : ''}`;
  return null;
}

/** Por que a etapa lida não virou sugestão. */
function naoCabe(sugerida: string, status: string): string {
  if (sugerida === status) return `não sugeri "${sugerida}": o projeto já está nessa etapa`;
  if (sugerida === 'vistoria_reprovada') return `não sugeri "${sugerida}": o projeto está em "${status}", fora da vistoria`;
  return `não sugeri "${sugerida}": o projeto já está à frente, em "${status}"`;
}

export async function tratarMensagemEnel(
  run: Run, m: MensagemLida, regras: RegraEmail[], projetos: ProjetoEnel[], deps: DepsEnel = DEPS_ENEL,
): Promise<TratamentoEnel> {
  const base = {
    runId: run.id, accountId: run.account_id, messageId: m.messageId, protocolo: CHAVE_DA_MENSAGEM_ENEL,
    assunto: m.assunto, remetente: m.remetente, recebidoEm: m.recebidoEm?.toISOString() ?? null,
  };
  const vazio = { por: null, anexados: 0, imagensIgnoradas: 0, recusados: 0, semNome: m.anexosSemNome, deOutroProjeto: 0, avisos: 0 };

  // Contada ANTES de qualquer gasto (lição da EDP): se o tratamento morrer no
  // meio, a linha já existe com concluida=false e o teto de 5 é real.
  await deps.abrirTentativa({ ...base, projectId: null });

  const regra = regraQueCasa(regras, m.assunto, m.remetente);
  if (!regra || regra.tipo_documento === 'comunicado') {
    await deps.registrarEmailLido({
      ...base, projectId: null, tipoDocumento: regra?.tipo_documento ?? null, veredito: null, resumo: null,
      anexos: 0, recomendacao: null, concluida: true, arquivoLido: null, abrirCartao: false,
      motivo: regra ? 'comunicado enviado a todos: ignorado pela regra' : 'nenhuma regra casa com este assunto/remetente',
    });
    return { ...vazio, situacao: 'ignorado', concluida: true };
  }

  // O ASSUNTO antes do corpo: o atendimento.edsp manda o resultado no assunto
  // ("Comunicado técnico sobre a nota: <NT> - Vistoria aprovada"), com corpo genérico.
  // `m.texto` chega achatado (caixa.ts) e vai como está: o classificador foi feito para ele.
  const classificacao = classificarAssunto(m.assunto) ?? classificarCorpo(m.texto);
  const idTexto = identificarPorTexto({ assunto: m.assunto, corpo: m.texto }, projetos);

  const ocorrencias = ocorrenciasPorNome(m.anexos);
  const todos = m.anexos.map((a, i) => ({ ...a, ocorrencia: ocorrencias[i] }));
  const semImagem = todos.filter(a => !ehImagem(a));
  const imagensIgnoradas = todos.length - semImagem.length;
  const pdf = pdfDoParecer(semImagem);

  const ler = precisaLerPdf(regra, idTexto, classificacao, pdf !== null);
  const parecer = ler && pdf ? await deps.lerParecer(pdf.bytes, run.tenant_id) : SEM_LEITURA;
  // a IA não respondeu: tentar de novo no próximo run
  const passageira = ler && !parecer.ok;
  if (passageira) log('não consegui ler o documento', { nivel: 'falha', erro: parecer.erro });

  const idDoc: Identificacao = ler && parecer.ok
    ? identificarPorDocumento({ nt: parecer.nt, uc: parecer.uc, titular: parecer.titular }, projetos)
    : { tipo: 'nenhum' };
  const id = combinar(idTexto, idDoc);

  if (id.tipo !== 'achado') {
    const motivo =
      id.tipo === 'conflito' ? `não anexei · ${id.motivo} — confira à mão`
      : id.tipo === 'inativo' ? `não anexei · o e-mail é do projeto ${id.projeto.codigo}, que já está concluído ou arquivado`
      : passageira ? `não consegui ler o anexo para descobrir o projeto: ${parecer.erro}`
      : 'não reconheci de qual projeto é este e-mail (nenhum protocolo, UC ou nome de titular nosso) — confira à mão';
    // O sino ANTES do registro: se o aviso falhar, a exceção sobe com a linha ainda
    // `concluida = false` (aberta em abrirTentativa) e a retentativa toca. O banco é
    // idempotente por `aviso_em`: não toca duas vezes. Sem projeto, só a devolução avisa.
    let avisos = 0;
    for (const a of avisosEnel(regra.tipo_documento, null, null, null)) {
      avisos += await deps.avisar({ accountId: run.account_id, messageId: m.messageId, protocolo: CHAVE_DA_MENSAGEM_ENEL, projectId: null, ...a });
    }
    await deps.registrarEmailLido({
      ...base, projectId: null, tipoDocumento: regra.tipo_documento,
      veredito: parecer.ok ? parecer.veredito : null, resumo: parecer.resumo || null, anexos: 0,
      motivo, recomendacao: null, concluida: !passageira, arquivoLido: null, abrirCartao: false,
    });
    log('e-mail sem projeto certo', { nivel: 'aviso', situacao: id.tipo, codigos: id.tipo === 'conflito' ? id.codigos : undefined });
    return {
      ...vazio, imagensIgnoradas, avisos, concluida: !passageira,
      situacao: id.tipo === 'nenhum' ? 'nao_identificado' : id.tipo,
    };
  }

  const projeto = id.projeto;
  // DUAS coisas diferentes, de propósito:
  //  · a CHAVE DO ANEXO é estável por projeto e nunca muda entre tentativas. Se a 1ª
  //    tentativa subiu o anexo (a IA falhou) e a 2ª usasse a NT que a IA voltou a
  //    ler, o documento subiria em dobro;
  //  · a REFERÊNCIA DO CARTÃO é o protocolo que o "Aplicar" grava no projeto: quando
  //    a Carta sugere gravar a NT, é a NT.
  const chaveDoAnexo = referenciaDoProjeto(projeto);
  const lido = ler && parecer.ok && pdf ? pdf.nome : null;

  // O titular do DOCUMENTO de outra pessoa é o único bloqueio (como na EDP), nos dois sentidos.
  if (parecer.ok && titularDeOutraPessoa(projeto.titular, parecer.titular)) {
    await deps.registrarEmailLido({
      ...base, projectId: projeto.project_id, referencia: chaveDoAnexo, casamento: id.por, abrirCartao: true,
      tipoDocumento: regra.tipo_documento, veredito: parecer.veredito, resumo: parecer.resumo || null, anexos: 0,
      motivo: `não anexei · o documento é de "${parecer.titular}" e o projeto é de "${projeto.titular}"`,
      recomendacao: null, concluida: true, arquivoLido: lido,
    });
    log('anexo bloqueado: o titular do documento não é o do projeto', { nivel: 'aviso', projeto: projeto.codigo, por: id.por });
    return { ...vazio, imagensIgnoradas, situacao: 'bloqueado', por: id.por, concluida: true };
  }

  const ressalvas: string[] = [];
  const nota = anotacao(classificacao);
  if (nota) ressalvas.push(nota);

  // O PDF que a IA leu traz o número de OUTRO projeto: o que ele diz (etapa, troca,
  // observações, sino) não vale para ESTE. O registro guarda o que foi lido, com a ressalva.
  const pdfDeOutro = lido !== null && pdf !== null && nomeTrazOutroProjeto(pdf.nome, projeto, projetos);
  const leitura: ParecerEnel = pdfDeOutro ? SEM_LEITURA : parecer;
  if (pdfDeOutro && pdf) ressalvas.push(`o documento que li (${pdf.nome}) traz o número de outro projeto: não usei o que ele diz para sugerir etapa nem protocolo`);

  const sugerida = recomendacaoEnel(classificacao, leitura);
  const recomendacao = sugerida && recomendacaoCabe(sugerida, projeto.status) ? sugerida : null;

  // Só a NT que a IA leu na Carta (nunca um número do assunto ou do corpo).
  const troca = trocaDeProtocolo(leitura, projeto, sugerida !== null && recomendacao === null);
  const atualizarProtocolo = troca.tipo === 'pedir';
  const referenciaDoCartao = troca.tipo === 'pedir' ? troca.nt : chaveDoAnexo;
  if (troca.tipo === 'pedir') {
    const temDigito = chaveProtocolo(projeto.protocolo ?? '') !== '';
    ressalvas.push(`a Carta traz a NT ${troca.nt}; o cadastro tem ${temDigito ? (projeto.protocolo ?? '').trim() : 'nenhum'} — o cartão sugere gravar a NT`);
  } else if (troca.tipo === 'conferir') {
    ressalvas.push(`a Carta traz a NT ${troca.nt}, diferente da do cadastro (${troca.doCadastro}); como o projeto já está à frente, não sugeri trocar — confira`);
  }
  if (sugerida && !recomendacao) ressalvas.push(naoCabe(sugerida, projeto.status));

  // Os itens que a ENEL listou: no aprovado, são observações; na pendência, é o que ela pediu.
  const itens = leitura.ok ? leitura.pendencias.map(s => s.trim()).filter(s => s.length > 0) : [];
  if (itens.length && leitura.veredito === 'favoravel') ressalvas.push(`aprovado com observações: ${nomes(itens)}`);
  else if (itens.length && leitura.veredito === 'pendencia') {
    ressalvas.push(`pendências ${leitura.tipo === 'carta_projeto' ? 'da Carta' : 'do documento'}: ${nomes(itens)}`);
  }
  if (passageira) ressalvas.push(`não consegui ler o documento: ${parecer.erro}`);

  const paraAnexar = regra.anexar ? semImagem.filter(a => !nomeTrazOutroProjeto(a.nome, projeto, projetos)) : [];
  const barrados = regra.anexar ? semImagem.filter(a => !paraAnexar.includes(a)) : [];
  if (barrados.length) ressalvas.push(`${barrados.length} arquivo(s) não anexado(s): o nome traz o número de outro projeto (${nomes(barrados.map(a => a.nome))})`);

  const aceitos: (typeof paraAnexar[number] & { mime: string })[] = [];
  const recusados: string[] = [];
  for (const a of paraAnexar) {
    const d = destinoNoBucket(a);
    if (d.aceito) aceitos.push({ ...a, mime: d.mime }); else recusados.push(`${a.nome} [${d.motivo}]`);
  }
  if (recusados.length) ressalvas.push(`${recusados.length} arquivo(s) não anexado(s): o armazenamento do projeto só aceita pdf, xls, xlsx e docx de até 10 MB (${nomes(recusados)})`);
  if (imagensIgnoradas) ressalvas.push(`${imagensIgnoradas} imagem(ns) do e-mail não foram anexadas (assinatura)`);
  if (m.anexosSemNome) ressalvas.push(`${m.anexosSemNome} anexo(s) sem nome de arquivo não foram anexados`);

  let anexados = 0;
  let anexoFalhou = false;
  for (const a of aceitos) {
    const aberto = await deps.anexoDeEmail(run.account_id, chaveDoAnexo, projeto.project_id, m.messageId, a.nome, id.por, a.ocorrencia);
    if (aberto.situacao === 'ja_resolvido') { log('anexo já estava no card; não subi de novo', { nivel: 'aviso', projeto: projeto.codigo }); continue; }
    if (aberto.situacao === 'projeto_inexistente') { log('o projeto não existe mais; não anexei', { nivel: 'falha', projeto: projeto.codigo }); continue; }
    try {
      const caminho = await deps.subirDocumento(aberto.anexo, a.bytes, a.mime);
      await deps.anexoEnviado(aberto.anexo.id, caminho, a.mime);
      anexados++;
    } catch (e) {
      anexoFalhou = true;
      // o texto inteiro vai para a linha do anexo (banco); no log, só a razão curta
      await deps.anexoErro(aberto.anexo.id, (e as Error).message);
      log('anexo falhou ao subir', { nivel: 'falha', projeto: projeto.codigo, mime: a.mime, razao: razaoDeFalhaDeArquivo(e) });
    }
  }

  // O sino ANTES do registro concluído (ver o caminho sem projeto): na vistoria
  // aprovada não há cartão, e o sino é o único sinal.
  let avisos = 0;
  for (const a of avisosEnel(regra.tipo_documento, classificacao, leitura, projeto)) {
    avisos += await deps.avisar({ accountId: run.account_id, messageId: m.messageId, protocolo: CHAVE_DA_MENSAGEM_ENEL, projectId: projeto.project_id, ...a });
  }

  const concluida = !passageira && !anexoFalhou;
  await deps.registrarEmailLido({
    ...base, projectId: projeto.project_id, referencia: referenciaDoCartao, casamento: id.por,
    // Cartão só quando há o que decidir: uma etapa, ou gravar a NT. 99 respostas
    // automáticas não podem virar 99 cartões. Projeto à frente (vistoria) e sem
    // protocolo ganha cartão só de troca.
    abrirCartao: recomendacao !== null || atualizarProtocolo,
    // só vai quando é pedido: sem ele o payload é o de antes (o banco usa FALSE)
    ...(atualizarProtocolo ? { atualizarProtocolo: true } : {}),
    tipoDocumento: regra.tipo_documento, veredito: parecer.ok ? parecer.veredito : null,
    resumo: parecer.resumo || null, anexos: anexados,
    motivo: ressalvas.length ? ressalvas.join(' · ') : null, recomendacao, concluida, arquivoLido: lido,
  });

  log('e-mail tratado', {
    projeto: projeto.codigo, por: id.por, tipo: regra.tipo_documento, leu_pdf: ler,
    anexados, recomendacao, troca_de_protocolo: atualizarProtocolo, avisos, concluida,
  });
  return {
    situacao: 'tratado', por: id.por, anexados, imagensIgnoradas, recusados: recusados.length,
    semNome: m.anexosSemNome, deOutroProjeto: barrados.length, avisos, concluida,
  };
}

export interface ContaEnel {
  lidos: number; tratados: number; porProtocolo: number; porUc: number; porTitular: number;
  naoIdentificados: number; conflitos: number; inativos: number; bloqueados: number; ignorados: number;
  anexados: number; deOutroProjeto: number; recusados: number; semNome: number; imagens: number;
  avisos: number; pulados: number; aTentarDeNovo: number; naoLidas: number;
  limpos: number; falhasBusca: number; falhasTratamento: number;
}
export const contaEnelZerada = (): ContaEnel => ({
  lidos: 0, tratados: 0, porProtocolo: 0, porUc: 0, porTitular: 0, naoIdentificados: 0, conflitos: 0,
  inativos: 0, bloqueados: 0, ignorados: 0, anexados: 0, deOutroProjeto: 0, recusados: 0, semNome: 0,
  imagens: 0, avisos: 0, pulados: 0, aTentarDeNovo: 0, naoLidas: 0, limpos: 0, falhasBusca: 0, falhasTratamento: 0,
});

export function somarEnel(n: ContaEnel, r: TratamentoEnel): void {
  n.anexados += r.anexados; n.imagens += r.imagensIgnoradas; n.recusados += r.recusados;
  n.semNome += r.semNome; n.deOutroProjeto += r.deOutroProjeto; n.avisos += r.avisos;
  if (!r.concluida) n.aTentarDeNovo++;
  if (r.situacao === 'tratado') {
    n.tratados++;
    if (r.por === 'protocolo') n.porProtocolo++; else if (r.por === 'uc') n.porUc++; else if (r.por === 'titular') n.porTitular++;
  } else if (r.situacao === 'nao_identificado') n.naoIdentificados++;
  else if (r.situacao === 'conflito') n.conflitos++;
  else if (r.situacao === 'inativo') n.inativos++;
  else if (r.situacao === 'bloqueado') n.bloqueados++;
  else n.ignorados++;
}

/** O `resultado` do run — é daqui que a tela lê os contadores. */
export function resultadoEnel(n: ContaEnel, remetentes: number, projetosAtivos: number, falhas: number): Record<string, number> {
  return {
    remetentes, projetos_ativos: projetosAtivos, lidos: n.lidos, tratados: n.tratados,
    por_protocolo: n.porProtocolo, por_uc: n.porUc, por_titular: n.porTitular,
    nao_identificados: n.naoIdentificados, conflitos: n.conflitos, inativos: n.inativos,
    bloqueados: n.bloqueados, ignorados: n.ignorados, anexados: n.anexados,
    anexos_de_outro_projeto: n.deOutroProjeto, anexos_recusados: n.recusados, anexos_sem_nome: n.semNome,
    imagens_ignoradas: n.imagens, avisos: n.avisos, pulados: n.pulados,
    a_tentar_de_novo: n.aTentarDeNovo, nao_lidas: n.naoLidas,
    falhas, falhas_busca: n.falhasBusca, falhas_tratamento: n.falhasTratamento,
  };
}

/**
 * A janela de busca é FIXA (30 dias, `janelaDeBusca`), então o run não depende da
 * última varredura: a retentativa e o "Ler de novo" alcançam o e-mail antigo.
 */
export async function executarVarreduraEnel(run: Run): Promise<void> {
  log('varredura por e-mail (por remetente) iniciada', { run: run.id });
  let caixa: Caixa | null = null;
  try {
    const creds = await credencialDaCaixa(run.account_id);
    const projetos = await projetosDoEmail(run.account_id);
    const regras = await regrasDoEmail(run.account_id);
    if (regras.length === 0) throw new Error('Esta concessionária não tem regras de e-mail cadastradas na tela da Ludmilla.');
    // sem remetente nenhum é o mesmo erro de "sem regras": nunca um run "ok" com 0 lidos
    const remetentes = remetentesDoRun(regras);
    const desde = janelaDeBusca(new Date());
    caixa = await abrirCaixa(creds);
    const n = contaEnelZerada();
    // Duas regras que se sobrepõem (um remetente contido no outro) achariam a mesma
    // mensagem duas vezes: tratada uma vez por run, a IA não é paga em dobro.
    const vistas = new Set<string>();

    // `remetente` é endereço da ENEL (não é dado de cliente) e pode ir para o log;
    // `erro` de busca/banco vem do IMAP ou do PostgREST. Nunca o assunto, o nome
    // de arquivo ou o titular.
    for (const rem of remetentes) {
      let uids: number[];
      try { uids = await caixa.procurarDe(rem, desde); }
      catch (e) { n.falhasBusca++; log('a busca na caixa falhou para este remetente', { nivel: 'falha', remetente: rem, erro: (e as Error).message }); continue; }
      n.limpos++;
      if (uids.length === 0) continue;

      const envelopes: EnvelopeLido[] = [];
      try { for await (const env of caixa.envelopes(uids)) envelopes.push(env); }
      catch (e) { n.falhasBusca++; log('não consegui ler os envelopes deste remetente', { nivel: 'falha', remetente: rem, erro: (e as Error).message }); continue; }

      const aprovados = new Map<number, EnvelopeLido>();
      for (const env of envelopes) {
        if (vistas.has(env.messageId)) continue;
        let pendente: boolean;
        try { pendente = await mensagemPendente(run.account_id, env.messageId, CHAVE_DA_MENSAGEM_ENEL); }
        catch (e) { n.falhasTratamento++; log('não consegui conferir se a mensagem já foi tratada', { nivel: 'falha', mensagem: env.messageId, erro: (e as Error).message }); continue; }
        if (!pendente) { n.pulados++; continue; }
        aprovados.set(env.uid, env);
      }
      if (aprovados.size === 0) continue;

      try {
        for await (const baixada of caixa.baixar([...aprovados.keys()])) {
          const env = aprovados.get(baixada.uid);
          // o id que vale é o do envelope: foi com ele que a pendência respondeu
          const m = env ? { ...baixada, messageId: env.messageId } : baixada;
          // duas cópias com o mesmo Message-ID (uids diferentes) no mesmo lote: uma vez só
          if (vistas.has(m.messageId)) { n.pulados++; continue; }
          vistas.add(m.messageId);
          try { n.lidos++; somarEnel(n, await tratarMensagemEnel(run, m, regras, projetos)); }
          catch (e) { n.falhasTratamento++; log('o tratamento desta mensagem falhou', { nivel: 'falha', mensagem: m.messageId, erro: (e as Error).message }); }
        }
      } catch (e) {
        n.falhasBusca++;
        log('não consegui baixar as mensagens deste remetente', { nivel: 'falha', remetente: rem, erro: (e as Error).message });
      }
    }

    n.naoLidas = caixa.naoLidas();
    if (n.limpos === 0 && n.falhasBusca > 0) throw new Error(`Nenhum dos ${n.falhasBusca} remetentes pôde ser procurado na caixa de e-mail.`);
    const falhas = n.falhasBusca + n.falhasTratamento;
    const ativos = projetos.filter(p => p.ativo).length;
    await finalizarRun(run.id, {
      situacao: 'ok', situacaoConta: 'ok', protocolos: ativos, mudancas: n.anexados,
      resultado: resultadoEnel(n, remetentes.length, ativos, falhas),
    });
    log('varredura por e-mail (por remetente) ok', { run: run.id, ...n, falhas });
  } catch (e) {
    const erro = classificarErroEmail(e);
    await finalizarRun(run.id, {
      situacao: 'erro', erro: erro.mensagem,
      situacaoConta: erro.situacaoConta === 'ok' ? undefined : erro.situacaoConta,
    }).catch(err => log('não consegui fechar o run', { run: run.id, erro: (err as Error).message }));
    log('varredura por e-mail (por remetente) com erro', { run: run.id, classe: erro.classe, mensagem: erro.mensagem });
  } finally {
    // toda saída passa por aqui: o Gmail limita 15 conexões IMAP por conta
    await caixa?.fechar().catch(() => undefined);
  }
}
