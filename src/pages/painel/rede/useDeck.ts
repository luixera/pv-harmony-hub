import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoogleMapsOverlay } from '@deck.gl/google-maps';
import type { Fabricas } from './camadas';

/**
 * Um `GoogleMapsOverlay` do deck.gl por mapa, carregado por `import()`: o
 * resto do SPA não paga pelo WebGL. `aplicar(layers)` é um `setProps` — o deck
 * difere as camadas por id e só refaz o que mudou.
 */
export function useDeck(mapa: google.maps.Map | null) {
  const [fabricas, setFabricas] = useState<Fabricas | null>(null);
  const [Overlay, setOverlay] = useState<typeof GoogleMapsOverlay | null>(null);
  const overlay = useRef<GoogleMapsOverlay | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([import('@deck.gl/google-maps'), import('@deck.gl/layers')]).then(([gm, ly]) => {
      if (!vivo) return;
      setOverlay(() => gm.GoogleMapsOverlay);
      setFabricas({ GeoJsonLayer: ly.GeoJsonLayer });
    });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!mapa || !Overlay) return;
    const o = new Overlay({ layers: [] });
    o.setMap(mapa);
    overlay.current = o;
    setPronto(true);
    return () => { o.setMap(null); o.finalize(); overlay.current = null; setPronto(false); };
  }, [mapa, Overlay]);

  const aplicar = useCallback((layers: unknown[]) => {
    overlay.current?.setProps({ layers: layers as never });
  }, []);

  return { fabricas, aplicar, pronto };
}
