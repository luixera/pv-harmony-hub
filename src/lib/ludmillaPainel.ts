/**
 * O TOPO E O PAINEL DE DETALHE DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md §3.1
 * (alertas urgentes, faixa de saúde) e §3.2 (o detalhe e as ações).
 */
import type { MensagemEmail, PortalAccount, PortalUpdate, RegistroLudmilla } from '@/hooks/useLudmilla';
import { anexosDoCartao, cartaoBloqueado, meioDaConta, type ItemDaCaixa, type MeioDoItem } from '@/lib/ludmillaCaixa';

// ── tipos das consultas novas (os hooks devolvem estes formatos) ─────────────

export type AcaoDoProjeto = RegistroLudmilla['acao'] | 'email' | 'afazer' | 'afazer_feito';
/** Uma linha de `ludmilla_linha_do_tempo` — o formato de `ludmilla_registro` + 3 ações. */
export type EventoDoProjeto = Omit<RegistroLudmilla, 'acao'> & { acao: AcaoDoProjeto };

export interface AnexoDoPortal {
  id: string;
  protocolo: string;
  nome_arquivo: string;
  situacao: 'pendente' | 'enviado' | 'bloqueado' | 'erro';
  motivo: string | null;
  enviado_em: string | null;
  created_at: string;
  /** `documents.file_url` é o caminho no bucket `project-documents` */
  document: { file_url: string; file_name: string | null } | null;
}

export interface ParecerDoPortal {
  id: string;
  protocolo: string;
  data: string | null;
  analise: string | null;
  status: string | null;
  created_at: string;
}

type DadosGerais = { uc_number?: string | null } | null | undefined;
export interface ProjetoDoDetalhe {
  id: string;
  code: string;
  status: string;
  protocol_number: string | null;
  project_general_data?: DadosGerais | DadosGerais[];
}

export interface ProjetoDaCriacao { id: string; code: string; cpfl_node_id: string | null }

// ── utilidades ───────────────────────────────────────────────────────────────

function limpo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function dataValida(v: unknown): string | null {
  const s = limpo(v);
  return s !== null && !Number.isNaN(Date.parse(s)) ? s : null;
}

const MIN = 60_000;

export function haQuantoTempo(iso: string | null | undefined, agora: number): string {
  if (!iso) return 'nunca';
  const min = Math.floor((agora - Date.parse(iso)) / MIN);
  if (!Number.isFinite(min)) return 'nunca';
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} dias`;
}

// ── a faixa de saúde e os alertas (§3.1) ────────────────────────────────────

export type TomDaSaude = 'ok' | 'atencao' | 'erro' | 'parada';
export interface SaudeDaConta { tom: TomDaSaude; texto: string }
/** O que `estadoDaEstacao` (useLudmilla.ts) devolve; quem chama passa pronto. */
export interface EstadoDaEstacao { online: boolean; texto: string }

/**
 * Duas varreduras de portal por dia (cron `ludmilla-08h`/`ludmilla-17h`, 11h e 20h UTC):
 * mais de 18 h sem ler é rodada perdida. Vale SÓ para o portal. O e-mail (EDP, ENEL) não
 * tem agendamento: `ludmilla_agendar_varreduras` só enfileira conta com login e `secret_id`,
 * e o run de e-mail só nasce do "Verificar agora" (docs/modules/integrations/ludmilla.md,
 * "A proteção acidental do agendador"). Horas sem ler uma caixa de e-mail não são falha.
 */
export const HORAS_SEM_LER_ATRASADA = 18;

/**
 * `caixaPronta`: true = configurada; false = NÃO configurada; null = ainda carregando
 * (nesse caso nada é dito sobre a caixa: nem alerta, nem ponto de "parada").
 */
export function saudeDaConta(
  conta: PortalAccount, o: { estacao: EstadoDaEstacao | null; caixaPronta: boolean | null; agora: number },
): SaudeDaConta {
  if (!conta.enabled) return { tom: 'parada', texto: 'desligada' };
  if (conta.situacao === 'erro') return { tom: 'erro', texto: 'com erro' };
  if (conta.situacao === 'sessao_expirada') return { tom: 'atencao', texto: 'sessão expirada' };
  if (conta.acompanhamento === 'email' && o.caixaPronta === false) return { tom: 'parada', texto: 'caixa não configurada' };
  if (conta.situacao === 'nao_configurado') return { tom: 'parada', texto: 'sem acesso' };
  if (o.estacao && !o.estacao.online) return { tom: 'atencao', texto: o.estacao.texto };
  if (!conta.ultima_varredura_em) {
    return { tom: 'parada', texto: conta.acompanhamento === 'email' ? 'ainda não leu a caixa' : 'ainda não varreu' };
  }
  if (conta.acompanhamento === 'portal'
    && o.agora - Date.parse(conta.ultima_varredura_em) > HORAS_SEM_LER_ATRASADA * 60 * MIN) {
    return { tom: 'atencao', texto: 'leitura atrasada' };
  }
  return { tom: 'ok', texto: 'em dia' };
}

export interface ChipDaConta {
  id: string;
  nome: string;
  meio: MeioDoItem;
  saude: SaudeDaConta;
  /** "lida há 2 h" ou "nunca lida" */
  lida: string;
  pendentes: number;
  /** a mesma trava do botão de hoje: e-mail precisa da caixa; portal precisa do login */
  podeVerificar: boolean;
  tipoDoRun: 'varredura' | 'varredura_email';
}

export function chipsDaFaixa(contas: PortalAccount[], o: {
  nomeDaConta: (id: string) => string;
  pendentesPorConta: Record<string, number>;
  estacaoDe: (c: PortalAccount) => EstadoDaEstacao | null;
  /** true = configurada · false = não configurada · null = ainda carregando */
  caixaPronta: boolean | null;
  agora: number;
}): ChipDaConta[] {
  return contas
    .map(c => ({
      id: c.id,
      nome: o.nomeDaConta(c.id) || c.connector.toUpperCase(),
      meio: meioDaConta(c),
      saude: saudeDaConta(c, { estacao: o.estacaoDe(c), caixaPronta: o.caixaPronta, agora: o.agora }),
      lida: c.ultima_varredura_em ? `lida ${haQuantoTempo(c.ultima_varredura_em, o.agora)}` : 'nunca lida',
      pendentes: o.pendentesPorConta[c.id] ?? 0,
      podeVerificar: c.acompanhamento === 'email' ? o.caixaPronta === true : !!c.login,
      tipoDoRun: (c.acompanhamento === 'email' ? 'varredura_email' : 'varredura') as ChipDaConta['tipoDoRun'],
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export interface AlertaUrgente { chave: string; tom: 'erro' | 'atencao'; titulo: string; detalhe: string | null }

/**
 * Os alertas que vão acima de tudo (o código da imagem da Elektro vem à parte, do `portal_captchas`).
 *
 * Saem em ordem de urgência, não na ordem das contas (que vêm do banco sem `order`): erro,
 * sessão expirada, caixa de e-mail; no mesmo grau, pelo nome da concessionária.
 *
 * `caixaPronta` null = ainda carregando: não alerta. `estacaoDe` (a mesma origem de `saudeDaConta`)
 * deixa o alerta da sessão expirada da estação local dizer a verdade: com a estação offline, ela
 * não está esperando código nenhum — alguém precisa ligar o computador. É OBRIGATÓRIO de propósito
 * (o compilador cobra quem esquecer): sem ele a Elektro offline sairia com o texto falso; quem não
 * tem estação passa `() => null`.
 */
export function alertasDasContas(
  contas: PortalAccount[], nomeDaConta: (id: string) => string, caixaPronta: boolean | null,
  estacaoDe: (c: PortalAccount) => EstadoDaEstacao | null,
): AlertaUrgente[] {
  const nome = (c: PortalAccount) => nomeDaConta(c.id) || c.connector.toUpperCase();
  const lista: { grau: number; nome: string; alerta: AlertaUrgente }[] = [];
  for (const c of contas) {
    if (!c.enabled) continue;
    if (c.situacao === 'erro') {
      lista.push({
        grau: 0, nome: nome(c),
        alerta: { chave: `erro:${c.id}`, tom: 'erro', titulo: `${nome(c)}: a última leitura deu erro`, detalhe: limpo(c.ultimo_erro) },
      });
    } else if (c.situacao === 'sessao_expirada') {
      const estacao = c.modo === 'local' ? estacaoDe(c) : null;
      const detalhe = c.modo !== 'local' ? 'Ela tenta entrar de novo na próxima visita.'
        : estacao && !estacao.online ? 'A estação está offline; ligue o computador do escritório.'
        : 'A estação espera alguém entrar no portal e digitar o código da imagem.';
      lista.push({
        grau: 1, nome: nome(c),
        alerta: { chave: `sessao:${c.id}`, tom: 'atencao', titulo: `${nome(c)}: sessão expirada`, detalhe },
      });
    }
  }
  const porEmail = contas.filter(c => c.enabled && c.acompanhamento === 'email');
  if (porEmail.length > 0 && caixaPronta === false) {
    lista.push({
      grau: 2, nome: '',
      alerta: {
        chave: 'caixa', tom: 'atencao', titulo: 'A caixa de e-mail não está configurada',
        detalhe: `Sem ela a Ludmilla não lê ${porEmail.map(nome).sort((a, b) => a.localeCompare(b, 'pt-BR')).join(' nem ')}. Configure em Claudinho / Agente de e-mails.`,
      },
    });
  }
  return lista
    .sort((a, b) => a.grau - b.grau || a.nome.localeCompare(b.nome, 'pt-BR') || a.alerta.chave.localeCompare(b.alerta.chave))
    .map(x => x.alerta);
}

// ── o detalhe (§3.2) ─────────────────────────────────────────────────────────

export type OQueChegou =
  | {
      meio: 'email'; assunto: string | null; remetente: string | null;
      /** a data do e-mail (mensagem ou `raw.recebido_em`); null nos cartões antigos */
      recebidoEm: string | null;
      /** quando a Ludmilla leu — o que a tela mostra quando não há a data do e-mail */
      lidoEm: string;
      resumo: string | null; arquivoLido: string | null; anexos: number;
      veredito: MensagemEmail['veredito']; tipoDocumento: string | null;
    }
  | { meio: 'portal'; de: string | null; para: string; atualizadoNoPortal: string | null };

/**
 * A mensagem só vale para o cartão a que está ligada (`update_id`). Quem chama pode buscar a
 * mensagem pelo projeto ou pelo protocolo e trazer a de OUTRO cartão (o mesmo projeto tem vários
 * e-mails): usar assunto, veredito e ressalva alheios no detalhe seria dizer o que não é deste cartão.
 */
function mensagemDoCartao(u: PortalUpdate, m: MensagemEmail | null): MensagemEmail | null {
  return m && m.update_id === u.id ? m : null;
}

/** E-mail (EDP, ENEL): a mensagem ligada ao cartão manda; o `raw` cobre o que ela não tiver. */
export function oQueChegou(u: PortalUpdate, mensagem: MensagemEmail | null, meio: MeioDoItem): OQueChegou {
  const m = mensagemDoCartao(u, mensagem);
  const r = (u.raw ?? {}) as Record<string, unknown>;
  if (meio === 'email') {
    return {
      meio: 'email',
      assunto: limpo(m?.assunto) ?? limpo(r.assunto),
      remetente: limpo(m?.remetente) ?? limpo(r.remetente),
      recebidoEm: dataValida(m?.recebido_em) ?? dataValida(r.recebido_em),
      lidoEm: u.detectado_em,
      resumo: limpo(m?.resumo) ?? limpo(r.resumo),
      arquivoLido: limpo(m?.arquivo_lido) ?? limpo(r.arquivo_lido),
      anexos: Math.max(m?.anexos ?? 0, anexosDoCartao(u)),
      veredito: m?.veredito ?? null,
      tipoDocumento: limpo(m?.tipo_documento),
    };
  }
  return { meio: 'portal', de: limpo(u.status_anterior), para: u.status_portal, atualizadoNoPortal: limpo(r['Última atualização']) };
}

/** A ressalva da robô (o porquê): a da mensagem, senão a do `raw` do cartão. */
export function ressalvaDoCartao(u: PortalUpdate, mensagem: MensagemEmail | null): string | null {
  return limpo(mensagemDoCartao(u, mensagem)?.motivo) ?? limpo((u.raw as Record<string, unknown> | null)?.motivo);
}

export type AcaoDaDecisao = 'aplicar' | 'ignorar' | 'feito';

export interface AcoesDoItem {
  principal: { acao: 'aplicar' | 'feito'; rotulo: string; habilitada: boolean; porque: string | null } | null;
  secundaria: { acao: 'ignorar'; rotulo: 'Ignorar' | 'Dispensar' } | null;
}

/**
 * A etapa para onde o card vai de fato. É o que `ludmilla_aplicar_update` faz no banco:
 * `coalesce(nullif(trim(p_status), ''), recomendacao)` — sem etapa escolhida, vale a recomendada.
 * Só a recomendação tem etapa; o A fazer não move card.
 */
export function etapaEfetiva(item: ItemDaCaixa, etapa: string | null): string | null {
  return etapa?.trim() || item.update?.recomendacao?.trim() || null;
}

/**
 * Os botões. A trava do Aplicar é a de sempre: precisa de projeto e (etapa efetiva ou troca de
 * protocolo). Cartão bloqueado (o documento é de outra pessoa) NÃO oferece Aplicar: com uma etapa
 * escolhida ele moveria o projeto a partir do cartão errado. Só "Dispensar".
 */
export function acoesDoItem(item: ItemDaCaixa, etapa: string | null): AcoesDoItem {
  if (item.situacao !== 'pendente') return { principal: null, secundaria: null };
  if (item.afazer) {
    return { principal: { acao: 'feito', rotulo: 'Marcar como feito', habilitada: true, porque: null }, secundaria: null };
  }
  const u = item.update;
  if (!u) return { principal: null, secundaria: null };
  if (cartaoBloqueado(u)) return { principal: null, secundaria: { acao: 'ignorar', rotulo: 'Dispensar' } };
  const comEtapa = etapaEfetiva(item, etapa) !== null;
  const rotulo = u.atualizar_protocolo ? (comEtapa ? 'Aplicar etapa e protocolo' : 'Atualizar protocolo') : 'Aplicar';
  const porque = !u.project ? 'Sem projeto casado: não há card para mover.'
    : (!comEtapa && !u.atualizar_protocolo) ? 'Escolha a etapa para onde mover o card.'
    : null;
  return {
    principal: { acao: 'aplicar', rotulo, habilitada: porque === null, porque },
    secundaria: { acao: 'ignorar', rotulo: 'Ignorar' },
  };
}

/**
 * O texto do aviso com "Desfazer": diz o que VAI acontecer quando a espera acabar. `etapa` é a
 * escolhida na tela (pode ser vazia: vale a recomendada, como no banco); `rotuloEtapa` traduz a chave.
 */
export function textoDaDecisao(
  item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null,
  rotuloEtapa: (status: string | null | undefined) => string,
): string {
  const quem = item.codigo || item.concessionaria || 'Item';
  if (acao === 'feito') return `${quem}: marcado como feito`;
  if (acao === 'ignorar') {
    return item.update && cartaoBloqueado(item.update) ? `${quem}: documento bloqueado dispensado` : `${quem}: recomendação ignorada`;
  }
  const destino = etapaEfetiva(item, etapa);
  const gravaProtocolo = !!item.update?.atualizar_protocolo && !!item.protocolo;
  if (destino) {
    return gravaProtocolo
      ? `${quem} vai para ${rotuloEtapa(destino)} e grava o protocolo ${item.protocolo}`
      : `${quem} vai para ${rotuloEtapa(destino)}`;
  }
  return gravaProtocolo
    ? `${quem}: o protocolo do cadastro vai virar ${item.protocolo}`
    : `${quem}: recomendação aplicada`;
}

export interface SituacaoDecidida { rotulo: 'Aplicada' | 'Ignorada' | 'Feito'; em: string | null; por: string | null }

export function situacaoDecidida(item: ItemDaCaixa): SituacaoDecidida | null {
  if (item.situacao === 'pendente') return null;
  if (item.afazer) return { rotulo: 'Feito', em: item.afazer.feito_em, por: limpo(item.afazer.feito?.name) };
  const u = item.update;
  if (!u) return null;
  return { rotulo: u.situacao === 'aplicada' ? 'Aplicada' : 'Ignorada', em: u.aplicada_em, por: null };
}

/** A UC do cadastro; o embed 1:1 pode vir como objeto ou como lista de uma linha. */
export function ucDoProjeto(p: { project_general_data?: DadosGerais | DadosGerais[] } | null | undefined): string | null {
  const d = p?.project_general_data;
  const linha = Array.isArray(d) ? d[0] : d;
  return limpo(linha?.uc_number);
}

/** O título do cartão de criação e o número que a CPFL deu ao projeto. */
export function rotuloDaCriacao(
  run: { dados: Record<string, unknown> | null; resultado: Record<string, unknown> | null },
  projetoDe: (projectId: string) => ProjetoDaCriacao | null,
): { titulo: string; numeroCpfl: string | null } {
  const bruto = run.dados?.project_id;
  const pid = typeof bruto === 'string' ? bruto : null;
  const projeto = pid ? projetoDe(pid) : null;
  const node = run.resultado?.node;
  const doRun = typeof node === 'number' ? String(node) : limpo(node);
  return {
    titulo: projeto?.code ?? (pid ? `Projeto ${pid.slice(0, 8)}…` : 'Criar na CPFL'),
    numeroCpfl: doRun ?? limpo(projeto?.cpfl_node_id),
  };
}
