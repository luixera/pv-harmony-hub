import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * RECEBIMENTO EM LOTE — um valor redondo quitando vários projetos.
 *
 * A empresa integradora manda R$ 5.000 que não casa com o total de nenhum
 * projeto. Aqui a pessoa lança o valor UMA vez, o banco sugere a distribuição
 * (ARTs da mais antiga para a mais nova, mensalidade com a sobra) e ela ajusta
 * antes de confirmar. Nada é redistribuído pelo servidor: `recebimento_registrar`
 * grava exatamente as linhas que a tela mandou.
 *
 * O `as never` nos argumentos de `supabase.rpc` é o padrão do repositório: os
 * tipos gerados estão defasados e sem ele o `tsc` sai do baseline.
 */

export type TipoAlvo = 'art' | 'assinatura';

/** Uma coisa que a empresa deve: uma ART de projeto ou uma mensalidade. */
export interface LinhaAberta {
  ordem: number;
  tipo: TipoAlvo;
  alvo_id: string;
  rotulo: string;
  detalhe: string;
  /** Etapa do projeto (`projects.status`). Nula na mensalidade, que não tem
   *  etapa — e por isso nunca é filtrada. */
  etapa: string | null;
  vencimento: string | null;
  total: number;
  pago: number;
  aberto: number;
  /** quanto o banco sugere aplicar nesta linha; a tela deixa editar */
  sugerido: number;
}

/** Uma parcela dentro do depósito, como o extrato devolve. */
export interface ParcelaDoRecebimento {
  tipo: TipoAlvo;
  rotulo: string;
  detalhe: string;
  valor: number;
  total: number;
  /** true = esse dinheiro QUITOU o item; false = abateu parte dele */
  quitou: boolean;
  project_id: string | null;
}

export interface Recebimento {
  id: string;
  company_id: string;
  company_name: string;
  received_date: string;
  amount: number;
  aplicado: number;
  credit: number;
  notes: string | null;
  criado_por: string;
  /**
   * De onde veio o cartão. `reconstruido` é dedução do sistema — somou os
   * pagamentos da mesma empresa no mesmo dia, para o histórico anterior ao
   * recebimento em lote também contar o que cada dinheiro quitou. Nesse caso
   * `credit` é sempre 0, porque a sobra nunca foi registrada em lugar nenhum.
   * A tela marca a diferença: "alguém lançou R$ 1.000" e "o sistema somou o
   * dia e deu R$ 1.000" não são a mesma afirmação.
   */
  origin: 'lancado' | 'reconstruido';
  reversed_at: string | null;
  reversal_reason: string | null;
  linhas: ParcelaDoRecebimento[];
}

const num = (v: unknown) => Number(v ?? 0);

/** Invalida tudo o que mostra dinheiro, para as telas não divergirem. */
function invalidarFinanceiro(qc: ReturnType<typeof useQueryClient>) {
  for (const k of [
    'recebimentos', 'recebimento-credito', 'financial-dashboard', 'financials',
    'payment-history', 'projects', 'project', 'subscription-charges',
    'company-subscription-statement',
  ]) qc.invalidateQueries({ queryKey: [k] });
}

/**
 * O que a empresa deve, com a distribuição sugerida para `valor`.
 * Só calcula — não grava nada. Refaz a conta a cada mudança de valor.
 *
 * `etapas` restringe QUAIS projetos recebem a sugestão. Lista vazia = todos,
 * que é o comportamento de sempre. O filtro vive no banco de propósito: a ART
 * fora do recorte é pulada **antes** de consumir o valor, e é só assim que o
 * dinheiro escorre para os projetos seguintes. Desmarcar a linha aqui na tela
 * não faria isso — viraria sobra, e sobra vira crédito da empresa.
 */
export function useSugestaoRecebimento(companyId: string | null, valor: number, etapas: string[] = []) {
  // ordenada na chave do cache: marcar A e depois B é a mesma consulta que B e A
  const etapasOrdenadas = [...etapas].sort();
  return useQuery({
    queryKey: ['recebimento-sugestao', companyId, valor, etapasOrdenadas.join(',')],
    queryFn: async (): Promise<LinhaAberta[]> => {
      if (!companyId) return [];
      const { data, error } = await supabase.rpc('recebimento_sugerir' as never, {
        _company_id: companyId, _valor: valor,
        _etapas: etapasOrdenadas.length ? etapasOrdenadas : null,
      } as never);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(r => ({
        ordem: num(r.ordem),
        tipo: r.tipo as TipoAlvo,
        alvo_id: String(r.alvo_id),
        rotulo: String(r.rotulo ?? ''),
        detalhe: String(r.detalhe ?? ''),
        etapa: (r.etapa as string | null) ?? null,
        vencimento: (r.vencimento as string | null) ?? null,
        total: num(r.total),
        pago: num(r.pago),
        aberto: num(r.aberto),
        sugerido: num(r.sugerido),
      }));
    },
    enabled: !!companyId,
    // o valor muda enquanto a pessoa digita: não vale guardar cache longo
    staleTime: 0,
    gcTime: 0,
  });
}

/** Sobras de depósitos anteriores que ainda não foram aplicadas. */
export function useCreditoDaEmpresa(companyId: string | null) {
  return useQuery({
    queryKey: ['recebimento-credito', companyId],
    queryFn: async (): Promise<number> => {
      if (!companyId) return 0;
      const { data, error } = await supabase.rpc('recebimento_credito' as never, {
        _company_id: companyId,
      } as never);
      if (error) throw error;
      return num(data);
    },
    enabled: !!companyId,
  });
}

/**
 * O extrato: uma linha por depósito, com o que aquele dinheiro quitou e abateu.
 * É o que as duas telas mostram — `companyId` nulo traz o tenant todo (admin).
 */
export function useRecebimentos(companyId?: string | null, limite = 50) {
  return useQuery({
    queryKey: ['recebimentos', companyId ?? 'todos', limite],
    queryFn: async (): Promise<Recebimento[]> => {
      const { data, error } = await supabase.rpc('recebimento_extrato' as never, {
        _company_id: companyId ?? null, _limite: limite,
      } as never);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(r => ({
        id: String(r.id),
        company_id: String(r.company_id),
        company_name: String(r.company_name ?? ''),
        received_date: String(r.received_date),
        amount: num(r.amount),
        aplicado: num(r.aplicado),
        credit: num(r.credit),
        notes: (r.notes as string | null) ?? null,
        criado_por: String(r.criado_por ?? '—'),
        origin: r.origin === 'reconstruido' ? 'reconstruido' : 'lancado',
        reversed_at: (r.reversed_at as string | null) ?? null,
        reversal_reason: (r.reversal_reason as string | null) ?? null,
        linhas: (((r.linhas as unknown[]) ?? []) as Record<string, unknown>[]).map(l => ({
          tipo: l.tipo as TipoAlvo,
          rotulo: String(l.rotulo ?? ''),
          detalhe: String(l.detalhe ?? ''),
          valor: num(l.valor),
          total: num(l.total),
          quitou: Boolean(l.quitou),
          project_id: (l.project_id as string | null) ?? null,
        })),
      }));
    },
  });
}

export interface LinhaParaGravar {
  tipo: TipoAlvo;
  alvo_id: string;
  valor: number;
}

/** Grava o depósito e as parcelas que a pessoa confirmou. */
export function useRegistrarRecebimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      companyId: string; data: string; valor: number;
      linhas: LinhaParaGravar[]; notes?: string;
    }) => {
      const { data, error } = await supabase.rpc('recebimento_registrar' as never, {
        _company_id: p.companyId,
        _data: p.data,
        _valor: p.valor,
        _linhas: p.linhas,
        _notes: p.notes ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (_id, p) => {
      invalidarFinanceiro(qc);
      const aplicado = p.linhas.reduce((s, l) => s + l.valor, 0);
      const sobra = p.valor - aplicado;
      toast.success(
        sobra > 0
          ? `Recebimento registrado — sobrou ${sobra.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de crédito`
          : `Recebimento registrado em ${p.linhas.length} item(ns)`,
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui registrar o recebimento'),
  });
}

/** Desfaz o depósito inteiro, com linha de reversão nos dois razonetes. Só admin. */
export function useEstornarRecebimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo?: string }) => {
      const { data, error } = await supabase.rpc('recebimento_estornar' as never, {
        _receipt_id: id, _motivo: motivo ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as boolean;
    },
    onSuccess: (ok) => {
      invalidarFinanceiro(qc);
      toast[ok ? 'success' : 'error'](
        ok ? 'Recebimento estornado' : 'Esse recebimento já estava estornado',
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui estornar'),
  });
}
