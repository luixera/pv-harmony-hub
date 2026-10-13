import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentePlaywright, type Navegador } from '../src/criacao/navegador.js';
import { Agente } from '../src/criacao/agente.js';

/**
 * O roteiro do formulário 60 fala com a interface `Navegador`, não com um
 * navegador específico. Isso existe porque o portal da CPFL RECUSA a CLI
 * agent-browser a partir da VPS (13/10/2026): a navegação para gestao-projetos
 * volta vazia mesmo com os 21 cookies da sessão da varredura dentro — e a
 * varredura, no mesmo IP, entra 2×/dia sem tropeço.
 *
 * O teste trava o contrato: quem for rodar o roteiro tem de cumprir a interface
 * INTEIRA. Faltar um método só aparece em produção, no meio de um formulário.
 */

const METODOS: (keyof Navegador)[] = [
  'abrir', 'clicar', 'js', 'titulo', 'url', 'esperar', 'esperarCarga',
  'screenshot', 'limparRede', 'ultimoPostHtml', 'definirCabecalhos', 'fechar',
];

test('AgentePlaywright cumpre a interface inteira', () => {
  const proto = AgentePlaywright.prototype as unknown as Record<string, unknown>;
  for (const m of METODOS) {
    assert.equal(typeof proto[m], 'function', `AgentePlaywright.${m} faltando`);
  }
});

test('a CLI (Agente) também cumpre — as duas seguem intercambiáveis', () => {
  const proto = Agente.prototype as unknown as Record<string, unknown>;
  for (const m of METODOS) {
    assert.equal(typeof proto[m], 'function', `Agente.${m} faltando`);
  }
});

test('AgentePlaywright só nasce por noContexto (a aba é do contexto da varredura)', () => {
  assert.equal(typeof AgentePlaywright.noContexto, 'function');
  // o construtor é privado: quem usa não escolhe o navegador por engano
  assert.throws(() => new (AgentePlaywright as unknown as new () => unknown)(), /.*/);
});
