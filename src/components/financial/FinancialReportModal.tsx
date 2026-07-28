import { useState, useRef, useCallback } from 'react';
import { useCompanies } from '@/hooks/useCompanies';
import { useFinancialReport, FinancialReportFilters } from '@/hooks/useFinancialReport';
import { useWindowSize } from '@/hooks/useWindowSize';
import { PROJECT_STATUS_LABELS, VALID_PROJECT_STATUSES } from '@/lib/statusMapping';
import { formatCurrency } from '@/lib/utils';
import { X, Download, Printer, Loader2, SlidersHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmt = formatCurrency;

// Etapas: usa a lista canônica do projeto (statusMapping) — antes esta tela
// tinha uma cópia própria SEM "Pendência" e "Vistoria Solicitada", então esses
// projetos não podiam ser filtrados e apareciam com o código cru no extrato.
const STATUS_OPTIONS = VALID_PROJECT_STATUSES;
const STATUS_LABELS = PROJECT_STATUS_LABELS;
const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  pending:             { bg: '#F0F0F0', color: '#666' },
  analysis:            { bg: '#E6F1FB', color: '#185FA5' },
  documentation:       { bg: '#FEF3D0', color: '#854F0B' },
  approval:            { bg: '#FEF3D0', color: '#854F0B' },
  approved:            { bg: '#E1F5EE', color: '#0F6E56' },
  pendencia:           { bg: '#FDE7E3', color: '#B23A1B' },
  vistoria_solicitada: { bg: '#EDE7FB', color: '#5B3BA8' },
  completed:           { bg: '#1A1A1A', color: '#F5A800' },
};
const PAY_LABELS: Record<string, string> = {
  pending: 'Pendente', partial: 'Parc. Pago', paid: 'Quitado',
};

interface FinancialReportModalProps {
  onClose: () => void;
}

export function FinancialReportModal({ onClose }: FinancialReportModalProps) {
  const { data: companies = [] } = useCompanies();
  const { isMobile, isTablet } = useWindowSize();
  const previewRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showFilters, setShowFilters] = useState(false); // mobile filter toggle

  const [filters, setFilters] = useState<FinancialReportFilters>({});
  const [applied, setApplied] = useState<FinancialReportFilters>({});

  // Local form state — `statuses` é multi-seleção (lista vazia = todas as etapas)
  const [form, setForm] = useState<{
    companyId: string; statuses: string[]; paymentStatus: string; dateFrom: string; dateTo: string;
  }>({
    companyId: '', statuses: [], paymentStatus: '', dateFrom: '', dateTo: '',
  });

  const toggleStatus = (status: string) => setForm(f => ({
    ...f,
    statuses: f.statuses.includes(status)
      ? f.statuses.filter(s => s !== status)
      : [...f.statuses, status],
  }));

  const { rows, summary, isLoading } = useFinancialReport(applied);

  const applyFilters = () => {
    const f: FinancialReportFilters = {};
    if (form.companyId) f.companyId = form.companyId;
    if (form.statuses.length) f.statuses = form.statuses;
    if (form.paymentStatus) f.paymentStatus = form.paymentStatus;
    if (form.dateFrom) f.dateFrom = form.dateFrom;
    if (form.dateTo) f.dateTo = form.dateTo;
    setApplied(f);
  };

  const clearFilters = () => {
    setForm({ companyId: '', statuses: [], paymentStatus: '', dateFrom: '', dateTo: '' });
    setApplied({});
  };

  // Active filter chips
  const activeChips: { key: string; label: string }[] = [];
  if (applied.companyId) {
    const c = companies.find(x => x.id === applied.companyId);
    if (c) activeChips.push({ key: 'companyId', label: c.name });
  }
  // uma tarja por etapa: o extrato tem de deixar explícito o recorte usado
  for (const s of applied.statuses ?? []) {
    activeChips.push({ key: `status-${s}`, label: STATUS_LABELS[s] ?? s });
  }
  if (applied.paymentStatus) activeChips.push({ key: 'paymentStatus', label: PAY_LABELS[applied.paymentStatus] });
  if (applied.dateFrom) activeChips.push({ key: 'dateFrom', label: `De: ${applied.dateFrom}` });
  if (applied.dateTo) activeChips.push({ key: 'dateTo', label: `Até: ${applied.dateTo}` });

  const companyLabel = applied.companyId ? companies.find(c => c.id === applied.companyId)?.name || 'empresa' : 'todas';
  const todayLabel = format(new Date(), 'ddMMyyyy');
  const fileName = `Extrato_AllEnergy_${companyLabel}_${todayLabel}.pdf`;

  const handleDownloadPDF = useCallback(async () => {
    if (!previewRef.current) return;
    setIsGenerating(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');

      const canvas = await html2canvas(previewRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#fff',
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      // If content is taller than one A4 page, add pages
      const pageHeight = pdf.internal.pageSize.getHeight();
      let yOffset = 0;
      while (yOffset < pdfHeight) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -yOffset, pdfWidth, pdfHeight);
        yOffset += pageHeight;
      }

      pdf.save(fileName);
    } finally {
      setIsGenerating(false);
    }
  }, [fileName]);

  const handlePrint = () => {
    if (!previewRef.current) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><title>Extrato Financeiro</title>
      <style>body{margin:0;font-family:sans-serif;} @media print{*{-webkit-print-color-adjust:exact !important;}}</style>
      </head><body>${previewRef.current.outerHTML}</body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0',
    fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#888', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: 4, display: 'block',
  };

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(26,26,26,0.65)', backdropFilter: 'blur(2px)' }} />

      {/* Modal */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1101, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 0 : '20px 16px' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={{ background: '#fff', borderRadius: isMobile ? 0 : 14, width: '100%', maxWidth: isMobile ? '100%' : 900, maxHeight: isMobile ? '100%' : '90vh', height: isMobile ? '100%' : undefined, display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.35)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div style={{ background: '#1A1A1A', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>Extrato Financeiro de Projetos</p>
              <p style={{ fontSize: 10, color: '#F5A800', margin: '2px 0 0' }}>Pré-visualização antes do download</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isTablet && (
                <button
                  onClick={() => setShowFilters(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: showFilters ? '#F5A800' : 'rgba(255,255,255,0.08)', color: showFilters ? '#1A1A1A' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >
                  <SlidersHorizontal size={13} /> Filtros
                </button>
              )}
              <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer' }}>
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, display: 'flex', flexDirection: isTablet ? 'column' : 'row', minHeight: 0, overflow: 'hidden' }}>

            {/* Left: Filters — collapsed on mobile/tablet behind toggle */}
            <div style={{
              width: isTablet ? '100%' : 280,
              maxHeight: isTablet ? (showFilters ? 400 : 0) : undefined,
              flexShrink: 0,
              background: '#FAFAFA',
              borderRight: isTablet ? 'none' : '0.5px solid #F0F0F0',
              borderBottom: isTablet && showFilters ? '0.5px solid #F0F0F0' : undefined,
              padding: isTablet ? (showFilters ? 16 : 0) : 16,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: isTablet ? 'row' : 'column',
              flexWrap: isTablet ? 'wrap' : undefined,
              gap: 14,
              transition: 'max-height 0.3s ease, padding 0.3s ease',
            }}>
              {!isTablet && <p style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, width: '100%' }}>Filtros</p>}

              <div style={{ flex: isTablet ? '1 1 200px' : undefined }}>
                <label style={labelStyle}>Empresa</label>
                <select value={form.companyId} onChange={e => setForm(f => ({ ...f, companyId: e.target.value }))} style={inputStyle}>
                  <option value="">Todas as empresas</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Etapas: multi-seleção. Um extrato normalmente junta etapas
                  diferentes (aprovado + vistoria solicitada + concluído ainda
                  em aberto), então cada etapa é um botão que liga/desliga. */}
              <div style={{ flex: isTablet ? '1 1 240px' : undefined }}>
                <label style={labelStyle}>
                  Etapas do projeto
                  {form.statuses.length > 0 && (
                    <span style={{ color: '#B87A20', marginLeft: 5 }}>({form.statuses.length} selecionadas)</span>
                  )}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {STATUS_OPTIONS.map(k => {
                    const on = form.statuses.includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleStatus(k)}
                        aria-pressed={on}
                        style={{
                          padding: '5px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                          cursor: 'pointer', lineHeight: 1.2,
                          border: on ? '1px solid #F5A800' : '1px solid #E0E0E0',
                          background: on ? '#FEF3D0' : '#fff',
                          color: on ? '#854F0B' : '#777',
                        }}
                      >
                        {STATUS_LABELS[k]}
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: 10, color: '#aaa', margin: '5px 0 0' }}>
                  {form.statuses.length === 0
                    ? 'Nenhuma marcada = todas as etapas entram no extrato.'
                    : 'Só as etapas marcadas entram no extrato.'}
                </p>
              </div>

              <div style={{ flex: isTablet ? '1 1 160px' : undefined }}>
                <label style={labelStyle}>Status pagamento</label>
                <select value={form.paymentStatus} onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value }))} style={inputStyle}>
                  <option value="">Todos</option>
                  <option value="pending">Pendente</option>
                  <option value="partial">Parcial</option>
                  <option value="paid">Quitado</option>
                </select>
              </div>

              <div style={{ flex: isTablet ? '1 1 140px' : undefined }}>
                <label style={labelStyle}>Data inicial</label>
                <input type="date" value={form.dateFrom} onChange={e => setForm(f => ({ ...f, dateFrom: e.target.value }))} style={inputStyle} />
              </div>

              <div style={{ flex: isTablet ? '1 1 140px' : undefined }}>
                <label style={labelStyle}>Data final</label>
                <input type="date" value={form.dateTo} onChange={e => setForm(f => ({ ...f, dateTo: e.target.value }))} style={inputStyle} defaultValue={new Date().toISOString().split('T')[0]} />
              </div>

              <div style={{ flex: isTablet ? '0 0 auto' : undefined, display: 'flex', flexDirection: isTablet ? 'row' : 'column', gap: 8, alignSelf: isTablet ? 'flex-end' : undefined }}>
                <button onClick={applyFilters} style={{ padding: isTablet ? '9px 16px' : '9px 0', width: isTablet ? 'auto' : '100%', borderRadius: 7, background: '#F5A800', border: 'none', color: '#1A1A1A', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  Aplicar
                </button>
                <button onClick={clearFilters} style={{ padding: isTablet ? '8px 12px' : '8px 0', width: isTablet ? 'auto' : '100%', borderRadius: 7, background: 'none', border: '0.5px solid #E0E0E0', color: '#888', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                  Limpar
                </button>
              </div>
            </div>

            {/* Right: Preview */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#F4F4F4' }}>
              {isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <Loader2 size={24} className="animate-spin" style={{ color: '#F5A800' }} />
                </div>
              ) : (
                <div ref={previewRef} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>

                  {/* Preview Header */}
                  <div style={{ background: '#1A1A1A', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src="/logo.png" alt="Logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0 }}>All Energy Engenharia</p>
                        <p style={{ fontSize: 10, color: '#F5A800', margin: 0 }}>Engenharia Solar</p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', margin: 0 }}>Extrato Financeiro de Projetos</p>
                      <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', margin: '2px 0 0' }}>
                        Gerado em {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>

                  <div style={{ padding: '14px 18px' }}>
                    {/* Active filter chips */}
                    {activeChips.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                        {activeChips.map(chip => (
                          <span key={chip.key} style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#FEF3D0', color: '#854F0B' }}>{chip.label}</span>
                        ))}
                      </div>
                    )}

                    {/* Summary cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                      <div style={{ background: '#F8F8F8', borderRadius: 7, padding: '10px 12px', border: '0.5px solid #EFEFEF' }}>
                        <p style={{ fontSize: 9, color: '#999', margin: '0 0 4px' }}>Total dos Projetos</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{fmt(summary.totalValue)}</p>
                      </div>
                      <div style={{ background: '#F8F8F8', borderRadius: 7, padding: '10px 12px', border: '0.5px solid #EFEFEF' }}>
                        <p style={{ fontSize: 9, color: '#999', margin: '0 0 4px' }}>Total Pago</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: '#2D6A4F', margin: 0 }}>{fmt(summary.totalPaid)}</p>
                      </div>
                      <div style={{ background: '#FEF3D0', borderRadius: 7, padding: '10px 12px', border: '0.5px solid #F5A800' }}>
                        <p style={{ fontSize: 9, color: '#B87A20', margin: '0 0 4px' }}>Saldo em Aberto</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: '#F5A800', margin: 0 }}>{fmt(summary.totalBalance)}</p>
                      </div>
                    </div>

                    {/* Table */}
                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
                    <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead>
                        <tr style={{ background: '#F8F8F8' }}>
                          {['Código', 'Cliente', 'Concessionária', 'Status', 'Valor Total', 'Valor Pago', 'Saldo'].map(col => (
                            <th key={col} style={{ padding: '7px 8px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #F0F0F0' }}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr><td colSpan={7} style={{ padding: '24px 8px', textAlign: 'center', color: '#aaa', fontSize: 12 }}>Nenhum projeto encontrado com os filtros selecionados</td></tr>
                        ) : (
                          rows.map((row, i) => {
                            const assinatura = row.kind === 'subscription';
                            const sb = assinatura
                              ? { bg: '#FEF3D0', color: '#854F0B' }
                              : STATUS_BADGE[row.status] || STATUS_BADGE.pending;
                            return (
                              <tr key={row.id} style={{ background: assinatura ? '#FFFBF0' : i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                                <td style={{ padding: '7px 8px', fontWeight: 700, color: '#1A1A1A', fontFamily: 'monospace' }}>{row.code}</td>
                                <td style={{ padding: '7px 8px', color: '#555', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.holderName}</td>
                                <td style={{ padding: '7px 8px', color: '#555' }}>{row.concessionaireName}</td>
                                <td style={{ padding: '7px 8px' }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: sb.bg, color: sb.color }}>
                                    {assinatura ? 'Assinatura' : STATUS_LABELS[row.status] || row.status}
                                  </span>
                                </td>
                                <td style={{ padding: '7px 8px', color: '#333', fontWeight: 600 }}>{fmt(row.projectValue)}</td>
                                <td style={{ padding: '7px 8px', color: '#2D6A4F', fontWeight: 600 }}>{fmt(row.paidValue)}</td>
                                <td style={{ padding: '7px 8px', fontWeight: 700, color: row.balance === 0 ? '#2D6A4F' : '#D85A30' }}>
                                  {row.balance === 0 ? 'Quitado' : fmt(row.balance)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                        {/* Totals row */}
                        {rows.length > 0 && (
                          <tr style={{ background: '#1A1A1A' }}>
                            <td colSpan={4} style={{ padding: '8px 8px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
                              Total — {summary.totalProjects} projetos
                              {rows.length - summary.totalProjects > 0
                                ? ` + ${rows.length - summary.totalProjects} mensalidade(s)`
                                : ''}
                            </td>
                            <td style={{ padding: '8px 8px', fontSize: 11, fontWeight: 700, color: '#F5A800' }}>{fmt(summary.totalValue)}</td>
                            <td style={{ padding: '8px 8px', fontSize: 11, fontWeight: 700, color: '#4CAF7D' }}>{fmt(summary.totalPaid)}</td>
                            <td style={{ padding: '8px 8px', fontSize: 11, fontWeight: 700, color: '#FF6B6B' }}>{fmt(summary.totalBalance)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    </div>

                    {/* Footer */}
                    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '2px solid #F5A800', textAlign: 'center' }}>
                      <p style={{ fontSize: 10, color: '#888', margin: 0 }}>All Energy Engenharia · GD Manager</p>
                      <p style={{ fontSize: 9, color: '#aaa', margin: '2px 0 0' }}>
                        {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ background: '#FAFAFA', borderTop: '0.5px solid #F0F0F0', padding: '12px 16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: '#888', flex: 1, minWidth: 140, margin: 0 }}>
              {summary.totalProjects} projetos · Total: {fmt(summary.totalValue)}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handlePrint}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 7, border: '0.5px solid #E0E0E0', background: '#fff', color: '#555', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
              >
                <Printer size={13} /> Imprimir
              </button>
              <button
                onClick={handleDownloadPDF}
                disabled={isGenerating || rows.length === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 7, border: 'none', background: rows.length > 0 ? '#F5A800' : '#E0E0E0', color: rows.length > 0 ? '#1A1A1A' : '#999', fontWeight: 700, fontSize: 12, cursor: rows.length > 0 ? 'pointer' : 'default' }}
              >
                {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {isGenerating ? 'Gerando...' : 'Download PDF'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

