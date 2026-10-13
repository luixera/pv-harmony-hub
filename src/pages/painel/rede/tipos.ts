/** Contratos da RPC `rede_no_mapa_v2` e companheiras (spec §11.3). */
export type Risco = 'folga' | 'atencao' | 'risco' | 'sem_dado';
export type Camada = 'pontos' | 'alimentadores' | 'subestacoes';

export interface Base { distribuidora?: string; sigla?: string; data_base?: string | null; importado_em?: string | null }
export interface Regras { fator: number; atencao: number; risco: number }
export interface Resumo { total: number; risco: number; atencao: number; folga: number; sem_dado: number }

export interface PropsPonto {
  id: number; codigo: string; risco: Risco; lng: number; lat: number;
  potencia_nominal_kva: number | null; carga_min_diurna_kw: number | null;
  gd_conectada_kw: number | null; margem_kw: number | null; ocupacao_pct: number | null;
  alimentador: string | null; alimentador_id: number | null; subestacao: string | null;
}
export interface PropsCelula {
  id: number; nivel: number; risco: Risco; trafos: number; trafos_risco: number;
  trafos_atencao: number; trafos_folga: number; trafos_sem_dado: number;
  oeste: number; sul: number; leste: number; norte: number;
}
export interface PropsAlimentador {
  id: number; codigo: string; risco: Risco; ocupacao_pct: number | null;
  carga_min_diurna_kw: number | null; gd_conectada_kw: number | null;
  trafos: number; trafos_risco: number; subestacao: string | null;
  oeste: number; sul: number; leste: number; norte: number;
}
export interface PropsSubestacao {
  id: number; codigo: string; nome: string | null; lng: number; lat: number;
  alimentadores: number; alimentadores_risco: number;
}

export interface Feicao<P> { type: 'Feature'; id: number; geometry: unknown; properties: P }
export interface Colecao<P> { type: 'FeatureCollection'; features: Feicao<P>[] }

export interface RespostaMapa {
  base: Base; regras: Regras; zoom: number;
  camada: 'celula' | 'ponto'; nivel: number | null; resumo: Resumo;
  pontos: Colecao<PropsPonto> | null; celulas: Colecao<PropsCelula> | null;
  alimentadores: Colecao<PropsAlimentador> | null; subestacoes: Colecao<PropsSubestacao> | null;
  teto: number; excedeu: boolean;
}

export interface ResultadoBusca {
  tipo: 'subestacao' | 'alimentador' | 'trafo'; id: number; codigo: string; nome: string | null;
  risco: Risco | null; lng: number | null; lat: number | null;
  oeste: number | null; sul: number | null; leste: number | null; norte: number | null;
}

export interface DetalheAlimentador {
  id: number; codigo: string; risco: Risco; ocupacao_pct: number | null;
  carga_min_diurna_kw: number | null; gd_conectada_kw: number | null; margem_kw: number | null;
  trafos: number; trafos_risco: number; trafos_atencao: number; trafos_folga: number; trafos_sem_dado: number;
  subestacao: string | null; distribuidora: string | null; tem_tracado: boolean;
  oeste: number | null; sul: number | null; leste: number | null; norte: number | null;
}

/** O que está aberto na gaveta lateral. */
export type Selecao =
  | { tipo: 'trafo'; props: PropsPonto }
  | { tipo: 'alimentador'; id: number; props?: PropsAlimentador }
  | null;
