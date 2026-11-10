import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { LinhaDeLeitura } from '@/lib/ludmillaLeituras';
import type { RecadoDoDia } from '@/lib/ludmillaRecado';

export interface ItemDeNavegacao {
  chave: string;
  rotulo: string;
  /** null = sem número (carregando, falhou, ou item sem contagem) */
  n: number | null;
  /** o número em alerta ("Parados além do normal") */
  alerta?: boolean;
  ativo: boolean;
  onClick: () => void;
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="mb-0.5 px-2.5 text-xs font-bold text-lm-suave">{titulo}</span>
      {children}
    </div>
  );
}

/** Um item da navegação: o escolhido fica em sol (spec §4.2). Alerta sobre a caixa é #8F2F09 (decisão 1). */
function ItemNav({ i }: { i: ItemDeNavegacao }) {
  return (
    <button
      type="button" onClick={i.onClick} aria-current={i.ativo ? 'true' : undefined} data-nav={i.chave}
      className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-[7px] text-left text-sm font-semibold',
        i.ativo ? 'bg-lm-sol' : 'hover:bg-lm-caixa-forte')}
    >
      <span>{i.rotulo}</span>
      {i.n !== null && <b className={cn('text-sm tabular-nums', i.alerta && !i.ativo && 'text-lm-alerta-texto')}>{i.n}</b>}
    </button>
  );
}

/**
 * A COLUNA DA ESQUERDA (spec §4.2), a única navegação da página: o recado do dia, Para decidir (com
 * "Fila de"), Carteira, Comigo e Leituras (clicar leva aos Ajustes). No celular ela vira o menu.
 */
export function ColunaDaEsquerda({ recado, grupos, donos, dono, onDono, carteira, comigo, leituras, onLeituras }: {
  /** null = carregando */
  recado: RecadoDoDia | null;
  grupos: ItemDeNavegacao[];
  donos: { valor: string; rotulo: string }[];
  dono: string;
  onDono: (valor: string) => void;
  carteira: ItemDeNavegacao[];
  comigo: ItemDeNavegacao[];
  leituras: LinhaDeLeitura[];
  onLeituras: () => void;
}) {
  const idDaFila = useId();
  return (
    <nav aria-label="Ludmilla" className="flex min-h-full flex-col gap-4 bg-lm-caixa px-3 py-4" data-coluna="esquerda">
      <div className="flex flex-col gap-1.5 rounded-lg bg-white px-3.5 py-3">
        {recado ? (
          <>
            <span className="text-xs font-bold text-lm-suave">{recado.data}</span>
            <p className="m-0 text-sm leading-normal" data-recado>{recado.texto}</p>
          </>
        ) : (
          <div role="status" className="h-16 animate-pulse rounded bg-lm-caixa motion-reduce:animate-none"><span className="sr-only">Carregando o recado</span></div>
        )}
      </div>

      <Grupo titulo="Para decidir">
        {grupos.map(i => <ItemNav key={i.chave} i={i} />)}
        <div className="flex flex-wrap items-center gap-1 px-2.5 pt-1.5">
          <span id={idDaFila} className="mr-1 text-xs font-bold text-lm-suave">Fila de</span>
          <div role="group" aria-labelledby={idDaFila} className="flex flex-wrap gap-1">
            {donos.map(d => (
              <button
                key={d.valor} type="button" aria-pressed={d.valor === dono} onClick={() => onDono(d.valor)} data-dono={d.valor}
                className={cn('rounded-md border-[1.5px] px-2 py-1 text-xs font-bold',
                  d.valor === dono ? 'border-lm-petroleo bg-lm-petroleo text-white' : 'border-lm-borda bg-white')}
              >
                {d.rotulo}
              </button>
            ))}
          </div>
        </div>
      </Grupo>

      <Grupo titulo="Carteira">{carteira.map(i => <ItemNav key={i.chave} i={i} />)}</Grupo>
      <Grupo titulo="Comigo">{comigo.map(i => <ItemNav key={i.chave} i={i} />)}</Grupo>

      <button
        type="button" onClick={onLeituras} data-nav="leituras"
        className="flex flex-col gap-1.5 rounded-md px-2.5 py-1.5 text-left hover:bg-lm-caixa-forte"
      >
        <span className="text-xs font-bold text-lm-suave">Leituras</span>
        {leituras.map(l => (
          <span key={l.id} className={cn('flex justify-between gap-2 text-[13px]', l.alerta && 'font-bold text-lm-alerta-texto')}>
            <span>{l.nome}</span>
            <span>{l.texto}</span>
          </span>
        ))}
        <span className="sr-only">Abrir os Ajustes, onde eu leio</span>
      </button>
    </nav>
  );
}
