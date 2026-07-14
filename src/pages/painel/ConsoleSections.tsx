import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Building2, Users, DollarSign, FolderOpen, Activity, MapPin, Cpu, FileText, Package } from 'lucide-react';

const GOLD = '#F5A800';
const money = (cents: number) => `R$ ${((cents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`;

function useStat<T>(fn: string) {
  return useQuery({
    queryKey: ['console-stat', fn],
    queryFn: async (): Promise<T> => {
      const { data, error } = await supabase.rpc(fn as never);
      if (error) throw error;
      return data as T;
    },
    staleTime: 60_000,
  });
}

// ── UI helpers ──────────────────────────────────────────────────────────────
const card: React.CSSProperties = { background: '#16161F', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 };
function Kpi({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: string; hint?: string }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888', fontSize: 12 }}><Icon size={15} style={{ color: GOLD }} /> {label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginTop: 8 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
const grid = (min = 180): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 14 });
function Loading() { return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={26} className="animate-spin" style={{ color: GOLD }} /></div>; }
function SectionTitle({ children }: { children: React.ReactNode }) { return <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 0 16px' }}>{children}</h2>; }
function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ ...card, height: 240 }}><p style={{ fontSize: 12, color: '#aaa', margin: '0 0 10px' }}>{title}</p><ResponsiveContainer width="100%" height="85%">{children as never}</ResponsiveContainer></div>;
}
const tt = { contentStyle: { background: '#0E0E14', border: '1px solid #333', borderRadius: 8, fontSize: 12 }, labelStyle: { color: '#aaa' } };
const dayShort = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7);

// ── Visão geral ─────────────────────────────────────────────────────────────
interface Overview { tenants_total: number; tenants_active: number; tenants_trial: number; tenants_suspended: number; tenants_new_month: number; mrr_cents: number; projects_total: number; projects_month: number; logins_today: number; active_users_month: number; }
export function OverviewSection() {
  const { data, isLoading } = useStat<Overview>('console_overview');
  if (isLoading || !data) return <Loading />;
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <SectionTitle>Visão geral</SectionTitle>
      <div style={grid()}>
        <Kpi icon={Building2} label="Tenants ativos" value={String(data.tenants_active)} hint={`${data.tenants_trial} em trial · ${data.tenants_suspended} suspensos`} />
        <Kpi icon={Building2} label="Novos no mês" value={String(data.tenants_new_month)} />
        <Kpi icon={DollarSign} label="MRR estimado" value={money(data.mrr_cents)} hint="soma dos planos ativos" />
        <Kpi icon={Users} label="Usuários ativos (30d)" value={String(data.active_users_month)} />
        <Kpi icon={Activity} label="Logins hoje" value={String(data.logins_today)} />
        <Kpi icon={FolderOpen} label="Projetos (mês)" value={String(data.projects_month)} hint={`${data.projects_total} no total`} />
      </div>
    </div>
  );
}

// ── Acessos ─────────────────────────────────────────────────────────────────
interface AccessStats {
  logins_by_day: { day: string; count: number }[];
  by_location: { country: string; city: string; count: number }[];
  by_ip: { ip: string; city: string; count: number; last_at: string }[];
  dau: number; wau: number; mau: number;
  recent: { started_at: string; ip: string; city: string; country: string; user_name: string; tenant_name: string }[];
}
export function AccessSection() {
  const { data, isLoading } = useStat<AccessStats>('console_access_stats');
  if (isLoading || !data) return <Loading />;
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <SectionTitle>Acessos</SectionTitle>
      <div style={{ ...grid(150), marginBottom: 14 }}>
        <Kpi icon={Users} label="DAU (hoje)" value={String(data.dau)} />
        <Kpi icon={Users} label="WAU (7 dias)" value={String(data.wau)} />
        <Kpi icon={Users} label="MAU (30 dias)" value={String(data.mau)} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <ChartBox title="Logins por dia (30 dias)">
          <LineChart data={(data.logins_by_day ?? []).map(d => ({ ...d, d: dayShort(d.day) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#777' }} interval={4} />
            <YAxis tick={{ fontSize: 10, fill: '#777' }} allowDecimals={false} />
            <Tooltip {...tt} />
            <Line type="monotone" dataKey="count" stroke={GOLD} strokeWidth={2} dot={false} />
          </LineChart>
        </ChartBox>
      </div>
      <div style={grid(300)}>
        <TableCard title="Por localização" icon={MapPin} cols={['Local', 'Acessos']}
          rows={(data.by_location ?? []).map(l => [`${l.city}, ${l.country}`, String(l.count)])} />
        <TableCard title="Por IP" icon={Activity} cols={['IP', 'Cidade', 'Acessos']}
          rows={(data.by_ip ?? []).map(l => [l.ip, l.city, String(l.count)])} />
      </div>
      <div style={{ marginTop: 14 }}>
        <TableCard title="Acessos recentes" icon={Activity} cols={['Data', 'Usuário', 'Tenant', 'Local', 'IP']}
          rows={(data.recent ?? []).map(r => [
            new Date(r.started_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
            r.user_name ?? '—', r.tenant_name ?? '—', [r.city, r.country].filter(Boolean).join(', ') || '—', r.ip ?? '—',
          ])} />
      </div>
    </div>
  );
}

// ── Uso ─────────────────────────────────────────────────────────────────────
interface UsageStats {
  projects_by_day: { day: string; count: number }[];
  ai_by_day: { day: string; count: number }[];
  events_total: Record<string, number> | null;
  top_users: { user_name: string; tenant_name: string; actions: number }[];
}
export function UsageSection() {
  const { data, isLoading } = useStat<UsageStats>('console_usage_stats');
  if (isLoading || !data) return <Loading />;
  const ev = data.events_total ?? {};
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <SectionTitle>Uso da plataforma</SectionTitle>
      <div style={{ ...grid(150), marginBottom: 14 }}>
        <Kpi icon={Package} label="Pacotes baixados (30d)" value={String(ev.package_download ?? 0)} />
        <Kpi icon={FileText} label="Documentos gerados (30d)" value={String(ev.doc_generated ?? 0)} />
      </div>
      <div style={{ ...grid(300), marginBottom: 14 }}>
        <ChartBox title="Projetos criados por dia">
          <BarChart data={(data.projects_by_day ?? []).map(d => ({ ...d, d: dayShort(d.day) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#777' }} interval={4} />
            <YAxis tick={{ fontSize: 10, fill: '#777' }} allowDecimals={false} />
            <Tooltip {...tt} /><Bar dataKey="count" fill={GOLD} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartBox>
        <ChartBox title="Uso de IA por dia">
          <LineChart data={(data.ai_by_day ?? []).map(d => ({ ...d, d: dayShort(d.day) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#777' }} interval={4} />
            <YAxis tick={{ fontSize: 10, fill: '#777' }} allowDecimals={false} />
            <Tooltip {...tt} /><Line type="monotone" dataKey="count" stroke="#2D9E75" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartBox>
      </div>
      <TableCard title="Usuários mais ativos (30d)" icon={Users} cols={['Usuário', 'Tenant', 'Ações']}
        rows={(data.top_users ?? []).map(u => [u.user_name ?? '—', u.tenant_name ?? '—', String(u.actions)])} />
    </div>
  );
}

// ── Financeiro ──────────────────────────────────────────────────────────────
interface FinanceStats { mrr_cents: number; by_plan: { plan: string; tenants: number; mrr_cents: number }[]; trials_active: number; paying: number; }
export function FinanceSection() {
  const { data, isLoading } = useStat<FinanceStats>('console_finance_stats');
  if (isLoading || !data) return <Loading />;
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <SectionTitle>Financeiro</SectionTitle>
      <div style={{ ...grid(160), marginBottom: 14 }}>
        <Kpi icon={DollarSign} label="MRR estimado" value={money(data.mrr_cents)} hint="planos ativos" />
        <Kpi icon={Building2} label="Pagantes" value={String(data.paying)} />
        <Kpi icon={Cpu} label="Em trial" value={String(data.trials_active)} />
      </div>
      <TableCard title="Receita por plano" icon={DollarSign} cols={['Plano', 'Tenants', 'MRR']}
        rows={(data.by_plan ?? []).map(p => [p.plan, String(p.tenants), money(p.mrr_cents)])} />
    </div>
  );
}

// ── Tabela genérica ─────────────────────────────────────────────────────────
function TableCard({ title, icon: Icon, cols, rows }: { title: string; icon: React.ElementType; cols: string[]; rows: string[][] }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', fontSize: 13, fontWeight: 600, marginBottom: 10 }}><Icon size={15} style={{ color: GOLD }} /> {title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{cols.map(c => <th key={c} style={{ textAlign: 'left', fontSize: 11, color: '#777', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid #222' }}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols.length} style={{ padding: 16, textAlign: 'center', color: '#666', fontSize: 12 }}>Sem dados ainda</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>{r.map((cell, j) => <td key={j} style={{ fontSize: 12, color: '#ddd', padding: '6px 8px', borderBottom: '1px solid #1a1a22', whiteSpace: 'nowrap' }}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
