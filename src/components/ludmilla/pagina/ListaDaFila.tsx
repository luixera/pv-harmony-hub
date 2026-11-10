import { AvisoDeFalha, Esqueleto } from '@/components/ludmilla/mundo/pecas';
import { CartaoDaFila, type DadosDoCartao } from './CartaoDaFila';

/**
 * A lista de um grupo da fila. Carregando: esqueleto. Consulta que falhou NÃO é lista vazia: diz que
 * falhou. Vazia de verdade: a frase da spec §4.6, com a próxima leitura.
 */
export function ListaDaFila({ cartoes, aberto, onAbrir, onBotao, carregando, erro, buscando, onTentar, vazio }: {
  cartoes: DadosDoCartao[];
  aberto: string | null;
  onAbrir: (chave: string) => void;
  onBotao: (chave: string) => void;
  carregando: boolean;
  /** null = sem erro; texto (pode ser vazio) = a consulta falhou */
  erro: string | null;
  buscando: boolean;
  onTentar: () => void;
  /** o texto embaixo de "Nada aqui agora." */
  vazio: string;
}) {
  if (carregando) return <Esqueleto rotulo="Carregando a fila" />;
  return (
    <div className="flex flex-col gap-3" data-lista="fila">
      {erro !== null && <AvisoDeFalha oQue="a fila de decisões" detalhe={erro || null} buscando={buscando} onTentar={onTentar} />}
      {cartoes.map(c => (
        <CartaoDaFila key={c.chave} dados={c} aberto={c.chave === aberto} onAbrir={() => onAbrir(c.chave)} onBotao={() => onBotao(c.chave)} />
      ))}
      {cartoes.length === 0 && erro === null && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-lm-barra px-5 py-7">
          <span className="text-[17px] font-extrabold">Nada aqui agora.</span>
          <span className="text-sm leading-normal text-lm-suave">{vazio}</span>
        </div>
      )}
    </div>
  );
}
