import { Building2, FilePlus2, Inbox, ScrollText, type LucideIcon } from 'lucide-react';

export type AbaDaLudmilla = 'decidir' | 'concessionarias' | 'criacoes' | 'registro';

/**
 * As quatro abas da página. Mora fora de `BarraDeAbas.tsx` porque a página usa a lista também no
 * computador (abas do shadcn) e um arquivo de componente que exporta constante perde o Fast Refresh.
 */
export const ABAS_DA_LUDMILLA: { valor: AbaDaLudmilla; rotulo: string; rotuloCurto: string; icone: LucideIcon }[] = [
  { valor: 'decidir', rotulo: 'Decidir', rotuloCurto: 'Decidir', icone: Inbox },
  { valor: 'concessionarias', rotulo: 'Concessionárias', rotuloCurto: 'Contas', icone: Building2 },
  { valor: 'criacoes', rotulo: 'Criações na CPFL', rotuloCurto: 'Criações', icone: FilePlus2 },
  { valor: 'registro', rotulo: 'Registro', rotuloCurto: 'Registro', icone: ScrollText },
];
