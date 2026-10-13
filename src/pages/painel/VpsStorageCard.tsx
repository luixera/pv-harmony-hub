import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { HardDrive, CheckCircle2, AlertTriangle } from 'lucide-react';
import { GOLD, card, tt, dayShort } from './ConsoleSections';

/**
 * Armazenamento da VPS. O dado vem do batimento do worker da Ludmilla, que é
 * quem roda lá e vê o disco — a SPA é estática e não vê nada.
 *
 * Isso existe antes do mapa de capacidade de rede de propósito: a importação
 * da BDGD baixa e descompacta gigabytes na mesma máquina que serve o app, e
 * ficar sem disco no meio é falha silenciosa.
 *
 * Uma série só, então sem legenda: o título nomeia. Status com ícone E
 * rótulo, nunca cor sozinha — as cores são as validadas para daltonismo
 * (ΔE 12,6 em protanopia; ver a §7 da spec).
 */

const FOLGA = '#1F7A3D';
const ATENCAO = '#F5A800';
const RISCO = '#F0523F';
const SERIE = '#5B9CF8';

// Limiares em constantes nomeadas, não em tabela: hoje são dois números e
// não existe tabela de configuração de plataforma. Na terceira configuração
// desse tipo, vale criar uma (dívida registrada no plano).
const LIMIAR_ATENCAO = 80;
const LIMIAR_RISCO = 90;

interface Atual {
  host: string;
  particao: string;
  total_bytes: number;
  usado_bytes: number;
  livre_bytes: number;
  medido_em: string;
}
interface Ponto { dia: string; usado_bytes: number; total_bytes: number }
interface Resposta { atual: Atual | null; serie: Ponto[] }

const gb = (bytes: number) => bytes / 1_000_000_000;
const fmtGB = (bytes: number) =>
  gb(bytes).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function estado(ocupacaoPct: number) {
  if (ocupacaoPct >= LIMIAR_RISCO) return { cor: RISCO, rotulo: 'Disco crítico', Icone: AlertTriangle };
  if (ocupacaoPct >= LIMIAR_ATENCAO) return { cor: ATENCAO, rotulo: 'Disco apertado', Icone: AlertTriangle };
  return { cor: FOLGA, rotulo: 'Espaço suficiente', Icone: CheckCircle2 };
}

export function VpsStorageCard() {
  const q = useQuery({
    queryKey: ['console-vps-armazenamento'],
    queryFn: async (): Promise<Resposta> => {
      const { data, error } = await supabase.rpc('console_vps_armazenamento' as never, { p_dias: 30 } as never);
      if (error) throw error;
      return data as Resposta;
    },
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return <div style={{ ...card, color: '#777', fontSize: 13 }}>Lendo o armazenamento da VPS…</div>;
  }

  if (q.isError) {
    return (
      <div style={{ ...card, color: '#FF7A6B', fontSize: 13 }}>
        Não consegui ler o armazenamento da VPS.{' '}
        <button
          type="button"
          onClick={() => void q.refetch()}
          style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const atual = q.data?.atual ?? null;
  if (!atual) {
    return (
      <div style={{ ...card, color: '#777', fontSize: 13 }}>
        Nenhuma medição ainda. O worker da Ludmilla grava a primeira ao subir na VPS.
      </div>
    );
  }

  const ocupacao = atual.total_bytes > 0
    ? Math.round((atual.usado_bytes / atual.total_bytes) * 1000) / 10
    : 0;
  const { cor, rotulo, Icone } = estado(ocupacao);
  const serie = (q.data?.serie ?? []).map(p => ({ dia: dayShort(p.dia), usado: gb(p.usado_bytes) }));
  const totalGB = gb(atual.total_bytes);

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888', fontSize: 12 }}>
            <HardDrive size={15} style={{ color: cor }} /> Armazenamento da VPS
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginTop: 8 }}>
            {fmtGB(atual.livre_bytes)} GB livres
          </div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
            de {fmtGB(atual.total_bytes)} GB · {atual.host}{atual.particao} · medido{' '}
            {new Date(atual.medido_em).toLocaleString('pt-BR', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
          color: '#ddd', padding: '4px 9px', borderRadius: 20,
          background: `${cor}2E`, border: `1px solid ${cor}80`, whiteSpace: 'nowrap',
        }}>
          <Icone size={11} style={{ color: cor }} /> {rotulo}
        </span>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#777' }}>Ocupação</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ddd' }}>
            {ocupacao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        </div>
        <div style={{ position: 'relative', height: 10, background: 'rgba(255,255,255,0.07)', borderRadius: '0 5px 5px 0' }}>
          <div style={{ width: `${Math.min(ocupacao, 100)}%`, height: '100%', background: cor, borderRadius: '0 4px 4px 0' }} />
          <div style={{ position: 'absolute', left: `${LIMIAR_ATENCAO}%`, top: -4, bottom: -4, width: 2, background: ATENCAO }} />
          <div style={{ position: 'absolute', left: `${LIMIAR_RISCO}%`, top: -4, bottom: -4, width: 2, background: RISCO }} />
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#888' }}>
            <span style={{ width: 2, height: 10, background: ATENCAO }} /> atenção em {LIMIAR_ATENCAO}%
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#888' }}>
            <span style={{ width: 2, height: 10, background: RISCO }} /> crítico em {LIMIAR_RISCO}%
          </span>
        </div>
      </div>

      {serie.length > 1 && (
        <div>
          <p style={{ fontSize: 12, color: '#aaa', margin: '0 0 8px' }}>
            Disco usado — últimos 30 dias (GB de {fmtGB(atual.total_bytes)})
          </p>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={serie}>
              <CartesianGrid stroke="#222" vertical={false} />
              <XAxis dataKey="dia" stroke="#666" fontSize={11} />
              <YAxis stroke="#666" fontSize={11} domain={[0, Math.ceil(totalGB)]} />
              <Tooltip {...tt} formatter={(v: number) => [`${v.toFixed(1)} GB`, 'usado']} />
              <Area type="monotone" dataKey="usado" stroke={SERIE} strokeWidth={2} fill={SERIE} fillOpacity={0.14} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
