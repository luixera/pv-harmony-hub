import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ProjectWithDetails } from '@/hooks/useProjects';

const GOLD = '#F5A800';
const DARK = '#1A1A1A';

/**
 * Gera a cartilha RESUMO do projeto em PDF (jsPDF), com Titular/UC, endereço,
 * equipamentos, localização e protocolo. Sem comentários e sem financeiro.
 */
export async function generateResumoPdf(project: ProjectWithDetails): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf');
  const g = project.generalData;
  const e = project.equipment;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = 0;

  // Cabeçalho
  doc.setFillColor(DARK); doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor(GOLD); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('RESUMO DO PROJETO', margin, 12);
  doc.setTextColor('#FFFFFF'); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${project.code}  ·  ${project.concessionaireName ?? ''}`, margin, 19);
  doc.setFontSize(8); doc.setTextColor('#B0B0B0');
  doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, W - margin, 12, { align: 'right' });
  y = 34;

  const section = (title: string) => {
    doc.setFillColor('#FEF3D0'); doc.rect(margin, y, W - margin * 2, 7, 'F');
    doc.setTextColor('#854F0B'); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(title.toUpperCase(), margin + 2, y + 5);
    y += 11;
  };
  const row = (label: string, value: string) => {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.setTextColor('#888888'); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(label.toUpperCase(), margin, y);
    doc.setTextColor(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    const lines = doc.splitTextToSize(value || '—', W - margin * 2 - 52);
    doc.text(lines, margin + 52, y);
    y += Math.max(6, lines.length * 5);
  };

  // Titular e UC
  section('Titular e Unidade Consumidora');
  row('Titular', g?.holder_name ?? '');
  row('CPF / CNPJ', g?.holder_cpf_cnpj ?? '');
  row('Número UC', g?.uc_number ?? '');
  row('Telefone', g?.holder_phone ?? '');
  row('E-mail', g?.holder_email ?? '');
  row('Disjuntor (A)', g?.circuit_breaker_current ?? '');
  row('Fase', g?.phase_type ?? '');

  // Endereço
  y += 2; section('Endereço');
  row('Endereço', [g?.address, g?.address_number && `Nº ${g.address_number}`, g?.address_complement]
    .filter(Boolean).join(', '));
  row('Bairro', g?.neighborhood ?? '');
  row('Cidade / UF', [g?.city, g?.state].filter(Boolean).join(' / '));
  row('CEP', g?.cep ?? '');
  row('Área rural', g?.is_rural ? 'Sim' : 'Não');

  // Equipamentos
  y += 2; section('Equipamentos');
  row('Inversor', [e?.inverter_brand, e?.inverter_model].filter(Boolean).join(' '));
  row('Pot. inversor', e?.inverter_power != null ? `${e.inverter_power} kW × ${e?.inverter_quantity ?? 1}` : '');
  row('Módulos', [e?.module_brand, e?.module_model].filter(Boolean).join(' '));
  row('Pot. módulo', e?.module_power != null ? `${e.module_power} Wp × ${e?.module_quantity ?? ''}` : '');
  row('Potência total', e?.total_installed_power != null ? `${e.total_installed_power} kWp` : '');

  // Localização
  y += 2; section('Localização e Protocolo');
  row('Coordenadas', g?.coordinates ?? '');
  row('Protocolo', project.protocol_number ?? '—');

  // Rodapé
  doc.setTextColor('#AAAAAA'); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text(`${project.companyName ?? ''} · GD Manager`, margin, 290);

  return doc.output('blob');
}
