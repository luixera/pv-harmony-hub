import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { useFilaDeDecisoes } from './useFilaDeDecisoes';

/**
 * O vitest desta casa roda em `node`, sem DOM e sem biblioteca de teste de React.
 * Este arquivo prova a COLA do hook (Desfazer cancela, sair da página grava, aviso de
 * fechar a aba) com um mini-motor de hooks no lugar do `react`: guarda o estado por
 * posição e roda os efeitos e as limpezas à mão. A regra em si (espera, cancelar,
 * descarregar) é provada em `ludmillaFilaDeDecisoes.test.ts`.
 */
const motor = vi.hoisted(() => ({
  slots: [] as { v?: unknown; deps?: unknown[]; limpar?: () => void }[],
  i: 0,
  efeitos: [] as (() => void)[],
  mudou: false,
}));

vi.mock('react', () => ({
  useState: (inicial: unknown) => {
    const s = (motor.slots[motor.i++] ??= { v: typeof inicial === 'function' ? (inicial as () => unknown)() : inicial });
    return [s.v, (x: unknown) => {
      const novo = typeof x === 'function' ? (x as (a: unknown) => unknown)(s.v) : x;
      if (!Object.is(novo, s.v)) { s.v = novo; motor.mudou = true; }
    }];
  },
  useRef: (inicial: unknown) => (motor.slots[motor.i++] ??= { v: { current: inicial } }).v,
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const s = (motor.slots[motor.i++] ??= {});
    motor.efeitos.push(() => {
      if (s.deps && deps && deps.length === s.deps.length && deps.every((d, k) => Object.is(d, s.deps![k]))) return;
      s.limpar?.();
      s.deps = deps;
      const volta = fn();
      s.limpar = typeof volta === 'function' ? volta : undefined;
    });
  },
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), dismiss: vi.fn() }) }));

const item = (chave: string, situacao: ItemDaCaixa['situacao'] = 'pendente') => ({ chave, situacao }) as ItemDaCaixa;

/** Como o React: roda o hook, roda os efeitos e, se algum mexeu no estado, desenha de novo até assentar. */
function renderizar(itens: ItemDaCaixa[]) {
  let r: ReturnType<typeof useFilaDeDecisoes>;
  for (let volta = 0; volta < 5; volta++) {
    motor.i = 0;
    motor.efeitos = [];
    motor.mudou = false;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- o mini-motor acima faz o papel do componente
    r = useFilaDeDecisoes(itens);
    motor.efeitos.forEach(e => e());
    if (!motor.mudou) break;
  }
  return r!;
}
const desmontar = () => motor.slots.forEach(s => s.limpar?.());

const aviso = () => {
  const [texto, opcoes] = vi.mocked(toast).mock.calls.at(-1) as [string, {
    duration: number; position: string; style: unknown; action: { label: string; onClick: () => void };
  }];
  return { texto, ...opcoes };
};

type Ouvinte = (e?: unknown) => void;
const chamadasDe = (mock: ReturnType<typeof vi.fn>, tipo: string) => mock.mock.calls.filter(c => c[0] === tipo);
const ouvinte = (mock: ReturnType<typeof vi.fn>, tipo: string) => chamadasDe(mock, tipo)[0]?.[1] as Ouvinte;

describe('useFilaDeDecisoes (a cola do hook)', () => {
  // da window (beforeunload, pagehide) e do document (visibilitychange)
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const docAdd = vi.fn();
  const docRemove = vi.fn();
  let documento: { visibilityState: string; addEventListener: typeof docAdd; removeEventListener: typeof docRemove };

  beforeEach(() => {
    vi.useFakeTimers();
    motor.slots = [];
    vi.mocked(toast).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.dismiss).mockClear();
    // o sonner devolve o id do aviso; sem ele `toast.dismiss(undefined)` fecharia TODOS os avisos
    let seq = 0;
    vi.mocked(toast).mockImplementation(() => `aviso-${++seq}`);
    addEventListener.mockClear();
    removeEventListener.mockClear();
    docAdd.mockClear();
    docRemove.mockClear();
    documento = { visibilityState: 'visible', addEventListener: docAdd, removeEventListener: docRemove };
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    vi.stubGlobal('document', documento);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('decidir some com o item na hora e mostra o aviso com Desfazer, no alto, por 8 s', () => {
    const itens = [item('u:1'), item('u:2')];
    const { decidir } = renderizar(itens);
    decidir('u:1', 'Etapa aplicada', vi.fn().mockResolvedValue(undefined));
    expect([...renderizar(itens).ocultos]).toEqual(['u:1']);
    const a = aviso();
    expect(a.texto).toBe('Etapa aplicada');
    expect(a.duration).toBe(8000);
    expect(a.position).toBe('top-center');
    // com o detalhe aberto (Radix) o body fica sem clique: o aviso precisa se declarar clicável
    expect(a.style).toEqual({ pointerEvents: 'auto' });
    expect(a.action.label).toBe('Desfazer');
  });

  it('só vai ao banco depois de 8 s', async () => {
    const itens = [item('u:1')];
    const executar = vi.fn().mockResolvedValue(undefined);
    renderizar(itens).decidir('u:1', 'ok', executar);
    await vi.advanceTimersByTimeAsync(7999);
    expect(executar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it('clicar em Desfazer no aviso cancela a gravação e devolve o item à lista', async () => {
    const itens = [item('u:1')];
    const executar = vi.fn().mockResolvedValue(undefined);
    renderizar(itens).decidir('u:1', 'ok', executar);
    aviso().action.onClick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(executar).not.toHaveBeenCalled();
    expect([...renderizar(itens).ocultos]).toEqual([]);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.dismiss).not.toHaveBeenCalled(); // o sonner já fecha o aviso no clique
  });

  it('no ponto sem volta o aviso com Desfazer sai da tela, e só o da decisão que foi', async () => {
    const itens = [item('u:1'), item('u:2')];
    const { decidir } = renderizar(itens);
    decidir('u:1', 'ok', vi.fn().mockResolvedValue(undefined)); // aviso-1
    await vi.advanceTimersByTimeAsync(3000);
    decidir('u:2', 'ok', vi.fn().mockResolvedValue(undefined)); // aviso-2
    expect(toast.dismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); // 8 s do u:1
    expect(vi.mocked(toast.dismiss).mock.calls).toEqual([['aviso-1']]);
    await vi.advanceTimersByTimeAsync(3000); // 8 s do u:2
    expect(vi.mocked(toast.dismiss).mock.calls).toEqual([['aviso-1'], ['aviso-2']]);
  });

  it('tira o aviso antes de mandar gravar (o Desfazer não fica de pé durante a gravação)', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    renderizar([item('u:1')]).decidir('u:1', 'ok', executar);
    await vi.advanceTimersByTimeAsync(8000);
    expect(vi.mocked(toast.dismiss).mock.invocationCallOrder[0]).toBeLessThan(executar.mock.invocationCallOrder[0]);
  });

  it('sair da página também tira o aviso das decisões que gravou na hora', async () => {
    const { decidir } = renderizar([item('u:1'), item('f:2')]);
    decidir('u:1', 'ok', vi.fn().mockResolvedValue(undefined));
    decidir('f:2', 'ok', vi.fn().mockResolvedValue(undefined));
    desmontar();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(toast.dismiss).mock.calls).toEqual([['aviso-1'], ['aviso-2']]);
  });

  it('Desfazer depois que já gravou não finge que voltou: avisa e mantém oculto', async () => {
    const itens = [item('u:1')];
    const executar = vi.fn().mockResolvedValue(undefined);
    renderizar(itens).decidir('u:1', 'ok', executar);
    await vi.advanceTimersByTimeAsync(8000);
    aviso().action.onClick();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledTimes(1);
    expect([...renderizar(itens).ocultos]).toEqual(['u:1']);
  });

  it('sair da página (desmontar) grava na hora o que está esperando', async () => {
    const itens = [item('u:1'), item('f:2')];
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const { decidir } = renderizar(itens);
    decidir('u:1', 'ok', a);
    decidir('f:2', 'ok', b);
    expect(a).not.toHaveBeenCalled();
    desmontar();
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('o banco recusou: a linha volta para a lista', async () => {
    const itens = [item('u:1')];
    renderizar(itens).decidir('u:1', 'ok', vi.fn().mockRejectedValue(new Error('já foi aplicada')));
    expect([...renderizar(itens).ocultos]).toEqual(['u:1']);
    await vi.advanceTimersByTimeAsync(8000);
    expect([...renderizar(itens).ocultos]).toEqual([]);
  });

  it('fica oculto enquanto o dado ainda diz pendente; solta quando o refetch traz a decisão', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    renderizar([item('u:1')]).decidir('u:1', 'ok', executar);
    await vi.advanceTimersByTimeAsync(8000);
    // gravou, mas o refetch ainda não chegou: continua pendente nos dados -> segue oculto
    expect([...renderizar([item('u:1')]).ocultos]).toEqual(['u:1']);
    // o refetch trouxe a recomendação aplicada: não precisa mais ocultar
    expect([...renderizar([item('u:1', 'aplicada')]).ocultos]).toEqual([]);
  });

  it('duas linhas ocultas ao mesmo tempo: decidir soma e Desfazer tira só a da própria linha', () => {
    const itens = [item('u:1'), item('u:2'), item('u:3')];
    const { decidir } = renderizar(itens);
    decidir('u:1', 'ok', vi.fn().mockResolvedValue(undefined));
    decidir('u:2', 'ok', vi.fn().mockResolvedValue(undefined));
    expect([...renderizar(itens).ocultos]).toEqual(['u:1', 'u:2']);
    aviso().action.onClick(); // o último aviso é o do u:2
    expect([...renderizar(itens).ocultos]).toEqual(['u:1']);
  });

  it('a gravação de uma linha recusada devolve só ela: a outra, ainda esperando, segue oculta', async () => {
    const itens = [item('u:1'), item('u:2')];
    const { decidir } = renderizar(itens);
    decidir('u:1', 'ok', vi.fn().mockRejectedValue(new Error('já foi aplicada')));
    await vi.advanceTimersByTimeAsync(3000);
    decidir('u:2', 'ok', vi.fn().mockResolvedValue(undefined));
    await vi.advanceTimersByTimeAsync(5000); // 8 s do u:1: o banco recusa; o u:2 ainda espera
    expect([...renderizar(itens).ocultos]).toEqual(['u:2']);
  });

  it('fechar a aba com decisão esperando faz o navegador perguntar; sem decisão, não pergunta', () => {
    const itens = [item('u:1')];
    renderizar(itens);
    expect(chamadasDe(addEventListener, 'beforeunload')).toHaveLength(0);
    renderizar(itens).decidir('u:1', 'ok', vi.fn().mockResolvedValue(undefined));
    renderizar(itens);
    expect(chamadasDe(addEventListener, 'beforeunload')).toHaveLength(1);
    const segurar = ouvinte(addEventListener, 'beforeunload');
    const e = { preventDefault: vi.fn(), returnValue: 'x' };
    segurar(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBe('');
    // desfez: não há mais o que proteger
    aviso().action.onClick();
    renderizar(itens);
    expect(removeEventListener).toHaveBeenCalledWith('beforeunload', segurar);
  });

  // No iOS o beforeunload não dispara e no Android não é confiável: se o sistema matar a página
  // dentro dos 8 s a decisão sumiria em silêncio (e o aviso já tinha dito "aplicada"). Por isso
  // a saída de vista também grava na hora. Custo aceito: trocar de app dentro dos 8 s tira o Desfazer.
  it('a página indo embora (pagehide) grava na hora o que está esperando', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    renderizar([item('u:1')]).decidir('u:1', 'ok', executar);
    const sair = ouvinte(addEventListener, 'pagehide');
    expect(executar).not.toHaveBeenCalled();
    sair();
    await vi.advanceTimersByTimeAsync(0);
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it('a aba indo para o fundo (visibilitychange: hidden) grava na hora; voltar a ficar visível não grava', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    renderizar([item('u:1')]).decidir('u:1', 'ok', executar);
    const mudou = ouvinte(docAdd, 'visibilitychange');
    documento.visibilityState = 'visible';
    mudou();
    await vi.advanceTimersByTimeAsync(0);
    expect(executar).not.toHaveBeenCalled();
    documento.visibilityState = 'hidden';
    mudou();
    await vi.advanceTimersByTimeAsync(0);
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it('os ouvintes de saída valem desde o primeiro desenho e a limpeza os remove', () => {
    renderizar([item('u:1')]);
    const sair = ouvinte(addEventListener, 'pagehide');
    const mudou = ouvinte(docAdd, 'visibilitychange');
    expect(sair).toBeTypeOf('function');
    expect(mudou).toBeTypeOf('function');
    desmontar();
    expect(removeEventListener).toHaveBeenCalledWith('pagehide', sair);
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', mudou);
  });
});
