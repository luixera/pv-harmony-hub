import { ProjectWithDetails } from '@/hooks/useProjects';
import { buildProjectValues } from '@/utils/projectValues';
import { ComponentNode, TechnicalJsonMvp } from './types';

/**
 * Projeto → JSON técnico mínimo (fatia vertical).
 *
 * Cadeia fixa PV → Inversor → Disjuntor → Medidor → Rede: cobre a grande
 * maioria dos projetos residenciais/comerciais simples da GD Manager. Não é
 * o grafo elétrico genérico da proposta de arquitetura (§4) — isso é
 * trabalho futuro (motor de layout automático); aqui a topologia já nasce
 * na ordem correta e o layout apenas posiciona em linha (ver layout.ts).
 */
export function buildTechnicalJsonFromProject(project: ProjectWithDetails): TechnicalJsonMvp {
  const values = buildProjectValues(project);
  const e = project.equipment;

  const components: ComponentNode[] = [
    {
      id: 'PV-01',
      kind: 'pv-array',
      label: 'Arranjo FV',
      legend: [
        e?.module_brand || '—',
        e?.module_model || '',
        e?.module_quantity != null ? `${e.module_quantity}x ${e?.module_power ?? '?'} Wp` : '',
      ].filter(Boolean),
    },
    {
      id: 'INV-01',
      kind: 'inverter',
      label: 'Inversor',
      legend: [
        e?.inverter_brand || '—',
        e?.inverter_model || '',
        e?.inverter_power != null ? `${e.inverter_quantity ?? 1}x ${e.inverter_power} kW` : '',
      ].filter(Boolean),
    },
    {
      id: 'CB-01',
      kind: 'breaker',
      label: 'Disjuntor',
      legend: [project.generalData?.circuit_breaker_current ? `${project.generalData.circuit_breaker_current} A` : '—'],
    },
    {
      id: 'MTR-01',
      kind: 'meter',
      label: 'Medidor',
      legend: ['Bidirecional'],
    },
    {
      id: 'GRID-01',
      kind: 'utility-grid',
      label: 'Rede',
      legend: [values.concessionaria || '—'],
    },
  ];

  const connections = components.slice(0, -1).map((c, i) => ({
    id: `C${i + 1}`, from: c.id, to: components[i + 1].id,
  }));

  return {
    documentId: project.id,
    title: {
      projectCode: values.codigo_projeto || '—',
      holderName: values.nome_titular || '—',
      concessionaire: values.concessionaria || '—',
      // `potencia_total` já vem com a unidade ("7,32 kWp") — concatenar de novo
      // duplicava o kWp no carimbo
      installedPower: values.potencia_total || '—',
      date: values.data || '—',
      address: values.endereco || undefined,
    },
    components,
    connections,
  };
}
