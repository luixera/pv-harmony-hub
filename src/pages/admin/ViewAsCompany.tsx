import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { motion } from 'framer-motion';
import { FolderOpen, Clock, DollarSign, ArrowLeft, Eye, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useProjects } from '@/hooks/useProjects';
import { useCompanyKanbanModel } from '@/hooks/useKanbanConfig';
import { ReadOnlyKanbanBoard } from '@/components/kanban/ReadOnlyKanbanBoard';
import { ProjectModal } from '@/components/projects/ProjectModal';

interface ViewingCompany {
  id: string;
  name: string;
  publicToken: string;
}

export default function ViewAsCompany() {
  const navigate = useNavigate();
  const [company, setCompany] = useState<ViewingCompany | null>(null);
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  
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

  // As etapas vêm da CONFIGURAÇÃO do Kanban DESTA empresa, nunca de uma lista
  // fixa — havia aqui um mapa chumbado no código, e quem renomeava a coluna
  // continuava vendo o nome velho (relato do usuário, ago/2026). Agora quem
  // desenha os rótulos é o próprio quadro, a partir destas colunas.
  const { data: kanbanModel } = useCompanyKanbanModel(company?.id);
  const colunas = kanbanModel?.columns ?? [];

  // Espelha o que a empresa vê: o QUADRO dela (decisão do usuário, set/2026).
  // O filtro por etapa saiu porque no quadro a etapa é a própria coluna; a
  // ordenação alfabética virou a ordem dos cards dentro de cada coluna.
  const titularDe = (p: { generalData?: { holder_name?: string | null }; title?: string | null }) =>
    (p.generalData?.holder_name || p.title || '').trim();

  const projetosOrdenados = useMemo(
    // localeCompare com pt-BR: sem isso "Ângela" cai depois de "Zuleica",
    // porque a ordem crua do JavaScript compara pelo código do caractere
    () => [...companyProjects].sort((a, b) => titularDe(a).localeCompare(titularDe(b), 'pt-BR')),
    [companyProjects],
  );

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
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <h3 className="text-lg font-semibold text-card-foreground">
              Projetos da Empresa
            </h3>
          </div>

          {projetosOrdenados.length > 0 ? (
            colunas.length > 0 ? (
              <ReadOnlyKanbanBoard
                projects={projetosOrdenados}
                columns={colunas}
                onOpenProject={setModalProjectId}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                Esta empresa ainda não tem um quadro configurado.
              </div>
            )
          ) : (
            <div className="text-center py-12">
              <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                Esta empresa ainda não enviou nenhum projeto.
              </p>
              <Button variant="cta" onClick={handleNewProject}>
                <Plus className="w-4 h-4" />
                Enviar Primeiro Projeto
              </Button>
            </div>
          )}
        </motion.div>
      </div>

      {modalProjectId && (
        <ProjectModal projectId={modalProjectId} onClose={() => setModalProjectId(null)} />
      )}
    </MainLayout>
  );
}
