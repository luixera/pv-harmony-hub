import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, CheckSquare, DollarSign, FolderOpen, Kanban, PlusCircle, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLudmillaDisponivel } from '@/hooks/useLudmilla';
import { cn } from '@/lib/utils';
import { atalhosDaBarra, type PapelDoUsuario } from '@/mobile/atalhos';

/** Ícone por chave do atalho — a lógica de QUAIS atalhos vive em `mobile/atalhos.ts`. */
const ICONE = {
  projetos: Kanban,
  tarefas: CheckSquare,
  avisos: Bell,
  perfil: User,
  novo: PlusCircle,
  financeiro: DollarSign,
  documentos: FolderOpen,
} as const;

/** A Ludmilla só existe para a equipe do GD Manager; os demais não têm esse destino. */
const CAMINHO_LUDMILLA = '/ludmilla';

/**
 * Barra de atalhos do celular. Com `items-stretch` dentro de `h-16` cada botão já
 * ocupa ~63 px; o `min-h-[44px]` é só o piso garantido de alvo de toque. Nenhum
 * item fica desabilitado: atalho que não leva a lugar nenhum é ruído.
 */
export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Hook antes de qualquer retorno antecipado (regra dos hooks).
  const ludmillaDisponivel = useLudmillaDisponivel();

  const itens = atalhosDaBarra(user?.role as PapelDoUsuario | undefined)
    .filter(item => item.caminho !== CAMINHO_LUDMILLA || ludmillaDisponivel);
  if (itens.length === 0) return null;

  return (
    <nav aria-label="Atalhos" className="fixed bottom-0 left-0 right-0 z-30 bg-sidebar border-t border-sidebar-border flex items-stretch h-16 safe-area-bottom">
      {itens.map(item => {
        const Icone = ICONE[item.chave as keyof typeof ICONE] ?? Kanban;
        const ativo = location.pathname === item.caminho;
        return (
          <button
            key={item.caminho}
            onClick={() => navigate(item.caminho)}
            aria-label={item.rotulo}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] text-[11px] transition-colors',
              ativo ? 'text-sidebar-primary' : 'text-sidebar-foreground/60',
            )}
          >
            <Icone size={20} aria-hidden="true" />
            {item.rotulo}
          </button>
        );
      })}
    </nav>
  );
}
