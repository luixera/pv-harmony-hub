import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ProjectWithDetails } from '@/hooks/useProjects';

/** Mapa de tags → valores do projeto, usado para preencher templates .docx. */
export function buildProjectValues(project: ProjectWithDetails): Record<string, string> {
  const g = project.generalData ?? ({} as NonNullable<ProjectWithDetails['generalData']>);
  const e = project.equipment ?? ({} as NonNullable<ProjectWithDetails['equipment']>);
  const today = format(new Date(), 'dd/MM/yyyy', { locale: ptBR });

  const endereco_completo = [
    g.address, g.city, g.state, g.cep ? `CEP: ${g.cep}` : '',
  ].filter(Boolean).join(', ');

  return {
    codigo_projeto:    project.code ?? '',
    empresa:           project.companyName ?? '',
    concessionaria:    project.concessionaireName ?? g.utility_company ?? '',
    nome_titular:      g.holder_name ?? '',
    cpf_cnpj:          g.holder_cpf_cnpj ?? '',
    email_titular:     g.holder_email ?? '',
    telefone_titular:  g.holder_phone ?? '',
    endereco:          g.address ?? '',
    cidade:            g.city ?? '',
    estado:            g.state ?? '',
    uf:                g.state ?? '',
    cep:               g.cep ?? '',
    endereco_completo,
    uc:                g.uc_number ?? '',
    numero_uc:         g.uc_number ?? '',
    disjuntor:         g.circuit_breaker_current ?? '',
    fase:              g.phase_type ?? '',
    tipo_fase:         g.phase_type ?? '',
    rural:             g.is_rural ? 'Sim' : 'Não',
    coordenadas:       g.coordinates ?? '',
    marca_inversor:    e.inverter_brand ?? '',
    modelo_inversor:   e.inverter_model ?? '',
    potencia_inversor: e.inverter_power != null ? `${e.inverter_power} kW` : '',
    qtd_inversores:    String(e.inverter_quantity ?? ''),
    marca_modulo:      e.module_brand ?? '',
    modelo_modulo:     e.module_model ?? '',
    potencia_modulo:   e.module_power != null ? `${e.module_power} Wp` : '',
    qtd_modulos:       String(e.module_quantity ?? ''),
    potencia_total:    e.total_installed_power != null ? `${e.total_installed_power} kWp` : '',
    kwp:               String(e.total_installed_power ?? ''),
    data:              today,
    data_emissao:      today,
    data_atual:        today,
    data_criacao:      project.created_at ? format(new Date(project.created_at), 'dd/MM/yyyy', { locale: ptBR }) : today,
  };
}
