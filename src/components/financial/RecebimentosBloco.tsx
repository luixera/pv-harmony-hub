import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Wallet } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Recebimento, useEstornarRecebimento, useRecebimentos } from '@/hooks/useRecebimentos';

/**
 * PAGAMENTOS RECEBIDOS — "o valor pago no dia e o que ele quitou".
 *
 * O mesmo bloco serve o admin (`/admin/financial`, todas as empresas) e a
 * empresa (`/company/financial`, só a dela, sem estorno). A empresa já lê os
 * próprios recebimentos por RLS; o componente não inventa acesso.
 */

const fmt = formatCurrency;

const dia = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function Linhas({ r }: { r: Recebimento }) {
  if (r.linhas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-3 py-2">
        Este valor não foi aplicado em nada — ficou inteiro como crédito.
      </p>
    );
  }
  return (
    <div className="divide-y">
      {r.linhas.map((l, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <span className={'text-[10px] px-1.5 py-0.5 rounded shrink-0 font-semibold ' + (l.quitou
            ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800')}>
            {l.quitou ? 'QUITOU' : 'ABATEU'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">
              {l.rotulo}
              {l.tipo === 'assinatura' && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">mensalidade</span>
              )}
            </p>
            {l.detalhe && <p className="text-[11px] text-muted-foreground truncate">{l.detalhe}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold tabular-nums">{fmt(l.valor)}</p>
            {!l.quitou && l.total > 0 && (
              <p className="text-[11px] text-muted-foreground tabular-nums">de {fmt(l.total)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Cartao({ r, podeEstornar, mostrarEmpresa }: {
  r: Recebimento; podeEstornar: boolean; mostrarEmpresa: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const estornar = useEstornarRecebimento();
  const estornado = !!r.reversed_at;

  return (
    <div className={'rounded-xl border bg-card ' + (estornado ? 'opacity-60' : '')}>
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center gap-3 p-3 text-left"
        aria-expanded={aberto}
      >
        {aberto ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{dia(r.received_date)}</span>
            {mostrarEmpresa && <span className="text-sm text-muted-foreground truncate">{r.company_name}</span>}
            {estornado && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-semibold">ESTORNADO</span>
            )}
            {r.credit > 0 && !estornado && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                {fmt(r.credit)} de crédito
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {r.linhas.length === 1 ? '1 item' : r.linhas.length + ' itens'}
            {' · lançado por ' + r.criado_por}
            {r.notes ? ' · ' + r.notes : ''}
          </p>
        </div>
        <span className="text-lg font-bold tabular-nums shrink-0">{fmt(r.amount)}</span>
      </button>

      {aberto && (
        <div className="border-t">
          <Linhas r={r} />
          {estornado && r.reversal_reason && (
            <p className="text-xs text-red-700 px-3 py-2 border-t">Estorno: {r.reversal_reason}</p>
          )}
          {podeEstornar && !estornado && (
            <div className="px-3 py-2 border-t flex justify-end">
              <button
                onClick={() => {
                  const motivo = window.prompt(
                    'Estornar este recebimento desfaz todas as parcelas dele. Qual o motivo?',
                  );
                  if (motivo === null) return;
                  estornar.mutate({ id: r.id, motivo: motivo.trim() || undefined });
                }}
                disabled={estornar.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive hover:underline disabled:opacity-50"
              >
                {estornar.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RotateCcw className="w-3.5 h-3.5" />}
                Estornar o recebimento inteiro
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RecebimentosBloco({ companyId, podeEstornar, titulo }: {
  /** nulo = todas as empresas do tenant (visão do admin) */
  companyId?: string | null;
  podeEstornar?: boolean;
  titulo?: string;
}) {
  const { data: recebimentos = [], isLoading, isError } = useRecebimentos(companyId ?? null);

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold">{titulo ?? 'Pagamentos recebidos'}</h2>
        {recebimentos.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {recebimentos.length === 1 ? '1 recebimento' : recebimentos.length + ' recebimentos'}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          Não consegui ler os recebimentos. Recarregue a página.
        </p>
      ) : recebimentos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center rounded-xl border border-dashed">
          Nenhum pagamento registrado ainda. Quando um valor for lançado, ele aparece
          aqui com o que foi quitado e o que foi abatido.
        </p>
      ) : (
        <div className="space-y-2">
          {recebimentos.map(r => (
            <Cartao key={r.id} r={r} podeEstornar={!!podeEstornar} mostrarEmpresa={!companyId} />
          ))}
        </div>
      )}
    </section>
  );
}
