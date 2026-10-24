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
  const { data: projeto = null } = useProjetoDoDetalhe(item.projectId);
  const { data: documentos = null } = useDocumentosDoProjeto(item.projectId);
  const { data: linha } = useLinhaDoTempo(item.projectId);

  const dados: DadosDoDetalhe = {
    item,
    chegou: item.update ? oQueChegou(item.update, mensagem, item.meio) : null,
    ressalva: item.update ? ressalvaDoCartao(item.update, mensagem) : null,
    projeto: projeto ? { uc: ucDoProjeto(projeto), protocoloNoCadastro: projeto.protocol_number?.trim() || null } : null,
    documentos,
    linhaDoTempo: item.projectId ? (linha ?? null) : [],
    etapas,
    rotuloEtapa,
  };
  return <DetalheDaDecisao dados={dados} layout={layout} onDecidir={onDecidir} onAbrirProjeto={onAbrirProjeto} urlDoDocumento={urlDoDocumento} />;
}
