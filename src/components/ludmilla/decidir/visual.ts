import { Globe, Mail, MonitorSmartphone, type LucideIcon } from 'lucide-react';
import type { MeioDoItem, TomDoSelo } from '@/lib/ludmillaCaixa';

/** O visual da página da Ludmilla que mais de uma parte usa (aba Decidir, topo, abas secundárias). */

export const ICONE_DO_MEIO: Record<MeioDoItem, LucideIcon> = { portal: Globe, email: Mail, estacao: MonitorSmartphone };
export const NOME_DO_MEIO: Record<MeioDoItem, string> = { portal: 'portal', email: 'e-mail', estacao: 'estação' };

export const COR_DO_SELO: Record<TomDoSelo, string> = {
  etapa: 'bg-emerald-100 text-emerald-800',
  protocolo: 'bg-violet-100 text-violet-800',
  anexo: 'bg-sky-100 text-sky-800',
  bloqueado: 'bg-red-100 text-red-800',
  afazer: 'bg-amber-100 text-amber-800',
  neutro: 'bg-slate-100 text-slate-700',
};

/** Cor do selo pelo status do portal (CPFL: Aprovado / Reprovado / Pendente / Em Andamento / Cancelado). */
export function corDoStatusDoPortal(status: string) {
  const s = status.toLowerCase();
  if (s.includes('aprov') && !s.includes('reprov')) return 'bg-emerald-100 text-emerald-800';
  if (s.includes('reprov') || s.includes('cancel')) return 'bg-red-100 text-red-800';
  if (s.includes('andamento')) return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
}

export const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
