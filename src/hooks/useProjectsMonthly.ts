import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MonthlyData {
  month: string;    // Ex: "Jun/25"
  monthKey: string; // Ex: "2025-06" para ordenação
  recebidos: number;
  aprovados: number;
  reprovados: number;
}

// Status reais da tabela kanban_columns
// is_final = true → aprovados
const APROVADOS_STATUS = ['vistoria_solicitada', 'completed'];
// is_rejection_stage = true → reprovados
const REPROVADOS_STATUS = ['pendencia'];

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export function useProjectsMonthly() {
  return useQuery({
    queryKey: ['projects-monthly'],
    queryFn: async (): Promise<MonthlyData[]> => {
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      twelveMonthsAgo.setDate(1);
      twelveMonthsAgo.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('projects')
        .select('id, status, created_at')
        .eq('is_deleted', false)
        .gte('created_at', twelveMonthsAgo.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;
      const projects = data || [];

      // Gerar todos os 12 meses (mesmo sem dados)
      const months: MonthlyData[] = [];
      const now = new Date();

      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year  = d.getFullYear();
        const month = d.getMonth();
        const key   = `${year}-${String(month + 1).padStart(2, '0')}`;

        const monthProjects = projects.filter(p => {
          const pd = new Date(p.created_at);
          return pd.getFullYear() === year && pd.getMonth() === month;
        });

        months.push({
          month:     `${MONTH_NAMES[month]}/${String(year).slice(-2)}`,
          monthKey:  key,
          recebidos:  monthProjects.length,
          aprovados:  monthProjects.filter(p => APROVADOS_STATUS.includes(p.status)).length,
          reprovados: monthProjects.filter(p => REPROVADOS_STATUS.includes(p.status)).length,
        });
      }

      return months;
    },
    staleTime: 1000 * 60 * 15, // cache de 15 minutos
  });
}
