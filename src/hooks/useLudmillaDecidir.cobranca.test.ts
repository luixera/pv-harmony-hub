import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECT_AFAZER, useAcoesDaCaixa } from './useLudmillaDecidir';

/**
 * A cola do Enviar e do Dispensar da cobrança: chama a RPC certa, com o id da COBRANÇA e
 * o texto revisado; REJEITA quando o banco recusa (é o que faz a fila do Desfazer devolver
 * a linha) mostrando o motivo dele; e só depois de gravar atualiza o A fazer, a linha do
 * tempo, o detalhe e o Registro. Os dublês são os mesmos de useLudmillaDecidir.test.ts, com `rpc`.
 */
const m = vi.hoisted(() => ({ rpc: vi.fn(), invalidar: vi.fn(), erro: vi.fn(), info: vi.fn(), log: [] as string[] }));

vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { info: m.info, error: m.erro }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: m.rpc } }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: m.invalidar }),
  useMutation: () => ({ mutateAsync: vi.fn() }),
  useQuery: vi.fn(),
}));
vi.mock('@/hooks/useLudmilla', () => ({
  useAplicarUpdate: () => ({ mutateAsync: vi.fn() }),
  useIgnorarUpdate: () => ({ mutateAsync: vi.fn() }),
  useLudmillaDisponivel: () => true,
}));

const chaves = () => m.invalidar.mock.calls.map(c => (c[0] as { queryKey: unknown[] }).queryKey[0]);
// o que `atualizarDetalhe` invalida depois de TODA decisão da caixa (inclui o Registro)
const DEPOIS_DE_DECIDIR = ['portal-afazeres', 'ludmilla-linha-do-tempo', 'projeto-do-detalhe', 'ludmilla-registro', 'ludmilla-carteira'];

describe('useAcoesDaCaixa — Enviar e Dispensar da cobrança', () => {
  beforeEach(() => {
    for (const f of [m.rpc, m.invalidar, m.erro, m.info]) f.mockReset();
    m.log.length = 0;
    m.invalidar.mockImplementation(() => { m.log.push('invalidou'); return Promise.resolve(); });
  });

  it('enviar: aprova com o id da cobrança e o texto, e DEPOIS atualiza A fazer, linha do tempo, detalhe e Registro', async () => {
    m.rpc.mockImplementation(async () => { m.log.push('gravou'); return { data: 'run-1', error: null }; });
    await useAcoesDaCaixa().enviarCobranca('c-1', 'Prezados, bom dia. Texto revisado.');
    expect(m.rpc).toHaveBeenCalledWith('ludmilla_cobranca_aprovar', { p_cobranca_id: 'c-1', p_texto: 'Prezados, bom dia. Texto revisado.' });
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou', 'invalidou', 'invalidou', 'invalidou']);
    expect(chaves()).toEqual(DEPOIS_DE_DECIDIR);
  });

  it('enviar manda o texto EXATAMENTE como a pessoa o editou (sem recortar nem trocar a saudação)', async () => {
    m.rpc.mockResolvedValue({ data: 'run-1', error: null });
    const editado = '  Prezados, boa tarde.\n\nTexto com  espaços  e linha final.\nEquipe GD Manager\n\n';
    await useAcoesDaCaixa().enviarCobranca('c-1', editado);
    expect(m.rpc.mock.calls[0][1]).toEqual({ p_cobranca_id: 'c-1', p_texto: editado });
  });

  it('enviar REJEITA quando o banco recusa, mostra o motivo dele e não atualiza nada', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'Já saiu uma cobrança desta nota em 22/10/2026 14:00: a próxima só depois de 7 dias.' } });
    await expect(useAcoesDaCaixa().enviarCobranca('c-1', 'x')).rejects.toMatchObject({ message: expect.stringContaining('7 dias') });
    expect(m.erro).toHaveBeenCalledWith(expect.stringContaining('7 dias'));
    expect(m.invalidar).not.toHaveBeenCalled();
  });

  it('enviar: a recusa de quem não é pessoa da equipe chega à tela com a frase do banco', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'Só uma pessoa da equipe pode aprovar o envio de uma cobrança.' } });
    await expect(useAcoesDaCaixa().enviarCobranca('c-1', 'x')).rejects.toBeDefined();
    expect(m.erro).toHaveBeenCalledWith('Só uma pessoa da equipe pode aprovar o envio de uma cobrança.');
  });

  it('enviar: erro sem texto aproveitável mostra a frase de reserva (nunca "undefined")', async () => {
    m.rpc.mockResolvedValue({ data: null, error: {} });
    await expect(useAcoesDaCaixa().enviarCobranca('c-1', 'x')).rejects.toBeDefined();
    expect(m.erro).toHaveBeenCalledWith('Não consegui enviar a cobrança.');
  });

  it('dispensar: a RPC certa, e DEPOIS atualiza tudo; true não avisa nada', async () => {
    m.rpc.mockImplementation(async () => { m.log.push('gravou'); return { data: true, error: null }; });
    expect(await useAcoesDaCaixa().dispensarCobranca('c-2')).toBe(true);
    expect(m.rpc).toHaveBeenCalledWith('ludmilla_cobranca_dispensar', { p_cobranca_id: 'c-2' });
    expect(m.log[0]).toBe('gravou');
    expect(chaves()).toEqual(DEPOIS_DE_DECIDIR);
    expect(m.info).not.toHaveBeenCalled();
  });

  it('dispensar: false avisa que alguém já tinha decidido', async () => {
    m.rpc.mockResolvedValue({ data: false, error: null });
    expect(await useAcoesDaCaixa().dispensarCobranca('c-2')).toBe(false);
    expect(m.info).toHaveBeenCalledWith('Alguém da equipe já tinha decidido esta cobrança.');
    expect(chaves()).toContain('portal-afazeres');
  });

  it('dispensar REJEITA quando o banco recusa, mostra o motivo e não atualiza nada', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'O envio desta cobrança já começou.' } });
    await expect(useAcoesDaCaixa().dispensarCobranca('c-2')).rejects.toMatchObject({ message: 'O envio desta cobrança já começou.' });
    expect(m.erro).toHaveBeenCalledWith('O envio desta cobrança já começou.');
    expect(m.invalidar).not.toHaveBeenCalled();
  });

  it('as RPCs da cobrança nunca são chamadas por quem só montou as ações', () => {
    useAcoesDaCaixa();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('SELECT_AFAZER — o embed da cobrança', () => {
  it('é UMA linha só (a verificação contra o PostgREST lê a constante por expressão regular)', () => {
    expect(SELECT_AFAZER).not.toMatch(/[\r\n]/);
  });

  it('traz a cobrança com tudo que a tela lê: nota, datas, para, assunto, situação, envios, texto, erro e o projeto', () => {
    const colunas = [
      ', cobranca:cobranca_id(', 'nota_servico', 'data_nota', 'prazo_dias', 'para', 'assunto', 'situacao', 'enviadas',
      'ultima_enviada_em', 'ultimo_texto_enviado', 'texto_aprovado', 'erro', 'motivo_encerramento', 'vence_em', 'atualizado_em',
      'projeto:project_id(protocol_number, project_general_data(holder_name, uc_number))',
    ];
    for (const c of colunas) expect(SELECT_AFAZER, c).toContain(c);
  });

  it('mantém os embeds de hoje (projeto com empresa e titular, e quem fez)', () => {
    expect(SELECT_AFAZER).toContain('project:projects(id, code, status, title, companies:company_id(name), project_general_data(holder_name))');
    expect(SELECT_AFAZER).toContain('feito:feito_por(name)');
  });
});
