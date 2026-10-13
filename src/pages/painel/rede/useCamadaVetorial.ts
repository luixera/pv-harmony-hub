import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Colecao } from './tipos';

/**
 * UMA `google.maps.Data` por tipo de feição, imperativa de propósito.
 *
 * A v1 renderizava cada trafo como `<Marker>` React. A biblioteca compara
 * `icon` e `position` por identidade, a tela criava objetos novos a cada
 * render, e todo arrasto chamava setIcon+setPosition+setTitle em até 1.500
 * marcadores legados — era isso que travava. Aqui: um `addGeoJson` por
 * resposta, um `setStyle` por mudança de estilo, listeners registrados uma
 * vez (os handlers ficam em refs, para não religar nada a cada render).
 */
export interface Alvo { id: number; props: Record<string, unknown>; latLng: google.maps.LatLng | null }

const propsDe = (f: google.maps.Data.Feature) => {
  const props: Record<string, unknown> = {};
  f.forEachProperty((v, k) => { props[k] = v; });
  return props;
};

export function useCamadaVetorial(o: {
  mapa: google.maps.Map | null;
  colecao: Colecao<unknown> | null | undefined;
  visivel: boolean;
  estilo: (props: Record<string, unknown>) => google.maps.Data.StyleOptions;
  aoClicar?: (a: Alvo) => void;
  aoPassar?: (a: Alvo | null) => void;
}): MutableRefObject<google.maps.Data | null> {
  const ref = useRef<google.maps.Data | null>(null);
  const clicar = useRef(o.aoClicar); clicar.current = o.aoClicar;
  const passar = useRef(o.aoPassar); passar.current = o.aoPassar;

  useEffect(() => {
    if (!o.mapa) return;
    const camada = new google.maps.Data({ map: o.mapa });
    ref.current = camada;
    const alvo = (e: google.maps.Data.MouseEvent): Alvo =>
      ({ id: Number(e.feature.getId()), props: propsDe(e.feature), latLng: e.latLng ?? null });
    const ls = [
      camada.addListener('click', (e: google.maps.Data.MouseEvent) => clicar.current?.(alvo(e))),
      camada.addListener('mouseover', (e: google.maps.Data.MouseEvent) => passar.current?.(alvo(e))),
      camada.addListener('mouseout', () => passar.current?.(null)),
    ];
    return () => { ls.forEach(l => l.remove()); camada.setMap(null); ref.current = null; };
  }, [o.mapa]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.forEach(f => c.remove(f));
    if (o.colecao) c.addGeoJson(o.colecao as object);
  }, [o.colecao, o.mapa]);

  useEffect(() => {
    ref.current?.setStyle(f => o.estilo(propsDe(f)));
  }, [o.estilo, o.mapa]);

  useEffect(() => {
    ref.current?.setMap(o.visivel ? o.mapa : null);
  }, [o.visivel, o.mapa]);

  return ref;
}
