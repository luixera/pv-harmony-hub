/**
 * Conversão de graus decimais para graus-minutos-segundos (DMS), no formato
 * que o portal CPFL aceita nos campos Latitude/Longitude (gravação de
 * 16/09/2026): `20° 52' 45.7"` — módulo do valor, sem letra de hemisfério.
 * Sempre 2 dígitos em graus, minutos e segundos: a máscara do campo só olha os
 * dígitos, e `23° 6' 59.0"` virava `23° 65' 90.00"` (05/11/2026).
 */
export function decimalParaDms(decimal: number, _eixo: 'lat' | 'lng'): string {
  const abs = Math.abs(decimal);
  let graus = Math.floor(abs);
  const minutosDec = (abs - graus) * 60;
  let minutos = Math.floor(minutosDec);
  let segundos = Math.round((minutosDec - minutos) * 600) / 10;
  if (segundos >= 60) { segundos -= 60; minutos += 1; }
  if (minutos >= 60) { minutos -= 60; graus += 1; }
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(graus)}° ${dois(minutos)}' ${segundos.toFixed(1).padStart(4, '0')}"`;
}

/** Extrai lat/lng do formato "{lat}, {lng}" gravado no banco. Retorna null se inválido. */
export function parsearCoordenadas(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/.exec(s ?? '');
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}
