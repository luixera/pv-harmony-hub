/**
 * DADOS INVENTADOS para o harness da página nova da Ludmilla (entrega 2). Nenhum nome, protocolo ou
 * número aqui é de verdade. Código do app NUNCA importa este arquivo. "Agora" = AGORA de
 * ludmillaCaixa.fixtures (22/10/2026 09:00 de Brasília, quinta).
 */
import type { PortalUpdate, RegistroLudmilla } from '@/hooks/useLudmilla';
import type { LinhaDaCarteira, NormalDaEtapa } from '@/lib/ludmillaCarteira';
import type { PedidoTroca } from '@/lib/ludmillaPedidoTroca';
import { U_CPFL } from '@/lib/ludmillaCaixa.fixtures';

export const ANA = { id: 'pessoa-ana', nome: 'Ana Lima' };
export const BRUNO = { id: 'pessoa-bruno', nome: 'Bruno Costa' };

/** Uma recomendação de etapa que chegou HOJE (vai para Agora). */
export const U_HOJE: PortalUpdate = {
  ...U_CPFL, id: 'u-hoje', protocolo: '7002222', detectado_em: '2026-10-22T10:30:00Z', project_id: 'p-9',
  project: { ...U_CPFL.project!, id: 'p-9', code: 'PRJ-10009', title: 'Rogério Lins', project_general_data: { holder_name: 'Rogério Lins' } },
};

const linha = (x: Partial<LinhaDaCarteira> & Pick<LinhaDaCarteira, 'projectId' | 'codigo'>): LinhaDaCarteira => ({
  titular: null, empresa: null, companyId: null, concessionaria: 'CPFL Paulista', concessionaireId: 'conc-cpfl',
  status: 'analysis', naEtapaDesde: '2026-10-10T12:00:00Z', diasNaEtapa: 5, normalDias: 8, normalFonte: 'medido',
  atrasoDias: -3, comQuem: 'concessionaria', donos: [], historico: [], naFila: false, ...x,
});

/** p-1…p-4 e p-7 casam com os itens de ludmillaCaixa.fixtures; p-4 e p-7 (Energia Boa) ficam sem dono. */
export const CARTEIRA_DE_EXEMPLO: LinhaDaCarteira[] = [
  linha({ projectId: 'p-1', codigo: 'PRJ-10001', titular: 'Marta Ribeiro Campos', empresa: 'Solar Alfa', status: 'analysis',
    diasNaEtapa: 12.4, normalDias: 8, atrasoDias: 4.4, comQuem: 'nos', naFila: true, donos: [ANA],
    historico: [{ etapa: 'pending', dias: 3, atual: false }, { etapa: 'analysis', dias: 12.4, atual: true }] }),
  linha({ projectId: 'p-2', codigo: 'PRJ-10002', titular: 'João Pedro Lima', empresa: 'Sol Nascente', concessionaria: 'ENEL SP',
    concessionaireId: 'conc-enel', status: 'documentation', diasNaEtapa: 4, normalDias: 6, atrasoDias: -2, comQuem: 'nos', naFila: true,
    donos: [BRUNO], historico: [{ etapa: 'pending', dias: 2, atual: false }, { etapa: 'analysis', dias: 9, atual: false }, { etapa: 'documentation', dias: 4, atual: true }] }),
  linha({ projectId: 'p-3', codigo: 'PRJ-10003', titular: 'Ana Paula Reis', empresa: 'Solar Alfa', concessionaria: 'ENEL SP',
    concessionaireId: 'conc-enel', status: 'analysis', diasNaEtapa: 1, normalDias: 2, atrasoDias: -1, comQuem: 'nos', naFila: true,
    donos: [ANA, BRUNO], historico: [{ etapa: 'analysis', dias: 1, atual: true }] }),
  linha({ projectId: 'p-4', codigo: 'PRJ-10004', titular: 'Rita de Cássia Prado', empresa: 'Energia Boa', concessionaria: 'EDP São Paulo',
    concessionaireId: 'conc-edp', status: 'analysis', diasNaEtapa: 3, normalDias: 8, normalFonte: 'medido', atrasoDias: -5, comQuem: 'nos',
    naFila: true, historico: [{ etapa: 'analysis', dias: 3, atual: true }] }),
  linha({ projectId: 'p-7', codigo: 'PRJ-10007', titular: 'Diego Martins', empresa: 'Energia Boa', concessionaria: 'ENEL SP',
    concessionaireId: 'conc-enel', status: 'approved', diasNaEtapa: 41.2, normalDias: 32, atrasoDias: 9.2, comQuem: 'nos', naFila: true,
    historico: [{ etapa: 'analysis', dias: 2, atual: false }, { etapa: 'documentation', dias: 8, atual: false }, { etapa: 'approved', dias: 41.2, atual: true }] }),
  linha({ projectId: 'p-9', codigo: 'PRJ-10009', titular: 'Rogério Lins', empresa: 'Solar Alfa', status: 'analysis', diasNaEtapa: 18,
    normalDias: 8, atrasoDias: 10, comQuem: 'nos', naFila: true, donos: [ANA], historico: [{ etapa: 'analysis', dias: 18, atual: true }] }),
  linha({ projectId: 'p-11', codigo: 'PRJ-10011', titular: 'Helena Castro', empresa: 'Sol Nascente', status: 'vistoria_solicitada',
    diasNaEtapa: 6, normalDias: 10, atrasoDias: -4, comQuem: 'concessionaria', donos: [BRUNO],
    historico: [{ etapa: 'analysis', dias: 6, atual: false }, { etapa: 'approved', dias: 8, atual: false }, { etapa: 'vistoria_solicitada', dias: 6, atual: true }] }),
  linha({ projectId: 'p-12', codigo: 'PRJ-10012', titular: 'Antônio Freitas', empresa: 'Solar Alfa', status: 'pendencia', diasNaEtapa: 19,
    normalDias: 6, normalFonte: 'geral', atrasoDias: 13, comQuem: 'cliente', donos: [ANA],
    historico: [{ etapa: 'analysis', dias: 10, atual: false }, { etapa: 'pendencia', dias: 19, atual: true }] }),
  linha({ projectId: 'p-13', codigo: 'PRJ-10013', titular: 'Joana Bastos', empresa: 'Brisa Energia', concessionaria: 'Energisa',
    concessionaireId: 'conc-energisa', status: 'analysis', diasNaEtapa: 3, normalDias: null, normalFonte: null, atrasoDias: null,
    comQuem: 'concessionaria' }),
];

const normal = (concessionaireId: string, etapa: string, normalDias: number, fonte: NormalDaEtapa['fonte'] = 'medido'): NormalDaEtapa =>
  ({ concessionaireId, etapa, normalDias, amostra: 7, fonte });

export const NORMAIS_DE_EXEMPLO: NormalDaEtapa[] = ['conc-cpfl', 'conc-enel', 'conc-edp'].flatMap(c => [
  normal(c, 'pending', 3),
  normal(c, 'analysis', c === 'conc-enel' ? 2 : 8),
  normal(c, 'documentation', 6),
  normal(c, 'approved', 32),
  normal(c, 'vistoria_solicitada', 10),
  normal(c, 'pendencia', 6, 'geral'),
]);

const ev = (x: Partial<RegistroLudmilla> & Pick<RegistroLudmilla, 'quando' | 'acao' | 'titulo'>): RegistroLudmilla => ({
  ator: 'ludmilla', quem: 'Ludmilla', detalhe: null, situacao: 'ok', project_id: null, projeto: null, protocolo: null, ...x,
});

export const REGISTRO_DE_EXEMPLO: RegistroLudmilla[] = [
  ev({ quando: '2026-10-22T11:02:00Z', acao: 'visita', quem: 'agendamento', titulo: 'Varredura no portal CPFL Paulista',
    detalhe: '199 protocolos lidos · 1 recomendação(ões)' }),
  ev({ quando: '2026-10-22T11:01:00Z', acao: 'anexo', titulo: 'Anexo da concessionária no card',
    detalhe: 'parecer-7001234.pdf · protocolo 7001234 · conferido por cpf', project_id: 'p-1', projeto: 'PRJ-10001', protocolo: '7001234' }),
  ev({ quando: '2026-10-22T10:30:00Z', acao: 'visita', quem: 'agendamento', titulo: 'Leitura dos e-mails da ENEL SP',
    detalhe: '12 projetos conferidos · 1 documento(s) anexado(s)' }),
  ev({ quando: '2026-10-21T21:00:00Z', acao: 'parecer', titulo: 'Parecer da concessionária no card',
    detalhe: 'Análise técnica · APROVADO · protocolo 7001234', project_id: 'p-1', projeto: 'PRJ-10001' }),
  ev({ quando: '2026-10-21T17:40:00Z', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada', titulo: 'Recomendação aplicada',
    detalhe: 'Protocolo 7005555 · PRJ-10005 → approved', project_id: 'p-5', projeto: 'PRJ-10005' }),
  ev({ quando: '2026-10-20T20:00:00Z', acao: 'visita', quem: 'agendamento', titulo: 'Varredura no portal Elektro', situacao: 'erro',
    detalhe: 'sessão expirada' }),
];

/** O pedido da troca do A fazer de vistoria aprovada (F_VISTORIA), liberado. */
export const PEDIDO_DE_EXEMPLO: PedidoTroca = {
  liberado: true, motivo: null, para: 'canalgd.sp@exemplo.test', assunto: 'TROCA DE RELÓGIO - DIEGO MARTINS - NT 900000777',
  nt: '900000777', titular: 'Diego Martins', aprovacao_em: '2026-10-20T08:00:00Z', ja_pedido_em: null,
  pedido_situacao: null, pedido_erro: null, pedido_texto: null,
};

export const ETAPAS_DO_KANBAN = [
  'pending', 'analysis', 'documentation', 'approval', 'approved', 'pendencia', 'vistoria_solicitada',
  'aguardando_instalacao', 'vistoria_sem_protocolo', 'vistoria_reprovada', 'completed',
];
