import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * DOSSIÊ FINANCEIRO DA EMPRESA
 *
 * A tela do financeiro tinha um FILTRO de empresa, que é a versão fraca disto:
 * mudava a lista mas não mudava a pergunta que a tela responde. Escolher uma
 * empresa agora troca a tela inteira por um dossiê dela (decisão do usuário,
 * out/2026), o que também elimina o risco de ler o dado de uma empresa
 * pensando que é de outra.
 *
 * Os números vêm de duas RPCs, não do navegador: série mensal e médias sobre
 * 184 pagamentos é trabalho de banco.
 *
 * O `as never` nos argumentos de `supabase.rpc` é o padrão do repositório (os
 * tipos gerados estão defasados).
 */

const num = (v: unknown) => Number(v ?? 0);
const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Uma empresa na lista do panorama. */
export interface EmpresaResumo {
  company_id: string;
  company_name: string;
  pricing_type: string;
  projetos: number;
  faturado: number;
  recebido: number;
  aberto: number;
  pagamentos: number;
  /**
   * Dias entre o projeto ENTRAR e o dinheiro chegar — não entre vencimento e
   * pagamento, porque `project_financials.due_date` está vazio no banco. É uma
   * régua diferente de atraso contratual, e a tela diz isso.
   * `null` = a empresa nunca pagou nada, que é outra categoria de problema.
   */
  prazo_medio_dias: number | null;
  ultimo_pagamento: string | null;
}

/** Um mês da série do gráfico. */
export interface MesDaSerie {
  mes: string;
  projetos: number;
  faturado: number;
  recebido: number;
  ticket: number | null;
}

export interface EmpresaPainel extends EmpresaResumo {
  cliente_desde: string | null;
  abertos_qtd: number;
  ultimo_valor: number | null;
  /** quantos valores de projeto diferentes a empresa tem */
  valores_distintos: number;
  valor_min: number | null;
  valor_max: number | null;
  ticket_medio: number | null;
  serie: MesDaSerie[];
}

// a conta do prazo médio global mora em lib porque tem teste, e o teste não
// consegue importar este módulo (o client do Supabase quer localStorage)
export { prazoMedioGlobal } from '@/lib/prazoMedio';

function paraResumo(r: Record<string, unknown>): EmpresaResumo {
  return {
    company_id: String(r.company_id),
    company_name: String(r.company_name ?? ''),
    pricing_type: String(r.pricing_type ?? ''),
    projetos: num(r.projetos),
    faturado: num(r.faturado),
    recebido: num(r.recebido),
    aberto: num(r.aberto),
    pagamentos: num(r.pagamentos),
    prazo_medio_dias: numOuNulo(r.prazo_medio_dias),
    ultimo_pagamento: (r.ultimo_pagamento as string | null) ?? null,
  };
}

/** A lista do panorama: uma linha por empresa com dívida e prazo. */
export function useEmpresasResumo() {
  return useQuery({
    queryKey: ['financeiro-empresas-resumo'],
    queryFn: async (): Promise<EmpresaResumo[]> => {
      const { data, error } = await supabase.rpc('financeiro_empresas_resumo' as never);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(paraResumo);
    },
  });
}

/** O dossiê de uma empresa, com a série mensal do gráfico. */
export function useEmpresaPainel(companyId: string | null) {
  return useQuery({
    queryKey: ['financeiro-empresa-painel', companyId],
    queryFn: async (): Promise<EmpresaPainel | null> => {
      if (!companyId) return null;
      const { data, error } = await supabase.rpc('financeiro_empresa_painel' as never, {
        _company_id: companyId,
      } as never);
      if (error) throw error;
      const linhas = (data ?? []) as Record<string, unknown>[];
      const r = linhas[0];
      if (!r) return null;
      return {
        ...paraResumo(r),
        cliente_desde: (r.cliente_desde as string | null) ?? null,
        abertos_qtd: num(r.abertos_qtd),
        ultimo_valor: numOuNulo(r.ultimo_valor),
        valores_distintos: num(r.valores_distintos),
        valor_min: numOuNulo(r.valor_min),
        valor_max: numOuNulo(r.valor_max),
        ticket_medio: numOuNulo(r.ticket_medio),
        serie: (((r.serie as unknown[]) ?? []) as Record<string, unknown>[]).map(m => ({
          mes: String(m.mes),
          projetos: num(m.projetos),
          faturado: num(m.faturado),
          recebido: num(m.recebido),
          ticket: numOuNulo(m.ticket),
        })),
      };
    },
    enabled: !!companyId,
  });
}
