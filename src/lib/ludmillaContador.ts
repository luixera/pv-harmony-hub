/**
 * O CONTADOR DA LUDMILLA — função pura, sem React.
 *
 * Decisão do usuário (22/10/2026, plano `2026-10-22-ludmilla-pagina-decidir`,
 * decisão 9): o número que a barra lateral mostra conta TUDO que pede uma pessoa —
 * recomendações pendentes + A fazer abertos — e a aba "Decidir" conta o mesmo. Quem
 * decide o que é "pendente" é `contarPendentes` (ludmillaCaixa.ts); aqui só se monta
 * a entrada dela. As contas, os nomes e os rótulos de etapa não entram na soma,
 * então o contador não precisa carregar nada além dos dois pendentes.
 */
import type { PortalUpdate } from '@/hooks/useLudmilla';
import { contarPendentes, itensDaCaixa, type Afazer } from '@/lib/ludmillaCaixa';

export interface ContagemDaLudmilla {
  /** recomendações pendentes + A fazer abertos */
  total: number;
  /** o mesmo total, por conta (concessionária) */
  porConta: Record<string, number>;
}

/**
 * `ocultos` = chaves (`u:<id>`/`f:<id>`) de decisões esperando o "Desfazer", como na
 * aba; a barra lateral não os conhece e conta tudo que o banco ainda diz pendente.
 */
export function contagemDaLudmilla(
  updates: PortalUpdate[], afazeres: Afazer[], ocultos: ReadonlySet<string> = new Set(),
): ContagemDaLudmilla {
  const itens = itensDaCaixa({
    updates, afazeres, contas: [], nomeDaConta: () => '', rotuloEtapa: () => '',
  });
  return contarPendentes(itens, ocultos);
}
