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
