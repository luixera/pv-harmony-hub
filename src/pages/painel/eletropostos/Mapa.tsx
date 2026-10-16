import { useMemo, useState } from 'react';
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from '@react-google-maps/api';
import { GOLD, Loading } from '../ConsoleSections';
import { fmt, pct } from './calculo';
import { mudo, vazio } from './estilo';
import type { Local, Resumo } from './tipos';

// as outras telas usam as mesmas opções; libraries diferentes quebram o loader
const LIBRARIES: ('places')[] = ['places'];
const CENTRO = { lat: -20.825, lng: -49.40 };

/** Círculo grande = DC, pequeno = AC; opacidade = ocupação; cinza = sem monitoramento. */
function icone(l: Local): google.maps.Symbol {
  const mon = l.monitorado;
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: l.tipo === 'DC' ? 9 : 5,
    fillColor: mon ? GOLD : '#c5ccd1',
    fillOpacity: mon ? 0.35 + 0.65 * (l.ocupacao ?? 0) : 0.8,
    strokeColor: mon ? '#7a5400' : '#6f7b84',
    strokeWeight: 1.5,
  };
}

export function Mapa({ resumo, abrir }: { resumo: Resumo; abrir: (id: string) => void }) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script', libraries: LIBRARIES,
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? '',
  });
  const [sobre, setSobre] = useState<Local | null>(null);
  const locais = useMemo(() => resumo.locais.filter(l => l.lat != null && l.lng != null), [resumo.locais]);
  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) return <div style={vazio}>O mapa precisa da chave do Google Maps (VITE_GOOGLE_MAPS_API_KEY).</div>;
  if (!isLoaded) return <Loading />;
  return (
    <div>
      <div style={{ height: 'calc(100vh - 210px)', minHeight: 420, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
        <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={CENTRO} zoom={12}
          options={{ mapTypeControl: false, streetViewControl: false, fullscreenControl: false, backgroundColor: '#0E0E14' }}>
          {locais.map(l => (
            <Marker key={l.id} position={{ lat: l.lat!, lng: l.lng! }} icon={icone(l)} title={l.nome}
              onClick={() => abrir(l.id)} onMouseOver={() => setSobre(l)} onMouseOut={() => setSobre(null)} />
          ))}
          {sobre && (
            <InfoWindow position={{ lat: sobre.lat!, lng: sobre.lng! }} options={{ disableAutoPan: true, pixelOffset: new google.maps.Size(0, -8) }} onCloseClick={() => setSobre(null)}>
              <div style={{ color: '#1A1A1A', fontSize: 12, fontFamily: 'Inter, sans-serif', maxWidth: 220 }}>
                <b>{sobre.nome}</b><br />{sobre.operadora || ''} · {sobre.tipo}
                <br />{sobre.monitorado ? `Ocupação ${pct(sobre.ocupacao)} · ${fmt(sobre.horas_ocupado_dia, 1)} h/dia` : 'Sem monitoramento'}
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 12, ...mudo }}>
        <span>Círculo grande = rápido (DC), pequeno = AC</span><span>Dourado mais forte = mais ocupado</span><span>Cinza = sem monitoramento</span>
      </div>
    </div>
  );
}
