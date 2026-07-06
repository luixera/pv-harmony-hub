import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, tenantBlockReason } from '@/hooks/useTenant';
import { Lock, Clock } from 'lucide-react';

const REASON_COPY: Record<string, { title: string; message: string; icon: 'lock' | 'clock' }> = {
  suspended: {
    title: 'Assinatura suspensa',
    message: 'O acesso da sua empresa à plataforma está temporariamente suspenso. Entre em contato com o suporte para regularizar.',
    icon: 'lock',
  },
  canceled: {
    title: 'Assinatura cancelada',
    message: 'A assinatura da sua empresa foi encerrada. Seus dados estão preservados — fale com o suporte para reativar.',
    icon: 'lock',
  },
  expired: {
    title: 'Assinatura vencida',
    message: 'O período pago da assinatura terminou. Regularize o pagamento para retomar o acesso — seus dados estão preservados.',
    icon: 'clock',
  },
  trial_ended: {
    title: 'Período de teste encerrado',
    message: 'Seu período de avaliação terminou. Contrate um plano para continuar usando a plataforma — seus dados estão preservados.',
    icon: 'clock',
  },
};

/**
 * Bloqueia o app inteiro quando o tenant do usuário está suspenso/vencido.
 * Master nunca é bloqueado. O RLS já corta o acesso aos dados no servidor
 * (get_user_tenant_id retorna NULL para tenant bloqueado) — esta tela só
 * explica o motivo de forma amigável.
 */
export function TenantGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { data: tenant, isLoading } = useTenant();

  if (!user || user.isMaster || isLoading) return <>{children}</>;

  const reason = tenantBlockReason(tenant);
  if (!reason) return <>{children}</>;

  const copy = REASON_COPY[reason];

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: '#F0F0F0', padding: 24, textAlign: 'center',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%', background: '#FEF3D0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {copy.icon === 'lock'
          ? <Lock size={32} style={{ color: '#B45309' }} />
          : <Clock size={32} style={{ color: '#B45309' }} />}
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{copy.title}</h1>
      <p style={{ fontSize: 14, color: '#666', maxWidth: 420, lineHeight: 1.6, margin: 0 }}>
        {copy.message}
      </p>
      {tenant?.name && (
        <p style={{ fontSize: 12, color: '#999', margin: 0 }}>Empresa: {tenant.name}</p>
      )}
      <button
        onClick={logout}
        style={{
          marginTop: 8, padding: '9px 22px', borderRadius: 8, border: 'none',
          background: '#F5A800', color: '#1A1A1A', fontWeight: 700, fontSize: 13, cursor: 'pointer',
        }}
      >
        Sair
      </button>
    </div>
  );
}
