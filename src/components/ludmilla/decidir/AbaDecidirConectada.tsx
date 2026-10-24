import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAcoesDaCaixa } from '@/hooks/useLudmillaDecidir';
import { useCaixaDaLudmilla } from '@/hooks/useCaixaDaLudmilla';
import { useStatusLabel, useStatusOrder } from '@/hooks/useStatusLabel';
import { useWindowSize } from '@/hooks/useWindowSize';
import { FILTRO_INICIAL, type FiltroDaCaixa } from '@/lib/ludmillaCaixa';
import { mensagemDeErro } from '@/lib/ludmillaCartao';
import { AbaDecidir, type AcoesDaCaixa } from './AbaDecidir';
import { DetalheConectado } from './DetalheConectado';

/** A aba Decidir de verdade: os MESMOS hooks e RPCs de hoje + o A fazer. */
export function AbaDecidirConectada({ contaId, ocultos, decidir, agora }: {
  contaId: string | null;
  ocultos: ReadonlySet<string>;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  agora: number;
}) {
  const [filtro, setFiltro] = useState<FiltroDaCaixa>(FILTRO_INICIAL);
  const caixa = useCaixaDaLudmilla(filtro.situacao);
  // espera a mutação (rejeita na falha) e atualiza a linha do tempo e o detalhe do projeto;
  // NÃO trocar por useAplicarUpdate/useIgnorarUpdate/useMarcarAfazerFeito diretos
  const acoes: AcoesDaCaixa = useAcoesDaCaixa();
  const rotulo = useStatusLabel();
  const etapas = useStatusOrder();
  const navigate = useNavigate();
  const { isDesktop } = useWindowSize();

  return (
    <AbaDecidir
      itens={caixa.itens} filtro={filtro} onFiltro={setFiltro} contaId={contaId} ocultos={ocultos} decidir={decidir}
      acoes={acoes} rotuloEtapa={rotulo} carregando={caixa.carregando} buscando={caixa.buscando}
      erro={caixa.erro ? (mensagemDeErro(caixa.erro) ?? '') : null} onTentarDeNovo={caixa.tentarDeNovo}
      agora={agora} modo={isDesktop ? 'lado_a_lado' : 'folha'}
      detalhe={(item, layout, onDecidir) => (
        // a etapa do detalhe nasce da recomendação: refetch que muda a recomendação recria o detalhe
        <DetalheConectado
          key={`${item.chave}|${item.update?.recomendacao ?? ''}`} item={item} layout={layout} etapas={etapas}
          rotuloEtapa={rotulo} onDecidir={onDecidir} onAbrirProjeto={id => navigate(`/project/${id}`)}
        />
      )}
    />
  );
}
