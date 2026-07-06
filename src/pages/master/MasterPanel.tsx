import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tenant, TenantPlan } from '@/hooks/useTenant';
import { toast } from 'sonner';
import {
  Crown, Plus, Building2, Users as UsersIcon, FolderOpen, Sparkles,
  CalendarCheck, Ban, Play, Upload, Loader2, ArrowLeft, Pencil, X, Check,
} from 'lucide-react';

// ── Hooks locais do painel ─────────────────────────────────────────────────────

interface TenantStats {
  tenant_id: string;
  projects_total: number;
  projects_month: number;
  users_count: number;
  companies_count: number;
  ai_month: number;
}

function useMasterTenants() {
  return useQuery({
    queryKey: ['master-tenants'],
    queryFn: async (): Promise<Tenant[]> => {
      const { data, error } = await supabase
        .from('tenants' as never)
        .select('*, plan:plans(*)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Tenant[];
    },
  });
}

function useMasterStats() {
  return useQuery({
    queryKey: ['master-tenant-stats'],
    queryFn: async (): Promise<Map<string, TenantStats>> => {
      const { data, error } = await supabase.rpc('master_tenant_stats' as never);
      if (error) throw error;
      return new Map(((data ?? []) as TenantStats[]).map(s => [s.tenant_id, s]));
    },
  });
}

function usePlans() {
  return useQuery({
    queryKey: ['master-plans'],
    queryFn: async (): Promise<TenantPlan[]> => {
      const { data, error } = await supabase
        .from('plans' as never)
        .select('*')
        .order('price_cents', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TenantPlan[];
    },
  });
}

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  trial:     { label: 'Trial',     bg: '#E6F1FB', color: '#185FA5' },
  active:    { label: 'Ativo',     bg: '#E1F5EE', color: '#0F6E56' },
  suspended: { label: 'Suspenso',  bg: '#FFF0E6', color: '#993C1D' },
  canceled:  { label: 'Cancelado', bg: '#F3F4F6', color: '#6B7280' },
};

const fmtDate = (d: string | null) => d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR') : '—';

// ── Página ─────────────────────────────────────────────────────────────────────

export default function MasterPanel() {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const { data: tenants = [], isLoading } = useMasterTenants();
  const { data: stats } = useMasterStats();
  const { data: plans = [] } = usePlans();

  const [showCreate, setShowCreate] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [payingTenant, setPayingTenant] = useState<Tenant | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['master-tenants'] });
    queryClient.invalidateQueries({ queryKey: ['master-tenant-stats'] });
  };

  const updateTenant = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await supabase.from('tenants' as never).update(changes as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Tenant atualizado'); },
    onError: (e) => { console.error(e); toast.error('Erro ao atualizar tenant'); },
  });

  const uploadLogo = async (tenant: Tenant, file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${tenant.id}/logo.${ext}`;
    const { error: upErr } = await supabase.storage.from('tenant-logos').upload(path, file, { upsert: true });
    if (upErr) { toast.error('Erro ao subir logo'); return; }
    const { data: { publicUrl } } = supabase.storage.from('tenant-logos').getPublicUrl(path);
    // cache-buster para o navegador não mostrar o logo antigo
    updateTenant.mutate({ id: tenant.id, changes: { logo_url: `${publicUrl}?v=${Date.now()}` } });
  };

  if (!user?.isMaster) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#111118', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => navigate('/dashboard-admin')} title="Voltar ao sistema"
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', color: '#ccc', display: 'flex' }}>
              <ArrowLeft size={16} />
            </button>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#F5A800', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Crown size={20} style={{ color: '#1A1A1A' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>Painel Master</h1>
              <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Gestão de assinantes da plataforma</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowPlans(true)}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#ddd', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Planos
            </button>
            <button onClick={() => setShowCreate(true)}
              style={{ padding: '9px 14px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} /> Novo tenant
            </button>
          </div>
        </div>

        {/* Lista de tenants */}
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 size={28} className="animate-spin" style={{ color: '#F5A800' }} />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {tenants.map(t => {
              const s = stats?.get(t.id);
              const badge = STATUS_BADGE[t.status] ?? STATUS_BADGE.active;
              return (
                <div key={t.id} style={{ background: '#1B1B24', borderRadius: 14, padding: 18, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      {t.logo_url
                        ? <img src={t.logo_url} alt={t.name} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'contain', background: '#fff', padding: 3 }} />
                        : <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Building2 size={20} style={{ color: '#888' }} />
                          </div>}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{t.name}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: badge.bg, color: badge.color }}>{badge.label}</span>
                          {t.plan && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(245,168,0,0.15)', color: '#F5A800' }}>{t.plan.name}</span>}
                        </div>
                        <p style={{ fontSize: 11, color: '#888', margin: '3px 0 0' }}>
                          {t.cnpj ? `CNPJ ${t.cnpj} · ` : ''}
                          {t.status === 'trial'
                            ? `Trial até ${fmtDate(t.trial_ends_at)}`
                            : t.paid_until ? `Pago até ${fmtDate(t.paid_until)}` : 'Sem cobrança'}
                        </p>
                      </div>
                    </div>

                    <TenantActions tenant={t} onPay={() => setPayingTenant(t)} onUpdate={updateTenant.mutate} onLogo={uploadLogo} plans={plans} />
                  </div>

                  {/* Métricas */}
                  <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
                    <Metric icon={<FolderOpen size={13} />} label="Projetos" value={s ? `${s.projects_total} (${s.projects_month} no mês)` : '…'} />
                    <Metric icon={<UsersIcon size={13} />} label="Usuários" value={s ? String(s.users_count) : '…'} />
                    <Metric icon={<Building2 size={13} />} label="Empresas" value={s ? String(s.companies_count) : '…'} />
                    <Metric icon={<Sparkles size={13} />} label="IA no mês" value={s ? `${s.ai_month}${t.plan?.ai_analyses_per_month ? ` / ${t.plan.ai_analyses_per_month}` : ''}` : '…'} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTenantDialog plans={plans} accessToken={session?.access_token ?? ''}
          onClose={() => setShowCreate(false)} onCreated={() => { invalidate(); setShowCreate(false); }} />
      )}
      {payingTenant && (
        <RegisterPaymentDialog tenant={payingTenant} onClose={() => setPayingTenant(null)}
          onSave={(paidUntil) => { updateTenant.mutate({ id: payingTenant.id, changes: { paid_until: paidUntil, status: 'active' } }); setPayingTenant(null); }} />
      )}
      {showPlans && <PlansDialog plans={plans} onClose={() => setShowPlans(false)} />}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#aaa', fontSize: 12 }}>
      <span style={{ color: '#F5A800', display: 'flex' }}>{icon}</span>
      <span>{label}:</span>
      <span style={{ color: '#fff', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Ações por tenant ───────────────────────────────────────────────────────────

function TenantActions({ tenant, plans, onPay, onUpdate, onLogo }: {
  tenant: Tenant;
  plans: TenantPlan[];
  onPay: () => void;
  onUpdate: (v: { id: string; changes: Record<string, unknown> }) => void;
  onLogo: (t: Tenant, f: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const btn = (bg: string, color: string): React.CSSProperties => ({
    padding: '7px 11px', borderRadius: 7, border: 'none', background: bg, color,
    fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
  });

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select
        value={tenant.plan_id ?? ''}
        onChange={e => onUpdate({ id: tenant.id, changes: { plan_id: e.target.value } })}
        title="Plano"
        style={{ padding: '6px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: '#111118', color: '#ddd', fontSize: 11, fontWeight: 600 }}
      >
        {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onLogo(tenant, f); e.target.value = ''; }} />
      <button style={btn('rgba(255,255,255,0.08)', '#ddd')} onClick={() => fileRef.current?.click()} title="Logo do tenant">
        <Upload size={12} /> Logo
      </button>

      <button style={btn('#E1F5EE', '#0F6E56')} onClick={onPay} title="Registrar pagamento">
        <CalendarCheck size={12} /> Pagamento
      </button>

      {tenant.status !== 'suspended' ? (
        <button style={btn('#FFF0E6', '#993C1D')} title="Suspender acesso"
          onClick={() => { if (confirm(`Suspender o acesso de "${tenant.name}"? Os usuários verão a tela de bloqueio.`)) onUpdate({ id: tenant.id, changes: { status: 'suspended' } }); }}>
          <Ban size={12} /> Suspender
        </button>
      ) : (
        <button style={btn('#E1F5EE', '#0F6E56')} title="Reativar"
          onClick={() => onUpdate({ id: tenant.id, changes: { status: 'active' } })}>
          <Play size={12} /> Reativar
        </button>
      )}
    </div>
  );
}

// ── Dialog: novo tenant ────────────────────────────────────────────────────────

function CreateTenantDialog({ plans, accessToken, onClose, onCreated }: {
  plans: TenantPlan[]; accessToken: string; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [planId, setPlanId] = useState(plans.find(p => p.slug === 'basico')?.id ?? plans[0]?.id ?? '');
  const [trialDays, setTrialDays] = useState(14);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !adminName.trim() || !adminEmail.trim() || adminPassword.length < 6) {
      toast.error('Preencha nome do tenant e dados do admin (senha mínima de 6 caracteres)');
      return;
    }
    setSaving(true);
    try {
      // 1. Cria o tenant (trial)
      const trialEnds = new Date(Date.now() + trialDays * 86400000).toISOString();
      const { data: tenant, error: tErr } = await supabase
        .from('tenants' as never)
        .insert({ name: name.trim(), cnpj: cnpj.trim() || null, plan_id: planId, status: 'trial', trial_ends_at: trialEnds } as never)
        .select()
        .single();
      if (tErr) throw tErr;

      // 2. Cria o primeiro admin via edge function (passa tenantId)
      const { data: result, error: fnErr } = await supabase.functions.invoke('create-user', {
        body: {
          email: adminEmail.trim(), password: adminPassword, name: adminName.trim(),
          role: 'admin', tenantId: (tenant as { id: string }).id,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (fnErr) throw fnErr;
      if (result?.error) throw new Error(result.error);

      toast.success(`Tenant "${name}" criado com trial de ${trialDays} dias`);
      onCreated();
    } catch (e: unknown) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Erro ao criar tenant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay onClose={onClose} title="Novo tenant (assinante)">
      <Field label="Nome da empresa assinante *"><input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="Ex: Solar X Homologações" /></Field>
      <Field label="CNPJ"><input value={cnpj} onChange={e => setCnpj(e.target.value)} style={inp} placeholder="00.000.000/0001-00" /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Plano">
          <select value={planId} onChange={e => setPlanId(e.target.value)} style={inp}>
            {plans.filter(p => p.slug !== 'interno').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Dias de trial"><input type="number" min={0} max={90} value={trialDays} onChange={e => setTrialDays(parseInt(e.target.value) || 0)} style={inp} /></Field>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid #EEE', margin: '14px 0' }} />
      <p style={{ fontSize: 12, fontWeight: 700, color: '#555', margin: '0 0 10px' }}>Primeiro administrador do tenant</p>
      <Field label="Nome *"><input value={adminName} onChange={e => setAdminName(e.target.value)} style={inp} /></Field>
      <Field label="E-mail *"><input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} style={inp} /></Field>
      <Field label="Senha * (mín. 6)"><input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} style={inp} /></Field>
      <button onClick={handleCreate} disabled={saving}
        style={{ width: '100%', marginTop: 14, padding: '11px 0', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Criar tenant e admin
      </button>
    </Overlay>
  );
}

// ── Dialog: registrar pagamento ────────────────────────────────────────────────

function RegisterPaymentDialog({ tenant, onClose, onSave }: {
  tenant: Tenant; onClose: () => void; onSave: (paidUntil: string) => void;
}) {
  // sugestão: +1 mês a partir do vencimento atual (ou de hoje, se vencido)
  const base = tenant.paid_until && new Date(tenant.paid_until) > new Date() ? new Date(tenant.paid_until) : new Date();
  const suggestion = new Date(base); suggestion.setMonth(suggestion.getMonth() + 1);
  const [paidUntil, setPaidUntil] = useState(suggestion.toISOString().slice(0, 10));

  return (
    <Overlay onClose={onClose} title={`Registrar pagamento — ${tenant.name}`}>
      <p style={{ fontSize: 12, color: '#777', margin: '0 0 12px' }}>
        Vencimento atual: <strong>{fmtDate(tenant.paid_until)}</strong>. Informe o novo vencimento
        (padrão: +1 mês). O tenant fica <strong>ativo</strong> até essa data.
      </p>
      <Field label="Pago até">
        <input type="date" value={paidUntil} onChange={e => setPaidUntil(e.target.value)} style={inp} />
      </Field>
      <button onClick={() => onSave(paidUntil)}
        style={{ width: '100%', marginTop: 14, padding: '11px 0', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
        Confirmar pagamento
      </button>
    </Overlay>
  );
}

// ── Dialog: editor de planos ───────────────────────────────────────────────────

function PlansDialog({ plans, onClose }: { plans: TenantPlan[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TenantPlan | null>(null);

  const save = useMutation({
    mutationFn: async (p: TenantPlan) => {
      const { error } = await supabase.from('plans' as never).update({
        name: p.name, price_cents: p.price_cents,
        max_projects_per_month: p.max_projects_per_month,
        max_users: p.max_users, ai_analyses_per_month: p.ai_analyses_per_month,
        features: p.features,
      } as never).eq('id', p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-plans'] });
      queryClient.invalidateQueries({ queryKey: ['master-tenants'] });
      toast.success('Plano salvo');
      setEditing(null);
    },
    onError: (e) => { console.error(e); toast.error('Erro ao salvar plano'); },
  });

  return (
    <Overlay onClose={onClose} title="Planos de assinatura" wide>
      {!editing ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {plans.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 10, border: '1px solid #EEE' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
                  {p.name} <span style={{ color: '#999', fontWeight: 500 }}>· R$ {(p.price_cents / 100).toFixed(2)}/mês</span>
                </p>
                <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0' }}>
                  Projetos/mês: {p.max_projects_per_month ?? '∞'} · Usuários: {p.max_users ?? '∞'} · IA: {p.ai_analyses_per_month}/mês
                  {' · '}{Object.entries(p.features ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'sem recursos extras'}
                </p>
              </div>
              <button onClick={() => setEditing({ ...p })}
                style={{ background: 'none', border: '1px solid #E0E0E0', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#555' }}>
                <Pencil size={12} /> Editar
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <Field label="Nome"><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={inp} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Preço (R$/mês)">
              <input type="number" min={0} step="0.01" value={editing.price_cents / 100}
                onChange={e => setEditing({ ...editing, price_cents: Math.round(parseFloat(e.target.value || '0') * 100) })} style={inp} />
            </Field>
            <Field label="IA (análises/mês)">
              <input type="number" min={0} value={editing.ai_analyses_per_month}
                onChange={e => setEditing({ ...editing, ai_analyses_per_month: parseInt(e.target.value) || 0 })} style={inp} />
            </Field>
            <Field label="Projetos/mês (vazio = ilimitado)">
              <input type="number" min={0} value={editing.max_projects_per_month ?? ''}
                onChange={e => setEditing({ ...editing, max_projects_per_month: e.target.value === '' ? null : parseInt(e.target.value) })} style={inp} />
            </Field>
            <Field label="Usuários (vazio = ilimitado)">
              <input type="number" min={0} value={editing.max_users ?? ''}
                onChange={e => setEditing({ ...editing, max_users: e.target.value === '' ? null : parseInt(e.target.value) })} style={inp} />
            </Field>
          </div>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#555', margin: '12px 0 6px' }}>Recursos inclusos</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {['claudinho', 'email_agent', 'map', 'reports'].map(f => (
              <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!editing.features?.[f]}
                  onChange={e => setEditing({ ...editing, features: { ...editing.features, [f]: e.target.checked } })} />
                {f === 'claudinho' ? 'Claudinho Verifica' : f === 'email_agent' ? 'Agente de e-mails' : f === 'map' ? 'Mapa' : 'Relatórios'}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={() => setEditing(null)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#555' }}>
              Cancelar
            </button>
            <button onClick={() => save.mutate(editing)} disabled={save.isPending}
              style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
              {save.isPending ? 'Salvando...' : 'Salvar plano'}
            </button>
          </div>
        </div>
      )}
    </Overlay>
  );
}

// ── Componentes utilitários ────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #E0E0E0',
  fontSize: 13, outline: 'none', background: '#fff', color: '#1A1A1A', boxSizing: 'border-box',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#777', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Overlay({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: wide ? 'min(640px, 94vw)' : 'min(440px, 94vw)', maxHeight: '88vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: '#1A1A1A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', display: 'flex' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
