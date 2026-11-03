import { describe, expect, it } from 'vitest';
import { ehSimulacao, listarEnvios, type RunDeEnvio } from './criacaoCpfl';

const H = 3_600_000;
const AGORA = Date.parse('2026-11-03T17:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

function run(p: Partial<RunDeEnvio> & { id: string; pedido_em: string }): RunDeEnvio {
  return {
    situacao: 'ok',
    terminado_em: p.pedido_em,
    erro: null,
    dados: { project_id: 'p-1' },
    resultado: null,
    ...p,
  };
}

describe('ehSimulacao', () => {
  it('só o run marcado como simulação', () => {
    expect(ehSimulacao(run({ id: 'a', pedido_em: iso(AGORA), dados: { project_id: 'p-1', simular: true } }))).toBe(true);
    expect(ehSimulacao(run({ id: 'b', pedido_em: iso(AGORA), dados: { project_id: 'p-1', simular: 'true' } }))).toBe(true);
    expect(ehSimulacao(run({ id: 'c', pedido_em: iso(AGORA), dados: { project_id: 'p-1' } }))).toBe(false);
    expect(ehSimulacao(run({ id: 'd', pedido_em: iso(AGORA), dados: null }))).toBe(false);
  });
});

describe('listarEnvios — a lista de envios do projeto à CPFL', () => {
  it('ignora simulação, ordena por pedido_em e numera Envio 1, 2…', () => {
    const { envios } = listarEnvios([
      run({ id: 'tarde', pedido_em: iso(AGORA - 2 * H) }),
      run({ id: 'simulado', pedido_em: iso(AGORA - 5 * H), dados: { project_id: 'p-1', simular: true } }),
      run({ id: 'cedo', pedido_em: iso(AGORA - 30 * H) }),
    ], AGORA);
    expect(envios.map(e => [e.runId, e.numero, e.titulo])).toEqual([
      ['cedo', 1, 'Envio 1'],
      ['tarde', 2, 'Envio 2'],
    ]);
  });

  it('rótulo da situação: na fila, em andamento, criado com o nº, erro com a mensagem', () => {
    const { envios } = listarEnvios([
      run({ id: 'r1', pedido_em: iso(AGORA - 40 * H), situacao: 'ok', resultado: { node: '613100' } }),
      run({ id: 'r2', pedido_em: iso(AGORA - 30 * H), situacao: 'ok', resultado: { node: 613101 } }),
      run({ id: 'r3', pedido_em: iso(AGORA - 20 * H), situacao: 'erro', erro: 'A CPFL recusou a UC.' }),
      run({ id: 'r4', pedido_em: iso(AGORA - 10 * H), situacao: 'erro', erro: null }),
      run({ id: 'r5', pedido_em: iso(AGORA - 3 * H), situacao: 'ok', resultado: null }),
      run({ id: 'r6', pedido_em: iso(AGORA - 2 * H), situacao: 'rodando', terminado_em: null }),
      run({ id: 'r7', pedido_em: iso(AGORA - 1 * H), situacao: 'na_fila', terminado_em: null }),
    ], AGORA);
    expect(envios.map(e => e.rotulo)).toEqual([
      'criado, nº 613100',
      'criado, nº 613101',
      'erro: A CPFL recusou a UC.',
      'erro: sem detalhe',
      'criado, sem número',
      'em andamento',
      'na fila',
    ]);
    expect(envios.map(e => e.ativo)).toEqual([false, false, false, false, false, true, true]);
  });

  it('o número é só o resultado.node do próprio run (sem cair no do projeto)', () => {
    const { envios } = listarEnvios([
      run({ id: 'r1', pedido_em: iso(AGORA - 3 * H), resultado: { node: ' 613100 ' } }),
      run({ id: 'r2', pedido_em: iso(AGORA - 2 * H), resultado: { node: 613101 } }),
      run({ id: 'r3', pedido_em: iso(AGORA - 1 * H), situacao: 'erro', resultado: { node: '' } }),
    ], AGORA);
    expect(envios.map(e => e.numeroCpfl)).toEqual(['613100', '613101', null]);
  });

  it('marca o reenvio com o número anterior', () => {
    const { envios } = listarEnvios([
      run({ id: 'r1', pedido_em: iso(AGORA - 3 * H), resultado: { node: '613100' } }),
      run({ id: 'r2', pedido_em: iso(AGORA - 2 * H), dados: { project_id: 'p-1', reenvio_de: '613100' } }),
      run({ id: 'r3', pedido_em: iso(AGORA - 1 * H), dados: { project_id: 'p-1', reenvio_de: 613101 } }),
    ], AGORA);
    expect(envios.map(e => e.reenvioDe)).toEqual([null, '613100', '613101']);
  });

  it('abre sozinho o envio ativo, mesmo que não seja o último da lista', () => {
    const { abreSozinho } = listarEnvios([
      run({ id: 'r1', pedido_em: iso(AGORA - 3 * H), situacao: 'rodando', terminado_em: null }),
      run({ id: 'r2', pedido_em: iso(AGORA - 2 * H), situacao: 'erro', terminado_em: iso(AGORA - 10 * 60_000) }),
    ], AGORA);
    expect(abreSozinho).toBe('r1');
  });

  it('sem ativo, abre o último se ele terminou há até 1 h', () => {
    const recente = listarEnvios([
      run({ id: 'r1', pedido_em: iso(AGORA - 30 * H), terminado_em: iso(AGORA - 29 * H) }),
      run({ id: 'r2', pedido_em: iso(AGORA - 2 * H), situacao: 'erro', terminado_em: iso(AGORA - 59 * 60_000) }),
    ], AGORA);
    expect(recente.abreSozinho).toBe('r2');

    const antigo = listarEnvios([
      run({ id: 'r1', pedido_em: iso(AGORA - 3 * H), terminado_em: iso(AGORA - 61 * 60_000) }),
    ], AGORA);
    expect(antigo.abreSozinho).toBeNull();
  });

  it('sem nenhum envio, lista vazia e nada abre', () => {
    expect(listarEnvios([], AGORA)).toEqual({ envios: [], abreSozinho: null });
    expect(listarEnvios([
      run({ id: 's', pedido_em: iso(AGORA), dados: { project_id: 'p-1', simular: true }, situacao: 'rodando' }),
    ], AGORA)).toEqual({ envios: [], abreSozinho: null });
  });

  it('guarda a mensagem de erro do run para mostrar inteira', () => {
    const { envios } = listarEnvios([
      run({ id: 'r1', pedido_em: iso(AGORA - H), situacao: 'erro', erro: 'Login recusado.' }),
      run({ id: 'r2', pedido_em: iso(AGORA), situacao: 'ok', erro: null }),
    ], AGORA);
    expect(envios.map(e => e.erro)).toEqual(['Login recusado.', null]);
  });
});
