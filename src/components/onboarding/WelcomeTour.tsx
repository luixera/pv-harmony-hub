import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import {
  Building2, Users, Sun, Mail, Rocket, Kanban, CheckSquare, Map,
  PlusCircle, FolderOpen, DollarSign, ArrowRight, Check, PartyPopper,
} from 'lucide-react';

export interface TourStep {
  icon: React.ElementType;
  title: string;
  body: string;
  /** Rótulo do botão que leva à tela (opcional). */
  actionLabel?: string;
  actionPath?: string;
  /** Marca como "essencial para a ferramenta funcionar". */
  essential?: boolean;
}

/** Passos do tour por tipo de usuário. */
function stepsForRole(role: string | undefined, tenantName: string): { intro: string; steps: TourStep[] } {
  if (role === 'company') {
    return {
      intro: 'Aqui você abre e acompanha suas homologações do começo ao fim.',
      steps: [
        { icon: PlusCircle, title: 'Abra um novo projeto', body: 'Cadastre uma nova homologação preenchendo os dados do titular, endereço e equipamentos. É por aqui que tudo começa.', actionLabel: 'Novo Projeto', actionPath: '/new-project', essential: true },
        { icon: FolderOpen, title: 'Acompanhe seus projetos', body: 'Veja o andamento de cada projeto, os documentos e o status em tempo real.', actionLabel: 'Meus Projetos', actionPath: '/company/projects' },
        { icon: DollarSign, title: 'Financeiro', body: 'Consulte valores, pagamentos e o que está em aberto.', actionLabel: 'Financeiro', actionPath: '/company/financial' },
      ],
    };
  }
  if (role === 'staff') {
    return {
      intro: 'Você acompanha e toca os projetos da equipe pelo fluxo de homologação.',
      steps: [
        { icon: Kanban, title: 'Kanban de Projetos', body: 'Arraste os projetos pelas etapas (recebido, análise, protocolo, aprovado…). É o seu painel de trabalho.', actionLabel: 'Abrir Kanban', actionPath: '/projects', essential: true },
        { icon: CheckSquare, title: 'Tarefas', body: 'Suas pendências e prazos ficam aqui — nada se perde.', actionLabel: 'Ver Tarefas', actionPath: '/tasks' },
        { icon: Mail, title: 'E-mails das concessionárias', body: 'O Claudinho lê os e-mails, vincula ao projeto certo pelo nº de protocolo e sugere o que mudou. Você revisa e decide o que aplicar — nada muda no projeto sozinho.', actionLabel: 'Ver E-mails', actionPath: '/email-updates' },
        { icon: Map, title: 'Mapa de projetos', body: 'Veja os projetos por localização.', actionLabel: 'Abrir Mapa', actionPath: '/projects-map' },
      ],
    };
  }
  // admin (fundador do tenant) — foco em deixar a ferramenta pronta para uso
  return {
    intro: `Vamos deixar a ${tenantName} pronta para operar. Dois passos são essenciais; o resto já vem configurado.`,
    steps: [
      { icon: Building2, title: '1. Cadastre suas empresas', body: 'Empresas são os integradores/clientes que enviam projetos. Todo projeto pertence a uma empresa — por isso este é o primeiro passo.', actionLabel: 'Ir para Empresas', actionPath: '/admin/companies', essential: true },
      { icon: Users, title: '2. Convide sua equipe', body: 'Crie usuários para seus colaboradores (staff) e defina o que cada um acessa.', actionLabel: 'Ir para Usuários', actionPath: '/admin/users', essential: true },
      { icon: Sun, title: 'Concessionárias já prontas', body: 'Seu ambiente já veio com as concessionárias, regras de padrão de entrada e o pacote do projetista da biblioteca GD Manager. Ajuste os templates se precisar.', actionLabel: 'Ver Concessionárias', actionPath: '/admin/energy-concessionaires' },
      { icon: Mail, title: 'Ative o Claudinho (opcional)', body: 'Conecte um e-mail para o assistente ler as respostas das concessionárias, vincular ao projeto pelo protocolo e sugerir a etapa. A aplicação da mudança continua sendo sua — a atualização automática é um passo futuro.', actionLabel: 'Configurar E-mails', actionPath: '/email-updates' },
      { icon: Rocket, title: 'Comece a receber projetos', body: 'Cada empresa tem um link público de formulário para o cliente enviar o projeto — ou cadastre manualmente. Pronto para começar!', actionLabel: 'Abrir Kanban', actionPath: '/projects' },
    ],
  };
}

interface Props {
  onFinish: () => void;
  /** Fecha sem marcar como concluído (usado no modo "rever tour"). */
  onClose?: () => void;
}

export function WelcomeTour({ onFinish, onClose }: Props) {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  const navigate = useNavigate();
  const [i, setI] = useState(0);

  const { intro, steps } = useMemo(
    () => stepsForRole(user?.role, tenant?.name || 'sua empresa'),
    [user?.role, tenant?.name],
  );

  const step = steps[i];
  const isFirst = i === 0;
  const isLast = i === steps.length - 1;
  const roleLabel = user?.role === 'company' ? 'Empresa' : user?.role === 'staff' ? 'Colaborador' : 'Administrador';

  const go = (path: string) => { onFinish(); navigate(path); };
  const StepIcon = step.icon;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) (onClose ?? onFinish)(); }}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">
        {/* Cabeçalho */}
        <div className="bg-gradient-to-br from-[#1A1A1A] to-[#2D2D2D] px-6 py-5 text-white">
          <div className="flex items-center gap-2 mb-1">
            <PartyPopper className="w-4 h-4 text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              Bem-vindo · {roleLabel}
            </span>
          </div>
          <h2 className="text-lg font-bold leading-snug">{isFirst ? `Olá, ${user?.name?.split(' ')[0] ?? ''}!` : step.title}</h2>
          {isFirst && <p className="text-sm text-white/70 mt-1">{intro}</p>}
        </div>

        {/* Corpo do passo */}
        <div className="px-6 py-5">
          <div className="flex items-start gap-4">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${step.essential ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
              <StepIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              {!isFirst && step.essential && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-primary">Essencial</span>
              )}
              {isFirst && <p className="text-sm font-semibold text-foreground mb-1">{step.title}{step.essential && <span className="ml-2 text-[10px] font-bold uppercase text-primary">Essencial</span>}</p>}
              <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              {step.actionPath && (
                <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => go(step.actionPath!)}>
                  {step.actionLabel} <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Rodapé: progresso + navegação */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {steps.map((_, idx) => (
              <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={() => setI(i - 1)}>Voltar</Button>
            )}
            {!isLast ? (
              <>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onFinish}>Pular</Button>
                <Button size="sm" onClick={() => setI(i + 1)}>Próximo</Button>
              </>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={onFinish}><Check className="w-4 h-4" /> Concluir</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
