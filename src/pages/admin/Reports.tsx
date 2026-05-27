import { Loader2, BarChart2, CheckCircle2, Clock, Zap, Users, Building2, TrendingUp, DollarSign, Activity } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { MainLayout } from '@/components/layout/MainLayout'
import { useReports } from '@/hooks/useReports'
import { useReportFilters } from '@/hooks/useReportFilters'
import { useCompanies } from '@/hooks/useCompanies'
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires'
import { useUsers } from '@/hooks/useUsers'
import { ReportFilterBar } from '@/components/reports/ReportFilterBar'
import { ReportBarChart } from '@/components/reports/ReportBarChart'
import { ReportTicketChart } from '@/components/reports/ReportTicketChart'
import { ReportFunnel } from '@/components/reports/ReportFunnel'
import { ReportDonut } from '@/components/reports/ReportDonut'
import { ReportRanking } from '@/components/reports/ReportRanking'
import { ReportStageTimes } from '@/components/reports/ReportStageTimes'
import { ReportKpiHero } from '@/components/reports/ReportKpiHero'
import { ReportKpiCard } from '@/components/reports/ReportKpiCard'
import { ReportKpiSecondary } from '@/components/reports/ReportKpiSecondary'

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0)

const formatCurrencyShort = (v: number) => {
  if (v >= 1000000) return `R$${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `R$${(v / 1000).toFixed(0)}k`
  return formatCurrency(v)
}

const PERIOD_OPTIONS: { key: '7d' | '30d' | '3m' | '6m' | '1a'; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '3m', label: '3m' },
  { key: '6m', label: '6m' },
  { key: '1a', label: '1a' },
]

function calcVariation(current: number, previous: number): number {
  if (previous === 0) return 0
  return Math.round(((current - previous) / previous) * 100)
}

function CardShell({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        border: '0.5px solid #EBEBEB',
        padding: 16,
        ...style,
      }}
    >
      {title && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#1A1A1A', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

export default function Reports() {
  const { filters, setFilter, clearFilter, clearAll, setPeriod, activeCount } = useReportFilters()

  const { data: reportData, isLoading } = useReports(filters)
  const { data: companies = [] } = useCompanies()
  const { data: concessionaires = [] } = useEnergyConcessionaires(true)
  const { data: users = [] } = useUsers()

  const staffList = users.filter((u) => u.role === 'staff' || u.role === 'admin')

  const kpis = reportData?.kpis
  const monthly = reportData?.monthly || []

  // Build filter options with project counts from reportData
  const companyCountMap = new Map(
    (reportData?.companyRanking || []).map((c) => [c.id, c.projects])
  )
  const concCountMap = new Map(
    (reportData?.concessionaires || []).map((c) => [c.id, c.count])
  )
  const staffCountMap = new Map(
    (reportData?.staffRanking || []).map((s) => [s.id, s.projects])
  )

  const companyOptions = companies.map((c) => ({
    id: c.id,
    name: c.name,
    count: companyCountMap.get(c.id),
  }))
  const concessionaireOptions = concessionaires.map((c) => ({
    id: c.id,
    name: c.name,
    count: concCountMap.get(c.id),
  }))
  const staffOptions = staffList.map((s) => ({
    id: s.id,
    name: s.name,
    count: staffCountMap.get(s.id),
  }))

  const fatVariation = calcVariation(kpis?.totalFaturamento || 0, kpis?.faturamentoAnterior || 0)
  const projVariation = calcVariation(kpis?.totalProjetos || 0, kpis?.projetosAnterior || 0)
  const ticketVariation = calcVariation(kpis?.ticketMedio || 0, kpis?.ticketAnterior || 0)
  const conclusaoVariation = calcVariation(kpis?.taxaConclusao || 0, kpis?.conclusaoAnterior || 0)

  const activeFilterLabel = filters.companyId
    ? companies.find((c) => c.id === filters.companyId)?.name || null
    : filters.staffId
    ? staffList.find((s) => s.id === filters.staffId)?.name || null
    : null

  // Spark data from monthly
  const sparkFat = monthly.map((m) => m.faturado)
  const sparkProj = monthly.map((m) => m.novos)

  const totalStageDays = (reportData?.stageTimes || []).reduce((acc, s) => acc + s.days, 0)

  if (isLoading) {
    return (
      <MainLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div
        style={{
          background: '#F2F2F0',
          margin: '-24px',
          padding: '18px',
          minHeight: 'calc(100vh - 64px)',
        }}
      >
        {/* ── HEADER ── */}
        <div
          className="export-btn-hide-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                background: '#1A1A1A',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <BarChart2 size={20} color="#F5A800" />
            </div>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#1A1A1A', lineHeight: 1.1 }}>Relatórios</div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                {activeFilterLabel
                  ? `${activeFilterLabel} · Dados filtrados`
                  : 'All Energy Engenharia · Atualizado agora'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Period selector */}
            <div
              style={{
                display: 'flex',
                background: '#fff',
                border: '0.5px solid #E0E0E0',
                borderRadius: 20,
                padding: 3,
                gap: 2,
              }}
            >
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setPeriod(opt.key)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 16,
                    fontSize: 11,
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: filters.period === opt.key ? '#1A1A1A' : 'transparent',
                    color: filters.period === opt.key ? '#F5A800' : '#888',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Export button */}
            <button
              onClick={() => window.print()}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                background: '#F5A800',
                color: '#1A1A1A',
                fontSize: 11,
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Exportar PDF
            </button>
          </div>
        </div>

        {/* Print header (hidden on screen) */}
        <div
          className="reports-print-header"
          style={{ display: 'none', marginBottom: 16 }}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>Relatório — All Energy Engenharia</div>
          <div style={{ fontSize: 11, color: '#aaa' }}>Gerado em {new Date().toLocaleDateString('pt-BR')}</div>
        </div>

        {/* ── FILTER BAR ── */}
        <ReportFilterBar
          filters={filters}
          onFilterChange={setFilter}
          onClearFilter={clearFilter}
          onClearAll={clearAll}
          totalFiltered={kpis?.totalProjetos || 0}
          totalGeral={reportData?.totalProjetosGeral ?? kpis?.totalProjetos ?? 0}
          companies={companyOptions}
          concessionaires={concessionaireOptions}
          staffList={staffOptions}
        />

        {/* ── KPIs PRINCIPAIS (1.2fr + 1fr × 3) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr 1fr 1fr',
            gap: 10,
            marginBottom: 10,
          }}
        >
          {/* Hero */}
          <ReportKpiHero
            kpis={kpis || {
              totalFaturamento: 0, totalRecebido: 0, totalEmAberto: 0,
              totalProjetos: 0, projetosConcluidos: 0, projetosAtivos: 0,
              ticketMedio: 0, taxaConclusao: 0, tempoMedioDias: 0,
              potenciaInstalada: 0, faturamentoAnterior: 0,
              projetosAnterior: 0, ticketAnterior: 0, conclusaoAnterior: 0,
            }}
            filterLabel={activeFilterLabel}
            variation={fatVariation}
          />

          {/* Total projetos */}
          <ReportKpiCard
            value={String(kpis?.totalProjetos || 0)}
            label="Total de Projetos"
            subtext={`${kpis?.projetosAtivos || 0} em andamento`}
            trend={projVariation}
            trendPositive={projVariation >= 0}
            iconColor="#378ADD"
            icon={Activity}
            sparkData={sparkProj}
          />

          {/* Ticket médio */}
          <ReportKpiCard
            value={formatCurrencyShort(kpis?.ticketMedio || 0)}
            label="Ticket Médio"
            subtext="por projeto"
            trend={ticketVariation}
            trendPositive={ticketVariation >= 0}
            iconColor="#F5A800"
            icon={DollarSign}
            sparkData={sparkFat}
          />

          {/* Taxa de conclusão */}
          <ReportKpiCard
            value={`${Math.round(kpis?.taxaConclusao || 0)}%`}
            label="Taxa de Conclusão"
            subtext={`${kpis?.projetosConcluidos || 0} concluídos`}
            trend={conclusaoVariation}
            trendPositive={conclusaoVariation >= 0}
            iconColor="#2D6A4F"
            icon={CheckCircle2}
            sparkData={monthly.map((m) => m.concluidos)}
          />
        </div>

        {/* ── KPIs SECUNDÁRIOS (4 cols) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 10,
            marginBottom: 10,
          }}
        >
          <ReportKpiSecondary
            label="Valor Recebido"
            value={formatCurrencyShort(kpis?.totalRecebido || 0)}
            iconBg="rgba(45,106,79,0.10)"
            iconColor="#2D6A4F"
            icon={TrendingUp}
          />
          <ReportKpiSecondary
            label="Em Aberto"
            value={formatCurrencyShort(kpis?.totalEmAberto || 0)}
            iconBg="rgba(245,168,0,0.10)"
            iconColor="#F5A800"
            icon={DollarSign}
          />
          <ReportKpiSecondary
            label="Potência Instalada"
            value={`${(kpis?.potenciaInstalada || 0).toFixed(1)} kWp`}
            iconBg="rgba(83,74,183,0.10)"
            iconColor="#534AB7"
            icon={Zap}
          />
          <ReportKpiSecondary
            label="Tempo Médio"
            value={`${kpis?.tempoMedioDias || 0} dias`}
            iconBg="rgba(55,138,221,0.10)"
            iconColor="#378ADD"
            icon={Clock}
          />
        </div>

        {/* ── GRÁFICOS LINHA 1 (projetos + faturamento) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginBottom: 10,
          }}
        >
          <CardShell title="Projetos por Mês">
            <ReportBarChart data={monthly} type="projects" />
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#888' }}>
                <span style={{ width: 10, height: 10, background: '#F5A800', borderRadius: 2, display: 'inline-block' }} />
                Novos
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#888' }}>
                <span style={{ width: 10, height: 10, background: '#2D6A4F', borderRadius: 2, display: 'inline-block' }} />
                Concluídos
              </span>
            </div>
          </CardShell>

          <CardShell title="Faturamento por Mês">
            <ReportBarChart data={monthly} type="financial" />
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#888' }}>
                <span style={{ width: 10, height: 10, background: '#378ADD', borderRadius: 2, display: 'inline-block' }} />
                Faturado
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#888' }}>
                <span style={{ width: 10, height: 10, background: '#2D6A4F', borderRadius: 2, display: 'inline-block' }} />
                Recebido
              </span>
            </div>
          </CardShell>
        </div>

        {/* ── GRÁFICOS LINHA 2 (ticket + funil + donut) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 10,
            marginBottom: 10,
          }}
        >
          <CardShell title="Ticket Médio">
            <ReportTicketChart data={monthly} />
          </CardShell>

          <CardShell title="Distribuição por Etapa">
            <ReportFunnel stages={reportData?.stages || []} />
          </CardShell>

          <CardShell title="Por Concessionária">
            <ReportDonut data={reportData?.concessionaires || []} />
          </CardShell>
        </div>

        {/* ── RANKING + TEMPO ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr',
            gap: 10,
            marginBottom: 10,
          }}
        >
          {/* Rankings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CardShell title="Top Empresas">
              <ReportRanking items={reportData?.companyRanking || []} title="Top Empresas" />
            </CardShell>
            <CardShell title="Top Projetistas">
              <ReportRanking items={reportData?.staffRanking || []} title="Top Projetistas" />
            </CardShell>
          </div>

          {/* Stage times */}
          <CardShell title="Tempo Médio por Etapa">
            <ReportStageTimes stageTimes={reportData?.stageTimes || []} total={totalStageDays} />
          </CardShell>
        </div>

        {/* ── PROJEÇÃO ── */}
        {reportData?.projection && (
          <CardShell>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    background: '#FEF3D0',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingUp size={18} color="#F5A800" />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1A1A1A', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Projeção — {reportData.projection.label}
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                    Baseado na média dos últimos {reportData.monthly.length} meses + 10% crescimento
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1A1A1A' }}>
                    {reportData.projection.projetos}
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa' }}>projetos estimados</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#2D6A4F' }}>
                    {formatCurrencyShort(reportData.projection.faturamento)}
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa' }}>faturamento estimado</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#F5A800' }}>
                    {reportData.projection.metaProgress}%
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa' }}>meta atingida</div>
                </div>
              </div>

              {/* Progress */}
              <div style={{ minWidth: 200 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: '#888' }}>Progresso da meta</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#F5A800' }}>
                    {reportData.projection.metaProgress}%
                  </span>
                </div>
                <div style={{ height: 6, background: '#F0F0F0', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${reportData.projection.metaProgress}%`,
                      background: 'linear-gradient(90deg, #F5A800, #FFD166)',
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            </div>
          </CardShell>
        )}
      </div>
    </MainLayout>
  )
}
