import { useState, useEffect } from 'react';
import { X, Mail, Clock, HelpCircle, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Plus, ExternalLink } from 'lucide-react';
import { useAgentConfig, useSaveAgentConfig, useTestGmailConnection } from '@/hooks/useAgentConfig';

interface AgentConfigDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Tab = 'gmail' | 'schedule' | 'help';

const MAX_TIMES = 4;

export function AgentConfigDialog({ open, onOpenChange }: AgentConfigDialogProps) {
  const { data: config, isLoading } = useAgentConfig();
  const saveConfig = useSaveAgentConfig();
  const testGmail  = useTestGmailConnection();

  const [tab, setTab] = useState<Tab>('gmail');

  // Form fields
  const [gmailEmail,   setGmailEmail]   = useState('');
  const [appPassword,  setAppPassword]  = useState('');
  const [isActive,     setIsActive]     = useState(true);
  const [scanTimes,    setScanTimes]    = useState<string[]>(['08:00', '17:00']);
  const [newTime,      setNewTime]      = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Test state
  const [testResult, setTestResult] = useState<{ ok: boolean; email?: string } | null>(null);

  useEffect(() => {
    if (config) {
      if (config.gmail_email) setGmailEmail(config.gmail_email);
      if (config.scan_times?.length) setScanTimes(config.scan_times);
      setIsActive(config.is_active ?? true);
    }
  }, [config]);

  if (!open) return null;

  const canSave   = gmailEmail.trim() !== '' && appPassword.trim() !== '';
  const canTest   = gmailEmail.trim() !== '' && appPassword.trim() !== '';
  const hasConfig = config?.is_configured && config?.has_app_password;

  async function handleTest() {
    setTestResult(null);
    try {
      const result = await testGmail.mutateAsync({
        email:       gmailEmail.trim(),
        appPassword: appPassword.trim(),
      });
      setTestResult({ ok: true, email: result.emailAddress });
    } catch {
      setTestResult({ ok: false });
    }
  }

  async function handleSave() {
    await saveConfig.mutateAsync({
      gmail_email:        gmailEmail.trim(),
      gmail_app_password: appPassword.trim(),
      scan_times:         scanTimes,
      is_active:          isActive,
    });
    onOpenChange(false);
  }

  function addTime() {
    if (!newTime || scanTimes.includes(newTime) || scanTimes.length >= MAX_TIMES) return;
    setScanTimes(prev => [...prev, newTime].sort());
    setNewTime('');
  }

  function removeTime(t: string) {
    setScanTimes(prev => prev.filter(x => x !== t));
  }

  return (
    <>
      {/* Overlay */}
      <div
        onClick={() => onOpenChange(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(26,26,26,0.65)', backdropFilter: 'blur(2px)' }}
      />

      {/* Dialog */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}
        onClick={e => { if (e.target === e.currentTarget) onOpenChange(false); }}
      >
        <div
          style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, boxShadow: '0 24px 80px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflow: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ background: '#1A1A1A', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Mail size={18} style={{ color: '#F5A800' }} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Configurar Agente de Email</span>
            </div>
            <button onClick={() => onOpenChange(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 4 }}>
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #F0F0F0', flexShrink: 0 }}>
            {([
              { id: 'gmail',    label: '📧 Conta Gmail' },
              { id: 'schedule', label: '⏱ Horários' },
              { id: 'help',     label: 'ℹ Ajuda' },
            ] as { id: Tab; label: string }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  flex: 1, padding: '12px 0', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
                  color: tab === t.id ? '#F5A800' : '#888',
                  borderBottom: tab === t.id ? '2.5px solid #F5A800' : '2.5px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {isLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <Loader2 size={24} className="animate-spin" style={{ color: '#F5A800' }} />
              </div>
            ) : tab === 'gmail' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Status atual */}
                {hasConfig && (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
                    background: config!.last_test_success ? '#E1F5EE' : '#FCEBEB',
                    border: `1px solid ${config!.last_test_success ? '#2D6A4F' : '#E24B4A'}`,
                  }}>
                    {config!.last_test_success
                      ? <CheckCircle2 size={15} style={{ color: '#2D6A4F', flexShrink: 0 }} />
                      : <XCircle size={15} style={{ color: '#E24B4A', flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: 12, color: config!.last_test_success ? '#2D6A4F' : '#E24B4A', fontWeight: 600 }}>
                      {config!.last_test_success
                        ? `Conectado — ${config!.gmail_email}`
                        : `Erro: ${config!.last_test_error || 'Conexão falhou'}`
                      }
                    </span>
                  </div>
                )}

                {/* Dica de App Password */}
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FFF8E7', border: '1px solid #F5A800' }}>
                  <p style={{ margin: 0, fontSize: 12, color: '#854F0B', fontWeight: 600 }}>
                    🔑 Use uma Senha de App — não sua senha normal!
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9A6000' }}>
                    Acesse: Conta Google → Segurança → Verificação em 2 etapas → Senhas de app → Gerar.
                    O resultado será uma senha de 16 letras (ex: <code style={{ background: '#FEF3D0', padding: '1px 4px', borderRadius: 3 }}>abcd efgh ijkl mnop</code>).
                  </p>
                </div>

                {/* Email */}
                <FieldGroup label="Email Gmail" hint="Conta a ser monitorada">
                  <input
                    type="email"
                    value={gmailEmail}
                    onChange={e => setGmailEmail(e.target.value)}
                    placeholder="conta@gmail.com"
                    style={inputStyle}
                  />
                </FieldGroup>

                {/* App Password */}
                <FieldGroup label="Senha de App" hint="16 caracteres gerada pela Google (com ou sem espaços)">
                  <PasswordField
                    value={appPassword}
                    onChange={setAppPassword}
                    show={showPassword}
                    onToggle={() => setShowPassword(v => !v)}
                    placeholder={hasConfig ? '(mantém atual se vazio)' : 'Ex: abcd efgh ijkl mnop'}
                  />
                </FieldGroup>

                {/* Botão Testar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={handleTest}
                    disabled={!canTest || testGmail.isPending}
                    style={{
                      padding: '8px 20px', borderRadius: 8, border: '1.5px solid #F5A800',
                      background: 'transparent', color: '#F5A800', fontSize: 13, fontWeight: 700,
                      cursor: canTest ? 'pointer' : 'not-allowed',
                      opacity: canTest ? 1 : 0.5,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {testGmail.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                    {testGmail.isPending ? 'Testando...' : 'Testar conexão'}
                  </button>

                  {testResult && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: testResult.ok ? '#2D6A4F' : '#E24B4A', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {testResult.ok
                        ? <><CheckCircle2 size={13} /> {testResult.email}</>
                        : <><XCircle size={13} /> Falhou — verifique email e senha de app</>
                      }
                    </span>
                  )}
                </div>

                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#378ADD', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                >
                  <ExternalLink size={12} /> Abrir Senhas de App da Google →
                </a>
              </div>

            ) : tab === 'schedule' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Toggle ativo */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#FAFAFA', borderRadius: 8, border: '1px solid #F0F0F0' }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Agente ativo</p>
                    <p style={{ fontSize: 11, color: '#999', margin: 0 }}>Varredura automática nos horários configurados</p>
                  </div>
                  <button
                    onClick={() => setIsActive(v => !v)}
                    style={{ width: 40, height: 22, borderRadius: 99, border: 'none', cursor: 'pointer', background: isActive ? '#F5A800' : '#E0E0E0', position: 'relative', transition: 'background 0.2s' }}
                  >
                    <span style={{ position: 'absolute', top: 2, left: isActive ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </button>
                </div>

                {/* Horários */}
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', marginBottom: 8 }}>
                    Horários de varredura ({scanTimes.length}/{MAX_TIMES})
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    {scanTimes.map(t => (
                      <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, background: '#FEF3D0', border: '1px solid #F5A800', fontSize: 12, fontWeight: 700, color: '#854F0B' }}>
                        {t}
                        <button onClick={() => removeTime(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#854F0B', display: 'flex' }}>
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                  {scanTimes.length < MAX_TIMES && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} style={{ ...inputStyle, width: 120 }} />
                      <button
                        onClick={addTime}
                        disabled={!newTime}
                        style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: newTime ? '#F5A800' : '#E0E0E0', color: '#fff', fontSize: 12, fontWeight: 700, cursor: newTime ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <Plus size={13} /> Adicionar
                      </button>
                    </div>
                  )}
                </div>

                <p style={{ fontSize: 11, color: '#aaa' }}>Horários em BRT (Brasília).</p>
              </div>

            ) : (
              /* ABA AJUDA */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Como configurar em 3 passos</p>

                {[
                  {
                    n: 1,
                    title: 'Ativar a Verificação em 2 Etapas',
                    desc: 'Acesse myaccount.google.com → Segurança → Verificação em 2 etapas → Ativar. (Se já estiver ativa, pule.)',
                  },
                  {
                    n: 2,
                    title: 'Gerar uma Senha de App',
                    desc: 'Em Segurança → Verificação em 2 etapas → role até "Senhas de app" → clique → selecione "Outro (nome personalizado)" → coloque "GD Manager" → clique Gerar. Copie os 16 caracteres amarelos.',
                  },
                  {
                    n: 3,
                    title: 'Configurar aqui',
                    desc: 'Na aba "Conta Gmail", preencha o email e cole a senha de 16 letras (pode manter os espaços) → Testar conexão → Salvar.',
                  },
                ].map(step => (
                  <div key={step.n} style={{ display: 'flex', gap: 12 }}>
                    <span style={{ minWidth: 24, height: 24, borderRadius: '50%', background: '#F5A800', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{step.n}</span>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{step.title}</p>
                      <p style={{ fontSize: 11, color: '#666', margin: '3px 0 0' }}>{step.desc}</p>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 4, padding: '10px 14px', borderRadius: 8, background: '#F5F5F5', border: '1px solid #E0E0E0' }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#666' }}>
                    ⚠️ <strong>IMAP precisa estar habilitado no Gmail:</strong> Gmail → Configurações (⚙️) → Ver todas as configurações → Encaminhamento e POP/IMAP → Habilitar IMAP → Salvar.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#378ADD', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                    <ExternalLink size={12} /> Abrir Senhas de App →
                  </a>
                  <a href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#378ADD', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                    <ExternalLink size={12} /> Configurações de IMAP no Gmail →
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 24px', borderTop: '1px solid #F0F0F0', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
            <button
              onClick={() => onOpenChange(false)}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', fontSize: 13, fontWeight: 600, color: '#666', cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saveConfig.isPending}
              style={{
                padding: '8px 24px', borderRadius: 8, border: 'none',
                background: canSave && !saveConfig.isPending ? '#F5A800' : '#E0E0E0',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: canSave && !saveConfig.isPending ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {saveConfig.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1.5px solid #E0E0E0', fontSize: 13, color: '#1A1A1A',
  outline: 'none', boxSizing: 'border-box', background: '#FAFAFA',
};

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A' }}>{label}</label>
      {hint && <span style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>{hint}</span>}
      {children}
    </div>
  );
}

function PasswordField({ value, onChange, show, onToggle, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder?: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 40 }}
      />
      <button
        onClick={onToggle}
        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 0 }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
