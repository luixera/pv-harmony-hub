import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';

/**
 * Motor de templates de diagrama unifilar (aba própria + edição no modal do
 * projeto): por decisão do usuário (jul/2026), fica restrito à GD Manager
 * por enquanto — projetista (staff) e administrador do próprio tenant
 * `is_library` (hoje só a GD Manager). `company` nunca tem acesso. Master
 * (role admin + tenant GD Manager) já cai nessa regra sem precisar de
 * caso especial — ver ADR 0006.
 *
 * Liberar para todos os tenants no futuro é só remover a checagem de
 * `is_library` — o resto (RLS por tenant_id em `diagram_templates`) já está
 * pronto para isso.
 */
export function useDiagramEngineAccess(): boolean {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  if (!user) return false;
  const roleOk = user.role === 'admin' || user.role === 'staff';
  return roleOk && !!tenant?.is_library;
}
