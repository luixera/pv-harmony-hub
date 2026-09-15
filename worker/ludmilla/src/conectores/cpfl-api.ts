import type { Protocolo } from './index.js';

/**
 * A API interna do portal "Projetos Particulares" da CPFL.
 *
 * O site é um app React que conversa com o Drupal por
 * `/gestao-projetos/api/drupalApi/ServerSide?...&endpoint=<rota>` — a mesma
 * sessão logada do navegador vale para essas chamadas. Descoberto em
 * 14/09/2026 capturando o tráfego da tela "Meus projetos":
 *
 * - lista:   endpoint=/api/external/getprojetosorcamentoconexao
 *            params[emailProfissionalResponsavel], [quantidadeItensPorPagina]
 *            (até 200), [numeroDaPagina] → data.quantidadeItem +
 *            data.projetoOrcamentoConexao.$values[]
 * - parecer: endpoint=/api/internal/getdetalhesparecer/{codigoProjeto}
 *            → analisesPrincipais.{analises,pareceres}.$values[]
 *
 * Cada item da lista traz o SELO genérico (nmStatusTipo: Aprovado, Pendente,
 * Reprovado, Em Andamento, Cancelado, Incompleto) e o STATUS DETALHADO
 * (status, com partes separadas por "|", e codigoStatus). O detalhado é o que
 * importa: "PROJETO ENCERRADO" é aprovado com vistoria concluída; "DOCUMENTOS
 * APROVADOS | SOLICITAR VISTORIA" é aprovado à espera da vistoria; "ORÇAMENTO
 * DE CONEXÃO EMITIDO E AGUARDANDO APROVAÇÃO DO CLIENTE" é aprovado com
 * adequação/obra (regra do usuário: aprovado ≠ concluído).
 */

const BASE = 'https://www.cpfl.com.br/gestao-projetos/api/drupalApi/ServerSide';

export function urlListaCpfl(email: string, pagina: number, porPagina = 200): string {
  const q = new URLSearchParams({
    httpType: 'GET',
    paramType: 'QUERY',
    'params[emailProfissionalResponsavel]': email,
    'params[quantidadeItensPorPagina]': String(porPagina),
    'params[numeroDaPagina]': String(pagina),
    'params[NumeroAtividadeOuNotaServico]': '',
    'params[CodigoServico]': '',
    'params[TipoStatus]': '',
    endpoint: '/api/external/getprojetosorcamentoconexao',
  });
  return `${BASE}?${q.toString()}`;
}

export function urlParecerCpfl(codigoProjeto: number | string): string {
  const q = new URLSearchParams({
    httpType: 'GET',
    paramType: 'ROUTE',
    endpoint: `/api/internal/getdetalhesparecer/${codigoProjeto}`,
  });
  return `${BASE}?${q.toString()}`;
}

/**
 * "SOLICITAR VISTORIA|DOCUMENTOS APROVADOS" e "DOCUMENTOS APROVADOS|SOLICITAR
 * VISTORIA" são o mesmo estado — o portal só muda a ordem. Normalizar é o que
 * faz a tradução (portal_status_map) bater nas duas formas.
 */
export function normalizarStatusCpfl(status: string | null | undefined): string {
  if (!status) return '';
  const partes = status.split('|').map(p => p.trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean);
  return [...new Set(partes)].sort().join(' | ');
}

/** "09/14/2026 10:25:40" (americano, como a API manda) → "14/09/2026". */
const dataBr = (v: string | null | undefined): string => {
  if (!v) return '';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  if (m) return `${m[2]}/${m[1]}/${m[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : v;
};

interface ItemLista {
  codigoProjeto?: number | string | null;
  titulo?: string | null;
  numeroAtividade?: string | null;
  numeroNotaServico?: string | null;
  nomeMunicipio?: string | null;
  nomeClassificacao?: string | null;
  dataCadastro?: string | null;
  dataAtualizacao?: string | null;
  status?: string | null;
  codigoStatus?: string | null;
  nmStatusTipo?: string | null;
  nmSubStatus?: string | null;
}

export function lerListaCpfl(resposta: unknown): { itens: Protocolo[]; total: number } {
  const data = (resposta as { data?: { quantidadeItem?: number; projetoOrcamentoConexao?: { $values?: ItemLista[] } } })?.data;
  const valores = data?.projetoOrcamentoConexao?.$values ?? [];
  const itens: Protocolo[] = [];
  for (const v of valores) {
    const protocolo = (v.numeroAtividade ?? '').trim();
    if (!protocolo) continue;   // "Incompleto": ainda não tem atividade, não há o que acompanhar
    itens.push({
      protocolo,
      titular: (v.titulo ?? '').trim(),
      status: normalizarStatusCpfl(v.status) || (v.nmStatusTipo ?? '').trim(),
      raw: {
        selo: v.nmStatusTipo ?? '',
        subStatus: v.nmSubStatus ?? '',
        codigoStatus: v.codigoStatus ?? '',
        codigoProjeto: v.codigoProjeto == null ? '' : String(v.codigoProjeto),
        notaServico: v.numeroNotaServico ?? '',
        municipio: v.nomeMunicipio ?? '',
        servico: v.nomeClassificacao ?? '',
        'Data de criação': dataBr(v.dataCadastro),
        'Última atualização': dataBr(v.dataAtualizacao),
      },
    });
  }
  return { itens, total: Number(data?.quantidadeItem ?? itens.length) };
}

/** O último parecer da CPFL sobre o projeto — texto que a tela mostra ao projetista. */
export function lerUltimoParecerCpfl(resposta: unknown): { data: string; status: string; texto: string } | null {
  const p = (resposta as { data?: { analisesPrincipais?: { pareceres?: { $values?: {
    dataParecer?: string; nomeStatus?: string; respostaParecerExterno?: string; respostaParecer?: string;
  }[] } } } })?.data?.analisesPrincipais?.pareceres?.$values ?? [];
  if (p.length === 0) return null;
  const u = p[p.length - 1];
  return {
    data: dataBr(u.dataParecer),
    status: (u.nomeStatus ?? '').trim(),
    texto: (u.respostaParecerExterno || u.respostaParecer || '').replace(/\s+/g, ' ').trim().slice(0, 1_000),
  };
}
