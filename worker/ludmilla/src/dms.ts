/**
 * Conversão de graus decimais para graus-minutos-segundos (DMS), no formato
 * que o portal CPFL aceita nos campos Latitude/Longitude (gravação de
 * 16/09/2026): `20° 52' 45.7"` — módulo do valor, sem letra de hemisfério.
 */
export function decimalParaDms(decimal: number, _eixo: 'lat' | 'lng'): string {
  const abs = Math.abs(decimal);
  let graus = Math.floor(abs);
  const minutosDec = (abs - graus) * 60;
  let minutos = Math.floor(minutosDec);
  let segundos = Math.round((minutosDec - minutos) * 600) / 10;
  if (segundos >= 60) { segundos -= 60; minutos += 1; }
  if (minutos >= 60) { minutos -= 60; graus += 1; }
  return `${graus}° ${minutos}' ${segundos.toFixed(1)}"`;
}

/** Extrai lat/lng do formato "{lat}, {lng}" gravado no banco. Retorna null se inválido. */
export function parsearCoordenadas(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/.exec(s ?? '');
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}
