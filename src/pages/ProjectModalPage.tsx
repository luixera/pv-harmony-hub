import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { useAuth } from '@/contexts/AuthContext';

/**
 * A rota `/project/:id` — antes a página `ProjectDetail`, agora o MODAL.
 *
 * Decisão do usuário (set/2026): unificar toda visualização de projeto no
 * modal e aposentar o ProjectDetail. Manter a rota, em vez de trocar as ~9
 * chamadas espalhadas (financeiro, mapas, dashboards, "ver como empresa"),
 * garante que todo link antigo — inclusive os já enviados por e-mail e os
 * favoritados — continue funcionando e passe a abrir o modal.
 */
export default function ProjectModalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  /** Painel do papel — nunca a landing pública, que é o que `/` serve. */
  const painel = user?.role === 'admin' ? '/dashboard-admin'
    : user?.role === 'staff' ? '/dashboard-staff'
    : '/dashboard-company';

  if (!id) return <Navigate to={painel} replace />;

  // Fechar volta para a tela anterior; quem chegou por link direto, sem
  // histórico para voltar, vai para o próprio painel.
  const fechar = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(painel, { replace: true });
  };

  return <ProjectModal projectId={id} onClose={fechar} />;
}
