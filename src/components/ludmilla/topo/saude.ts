import type { SaudeDaConta } from '@/lib/ludmillaPainel';

/**
 * A palavra curta que o chip mostra ao lado do "lida há" quando a conta NÃO está em dia. No
 * celular não existe `title`, e a cor do ponto sozinha não diz o que houve.
 *
 * Os textos vêm de `saudeDaConta` (`ludmillaPainel.ts`) e, no caso da estação, de
 * `estadoDaEstacao` (`useLudmilla.ts`); o teste (`saude.test.ts`) roda a lógica de verdade contra
 * esta tabela. Texto que a tabela não conhece aparece inteiro: nunca se esconde um problema.
 */
const PALAVRA_DO_TEXTO = new Map<string, string | null>([
  ['desligada', 'desligada'],
  ['com erro', 'com erro'],
  ['sessão expirada', 'sessão expirada'],
  ['caixa não configurada', 'sem caixa'],
  ['sem acesso', 'sem acesso'],
  ['leitura atrasada', 'atrasada'],
  // sem palavra: o chip já diz "nunca lida" ao lado
  ['ainda não leu a caixa', null],
  ['ainda não varreu', null],
]);

export function palavraDaSaude(saude: SaudeDaConta): string | null {
  if (saude.tom === 'ok') return null;
  // "estação offline há 3 h", "estação nunca ligou — …", "estação sem operador — …"
  if (saude.texto.startsWith('estação')) return 'offline';
  return PALAVRA_DO_TEXTO.has(saude.texto) ? PALAVRA_DO_TEXTO.get(saude.texto)! : saude.texto;
}
