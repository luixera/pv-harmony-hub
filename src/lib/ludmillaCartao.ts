/**
 * O QUE O CARTÃO DE RECOMENDAÇÃO DA LUDMILLA DIZ — funções puras, sem React.
 *
 * Pedido do usuário (16/10/2026, "falha gravíssima"): todo cartão mostra o NOME
 * DO TITULAR e o NOME DA EMPRESA, qualquer que seja o meio (portal CPFL, e-mail
 * EDP, e-mail ENEL). Tudo que decide "que nome aparece" mora aqui, para ter
 * teste: a tela só desenha o que estas funções devolvem.
 */

type Dados = { holder_name?: string | null } | null | undefined;

/** O que a tela junta do projeto para montar o cartão. Tudo opcional: nada quebra. */
export interface ProjetoParaIdentidade {
  title?: string | null;
  companies?: { name?: string | null } | null;
  /** 1:1 com o projeto; o PostgREST devolve objeto, mas aceitamos lista de uma linha */
  project_general_data?: Dados | Dados[];
}

export interface IdentidadeDoCartao {
  /** o titular do CADASTRO (ou, sem projeto, o único nome que existe: o do portal) */
  titular: string | null;
  /** o nome como o PORTAL escreve, só quando difere do titular do cadastro */
  noPortal: string | null;
  empresa: string | null;
}

/** Texto aparado; vazio vira null. É o que impede "undefined" ou uma linha em branco na tela. */
function limpo(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t === '' ? null : t;
}

/** Chave de comparação de nomes: sem acento, caixa alta, espaços únicos. */
function chaveDeNome(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function holderDoProjeto(p: ProjetoParaIdentidade): string | null {
  const d = p.project_general_data;
  const linha = Array.isArray(d) ? d[0] : d;
  return limpo(linha?.holder_name);
}

/**
 * Titular: o do cadastro (`project_general_data.holder_name`, depois o título do
 * projeto). No portal (CPFL) `titular_portal` é como o PORTAL escreve — "UFV JOSE
 * FRANCISCO" — e serve para conferir o casamento: aparece à parte quando difere.
 * No e-mail o banco já grava aí o titular do cadastro (Task 5), então coincide e
 * o nome aparece uma vez só. Cartão antigo (NULL) cai direto no cadastro.
 */
export function identidadeDoCartao(u: {
  titular_portal?: string | null;
  project?: ProjetoParaIdentidade | null;
}): IdentidadeDoCartao {
  const portal = limpo(u.titular_portal);
  const cadastro = u.project ? (holderDoProjeto(u.project) ?? limpo(u.project.title)) : null;
  const noPortal = cadastro && portal && chaveDeNome(cadastro) !== chaveDeNome(portal) ? portal : null;
  return {
    titular: cadastro ?? portal,
    noPortal,
    empresa: limpo(u.project?.companies?.name),
  };
}

const ROTULO_CASAMENTO: Record<string, string> = {
  protocolo: 'protocolo',
  cpf: 'CPF/CNPJ',
  uc: 'UC',
  titular: 'nome do titular',
};

/** Como o projeto foi casado com o cartão. Valor desconhecido: null (não afirma nada). */
export function rotuloCasamento(c: string | null | undefined): string | null {
  return c ? (ROTULO_CASAMENTO[c] ?? null) : null;
}

/** O selo violeta: "protocolo novo — casado por …; no cadastro está …". */
export function textoDaTrocaDeProtocolo(
  casamento: string | null | undefined, protocoloAnterior: string | null | undefined,
): string {
  const por = rotuloCasamento(casamento);
  const antes = limpo(protocoloAnterior);
  // o cadastro pode guardar texto ("Sem protocolo"): entre aspas para não parecer um número
  const noCadastro = antes === null ? '(vazio)' : /\d/.test(antes) ? antes : `"${antes}"`;
  return `protocolo novo — ${por ? `casado por ${por}; ` : ''}no cadastro está ${noCadastro}`;
}

const ACHADO_POR: Record<string, string> = {
  protocolo: 'achado pelo protocolo',
  cpf: 'achado pelo CPF/CNPJ',
  uc: 'achado pela UC',
  titular: 'achado pelo nome do titular',
};

/**
 * COMO o projeto foi achado, dito no cartão de e-mail SEMPRE (não só dentro do selo
 * violeta da troca de protocolo): "achado pelo nome do titular" pede mais cuidado de
 * quem confere do que "achado pelo protocolo". Valor desconhecido: null.
 */
export function textoDoAchado(c: string | null | undefined): string | null {
  return c ? (ACHADO_POR[c] ?? null) : null;
}

export interface DetalheDoCartaoDeEmail {
  /** "achado pela UC" etc.; null quando o cartão não diz como foi casado */
  achado: string | null;
  /** o `raw.motivo` gravado pelo robô: o porquê (ressalva ou bloqueio); null quando não há */
  motivo: string | null;
  /**
   * O dia do e-mail. O rótulo diz de onde a data veio: `recebido_em` (cartões novos) é a
   * do e-mail; nos cartões antigos o campo não existe e a única data é a da leitura, que
   * não pode ser apresentada como a do e-mail.
   */
  data: { iso: string; rotulo: 'e-mail recebido em' | 'lido pela Ludmilla em' } | null;
  /** o documento NÃO foi anexado (o titular dele é de outra pessoa): o cartão ganha a faixa vermelha */
  bloqueio: boolean;
}

function textoDeRaw(raw: Record<string, unknown>, chave: string): string | null {
  const v = raw[chave];
  return typeof v === 'string' ? limpo(v) : null;
}

/** ISO legível pelo `Date`; qualquer outra coisa vira null (a tela nunca escreve "Invalid Date"). */
function dataValida(s: string | null): string | null {
  return s !== null && !Number.isNaN(Date.parse(s)) ? s : null;
}

/** Sem acento e em minúsculas: "NAO ANEXEI" e "não anexei" são o mesmo texto. */
function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** O motivo que ABRE com "não anexei" (e logo em seguida um "·" ou o fim) — não "não anexei ainda: …" nem "não anexado(s)". */
const ABRE_COM_NAO_ANEXEI = /^nao anexei\s*(?:·|$)/;

/**
 * O que um cartão de E-MAIL (EDP ou ENEL) diz além da recomendação. `null` para o cartão
 * de portal (CPFL): nada muda nele.
 *
 * Como saber que o cartão é de e-mail: `ludmilla_email_registrar` grava sempre `assunto`
 * e `remetente` no `raw` (mesmo nulos, a chave existe); o `raw` do portal traz as colunas
 * da tabela da concessionária ("Última atualização", …) e nunca essas duas.
 *
 * Bloqueio: o robô escreve "não anexei · o documento é de …" no `motivo` quando o titular
 * do documento é de outra pessoa (e, na EDP, quando nenhum arquivo é do protocolo). O
 * "não anexei ainda: …" da ENEL (a IA ainda não leu, tenta de novo) NÃO é bloqueio.
 */
export function detalheDoCartaoDeEmail(u: {
  raw?: Record<string, unknown> | null;
  casamento?: string | null;
  detectado_em?: string | null;
}): DetalheDoCartaoDeEmail | null {
  const raw = u.raw;
  if (!raw || typeof raw !== 'object' || !('assunto' in raw || 'remetente' in raw)) return null;

  const motivo = textoDeRaw(raw, 'motivo');
  const recebido = dataValida(textoDeRaw(raw, 'recebido_em'));
  const lido = dataValida(limpo(u.detectado_em));
  return {
    achado: textoDoAchado(u.casamento),
    motivo,
    data: recebido ? { iso: recebido, rotulo: 'e-mail recebido em' }
      : lido ? { iso: lido, rotulo: 'lido pela Ludmilla em' } : null,
    bloqueio: motivo !== null && ABRE_COM_NAO_ANEXEI.test(semAcento(motivo)),
  };
}

/**
 * Qual quadro de avisos a última leitura da ENEL mostra. O `avisos` do robô soma SINOS
 * tocados (a RPC devolve o ROW_COUNT, cerca de 6 por aviso); `avisos_mensagens` conta as
 * MENSAGENS que geraram aviso. Run antigo não tem a segunda chave: cai nos sinos, com o
 * rótulo que diz o que o número é.
 */
export function quadroDosAvisos(resultado: Record<string, unknown> | null | undefined): { chave: string; rotulo: string } {
  return typeof resultado?.avisos_mensagens === 'number'
    ? { chave: 'avisos_mensagens', rotulo: 'avisos (mensagens)' }
    : { chave: 'avisos', rotulo: 'sinos tocados' };
}

const NO_HISTORICO = 'Ficou no histórico com você como autor e a Ludmilla como origem.';

/** O aviso depois de "Aplicar": com etapa o card foi movido; sem etapa só o protocolo mudou. */
export function textoAplicado(status: string | null | undefined): string {
  return status ? `Card movido. ${NO_HISTORICO}` : `Protocolo do cadastro atualizado. ${NO_HISTORICO}`;
}

/**
 * O que a linha do histórico de e-mails mostra do protocolo. A ENEL grava a chave
 * de mensagem '' (um e-mail não tem protocolo antes de ser identificado): com
 * projeto o código já abre a linha, então nada se repete; sem projeto, um traço.
 */
export function referenciaDaMensagem(protocolo: string, codigoDoProjeto: string | null | undefined): string | null {
  const p = protocolo.trim();
  if (p !== '') return `protocolo ${p}`;
  return limpo(codigoDoProjeto) ? null : '—';
}

/**
 * O texto de um erro de consulta para o aviso da tela. O erro do supabase-js é um
 * objeto simples (`{ message, code, … }`), não um `Error`: o hook faz `throw error`
 * e o react-query o entrega como veio. Nada aproveitável: null (nunca "undefined").
 */
export function mensagemDeErro(e: unknown): string | null {
  if (typeof e === 'string') return limpo(e);
  if (e && typeof e === 'object' && 'message' in e) return limpo((e as { message?: unknown }).message as string | undefined);
  return null;
}
