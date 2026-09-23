/**
 * O jeito de falar do Zé. Módulo PURO (testado pelo vitest).
 *
 * WhatsApp não é terminal nem navegador: não tem markdown de verdade, a
 * mensagem muito longa vira parede de texto e o app corta mensagem gigante.
 * Aqui mora a tradução do que o modelo escreve para o que o WhatsApp mostra.
 */

/** Negrito/itálico/título do markdown → o pouco que o WhatsApp entende. */
export function paraWhatsapp(texto: string): string {
  return (texto ?? '')
    .replace(/^#{1,6}\s*(.+)$/gm, '*$1*')   // ## Título → *Título*
    .replace(/\*\*(.+?)\*\*/g, '*$1*')      // **negrito** → *negrito*
    .replace(/__(.+?)__/g, '_$1_')          // __itálico__ → _itálico_
    .trim();
}

/**
 * Parte a mensagem sem estourar o limite, preferindo a fronteira mais
 * "natural": parágrafo → linha → espaço → na força (palavra gigante, link).
 * Junta os pedaços de volta com '\n' e o texto original volta inteiro.
 */
export function partirMensagem(texto: string, limite = 1500): string[] {
  const inteiro = (texto ?? '').trim();
  if (!inteiro) return [];
  if (inteiro.length <= limite) return [inteiro];

  const partes: string[] = [];
  let resto = inteiro;

  while (resto.length > limite) {
    const janela = resto.slice(0, limite + 1);
    let corte = janela.lastIndexOf('\n\n');
    if (corte <= 0) corte = janela.lastIndexOf('\n');
    if (corte <= 0) corte = janela.lastIndexOf(' ');
    if (corte <= 0) corte = limite; // palavra maior que o limite: corta mesmo

    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).replace(/^[\n ]+/, '');
  }
  if (resto.trim()) partes.push(resto.trim());
  return partes;
}

/** Sugestão numerada — é assim que o gestor responde "cria 1 e 3". */
export function listaNumerada(itens: string[]): string {
  return itens.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

/** "há 5 dias" lê melhor que "5 dias atrás (2026-09-18T...)". */
export function diasEmPalavras(dias: number): string {
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  // `floor`, não `round`: 45 dias é "há 1 mês", não "há 2 meses".
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
}
