/** Contratos das RPCs `rede_no_mapa_v3`, `rede_trafo_detalhe`, `rede_fontes` e companheiras (spec §11.3 e §12). */
export type Risco = 'folga' | 'atencao' | 'risco' | 'sem_dado';
export type Camada = 'pontos' | 'alimentadores' | 'subestacoes';

export interface Base { distribuidora?: string; sigla?: string; data_base?: string | null; importado_em?: string | null }
export interface Regras { fator: number; atencao: number; risco: number }
export interface Resumo { total: number; risco: number; atencao: number; folga: number; sem_dado: number }

/** Mínimo para cor, hover e lista. O resto vem em `rede_trafo_detalhe` no clique. */
export interface PropsPonto { id: number; codigo: string; risco: Risco; ocupacao_pct: number | null }
export interface PropsCelula {
  id: number; nivel: number; risco: Risco; trafos: number; trafos_risco: number; trafos_atencao: number;
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
  /** Decidida pela CONTAGEM da caixa, não pelo zoom (rede_amostra). */
  camada: 'celula' | 'ponto'; nivel: number | null;
  /** Trafos contados na caixa; `teto_pontos + 1` significa "mais que o teto". */
  contagem: number; teto_pontos: number;
  resumo: Resumo;
  pontos: Colecao<PropsPonto> | null; celulas: Colecao<PropsCelula> | null;
  alimentadores: Colecao<PropsAlimentador> | null; subestacoes: Colecao<PropsSubestacao> | null;
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

export interface RegrasCompletas extends Regras { janela_inicio: number; janela_fim: number }

export interface FonteImportacao {
  importacao_id: number; arquivo_origem: string | null; versao_bdgd: string | null; data_base: string | null;
  hash_sha256: string | null; tamanho_bytes: number | null; baixado_em: string | null; concluido_em: string | null;
}

/** `rede_trafo_detalhe`: a conta aberta, os campos brutos e a base anterior. */
export interface DetalheTrafo {
  id: number; codigo: string; risco: Risco; ativo: boolean; lng: number; lat: number;
  potencia_nominal_kva: number | null; fases: number | null; tensao_secundaria_v: number | null;
  carga_min_diurna_kw: number | null; gd_conectada_kw: number | null; margem_kw: number | null; ocupacao_pct: number | null;
  unidades_consumidoras: number | null; gd_unidades: number | null; atualizado_em: string;
  alimentador: { id: number; codigo: string; risco: Risco; ocupacao_pct: number | null; trafos: number; trafos_risco: number } | null;
  subestacao: { codigo: string; nome: string | null } | null;
  distribuidora: { id: number; nome: string; sigla: string; data_base: string | null };
  regras: RegrasCompletas;
  bdgd: Record<string, string | number | null>;
  fonte: FonteImportacao | null;
  anterior: { importacao_id: number; data_base: string | null; risco: Risco; ocupacao_pct: number | null; margem_kw: number | null;
              carga_min_diurna_kw: number | null; gd_conectada_kw: number | null; ativo: boolean } | null;
  /** Confrontos registrados neste trafo (spec §13). */
  pareceres: Parecer[];
}

export type TipoParecer = 'orcamento_conexao' | 'parecer_acesso' | 'outro';
export type ResultadoParecer =
  | 'inversao_sem_novo' | 'inversao_com_novo' | 'sem_inversao' | 'aprovado' | 'aprovado_com_obra' | 'reprovado';
/** Linha de `rede_parecer`: o documento real da distribuidora, registrado no trafo. */
export interface Parecer {
  id: number; transformador_id: number; distribuidora_id: number; tipo: TipoParecer;
  codigo_distribuidora: string | null; numero_estudo: string | null; numero_pedido: string | null; data_documento: string | null;
  potencia_solicitada_kw: number | null; resultado: ResultadoParecer; potencia_injetavel_kw: number | null;
  ucs_distribuidora: number | null; gd_unidades_distribuidora: number | null; gd_kw_distribuidora: number | null;
  carga_min_distribuidora_kw: number | null;
  arquivo_nome: string | null; arquivo_hash_sha256: string | null; arquivo_caminho: string | null; observacoes: string | null;
  risco_modelo: Risco; ocupacao_modelo: number | null; gd_modelo_kw: number | null; carga_modelo_kw: number | null;
  importacao_id: number | null; acerto: boolean | null; anulado: boolean; criado_em: string;
}
export interface NovoParecer {
  transformador_id: number; tipo: TipoParecer; resultado: ResultadoParecer;
  codigo_distribuidora?: string; numero_estudo?: string; numero_pedido?: string; data_documento?: string;
  potencia_solicitada_kw?: number; potencia_injetavel_kw?: number;
  ucs_distribuidora?: number; gd_unidades_distribuidora?: number; gd_kw_distribuidora?: number; carga_min_distribuidora_kw?: number;
  arquivo_nome?: string; arquivo_hash_sha256?: string; arquivo_caminho?: string; observacoes?: string;
}
export interface TrafoProximo { id: number; codigo: string; risco: Risco; ocupacao_pct: number | null; dist_m: number; lng: number; lat: number }

export interface Transicao { de: Risco; para: Risco; n: number }
export interface Mudancas {
  anterior: { importacao_id: number; data_base: string | null; concluido_em: string | null } | null;
  totais: Resumo & { ativos: number };
  novos?: number; inativados?: number; reativados?: number; iguais?: number; mudaram?: number; transicoes?: Transicao[];
}
export interface Importacao {
  id: number; data_base: string | null; arquivo_origem: string | null; versao_bdgd: string | null;
  hash_sha256: string | null; tamanho_bytes: number | null; baixado_em: string | null;
  linhas_por_camada: Record<string, number>; etapa: string | null; situacao: 'rodando' | 'concluida' | 'falhou';
  erro: string | null; iniciado_em: string; concluido_em: string | null;
  regras: RegrasCompletas | null; mudancas: Mudancas | null;
}
/** `rede_fontes`: a ficha da fonte, por distribuidora. */
export interface Fontes {
  regras_atuais: RegrasCompletas;
  distribuidoras: {
    distribuidora: { id: number; nome: string; sigla: string; codigo_aneel: string | null; uf: string; data_base: string | null };
    trafos: { ativos: number; inativos: number; risco: number; atencao: number; folga: number; sem_dado: number; com_ucs: number };
    alimentadores: { ativos: number; com_tracado: number };
    confrontos: { n: number; acertos: number; erros: number; sem_conta: number };
    importacoes: Importacao[];
  }[];
}

/** O que está aberto na gaveta lateral. */
export type Selecao =
  | { tipo: 'trafo'; id: number; props?: PropsPonto }
  | { tipo: 'alimentador'; id: number; props?: PropsAlimentador }
  | { tipo: 'fonte' }
  | null;
