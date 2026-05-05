import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !email.includes('@')) {
      setError('Digite um e-mail válido.');
      return;
    }

    setIsLoading(true);
    try {
      const { error: sbError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (sbError) throw sbError;
      setSent(true);
    } catch (err: any) {
      setError('Não foi possível enviar o e-mail. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ background: '#1A1A1A' }}>
      {/* Left Panel */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-between relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #242424 0%, #1A1A1A 100%)' }}
      >
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top left, rgba(245,168,0,0.08) 0%, transparent 60%)' }} />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-8">
            <img src="/logo.png" alt="All Energy" style={{ width: 64, height: 64, objectFit: 'contain' }} />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-2xl text-white">GD Manager</span>
              <span className="text-sm font-medium" style={{ color: '#F5A800' }}>All Energy Engenharia</span>
            </div>
          </div>
        </div>
        <div className="relative z-10 space-y-4">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Recupere seu<br />
            <span style={{ color: '#F5A800' }}>acesso seguro</span>
          </h1>
          <p className="text-lg max-w-md" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Enviaremos um link de recuperação para o seu e-mail cadastrado.
          </p>
        </div>
        <div className="relative z-10 text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
          © 2024 GD Manager. Todos os direitos reservados.
        </div>
      </motion.div>

      {/* Right Panel */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 flex items-center justify-center p-8"
        style={{ background: '#1A1A1A' }}
      >
        <div className="w-full max-w-md rounded-2xl p-8" style={{ background: '#242424', border: '1px solid rgba(255,255,255,0.1)' }}>
          {/* Mobile Logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src="/logo.png" alt="All Energy" style={{ width: 64, height: 64, objectFit: 'contain', display: 'block', margin: '0 auto 12px' }} />
            <span className="font-bold text-xl text-white">GD Manager</span>
            <span className="text-sm font-medium" style={{ color: '#F5A800' }}>All Energy Engenharia</span>
          </div>

          {!sent ? (
            /* ── Form state ── */
            <>
              <div className="mb-8">
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
                  Recuperar senha
                </h2>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
                  Digite seu e-mail para receber as instruções de recuperação
                </p>
              </div>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: 'rgba(255,255,255,0.5)', marginBottom: 8,
                  }}>
                    E-mail
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'rgba(255,255,255,0.3)' }} />
                    <Input
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(''); }}
                      style={{
                        paddingLeft: 44,
                        background: 'rgba(255,255,255,0.07)',
                        border: error ? '1px solid #A32D2D' : '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        height: 48,
                      }}
                      autoComplete="email"
                    />
                  </div>
                  {error && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#F87171', background: 'rgba(163,45,45,0.15)', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(163,45,45,0.3)' }}>
                      {error}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  style={{
                    width: '100%', background: '#F5A800', color: '#1A1A1A',
                    borderRadius: 8, fontWeight: 600, padding: '12px 0',
                    height: 48, fontSize: 15,
                  }}
                >
                  {isLoading ? (
                    <><Loader2 style={{ width: 18, height: 18, marginRight: 8 }} className="animate-spin" />Enviando...</>
                  ) : (
                    'Enviar instruções'
                  )}
                </Button>
              </form>

              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  Lembrou a senha?{' '}
                  <span
                    onClick={() => navigate('/login')}
                    style={{ color: '#F5A800', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Voltar para o login
                  </span>
                </p>
              </div>
            </>
          ) : (
            /* ── Success state ── */
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: '#E1F5EE', display: 'flex', alignItems: 'center',
                justifyContent: 'center', margin: '0 auto 20px',
              }}>
                <CheckCircle2 style={{ width: 28, height: 28, color: '#2D6A4F' }} />
              </div>

              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 10 }}>
                E-mail enviado!
              </h2>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, marginBottom: 24 }}>
                Verifique sua caixa de entrada em{' '}
                <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{email}</strong>
                {' '}e siga as instruções para redefinir sua senha.
              </p>

              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>
                Não recebeu?{' '}
                <button
                  onClick={handleResend}
                  disabled={isLoading}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F5A800', fontWeight: 600, fontSize: 12, padding: 0 }}
                >
                  {isLoading ? 'Reenviando...' : 'Reenviar e-mail'}
                </button>
              </p>

              <Button
                onClick={() => navigate('/login')}
                style={{
                  width: '100%', background: '#F5A800', color: '#1A1A1A',
                  borderRadius: 8, fontWeight: 600, height: 48, fontSize: 15,
                }}
              >
                Voltar para o login
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
