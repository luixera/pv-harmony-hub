/**
 * DADOS INVENTADOS para os testes e os harnesses da página da Ludmilla.
 * Nenhum nome, protocolo, e-mail ou número aqui é de verdade. Código do app
 * NUNCA importa este arquivo.
 */
import type { MensagemEmail, PortalAccount, PortalUpdate } from '@/hooks/useLudmilla';
import type { Afazer } from '@/lib/ludmillaCaixa';
import type { AnexoDoPortal, EventoDoProjeto, ParecerDoPortal } from '@/lib/ludmillaPainel';

export const TENANT = '00000000-0000-4000-8000-0000000000aa';
/** "Agora" fixo dos testes: 22/10/2026 12:00 UTC. */
export const AGORA = Date.parse('2026-10-22T12:00:00Z');

const conta = (id: string, connector: string, extra: Partial<PortalAccount>): PortalAccount => ({
  id, tenant_id: TENANT, concessionaire_id: `conc-${connector}`, connector, login: 'robo@exemplo.test',
  situacao: 'ok', ultimo_erro: null, ultima_varredura_em: '2026-10-22T11:00:00Z', enabled: true,
  updated_at: '2026-10-22T11:00:00Z', modo: 'vps', operador_local: null, estacao_vista_em: null,
  sessao_viva_desde: null, acompanhamento: 'portal', identificacao: 'protocolo_no_assunto', ...extra,
});

export const CONTA_CPFL = conta('conta-cpfl', 'cpfl', {});
export const CONTA_EDP = conta('conta-edp', 'edp', { acompanhamento: 'email', login: null, ultima_varredura_em: null });
export const CONTA_ENEL = conta('conta-enel', 'enel', {
  acompanhamento: 'email', login: null, identificacao: 'remetente', ultima_varredura_em: '2026-10-22T10:30:00Z',
});
export const CONTA_ELEKTRO = conta('conta-elektro', 'elektro', {
  modo: 'local', situacao: 'sessao_expirada', operador_local: 'op-1',
  estacao_vista_em: '2026-10-22T11:58:00Z', ultima_varredura_em: '2026-10-15T09:00:00Z',
});
export const CONTAS_DE_EXEMPLO = [CONTA_CPFL, CONTA_EDP, CONTA_ENEL, CONTA_ELEKTRO];

const NOMES: Record<string, string> = {
  'conta-cpfl': 'CPFL Paulista', 'conta-edp': 'EDP São Paulo', 'conta-enel': 'ENEL SP', 'conta-elektro': 'Elektro',
};
export const nomeDaContaDeExemplo = (id: string) => NOMES[id] ?? '';

export const ETAPAS_DE_EXEMPLO = [
  { key: 'pending', label: 'Pendente' }, { key: 'analysis', label: 'Em análise' },
  { key: 'documentation', label: 'Documentação' }, { key: 'approval', label: 'Aprovação' },
  { key: 'approved', label: 'Aprovado' }, { key: 'vistoria_solicitada', label: 'Vistoria solicitada' },
  { key: 'pendencia', label: 'Pendência' }, { key: 'completed', label: 'Concluído' },
];
export const rotuloDeExemplo = (s: string | null | undefined) =>
  ETAPAS_DE_EXEMPLO.find(e => e.key === s)?.label ?? (s ?? '—');

const projeto = (id: string, code: string, status: string, titular: string, empresa: string) => ({
  id, code, status, title: titular, companies: { name: empresa }, project_general_data: { holder_name: titular },
});

/** O banco grava `raw.anexos` como NÚMERO; o tipo do hook diz texto. */
const raw = (r: Record<string, unknown>) => r as unknown as Record<string, string>;

const cartao = (id: string, extra: Partial<PortalUpdate>): PortalUpdate => ({
  id, account_id: 'conta-cpfl', protocolo: '0000000', titular_portal: null, status_portal: 'Em Andamento',
  status_anterior: null, project_id: null, casamento: 'protocolo', recomendacao: null, atualizar_protocolo: false,
  protocolo_anterior: null, situacao: 'pendente', aplicada_por: null, aplicada_em: null,
  detectado_em: '2026-10-20T00:00:00Z', raw: null, project: null, ...extra,
});

/** CPFL: Em Andamento → Aprovado; o portal escreve o nome diferente do cadastro. */
export const U_CPFL = cartao('u-cpfl', {
  protocolo: '7001234', titular_portal: 'UFV MARTA RIBEIRO', status_anterior: 'Em Andamento', status_portal: 'Aprovado',
  project_id: 'p-1', recomendacao: 'approved', detectado_em: '2026-10-20T11:00:00Z',
  raw: raw({ 'Última atualização': '19/10/2026' }),
  project: projeto('p-1', 'PRJ-10001', 'analysis', 'Marta Ribeiro Campos', 'Solar Alfa'),
});
/** ENEL: Carta favorável + troca do protocolo pela NT. */
export const U_ENEL_TROCA = cartao('u-enel-troca', {
  account_id: 'conta-enel', protocolo: '900000222', titular_portal: 'João Pedro Lima',
  status_portal: 'CARTA_PROJETO · FAVORAVEL', status_anterior: 'documentation', project_id: 'p-2', casamento: 'uc',
  recomendacao: 'approved', atualizar_protocolo: true, protocolo_anterior: 'Sem protocolo',
  detectado_em: '2026-10-21T09:00:00Z',
  raw: raw({
    assunto: 'Carta de aprovação do projeto', remetente: 'naoresponda@enel.exemplo.test',
    resumo: 'A ENEL aprovou o projeto.', anexos: 1, arquivo_lido: 'carta-900000222.pdf',
    motivo: 'a Carta traz a NT 900000222; o cadastro tem nenhum — o cartão sugere gravar a NT',
  }),
  project: projeto('p-2', 'PRJ-10002', 'documentation', 'João Pedro Lima', 'Sol Nascente'),
});
/** ENEL: o documento é de outra pessoa — bloqueado, sem sugestão. */
export const U_ENEL_BLOQUEADO = cartao('u-enel-bloq', {
  account_id: 'conta-enel', protocolo: '900000333', titular_portal: 'Ana Paula Reis',
  status_portal: 'CARTA_PROJETO · PENDENCIA', status_anterior: 'analysis', project_id: 'p-3', casamento: 'titular',
  detectado_em: '2026-10-19T15:00:00Z',
  raw: raw({
    assunto: 'Carta de pendência', remetente: 'naoresponda@enel.exemplo.test', anexos: 0,
    motivo: 'não anexei · o documento é de "Carlos Souza" e o projeto é de "Ana Paula Reis"',
  }),
  project: projeto('p-3', 'PRJ-10003', 'analysis', 'Ana Paula Reis', 'Solar Alfa'),
});
/** EDP: parecer favorável, 2 documentos no card, protocolo com zero à esquerda. */
export const U_EDP = cartao('u-edp', {
  account_id: 'conta-edp', protocolo: '045000000001', titular_portal: 'Rita de Cássia Prado',
  status_portal: 'PARECER · FAVORAVEL', status_anterior: 'analysis', project_id: 'p-4', recomendacao: 'approved',
  detectado_em: '2026-10-21T14:00:00Z',
  raw: raw({
    assunto: 'Parecer de acesso 045000000001', remetente: 'gd@edp.exemplo.test', resumo: 'Parecer favorável.',
    anexos: 2, motivo: null, arquivo_lido: 'parecer.pdf',
  }),
  project: projeto('p-4', 'PRJ-10004', 'analysis', 'Rita de Cássia Prado', 'Energia Boa'),
});
/** CPFL sem projeto casado e sem sugestão. */
export const U_CPFL_SEM_PROJETO = cartao('u-cpfl-sem', {
  protocolo: '7009999', titular_portal: 'UFV JOSE ALVES', status_portal: 'Pendente', status_anterior: 'Em Andamento',
  detectado_em: '2026-10-21T20:00:00Z',
});
export const U_APLICADA = cartao('u-aplicada', {
  protocolo: '7005555', status_portal: 'Aprovado', project_id: 'p-5', recomendacao: 'approved', situacao: 'aplicada',
  aplicada_por: 'pessoa-1', aplicada_em: '2026-10-18T13:00:00Z', detectado_em: '2026-10-18T11:00:00Z',
  project: projeto('p-5', 'PRJ-10005', 'approved', 'Bruno Teixeira', 'Solar Alfa'),
});
export const U_IGNORADA = cartao('u-ignorada', {
  protocolo: '7006666', status_portal: 'Cancelado', project_id: 'p-6', situacao: 'ignorada',
  aplicada_por: 'pessoa-1', aplicada_em: '2026-10-17T10:00:00Z', detectado_em: '2026-10-17T09:00:00Z',
  project: projeto('p-6', 'PRJ-10006', 'analysis', 'Carla Nunes', 'Sol Nascente'),
});
export const UPDATES_DE_EXEMPLO = [U_CPFL, U_ENEL_TROCA, U_ENEL_BLOQUEADO, U_EDP, U_CPFL_SEM_PROJETO, U_APLICADA, U_IGNORADA];

const afazer = (id: string, extra: Partial<Afazer>): Afazer => ({
  id, tenant_id: TENANT, account_id: 'conta-enel', project_id: null, mensagem_id: null, tipo: 'aviso',
  titulo: '📡 Aviso', mensagem: '', criado_em: '2026-10-20T00:00:00Z', feito_por: null, feito_em: null,
  project: null, feito: null, ...extra,
});
export const F_VISTORIA = afazer('f-vistoria', {
  project_id: 'p-7', tipo: 'vistoria_aprovada', titulo: '📡 Vistoria virtual aprovada na ENEL',
  mensagem: 'A ENEL aprovou o vídeo de anti-ilhamento do projeto PRJ-10007. É hora de pedir a troca do relógio.',
  criado_em: '2026-10-20T08:00:00Z', project: projeto('p-7', 'PRJ-10007', 'approved', 'Diego Martins', 'Energia Boa'),
});
export const F_DEVOLUCAO = afazer('f-devolucao', {
  tipo: 'devolucao', titulo: '📡 Um e-mail nosso voltou',
  mensagem: 'Um dos destinatários de um e-mail não recebeu a mensagem (devolução do servidor).',
  criado_em: '2026-10-22T07:00:00Z',
});
export const F_FEITO = afazer('f-feito', {
  project_id: 'p-8', tipo: 'troca_falhou', titulo: '📡 A ENEL não trocou o relógio',
  mensagem: 'A tentativa de troca do relógio do projeto PRJ-10008 não foi executada.',
  criado_em: '2026-10-16T08:00:00Z', feito_por: 'pessoa-2', feito_em: '2026-10-16T15:00:00Z', feito: { name: 'Bia Souza' },
  project: projeto('p-8', 'PRJ-10008', 'approved', 'Elisa Rocha', 'Solar Alfa'),
});
export const AFAZERES_DE_EXEMPLO = [F_VISTORIA, F_DEVOLUCAO, F_FEITO];

export const MENSAGEM_DA_TROCA: MensagemEmail = {
  id: 'm-1', account_id: 'conta-enel', run_id: null, message_id: 'carta-1@enel.exemplo.test', protocolo: '',
  project_id: 'p-2', assunto: 'Carta de aprovação do projeto', remetente: 'naoresponda@enel.exemplo.test',
  recebido_em: '2026-10-21T08:55:00Z', tipo_documento: 'carta_projeto', veredito: 'favoravel',
  resumo: 'A ENEL aprovou o projeto.', anexos: 1,
  motivo: 'a Carta traz a NT 900000222; o cadastro tem nenhum — o cartão sugere gravar a NT',
  concluida: true, tentativas: 1, arquivo_lido: 'carta-900000222.pdf', update_id: 'u-enel-troca',
  created_at: '2026-10-21T09:00:00Z', project: null,
};

export const DOCUMENTOS_DE_EXEMPLO: { anexos: AnexoDoPortal[]; pareceres: ParecerDoPortal[] } = {
  anexos: [
    {
      id: 'a-1', protocolo: '900000222', nome_arquivo: 'carta-900000222.pdf', situacao: 'enviado', motivo: null,
      enviado_em: '2026-10-21T09:01:00Z', created_at: '2026-10-21T09:00:30Z',
      document: { file_url: 'exemplo/p-2/carta-900000222.pdf', file_name: 'carta-900000222.pdf' },
    },
    {
      id: 'a-2', protocolo: '900000222', nome_arquivo: 'assinatura.png', situacao: 'bloqueado',
      motivo: 'imagem de assinatura', enviado_em: null, created_at: '2026-10-21T09:00:31Z', document: null,
    },
  ],
  pareceres: [
    { id: 'pa-1', protocolo: '7001234', data: '19/10/2026', analise: 'Análise técnica', status: 'APROVADO', created_at: '2026-10-20T11:00:00Z' },
  ],
};

export const LINHA_DO_TEMPO_DE_EXEMPLO: EventoDoProjeto[] = [
  {
    quando: '2026-10-21T09:00:00Z', ator: 'ludmilla', quem: 'Ludmilla', acao: 'email',
    titulo: 'E-mail lido: Carta de aprovação do projeto', detalhe: 'naoresponda@enel.exemplo.test · A ENEL aprovou o projeto.',
    situacao: 'ok', project_id: 'p-2', projeto: 'PRJ-10002', protocolo: null,
  },
  {
    quando: '2026-10-21T09:00:00Z', ator: 'ludmilla', quem: 'Ludmilla', acao: 'recomendacao',
    titulo: 'Mudança no portal: CARTA_PROJETO · FAVORAVEL', detalhe: 'Protocolo 900000222 · sugere approved',
    situacao: 'ok', project_id: 'p-2', projeto: 'PRJ-10002', protocolo: '900000222',
  },
  {
    quando: '2026-10-10T14:00:00Z', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada',
    titulo: 'Recomendação aplicada', detalhe: 'Protocolo 900000111 → documentation',
    situacao: 'ok', project_id: 'p-2', projeto: 'PRJ-10002', protocolo: '900000111',
  },
];
