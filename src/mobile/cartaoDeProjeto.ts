import type { ItemDeCartao } from '@/mobile/ListaEmCartoes';

/**
 * O que a lista de projetos mostra, em cartão, no celular, e a cor de etapa
 * que o app usa em selo.
 *
 * ATENÇÃO — acoplamento com `components/ui/badge.tsx`: a tradução
 * variante -> hex (`COR_DA_VARIANTE`, abaixo) ESPELHA as cores de texto das
 * variantes `pending`, `analysis`, `progress` e `approved` do Badge. O Tailwind
 * exige a classe escrita por extenso lá, então não dá para ler de volta: quem
 * mudar a cor de uma dessas variantes no `badge.tsx` TEM de mudar aqui também
 * (o teste confere o contraste AA, não a igualdade com o badge).
 *
 * Quem usa: `CompanyProjects` (cartões da empresa, via `cartaoDeProjeto`) e
 * `ProjectsKanban`, que importa só `statusVariants` para o `Badge` da sua lista
 * própria de celular — ela já era mais rica (selos "parado" e "sem valor") e
 * por isso NÃO usa o cartão; o mapa de etapa -> variante é o mesmo nos dois.
 */

/**
 * Variante de `Badge` de cada etapa. Era local do `ProjectsKanban`; está aqui
 * para existir uma cópia só, valores intactos.
 */
export const statusVariants: Record<string, string> = {
  pending: 'pending',
  analysis: 'analysis',
  documentation: 'progress',
  approval: 'progress',
  approved: 'approved',
  pendencia: 'pending',
  vistoria_solicitada: 'progress',
  aguardando_instalacao: 'progress',
  vistoria_sem_protocolo: 'pending',
  vistoria_reprovada: 'pending',
  completed: 'approved',
};

/**
 * Cor do TEXTO de cada variante, em hex de 6 dígitos (o `ListaEmCartoes` deriva
 * a borda do selo anexando `33` à cor, e isso só vale para 6 dígitos).
 *
 * Os valores são os `text-[#...]` das variantes de `components/ui/badge.tsx` —
 * o Tailwind exige a classe escrita por extenso lá, então não dá para ler de
 * volta; se mudar a cor de uma variante, mude aqui também. São os tons escuros
 * do Badge de propósito: o selo do cartão é texto sobre branco, e os tons
 * "vivos" do quadro (amarelo da Documentação, por exemplo) ficam abaixo de
 * 4,5:1 nesse fundo. O teste confere o contraste de todas.
 */
const COR_DA_VARIANTE: Record<string, string> = {
  pending: '#666666',
  analysis: '#185FA5',
  progress: '#854F0B',
  approved: '#0F6E56',
};

const COR_NEUTRA = COR_DA_VARIANTE.pending;

/** Cor do selo da etapa; etapa que não está no mapa (customizada) fica neutra. */
export function corDaEtapa(status: string): string {
  return COR_DA_VARIANTE[statusVariants[status]] ?? COR_NEUTRA;
}

/** O pedaço do projeto que o cartão lê — `ProjectWithDetails` cabe aqui. */
export interface ProjetoParaCartao {
  id: string;
  code: string;
  title?: string | null;
  status: string;
  concessionaireName?: string | null;
  generalData?: { holder_name?: string | null } | null;
  equipment?: { total_installed_power?: number | null } | null;
}

/**
 * Projeto -> cartão.
 *
 * `rotuloDaEtapa` vem da tela porque o nome da etapa é o da COLUNA do Kanban
 * (o admin renomeia, a empresa pode ter modelo próprio) — não há tabela fixa.
 * Potência zero ou ausente vira `null` e o cartão pula o campo, em vez de
 * mostrar "0 kWp" de um projeto que ainda não tem equipamento.
 */
export function cartaoDeProjeto(
  projeto: ProjetoParaCartao,
  rotuloDaEtapa: (status: string) => string,
  aoAbrir: (id: string) => void,
): ItemDeCartao {
  const potencia = projeto.equipment?.total_installed_power;
  return {
    id: projeto.id,
    titulo: projeto.generalData?.holder_name || projeto.title || projeto.code,
    selo: { texto: rotuloDaEtapa(projeto.status), cor: corDaEtapa(projeto.status) },
    campos: [
      { rotulo: 'Código', valor: projeto.code },
      { rotulo: 'Concessionária', valor: projeto.concessionaireName },
      { rotulo: 'Potência', valor: potencia ? `${potencia} kWp` : null },
    ],
    aoAbrir: () => aoAbrir(projeto.id),
  };
}
