import { MainLayout } from '@/components/layout/MainLayout';
import { motion } from 'framer-motion';
import { FolderOpen, Clock, DollarSign, Plus, Loader2 } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardMap } from '@/components/maps/DashboardMap';
import { projectStatusLabels as statusLabels } from '@/lib/statusMapping';

export default function DashboardCompany() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: allProjects = [], isLoading } = useProjects();
  
  // Filter projects for this company
  const companyProjects = allProjects.filter(p => p.company_id === user?.companyId);
  
  const totalProjects = companyProjects.length;
  const inProgressCount = companyProjects.filter(p => 
    !['completed'].includes(p.status)
  ).length;
  const pendingPayment = companyProjects
    .filter(p => p.financials?.payment_status !== 'paid')
    .reduce((acc, p) => acc + ((p.financials?.project_value || 0) - (p.financials?.paid_value || 0)), 0);

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
    <MainLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Meus Projetos</h1>
            <p className="text-muted-foreground mt-1">Acompanhe seus projetos de homologação</p>
          </div>
          <Button 
            variant="cta" 
            size="lg"
            onClick={() => navigate('/new-project')}
          >
            <Plus className="w-5 h-5" />
            Novo Projeto
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="kpi-card"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <FolderOpen className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-card-foreground">{totalProjects}</p>
                <p className="text-sm text-muted-foreground">Total de projetos</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="kpi-card"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-info/10">
                <Clock className="w-6 h-6 text-info" />
              </div>
              <div>
                <p className="text-2xl font-bold text-card-foreground">{inProgressCount}</p>
                <p className="text-sm text-muted-foreground">Em andamento</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="kpi-card"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-warning/10">
                <DollarSign className="w-6 h-6 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold text-card-foreground">
                  R$ {pendingPayment.toLocaleString('pt-BR')}
                </p>
                <p className="text-sm text-muted-foreground">Valor pendente</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Map */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <DashboardMap
            projects={companyProjects}
            isLoading={isLoading}
            userId={user?.id}
            userRole="company"
            companyMode
          />
        </motion.div>

        {/* Projects List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="kpi-card"
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-card-foreground">Seus Projetos</h3>
          </div>
          
          {companyProjects.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Código</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Titular</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Potência</th>
                  </tr>
                </thead>
                <tbody>
                  {companyProjects.map((project) => (
                    <tr 
                      key={project.id}
                      onClick={() => navigate(`/project/${project.id}`)}
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 text-sm font-medium text-card-foreground">{project.code}</td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {project.generalData?.holder_name || project.title}
                      </td>
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
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {project.equipment?.total_installed_power || 0} kWp
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-card-foreground mb-2">
                Nenhum projeto ainda
              </h3>
              <p className="text-muted-foreground mb-6">
                Comece enviando seu primeiro projeto de homologação
              </p>
              <Button variant="cta" onClick={() => navigate('/new-project')}>
                <Plus className="w-5 h-5" />
                Novo Projeto
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    </MainLayout>
  );
}
