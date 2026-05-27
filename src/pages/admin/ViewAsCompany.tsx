import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { motion } from 'framer-motion';
import { FolderOpen, Clock, DollarSign, ArrowLeft, Eye, Plus, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useProjects } from '@/hooks/useProjects';
import { projectStatusLabels as statusLabels } from '@/lib/statusMapping';

interface ViewingCompany {
  id: string;
  name: string;
  publicToken: string;
}

export default function ViewAsCompany() {
  const navigate = useNavigate();
  const [company, setCompany] = useState<ViewingCompany | null>(null);
  
  // Load company from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem('viewingAsCompany');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setCompany({
          id: parsed.id,
          name: parsed.name,
          publicToken: parsed.publicToken || parsed.public_form_token,
        });
      } catch (e) {
        console.error('Error parsing company from sessionStorage:', e);
        navigate('/admin/companies');
      }
    } else {
      navigate('/admin/companies');
    }
  }, [navigate]);

  // Fetch projects from Supabase
  const { data: allProjects = [], isLoading } = useProjects();
  
  // Filter projects for this company
  const companyProjects = company 
    ? allProjects.filter(p => p.company_id === company.id)
    : [];
  
  const totalProjects = companyProjects.length;
  const inProgressCount = companyProjects.filter(p => 
    !['completed'].includes(p.status)
  ).length;
  
  // Calculate pending payment from financials
  const pendingPayment = companyProjects.reduce((acc, p) => {
    const projectValue = p.financials?.project_value || 0;
    const paidValue = p.financials?.paid_value || 0;
    if (p.financials?.payment_status !== 'paid') {
      return acc + (projectValue - paidValue);
    }
    return acc;
  }, 0);

  const handleExit = () => {
    sessionStorage.removeItem('viewingAsCompany');
    navigate('/admin/companies');
  };

  const handleNewProject = () => {
    // Use the new project page instead of public form when admin is viewing as company
    navigate('/new-project');
  };

  if (!company) {
    return null;
  }

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Admin Notice */}
        <Alert className="border-primary/50 bg-primary/10">
          <Eye className="w-4 h-4 text-primary" />
          <AlertDescription className="text-primary">
            Você está visualizando o ambiente da empresa <strong>{company.name}</strong>.
            <Button variant="link" className="p-0 h-auto ml-2 text-primary" onClick={handleExit}>
              Sair do modo visualização
            </Button>
          </AlertDescription>
        </Alert>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handleExit}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Visualizando: {company.name}
              </h1>
              <p className="text-muted-foreground">Ambiente da empresa (modo leitura - sessão do admin mantida)</p>
            </div>
          </div>
          <Button variant="cta" onClick={handleNewProject}>
            <Plus className="w-4 h-4" />
            Enviar Novo Projeto
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

        {/* Projects List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="kpi-card"
        >
          <h3 className="text-lg font-semibold text-card-foreground mb-6">Projetos da Empresa</h3>
          
          {companyProjects.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Código</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Titular</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Potência</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {companyProjects.map((project) => (
                    <tr 
                      key={project.id}
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/project/${project.id}`)}
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
                          {statusLabels[project.status] || project.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {project.equipment?.total_installed_power || 0} kWp
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        R$ {(project.financials?.project_value || 0).toLocaleString('pt-BR')}
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
                Nenhum projeto
              </h3>
              <p className="text-muted-foreground mb-4">
                Esta empresa ainda não possui projetos
              </p>
              <Button variant="cta" onClick={handleNewProject}>
                <Plus className="w-4 h-4" />
                Enviar Primeiro Projeto
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    </MainLayout>
  );
}
