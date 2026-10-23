import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarFilaDeDecisoes, ESPERA_DO_DESFAZER_MS } from './ludmillaFilaDeDecisoes';

describe('fila de decisões com Desfazer', () => {
  it('a janela do Desfazer é de 8 s (decisão do usuário, 22/10/2026)', () => {
    expect(ESPERA_DO_DESFAZER_MS).toBe(8000);
  });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const montar = () => {
    const mudancas: string[][] = [];
    const falhas: [string, unknown][] = [];
    const fila = criarFilaDeDecisoes({
      esperaMs: 8000, aoMudar: c => mudancas.push(c), aoFalhar: (c, e) => falhas.push([c, e]),
    });
    return { fila, mudancas, falhas };
  };

  it('só grava depois da espera', async () => {
    const { fila } = montar();
    const executar = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar });
    await vi.advanceTimersByTimeAsync(7999);
    expect(executar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(executar).toHaveBeenCalledTimes(1);
    expect(fila.emEspera()).toEqual([]);
  });

  it('Desfazer dentro da espera: nada vai ao banco', async () => {
    const { fila } = montar();
    const executar = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fila.desfazer('u:1')).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(executar).not.toHaveBeenCalled();
    expect(fila.desfazer('u:1')).toBe(false);
  });

  it('Desfazer depois da espera não volta atrás (já foi)', async () => {
    const { fila } = montar();
    const executar = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar });
    await vi.advanceTimersByTimeAsync(8000);
    expect(fila.desfazer('u:1')).toBe(false);
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it('descarregar grava já o que está esperando, uma vez só', async () => {
    const { fila } = montar();
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar: a });
    fila.adiar({ chave: 'f:2', executar: b });
    fila.descarregar();
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('falha devolve a chave para a tela', async () => {
    const { fila, falhas } = montar();
    const erro = new Error('Esta recomendação já foi aplicada.');
    fila.adiar({ chave: 'u:1', executar: vi.fn().mockRejectedValue(erro) });
    await vi.advanceTimersByTimeAsync(8000);
    expect(falhas).toEqual([['u:1', erro]]);
  });

  it('erro síncrono também é falha', async () => {
    const { fila, falhas } = montar();
    fila.adiar({ chave: 'u:1', executar: () => { throw new Error('quebrou'); } });
    await vi.advanceTimersByTimeAsync(8000);
    expect(falhas.map(f => f[0])).toEqual(['u:1']);
  });

  it('avisa a tela do que está em espera', () => {
    const { fila, mudancas } = montar();
    fila.adiar({ chave: 'u:1', executar: vi.fn().mockResolvedValue(undefined) });
    fila.adiar({ chave: 'u:2', executar: vi.fn().mockResolvedValue(undefined) });
    fila.desfazer('u:1');
    expect(mudancas).toEqual([['u:1'], ['u:1', 'u:2'], ['u:2']]);
  });

  it('avisa a tela também quando a gravação dispara (o aviso de saída não fica preso)', async () => {
    const { fila, mudancas } = montar();
    fila.adiar({ chave: 'u:1', executar: vi.fn().mockResolvedValue(undefined) });
    await vi.advanceTimersByTimeAsync(8000);
    expect(mudancas).toEqual([['u:1'], []]);
  });

  it('decidir de novo o mesmo item recomeça a espera e só grava a última', async () => {
    const { fila } = montar();
    const primeira = vi.fn().mockResolvedValue(undefined);
    const segunda = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar: primeira });
    await vi.advanceTimersByTimeAsync(5000);
    fila.adiar({ chave: 'u:1', executar: segunda });
    await vi.advanceTimersByTimeAsync(5000);
    expect(segunda).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(primeira).not.toHaveBeenCalled();
    expect(segunda).toHaveBeenCalledTimes(1);
  });
});
