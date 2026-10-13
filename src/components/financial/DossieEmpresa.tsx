import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowLeft, CalendarClock, Clock, Loader2, TrendingUp, Wallet } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { EmpresaPainel, useEmpresaPainel } from '@/hooks/useDossieFinanceiro';
import { RecebimentosBloco } from '@/components/financial/RecebimentosBloco';

/**
 * DOSSIÊ DE UMA EMPRESA no financeiro do admin.
 *
 * Pedido do usuário (out/2026): escolher uma empresa não devia só filtrar a
 * lista — devia trocar a tela, com histórico de pagamento, evolução e gráfico
 * da empresa, "para não correr o risco de confundir a informação com a de
 * outra empresa". Por isso tudo aqui é da empresa escolhida, com o nome dela
 * no topo e um caminho claro de volta.
 *
 * ── A ressalva do prazo médio ──────────────────────────────────────────────
 * `project_financials.due_date` está vazio no banco, então NÃO existe "dias de
 * atraso contra o vencimento". O que se mede é do projeto ENTRAR até o
 * dinheiro chegar. O número é honesto; o rótulo é que engana se ficar só
 * "prazo", e é por isso que a tela explica embaixo.
 *
 * ── O valor por projeto é adaptativo, e pelo DADO ──────────────────────────
 * Escolher o indicador pelo `pricing_type` não funcionaria: 34 das 36 empresas
 * são `manual`/`fixed`, e a variação real não segue o tipo (uma `manual` tem 22
 * projetos no mesmo valor, outra vai de R$ 498 a R$ 3.700). Quem decide é
 * `valores_distintos`: valor único vira um número, valor que varia mostra a
 * média com a faixa. Gráfico de ticket seria uma linha reta na maioria.
 */

const fmt = formatCurrency;
const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #ECECEC', borderRadius: 12,
};

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (iso: string) => {
  const [a, m] = iso.split('-');
  return MESES[Number(m) - 1] + (m === '01' ? `/${a.slice(2)}` : '');
};
const mesLongo = (iso: string) => {
  const [a, m] = iso.split('-');
  return new Date(Number(a), Number(m) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};
const dataBR = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
const diasDesde = (iso: string) =>
  Math.round((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 86400000);

function KpiEscuro({ label, valor, sub, pct, cor }: {
  label: string; valor: string; sub?: string; pct: number; cor: string;
}) {
  return (
    <div>
      <p style={{
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.44)', margin: 0,
      }}>
        {label}
      </p>
      <p style={{ ...NUM, fontSize: 22, fontWeight: 700, color: cor, margin: '7px 0 3px', letterSpacing: '-0.02em' }}>
        {valor}
      </p>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{sub ?? ''}</p>
      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginTop: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: cor, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function Metrica({ label, valor, sub, icone: Icone }: {
  label: string; valor: string; sub: string; icone: typeof Wallet;
}) {
  return (
    <div style={{ ...CARD, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <Icone size={13} style={{ color: '#B5B5B5' }} />
        <p style={{
          fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
          color: '#8A8A8A', margin: 0,
        }}>
          {label}
        </p>
      </div>
      <p style={{ ...NUM, fontSize: 20, fontWeight: 700, margin: '0 0 3px', color: '#1A1A1A', letterSpacing: '-0.02em' }}>
        {valor}
      </p>
      <p style={{ fontSize: 11, color: '#8A8A8A', margin: 0, lineHeight: 1.5 }}>{sub}</p>
    </div>
  );
}

/** O card do valor por projeto, que muda de forma conforme o dado varia. */
function valorPorProjeto(p: EmpresaPainel): { valor: string; sub: string } {
  if (p.projetos === 0) return { valor: '—', sub: 'Nenhum projeto ainda.' };
  if (p.valores_distintos <= 1) {
    return {
      valor: fmt(p.valor_min ?? 0),
      sub: `Sempre o mesmo valor nos ${p.projetos} projetos.`,
    };
  }
  return {
    valor: fmt(p.ticket_medio ?? 0),
    sub: `Média de ${p.valores_distintos} valores diferentes — de ${fmt(p.valor_min ?? 0)} a ${fmt(p.valor_max ?? 0)}.`,
  };
}

export function DossieEmpresa({ companyId, prazoDoTenant, onVoltar }: {
  companyId: string;
  /** prazo médio de todas as empresas, para dizer se esta está acima ou abaixo */
  prazoDoTenant: number | null;
  onVoltar: () => void;
}) {
  const { data: p, isLoading, isError } = useEmpresaPainel(companyId);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <Loader2 size={24} className="animate-spin" style={{ color: '#F5A800' }} />
      </div>
    );
  }
  if (isError || !p) {
    return (
      <div style={{ ...CARD, padding: '20px' }}>
        <p style={{ fontSize: 13, color: '#E24B4A', margin: 0 }}>
          Não consegui carregar os dados desta empresa.
        </p>
        <button onClick={onVoltar} style={{
          marginTop: 10, fontSize: 12, fontWeight: 700, color: '#185FA5',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>
          ← Voltar para todas as empresas
        </button>
      </div>
    );
  }

  const pctRecebido = p.faturado > 0 ? (p.recebido / p.faturado) * 100 : 0;
  const pctAberto = p.faturado > 0 ? (p.aberto / p.faturado) * 100 : 0;
  const vpp = valorPorProjeto(p);

  const melhorMes = p.serie.reduce<typeof p.serie[number] | null>(
    (m, s) => (m === null || s.projetos > m.projetos ? s : m), null,
  );

  const dados = p.serie.map(s => ({
    mes: rotuloMes(s.mes),
    projetos: s.projetos,
    faturado: s.faturado,
    recebido: s.recebido,
  }));

  // comparação com o tenant: "paga melhor ou pior que a média?"
  const comparacao = (() => {
    if (p.prazo_medio_dias === null) return 'Nunca pagou nada.';
    if (prazoDoTenant === null) return 'do projeto entrar até pagar';
    const d = p.prazo_medio_dias - prazoDoTenant;
    if (Math.abs(d) <= 2) return 'na média das empresas';
    return d < 0 ? `${Math.abs(d)} dias melhor que a média` : `${d} dias pior que a média`;
  })();

  return (
    <div>
      {/* ── Cabeçalho escuro: tudo daqui para baixo é desta empresa ── */}
      <div style={{ background: '#1A1A1A', borderRadius: 14, padding: '20px 26px', marginBottom: 14 }}>
        <button
          onClick={onVoltar}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
            color: 'rgba(255,255,255,0.5)', background: 'none', border: 'none',
            cursor: 'pointer', padding: 0, marginBottom: 12,
          }}
        >
          <ArrowLeft size={13} /> Todas as empresas
        </button>

        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          gap: 14, flexWrap: 'wrap', marginBottom: 20,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
              {p.company_name}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.42)' }}>
              {p.cliente_desde ? `Cliente desde ${mesLongo(p.cliente_desde.slice(0, 7))} · ` : ''}
              {p.projetos} {p.projetos === 1 ? 'projeto' : 'projetos'}
              {p.serie.length > 0 && ` · ${p.serie.length} ${p.serie.length === 1 ? 'mês' : 'meses'} de histórico`}
            </p>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '4px 9px', borderRadius: 6, background: 'rgba(245,168,0,0.16)',
            color: '#F5A800', border: '1px solid rgba(245,168,0,0.3)', whiteSpace: 'nowrap',
          }}>
            {p.pricing_type === 'monthly' ? 'Assinatura mensal'
              : p.pricing_type === 'manual' ? 'Preço manual'
              : p.pricing_type === 'fixed' ? 'Preço fixo'
              : p.pricing_type}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 26 }}>
          <KpiEscuro label="Faturado" valor={fmt(p.faturado)}
                     sub={`${p.projetos} ${p.projetos === 1 ? 'projeto' : 'projetos'}`}
                     pct={100} cor="#F5A800" />
          <KpiEscuro label="Recebido" valor={fmt(p.recebido)}
                     sub={`${pctRecebido.toFixed(0)}% do faturado`} pct={pctRecebido} cor="#4CAF7D" />
          <KpiEscuro label="Em aberto" valor={fmt(p.aberto)}
                     sub={`${p.abertos_qtd} ${p.abertos_qtd === 1 ? 'projeto' : 'projetos'}`}
                     pct={pctAberto} cor={p.aberto > 0 ? '#F5A800' : '#4CAF7D'} />
          <KpiEscuro
            label="Prazo médio"
            valor={p.prazo_medio_dias === null ? '—' : `${p.prazo_medio_dias} dias`}
            sub={comparacao}
            pct={p.prazo_medio_dias === null ? 0 : Math.min(100, (p.prazo_medio_dias / 60) * 100)}
            cor={p.prazo_medio_dias === null ? '#E24B4A' : '#378ADD'}
          />
        </div>
      </div>

      {/* ── Três métricas de leitura rápida ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 12, marginBottom: 14,
      }}>
        <Metrica label="Valor por projeto" valor={vpp.valor} sub={vpp.sub} icone={Wallet} />
        <Metrica
          label="Melhor mês"
          valor={melhorMes ? `${melhorMes.projetos} ${melhorMes.projetos === 1 ? 'projeto' : 'projetos'}` : '—'}
          sub={melhorMes ? `${mesLongo(melhorMes.mes)} · ${fmt(melhorMes.faturado)} faturados` : 'Sem histórico.'}
          icone={TrendingUp}
        />
        <Metrica
          label="Último pagamento"
          valor={p.ultimo_valor != null ? fmt(p.ultimo_valor) : '—'}
          sub={p.ultimo_pagamento
            ? `Em ${dataBR(p.ultimo_pagamento)} · há ${diasDesde(p.ultimo_pagamento)} dias`
            : 'Esta empresa nunca pagou nada.'}
          icone={CalendarClock}
        />
      </div>

      {/* ── Volume contra dinheiro ── */}
      <div style={{ ...CARD, marginBottom: 14 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #ECECEC' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
            Volume e dinheiro, mês a mês
          </p>
          <p style={{ fontSize: 11, color: '#8A8A8A', margin: '2px 0 0' }}>
            Barras = projetos que entraram · linhas = faturado e recebido
          </p>
        </div>
        <div style={{ padding: '16px 10px 10px' }}>
          {dados.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#999', textAlign: 'center', padding: '30px 0', margin: 0 }}>
              Sem histórico para desenhar.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={dados} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#F2F2F0" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#8A8A8A' }}
                       axisLine={false} tickLine={false} />
                <YAxis yAxisId="qtd" tick={{ fontSize: 10, fill: '#B5B5B5' }}
                       axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <YAxis yAxisId="dinheiro" orientation="right"
                       tick={{ fontSize: 10, fill: '#B5B5B5' }} axisLine={false} tickLine={false}
                       width={54}
                       tickFormatter={(v: number) => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v))} />
                <Tooltip
                  formatter={(v: number, n: string) =>
                    n === 'projetos' ? [String(v), 'Projetos'] : [fmt(v), n === 'faturado' ? 'Faturado' : 'Recebido']}
                  contentStyle={{ fontSize: 11.5, borderRadius: 8, border: '1px solid #F0F0F0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                        formatter={(v: string) =>
                          v === 'projetos' ? 'Projetos que entraram' : v === 'faturado' ? 'Faturado' : 'Recebido'} />
                <Bar yAxisId="qtd" dataKey="projetos" fill="#F5A800" fillOpacity={0.32}
                     radius={[3, 3, 0, 0]} barSize={26} />
                <Line yAxisId="dinheiro" type="linear" dataKey="faturado" stroke="#1A1A1A"
                      strokeWidth={2} dot={{ r: 3, fill: '#1A1A1A' }} />
                <Line yAxisId="dinheiro" type="linear" dataKey="recebido" stroke="#4CAF7D"
                      strokeWidth={2} dot={{ r: 3, fill: '#4CAF7D' }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        {/* a frase existe para não obrigar a reinterpretar o gráfico toda vez */}
        <div style={{
          display: 'flex', gap: 9, alignItems: 'flex-start', margin: '0 14px 14px',
          background: '#F6F5FD', border: '1px solid #DDD9F5', borderRadius: 10, padding: '11px 13px',
        }}>
          <Clock size={14} style={{ color: '#3C3489', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 11.5, color: '#3C3489', margin: 0, lineHeight: 1.55 }}>
            {p.prazo_medio_dias === null ? (
              <>Entraram <strong>{fmt(p.faturado)}</strong> em projetos e <strong>nada</strong> foi
              pago. O recebido é a linha verde no zero.</>
            ) : (
              <>Em {p.serie.length} {p.serie.length === 1 ? 'mês' : 'meses'}:
              {' '}<strong>{fmt(p.faturado)}</strong> faturados e <strong>{fmt(p.recebido)}</strong> recebidos.
              {p.prazo_medio_dias >= 25
                ? <> O dinheiro chega cerca de <strong>{p.prazo_medio_dias} dias</strong> depois de o
                  projeto entrar — na prática, no mês seguinte, e é por isso que as duas linhas
                  não andam juntas.</>
                : <> O dinheiro chega em <strong>{p.prazo_medio_dias} dias</strong>, então as duas
                  linhas tendem a andar próximas.</>}
              </>
            )}
            {' '}O prazo é medido do projeto <strong>entrar</strong> até o pagamento — não há
            vencimento cadastrado nas ARTs, então não é atraso contratual.
          </p>
        </div>
      </div>

      {/* ── Histórico completo: aqui é o lugar dele ── */}
      <div style={{ marginBottom: 14 }}>
        <RecebimentosBloco
          companyId={companyId}
          podeEstornar
          titulo={`Histórico de pagamentos · ${p.company_name}`}
          subtitulo="Todos os recebimentos desta empresa, do mais recente ao mais antigo"
          limite={300}
        />
      </div>
    </div>
  );
}
