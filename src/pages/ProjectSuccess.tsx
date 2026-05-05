import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle, Sun, Plus, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { MainLayout } from '@/components/layout/MainLayout';

export default function ProjectSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if we're in "view as company" mode (admin viewing company environment)
  const isViewingAsCompany = !!sessionStorage.getItem('viewingAsCompany');
  const viewingCompany = isViewingAsCompany ? JSON.parse(sessionStorage.getItem('viewingAsCompany') || '{}') : null;

  const handleDashboard = () => {
    if (isViewingAsCompany) {
      navigate('/admin/view-as-company');
    } else {
      navigate('/dashboard-company');
    }
  };

  const handleNewProject = () => {
    // Always use the new project page - it handles context properly
    navigate('/new-project');
  };

  return (
    <MainLayout>
      <div className="max-w-lg mx-auto py-12 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', duration: 0.5 }}
          className="w-24 h-24 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-6"
        >
          <CheckCircle className="w-12 h-12 text-success" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h1 className="text-2xl font-bold text-foreground mb-4">
            Projeto Enviado com Sucesso!
          </h1>
          <p className="text-muted-foreground mb-8">
            Seu projeto foi criado e está aguardando análise. 
            Você pode acompanhar o andamento pelo painel.
          </p>
          
          <div className="bg-muted/30 rounded-lg p-6 text-left mb-8">
            <h3 className="font-semibold text-card-foreground mb-3">Próximos passos:</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-primary">1</span>
                Análise dos documentos enviados
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-primary">2</span>
                Elaboração do projeto técnico
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-primary">3</span>
                Submissão à concessionária
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-primary">4</span>
                Aprovação e conclusão
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Button variant="outline" onClick={handleDashboard} className="flex-1">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {isViewingAsCompany ? 'Voltar para Dashboard da Empresa' : 'Voltar para Dashboard'}
            </Button>
            <Button variant="cta" onClick={handleNewProject} className="flex-1">
              <Plus className="w-4 h-4 mr-2" />
              Enviar novo projeto
            </Button>
          </div>
        </motion.div>
      </div>
    </MainLayout>
  );
}
