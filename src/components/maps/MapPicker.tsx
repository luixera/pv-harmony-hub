import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleMap, Marker, Autocomplete, LoadScript } from '@react-google-maps/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin, Loader2 } from 'lucide-react';

const LIBRARIES: ('places')[] = ['places'];

const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a0a0b0' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a3e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3a5e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0a1e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

interface MapPickerProps {
  /** Initial coordinates string "lat, lng" */
  value: string;
  onChange: (coords: string) => void;
  /** If true, renders address autocomplete input above the map */
  showAutocomplete?: boolean;
  /** Height of the map container */
  height?: number;
  /** If true, marker is draggable */
  draggable?: boolean;
  label?: string;
}

const DEFAULT_CENTER = { lat: -15.7801, lng: -47.9292 }; // Brasília

function parseCoords(value: string): google.maps.LatLngLiteral | null {
  if (!value) return null;
  const parts = value.split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

export function MapPicker({ value, onChange, showAutocomplete = true, height = 300, draggable = true, label }: MapPickerProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
  const [mapCenter, setMapCenter] = useState<google.maps.LatLngLiteral>(
    parseCoords(value) || DEFAULT_CENTER
  );
  const [markerPos, setMarkerPos] = useState<google.maps.LatLngLiteral | null>(
    parseCoords(value)
  );
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    const parsed = parseCoords(value);
    if (parsed) {
      setMarkerPos(parsed);
      setMapCenter(parsed);
    }
  }, [value]);

  const handlePlaceChanged = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.geometry?.location) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    setMapCenter({ lat, lng });
    setMarkerPos({ lat, lng });
    onChange(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  }, [onChange]);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!draggable || !e.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    setMarkerPos({ lat, lng });
    onChange(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  }, [draggable, onChange]);

  const handleMarkerDrag = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    setMarkerPos({ lat, lng });
    onChange(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  }, [onChange]);

  if (!apiKey) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
        <MapPin className="w-4 h-4 flex-shrink-0" />
        Chave da API do Google Maps não configurada (VITE_GOOGLE_MAPS_API_KEY)
      </div>
    );
  }

  return (
    <LoadScript googleMapsApiKey={apiKey} libraries={LIBRARIES} loadingElement={
      <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
        <Loader2 className="w-5 h-5 animate-spin" />
        Carregando mapa...
      </div>
    }>
      <div className="space-y-2">
        {label && <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-primary" />{label}</Label>}

        {showAutocomplete && (
          <Autocomplete
            onLoad={ref => { autocompleteRef.current = ref; }}
            onPlaceChanged={handlePlaceChanged}
            options={{ componentRestrictions: { country: 'br' } }}
          >
            <Input
              placeholder="Buscar endereço no mapa..."
              className="h-10 text-sm"
            />
          </Autocomplete>
        )}

        <GoogleMap
          mapContainerStyle={{ width: '100%', height: `${height}px`, borderRadius: '0.75rem' }}
          center={mapCenter}
          zoom={markerPos ? 15 : 5}
          options={{
            styles: MAP_STYLES,
            disableDefaultUI: false,
            zoomControl: true,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
          }}
          onClick={handleMapClick}
        >
          {markerPos && (
            <Marker
              position={markerPos}
              draggable={draggable}
              onDragEnd={handleMarkerDrag}
            />
          )}
        </GoogleMap>

        {markerPos && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3 text-primary" />
            {markerPos.lat.toFixed(6)}, {markerPos.lng.toFixed(6)}
            {draggable && <span className="ml-1 opacity-60">• Arraste o pin para ajustar</span>}
          </p>
        )}
      </div>
    </LoadScript>
  );
}
