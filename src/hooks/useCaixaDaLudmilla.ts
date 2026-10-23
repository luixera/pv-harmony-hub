import { useCallback, useMemo } from 'react';
import { usePortalAccounts, usePortalUpdates } from '@/hooks/useLudmilla';
import { useAfazeres } from '@/hooks/useLudmillaDecidir';
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires';
import { useStatusLabel } from '@/hooks/useStatusLabel';
import { itensDaCaixa, unirDecididoPrimeiro, type SituacaoDoFiltro } from '@/lib/ludmillaCaixa';
import { contagemDaLudmilla } from '@/lib/ludmillaContador';

/**
 * Os itens da caixa: as pendentes SEMPRE (para os contadores) e as da situação
 * escolhida, recomendações + A fazer, sobre os MESMOS hooks de hoje (as chaves de
 * `usePortalUpdates` são as mesmas: Aplicar/Ignorar continuam atualizando tudo).
 */
export function useCaixaDaLudmilla(situacao: SituacaoDoFiltro) {
  const rotulo = useStatusLabel();
  const { data: contas = [] } = usePortalAccounts();
  const { data: concessionarias = [] } = useEnergyConcessionaires(false);
  const pendentes = usePortalUpdates('pendente');
  const daSituacao = usePortalUpdates(situacao);
  const afazeresPendentes = useAfazeres('pendente');
  const afazeresDaSituacao = useAfazeres(situacao);

  const nomeDaConta = useCallback((id: string) => {
    const c = contas.find(a => a.id === id);
    return concessionarias.find(x => x.id === c?.concessionaire_id)?.name ?? c?.connector?.toUpperCase() ?? '';
  }, [contas, concessionarias]);

  const itens = useMemo(() => itensDaCaixa({
    // no mesmo id vale a lista da situação (a decidida), não o pendente do cache velho
    updates: unirDecididoPrimeiro(pendentes.data ?? [], daSituacao.data ?? []),
    afazeres: unirDecididoPrimeiro(afazeresPendentes.data ?? [], afazeresDaSituacao.data ?? []),
    contas, nomeDaConta, rotuloEtapa: rotulo,
  }), [pendentes.data, daSituacao.data, afazeresPendentes.data, afazeresDaSituacao.data, contas, nomeDaConta, rotulo]);

  const consultas = [pendentes, daSituacao, afazeresPendentes, afazeresDaSituacao];
  return {
    itens,
    contas,
    nomeDaConta,
    carregando: consultas.some(q => q.isLoading),
    buscando: consultas.some(q => q.isFetching),
    /** consulta que falhou NÃO é lista vazia: a tela avisa */
    erro: consultas.find(q => q.isError)?.error ?? null,
    tentarDeNovo: () => { for (const q of consultas) void q.refetch(); },
  };
}

/**
 * O NÚMERO DA BARRA LATERAL (decisão do usuário, 22/10/2026): recomendações
 * pendentes + A fazer abertos. Leve de propósito — só as duas consultas de
 * pendentes, com as MESMAS chaves de `useCaixaDaLudmilla` (a página aberta não
 * pede nada a mais, e "Aplicar", "Ignorar" e "Feito" já atualizam este número).
 * Quem soma é `contagemDaLudmilla` (ludmillaContador.ts → `contarPendentes`).
 * Quem não é da equipe (`useLudmillaDisponivel`) não consulta nada e recebe 0.
 * Se só a consulta do A fazer falhar, o número cai para as recomendações em vez
 * de sumir: `erro` avisa a tela.
 */
export function useContadorDaLudmilla() {
  const updates = usePortalUpdates('pendente');
  const afazeres = useAfazeres('pendente');
  const contagem = useMemo(
    () => contagemDaLudmilla(updates.data ?? [], afazeres.data ?? []),
    [updates.data, afazeres.data],
  );
  return {
    total: contagem.total,
    porConta: contagem.porConta,
    carregando: updates.isLoading || afazeres.isLoading,
    erro: updates.isError || afazeres.isError,
  };
}
