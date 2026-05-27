import { MainLayout } from '@/components/layout/MainLayout';
import { motion } from 'framer-motion';
import { FolderOpen, Clock, MessageSquare, Loader2 } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useRecentComments } from '@/hooks/useComments';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardMap } from '@/components/maps/DashboardMap';
import { projectStatusLabels as statusLabels } from '@/lib/statusMapping';

export default function DashboardStaff() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: comments = [], isLoading: commentsLoading } = useRecentComments();
  
  const inProgressProjects = projects.filter(p => 
    ['analysis', 'documentation', 'approval'].includes(p.status)
  );
  
  const pendingProjects = projects.filter(p => p.status === 'pending');
  
  const recentComments = comments.slice(0, 5);

  if (projectsLoading) {
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
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Seus projetos e atividades</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="kpi-card"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-info/10">
                <FolderOpen className="w-6 h-6 text-info" />
              </div>
              <div>
                <p className="text-2xl font-bold text-card-foreground">{inProgressProjects.length}</p>
                <p className="text-sm text-muted-foreground">Em andamento</p>
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
              <div className="p-3 rounded-xl bg-warning/10">
                <Clock className="w-6 h-6 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold text-card-foreground">{pendingProjects.length}</p>
                <p className="text-sm text-muted-foreground">Aguardando ação</p>
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
              <div className="p-3 rounded-xl bg-success/10">
                <MessageSquare className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-card-foreground">{comments.length}</p>
                <p className="text-sm text-muted-foreground">Comentários</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Dashboard Map */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
          <DashboardMap projects={projects} isLoading={projectsLoading} userId={user?.id} userRole="staff" />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* In Progress Projects */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="kpi-card"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-card-foreground">Projetos em Andamento</h3>
              <button 
                onClick={() => navigate('/projects')}
                className="text-sm text-primary hover:underline"
              >
                Ver Kanban
              </button>
            </div>
            <div className="space-y-3">
              {inProgressProjects.slice(0, 5).map((project) => (
                <button
                  key={project.id}
                  onClick={() => navigate(`/project/${project.id}`)}
                  className="w-full flex items-center justify-between p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-card-foreground">{project.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {project.generalData?.holder_name || project.title}
                    </p>
                  </div>
                  <Badge variant={
                    project.status === 'analysis' ? 'analysis' :
                    project.status === 'documentation' ? 'progress' :
                    'progress'
                  }>
                    {statusLabels[project.status]}
                  </Badge>
                </button>
              ))}
              {inProgressProjects.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  Nenhum projeto em andamento
                </p>
              )}
            </div>
          </motion.div>

          {/* Recent Comments */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="kpi-card"
          >
            <h3 className="text-lg font-semibold text-card-foreground mb-6">Comentários Recentes</h3>
            <div className="space-y-4">
              {recentComments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-primary">
                      {comment.userName?.charAt(0) || 'U'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-card-foreground truncate">
                        {comment.userName || 'Usuário'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {comment.message}
                    </p>
                  </div>
                </div>
              ))}
              {recentComments.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  Nenhum comentário recente
                </p>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </MainLayout>
  );
}
