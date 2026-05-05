import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useFinancialDashboard } from '@/hooks/useFinancialDashboard';
import { useCompanies } from '@/hooks/useCompanies';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { FinancialReportModal } from '@/components/financial/FinancialReportModal';
import { BarChart, Bar, Tooltip, ResponsiveContainer, Cell, XAxis } from 'recharts';
import { Loader2, FileText, TrendingUp, Wallet, AlertCircle, DollarSign } from 'lucide-react';
import { useWindowSize } from '@/hooks/useWindowSize';
import { formatCurrency } from '@/lib/utils';

const fmt = formatCurrency;

const PAY_STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: 'Pendente',   bg: '#FEF3D0', color: '#854F0B' },
  partial: { label: 'Parc. Pago', bg: '#E6F1FB', color: '#185FA5' },
  paid:    { label: 'Quitado',    bg: '#E1F5EE', color: '#0F6E56' },
};
const COMPANY_COLORS = ['#F5A800','#378ADD','#2D6A4F','#D85A30','#9B59B6','#1ABC9C','#E74C3C','#3498DB'];

// ── Hero KPI Block ────────────────────────────────────────────────────────────
function KpiBlock({
  label, value, sub, barPct, barColor, icon: Icon,
}: {
  label: string; value: string; sub?: string;
  barPct: number; barColor: string;
  icon: React.ElementType;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} color={barColor === '#fff' ? 'rgba(255,255,255,0.7)' : barColor} />
        </div>
        <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>{label}</p>
      </div>
      <p style={{
        fontSize: 22, fontWeight: 800, margin: '0 0 4px',
        color: barColor === '#4CAF7D' ? '#4CAF7D'
             : barColor === '#FF6B6B' ? '#FF6B6B'
             : barColor === '#F5A800' ? '#F5A800'
             : '#fff',
        lineHeight: 1,
      }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: '0 0 10px' }}>{sub}</p>}
      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: sub ? 0 : 10 }}>
        <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, barPct))}%`, background: barColor, borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

export default function Financial() {
  const { data, isLoading } = useFinancialDashboard();
  const { data: companies = [] } = useCompanies();
  const { isMobile, isTablet } = useWindowSize();

  const [companyFilter, setCompanyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const projetos = data?.projetos || [];
  const kpis = data?.kpis;
  const porEmpresa = data?.porEmpresa || [];
  const porStatus = data?.porStatus || [];

  const filteredProjetos = useMemo(() => projetos.filter(p => {
    if (companyFilter !== 'all' && p.companyId !== companyFilter) return false;
    if (statusFilter !== 'all' && p.paymentStatus !== statusFilter) return false;
    return true;
  }), [projetos, companyFilter, statusFilter]);

  const totalAberto = filteredProjetos.reduce((s, p) => s + p.balance, 0);
  const recebidoPct = kpis?.totalFaturado ? (kpis.totalRecebido / kpis.totalFaturado) * 100 : 0;
  const abertoPct   = kpis?.totalFaturado ? (kpis.totalAberto   / kpis.totalFaturado) * 100 : 0;
  const vencidoPct  = kpis?.totalFaturado ? ((kpis?.totalVencido || 0) / kpis.totalFaturado) * 100 : 0;

  if (isLoading) {
    return (
      <MainLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Loader2 size={32} className="animate-spin" style={{ color: '#F5A800' }} />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div style={{ padding: isMobile ? '0 4px' : '0 2px' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Financeiro</h1>
          <p style={{ fontSize: 13, color: '#999', margin: '4px 0 0' }}>Controle de faturamento e recebíveis</p>
        </div>

        {/* ── Hero KPI ── */}
        <div style={{ background: '#1A1A1A', borderRadius: 14, padding: isMobile ? '20px 18px' : '24px 28px', marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>Resumo Financeiro</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>Todos os projetos · atualizado agora</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: isMobile ? 20 : 32 }}>
            <KpiBlock
              label="Total Faturado"
              value={fmt(kpis?.totalFaturado || 0)}
              sub={`${projetos.length} projetos`}
              barPct={100}
              barColor="#F5A800"
              icon={DollarSign}
            />
            <KpiBlock
              label="Total Recebido"
              value={fmt(kpis?.totalRecebido || 0)}
              sub={`${recebidoPct.toFixed(0)}% do total`}
              barPct={recebidoPct}
              barColor="#4CAF7D"
              icon={TrendingUp}
            />
            <KpiBlock
              label="Em Aberto"
              value={fmt(kpis?.totalAberto || 0)}
              sub={`${abertoPct.toFixed(0)}% do total`}
              barPct={abertoPct}
              barColor="#F5A800"
              icon={Wallet}
            />
            <KpiBlock
              label="Vencido"
              value={fmt(kpis?.totalVencido || 0)}
              sub={`${vencidoPct.toFixed(0)}% do total`}
              barPct={vencidoPct}
              barColor="#FF6B6B"
              icon={AlertCircle}
            />
          </div>
        </div>

        {/* ── Grid principal ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isTablet ? '1fr' : '340px 1fr', gap: 16, alignItems: 'start' }}>

          {/* ── Coluna esquerda ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Card Gráfico por status */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #EFEFEF', padding: '18px 20px' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', marginBottom: 4 }}>Em aberto por status</p>
              <p style={{ fontSize: 11, color: '#999', marginBottom: 14 }}>Saldo pendente por etapa</p>
              {porStatus.length === 0 ? (
                <p style={{ fontSize: 12, color: '#ccc', textAlign: 'center', padding: '28px 0' }}>Sem dados pendentes</p>
              ) : (
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={porStatus} barSize={28} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value: number) => [fmt(value), 'Em aberto']}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #F0F0F0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    />
                    <Bar dataKey="balance" radius={[4, 4, 0, 0]}>
                      {porStatus.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Card Por empresa */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #EFEFEF', padding: '18px 20px' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', marginBottom: 4 }}>Em aberto por empresa</p>
              <p style={{ fontSize: 11, color: '#999', marginBottom: 14 }}>Valor pendente por integrador</p>
              {porEmpresa.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: 6 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#E1F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 18 }}>✓</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#2D6A4F', fontWeight: 600 }}>Tudo quitado</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {porEmpresa.map((e, i) => {
                    const pct = porEmpresa[0]?.balance ? (e.balance / porEmpresa[0].balance) * 100 : 0;
                    return (
                      <div key={e.companyId}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: COMPANY_COLORS[i % COMPANY_COLORS.length], flexShrink: 0 }} />
                          <p style={{ flex: 1, fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{e.companyName}</p>
                          <p style={{ fontSize: 12, fontWeight: 700, color: '#D85A30', margin: 0, flexShrink: 0 }}>{fmt(e.balance)}</p>
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: '#F0F0F0', overflow: 'hidden', marginLeft: 20 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: COMPANY_COLORS[i % COMPANY_COLORS.length], borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Card Extrato PDF */}
            <div style={{ background: 'linear-gradient(135deg, #1A1A1A 0%, #2D2D2D 100%)', borderRadius: 12, padding: '20px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: '#F5A800', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FileText size={17} color="#1A1A1A" />
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0 }}>Extrato Financeiro PDF</p>
                  <p style={{ fontSize: 10, color: '#F5A800', margin: 0 }}>Relatório personalizado</p>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 16, lineHeight: 1.6 }}>
                Filtre por empresa, status e período e gere extratos profissionais para seus clientes
              </p>
              <button
                onClick={() => setShowReport(true)}
                style={{ width: '100%', padding: '11px 0', borderRadius: 9, background: '#F5A800', border: 'none', color: '#1A1A1A', fontWeight: 700, fontSize: 13, cursor: 'pointer', letterSpacing: '0.01em' }}
              >
                Gerar Extrato
              </button>
            </div>
          </div>

          {/* ── Coluna direita — Projetos em Aberto ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #EFEFEF', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* Header */}
            <div style={{ padding: '16px 20px', background: '#FAFAFA', borderBottom: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Projetos em Aberto</p>
                <p style={{ fontSize: 11, color: '#999', margin: '2px 0 0' }}>Clique para ver detalhes</p>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: '#FEF3D0', color: '#854F0B' }}>
                {filteredProjetos.filter(p => p.paymentStatus !== 'paid').length} pendentes
              </span>
            </div>

            {/* Filters */}
            <div style={{ padding: '12px 16px', background: '#F8F8F8', borderBottom: '1px solid #F0F0F0', display: 'flex', gap: 10 }}>
              <select
                value={companyFilter}
                onChange={e => setCompanyFilter(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #E8E8E8', fontSize: 12, background: '#fff', outline: 'none', color: '#333' }}
              >
                <option value="all">Todas as empresas</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #E8E8E8', fontSize: 12, background: '#fff', outline: 'none', color: '#333' }}
              >
                <option value="all">Todos os status</option>
                <option value="pending">Pendente</option>
                <option value="partial">Parc. Pago</option>
                <option value="paid">Quitado</option>
              </select>
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filteredProjetos.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 8 }}>
                  <p style={{ fontSize: 13, color: '#ccc', margin: 0 }}>Nenhum projeto encontrado</p>
                </div>
              ) : (
                filteredProjetos.map(p => {
                  const ps = PAY_STATUS_LABELS[p.paymentStatus] || PAY_STATUS_LABELS.pending;
                  const today = new Date().toISOString().split('T')[0];
                  const isOverdue = p.paymentStatus !== 'paid' && p.dueDate && p.dueDate < today;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setModalProjectId(p.id)}
                      style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '13px 20px', border: 'none', background: 'none', borderBottom: '1px solid #F8F8F8', cursor: 'pointer', textAlign: 'left', gap: 14 }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {/* Color dot */}
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: ps.color, flexShrink: 0, opacity: 0.8 }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0, fontFamily: 'monospace' }}>{p.code}</p>
                          {isOverdue && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: '#FEE2E2', color: '#E24B4A' }}>VENCIDO</span>
                          )}
                        </div>
                        <p style={{ fontSize: 12, color: '#555', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.holderName}</p>
                        <p style={{ fontSize: 11, color: '#aaa', margin: '2px 0 0' }}>{p.companyName}</p>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 700, color: p.paymentStatus === 'paid' ? '#2D6A4F' : '#D85A30', margin: 0 }}>
                          {p.paymentStatus === 'paid' ? 'Quitado' : fmt(p.balance)}
                        </p>
                        {p.dueDate && (
                          <p style={{ fontSize: 10, color: isOverdue ? '#E24B4A' : '#aaa', margin: '2px 0 4px' }}>
                            Venc. {new Date(p.dueDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                          </p>
                        )}
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: ps.bg, color: ps.color }}>
                          {ps.label}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', background: '#FAFAFA', borderTop: '1px solid #F0F0F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 12, color: '#999', margin: 0 }}>{filteredProjetos.length} projetos listados</p>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, color: '#aaa', margin: '0 0 1px' }}>Total em aberto</p>
                <p style={{ fontSize: 15, fontWeight: 800, color: '#D85A30', margin: 0 }}>{fmt(totalAberto)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Project Modal */}
      {modalProjectId && (
        <ProjectModal projectId={modalProjectId} onClose={() => setModalProjectId(null)} />
      )}

      {/* Report Modal */}
      {showReport && (
        <FinancialReportModal onClose={() => setShowReport(false)} />
      )}
    </MainLayout>
  );
}
