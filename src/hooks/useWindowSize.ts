import { useState, useEffect } from 'react';
import { LARGURA_MOBILE, LARGURA_TABLET } from '@/mobile/breakpoints';

export function useWindowSize() {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return {
    width,
    isMobile: width < LARGURA_MOBILE,
    isTablet: width < LARGURA_TABLET,
    isDesktop: width >= LARGURA_TABLET,
  };
}
