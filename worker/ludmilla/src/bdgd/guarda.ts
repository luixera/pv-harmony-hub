/**
 * Decide se a data-base de uma distribuidora já está carregada.
 *
 * A pergunta tem de ser feita às IMPORTAÇÕES CONCLUÍDAS, nunca ao campo
 * `rede_distribuidora.data_base`. Aprendido em 13/10/2026: a primeira ingestão
 * na VPS morreu no `unzip`, e a distribuidora já tinha sido gravada com
 * data_base = 2025-12-31. Uma guarda que olhasse esse campo concluiria "já está
 * carregada" e pularia a carga para sempre — com o mapa vazio.
 */
export interface ImportacaoResumo {
  data_base: string | null;
  situacao: string;
}

export function jaCarregada(importacoes: ImportacaoResumo[], dataBase: string): boolean {
  return importacoes.some(i => i.situacao === 'concluida' && i.data_base === dataBase);
}
