import { ErroLudmilla } from './erros.js';

/**
 * PACIÊNCIA com portal lento. Uma chamada à API que estoura o prazo não é
 * "a página mudou": é o portal demorando (CPFL, 15/09/2026 15:50 — a mesma
 * varredura passou às 17:00). Tenta de novo, com pausa; só depois desiste,
 * e desiste explicando O QUE estava lendo.
 *
 * Erros da própria Ludmilla (sessão expirada, senha recusada, página que
 * mudou) não se repetem: já são diagnóstico.
 */
export async function comPaciencia<T>(
  oQue: string,
  tentar: () => Promise<T>,
  o: { tentativas?: number; pausaMs?: number } = {},
): Promise<T> {
  const tentativas = Math.max(1, o.tentativas ?? 3);
  const pausaMs = o.pausaMs ?? 5_000;
  let ultimo: unknown;
  for (let n = 1; n <= tentativas; n++) {
    try {
      return await tentar();
    } catch (e) {
      if (e instanceof ErroLudmilla) throw e;
      ultimo = e;
      if (n < tentativas && pausaMs > 0) await new Promise(r => setTimeout(r, pausaMs));
    }
  }
  const detalhe = (ultimo instanceof Error ? ultimo.message : String(ultimo)).split('\n')[0].slice(0, 200);
  throw new ErroLudmilla('falhou',
    `O portal demorou demais para responder: ${oQue} — ${tentativas} tentativas sem resposta (${detalhe}). Costuma ser momentâneo; a próxima visita tenta de novo.`);
}
