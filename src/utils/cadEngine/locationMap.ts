import { parseCoordinates } from '@/utils/projectValues';

/**
 * PLANTA DE LOCALIZAÇÃO — o recorte de satélite do local do projeto que vai
 * no canto do diagrama unifilar (praxe em projeto de engenharia; ajuda o
 * analista da concessionária a situar a obra sem sair do desenho).
 *
 * A imagem vem da Static Maps API do Google (mesma chave já usada nos mapas
 * do sistema) e é convertida em data URL comprimida — o diagrama inteiro é
 * salvo como JSON no banco, então a imagem precisa ser leve (~100KB) e não
 * pode depender de rede na hora de exportar SVG/PDF.
 */

/** Proporção do recorte no papel (mm) — paisagem, como as plantas reais. */
export const LOCATION_MAP_SIZE = { w: 58, h: 42 };

export interface LocationMapResult {
  href: string;
  /** Texto pronto pra legenda (coordenadas do projeto). */
  caption: string;
}

/** Por que a planta não pôde ser montada — vira mensagem pro usuário. */
export type LocationMapError = 'sem-coordenadas' | 'sem-chave' | 'api-desativada' | 'falhou';

export const LOCATION_MAP_MESSAGES: Record<LocationMapError, string> = {
  'sem-coordenadas': 'Este projeto não tem coordenadas. Preencha latitude e longitude nos dados do titular e tente de novo.',
  'sem-chave': 'A chave do Google Maps não está configurada nesta instalação (VITE_GOOGLE_MAPS_API_KEY).',
  'api-desativada': 'A "Maps Static API" não está habilitada no projeto do Google Cloud desta chave. '
    + 'Habilite-a no Google Cloud Console (APIs e serviços → Biblioteca → Maps Static API) — é a mesma chave já usada nos mapas do sistema.',
  'falhou': 'Não consegui baixar o recorte de satélite agora. Tente novamente em instantes.',
};

function staticMapUrl(lat: number, lon: number, apiKey: string): string {
  const params = new URLSearchParams({
    center: `${lat},${lon}`,
    zoom: '18',
    size: '440x320',
    scale: '2',
    // híbrido = satélite + nomes de rua: é o que se espera de uma planta de
    // localização (situar o imóvel, não só ver o telhado)
    maptype: 'hybrid',
    markers: `color:red|${lat},${lon}`,
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/** Redesenha num canvas pra reduzir peso antes de guardar no diagrama. */
async function compressToDataUrl(blob: Blob, maxWidth = 820): Promise<string> {
  const raw: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = raw;
  });
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

/**
 * Busca o recorte de satélite das coordenadas do projeto. Devolve `null`
 * (sem quebrar nada) quando não há coordenadas ou chave configurada — a
 * planta é um extra do desenho, nunca um impeditivo.
 */
export interface LocationMapAttempt {
  /** Preenchido quando deu certo. */
  map?: LocationMapResult;
  /** Preenchido quando não deu — use `LOCATION_MAP_MESSAGES[reason]`. */
  reason?: LocationMapError;
}

export async function fetchLocationMap(rawCoordinates: string | null | undefined): Promise<LocationMapAttempt> {
  const { lat, lon } = parseCoordinates(rawCoordinates);
  if (lat == null || lon == null) return { reason: 'sem-coordenadas' };
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) return { reason: 'sem-chave' };
  try {
    const resp = await fetch(staticMapUrl(lat, lon, apiKey));
    if (!resp.ok) {
      // o Google devolve texto explicando; 403 aqui é quase sempre a API
      // Static não habilitada no projeto do Cloud
      const detail = await resp.text().catch(() => '');
      return { reason: /not activated|not enabled/i.test(detail) ? 'api-desativada' : 'falhou' };
    }
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) return { reason: 'falhou' };
    return {
      map: {
        href: await compressToDataUrl(blob),
        caption: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
      },
    };
  } catch {
    return { reason: 'falhou' };
  }
}
