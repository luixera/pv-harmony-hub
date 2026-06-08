import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { motion } from 'framer-motion';
import { TrendingUp, FolderOpen, CheckCircle2, DollarSign, AlertCircle, ArrowUpRight, ArrowDownRight, Loader2, Map, Eye, EyeOff } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useProjects } from '@/hooks/useProjects';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { DashboardMap } from '@/components/maps/DashboardMap';
import { ProjectModal } from '@/components/projects/ProjectModal';
import ProjectsMonthlyChart from '@/components/dashboard/ProjectsMonthlyChart';

const statusLabels: Record<string, string> = {
  pending: 'Aguardando',
  analysis: 'Em Análise',
  documentation: 'Documentação',
  approval: 'Aprovação',
  approved: 'Aprovado',
  completed: 'Concluído',
};

export default function DashboardAdmin() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useProjects();
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  const [hideOpenValue, setHideOpenValue] = useState(false);
  
  const activeProjects = projects.filter(p => !['completed'].includes(p.status)).length;
  const completedProjects = projects.filter(p => p.status === 'completed').length;
  const projectsWithLocation = projects.filter(p => !!p.generalData?.coordinates).length;
  // Uses project_financials (canonical table) — not the legacy `financials` table
  const noValueProjects = projects.filter(p => !p.financials?.project_value || p.financials.project_value === 0).length;
  const pendingValue = projects
    .filter(p => p.financials?.payment_status !== 'paid')
    .reduce((acc, p) => acc + ((p.financials?.project_value || 0) - (p.financials?.paid_value || 0)), 0);

  const kpiCards = [
    { title: 'Projetos Ativos', value: activeProjects, change: '+12%', trend: 'up', icon: FolderOpen },
    { title: 'Concluídos', value: completedProjects, change: '+8%', trend: 'up', icon: CheckCircle2 },
    { title: 'Valor em Aberto', value: hideOpenValue ? '••••••' : formatCurrency(pendingValue), change: '-5%', trend: 'down', icon: DollarSign, hideable: true },
    { title: 'Taxa de Aprovação', value: '98%', change: '+2%', trend: 'up', icon: TrendingUp },
  ];

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <>
    <MainLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Visão geral dos seus projetos</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {kpiCards.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="kpi-card cursor-pointer hover:shadow-xl transition-all duration-300"
              onClick={() => navigate('/projects')}
            >
              <div className="flex items-start justify-between">
                <div className="p-3 rounded-xl" style={{ background: '#FEF3D0' }}>
                  <card.icon className="w-6 h-6" style={{ color: '#F5A800' }} />
                </div>
                <div className="flex items-center gap-2">
                  {(card as any).hideable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setHideOpenValue(v => !v); }}
                      title={hideOpenValue ? 'Mostrar valor' : 'Ocultar valor'}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {hideOpenValue
                        ? <EyeOff className="w-4 h-4" />
                        : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                  <div
                    className="flex items-center gap-1 text-sm px-2 py-0.5 rounded-full"
                    style={card.trend === 'up'
                      ? { color: '#2D6A4F', background: '#E1F5EE' }
                      : { color: '#993C1D', background: '#FFF0E6' }}
                  >
                    {card.change}
                    {card.trend === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-2xl font-semibold text-card-foreground">{card.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{card.title}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Alerta: projetos sem valor */}
        {noValueProjects > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42 }}
            className="flex items-center justify-between gap-4 rounded-xl p-4"
            style={{ background: '#FFF0E6', border: '1px solid #FBBF8A' }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: '#FFE0C7' }}>
                <AlertCircle className="w-5 h-5" style={{ color: '#993C1D' }} />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: '#993C1D' }}>
                  {noValueProjects} {noValueProjects === 1 ? 'projeto sem valor atribuído' : 'projetos sem valor atribuído'}
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#C05621' }}>
                  Esses projetos precisam ter um valor definido
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="shrink-0 font-medium"
              style={{ background: '#993C1D', color: '#FFFFFF' }}
              onClick={() => navigate('/projects?filter=no-value')}
            >
              Ver projetos
            </Button>
          </motion.div>
        )}

        {/* Map quick-access card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="kpi-card cursor-pointer hover:shadow-xl transition-all duration-300 flex items-center justify-between gap-4"
          onClick={() => navigate('/projects-map')}
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Map className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold text-card-foreground">Mapa de Projetos</p>
              <p className="text-sm text-muted-foreground">
                {projectsWithLocation} projeto(s) com localização cadastrada
              </p>
            </div>
          </div>
          <ArrowUpRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        </motion.div>

        {/* Dashboard Map */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.48 }}>
          <DashboardMap projects={projects} isLoading={isLoading} userRole="admin" />
        </motion.div>

        {/* Gráfico: Projetos por mês */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.52 }}>
          <ProjectsMonthlyChart />
        </motion.div>

        {/* Status Chart & Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="kpi-card">
            <h3 className="text-lg font-semibold text-card-foreground mb-6">Distribuição por Status</h3>
            <div className="space-y-4">
              {[
                { status: 'Aguardando', count: projects.filter(p => p.status === 'pending').length, color: 'bg-muted' },
                { status: 'Em Análise', count: projects.filter(p => p.status === 'analysis').length, color: 'bg-kanban-analysis' },
                { status: 'Documentação', count: projects.filter(p => p.status === 'documentation').length, color: 'bg-kanban-progress' },
                { status: 'Aprovação', count: projects.filter(p => p.status === 'approval').length, color: 'bg-kanban-progress' },
                { status: 'Aprovado', count: projects.filter(p => p.status === 'approved').length, color: 'bg-kanban-approved' },
                { status: 'Concluído', count: projects.filter(p => p.status === 'completed').length, color: 'bg-kanban-completed' },
              ].map((item) => (
                <div key={item.status} className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full ${item.color}`} />
                  <span className="text-sm text-muted-foreground flex-1">{item.status}</span>
                  <span className="text-sm font-semibold text-card-foreground">{item.count}</span>
                  <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} transition-all duration-500`} style={{ width: `${projects.length > 0 ? (item.count / projects.length) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="kpi-card">
            <h3 className="text-lg font-semibold text-card-foreground mb-6">Alertas Recentes</h3>
            <div className="space-y-3">
              {projects.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum alerta no momento</p>
              ) : (
                projects.slice(0, 3).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => setModalProjectId(project.id)}
                    className="w-full flex items-start gap-3 p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  >
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-info" />
                    <div className="flex-1">
                      <p className="text-sm text-card-foreground">
                        Projeto {project.code} - {project.generalData?.holder_name || project.title}
                      </p>
                    </div>
                    <Badge variant="info">Info</Badge>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </div>

        {/* Recent Projects */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="kpi-card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-card-foreground">Projetos Recentes</h3>
            <button onClick={() => navigate('/projects')} className="text-sm text-primary hover:underline">Ver todos</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Código</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Titular</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Empresa</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Valor</th>
                </tr>
              </thead>
              <tbody>
                {projects.slice(0, 5).map((project) => (
                  <tr
                    key={project.id}
                    onClick={() => setModalProjectId(project.id)}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 text-sm font-medium text-card-foreground">{project.code}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{project.generalData?.holder_name || project.title}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{project.companyName}</td>
                    <td className="py-3 px-4">
                      <Badge variant={
                        project.status === 'pending' ? 'pending' :
                        project.status === 'analysis' ? 'analysis' :
                        project.status === 'approved' ? 'approved' :
                        project.status === 'completed' ? 'completed' :
                        'progress'
                      }>
                        {statusLabels[project.status]}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-sm text-right font-medium text-card-foreground">
                      {formatCurrency(project.financials?.project_value)}
                    </td>
                  </tr>
                ))}
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nenhum projeto encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </MainLayout>

    {modalProjectId && (
      <ProjectModal projectId={modalProjectId} onClose={() => setModalProjectId(null)} />
    )}
  </>
  );
}
