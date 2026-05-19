import { useState, useEffect, useRef, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  User, Lock, Building2, Users, Eye, EyeOff,
  Pencil, Loader2, Shield, ExternalLink, LogOut,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { sanitizeFileName } from '@/lib/utils';
import { useUsers } from '@/hooks/useUsers';

type Tab = 'info' | 'security' | 'company' | 'users';

function getPasswordStrength(pw: string): { label: string; color: string; width: string } {
  if (!pw) return { label: '', color: '#E0E0E0', width: '0%' };
  if (pw.length < 6) return { label: 'Fraca', color: '#EF4444', width: '33%' };
  const score =
    (/\d/.test(pw) ? 1 : 0) +
    (/[!@#$%^&*(),.?":{}|<>]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (pw.length >= 10 ? 1 : 0);
  if (score >= 3) return { label: 'Forte', color: '#2D6A4F', width: '100%' };
  if (score >= 1) return { label: 'Média', color: '#F5A800', width: '66%' };
  return { label: 'Fraca', color: '#EF4444', width: '33%' };
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    admin: { bg: '#FEF3D0', color: '#854F0B', label: 'Administrador' },
    staff: { bg: '#E6F1FB', color: '#185FA5', label: 'Staff' },
    company: { bg: '#E1F5EE', color: '#0F6E56', label: 'Empresa' },
  };
  const s = styles[role] || styles.staff;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
      {s.label}
    </span>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 16px', borderRadius: 8, border: 'none',
        background: active ? '#F5A800' : 'transparent',
        color: active ? '#1A1A1A' : '#6B7280',
        fontWeight: active ? 700 : 500, fontSize: 13,
        cursor: 'pointer', transition: 'all 0.2s',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon style={{ width: 15, height: 15 }} />
      {label}
    </button>
  );
}

function PasswordInput({ value, onChange, placeholder, show, onToggle, style: extraStyle }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  show: boolean;
  onToggle: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <Lock style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#9CA3AF' }} />
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ paddingLeft: 38, paddingRight: 38, ...extraStyle }}
      />
      <button
        type="button"
        onClick={onToggle}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 0 }}
      >
        {show ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
      </button>
    </div>
  );
}

function FL({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7280', marginBottom: 6 }}>
      {children}
    </label>
  );
}

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: allUsers = [] } = useUsers();

  const [activeTab, setActiveTab] = useState<Tab>('info');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null);

  // Profile info form
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [savingInfo, setSavingInfo] = useState(false);

  // Security form
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwError, setPwError] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  // Company data
  const [companyData, setCompanyData] = useState<any>(null);

  const strength = getPasswordStrength(newPw);
  const pwMatch = confirmPw.length > 0 && newPw === confirmPw;
  const pwNoMatch = confirmPw.length > 0 && newPw !== confirmPw;

  // Fetch full profile
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('phone, created_at, avatar_url')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setPhone((data as any).phone || '');
          setCreatedAt(data.created_at || null);
          if (data.avatar_url && !avatarPreview) setAvatarPreview(data.avatar_url);
        }
      });
  }, [user?.id]);

  // Fetch company if role=company
  useEffect(() => {
    if (user?.role !== 'company' || !user.companyId) return;
    supabase
      .from('companies')
      .select('name, cnpj, contact_email, contact_phone, active, created_at, contact_name')
      .eq('id', user.companyId)
      .single()
      .then(({ data }) => setCompanyData(data));
  }, [user?.role, user?.companyId]);

  const getInitials = useCallback((n: string) => {
    const parts = n.trim().split(' ');
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, []);

  const formatPhone = (v: string) => {
    const n = v.replace(/\D/g, '').slice(0, 11);
    if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return n.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  };

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { toast.error('Use JPG, PNG ou WebP'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('Tamanho máximo: 2 MB'); return; }

    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);

    try {
      const safeExt = sanitizeFileName(file.name.split('.').pop() || 'jpg');
      const filePath = `${user.id}/avatar.${safeExt}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);

      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
      await refreshUser();
      toast.success('Foto atualizada!');
    } catch (err: any) {
      toast.error('Erro ao enviar foto');
      console.error(err);
    }
  };

  // ── Save profile info ──────────────────────────────────────────────────────
  const handleSaveInfo = async () => {
    if (!user?.id) return;
    setSavingInfo(true);
    try {
      const emailChanged = email !== user.email;

      if (emailChanged) {
        const { error } = await supabase.auth.updateUser({ email });
        if (error) throw error;
      }

      await supabase.from('profiles').update({ name, phone: phone || null } as any).eq('id', user.id);
      await refreshUser();
      toast.success('Perfil atualizado!');
      if (emailChanged) toast.info('Confirme o novo e-mail nas duas caixas de entrada.');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
    } finally {
      setSavingInfo(false);
    }
  };

  // ── Change password ────────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    setPwError('');
    if (newPw.length < 6) { setPwError('A nova senha deve ter pelo menos 6 caracteres.'); return; }
    if (newPw !== confirmPw) { setPwError('As senhas não coincidem.'); return; }

    setSavingPw(true);
    try {
      // Verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: currentPw,
      });
      if (signInError) { setPwError('Senha atual incorreta.'); setSavingPw(false); return; }

      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      toast.success('Senha alterada com sucesso!');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err: any) {
      setPwError(err.message || 'Erro ao alterar senha.');
    } finally {
      setSavingPw(false);
    }
  };

  // ── Sign out all sessions ──────────────────────────────────────────────────
  const handleSignOutAll = async () => {
    await supabase.auth.signOut({ scope: 'global' });
    logout();
    navigate('/login');
  };

  // ── Tabs list ──────────────────────────────────────────────────────────────
  const tabs: { id: Tab; icon: React.ElementType; label: string; show: boolean }[] = [
    { id: 'info', icon: User, label: 'Informações', show: true },
    { id: 'security', icon: Shield, label: 'Segurança', show: true },
    { id: 'company', icon: Building2, label: 'Empresa', show: user?.role === 'company' },
    { id: 'users', icon: Users, label: 'Usuários', show: user?.role === 'admin' },
  ];

  const visibleTabs = tabs.filter(t => t.show);

  // Admin users summary
  const adminsByRole = {
    admin: allUsers.filter(u => u.role === 'admin').length,
    staff: allUsers.filter(u => u.role === 'staff').length,
    company: allUsers.filter(u => u.role === 'company').length,
  };
  const recentUsers = [...allUsers]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);

  if (!user) return null;

  return (
    <MainLayout>
      <div style={{ background: '#F0F0F0', minHeight: '100%', padding: '24px 16px', margin: '-16px', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>

          {/* Page header */}
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Meu Perfil</h1>
            <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Gerencie suas informações pessoais</p>
          </div>

          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>

            {/* ── Left card ── */}
            <div style={{ width: 260, flexShrink: 0, background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
              {/* Avatar */}
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: 12 }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%', overflow: 'hidden',
                  background: avatarPreview ? 'transparent' : '#FEF3D0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto', border: '3px solid #F5A800',
                }}>
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 28, fontWeight: 700, color: '#F5A800' }}>
                      {getInitials(user.name)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 26, height: 26, borderRadius: '50%',
                    background: '#F5A800', border: '2px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title="Alterar foto"
                >
                  <Pencil style={{ width: 12, height: 12, color: '#1A1A1A' }} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                />
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#F5A800', fontWeight: 600, marginBottom: 14 }}
              >
                Alterar foto
              </button>

              <p style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A', margin: '0 0 6px' }}>{user.name}</p>
              <div style={{ marginBottom: 6 }}><RoleBadge role={user.role} /></div>
              <p style={{ fontSize: 12, color: '#888', margin: '6px 0 4px' }}>{user.email}</p>
              {phone && <p style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{phone}</p>}
              {createdAt && (
                <p style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
                  Membro desde {format(new Date(createdAt), "dd/MM/yyyy", { locale: ptBR })}
                </p>
              )}

              {user.role === 'company' && companyData && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F0F0F0', textAlign: 'left' }}>
                  <p style={{ fontSize: 11, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Empresa</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{companyData.name}</p>
                </div>
              )}

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #F0F0F0' }}>
                <button
                  onClick={() => { logout(); navigate('/login'); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', borderRadius: 8, border: '1px solid #FECACA', background: '#FFF5F5', color: '#DC2626', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  <LogOut style={{ width: 14, height: 14 }} />
                  Sair
                </button>
              </div>
            </div>

            {/* ── Right panel ── */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#fff', borderRadius: 12, padding: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
                {visibleTabs.map(t => (
                  <TabButton
                    key={t.id}
                    active={activeTab === t.id}
                    onClick={() => setActiveTab(t.id)}
                    icon={t.icon}
                    label={t.label}
                  />
                ))}
              </div>

              {/* ── TAB: Informações ── */}
              {activeTab === 'info' && (
                <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 20 }}>Informações pessoais</h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <FL>Nome completo</FL>
                      <Input value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div>
                      <FL>Telefone</FL>
                      <Input value={phone} onChange={e => setPhone(formatPhone(e.target.value))} placeholder="(00) 00000-0000" />
                    </div>
                    <div>
                      <FL>E-mail de acesso</FL>
                      <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
                      {email !== user.email && (
                        <p style={{ fontSize: 11, color: '#888', marginTop: 4, lineHeight: 1.5 }}>
                          Alterar o e-mail exige confirmação no endereço atual e no novo.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Read-only info */}
                  <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <p style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Perfil</p>
                      <RoleBadge role={user.role} />
                    </div>
                    {createdAt && (
                      <div>
                        <p style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Cadastro</p>
                        <p style={{ fontSize: 13, color: '#374151' }}>{format(new Date(createdAt), "dd/MM/yyyy", { locale: ptBR })}</p>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleSaveInfo}
                      disabled={savingInfo}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontWeight: 700, fontSize: 14, cursor: savingInfo ? 'not-allowed' : 'pointer', opacity: savingInfo ? 0.7 : 1 }}
                    >
                      {savingInfo && <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />}
                      Salvar alterações
                    </button>
                  </div>
                </div>
              )}

              {/* ── TAB: Segurança ── */}
              {activeTab === 'security' && (
                <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* Change password */}
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Lock style={{ width: 16, height: 16, color: '#F5A800' }} />
                      Alterar senha
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div>
                        <FL>Senha atual</FL>
                        <PasswordInput value={currentPw} onChange={setCurrentPw} placeholder="Senha atual" show={showCurrent} onToggle={() => setShowCurrent(v => !v)} />
                      </div>

                      <div>
                        <FL>Nova senha</FL>
                        <PasswordInput value={newPw} onChange={v => { setNewPw(v); setPwError(''); }} placeholder="Mínimo 6 caracteres" show={showNew} onToggle={() => setShowNew(v => !v)} />
                        {newPw.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ height: 4, background: '#F0F0F0', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: strength.width, background: strength.color, borderRadius: 4, transition: 'all 0.3s' }} />
                            </div>
                            <p style={{ fontSize: 11, color: strength.color, marginTop: 4, fontWeight: 600 }}>{strength.label}</p>
                          </div>
                        )}
                      </div>

                      <div>
                        <FL>Confirmar nova senha</FL>
                        <PasswordInput
                          value={confirmPw}
                          onChange={v => { setConfirmPw(v); setPwError(''); }}
                          placeholder="Repita a nova senha"
                          show={showConfirm}
                          onToggle={() => setShowConfirm(v => !v)}
                          style={{ borderColor: pwNoMatch ? '#EF4444' : pwMatch ? '#2D6A4F' : undefined }}
                        />
                        {pwNoMatch && <p style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>As senhas não coincidem</p>}
                        {pwMatch && <p style={{ fontSize: 11, color: '#2D6A4F', marginTop: 4 }}>✓ Senhas iguais</p>}
                      </div>

                      {pwError && (
                        <p style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '8px 12px' }}>{pwError}</p>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          onClick={handleChangePassword}
                          disabled={savingPw || pwNoMatch || !currentPw || !newPw}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: (savingPw || pwNoMatch || !currentPw || !newPw) ? 0.6 : 1 }}
                        >
                          {savingPw && <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />}
                          Alterar senha
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Sessions */}
                  <div style={{ paddingTop: 20, borderTop: '1px solid #F0F0F0' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', marginBottom: 12 }}>Sessões ativas</h3>
                    <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
                      Encerre todas as sessões em outros dispositivos para proteger sua conta.
                    </p>
                    <button
                      onClick={handleSignOutAll}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1.5px solid #FECACA', background: '#FFF5F5', color: '#DC2626', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                    >
                      <LogOut style={{ width: 14, height: 14 }} />
                      Encerrar todas as sessões
                    </button>
                  </div>
                </div>
              )}

              {/* ── TAB: Empresa ── */}
              {activeTab === 'company' && (
                <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 20 }}>Dados da Empresa</h3>

                  {companyData ? (
                    <>
                      <div style={{ background: '#F8F8F8', borderRadius: 12, padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                        {[
                          { label: 'Nome', value: companyData.name },
                          { label: 'CNPJ', value: companyData.cnpj || '—' },
                          { label: 'E-mail de contato', value: companyData.contact_email || '—' },
                          { label: 'Telefone', value: companyData.contact_phone || '—' },
                          { label: 'Responsável', value: companyData.contact_name || '—' },
                          {
                            label: 'Status',
                            value: companyData.active
                              ? <span style={{ background: '#D1FAE5', color: '#065F46', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>Ativa</span>
                              : <span style={{ background: '#FEE2E2', color: '#991B1B', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>Inativa</span>,
                          },
                          companyData.created_at && {
                            label: 'Cadastro',
                            value: format(new Date(companyData.created_at), "dd/MM/yyyy", { locale: ptBR }),
                          },
                        ].filter(Boolean).map((item: any, i) => (
                          <div key={i}>
                            <p style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{item.label}</p>
                            {typeof item.value === 'string'
                              ? <p style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{item.value}</p>
                              : item.value
                            }
                          </div>
                        ))}
                      </div>
                      <p style={{ fontSize: 11, color: '#aaa', textAlign: 'center' }}>
                        Para alterar os dados da empresa, entre em contato com o administrador do sistema.
                      </p>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 32 }}>
                      <Loader2 style={{ width: 24, height: 24, color: '#F5A800', margin: '0 auto' }} className="animate-spin" />
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB: Usuários (admin) ── */}
              {activeTab === 'users' && (
                <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 20 }}>Resumo de Usuários</h3>

                  {/* Badges por role */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Administradores', count: adminsByRole.admin, bg: '#FEF3D0', color: '#854F0B' },
                      { label: 'Staff', count: adminsByRole.staff, bg: '#E6F1FB', color: '#185FA5' },
                      { label: 'Empresas', count: adminsByRole.company, bg: '#E1F5EE', color: '#0F6E56' },
                    ].map(b => (
                      <div key={b.label} style={{ background: b.bg, color: b.color, borderRadius: 10, padding: '10px 16px', textAlign: 'center', flex: 1, minWidth: 100 }}>
                        <p style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{b.count}</p>
                        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>{b.label}</p>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => navigate('/admin/users')}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 20 }}
                  >
                    <ExternalLink style={{ width: 14, height: 14 }} />
                    Gerenciar usuários
                  </button>

                  {/* Recent users */}
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Últimos cadastrados</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {recentUsers.map(u => (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#F9FAFB', borderRadius: 8, border: '1px solid #F0F0F0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#FEF3D0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#F5A800', flexShrink: 0 }}>
                              {u.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', margin: 0 }}>{u.name}</p>
                              <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0 }}>{u.email}</p>
                            </div>
                          </div>
                          <RoleBadge role={u.role} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
