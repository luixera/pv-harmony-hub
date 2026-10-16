import { describe, it, expect } from 'vitest';
import {
  matchesReportFilters,
  matchesSubscriptionFilters,
  type FinancialReportFilters,
} from './financialReportFilters';

/** Um projeto só com os campos que o filtro olha. */
const projeto = (paymentStatus: string, extra: Partial<{ companyId: string; status: string; createdAt: string }> = {}) => ({
  companyId: 'empresa-1',
  status: 'approved',
  paymentStatus,
  createdAt: '2026-07-10T12:00:00.000Z',
  ...extra,
});

/** Uma mensalidade. A competência é sempre o 1º dia do mês cobrado. */
const mensalidade = (status: string, extra: Partial<{ companyId: string; competence: string }> = {}) => ({
  companyId: 'empresa-1',
  status,
  competence: '2026-07-01',
  ...extra,
});

const pendente = projeto('pending');
const parcial = projeto('partial');
const quitado = projeto('paid');

const quePassam = (filtros: FinancialReportFilters) =>
  [pendente, parcial, quitado].filter(p => matchesReportFilters(p, filtros)).map(p => p.paymentStatus);

describe('matchesReportFilters — situação de pagamento', () => {
  it('sem filtro, todo projeto entra', () => {
    expect(quePassam({})).toEqual(['pending', 'partial', 'paid']);
  });

  it('lista vazia não restringe nada — é o mesmo que "todas"', () => {
    expect(quePassam({ paymentStatuses: [] })).toEqual(['pending', 'partial', 'paid']);
  });

  it('uma situação sozinha traz só ela', () => {
    expect(quePassam({ paymentStatuses: ['pending'] })).toEqual(['pending']);
    expect(quePassam({ paymentStatuses: ['partial'] })).toEqual(['partial']);
  });

  // O caso que motivou a mudança (out/2026): as situações se excluem — quem
  // está "pendente" não recebeu nada e quem está "partial" recebeu parte —, e
  // o extrato de cobrança precisa das duas na mesma folha.
  it('pendente + parcial trazem os dois grupos, e deixam o quitado de fora', () => {
    expect(quePassam({ paymentStatuses: ['pending', 'partial'] })).toEqual(['pending', 'partial']);
  });

  it('a ordem em que as situações foram marcadas não muda o resultado', () => {
    expect(quePassam({ paymentStatuses: ['partial', 'pending'] }))
      .toEqual(quePassam({ paymentStatuses: ['pending', 'partial'] }));
  });

  it('situação que não existe em projeto nenhum devolve lista vazia', () => {
    expect(quePassam({ paymentStatuses: ['estornado'] })).toEqual([]);
  });

  it('continua valendo junto dos outros filtros, não no lugar deles', () => {
    const deOutraEmpresa = projeto('pending', { companyId: 'empresa-2' });
    const filtros: FinancialReportFilters = { companyId: 'empresa-1', paymentStatuses: ['pending', 'partial'] };
    expect(matchesReportFilters(pendente, filtros)).toBe(true);
    expect(matchesReportFilters(deOutraEmpresa, filtros)).toBe(false);
    expect(matchesReportFilters(quitado, filtros)).toBe(false);
  });

  it('a etapa do projeto e a situação de pagamento são recortes independentes', () => {
    const concluidoEmAberto = projeto('pending', { status: 'completed' });
    const filtros: FinancialReportFilters = { statuses: ['completed'], paymentStatuses: ['pending', 'partial'] };
    expect(matchesReportFilters(concluidoEmAberto, filtros)).toBe(true);
    // mesma situação de pagamento, outra etapa: fica de fora pela ETAPA
    expect(matchesReportFilters(projeto('pending', { status: 'approved' }), filtros)).toBe(false);
  });
});

describe('matchesSubscriptionFilters — a mensalidade segue a mesma regra', () => {
  const quePassamAssinaturas = (filtros: FinancialReportFilters) =>
    [mensalidade('pending'), mensalidade('partial'), mensalidade('paid')]
      .filter(a => matchesSubscriptionFilters(a, filtros))
      .map(a => a.status);

  it('sem filtro, toda mensalidade entra', () => {
    expect(quePassamAssinaturas({})).toEqual(['pending', 'partial', 'paid']);
  });

  it('pendente + parcial trazem as duas', () => {
    expect(quePassamAssinaturas({ paymentStatuses: ['pending', 'partial'] })).toEqual(['pending', 'partial']);
  });

  it('o filtro de ETAPA não derruba mensalidade — ela não tem etapa de projeto', () => {
    expect(matchesSubscriptionFilters(mensalidade('pending'), { statuses: ['approved'] })).toBe(true);
  });

  it('o período pega o mês inteiro da competência', () => {
    const julho = mensalidade('pending', { competence: '2026-07-01' });
    // um extrato que começa no meio de julho ainda alcança a mensalidade de julho
    expect(matchesSubscriptionFilters(julho, { dateFrom: '2026-07-20' })).toBe(true);
    expect(matchesSubscriptionFilters(julho, { dateFrom: '2026-08-01' })).toBe(false);
  });
});
