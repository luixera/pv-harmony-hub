import { useLinhaDoTempo } from '@/hooks/useLudmillaDecidir';
import { FichaDoProjeto, type PropsDaFicha } from './FichaDoProjeto';

/** Liga a ficha à linha do tempo do projeto (`ludmilla_linha_do_tempo`, a mesma do detalhe). */
export function FichaConectada(p: Omit<PropsDaFicha, 'leituras'>) {
  const linhaDoTempo = useLinhaDoTempo(p.linha.projectId);
  const leituras: PropsDaFicha['leituras'] = linhaDoTempo.data ?? (linhaDoTempo.isError ? 'erro' : 'carregando');
  return <FichaDoProjeto {...p} leituras={leituras} />;
}
