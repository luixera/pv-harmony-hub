import type { NovoParecer, ResultadoParecer, Risco, TipoParecer } from './tipos';

/**
 * Confronto do modelo com o parecer real da distribuidora (spec §13).
 * A regra de acerto espelha `rede_parecer_acerto` no banco; está aqui só para
 * a tela mostrar o veredito antes de gravar e para o teste documentar a regra.
 */
export const RESULTADOS: ResultadoParecer[] =
  ['inversao_sem_novo', 'inversao_com_novo', 'sem_inversao', 'aprovado', 'aprovado_com_obra', 'reprovado'];
export const TIPOS: TipoParecer[] = ['orcamento_conexao', 'parecer_acesso', 'outro'];

export function rotuloResultado(r: ResultadoParecer): string {
  return {
    inversao_sem_novo: 'Já inverte o fluxo, mesmo sem o sistema novo',
    inversao_com_novo: 'Inverte só com o sistema novo',
    sem_inversao: 'Sem inversão de fluxo',
    aprovado: 'Aprovado sem restrição',
    aprovado_com_obra: 'Aprovado com obra ou limitação',
    reprovado: 'Reprovado / sem capacidade',
  }[r];
}
export function rotuloTipo(t: TipoParecer): string {
  return { orcamento_conexao: 'Orçamento de conexão', parecer_acesso: 'Parecer de acesso', outro: 'Outro documento' }[t];
}

/** "Inversão já existe" ou "reprovado" só é acerto se o modelo dizia risco; o resto, se dizia atenção ou folga. */
export function acertoDoModelo(risco: Risco, resultado: ResultadoParecer): boolean | null {
  if (risco === 'sem_dado') return null;
  if (resultado === 'inversao_sem_novo' || resultado === 'reprovado') return risco === 'risco';
  return risco === 'atencao' || risco === 'folga';
}

export interface Formulario {
  tipo: TipoParecer; resultado: ResultadoParecer;
  codigo_distribuidora: string; numero_estudo: string; numero_pedido: string; data_documento: string;
  potencia_solicitada_kw: string; potencia_injetavel_kw: string;
  ucs_distribuidora: string; gd_unidades_distribuidora: string; gd_kw_distribuidora: string; carga_min_distribuidora_kw: string;
  observacoes: string;
}
export const FORMULARIO_VAZIO: Formulario = {
  tipo: 'orcamento_conexao', resultado: 'inversao_sem_novo',
  codigo_distribuidora: '', numero_estudo: '', numero_pedido: '', data_documento: '',
  potencia_solicitada_kw: '', potencia_injetavel_kw: '',
  ucs_distribuidora: '', gd_unidades_distribuidora: '', gd_kw_distribuidora: '', carga_min_distribuidora_kw: '',
  observacoes: '',
};

const numero = (s: string): number | undefined => {
  const t = s.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
const texto = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim());

export function montarRegistro(transformadorId: number, f: Formulario,
  arquivo?: { nome: string; hash: string; caminho: string }): NovoParecer {
  return {
    transformador_id: transformadorId, tipo: f.tipo, resultado: f.resultado,
    codigo_distribuidora: texto(f.codigo_distribuidora), numero_estudo: texto(f.numero_estudo),
    numero_pedido: texto(f.numero_pedido), data_documento: texto(f.data_documento),
    potencia_solicitada_kw: numero(f.potencia_solicitada_kw), potencia_injetavel_kw: numero(f.potencia_injetavel_kw),
    ucs_distribuidora: numero(f.ucs_distribuidora), gd_unidades_distribuidora: numero(f.gd_unidades_distribuidora),
    gd_kw_distribuidora: numero(f.gd_kw_distribuidora), carga_min_distribuidora_kw: numero(f.carga_min_distribuidora_kw),
    observacoes: texto(f.observacoes),
    arquivo_nome: arquivo?.nome, arquivo_hash_sha256: arquivo?.hash, arquivo_caminho: arquivo?.caminho,
  };
}

/** SHA-256 do PDF no navegador: a prova de qual documento foi registrado. */
export async function sha256DeArquivo(arquivo: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await arquivo.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
