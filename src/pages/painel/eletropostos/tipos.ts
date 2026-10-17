/**
 * Tipos do monitor de eletropostos — espelham o JSON das RPCs
 * `eletropostos_resumo`, `eletropostos_detalhe` e `eletropostos_coleta`
 * (migração 20261015200000), que por sua vez portam o `servidor.py` do
 * sistema local. Chaves em português e snake_case, como vêm do banco.
 */

export type Status = 'livre' | 'ocupado' | 'fora' | 'desconhecido';

export interface Premissas {
  dc_fator_min: number; dc_fator_max: number;
  ac_kw_min: number; ac_kw_max: number;
  ac_fator_min: number; ac_fator_max: number;
  preco_kwh_padrao: number; custo_energia_kwh_padrao: number;
}

/** Métricas de um conector no período (porta de `metricas_conector`). */
export interface MetricasConector {
  horas_ocupado: number;
  /** horas à potência cheia: com 2 carros no mesmo carregador cada um leva metade; "em preparação" não leva */
  horas_energia?: number;
  horas_observadas: number;
  horas_fora: number;
  ocupacao: number | null;
  cobertura: number | null;
  sessoes: number;
  duracao_media_min: number | null;
  ultimo_status: Status | null;
  ultimo_bruto: string | null;
  ultima_leitura: string | null;
  potencia_kw: number | null;
  kwh_min?: number;
  kwh_max?: number;
}

export interface ConectorDetalhe {
  fonte: string;
  local_fonte: string;
  conector: string;
  nome: string;
  m: MetricasConector;
}

/** Cadastro de um local, como está na tabela. */
export interface Cadastro {
  id: string;
  nome: string;
  operadora: string | null;
  cidade: string | null;
  endereco: string | null;
  lat: number | null;
  lng: number | null;
  tipo: 'DC' | 'AC' | null;
  potencia_kw: number | null;
  conectores: number | null;
  preco_kwh: number | null;
  custo_energia_kwh: number | null;
  fonte_status: string | null;
  observacoes: string | null;
  ativo: boolean;
  /** fonte que entra na conta quando o local é lido por mais de uma (null = por dia, a que mais leu) */
  fonte_principal: string | null;
}

/** Local montado pelo banco (cadastro + métricas do período). */
export interface Local extends Cadastro {
  preco_efetivo: number;
  custo_efetivo: number;
  preco_estimado: boolean;
  custo_estimado: boolean;
  monitorado: boolean;
  conectores_monitorados: number;
  horas_ocupado: number;
  horas_ocupado_dia: number;
  ocupacao: number | null;
  cobertura: number | null;
  sessoes: number;
  kwh_min: number; kwh_max: number;
  receita_min: number; receita_max: number;
  custo_min: number; custo_max: number;
  margem_min: number; margem_max: number;
  agora: Partial<Record<Status, number>>;
}

export interface Kpis {
  locais: number;
  locais_dc: number;
  monitorados: number;
  conectores_monitorados: number;
  horas_ocupado: number;
  ocupacao_media: number | null;
  kwh_min: number; kwh_max: number;
  receita_min: number; receita_max: number;
  sessoes: number;
  cobertura: number | null;
  agora: Record<Status, number>;
  dias: number;
}

export interface NaoVinculado {
  fonte: string;
  local_fonte: string;
  nome: string | null;
  lat: number | null;
  lng: number | null;
}

export interface Resumo {
  periodo: { de: string; ate: string };
  kpis: Kpis;
  locais: Local[];
  nao_vinculados: NaoVinculado[];
  premissas: Premissas;
}

export interface DiaSerie {
  dia: string;
  horas_ocupado: number;
  horas_observadas: number;
  ocupacao: number | null;
  receita_min: number;
  receita_max: number;
}

export interface Detalhe {
  periodo: { de: string; ate: string };
  local: Local;
  conectores: ConectorDetalhe[];
  diario: DiaSerie[];
  /** 7 linhas (0 = segunda) × 24 horas: fração do tempo carregando, ou null sem leitura. */
  perfil: (number | null)[][];
  /** nome do conector → [[ 'YYYY-MM-DDTHH:MM' (Brasília), status ], …] das últimas 48 h */
  linha_do_tempo: Record<string, [string, Status][]>;
  vinculos: { fonte: string; local_fonte: string; nome: string | null; na_conta?: boolean }[];
  /** fontes usadas nas contas do período (a escolha é por dia), separadas por vírgula */
  fonte_na_conta?: string | null;
}

export interface FonteColeta {
  fonte: string;
  ultima: string | null;
  oks: number;
  total: number;
  ultima_ok: string | null;
}

export interface Coleta {
  fontes: FonteColeta[];
  erros: { ts_utc: string; fonte: string; erro: string | null }[];
  por_dia: { dia: string; fonte: string; leituras: number }[];
  inicio: string | null;
  total_leituras: number;
  estacoes: { id: string; nome: string; vista_em: string | null; ativa: boolean }[];
  agora: string;
}

export interface Filtro {
  q: string;
  cidade: string;
  operadora: string;
  tipo: '' | 'DC' | 'AC';
  mon: '' | '1' | '0';
}

export type ColunaOrdem =
  | 'nome' | 'cidade' | 'operadora' | 'tipo' | 'potencia_kw' | 'ocupacao' | 'horas_ocupado_dia'
  | 'sessoes' | 'preco_efetivo' | 'receita_max' | 'agora' | 'fonte_status';

export interface Ordem { col: ColunaOrdem; dir: 1 | -1 }

export const ROTULO_STATUS: Record<Status, string> = {
  livre: 'Livre', ocupado: 'Carregando', fora: 'Fora de serviço', desconhecido: 'Sem leitura',
};

/** Cores de status no visual do console: livre verde, ocupado dourado, fora vermelho, sem leitura cinza. */
export const COR_STATUS: Record<Status, string> = {
  livre: '#3FB27F', ocupado: '#F5A800', fora: '#E0675F', desconhecido: '#56636E',
};
