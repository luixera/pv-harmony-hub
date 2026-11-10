import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { primeiroNome } from '@/lib/ludmillaFila';
import type { DiaDoDiario, RecadoDoDia } from '@/lib/ludmillaRecado';
import { AvisoDeFalha, Chip, Esqueleto } from '@/components/ludmilla/mundo/pecas';

export interface EstadoDoDiario {
  carregando: boolean;
  erro: string | null;
  tentar: () => void;
  /** a consulta trouxe o limite: há mais para trás */
  podeVerMais: boolean;
  verMais: () => void;
}

/** O DIÁRIO (spec §4.3): o registro por dia, em primeira pessoa, marcando o que foi dela e o que foi da equipe. */
export function Diario({ dias, estado }: { dias: DiaDoDiario[]; estado: EstadoDoDiario }) {
  if (estado.carregando) return <Esqueleto rotulo="Carregando o diário" />;
  return (
    <div className="flex flex-col gap-4" data-vista="diario">
      {estado.erro !== null && <AvisoDeFalha oQue="o diário" detalhe={estado.erro || null} onTentar={estado.tentar} />}
      {dias.length === 0 && estado.erro === null && <p className="m-0 text-sm text-lm-suave">Nada registrado ainda.</p>}
      {dias.map(d => (
        <section key={d.rotulo} className="flex flex-col gap-1.5">
          <h2 className="m-0 text-sm font-extrabold">{d.rotulo}</h2>
          <ol className="m-0 list-none border-t-2 border-lm-petroleo p-0">
            {d.itens.map(e => (
              <li key={e.chave} className="grid grid-cols-[44px_84px_minmax(0,1fr)] items-baseline gap-2.5 border-b border-lm-linha py-2.5 text-sm leading-snug">
                <span className="text-[13px] text-lm-suave">{e.hora}</span>
                <span className="justify-self-start"><Chip tom={e.deLa ? 'sol' : 'azul'}>{e.deLa ? 'Ludmilla' : primeiroNome(e.quem)}</Chip></span>
                <span className={cn('min-w-0 break-words', e.erro && 'text-lm-alerta')}>
                  {e.texto}
                  {e.detalhe && <span className="block break-words text-xs text-lm-suave">{e.detalhe}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {estado.podeVerMais && <Button type="button" variant="outline" className="self-start" onClick={estado.verMais}>Ver mais</Button>}
    </div>
  );
}

/** A direita do Diário: o recado do dia inteiro (até a entrega 5 trazer o resumo da manhã). */
export function PainelDoRecado({ recado }: { recado: RecadoDoDia | null }) {
  return (
    <div className="flex flex-col gap-2.5 p-4 sm:p-5" data-painel="recado">
      <h2 className="m-0 text-base font-extrabold">O recado de hoje</h2>
      {recado ? (
        <>
          <span className="text-xs text-lm-suave">{recado.data}</span>
          <p className="m-0 rounded-[4px_10px_10px_10px] border border-lm-borda px-4 py-3.5 text-[13px] leading-relaxed">{recado.texto}</p>
        </>
      ) : (
        <Esqueleto linhas={1} rotulo="Carregando o recado" />
      )}
      <span className="text-xs text-lm-suave">Quando o resumo da manhã estiver ligado, é ele que aparece aqui.</span>
    </div>
  );
}
