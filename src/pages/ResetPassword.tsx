import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

function getPasswordStrength(password: string): { level: 'weak' | 'medium' | 'strong'; label: string; color: string; width: string } {
  if (password.length === 0) return { level: 'weak', label: '', color: '#E0E0E0', width: '0%' };
  if (password.length < 6) return { level: 'weak', label: 'Fraca', color: '#EF4444', width: '33%' };
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const score = (hasNumber ? 1 : 0) + (hasSpecial ? 1 : 0) + (hasUpper ? 1 : 0) + (password.length >= 10 ? 1 : 0);
  if (score >= 3) return { level: 'strong', label: 'Forte', color: '#2D6A4F', width: '100%' };
  if (score >= 1) return { level: 'medium', label: 'Média', color: '#F5A800', width: '66%' };
  return { level: 'weak', label: 'Fraca', color: '#EF4444', width: '33%' };
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    // Supabase sets the session from the URL hash after the user clicks the link
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setHasSession(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const passwordsDontMatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setIsLoading(true);
    try {
      const { error: sbError } = await supabase.auth.updateUser({ password: newPassword });
      if (sbError) throw sbError;
      toast.success('Senha redefinida com sucesso!');
      navigate('/login');
    } catch (err: any) {
      setError(err.message || 'Erro ao redefinir senha. Tente novamente.');
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
            Crie uma senha<br />
            <span style={{ color: '#F5A800' }}>forte e segura</span>
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16 }}>
            Escolha uma senha com pelo menos 8 caracteres, incluindo letras, números e símbolos.
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
            <img src="/logo.png" alt="All Energy" style={{ width: 64, height: 64, objectFit: 'contain', margin: '0 auto 12px' }} />
            <span className="font-bold text-xl text-white">GD Manager</span>
          </div>

          {!hasSession ? (
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 20 }}>
                Link de recuperação inválido ou expirado.
              </p>
              <Button onClick={() => navigate('/forgot-password')} style={{ background: '#F5A800', color: '#1A1A1A', borderRadius: 8, fontWeight: 600 }}>
                Solicitar novo link
              </Button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
                  Nova senha
                </h2>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
                  Digite sua nova senha abaixo
                </p>
              </div>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Nova senha */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                    Nova senha
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'rgba(255,255,255,0.3)' }} />
                    <Input
                      type={showNew ? 'text' : 'password'}
                      placeholder="Mínimo 6 caracteres"
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setError(''); }}
                      style={{ paddingLeft: 44, paddingRight: 44, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', height: 48 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(v => !v)}
                      style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 0 }}
                    >
                      {showNew ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                    </button>
                  </div>
                  {/* Password strength bar */}
                  {newPassword.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: strength.width, background: strength.color, borderRadius: 4, transition: 'all 0.3s' }} />
                      </div>
                      <p style={{ fontSize: 11, color: strength.color, marginTop: 4, fontWeight: 600 }}>{strength.label}</p>
                    </div>
                  )}
                </div>

                {/* Confirmar senha */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                    Confirmar nova senha
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'rgba(255,255,255,0.3)' }} />
                    <Input
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Repita a nova senha"
                      value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                      style={{
                        paddingLeft: 44, paddingRight: 44,
                        background: 'rgba(255,255,255,0.07)',
                        border: passwordsDontMatch
                          ? '1px solid #EF4444'
                          : passwordsMatch
                          ? '1px solid #2D6A4F'
                          : '1px solid rgba(255,255,255,0.15)',
                        color: '#fff', height: 48,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 0 }}
                    >
                      {showConfirm ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                    </button>
                    {passwordsMatch && (
                      <CheckCircle2 style={{ position: 'absolute', right: 36, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#2D6A4F' }} />
                    )}
                  </div>
                  {passwordsDontMatch && (
                    <p style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>As senhas não coincidem</p>
                  )}
                </div>

                {error && (
                  <p style={{ fontSize: 12, color: '#F87171', background: 'rgba(163,45,45,0.15)', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(163,45,45,0.3)' }}>
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={isLoading || passwordsDontMatch}
                  style={{
                    width: '100%', background: '#F5A800', color: '#1A1A1A',
                    borderRadius: 8, fontWeight: 600, height: 48, fontSize: 15,
                    opacity: passwordsDontMatch ? 0.6 : 1,
                  }}
                >
                  {isLoading ? (
                    <><Loader2 style={{ width: 18, height: 18, marginRight: 8 }} className="animate-spin" />Redefinindo...</>
                  ) : (
                    'Redefinir senha'
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
