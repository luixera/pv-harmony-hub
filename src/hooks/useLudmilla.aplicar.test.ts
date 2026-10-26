import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { useAplicarUpdate, useRegistroLudmilla } from './useLudmilla';

/**
 * O aviso de "Aplicar" (revisão da Task 6, item 13 do plano). A caixa de decisões já diz o
 * que vai acontecer no aviso com "Desfazer"; o `toast.success` do `onSuccess` chegava 8 s
 * depois, embaixo da tela, e no celular cobria o rodapé fixo do detalhe. Quem pede
 * `{ silencioso: true }` não recebe esse segundo aviso; quem chama sem a opção, recebe o de
 * sempre. O ERRO continua avisando nos dois casos: a fila de decisões conta com isso.
 *
 * O vitest roda em `node`: o React Query vira um dublê que devolve as OPÇÕES da mutação,
 * e o teste chama `onSuccess`/`onError` à mão.
 */
const m = vi.hoisted(() => ({
  invalidar: vi.fn(),
  sucesso: vi.fn(),
  erro: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: m.sucesso, error: m.erro, info: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ data: null }) }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: m.invalidar }),
  // devolve as opções: o teste dispara os retornos como o React Query faria
  useMutation: (opcoes: unknown) => opcoes,
  useQuery: vi.fn(),
}));

interface OpcoesDaMutacao {
  onSuccess: (dados: unknown, variaveis: { id: string; status?: string }) => void;
  onError: (e: Error) => void;
}
const useOpcoes = (o?: Parameters<typeof useAplicarUpdate>[0]) => useAplicarUpdate(o) as unknown as OpcoesDaMutacao;

describe('useAplicarUpdate — o aviso de sucesso', () => {
  beforeEach(() => { for (const f of [m.invalidar, m.sucesso, m.erro]) f.mockReset(); });

  it('sem opção: o aviso de sempre (card movido / protocolo atualizado)', () => {
    useOpcoes().onSuccess(undefined, { id: 'u-1', status: 'approved' });
    expect(m.sucesso).toHaveBeenCalledTimes(1);
    expect(m.sucesso.mock.calls[0][0]).toContain('Card movido');

    useOpcoes({}).onSuccess(undefined, { id: 'u-2' });
    expect(m.sucesso).toHaveBeenCalledTimes(2);
    expect(m.sucesso.mock.calls[1][0]).toContain('Protocolo do cadastro atualizado');
  });

  it('silencioso: nenhum aviso de sucesso, mas atualiza as mesmas listas', () => {
    useOpcoes({ silencioso: true }).onSuccess(undefined, { id: 'u-1', status: 'approved' });
    expect(m.sucesso).not.toHaveBeenCalled();
    const chaves = m.invalidar.mock.calls.map(c => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(chaves).toEqual(['portal-updates', 'projects']);
  });

  it('o erro avisa com ou sem a opção (a fila de decisões depende disso)', () => {
    useOpcoes({ silencioso: true }).onError(new Error('já decidida'));
    useOpcoes().onError(new Error('sem rede'));
    expect(m.erro.mock.calls.map(c => c[0])).toEqual(['já decidida', 'sem rede']);
  });
});

/**
 * A outra ponta do teste de `useAcoesDaCaixa` (useLudmillaDecidir.test.ts): lá a decisão invalida
 * o Registro pelo prefixo `['ludmilla-registro']`; aqui se prova que é a chave que o hook da aba
 * usa DE VERDADE, em todas as variantes (60 ou 400 linhas, os três filtros).
 */
describe('useRegistroLudmilla — a chave que a caixa de decisões invalida', () => {
  it('começa com "ludmilla-registro" em todas as variantes da aba', () => {
    vi.mocked(useQuery).mockImplementation(((opcoes: unknown) => opcoes) as never);
    const prefixo = (opcoes: unknown) => (opcoes as { queryKey: unknown[] }).queryKey[0];
    expect(prefixo(useRegistroLudmilla(60))).toBe('ludmilla-registro');
    expect(prefixo(useRegistroLudmilla(400))).toBe('ludmilla-registro');
    expect(prefixo(useRegistroLudmilla(60, 'ludmilla'))).toBe('ludmilla-registro');
    expect(prefixo(useRegistroLudmilla(400, 'equipe'))).toBe('ludmilla-registro');
  });
});
