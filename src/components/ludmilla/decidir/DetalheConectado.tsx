import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { oQueChegou, ressalvaDoCartao, ucDoProjeto, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import {
  urlDoDocumento, useDocumentosDoProjeto, useLinhaDoTempo, useMensagemDaRecomendacao, useProjetoDoDetalhe,
} from '@/hooks/useLudmillaDecidir';
import { DetalheDaDecisao, type DadosDoDetalhe } from './PainelDeDetalhe';

/** Liga o painel de detalhe às consultas (mensagem, cadastro, documentos, linha do tempo). */
export function DetalheConectado({ item, layout, etapas, rotuloEtapa, onDecidir, onAbrirProjeto }: {
  item: ItemDaCaixa;
  layout: 'painel' | 'folha';
  etapas: DadosDoDetalhe['etapas'];
  rotuloEtapa: DadosDoDetalhe['rotuloEtapa'];
  onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void;
  onAbrirProjeto: (projectId: string) => void;
}) {
  const ehEmail = item.origem === 'recomendacao' && item.meio === 'email';
  const { data: mensagem = null } = useMensagemDaRecomendacao(ehEmail ? item.id : null);
  const projeto = useProjetoDoDetalhe(item.projectId);
  const { data: documentos = null } = useDocumentosDoProjeto(item.projectId);
  const linha = useLinhaDoTempo(item.projectId);

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
  };
  return <DetalheDaDecisao dados={dados} layout={layout} onDecidir={onDecidir} onAbrirProjeto={onAbrirProjeto} urlDoDocumento={urlDoDocumento} />;
}
