import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcoesDaCaixa } from './useLudmillaDecidir';

/**
 * I-2 da revisão da Task 5. O vitest desta casa roda em `node`, sem DOM: o `react` e o
 * React Query são trocados por dublês mínimos (`useMemo` roda a função, `useMutation`
 * devolve o `mutateAsync` que o teste controla), e o que se prova é a COLA de
 * `useAcoesDaCaixa`: espera a mutação, REJEITA se ela rejeitar, e só depois de gravar
 * atualiza a linha do tempo e o detalhe do projeto.
 */
const m = vi.hoisted(() => ({
  log: [] as string[],
  aplicar: vi.fn(),
  ignorar: vi.fn(),
  feito: vi.fn(),
  invalidar: vi.fn(),
}));

vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), error: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: m.invalidar }),
  useMutation: () => ({ mutateAsync: m.feito }),
  useQuery: vi.fn(),
}));
vi.mock('@/hooks/useLudmilla', () => ({
  useAplicarUpdate: () => ({ mutateAsync: m.aplicar }),
  useIgnorarUpdate: () => ({ mutateAsync: m.ignorar }),
  useLudmillaDisponivel: () => true,
}));

const chavesInvalidadas = () => m.invalidar.mock.calls.map(c => (c[0] as { queryKey: unknown[] }).queryKey[0]);

describe('useAcoesDaCaixa (a cola das decisões)', () => {
  beforeEach(() => {
    m.log.length = 0;
    for (const f of [m.aplicar, m.ignorar, m.feito, m.invalidar]) f.mockReset();
    m.invalidar.mockImplementation(() => { m.log.push('invalidou'); return Promise.resolve(); });
  });

  it('aplicar: grava com a etapa escolhida e DEPOIS atualiza linha do tempo e detalhe do projeto', async () => {
    m.aplicar.mockImplementation(async () => { m.log.push('gravou'); });
    await useAcoesDaCaixa().aplicar('u-1', 'approved');
    expect(m.aplicar).toHaveBeenCalledWith({ id: 'u-1', status: 'approved' });
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou']);
    expect(chavesInvalidadas()).toEqual(['ludmilla-linha-do-tempo', 'projeto-do-detalhe']);
  });

  it('aplicar sem etapa (só o protocolo) manda status indefinido', async () => {
    m.aplicar.mockResolvedValue(undefined);
    await useAcoesDaCaixa().aplicar('u-2', null);
    expect(m.aplicar).toHaveBeenCalledWith({ id: 'u-2', status: undefined });
  });

  it('aplicar REJEITA quando o banco recusa, e não atualiza nada (a fila precisa da falha)', async () => {
    m.aplicar.mockRejectedValue(new Error('já decidida'));
    await expect(useAcoesDaCaixa().aplicar('u-1', 'approved')).rejects.toThrow('já decidida');
    expect(m.invalidar).not.toHaveBeenCalled();
  });

  it('ignorar: grava e DEPOIS atualiza linha do tempo e detalhe', async () => {
    m.ignorar.mockImplementation(async () => { m.log.push('gravou'); });
    await useAcoesDaCaixa().ignorar('u-3');
    expect(m.ignorar).toHaveBeenCalledWith('u-3');
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou']);
    expect(chavesInvalidadas()).toEqual(['ludmilla-linha-do-tempo', 'projeto-do-detalhe']);
  });

  it('ignorar REJEITA quando o banco recusa, e não atualiza nada', async () => {
    m.ignorar.mockRejectedValue(new Error('sem permissão'));
    await expect(useAcoesDaCaixa().ignorar('u-3')).rejects.toThrow('sem permissão');
    expect(m.invalidar).not.toHaveBeenCalled();
  });

  it('feito: devolve se foi esta pessoa que marcou e atualiza linha do tempo e detalhe', async () => {
    m.feito.mockImplementation(async () => { m.log.push('gravou'); return true; });
    expect(await useAcoesDaCaixa().feito('f-1')).toBe(true);
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou']);
    expect(chavesInvalidadas()).toEqual(['ludmilla-linha-do-tempo', 'projeto-do-detalhe']);

    m.feito.mockResolvedValue(false);
    expect(await useAcoesDaCaixa().feito('f-2')).toBe(false);
  });

  it('feito REJEITA quando o banco recusa, e não atualiza nada', async () => {
    m.feito.mockRejectedValue(new Error('A fazer não encontrado'));
    await expect(useAcoesDaCaixa().feito('f-9')).rejects.toThrow('A fazer não encontrado');
    expect(m.invalidar).not.toHaveBeenCalled();
  });

  it('não espera o refetch: a decisão já está gravada quando a promessa resolve', async () => {
    m.aplicar.mockResolvedValue(undefined);
    m.invalidar.mockReturnValue(new Promise(() => { /* refetch que nunca termina */ }));
    await expect(useAcoesDaCaixa().aplicar('u-1', 'approved')).resolves.toBeUndefined();
  });
});
