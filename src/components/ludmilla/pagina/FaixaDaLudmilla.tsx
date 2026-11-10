import { Settings } from 'lucide-react';
import { AvatarDaLudmilla } from '@/components/ludmilla/mundo/AvatarDaLudmilla';

/** A faixa do topo (spec §4.1): avatar, "Ludmilla", "Analista de homologação" e Ajustes. Nada mais. */
export function FaixaDaLudmilla({ onAjustes, ajustesAberto }: { onAjustes: () => void; ajustesAberto: boolean }) {
  return (
    <header className="lm-sobre-petroleo flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-lm-petroleo px-6 py-2.5 text-white">
      <div className="flex items-center gap-3">
        <AvatarDaLudmilla tamanho={40} />
        <div className="flex flex-col">
          <span className="text-lg font-extrabold">Ludmilla</span>
          <span className="text-xs text-lm-faixa-suave">Analista de homologação</span>
        </div>
      </div>
      <button
        type="button" onClick={onAjustes} aria-current={ajustesAberto ? 'true' : undefined} data-nav="ajustes"
        className="flex items-center gap-2 rounded-md border-[1.5px] border-lm-faixa-borda px-3 py-1.5 text-[13px] font-bold text-white hover:bg-white/10"
      >
        <Settings size={16} aria-hidden /> Ajustes
      </button>
    </header>
  );
}
