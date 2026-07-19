import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import MasterPanel from '@/pages/master/MasterPanel';
import { OverviewSection, AccessSection, UsageSection, FinanceSection } from './ConsoleSections';
import { MonitoringSection } from './MonitoringSection';
import { Crown, LogOut, Loader2, Building2, LayoutGrid, Activity, BarChart3, DollarSign, Lock, Sun, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

type Section = 'tenants' | 'overview' | 'access' | 'usage' | 'finance' | 'monitoring';

const NAV: { key: Section; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Visão geral', icon: LayoutGrid },
  { key: 'tenants', label: 'Tenants', icon: Building2 },
  { key: 'access', label: 'Acessos', icon: Activity },
  { key: 'usage', label: 'Uso da plataforma', icon: BarChart3 },
  { key: 'finance', label: 'Financeiro', icon: DollarSign },
  { key: 'monitoring', label: 'Monitoramento', icon: ShieldAlert },
];

export default function PainelConsole() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  const [section, setSection] = useState<Section>('overview');

  if (isLoading) {
    return <div style={centerScreen}><Loader2 size={28} className="animate-spin" style={{ color: '#F5A800' }} /></div>;
  }

  // Não logado → tela de login própria do console
  if (!isAuthenticated || !user) return <ConsoleLogin onLogin={login} />;

  // Logado mas não é master → acesso negado
  if (!user.isMaster) {
    return (
      <div style={centerScreen}>
        <div style={cardStyle}>
          <Lock size={30} style={{ color: '#F5A800' }} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '14px 0 6px' }}>Acesso restrito</h1>
          <p style={{ fontSize: 13, color: '#999', margin: '0 0 18px', textAlign: 'center' }}>
            Esta área é exclusiva da administração da plataforma.
          </p>
          <button onClick={logout} style={goldBtn}>Sair</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0E0E14', display: 'flex' }}>
      {/* Sidebar do console */}
      <aside style={{ width: 230, background: '#16161F', borderRight: '1px solid rgba(255,255,255,0.06)', padding: '18px 12px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 18px' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#F5A800', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Crown size={17} style={{ color: '#1A1A1A' }} />
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0 }}>Console</p>
            <p style={{ fontSize: 10, color: '#888', margin: 0 }}>GD Manager · Plataforma</p>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {NAV.map(n => {
            const active = section === n.key;
            return (
              <button key={n.key} onClick={() => setSection(n.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13,
                  background: active ? 'rgba(245,168,0,0.12)' : 'transparent',
                  color: active ? '#F5A800' : '#bbb',
                }}>
                <n.icon size={16} /> <span style={{ flex: 1 }}>{n.label}</span>
              </button>
            );
          })}
        </nav>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
          <p style={{ fontSize: 11, color: '#888', margin: '0 8px 8px' }}>{user.name}</p>
          <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.05)', color: '#bbb', fontSize: 12, cursor: 'pointer' }}>
            <LogOut size={14} /> Sair do console
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main style={{ flex: 1, padding: '24px 24px', overflowY: 'auto', maxHeight: '100vh' }}>
        {section === 'overview' && <OverviewSection />}
        {section === 'tenants' && <MasterPanel embedded />}
        {section === 'access' && <AccessSection />}
        {section === 'usage' && <UsageSection />}
        {section === 'finance' && <FinanceSection />}
        {section === 'monitoring' && <MonitoringSection />}
      </main>
    </div>
  );
}

function ConsoleLogin({ onLogin }: { onLogin: (e: string, p: string) => Promise<{ success: boolean; error?: string }> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password) return;
    setLoading(true);
    const res = await onLogin(email.trim(), password);
    setLoading(false);
    if (!res.success) toast.error(res.error ?? 'Falha no login');
  };

  return (
    <div style={centerScreen}>
      <div style={{ ...cardStyle, width: 'min(380px, 92vw)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: '#F5A800', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Sun size={22} style={{ color: '#1A1A1A' }} />
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>Console da Plataforma</h1>
        <p style={{ fontSize: 12, color: '#888', margin: '0 0 20px' }}>Acesso exclusivo da administração</p>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail" type="email" style={inp} onKeyDown={e => e.key === 'Enter' && submit()} />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Senha" type="password" style={{ ...inp, marginTop: 10 }} onKeyDown={e => e.key === 'Enter' && submit()} />
        <button onClick={submit} disabled={loading} style={{ ...goldBtn, width: '100%', marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : null} Entrar
        </button>
      </div>
    </div>
  );
}

const centerScreen: React.CSSProperties = { minHeight: '100vh', background: '#0E0E14', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, sans-serif' };
const cardStyle: React.CSSProperties = { background: '#16161F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const inp: React.CSSProperties = { width: '100%', padding: '11px 13px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: '#0E0E14', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const goldBtn: React.CSSProperties = { padding: '11px 22px', borderRadius: 9, border: 'none', background: '#F5A800', color: '#1A1A1A', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
