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
  ChevronDown, ChevronRight, Trash2, AlertTriangle,
} from 'lucide-react';
import { projectStatusLabel } from '@/lib/statusMapping';

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

export default function MasterPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const { data: tenants = [], isLoading } = useMasterTenants();
  const { data: stats } = useMasterStats();
  const { data: plans = [] } = usePlans();

  const [showCreate, setShowCreate] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [payingTenant, setPayingTenant] = useState<Tenant | null>(null);
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null);

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
    <div style={embedded ? { padding: 0 } : { minHeight: '100vh', background: '#111118', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: embedded ? 'flex-end' : 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          {!embedded && (
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
          )}
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

                    <TenantActions tenant={t} onPay={() => setPayingTenant(t)} onUpdate={updateTenant.mutate} onLogo={uploadLogo} plans={plans}
                      onDelete={() => setDeletingTenant(t)} />
                  </div>

                  {/* Métricas */}
                  <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
                    <Metric icon={<FolderOpen size={13} />} label="Projetos" value={s ? `${s.projects_total} (${s.projects_month} no mês)` : '…'} />
                    <Metric icon={<UsersIcon size={13} />} label="Usuários" value={s ? String(s.users_count) : '…'} />
                    <Metric icon={<Building2 size={13} />} label="Empresas" value={s ? String(s.companies_count) : '…'} />
                    <Metric icon={<Sparkles size={13} />} label="IA no mês" value={s ? `${s.ai_month}${t.plan?.ai_analyses_per_month ? ` / ${t.plan.ai_analyses_per_month}` : ''}` : '…'} />
                  </div>

                  {/* Drill-down: empresas do tenant e seus projetos (só master) */}
                  <TenantDrillDown tenantId={t.id} />
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
      {deletingTenant && (
        <DeleteTenantDialog tenant={deletingTenant} accessToken={session?.access_token ?? ''}
          onClose={() => setDeletingTenant(null)} onDeleted={invalidate} />
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

// ── Drill-down: empresas do tenant e seus projetos ──────────────────────────────
// Dados das RPCs master-only master_companies_by_tenant(id) / master_company_projects.
interface MasterCompany {
  company_id: string | null; company_name: string | null; company_active: boolean | null;
  company_cnpj: string | null; projects_count: number; projects_active: number;
}
interface MasterProject {
  project_id: string; code: string | null; title: string | null; status: string;
  holder_name: string | null; created_at: string; project_value: number | null;
  payment_status: string | null; protocol_number: string | null;
}
const brl = (n: number | null) => n == null ? '—' : `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

function CompanyProjects({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['master-company-projects', companyId],
    queryFn: async (): Promise<MasterProject[]> => {
      const { data, error } = await supabase.rpc('master_company_projects' as never, { _company_id: companyId } as never);
      if (error) throw error;
      return (data ?? []) as MasterProject[];
    },
    staleTime: 30_000,
  });
  if (isLoading) return <div style={{ padding: '6px 0 6px 44px' }}><Loader2 size={14} className="animate-spin" style={{ color: '#F5A800' }} /></div>;
  const rows = data ?? [];
  if (rows.length === 0) return <div style={{ padding: '6px 0 8px 44px', fontSize: 11, color: '#777' }}>Nenhum projeto.</div>;
  return (
    <div style={{ paddingBottom: 6 }}>
      {rows.map(p => (
        <div key={p.project_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 4px 44px', fontSize: 11 }}>
          <span style={{ fontFamily: 'monospace', color: '#888', flexShrink: 0 }}>{p.code || '—'}</span>
          <span style={{ color: '#ccc', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.holder_name || p.title || '—'}</span>
          <span style={{ color: '#999', flexShrink: 0 }}>{projectStatusLabel(p.status)}</span>
          <span style={{ color: '#888', flexShrink: 0, width: 96, textAlign: 'right' }}>{brl(p.project_value)}</span>
        </div>
      ))}
    </div>
  );
}

function CompanyItem({ c }: { c: MasterCompany }) {
  const [open, setOpen] = useState(false);
  if (!c.company_id) return null;
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px 7px 26px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        {open ? <ChevronDown size={13} color="#888" /> : <ChevronRight size={13} color="#888" />}
        <Building2 size={13} style={{ color: c.company_active ? '#8FA88F' : '#666', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: '#eee', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.company_name}{!c.company_active && <span style={{ fontSize: 10, color: '#FF6B4A', marginLeft: 6 }}>inativa</span>}
        </span>
        <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>
          {c.projects_count} proj.{Number(c.projects_active) > 0 && <span style={{ color: '#F5A800' }}> · {c.projects_active} ativo{Number(c.projects_active) === 1 ? '' : 's'}</span>}
        </span>
      </button>
      {open && <CompanyProjects companyId={c.company_id} />}
    </div>
  );
}

function TenantDrillDown({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['master-tenant-companies', tenantId],
    enabled: open, // carrega só quando expandido
    queryFn: async (): Promise<MasterCompany[]> => {
      const { data, error } = await supabase.rpc('master_companies_by_tenant' as never, { _tenant_id: tenantId } as never);
      if (error) throw error;
      return ((data ?? []) as MasterCompany[]).filter(r => r.company_id);
    },
    staleTime: 30_000,
  });
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 12, fontWeight: 600, padding: '2px 0' }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Empresas e projetos
      </button>
      {open && (
        isLoading ? <div style={{ padding: '8px 0 8px 22px' }}><Loader2 size={15} className="animate-spin" style={{ color: '#F5A800' }} /></div>
        : (data ?? []).length === 0 ? <div style={{ padding: '6px 0 6px 22px', fontSize: 12, color: '#777' }}>Nenhuma empresa cadastrada.</div>
        : <div style={{ marginTop: 6, background: 'rgba(0,0,0,0.15)', borderRadius: 10, overflow: 'hidden' }}>
            {(data ?? []).map(c => <CompanyItem key={c.company_id} c={c} />)}
          </div>
      )}
    </div>
  );
}

// ── Ações por tenant ───────────────────────────────────────────────────────────

function TenantActions({ tenant, plans, onPay, onUpdate, onLogo, onDelete }: {
  tenant: Tenant;
  plans: TenantPlan[];
  onPay: () => void;
  onUpdate: (v: { id: string; changes: Record<string, unknown> }) => void;
  onLogo: (t: Tenant, f: File) => void;
  onDelete: () => void;
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

      {/* Exclusão definitiva — o diálogo mostra o que será apagado e exige o
          nome digitado. Suspender continua sendo o caminho reversível. */}
      <button style={btn('rgba(226,75,74,0.15)', '#FF8A88')} title="Excluir tenant (irreversível)"
        onClick={onDelete}>
        <Trash2 size={12} /> Excluir
      </button>
    </div>
  );
}

// ── Dialog: excluir tenant (irreversível) ──────────────────────────────────────

/**
 * Exclusão DEFINITIVA de um tenant. Antes de liberar o botão, mostra o que
 * exatamente vai embora (RPC `master_tenant_delete_preview`) e exige o nome do
 * tenant digitado igual — o mesmo nome é reconferido no servidor. O tenant
 * biblioteca e o tenant de quem está logado nunca podem ser excluídos.
 */
function DeleteTenantDialog({ tenant, accessToken, onClose, onDeleted }: {
  tenant: Tenant; accessToken: string; onClose: () => void; onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  const { data: preview, isLoading } = useQuery({
    queryKey: ['master-tenant-delete-preview', tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('master_tenant_delete_preview' as never, { _tenant_id: tenant.id } as never);
      if (error) throw error;
      return data as unknown as {
        name: string; is_library: boolean; is_own: boolean;
        projects: number; companies: number; users: number; documents: number;
        concessionaires: number; diagrams: number; subscription_charges: number;
      };
    },
  });

  const bloqueado = preview?.is_library || preview?.is_own;
  const podeExcluir = !bloqueado && typed.trim() === tenant.name && !deleting;

  const handleDelete = async () => {
    if (!podeExcluir) return;
    setDeleting(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-tenant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, confirmName: typed.trim() }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error || 'Não foi possível excluir'); return; }
      const sobras = (body.warnings ?? []) as string[];
      toast.success(
        `"${body.name}" excluído — ${body.projects} projeto(s), ${body.companies} empresa(s), `
        + `${body.users} usuário(s) e ${body.documents} arquivo(s).`,
      );
      if (sobras.length > 0) {
        console.warn('delete-tenant: sobras', sobras);
        toast.warning(`${sobras.length} item(ns) não puderam ser removidos — veja o console.`);
      }
      onDeleted();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede ao excluir o tenant');
    } finally {
      setDeleting(false);
    }
  };

  const linha = (label: string, valor: number | undefined) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#ddd', padding: '3px 0' }}>
      <span style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      <strong>{valor ?? 0}</strong>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#17171F', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, width: '100%', maxWidth: 460, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(226,75,74,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={17} color="#FF6B6B" />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0 }}>Excluir tenant</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', margin: 0 }}>{tenant.name}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Loader2 size={18} className="animate-spin" color="#888" /></div>
        ) : bloqueado ? (
          <p style={{ fontSize: 12.5, color: '#FFB4A2', margin: '0 0 14px', lineHeight: 1.6 }}>
            {preview?.is_library
              ? 'Este é o tenant BIBLIOTECA (origem das concessionárias, modelos e regras dos demais). Ele não pode ser excluído.'
              : 'Este é o seu próprio tenant. Entre com outro master para excluí-lo.'}
          </p>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: '#FFB4A2', margin: '0 0 10px', lineHeight: 1.6 }}>
              Isto apaga <strong>para sempre</strong> tudo o que está abaixo, inclusive os
              logins dos usuários e os arquivos no Storage. Não há como desfazer.
            </p>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '9px 12px', marginBottom: 12 }}>
              {linha('Projetos', preview?.projects)}
              {linha('Empresas', preview?.companies)}
              {linha('Usuários (login)', preview?.users)}
              {linha('Documentos anexados', preview?.documents)}
              {linha('Concessionárias', preview?.concessionaires)}
              {linha('Diagramas e modelos', preview?.diagrams)}
              {linha('Mensalidades lançadas', preview?.subscription_charges)}
            </div>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 5 }}>
              Digite <strong style={{ color: '#fff' }}>{tenant.name}</strong> para confirmar:
            </label>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={tenant.name}
              style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: '#111118', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose}
            style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'none', color: '#ccc', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Cancelar
          </button>
          {!bloqueado && (
            <button onClick={handleDelete} disabled={!podeExcluir}
              style={{
                padding: '9px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: podeExcluir ? '#E24B4A' : 'rgba(255,255,255,0.08)',
                color: podeExcluir ? '#fff' : 'rgba(255,255,255,0.35)',
                cursor: podeExcluir ? 'pointer' : 'not-allowed',
              }}>
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </button>
          )}
        </div>
      </div>
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
