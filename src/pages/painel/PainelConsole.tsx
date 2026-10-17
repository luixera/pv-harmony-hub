import { useEffect, useState } from 'react';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useAuth } from '@/contexts/AuthContext';
import MasterPanel from '@/pages/master/MasterPanel';
import { OverviewSection, AccessSection, UsageSection, FinanceSection, AiSection } from './ConsoleSections';
import { MonitoringSection } from './MonitoringSection';
import { NetworkSection } from './NetworkSection';
import { EletropostosSection } from './EletropostosSection';
import { Crown, LogOut, Loader2, Building2, LayoutGrid, Activity, BarChart3, DollarSign, Lock, Sun, ShieldAlert, Bot, Zap, PlugZap, Menu, X } from 'lucide-react';
import { toast } from 'sonner';

type Section = 'tenants' | 'overview' | 'access' | 'usage' | 'finance' | 'ai' | 'network' | 'eletropostos' | 'monitoring';

const NAV: { key: Section; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Visão geral', icon: LayoutGrid },
  { key: 'tenants', label: 'Tenants', icon: Building2 },
  { key: 'access', label: 'Acessos', icon: Activity },
  { key: 'usage', label: 'Uso da plataforma', icon: BarChart3 },
  { key: 'finance', label: 'Financeiro', icon: DollarSign },
  { key: 'ai', label: 'Agentes de IA', icon: Bot },
  { key: 'network', label: 'Capacidade de rede', icon: Zap },
  { key: 'eletropostos', label: 'Eletropostos', icon: PlugZap },
  { key: 'monitoring', label: 'Monitoramento', icon: ShieldAlert },
];

export default function PainelConsole() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  const [section, setSection] = useState<Section>('overview');
  const { isMobile } = useWindowSize();
  const [gaveta, setGaveta] = useState(false);
  // a gaveta não sobrevive a girar o aparelho para paisagem/desktop
  useEffect(() => { if (!isMobile) setGaveta(false); }, [isMobile]);

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

  const escolher = (k: Section) => { setSection(k); setGaveta(false); };
  const atual = NAV.find(n => n.key === section);

  const marca = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 18px' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#F5A800', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Crown size={17} style={{ color: '#1A1A1A' }} />
      </div>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0 }}>Console</p>
        <p style={{ fontSize: 10, color: '#888', margin: 0 }}>GD Manager · Plataforma</p>
      </div>
    </div>
  );
  const navegacao = (
    <>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {NAV.map(n => {
          const active = section === n.key;
          return (
            <button key={n.key} onClick={() => escolher(n.key)} aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '12px 10px' : '9px 10px', borderRadius: 8,
                border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: isMobile ? 14 : 13, minHeight: isMobile ? 44 : undefined,
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
        <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px', minHeight: 40, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.05)', color: '#bbb', fontSize: 12, cursor: 'pointer' }}>
          <LogOut size={14} /> Sair do console
        </button>
      </div>
    </>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0E0E14', display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
      {isMobile ? (
        <>
          {/* Celular: barra fixa no topo; o menu abre numa gaveta por cima do conteúdo */}
          <header style={{ position: 'sticky', top: 0, zIndex: 900, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: '#16161F', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => setGaveta(true)} aria-label="Abrir o menu do console" aria-expanded={gaveta}
              style={{ all: 'unset', cursor: 'pointer', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: '#ddd' }}>
              <Menu size={20} />
            </button>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: '#F5A800', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <Crown size={14} style={{ color: '#1A1A1A' }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {atual?.label ?? 'Console'}
            </span>
          </header>
          {gaveta && (
            <div role="dialog" aria-modal="true" aria-label="Menu do console" style={{ position: 'fixed', inset: 0, zIndex: 1100 }}>
              <div onClick={() => setGaveta(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
              <aside style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 'min(280px, 82vw)', background: '#16161F',
                borderRight: '1px solid rgba(255,255,255,0.06)', padding: '14px 12px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  {marca}
                  <button onClick={() => setGaveta(false)} aria-label="Fechar o menu"
                    style={{ all: 'unset', cursor: 'pointer', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>
                    <X size={18} />
                  </button>
                </div>
                {navegacao}
              </aside>
            </div>
          )}
        </>
      ) : (
        /* Sidebar do console */
        <aside style={{ width: 230, background: '#16161F', borderRight: '1px solid rgba(255,255,255,0.06)', padding: '18px 12px', display: 'flex', flexDirection: 'column' }}>
          {marca}
          {navegacao}
        </aside>
      )}

      {/* Conteúdo — no celular a página rola inteira (sem rolagem interna) */}
      <main style={isMobile
        ? { flex: 1, padding: '14px 12px 40px', minWidth: 0 }
        : { flex: 1, padding: '24px 24px', overflowY: 'auto', maxHeight: '100vh', minWidth: 0 }}>
        {section === 'overview' && <OverviewSection />}
        {section === 'tenants' && <MasterPanel embedded />}
        {section === 'access' && <AccessSection />}
        {section === 'usage' && <UsageSection />}
        {section === 'finance' && <FinanceSection />}
        {section === 'ai' && <AiSection />}
        {section === 'network' && <NetworkSection />}
        {section === 'eletropostos' && <EletropostosSection />}
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
