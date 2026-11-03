/**
 * Os ENVIOS de um projeto à CPFL (03/11/2026) — puro, sem banco.
 *
 * Cada envio é um run `criar_projeto` em `portal_sync_runs`: o primeiro é o "Criar na CPFL", os
 * seguintes são o "Novo envio" (quando a CPFL reprova, a equipe cria o projeto de novo; a RPC
 * `ludmilla_cpfl_novo_envio` guarda o número anterior em `dados.reenvio_de`). Os prints de cada
 * passo ficam por run, então "Envio 1, Envio 2…" é só a lista desses runs, na ordem do pedido.
 *
 * Simulação antiga (`dados.simular`) fica fora: não criou nada no portal.
 */

export type SituacaoDoEnvio = 'na_fila' | 'rodando' | 'ok' | 'erro';

/** O que a lista precisa de um run — `PortalRun` (useLudmilla) cabe aqui. */
export interface RunDeEnvio {
  id: string;
  situacao: SituacaoDoEnvio;
  pedido_em: string;
  terminado_em: string | null;
  erro: string | null;
  dados: Record<string, unknown> | null;
  resultado: Record<string, unknown> | null;
}

export interface EnvioCpfl {
  runId: string;
  /** 1, 2, … pela ordem do pedido */
  numero: number;
  titulo: string;
  pedidoEm: string;
  situacao: SituacaoDoEnvio;
  /** na fila ou rodando */
  ativo: boolean;
  /** "na fila" · "em andamento" · "criado, nº 613100" · "erro: …" */
  rotulo: string;
  /** o número que a CPFL deu NESTE envio (`resultado.node`); nunca o do cadastro do projeto */
  numeroCpfl: string | null;
  /** o número do envio anterior, quando este é um "Novo envio" */
  reenvioDe: string | null;
  erro: string | null;
}

/** Até quanto tempo depois de terminar o último envio ainda abre sozinho (como era o painel). */
const ABRE_ATE_MS = 3_600_000;

function texto(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

export function ehSimulacao(run: Pick<RunDeEnvio, 'dados'>): boolean {
  const s = run.dados?.simular;
  return s === true || s === 'true';
}

function rotuloDe(situacao: SituacaoDoEnvio, numeroCpfl: string | null, erro: string | null): string {
  switch (situacao) {
    case 'na_fila': return 'na fila';
    case 'rodando': return 'em andamento';
    case 'ok':      return numeroCpfl ? `criado, nº ${numeroCpfl}` : 'criado, sem número';
    case 'erro':    return `erro: ${texto(erro) ?? 'sem detalhe'}`;
  }
}

/**
 * A lista de envios do projeto e qual deles abre sozinho: o ativo (na fila ou rodando) ou, sem
 * ativo, o último — se terminou há até 1 h (o painel antigo fazia assim com o "run recente").
 */
export function listarEnvios(
  runs: RunDeEnvio[],
  agora: number = Date.now(),
): { envios: EnvioCpfl[]; abreSozinho: string | null } {
  const reais = runs
    .filter(r => !ehSimulacao(r))
    .sort((a, b) => Date.parse(a.pedido_em) - Date.parse(b.pedido_em));

  const envios = reais.map((r, i): EnvioCpfl => {
    const numeroCpfl = texto(r.resultado?.node);
    return {
      runId: r.id,
      numero: i + 1,
      titulo: `Envio ${i + 1}`,
      pedidoEm: r.pedido_em,
      situacao: r.situacao,
      ativo: r.situacao === 'na_fila' || r.situacao === 'rodando',
      rotulo: rotuloDe(r.situacao, numeroCpfl, r.erro),
      numeroCpfl,
      reenvioDe: texto(r.dados?.reenvio_de),
      erro: texto(r.erro),
    };
  });

  const ativo = [...envios].reverse().find(e => e.ativo);
  if (ativo) return { envios, abreSozinho: ativo.runId };

  const ultimo = reais[reais.length - 1];
  if (!ultimo) return { envios, abreSozinho: null };
  const terminou = ultimo.terminado_em ? Date.parse(ultimo.terminado_em) : null;
  const recente = terminou === null || agora - terminou <= ABRE_ATE_MS;
  return { envios, abreSozinho: recente ? ultimo.id : null };
}
