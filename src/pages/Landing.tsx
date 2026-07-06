import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Bot, LayoutGrid, Map, MailCheck, Check, Sparkles, Sun } from 'lucide-react';

interface PublicPlan {
  slug: string;
  name: string;
  price_cents: number;
  max_projects_per_month: number | null;
  max_users: number | null;
  ai_analyses_per_month: number;
  features: Record<string, boolean>;
}

const GOLD = '#F5A800';
const GOLD_SOFT = '#FEF3D0';
const DARK = '#1A1A1A';
const GREEN = '#2D6A4F';

function usePublicPlans() {
  return useQuery({
    queryKey: ['public-plans'],
    queryFn: async (): Promise<PublicPlan[]> => {
      const { data, error } = await supabase
        .from('plans' as never)
        .select('slug, name, price_cents, max_projects_per_month, max_users, ai_analyses_per_month, features')
        .neq('slug', 'interno')
        .eq('is_active', true)
        .order('price_cents', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PublicPlan[];
    },
  });
}

const FEATURES = [
  { icon: Bot, title: 'Claudinho Verifica', desc: 'Envie os documentos e a IA preenche o projeto e confere a titularidade.' },
  { icon: LayoutGrid, title: 'Kanban de projetos', desc: 'Acompanhe cada homologação por etapa, do envio à aprovação.' },
  { icon: Map, title: 'Mapa de projetos', desc: 'Veja todos os projetos no mapa, filtrados por status e concessionária.' },
  { icon: MailCheck, title: 'Agente de e-mails', desc: 'Leituras da concessionária vinculadas ao projeto automaticamente.' },
];

function planBullets(p: PublicPlan): string[] {
  const bullets: string[] = [];
  bullets.push(p.max_projects_per_month ? `Até ${p.max_projects_per_month} projetos por mês` : 'Projetos ilimitados');
  bullets.push(p.max_users ? `Até ${p.max_users} usuários` : 'Usuários ilimitados');
  if (p.features?.claudinho) bullets.push('Claudinho Verifica (IA)');
  else bullets.push('Kanban e mapa');
  if (p.features?.email_agent) bullets.push('Agente de e-mails e relatórios');
  return bullets;
}

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { data: plans = [] } = usePublicPlans();

  // Quem já está logado não vê a landing — vai direto pro painel
  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(
        user.role === 'admin' ? '/dashboard-admin'
          : user.role === 'staff' ? '/dashboard-staff'
          : '/dashboard-company',
        { replace: true },
      );
    }
  }, [isAuthenticated, user, navigate]);

  const fmtPrice = (cents: number) => cents > 0
    ? `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`
    : 'Sob consulta';

  const goldBtn: React.CSSProperties = {
    background: GOLD, color: DARK, border: 'none', borderRadius: 8,
    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F0F0F0', fontFamily: 'Inter, sans-serif' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', background: DARK, position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sun size={18} color={DARK} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>GD Manager</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: GOLD }}>Energia Solar</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate('/login')} style={{ fontSize: 13, padding: '8px 16px', background: 'transparent', color: '#E5E5E5', border: '0.5px solid #3A3A3A', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>Entrar</button>
          <button onClick={() => navigate('/cadastro')} style={{ ...goldBtn, fontSize: 13, padding: '8px 16px' }}>Começar grátis</button>
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px' }}>
        {/* Hero */}
        <section style={{ textAlign: 'center', padding: '64px 0 44px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#854F0B', background: GOLD_SOFT, padding: '6px 14px', borderRadius: 20, marginBottom: 22 }}>
            <Sparkles size={15} /> Com Claudinho Verifica — IA que preenche seus projetos
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 800, color: DARK, margin: '0 0 16px', lineHeight: 1.2 }}>
            A plataforma completa para<br />homologação fotovoltaica
          </h1>
          <p style={{ fontSize: 17, color: '#5F5F5F', maxWidth: 540, margin: '0 auto 28px', lineHeight: 1.6 }}>
            Gerencie projetos, documentos, prazos e concessionárias num só lugar.
            Sua equipe mais rápida, seus clientes acompanhando tudo.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/cadastro')} style={{ ...goldBtn, fontSize: 15, padding: '13px 28px' }}>Testar grátis por 14 dias</button>
            <a href="#planos" style={{ fontSize: 15, fontWeight: 600, padding: '13px 24px', background: '#fff', color: DARK, border: '0.5px solid #DBDBDB', borderRadius: 8, textDecoration: 'none' }}>Ver planos</a>
          </div>
          <p style={{ fontSize: 13, color: '#8A8A8A', margin: '16px 0 0' }}>Sem cartão de crédito · Cadastro em 2 minutos</p>
        </section>

        {/* Recursos */}
        <section style={{ paddingBottom: 48 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
            {FEATURES.map(f => (
              <div key={f.title} style={{ background: '#fff', border: '0.5px solid #EAEAEA', borderRadius: 12, padding: 20 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: GOLD_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <f.icon size={21} color="#B47600" />
                </div>
                <p style={{ fontSize: 15, fontWeight: 600, color: DARK, margin: '14px 0 5px' }}>{f.title}</p>
                <p style={{ fontSize: 13.5, color: '#5F5F5F', margin: 0, lineHeight: 1.5 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Planos */}
        <section id="planos" style={{ paddingBottom: 56, textAlign: 'center' }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: DARK, margin: '0 0 6px' }}>Planos que crescem com você</h2>
          <p style={{ fontSize: 14, color: '#8A8A8A', margin: '0 0 28px' }}>Comece grátis. Faça upgrade quando precisar.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, textAlign: 'left', maxWidth: 640, margin: '0 auto' }}>
            {plans.map(p => {
              const isPro = p.slug === 'pro';
              return (
                <div key={p.slug} style={{ background: '#fff', border: isPro ? `2px solid ${GOLD}` : '0.5px solid #EAEAEA', borderRadius: 12, padding: 22, position: 'relative' }}>
                  {isPro && (
                    <span style={{ position: 'absolute', top: -11, left: 22, fontSize: 12, fontWeight: 600, color: '#854F0B', background: GOLD_SOFT, padding: '3px 11px', borderRadius: 20 }}>Mais popular</span>
                  )}
                  <p style={{ fontSize: 16, fontWeight: 600, color: DARK, margin: '0 0 2px' }}>{p.name}</p>
                  <p style={{ fontSize: 13, color: '#8A8A8A', margin: '0 0 14px' }}>{isPro ? 'Tudo, com IA e sem limites' : 'Para começar a organizar'}</p>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 16 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: DARK }}>{fmtPrice(p.price_cents)}</span>
                    {p.price_cents > 0 && <span style={{ fontSize: 14, color: '#8A8A8A' }}>/mês</span>}
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                    {planBullets(p).map(b => (
                      <li key={b} style={{ fontSize: 13.5, color: '#5F5F5F', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Check size={16} color={GREEN} /> {b}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => navigate(`/cadastro?plano=${p.slug}`)}
                    style={isPro
                      ? { ...goldBtn, width: '100%', marginTop: 18, fontSize: 14, padding: '11px 0' }
                      : { width: '100%', marginTop: 18, fontSize: 14, fontWeight: 600, padding: '11px 0', background: '#fff', color: DARK, border: '0.5px solid #DBDBDB', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Começar grátis
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* CTA final */}
        <section style={{ margin: '0 0 40px', padding: '40px 24px', background: DARK, borderRadius: 14, textAlign: 'center' }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>Pronto para acelerar suas homologações?</h2>
          <p style={{ fontSize: 14, color: '#B0B0B0', margin: '0 0 20px' }}>Crie sua conta e comece a usar hoje mesmo.</p>
          <button onClick={() => navigate('/cadastro')} style={{ ...goldBtn, fontSize: 15, padding: '13px 30px' }}>Criar conta grátis</button>
        </section>
      </div>

      {/* Rodapé */}
      <footer style={{ padding: '20px 24px', borderTop: '0.5px solid #DBDBDB', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: '#8A8A8A', margin: 0 }}>
          GD Manager · Homologação fotovoltaica · Já é cliente?{' '}
          <Link to="/login" style={{ color: '#B47600', fontWeight: 600, textDecoration: 'none' }}>Entrar</Link>
        </p>
      </footer>
    </div>
  );
}
