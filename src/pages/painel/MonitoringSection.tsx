import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { AlertTriangle, ShieldAlert, FileText, Users, Package } from 'lucide-react';
import { GOLD, card, grid, Kpi, Loading, SectionTitle, ChartBox, tt, dayShort } from './ConsoleSections';

/**
 * Monitoramento do sistema: erros, segurança, auditoria, cadastros e deploys
 * num fluxo único. Os dados vêm das RPCs console_events*, que só respondem
 * para o master — o filtro de permissão está no banco, não aqui.
 */

interface EventRow {
  id: string; created_at: string; kind: string; severity: string; source: string;
  action: string; message: string | null; tenant_id: string | null; tenant_name: string | null;
  user_email: string | null; ip: string | null; route: string | null;
  entity_type: string | null; metadata: Record<string, unknown> | null;
}
interface EventsSummary {
  total: number; erros: number; criticos: number; seguranca: number;
  auditoria: number; cadastros: number; deploys: number;
  por_dia: { dia: string; erros: number; seguranca: number; total: number }[];
}

const KIND_LABEL: Record<string, string> = {
  error: 'Erro', security: 'Segurança', audit: 'Auditoria',
  signup: 'Cadastro', deploy: 'Publicação',
};
const SEV_COLOR: Record<string, string> = {
  info: '#4B9BFF', warning: '#F5A800', error: '#FF6B4A', critical: '#FF3B30',
};

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
      color, background: `${color}1F`, border: `1px solid ${color}40`,
      borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

export function MonitoringSection() {
  const [kind, setKind] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(7);
  const [aberto, setAberto] = useState<string | null>(null);

  const resumo = useQuery({
    queryKey: ['console-events-summary', days],
    queryFn: async (): Promise<EventsSummary> => {
      const { data, error } = await supabase.rpc('console_events_summary' as never, { p_days: days } as never);
      if (error) throw error;
      return data as EventsSummary;
    },
    staleTime: 30_000,
  });

  const lista = useQuery({
    queryKey: ['console-events', kind, severity, search, days],
    queryFn: async (): Promise<EventRow[]> => {
      const { data, error } = await supabase.rpc('console_events' as never, {
        p_kind: kind || null, p_severity: severity || null,
        p_search: search || null, p_days: days, p_limit: 200, p_offset: 0,
      } as never);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
    staleTime: 15_000,
  });

  const s = resumo.data;
  const campo: React.CSSProperties = {
    background: '#0E0E14', color: '#ddd', border: '1px solid #2A2A35',
    borderRadius: 8, padding: '7px 10px', fontSize: 12,
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <SectionTitle>Monitoramento</SectionTitle>

      {s && (
        <>
          <div style={{ ...grid(150), marginBottom: 14 }}>
            <Kpi icon={AlertTriangle} label="Erros" value={String(s.erros ?? 0)} hint={`${s.criticos ?? 0} críticos`} />
            <Kpi icon={ShieldAlert} label="Segurança" value={String(s.seguranca ?? 0)} hint="logins falhos e acessos negados" />
            <Kpi icon={FileText} label="Auditoria" value={String(s.auditoria ?? 0)} hint="alterações registradas" />
            <Kpi icon={Users} label="Cadastros" value={String(s.cadastros ?? 0)} />
            <Kpi icon={Package} label="Publicações" value={String(s.deploys ?? 0)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <ChartBox title={`Eventos por dia (${days}d)`}>
              <LineChart data={(s.por_dia ?? []).map(d => ({ ...d, dia: dayShort(d.dia) }))}>
                <CartesianGrid stroke="#222" vertical={false} />
                <XAxis dataKey="dia" stroke="#666" fontSize={11} />
                <YAxis stroke="#666" fontSize={11} allowDecimals={false} />
                <Tooltip {...tt} />
                <Line type="monotone" dataKey="erros" name="Erros" stroke="#FF6B4A" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="seguranca" name="Segurança" stroke={GOLD} strokeWidth={2} dot={false} />
              </LineChart>
            </ChartBox>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar mensagem, ação ou e-mail…"
          style={{ ...campo, flex: 1, minWidth: 200 }}
        />
        <select value={kind} onChange={e => setKind(e.target.value)} style={campo}>
          <option value="">Todos os tipos</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={severity} onChange={e => setSeverity(e.target.value)} style={campo}>
          <option value="">Toda severidade</option>
          <option value="critical">Crítico</option>
          <option value="error">Erro</option>
          <option value="warning">Atenção</option>
          <option value="info">Info</option>
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={campo}>
          <option value={1}>24 horas</option>
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
        </select>
      </div>

      {lista.isLoading ? <Loading /> : (lista.data ?? []).length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: '#777', fontSize: 13 }}>
          Nenhum evento no período. Silêncio aqui é boa notícia.
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {(lista.data ?? []).map((e, i) => {
            const cor = SEV_COLOR[e.severity] ?? '#888';
            const expandido = aberto === e.id;
            return (
              <div key={e.id} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={() => setAberto(expandido ? null : e.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: cor, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', flexShrink: 0 }}>
                    {new Date(e.created_at).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  <Chip text={KIND_LABEL[e.kind] ?? e.kind} color={cor} />
                  <span style={{
                    fontSize: 12, color: '#ddd', flex: 1, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {e.message || e.action}
                  </span>
                  {e.tenant_name && (
                    <span style={{ fontSize: 11, color: '#777', flexShrink: 0 }}>{e.tenant_name}</span>
                  )}
                </button>
                {expandido && (
                  <div style={{ padding: '0 14px 12px 30px', fontSize: 11, color: '#999', display: 'grid', gap: 3 }}>
                    <div><b style={{ color: '#bbb' }}>Ação:</b> {e.action} · <b style={{ color: '#bbb' }}>Origem:</b> {e.source}</div>
                    {e.user_email && <div><b style={{ color: '#bbb' }}>Usuário:</b> {e.user_email}</div>}
                    {e.ip && <div><b style={{ color: '#bbb' }}>IP:</b> {e.ip}</div>}
                    {e.route && <div><b style={{ color: '#bbb' }}>Tela:</b> {e.route}</div>}
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <pre style={{
                        margin: '4px 0 0', padding: 8, background: '#0E0E14', borderRadius: 6,
                        fontSize: 10, color: '#8FA88F', overflowX: 'auto', whiteSpace: 'pre-wrap',
                      }}>{JSON.stringify(e.metadata, null, 2)}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
