import { useMemo } from 'react';
import { useDefaultKanbanModel } from '@/hooks/useKanbanConfig';
import { projectStatusLabel } from '@/lib/statusMapping';

/**
 * Rótulo da etapa do projeto — **sempre o nome da coluna do Kanban**.
 *
 * O catálogo `PROJECT_STATUS_LABELS` é só um fallback: ele traz o nome de
 * fábrica ("Documentação", "Aguardando Aprovação"), e quem renomeia a coluna
 * no Kanban espera ver o nome novo em TODA tela. Enquanto cada tela traduzia
 * o status por conta própria, o mesmo projeto aparecia como "Documentação" no
 * relatório e "Em desenvolvimento" no quadro (relato do usuário, set/2026).
 *
 * Uso:
 *   const rotulo = useStatusLabel();
 *   rotulo(project.status)   // "ENVIADO - EM ANÁLISE"
 *
 * `ordemDaEtapa` devolve a posição da coluna no quadro, para listas e
 * gráficos saírem na ordem do fluxo em vez de alfabética.
 */
export function useStatusLabel() {
  const { data: model } = useDefaultKanbanModel();

  return useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of model?.columns ?? []) mapa.set(c.status_key, c.status_label);
    const fn = (status: string | null | undefined) =>
      (status ? mapa.get(status) : undefined) ?? projectStatusLabel(status);
    return fn;
  }, [model]);
}

/** Cor da coluna do Kanban para a etapa (para gráficos e selos). */
export function useStatusColor() {
  const { data: model } = useDefaultKanbanModel();
  return useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of model?.columns ?? []) if (c.color) mapa.set(c.status_key, c.color);
    return (status: string | null | undefined) => (status ? mapa.get(status) : undefined);
  }, [model]);
}

/** Etapas do quadro na ordem do fluxo — `status_key` e rótulo juntos. */
export function useStatusOrder() {
  const { data: model } = useDefaultKanbanModel();
  return useMemo(
    () => (model?.columns ?? []).map(c => ({ key: c.status_key, label: c.status_label, color: c.color })),
    [model],
  );
}
