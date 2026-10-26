/**
 * DADOS INVENTADOS da cobrança da troca do relógio, para testes e harness. Nenhum nome,
 * nota, UC ou NT aqui é de verdade (o canalgd.sp@br.enel.com é o remetente público da
 * regra da ENEL). Código do app NUNCA importa este arquivo.
 *
 * A nota vem como o banco a guarda: 12 dígitos com UM zero à esquerda (070700000123).
 * Na tela e no texto do e-mail ela sai sem o zero (70700000123), como a ENEL escreve. Os
 * títulos abaixo vêm COM o zero, como `ludmilla_cobranca_abrir_afazer` os grava.
 */
import type { Afazer } from '@/lib/ludmillaCaixa';
import type { CobrancaDoAfazer } from '@/lib/ludmillaCobranca';
import { TENANT } from '@/lib/ludmillaCaixa.fixtures';

export const COBRANCA_BASE: CobrancaDoAfazer = {
  id: 'c-1', nota_servico: '070700000123', data_nota: '2026-10-01T15:00:00Z', prazo_dias: 7,
  para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - MARTA EXEMPLO PRADO - NT 391000099',
  situacao: 'aguardando_envio', enviadas: 0, ultima_enviada_em: null, ultimo_texto_enviado: null,
  texto_aprovado: null, erro: null, motivo_encerramento: null, vence_em: '2026-10-08T15:00:00Z',
  projeto: { protocol_number: '391000099', project_general_data: { holder_name: 'MARTA EXEMPLO PRADO', uc_number: '0055009001' } },
};

const projeto = (id: string, code: string, titular: string) => ({
  id, code, status: 'approved', title: titular, companies: { name: 'Solar Exemplo' }, project_general_data: { holder_name: titular },
});

export const cobrancaAfazer = (id: string, c: Partial<CobrancaDoAfazer>, extra: Partial<Afazer> = {}): Afazer => ({
  id, tenant_id: TENANT, account_id: 'conta-enel', project_id: 'p-20001', mensagem_id: null, tipo: 'cobrar_troca',
  titulo: '📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota 070700000123)',
  mensagem: 'A nota de serviço foi aberta em 01/10/2026 e a ENEL ainda não confirmou a troca. Revise o e-mail e envie, ou dispense.',
  criado_em: '2026-10-22T11:05:00Z', feito_por: null, feito_em: null,
  project: projeto('p-20001', 'PRJ-20001', 'MARTA EXEMPLO PRADO'), feito: null,
  cobranca_id: c.id ?? COBRANCA_BASE.id, cobranca: { ...COBRANCA_BASE, ...c }, ...extra,
});

export const F_COBRANCA = cobrancaAfazer('f-cob', {});
export const F_COBRANCA_SEM_NOTA = cobrancaAfazer('f-cob-sem', { id: 'c-2', nota_servico: null }, {
  titulo: '📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota sem número)', criado_em: '2026-10-22T11:06:00Z',
});
export const F_COBRANCA_FALHOU = cobrancaAfazer('f-cob-falhou', {
  id: 'c-3', erro: 'o Gmail recusou a senha de app da caixa (EAUTH 535)',
  texto_aprovado: 'Prezados, bom dia.\n\nTexto que a equipe já tinha aprovado (exemplo).\n\nAtenciosamente,\nEquipe GD Manager',
}, { titulo: '📡 A cobrança da nota 070700000123 não saiu', criado_em: '2026-10-22T11:07:00Z' });
export const F_COBRANCA_SEGUNDA = cobrancaAfazer('f-cob-2a', {
  id: 'c-4', enviadas: 1, ultima_enviada_em: '2026-10-15T14:00:00Z',
  ultimo_texto_enviado: 'Prezados, bom dia.\n\nPrimeira cobrança (exemplo).\n\nAtenciosamente,\nEquipe GD Manager',
}, { criado_em: '2026-10-22T11:08:00Z' });
export const F_COBRANCA_APROVADA = cobrancaAfazer('f-cob-ok', {
  id: 'c-5', situacao: 'agendada', enviadas: 1, ultima_enviada_em: '2026-10-22T14:00:00Z', vence_em: '2026-10-29T14:00:00Z',
}, { feito_por: 'pessoa-2', feito_em: '2026-10-22T13:59:00Z', feito: { name: 'Bia Exemplo' } });
export const F_COBRANCA_DISPENSADA = cobrancaAfazer('f-cob-disp', { id: 'c-6', situacao: 'dispensada' }, {
  feito_por: 'pessoa-2', feito_em: '2026-10-21T10:00:00Z', feito: { name: 'Bia Exemplo' },
});
export const F_COBRANCA_ENCERRADA = cobrancaAfazer('f-cob-enc', {
  id: 'c-7', situacao: 'encerrada', motivo_encerramento: 'a ENEL avisou que a troca do relógio foi feita',
}, { feito_em: '2026-10-20T09:00:00Z' });

export const AFAZERES_DE_COBRANCA = [
  F_COBRANCA, F_COBRANCA_SEM_NOTA, F_COBRANCA_FALHOU, F_COBRANCA_SEGUNDA,
  F_COBRANCA_APROVADA, F_COBRANCA_DISPENSADA, F_COBRANCA_ENCERRADA,
];
