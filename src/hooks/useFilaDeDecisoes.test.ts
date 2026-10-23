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

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { info: vi.fn() }) }));

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

describe('useFilaDeDecisoes (a cola do hook)', () => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    motor.slots = [];
    vi.mocked(toast).mockClear();
    vi.mocked(toast.info).mockClear();
    addEventListener.mockClear();
    removeEventListener.mockClear();
    vi.stubGlobal('window', { addEventListener, removeEventListener });
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

  it('fechar a aba com decisão esperando faz o navegador perguntar; sem decisão, não pergunta', () => {
    const itens = [item('u:1')];
    renderizar(itens);
    expect(addEventListener).not.toHaveBeenCalled();
    renderizar(itens).decidir('u:1', 'ok', vi.fn().mockResolvedValue(undefined));
    renderizar(itens);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    const [tipo, segurar] = addEventListener.mock.calls[0] as [string, (e: { preventDefault(): void; returnValue: string }) => void];
    expect(tipo).toBe('beforeunload');
    const e = { preventDefault: vi.fn(), returnValue: 'x' };
    segurar(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBe('');
    // desfez: não há mais o que proteger
    aviso().action.onClick();
    renderizar(itens);
    expect(removeEventListener).toHaveBeenCalledWith('beforeunload', segurar);
  });
});
