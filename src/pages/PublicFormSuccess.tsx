import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle, Sun, Plus, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export default function PublicFormSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get company token from state if passed, or try to extract from referrer
  const token = location.state?.token;

  const handleNewProject = () => {
    if (token) {
      navigate(`/public-form/${token}`);
    } else {
      // Go back in history to the form
      navigate(-1);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Sun className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-foreground">GD Manager</h1>
            <p className="text-sm text-muted-foreground">Sistema de Homologação</p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-8 text-center">
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
            Seu projeto foi recebido e está sendo processado. 
            Você receberá atualizações por email sobre o andamento da homologação.
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

          <Button variant="cta" onClick={handleNewProject} className="w-full">
            <Plus className="w-5 h-5 mr-2" />
            Enviar novo projeto
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
