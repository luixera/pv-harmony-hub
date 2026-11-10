import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ROTULO_COM_QUEM, type LinhaDaCarteira as LinhaDaRpc } from '@/lib/ludmillaCarteira';
import type { EventoDoProjeto } from '@/lib/ludmillaPainel';
import { fraseDoRegistro } from '@/lib/ludmillaRecado';
import { diaEMes } from '@/lib/ludmillaTempo';
import { Chip, Donos, TOM_DO_COM_QUEM } from '@/components/ludmilla/mundo/pecas';

export interface PropsDaFicha {
  linha: LinhaDaRpc;
  /** o histórico em barras grande (PaginaDaLudmilla monta) */
  historico: ReactNode;
  /** `ludmilla_linha_do_tempo` do projeto */
  leituras: EventoDoProjeto[] | 'carregando' | 'erro';
  proximo: string;
  /** null = nada deste projeto na fila */
  onVerNaFila: (() => void) | null;
  onAbrirProjeto: (projectId: string) => void;
  rotuloEtapa: (s: string) => string;
}

/** Quantas leituras dela a ficha mostra (decisão 20). */
const ULTIMAS = 5;

/**
 * A FICHA DA LUDMILLA (spec §4.4): com quem está e responsável · código e titular · empresa,
 * concessionária e etapa · histórico grande · "O que eu li por último" · "O próximo passo" · "Ver na
 * fila" quando há item · "Abrir o projeto" (o modal do GD).
 */
export function FichaDoProjeto({ linha, historico, leituras, proximo, onVerNaFila, onAbrirProjeto, rotuloEtapa }: PropsDaFicha) {
  const ultimas = Array.isArray(leituras)
    ? leituras
      .filter(e => e.ator === 'ludmilla')
      .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando))
      .slice(0, ULTIMAS)
    : [];
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5" data-ficha={linha.projectId}>
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <Chip tom={TOM_DO_COM_QUEM[linha.comQuem]}>{ROTULO_COM_QUEM[linha.comQuem]}</Chip>
          <Donos donos={linha.donos} />
        </span>
        <h2 className="m-0 text-[21px] font-extrabold leading-tight">{linha.codigo}{linha.titular ? `, ${linha.titular}` : ''}</h2>
        <p className="m-0 text-[13px] text-lm-suave">
          {[linha.empresa, linha.concessionaria, `etapa ${rotuloEtapa(linha.status)}`].filter(Boolean).join(', ')}
        </p>
      </div>
      {historico}
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-extrabold">O que eu li por último</h3>
        {leituras === 'carregando' ? (
          <p className="m-0 text-[13px] text-lm-suave">Carregando…</p>
        ) : leituras === 'erro' ? (
          <p className="m-0 text-[13px] text-lm-alerta">Não consegui carregar o que eu registrei deste projeto.</p>
        ) : ultimas.length === 0 ? (
          <p className="m-0 text-[13px] text-lm-suave">Ainda não li nada sobre este projeto.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {ultimas.map((e, i) => (
              <li key={`${e.quando}-${i}`} className="grid grid-cols-[48px_minmax(0,1fr)] gap-2.5 text-[13px] leading-snug">
                <span className="text-lm-suave">{diaEMes(Date.parse(e.quando))}</span>
                {/* a ficha já é do projeto: sem o "(PRJ-…)" no fim de cada frase */}
                <span>{fraseDoRegistro({ ...e, projeto: null })}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-extrabold">O próximo passo</h3>
        <p className="m-0 text-sm leading-normal">{proximo}</p>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        {onVerNaFila && <Button type="button" onClick={onVerNaFila} className="font-bold">Ver na fila</Button>}
        <button type="button" onClick={() => onAbrirProjeto(linha.projectId)} className="text-[13px] font-bold underline underline-offset-4">
          Abrir o projeto
        </button>
      </div>
    </div>
  );
}
