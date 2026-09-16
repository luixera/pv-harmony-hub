/**
 * Conversão de graus decimais para graus-minutos-segundos (DMS).
 * O portal CPFL exige DMS nos campos Latitude e Longitude.
 * Exemplo: -23.207407 → "23°12'26.7\"S"
 */
export function decimalParaDms(decimal: number, eixo: 'lat' | 'lng'): string {
  const abs = Math.abs(decimal);
  const graus = Math.floor(abs);
  const minutosDec = (abs - graus) * 60;
  const minutos = Math.floor(minutosDec);
  const segundos = (minutosDec - minutos) * 60;

  const hemisferio = eixo === 'lat'
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'W');

  return `${graus}°${minutos}'${segundos.toFixed(1)}"${hemisferio}`;
}

/** Extrai lat/lng do formato "{lat}, {lng}" gravado no banco. Retorna null se inválido. */
export function parsearCoordenadas(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/.exec(s ?? '');
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}
