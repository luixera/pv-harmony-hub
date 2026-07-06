import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Turnstile } from '@marsidev/react-turnstile';
import { toast } from 'sonner';
import { Sun, ArrowLeft, Loader2, MailCheck, ShieldCheck, Check } from 'lucide-react';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const GOLD = '#F5A800';
const GOLD_SOFT = '#FEF3D0';
const DARK = '#1A1A1A';

interface PublicPlan { slug: string; name: string; price_cents: number }

function usePublicPlans() {
  return useQuery({
    queryKey: ['public-plans'],
    queryFn: async (): Promise<PublicPlan[]> => {
      const { data, error } = await supabase
        .from('plans' as never)
        .select('slug, name, price_cents')
        .neq('slug', 'interno').eq('is_active', true)
        .order('price_cents', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PublicPlan[];
    },
  });
}

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '0.5px solid #DBDBDB',
  fontSize: 14, outline: 'none', background: '#fff', color: DARK, boxSizing: 'border-box', fontFamily: 'inherit',
};

export default function Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: plans = [] } = usePublicPlans();

  const [companyName, setCompanyName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [planSlug, setPlanSlug] = useState(params.get('plano') || 'pro');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const p = params.get('plano');
    if (p && ['basico', 'pro'].includes(p)) setPlanSlug(p);
  }, [params]);

  const handleSubmit = async () => {
    if (!companyName.trim() || !adminName.trim() || !adminEmail.trim() || adminPassword.length < 6) {
      toast.error('Preencha todos os campos. A senha precisa de ao menos 6 caracteres.');
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      toast.error('Complete a verificação de segurança.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('signup-tenant', {
        body: {
          companyName: companyName.trim(),
          cnpj: cnpj.trim() || undefined,
          planSlug,
          adminName: adminName.trim(),
          adminEmail: adminEmail.trim(),
          adminPassword,
          turnstileToken,
        },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); setSubmitting(false); return; }

      // Dispara o e-mail de confirmação (serviço de e-mail do Supabase)
      await supabase.auth.resend({ type: 'signup', email: adminEmail.trim().toLowerCase() });
      setDone(true);
    } catch (e: unknown) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar a conta. Tente novamente.');
      setSubmitting(false);
    }
  };

  // Tela de confirmação
  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '0.5px solid #EAEAEA', padding: '40px 32px', maxWidth: 440, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: GOLD_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <MailCheck size={30} color="#B47600" />
          </div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: DARK, margin: '0 0 10px' }}>Confirme seu e-mail</h1>
          <p style={{ fontSize: 14, color: '#5F5F5F', lineHeight: 1.6, margin: '0 0 8px' }}>
            Enviamos um link de confirmação para <strong>{adminEmail.trim().toLowerCase()}</strong>.
            Clique nele para ativar sua conta e começar o teste grátis de 14 dias.
          </p>
          <p style={{ fontSize: 12, color: '#8A8A8A', margin: '0 0 22px' }}>
            Não recebeu? Verifique a caixa de spam.
          </p>
          <button onClick={() => navigate('/login')} style={{ background: GOLD, color: DARK, border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '11px 24px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F0F0F0', fontFamily: 'Inter, sans-serif' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', background: DARK }}>
        <button onClick={() => navigate('/')} style={{ width: 34, height: 34, borderRadius: 8, border: '0.5px solid #3A3A3A', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <ArrowLeft size={16} color="#E5E5E5" />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sun size={17} color={DARK} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>GD Manager</span>
        </div>
      </nav>

      <div style={{ maxWidth: 460, margin: '0 auto', padding: '36px 24px 48px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: DARK, margin: '0 0 6px', textAlign: 'center' }}>Crie sua conta grátis</h1>
        <p style={{ fontSize: 14, color: '#8A8A8A', margin: '0 0 26px', textAlign: 'center' }}>14 dias de teste · sem cartão de crédito</p>

        <div style={{ background: '#fff', borderRadius: 14, border: '0.5px solid #EAEAEA', padding: 24 }}>
          {/* Escolha do plano */}
          <label style={lbl}>Plano</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {plans.map(p => {
              const active = planSlug === p.slug;
              return (
                <button key={p.slug} type="button" onClick={() => setPlanSlug(p.slug)}
                  style={{
                    padding: '12px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', background: '#fff',
                    border: active ? `2px solid ${GOLD}` : '0.5px solid #DBDBDB', fontFamily: 'inherit', position: 'relative',
                  }}>
                  {active && <Check size={15} color="#B47600" style={{ position: 'absolute', top: 10, right: 10 }} />}
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: DARK }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8A8A8A', marginTop: 2 }}>
                    {p.price_cents > 0 ? `R$ ${(p.price_cents / 100).toLocaleString('pt-BR')}/mês` : 'Sob consulta'}
                  </span>
                </button>
              );
            })}
          </div>

          <label style={lbl}>Nome da empresa *</label>
          <input value={companyName} onChange={e => setCompanyName(e.target.value)} style={{ ...inp, marginBottom: 14 }} placeholder="Sua empresa de energia solar" />

          <label style={lbl}>CNPJ</label>
          <input value={cnpj} onChange={e => setCnpj(e.target.value)} style={{ ...inp, marginBottom: 14 }} placeholder="00.000.000/0001-00" />

          <div style={{ height: 1, background: '#F0F0F0', margin: '4px 0 18px' }} />
          <p style={{ fontSize: 12, fontWeight: 700, color: '#777', margin: '0 0 12px' }}>Seus dados de acesso</p>

          <label style={lbl}>Seu nome *</label>
          <input value={adminName} onChange={e => setAdminName(e.target.value)} style={{ ...inp, marginBottom: 14 }} placeholder="Nome completo" />

          <label style={lbl}>E-mail *</label>
          <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} style={{ ...inp, marginBottom: 14 }} placeholder="voce@suaempresa.com.br" />

          <label style={lbl}>Senha * (mín. 6 caracteres)</label>
          <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} style={{ ...inp, marginBottom: 18 }} placeholder="••••••••" />

          {TURNSTILE_SITE_KEY && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7280' }}>
                <ShieldCheck size={14} color="#10B981" /><span>Verificação de segurança</span>
              </div>
              <Turnstile
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setTurnstileToken}
                onExpire={() => setTurnstileToken(null)}
                onError={() => { setTurnstileToken(null); toast.error('Erro no CAPTCHA. Recarregue a página.'); }}
                options={{ theme: 'light', language: 'pt-BR' }}
              />
            </div>
          )}

          <button onClick={handleSubmit} disabled={submitting}
            style={{ width: '100%', padding: '12px 0', borderRadius: 8, border: 'none', background: GOLD, color: DARK, fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}>
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Criando conta...</> : 'Criar conta e começar'}
          </button>

          <p style={{ fontSize: 12, color: '#8A8A8A', textAlign: 'center', margin: '16px 0 0' }}>
            Já tem conta? <Link to="/login" style={{ color: '#B47600', fontWeight: 600, textDecoration: 'none' }}>Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#777', marginBottom: 6 };
