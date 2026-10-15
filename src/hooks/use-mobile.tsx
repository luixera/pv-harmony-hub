import * as React from "react";
import { LARGURA_MOBILE } from "@/mobile/breakpoints";

// O limiar vem de `mobile/breakpoints.ts`, o mesmo de `useWindowSize`. O app
// chegou a ter 640, 768 e 1024 competindo pela mesma ideia de "é celular", e na
// faixa 640-767 px o MainLayout e o Sidebar discordavam: a gaveta ficava presa
// aberta com o fundo preto. Não volte a declarar um número aqui.
const MOBILE_BREAKPOINT = LARGURA_MOBILE;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
