import { Menu, Settings } from 'lucide-react';
import { AvatarDaLudmilla } from '@/components/ludmilla/mundo/AvatarDaLudmilla';

/** A faixa do celular (spec §5, mockup "CelularLista"): menu, avatar e engrenagem, com toques de 44 px. */
export function FaixaDoCelular({ onMenu, onAjustes }: { onMenu: () => void; onAjustes: () => void }) {
  return (
    <header className="lm-sobre-petroleo flex items-center gap-2 bg-lm-petroleo px-3 py-2.5 text-white">
      <button
        type="button" aria-label="Abrir o menu da Ludmilla" onClick={onMenu} data-nav="menu"
        className="flex h-11 w-11 items-center justify-center rounded-md"
      >
        <Menu size={22} aria-hidden />
      </button>
      <span className="flex flex-1 items-center gap-2.5">
        <AvatarDaLudmilla tamanho={32} decorativo />
        <span className="text-[17px] font-extrabold">Ludmilla</span>
      </span>
      <button
        type="button" aria-label="Ajustes da Ludmilla" onClick={onAjustes} data-nav="ajustes"
        className="flex h-11 w-11 items-center justify-center rounded-md"
      >
        <Settings size={20} aria-hidden />
      </button>
    </header>
  );
}
