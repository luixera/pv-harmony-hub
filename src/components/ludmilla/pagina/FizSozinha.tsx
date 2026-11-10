import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FeitoSozinha } from '@/lib/ludmillaRecado';
import { quandoCurto } from '@/lib/ludmillaTempo';
import { Chip } from '@/components/ludmilla/mundo/pecas';

/**
 * O que ela faz sozinha HOJE (entrega 2, sem as chaves): só anexar o documento conferido (e pôr o
 * parecer no card). As outras três chaves da spec §6.5 chegam na entrega 4; até lá, passam pela fila.
 */
const O_QUE_EU_FACO: { nome: string; descricao: string; sozinha: boolean }[] = [
  { nome: 'Anexar documento conferido', descricao: 'Parecer ou Carta com o titular ou a UC conferidos vai direto para o card.', sozinha: true },
  { nome: 'Gravar NT ou protocolo', descricao: 'Vira cartão na fila; alguém aplica.', sozinha: false },
  { nome: 'Mover etapa com prova forte', descricao: 'Vira cartão na fila; alguém aplica.', sozinha: false },
  { nome: 'Criar tarefa para projeto parado', descricao: 'Por enquanto eu mostro os parados na carteira.', sozinha: false },
];

export function ListaDoQueFacoSozinha() {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {O_QUE_EU_FACO.map(c => (
        <li key={c.nome} className="flex items-start justify-between gap-3 border-b border-lm-linha py-3 last:border-b-0">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-bold">{c.nome}</span>
            <span className="text-[13px] leading-snug">{c.descricao}</span>
          </span>
          <Chip tom={c.sozinha ? 'ok' : 'caixa'}>{c.sozinha ? 'Faço sozinha' : 'Pela fila'}</Chip>
        </li>
      ))}
    </ul>
  );
}

/** O meio da vista "Fiz sozinha": o que ela fez desde a última visita, com a hora. Sem Desfazer nesta entrega. */
export function FizSozinha({ feitos, rotuloDoDesde, agora, onAbrirProjeto }: {
  feitos: FeitoSozinha[];
  /** "Desde sexta" */
  rotuloDoDesde: string;
  agora: number;
  onAbrirProjeto: (projectId: string) => void;
}) {
  if (feitos.length === 0) {
    return (
      <p className="m-0 text-sm leading-normal text-lm-suave" data-vista="sozinha">
        {rotuloDoDesde}, não fiz nada sozinha. Por enquanto eu só anexo sozinha o documento que conferi; o resto passa pela fila.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-vista="sozinha">
      {feitos.map((f, i) => (
        <li key={`${f.quando}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-lm-borda bg-white p-4 text-sm leading-normal">
          <Check size={18} strokeWidth={2.6} className="mt-0.5 shrink-0 text-lm-ok-texto" aria-hidden />
          <span className="min-w-0 flex-1"><strong>{quandoCurto(Date.parse(f.quando), agora)}</strong> {f.texto}</span>
          {f.projectId && (
            <button type="button" onClick={() => onAbrirProjeto(f.projectId!)} className="shrink-0 text-[13px] font-bold underline underline-offset-4">
              Abrir
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A direita da vista "Fiz sozinha" (spec §4.4: "as chaves ligadas hoje" e "Mudar nos Ajustes"). */
export function PainelDoQueFacoSozinha({ onAjustes }: { onAjustes: () => void }) {
  return (
    <div className="flex flex-col gap-2.5 p-4 sm:p-5" data-painel="sozinha">
      <h2 className="m-0 text-base font-extrabold">O que eu faço sozinha hoje</h2>
      <ListaDoQueFacoSozinha />
      <Button type="button" variant="outline" className="self-start" onClick={onAjustes}>Ver nos Ajustes</Button>
    </div>
  );
}
