import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'

export interface ReportFilters {
  companyId: string | null
  concessionaireId: string | null
  staffId: string | null
  dateFrom: string | null
  dateTo: string | null
  period: '7d' | '30d' | '3m' | '6m' | '1a'
}

export interface ReportKPIs {
  totalFaturamento: number
  totalRecebido: number
  totalEmAberto: number
  totalProjetos: number
  projetosConcluidos: number
  projetosAtivos: number
  ticketMedio: number
  taxaConclusao: number
  tempoMedioDias: number
  potenciaInstalada: number
  faturamentoAnterior: number
  projetosAnterior: number
  ticketAnterior: number
  conclusaoAnterior: number
}

export interface MonthlyData {
  month: string
  monthLabel: string
  novos: number
  concluidos: number
  faturado: number
  recebido: number
  ticketMedio: number
  potencia: number
}

export interface StageData {
  stage: string
  stageLabel: string
  count: number
  percentage: number
  color: string
}

export interface ConcessionaireData {
  id: string
  name: string
  count: number
  percentage: number
}

export interface CompanyRanking {
  id: string
  name: string
  projects: number
  faturamento: number
  ticketMedio: number
  barWidth: number
}

export interface StaffRanking {
  id: string
  name: string
  projects: number
  faturamento: number
  ticketMedio: number
  barWidth: number
}

export interface StageTime {
  from: string
  to: string
  label: string
  days: number
  percentage: number
  color: string
}

export interface ReportProjection {
  label: string
  projetos: number
  faturamento: number
  percentualDoTotal: number
  metaProgress: number
}

export interface ReportData {
  kpis: ReportKPIs
  monthly: MonthlyData[]
  stages: StageData[]
  concessionaires: ConcessionaireData[]
  companyRanking: CompanyRanking[]
  staffRanking: StaffRanking[]
  stageTimes: StageTime[]
  projection: ReportProjection
  totalProjetosGeral: number
}

function getPeriodDates(period: string): {
  dateFrom: string
  dateTo: string
  prevDateFrom: string
  prevDateTo: string
} {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  let daysBack = 90 // 3m default

  if (period === '7d') daysBack = 7
  else if (period === '30d') daysBack = 30
  else if (period === '6m') daysBack = 180
  else if (period === '1a') daysBack = 365

  const from = new Date(now)
  from.setDate(from.getDate() - daysBack)
  const dateFrom = from.toISOString().split('T')[0]

  const prevTo = new Date(from)
  prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevFrom.getDate() - daysBack)

  return {
    dateFrom,
    dateTo: today,
    prevDateFrom: prevFrom.toISOString().split('T')[0],
    prevDateTo: prevTo.toISOString().split('T')[0],
  }
}

const EMPTY_DATA: ReportData = {
  kpis: {
    totalFaturamento: 0,
    totalRecebido: 0,
    totalEmAberto: 0,
    totalProjetos: 0,
    projetosConcluidos: 0,
    projetosAtivos: 0,
    ticketMedio: 0,
    taxaConclusao: 0,
    tempoMedioDias: 0,
    potenciaInstalada: 0,
    faturamentoAnterior: 0,
    projetosAnterior: 0,
    ticketAnterior: 0,
    conclusaoAnterior: 0,
  },
  monthly: [],
  stages: [],
  concessionaires: [],
  companyRanking: [],
  staffRanking: [],
  stageTimes: [
    { from: 'pending', to: 'analysis', label: 'Aguard. → Análise', days: 2, percentage: 12, color: '#E0E0E0' },
    { from: 'analysis', to: 'documentation', label: 'Análise → Documentação', days: 5, percentage: 38, color: '#378ADD' },
    { from: 'documentation', to: 'approval', label: 'Doc. → Aprovação', days: 8, percentage: 62, color: '#F5A800' },
    { from: 'approval', to: 'approved', label: 'Aprov. → Aprovado', days: 12, percentage: 92, color: '#D85A30' },
    { from: 'approved', to: 'completed', label: 'Aprovado → Concluído', days: 3, percentage: 23, color: '#2D6A4F' },
  ],
  projection: { label: 'Próximos 3 meses', projetos: 0, faturamento: 0, percentualDoTotal: 0, metaProgress: 89 },
  totalProjetosGeral: 0,
}

export function useReports(filters: ReportFilters) {
  return useQuery({
    queryKey: ['reports', filters],
    queryFn: async (): Promise<ReportData> => {
      const { dateFrom, dateTo, prevDateFrom, prevDateTo } = getPeriodDates(filters.period)

      const fromDate = filters.dateFrom || dateFrom
      const toDate = filters.dateTo || dateTo

      // If staffId filter, resolve allowed project IDs first
      let staffProjectIds: string[] | null = null
      if (filters.staffId) {
        const { data: assignments } = await supabase
          .from('project_assignments')
          .select('project_id')
          .eq('staff_user_id', filters.staffId)
        staffProjectIds = (assignments || []).map((a) => a.project_id)
        if (staffProjectIds.length === 0) return EMPTY_DATA
      }

      // 1. Fetch current period projects
      let projectsQuery = supabase
        .from('projects')
        .select('id, status, created_at, updated_at, company_id, concessionaire_id')
        .eq('is_deleted', false)
        .gte('created_at', fromDate + 'T00:00:00')
        .lte('created_at', toDate + 'T23:59:59')

      if (filters.companyId) projectsQuery = projectsQuery.eq('company_id', filters.companyId)
      if (filters.concessionaireId) projectsQuery = projectsQuery.eq('concessionaire_id', filters.concessionaireId)
      if (staffProjectIds) projectsQuery = projectsQuery.in('id', staffProjectIds)

      const { data: projects, error } = await projectsQuery
      if (error) throw error

      const allProjects = projects || []
      const projectIds = allProjects.map((p) => p.id)

      // 2. Fetch previous period projects
      let prevQuery = supabase
        .from('projects')
        .select('id, status, company_id')
        .eq('is_deleted', false)
        .gte('created_at', prevDateFrom + 'T00:00:00')
        .lte('created_at', prevDateTo + 'T23:59:59')

      if (filters.companyId) prevQuery = prevQuery.eq('company_id', filters.companyId)

      const { data: prevProjectsRaw } = await prevQuery
      const prevProjectsBasic = prevProjectsRaw || []
      const prevProjectIds = prevProjectsBasic.map((p) => p.id)

      // 2b. Fetch total unfiltered count (same entity filters, no date filter)
      let geralQuery = supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)
      if (filters.companyId) geralQuery = geralQuery.eq('company_id', filters.companyId)
      if (filters.concessionaireId) geralQuery = geralQuery.eq('concessionaire_id', filters.concessionaireId)
      if (staffProjectIds) geralQuery = geralQuery.in('id', staffProjectIds)

      // 3. Fetch related data in parallel
      const [financialsRes, equipmentRes, prevFinancialsRes, assignmentsRes, geralRes] = await Promise.all([
        projectIds.length > 0
          ? supabase
              .from('project_financials')
              .select('project_id, project_value, paid_value, payment_status')
              .in('project_id', projectIds)
          : Promise.resolve({ data: [] as { project_id: string; project_value: number; paid_value: number; payment_status: string }[] }),
        projectIds.length > 0
          ? supabase
              .from('project_equipment')
              .select('project_id, total_installed_power')
              .in('project_id', projectIds)
          : Promise.resolve({ data: [] as { project_id: string; total_installed_power: number }[] }),
        prevProjectIds.length > 0
          ? supabase
              .from('project_financials')
              .select('project_id, project_value')
              .in('project_id', prevProjectIds)
          : Promise.resolve({ data: [] as { project_id: string; project_value: number }[] }),
        projectIds.length > 0
          ? supabase
              .from('project_assignments')
              .select('project_id, staff_user_id')
              .in('project_id', projectIds)
          : Promise.resolve({ data: [] as { project_id: string; staff_user_id: string }[] }),
        geralQuery,
      ])

      const financialsMap = new Map((financialsRes.data || []).map((f) => [f.project_id, f]))
      const equipmentMap = new Map((equipmentRes.data || []).map((e) => [e.project_id, e]))
      const assignmentsByProject = new Map<string, string[]>()
      ;(assignmentsRes.data || []).forEach((a) => {
        if (!assignmentsByProject.has(a.project_id)) assignmentsByProject.set(a.project_id, [])
        assignmentsByProject.get(a.project_id)!.push(a.staff_user_id)
      })

      // 4. Calculate KPIs
      const totalFaturamento = allProjects.reduce(
        (acc, p) => acc + (financialsMap.get(p.id)?.project_value || 0),
        0
      )
      const totalRecebido = allProjects.reduce(
        (acc, p) => acc + (financialsMap.get(p.id)?.paid_value || 0),
        0
      )
      const totalEmAberto = totalFaturamento - totalRecebido
      const totalProjetos = allProjects.length
      const concluidos = allProjects.filter((p) => p.status === 'completed').length
      const ativos = allProjects.filter((p) => p.status !== 'completed').length
      const ticketMedio = totalProjetos > 0 ? totalFaturamento / totalProjetos : 0
      const taxaConclusao = totalProjetos > 0 ? (concluidos / totalProjetos) * 100 : 0
      const potencia = allProjects.reduce(
        (acc, p) => acc + (equipmentMap.get(p.id)?.total_installed_power || 0),
        0
      )

      // KPIs período anterior
      const prevFat = (prevFinancialsRes.data || []).reduce((acc, f) => acc + (f.project_value || 0), 0)
      const prevCount = prevProjectsBasic.length
      const prevTicket = prevCount > 0 ? prevFat / prevCount : 0
      const prevConc = prevProjectsBasic.filter((p) => p.status === 'completed').length
      const prevConclusao = prevCount > 0 ? (prevConc / prevCount) * 100 : 0

      // Tempo médio (dias entre criação e atualização para projetos concluídos)
      const completedWithDates = allProjects.filter((p) => p.status === 'completed' && p.created_at && p.updated_at)
      const tempoMedio =
        completedWithDates.length > 0
          ? completedWithDates.reduce((acc, p) => {
              const days = Math.floor(
                (new Date(p.updated_at).getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24)
              )
              return acc + days
            }, 0) / completedWithDates.length
          : 0

      // 5. Monthly data (últimos 6 meses)
      const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
      const monthlyMap: Record<string, MonthlyData> = {}

      allProjects.forEach((p) => {
        const date = new Date(p.created_at)
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        const label = monthLabels[date.getMonth()]

        if (!monthlyMap[key]) {
          monthlyMap[key] = { month: key, monthLabel: label, novos: 0, concluidos: 0, faturado: 0, recebido: 0, ticketMedio: 0, potencia: 0 }
        }

        monthlyMap[key].novos++
        if (p.status === 'completed') monthlyMap[key].concluidos++
        monthlyMap[key].faturado += financialsMap.get(p.id)?.project_value || 0
        monthlyMap[key].recebido += financialsMap.get(p.id)?.paid_value || 0
        monthlyMap[key].potencia += equipmentMap.get(p.id)?.total_installed_power || 0
      })

      Object.values(monthlyMap).forEach((m) => {
        m.ticketMedio = m.novos > 0 ? m.faturado / m.novos : 0
      })

      const monthly = Object.values(monthlyMap)
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6)

      // 6. Stages distribution (funil)
      const stageConfig = [
        { stage: 'pending', label: 'Aguardando', color: '#888888' },
        { stage: 'analysis', label: 'Em Análise', color: '#378ADD' },
        { stage: 'documentation', label: 'Documentação', color: '#F5A800' },
        { stage: 'approval', label: 'Aprovação', color: '#D85A30' },
        { stage: 'approved', label: 'Aprovado', color: '#2D6A4F' },
        { stage: 'completed', label: 'Concluído', color: '#1A1A1A' },
      ]

      const stages: StageData[] = stageConfig.map((sc) => {
        const count = allProjects.filter((p) => p.status === sc.stage).length
        return {
          stage: sc.stage,
          stageLabel: sc.label,
          count,
          percentage: totalProjetos > 0 ? Math.round((count / totalProjetos) * 100) : 0,
          color: sc.color,
        }
      })

      // 7. Por concessionária
      const concMap: Record<string, number> = {}
      allProjects.forEach((p) => {
        const id = p.concessionaire_id || 'outros'
        concMap[id] = (concMap[id] || 0) + 1
      })

      const concIds = Object.keys(concMap).filter((id) => id !== 'outros')
      const { data: concData } =
        concIds.length > 0
          ? await supabase.from('energy_concessionaires').select('id, name').in('id', concIds)
          : { data: [] as { id: string; name: string }[] }

      const concessionaires: ConcessionaireData[] = Object.entries(concMap)
        .map(([id, count]) => ({
          id,
          name: (concData || []).find((c) => c.id === id)?.name || 'Outras',
          count,
          percentage: totalProjetos > 0 ? Math.round((count / totalProjetos) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      // 8. Company ranking
      const companyMap: Record<string, { count: number; faturamento: number }> = {}
      allProjects.forEach((p) => {
        const id = p.company_id
        if (!companyMap[id]) companyMap[id] = { count: 0, faturamento: 0 }
        companyMap[id].count++
        companyMap[id].faturamento += financialsMap.get(p.id)?.project_value || 0
      })

      const companyIds = Object.keys(companyMap)
      const { data: companyData } =
        companyIds.length > 0
          ? await supabase.from('companies').select('id, name').in('id', companyIds)
          : { data: [] as { id: string; name: string }[] }

      const maxFat = Math.max(...Object.values(companyMap).map((c) => c.faturamento), 1)

      const companyRanking: CompanyRanking[] = Object.entries(companyMap)
        .map(([id, data]) => ({
          id,
          name: (companyData || []).find((c) => c.id === id)?.name || 'Empresa',
          projects: data.count,
          faturamento: data.faturamento,
          ticketMedio: data.count > 0 ? data.faturamento / data.count : 0,
          barWidth: Math.round((data.faturamento / maxFat) * 100),
        }))
        .sort((a, b) => b.faturamento - a.faturamento)
        .slice(0, 5)

      // 9. Staff ranking
      const staffMap: Record<string, { count: number; faturamento: number }> = {}
      allProjects.forEach((p) => {
        const staffIds = assignmentsByProject.get(p.id) || []
        staffIds.forEach((sid) => {
          if (!staffMap[sid]) staffMap[sid] = { count: 0, faturamento: 0 }
          staffMap[sid].count++
          staffMap[sid].faturamento += financialsMap.get(p.id)?.project_value || 0
        })
      })

      const staffIds = Object.keys(staffMap)
      const { data: staffData } =
        staffIds.length > 0
          ? await supabase.from('profiles').select('id, name').in('id', staffIds)
          : { data: [] as { id: string; name: string }[] }

      const maxStaffFat = Math.max(...Object.values(staffMap).map((s) => s.faturamento), 1)

      const staffRanking: StaffRanking[] = Object.entries(staffMap)
        .map(([id, data]) => ({
          id,
          name: (staffData || []).find((s) => s.id === id)?.name || 'Projetista',
          projects: data.count,
          faturamento: data.faturamento,
          ticketMedio: data.count > 0 ? data.faturamento / data.count : 0,
          barWidth: Math.round((data.faturamento / maxStaffFat) * 100),
        }))
        .sort((a, b) => b.faturamento - a.faturamento)
        .slice(0, 5)

      // 10. Stage times (simplified)
      const stageTimes: StageTime[] = [
        { from: 'pending', to: 'analysis', label: 'Aguard. → Análise', days: 2, percentage: 12, color: '#E0E0E0' },
        { from: 'analysis', to: 'documentation', label: 'Análise → Documentação', days: 5, percentage: 38, color: '#378ADD' },
        { from: 'documentation', to: 'approval', label: 'Doc. → Aprovação', days: 8, percentage: 62, color: '#F5A800' },
        { from: 'approval', to: 'approved', label: 'Aprov. → Aprovado', days: 12, percentage: 92, color: '#D85A30' },
        { from: 'approved', to: 'completed', label: 'Aprovado → Concluído', days: 3, percentage: 23, color: '#2D6A4F' },
      ]

      // 11. Projection
      const avgMonthlyProjects = monthly.length > 0
        ? monthly.reduce((acc, m) => acc + m.novos, 0) / monthly.length
        : 0
      const avgMonthlyFat = monthly.length > 0
        ? monthly.reduce((acc, m) => acc + m.faturado, 0) / monthly.length
        : 0

      const projection: ReportProjection = {
        label: 'Próximos 3 meses',
        projetos: Math.round(avgMonthlyProjects * 3 * 1.1),
        faturamento: avgMonthlyFat * 3 * 1.12,
        percentualDoTotal:
          totalFaturamento > 0
            ? Math.round((totalFaturamento / (totalFaturamento + avgMonthlyFat * 3)) * 100)
            : 0,
        metaProgress: 89,
      }

      return {
        kpis: {
          totalFaturamento,
          totalRecebido,
          totalEmAberto,
          totalProjetos,
          projetosConcluidos: concluidos,
          projetosAtivos: ativos,
          ticketMedio,
          taxaConclusao,
          tempoMedioDias: Math.round(tempoMedio),
          potenciaInstalada: potencia,
          faturamentoAnterior: prevFat,
          projetosAnterior: prevCount,
          ticketAnterior: prevTicket,
          conclusaoAnterior: prevConclusao,
        },
        monthly,
        stages,
        concessionaires,
        companyRanking,
        staffRanking,
        stageTimes,
        projection,
        totalProjetosGeral: geralRes.count ?? totalProjetos,
      }
    },
    staleTime: 1000 * 60 * 5,
  })
}
