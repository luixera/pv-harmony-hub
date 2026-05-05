import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { Loader2, Mail, Lock, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated, user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  if (!authLoading && isAuthenticated && user) {
    const dashboardMap: Record<string, string> = {
      admin: '/dashboard-admin',
      staff: '/dashboard-staff',
      company: '/dashboard-company',
    };
    navigate(dashboardMap[user.role] || '/dashboard-company', { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Preencha todos os campos');
      return;
    }

    if (!email.includes('@')) {
      toast.error('Email inválido');
      return;
    }

    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setIsLoading(true);
    
    const result = await login(email, password);
    
    if (result.success) {
      toast.success('Login realizado com sucesso!');
    } else {
      toast.error(result.error || 'Erro ao fazer login');
    }
    
    setIsLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#1A1A1A' }}>
      {/* Left Panel - Branding */}
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

        <div className="relative z-10 space-y-6">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Gestão inteligente de<br />
            <span style={{ color: '#F5A800' }}>projetos fotovoltaicos</span>
          </h1>
          <p className="text-lg max-w-md" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Simplifique a homologação dos seus projetos solares com uma plataforma completa e intuitiva.
          </p>

          <div className="flex gap-8 pt-4">
            <div>
              <p className="text-3xl font-bold" style={{ color: '#F5A800' }}>500+</p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Projetos gerenciados</p>
            </div>
            <div>
              <p className="text-3xl font-bold" style={{ color: '#F5A800' }}>50+</p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Empresas ativas</p>
            </div>
            <div>
              <p className="text-3xl font-bold" style={{ color: '#F5A800' }}>98%</p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Taxa de aprovação</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
          © 2024 GD Manager. Todos os direitos reservados.
        </div>
      </motion.div>

      {/* Right Panel - Login Form */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 flex items-center justify-center p-8"
        style={{ background: '#1A1A1A' }}
      >
        <div className="w-full max-w-md space-y-8 rounded-2xl p-8" style={{ background: '#242424', border: '1px solid rgba(255,255,255,0.1)' }}>
          {/* Mobile Logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src="/logo.png" alt="All Energy" style={{ width: 80, height: 80, objectFit: 'contain', display: 'block', margin: '0 auto 12px' }} />
            <span className="font-bold text-xl text-white">GD Manager</span>
            <span className="text-sm font-medium" style={{ color: '#F5A800' }}>All Energy Engenharia</span>
          </div>

          <div className="text-center lg:text-left">
            <h2 className="text-2xl font-bold text-white">Bem-vindo de volta</h2>
            <p className="mt-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Entre com suas credenciais para acessar o sistema
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" style={{ color: 'rgba(255,255,255,0.7)' }}>Email</Label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-12"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'white' }}
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" style={{ color: 'rgba(255,255,255,0.7)' }}>Senha</Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-12"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'white' }}
                  autoComplete="current-password"
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link
                to="/forgot-password"
                className="text-sm hover:underline"
                style={{ color: '#F5A800' }}
              >
                Esqueci minha senha
              </Link>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full font-semibold"
              style={{ background: '#F5A800', color: '#1A1A1A' }}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </Button>
          </form>

          {/* Info */}
          <div className="pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="text-sm text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Para criar uma conta, entre em contato com o administrador do sistema.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
