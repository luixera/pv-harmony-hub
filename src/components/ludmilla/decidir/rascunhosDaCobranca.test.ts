import { beforeEach, describe, expect, it } from 'vitest';
import { guardarRascunho, rascunhoGuardado, limparRascunhos } from './rascunhosDaCobranca';

/**
 * O texto que a pessoa editou NÃO pode sumir quando a linha volta para a lista (Desfazer, ou o
 * banco recusou): o detalhe é desmontado quando a decisão tira a linha e remonta quando ela volta,
 * e o `useState` do editor nasceria de novo com o modelo. Descoberto na prova em tela da Task 8.
 */
describe('rascunhos da cobrança (o que a pessoa editou, por linha da caixa)', () => {
  beforeEach(() => limparRascunhos());

  it('sem nada guardado, devolve null (o editor abre com o modelo)', () => {
    expect(rascunhoGuardado('f:f-cob')).toBeNull();
  });

  it('devolve exatamente o que foi guardado, linha por linha', () => {
    guardarRascunho('f:f-cob', '  Prezados, bom dia.\n\nTexto editado.\n\n');
    guardarRascunho('f:f-cob-2a', 'Outro texto.');
    expect(rascunhoGuardado('f:f-cob')).toBe('  Prezados, bom dia.\n\nTexto editado.\n\n');
    expect(rascunhoGuardado('f:f-cob-2a')).toBe('Outro texto.');
    expect(rascunhoGuardado('f:f-outra')).toBeNull();
  });

  it('a edição mais nova substitui a anterior', () => {
    guardarRascunho('f:f-cob', 'primeira');
    guardarRascunho('f:f-cob', 'segunda');
    expect(rascunhoGuardado('f:f-cob')).toBe('segunda');
  });

  it('texto apagado de propósito continua guardado vazio (não volta o modelo sem a pessoa pedir)', () => {
    guardarRascunho('f:f-cob', '');
    expect(rascunhoGuardado('f:f-cob')).toBe('');
  });
});
