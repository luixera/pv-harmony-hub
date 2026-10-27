import { useState } from 'react';
import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { rascunhoDaCobranca } from '@/lib/ludmillaCobranca';
import { oQueChegou, ressalvaDoCartao, ucDoProjeto, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import {
  urlDoDocumento, useDocumentosDoProjeto, useLinhaDoTempo, useMensagemDaRecomendacao, useProjetoDoDetalhe,
} from '@/hooks/useLudmillaDecidir';
import { DetalheDaDecisao, type DadosDoDetalhe } from './PainelDeDetalhe';
import { guardarRascunho, rascunhoGuardado } from './rascunhosDaCobranca';

/** Liga o painel de detalhe às consultas (mensagem, cadastro, documentos, linha do tempo). */
export function DetalheConectado({ item, layout, etapas, rotuloEtapa, onDecidir, onAbrirProjeto }: {
  item: ItemDaCaixa;
  layout: 'painel' | 'folha';
  etapas: DadosDoDetalhe['etapas'];
  rotuloEtapa: DadosDoDetalhe['rotuloEtapa'];
  onDecidir: (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void;
  onAbrirProjeto: (projectId: string) => void;
}) {
  const ehEmail = item.origem === 'recomendacao' && item.meio === 'email';
  const { data: mensagem = null } = useMensagemDaRecomendacao(ehEmail ? item.id : null);
  const projeto = useProjetoDoDetalhe(item.projectId);
  const { data: documentos = null } = useDocumentosDoProjeto(item.projectId);
  const linha = useLinhaDoTempo(item.projectId);
  // o rascunho nasce UMA vez por item: o refetch de 5 min do A fazer não apaga o que a pessoa editou.
  // E a linha pode sair e VOLTAR (Desfazer, banco recusou): o detalhe é desmontado e o que ela
  // editou está guardado por linha (rascunhosDaCobranca), então volta com a edição, não com o modelo.
  const [rascunho] = useState<string | null>(() => {
    const cobranca = item.afazer?.cobranca;
    return cobranca ? (rascunhoGuardado(item.chave) ?? rascunhoDaCobranca(cobranca, new Date())) : null;
  });

  // consulta que falhou NÃO é "carregando" para sempre, nem "—" (que diria que não há)
  const doProjeto: DadosDoDetalhe['projeto'] = !item.projectId ? null
    : projeto.data ? { uc: ucDoProjeto(projeto.data), protocoloNoCadastro: projeto.data.protocol_number?.trim() || null }
    : projeto.isError ? 'erro'
    : projeto.isPending ? 'carregando'
    : null;
  const daLinha: DadosDoDetalhe['linhaDoTempo'] = !item.projectId ? []
    : linha.data ?? (linha.isError ? 'erro' : 'carregando');

  const dados: DadosDoDetalhe = {
    item,
    chegou: item.update ? oQueChegou(item.update, mensagem, item.meio) : null,
    ressalva: item.update ? ressalvaDoCartao(item.update, mensagem) : null,
    projeto: doProjeto,
    documentos,
    linhaDoTempo: daLinha,
    etapas,
    rotuloEtapa,
    rascunhoDaCobranca: rascunho,
  };
  return (
    <DetalheDaDecisao
      dados={dados} layout={layout} onDecidir={onDecidir} onAbrirProjeto={onAbrirProjeto} urlDoDocumento={urlDoDocumento}
      onTextoDaCobranca={texto => guardarRascunho(item.chave, texto)}
    />
  );
}
