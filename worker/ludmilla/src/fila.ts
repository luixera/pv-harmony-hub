import { hostname } from 'node:os';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { SituacaoConta } from './erros.js';
import { lerDisco } from './disco.js';
import { carregarSessao, guardarSessao, modoAtual, nomeRpc } from './local.js';

/**
 * A fila da Ludmilla vive no banco (`portal_sync_runs`), e este módulo é a
 * única porta do robô para ela. Tudo passa por RPC: na VPS com service role;
 * na estação local (LUDMILLA_MODO=local) com a sessão do usuário operador e
 * as RPCs `_local`, que o banco só deixa o `operador_local` da conta chamar.
 * O robô não tem SELECT direto em tabela nenhuma além do que as funções expõem.
 */

export interface Run {
  id: string;
  tenant_id: string;
  account_id: string;
  tipo: 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura' | 'criar_projeto' | 'varredura_email';
  situacao: string;
  dados?: Record<string, unknown>;
}

export interface Credenciais {
  login: string;
  senha: string;
  connector: string;
}

export interface Fechamento {
  situacao: 'ok' | 'erro';
  erro?: string;
  resultado?: unknown;
  printPath?: string;
  protocolos?: number;
  mudancas?: number;
  situacaoConta?: SituacaoConta;
}

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('Falta SUPABASE_URL no ambiente.');
  if (modoAtual() === 'local') {
    // Estação: chave pública + sessão do usuário operador (guardada em arquivo).
    // Service role NUNCA sai da VPS.
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!anon) throw new Error('Falta SUPABASE_ANON_KEY no ambiente da estação.');
    cliente = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });
    cliente.auth.onAuthStateChange((_ev, s) => {
      if (s?.refresh_token) guardarSessao({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? 0 });
    });
    return cliente;
  }
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

/**
 * Estação: retoma a sessão guardada (ou entra com e-mail/senha na primeira vez,
 * via `--login`). Devolve o e-mail do operador ou lança com a instrução.
 */
export async function entrarNaEstacao(login?: { email: string; senha: string }): Promise<string> {
  const c = supabase();
  if (login) {
    const { data, error } = await c.auth.signInWithPassword({ email: login.email, password: login.senha });
    if (error || !data.session) throw new Error(`Não consegui entrar no GD Manager: ${error?.message ?? 'sem sessão'}`);
    guardarSessao({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at ?? 0 });
    return data.user?.email ?? login.email;
  }
  const s = carregarSessao();
  if (!s) throw new Error('A estação ainda não entrou no GD Manager. Rode: node dist/index.js --login');
  const { data, error } = await c.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  if (error || !data.session) throw new Error(`A sessão da estação expirou (${error?.message ?? 'sem sessão'}). Rode de novo: node dist/index.js --login`);
  return data.user?.email ?? '';
}

/** Heartbeat da estação — a página mostra online/offline por ele. */
export async function pulsar(): Promise<void> {
  if (modoAtual() !== 'local') return;
  await supabase().rpc('ludmilla_estacao_pulsa').then(() => undefined, () => undefined);
}

/**
 * Medição de disco da VPS — o painel de monitoramento mostra por ela.
 *
 * Espelho de `pulsar`, com o modo invertido: pulsar interessa na estação
 * local (a página mostra online/offline), o disco interessa na VPS, que é
 * onde o app é servido e onde as importações grandes rodam.
 *
 * Best-effort de propósito: se o banco estiver fora, a medição se perde e o
 * laço segue. Nenhuma leitura de disco justifica parar a fila.
 */
export async function reportarDisco(
  origem: 'worker' | 'ingestao' = 'worker',
  etapa: string | null = null,
): Promise<void> {
  if (modoAtual() === 'local') return;
  try {
    const m = await lerDisco('/');
    await supabase().rpc('vps_armazenamento_registrar', {
      p_host: process.env.LUDMILLA_HOST ?? hostname(),
      p_particao: '/',
      p_total: m.totalBytes,
      p_usado: m.usadoBytes,
      p_livre: m.livreBytes,
      p_origem: origem,
      p_etapa: etapa,
    });
  } catch {
    /* medição é best-effort: nunca derruba o laço */
  }
}

/** Próximo run da fila, já marcado como `rodando`; null quando não há. */
export async function pegarRun(): Promise<Run | null> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_claim_run'));
  if (error) throw new Error(`Não consegui consultar a fila: ${error.message}`);
  const linhas = (data ?? []) as Run[];
  return linhas[0] ?? null;
}

export async function finalizarRun(runId: string, f: Fechamento): Promise<void> {
  const { error } = await supabase().rpc(nomeRpc('ludmilla_finalizar_run'), {
    p_run_id: runId,
    p_situacao: f.situacao,
    p_erro: f.erro ?? null,
    p_resultado: f.resultado ?? null,
    p_print_path: f.printPath ?? null,
    p_protocolos: f.protocolos ?? 0,
    p_mudancas: f.mudancas ?? 0,
    p_situacao_conta: f.situacaoConta ?? null,
  });
  if (error) throw new Error(`Não consegui fechar o run ${runId}: ${error.message}`);
}

/** Conector da conta — sem decifrar a senha (basta para o reconhecimento). */
export async function conectorDaConta(accountId: string): Promise<string> {
  const { data, error } = await supabase()
    .from('portal_accounts')
    .select('connector')
    .eq('id', accountId)
    .single();
  if (error || !data) throw new Error(`Conta ${accountId} não encontrada: ${error?.message ?? 'sem dados'}`);
  return data.connector as string;
}

/** Credenciais decifradas — só na varredura, só na hora de usar. */
export async function credenciais(accountId: string): Promise<Credenciais> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_portal_credentials'), { p_account_id: accountId });
  if (error) throw new Error(`Não consegui ler as credenciais: ${error.message}`);
  const linha = ((data ?? []) as Credenciais[])[0];
  if (!linha) throw new Error('A conta não tem credencial gravada ou está desativada.');
  return linha;
}

// ── Criação de projeto na CPFL ───────────────────────────────────────────────

import { AUTONOMIA_PADRAO, type DadosCriacaoCpfl } from './criacao/tipos.js';

/**
 * Carrega o que o formulário da CPFL pede (RPC ludmilla_dados_criacao_cpfl):
 * UC, titular com contato, módulos, inversores e o padrão de entrada já
 * resolvido como no front. `autonomiaRun` são respostas que o front mandou
 * em run.dados.autonomia — vencem os padrões de GD.
 */
export async function dadosCriacaoCpfl(
  runId: string,
  projectId: string,
  tenantId: string,
  autonomiaRun: Record<string, string> = {},
): Promise<DadosCriacaoCpfl> {
  const { data, error } = await supabase().rpc('ludmilla_dados_criacao_cpfl' as never, {
    p_run_id:     runId,
    p_project_id: projectId,
  } as never);
  if (error) throw new Error(`Não consegui carregar dados para criação: ${error.message}`);
  const d = ((data ?? []) as Record<string, unknown>[])[0];
  if (!d) throw new Error('Dados de criação não encontrados para o projeto.');

  const s = (k: string) => (d[k] == null ? '' : String(d[k]));
  const n = (k: string) => (d[k] == null || d[k] === '' ? null : Number(d[k]));
  const extra = (d['rule_extra'] ?? {}) as Record<string, string>;
  const demanda = Object.entries(extra).find(([k]) => /demanda/i.test(k))?.[1] ?? null;

  return {
    project_id:     projectId,
    tenant_id:      tenantId,
    run_id:         runId,
    uc_number:      s('uc_number'),
    coordinates:    s('coordinates'),
    customer_name:  s('customer_name'),
    customer_cpf:   s('customer_cpf'),
    customer_email: s('customer_email'),
    customer_phone: s('customer_phone'),
    project_title:  s('project_title'),
    is_rural:       d['is_rural'] === true,
    concessionaire: s('concessionaire'),
    entry_phase:    s('entry_phase') || null,
    entry_breaker:  s('entry_breaker') || null,
    modulo: n('module_quantity') ? {
      fabricante: s('module_brand'), modelo: s('module_model'),
      quantidade: n('module_quantity') ?? 0, potencia_wp: n('module_power_wp') ?? 0,
    } : null,
    inversor: n('inverter_quantity') ? {
      fabricante: s('inverter_brand'), modelo: s('inverter_model'),
      quantidade: n('inverter_quantity') ?? 0, potencia_kw: n('inverter_power_kw') ?? 0,
    } : null,
    padrao: s('rule_categoria') ? {
      categoria: s('rule_categoria'), num_fases: n('rule_num_fases'), bitola: s('rule_bitola') || null,
      disjuntor: n('rule_disjuntor'), caixa: s('rule_caixa') || null, demanda_kw: demanda,
    } : null,
    autonomia: { ...AUTONOMIA_PADRAO, ...autonomiaRun },
  };
}

/** Retorna true se houver algum run `criar_projeto` na_fila. Usado para poll dinâmico. */
export async function temCriacaoPendente(): Promise<boolean> {
  const { data, error } = await supabase()
    .from('portal_sync_runs' as never)
    .select('id')
    .eq('tipo', 'criar_projeto')
    .eq('situacao', 'na_fila')
    .limit(1);
  if (error) return false;
  return ((data as unknown[]) ?? []).length > 0;
}

/** Sobe um arquivo de texto (HTML da descoberta) no bucket, na pasta do run. */
export async function subirTexto(tenantId: string, runId: string, nome: string, conteudo: string): Promise<string> {
  const path = `${tenantId}/${runId}/${nome}`;
  const { error } = await supabase().storage.from('ludmilla').upload(path, Buffer.from(conteudo, 'utf8'), {
    contentType: 'text/html; charset=utf-8', upsert: true,
  });
  if (error) throw new Error(`Não consegui guardar ${nome}: ${error.message}`);
  return path;
}

/** Sobe o print no bucket privado `ludmilla`, na pasta do tenant. Devolve o path. */
export async function subirPrint(tenantId: string, runId: string, png: Buffer): Promise<string> {
  const path = `${tenantId}/${runId}.png`;
  const { error } = await supabase().storage.from('ludmilla').upload(path, png, {
    contentType: 'image/png', upsert: true,
  });
  if (error) throw new Error(`Não consegui guardar o print: ${error.message}`);
  return path;
}

// ── Anexos da concessionária para o card ─────────────────────────────────────

export interface AnexoPendente {
  id: string;
  project_id: string;
  company_id: string;
  protocolo: string;
  id_arquivo: string;
  nome_arquivo: string;
  codigo: string;
}

/** O que o banco autorizou anexar (projeto casado E titular/UC conferidos). */
export async function anexosPendentes(accountId: string): Promise<AnexoPendente[]> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_anexos_pendentes'), { p_account_id: accountId });
  if (error) throw new Error(`Não consegui listar os anexos pendentes: ${error.message}`);
  return (data ?? []) as AnexoPendente[];
}

/** Nome de arquivo seguro para o bucket (mesma ideia do sanitizeFileName do front). */
const nomeSeguro = (nome: string) =>
  nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 120);

/**
 * Sobe o arquivo no bucket dos documentos do projeto, no MESMO caminho que o
 * front usa para anexos de comentário ({empresa}/{projeto}/other_photos/…).
 */
export async function subirDocumento(a: AnexoPendente, bytes: Buffer, mime: string): Promise<string> {
  const path = `${a.company_id}/${a.project_id}/other_photos/${Date.now()}_${nomeSeguro(a.nome_arquivo)}`;
  const { error } = await supabase().storage.from('project-documents').upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`Não consegui guardar o anexo no projeto: ${error.message}`);
  return path;
}

export async function anexoEnviado(anexoId: string, filePath: string, mime: string): Promise<void> {
  const { error } = await supabase().rpc(nomeRpc('ludmilla_anexo_enviado'), { p_anexo_id: anexoId, p_file_path: filePath, p_file_type: mime });
  if (error) throw new Error(`Não consegui registrar o anexo no card: ${error.message}`);
}

export async function anexoErro(anexoId: string, motivo: string): Promise<void> {
  await supabase().rpc(nomeRpc('ludmilla_anexo_erro'), { p_anexo_id: anexoId, p_motivo: motivo.slice(0, 500) });
}

// ── Código da imagem respondido pela equipe (de longe) ───────────────────────
// Mesmas RPCs nos dois modos: o banco aceita service role OU o operador da conta.

/** foto de cada pedido aberto, para apagar do bucket ao fechar */
const fotosPorPedido = new Map<string, string>();

/** Sobe a foto do código no bucket e abre o pedido; a equipe recebe o sino. */
export async function pedirCaptcha(run: Run, png: Buffer, tentativa: number, mensagem?: string): Promise<string> {
  const path = `${run.tenant_id}/captcha/${run.id}-${tentativa}-${Date.now()}.png`;
  const { error: eUp } = await supabase().storage.from('ludmilla').upload(path, png, { contentType: 'image/png', upsert: true });
  if (eUp) throw new Error(`Não consegui guardar a foto do código: ${eUp.message}`);
  const { data, error } = await supabase().rpc('ludmilla_captcha_pedir', {
    p_run_id: run.id, p_imagem_path: path, p_tentativa: tentativa, p_mensagem: mensagem ?? null,
  });
  if (error) throw new Error(`Não consegui pedir o código à equipe: ${error.message}`);
  const id = String(data);
  fotosPorPedido.set(id, path);
  return id;
}

export async function lerCaptcha(id: string): Promise<{ situacao: string; resposta?: string | null }> {
  const { data, error } = await supabase().rpc('ludmilla_captcha_ler', { p_captcha_id: id });
  if (error) throw new Error(`Não consegui ler a resposta do código: ${error.message}`);
  const linha = ((data ?? []) as { situacao: string; resposta: string | null }[])[0];
  return linha ?? { situacao: 'cancelado' };
}

export async function fecharCaptcha(id: string, situacao: 'usado' | 'recusado' | 'expirado' | 'cancelado', mensagem?: string): Promise<void> {
  await supabase().rpc('ludmilla_captcha_fechar', { p_captcha_id: id, p_situacao: situacao, p_mensagem: mensagem ?? null });
  // a foto já cumpriu o papel: some do bucket (melhor esforço)
  const path = fotosPorPedido.get(id);
  if (path) {
    fotosPorPedido.delete(id);
    await supabase().storage.from('ludmilla').remove([path]).then(() => undefined, () => undefined);
  }
}

/** A página mostra "sessão no portal viva desde …" por isto. */
export async function sessaoViva(accountId: string, viva: boolean): Promise<void> {
  await supabase().rpc('ludmilla_sessao_viva', { p_account_id: accountId, p_viva: viva }).then(() => undefined, () => undefined);
}

/** Protocolos dos projetos que a conta acompanha — o robô lê o detalhe deles mesmo sem mexida recente. */
export async function protocolosDeInteresse(accountId: string): Promise<string[]> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_protocolos_de_interesse'), { p_account_id: accountId });
  if (error) return [];
  return ((data ?? []) as { protocolo: string }[]).map(x => x.protocolo);
}

// ── Acompanhamento por e-mail ────────────────────────────────────────────────
//
// ATENÇÃO: estas RPCs são chamadas pelo nome SIMPLES, nunca por `nomeRpc()`.
// Elas não têm variante `_local` porque o acompanhamento por e-mail é só da VPS
// (foi o pedido: "assim não preciso deixar o computador ligado"). Passar por
// `nomeRpc` faria a estação local procurar `…_local` e quebrar. A guarda que
// recusa o run na estação está em `email/index.ts`.

import { idArquivoDeEmail, type RegraEmail } from './email/util.js';

export interface ProtocoloDeProjeto {
  protocolo: string; project_id: string; company_id: string;
  codigo: string; titular: string | null; endereco: string | null;
}

export async function credencialDaCaixa(accountId: string): Promise<{ email: string; senha: string }> {
  const { data, error } = await supabase().rpc('ludmilla_email_credencial' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui ler o acesso à caixa: ${error.message}`);
  const linha = ((data ?? []) as { email: string; senha: string }[])[0];
  if (!linha?.email || !linha?.senha) {
    throw new Error('O acesso à caixa de e-mail não está configurado para este tenant (agent_config → email_agent).');
  }
  return linha;
}

export async function protocolosDoEmail(accountId: string): Promise<ProtocoloDeProjeto[]> {
  const { data, error } = await supabase().rpc('ludmilla_email_protocolos' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui listar os protocolos: ${error.message}`);
  return (data ?? []) as ProtocoloDeProjeto[];
}

export async function regrasDoEmail(accountId: string): Promise<RegraEmail[]> {
  const { data, error } = await supabase().rpc('ludmilla_email_regras' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui listar as regras de e-mail: ${error.message}`);
  return (data ?? []) as RegraEmail[];
}

/**
 * Preciso TRATAR esta mensagem neste protocolo?
 *
 * A pergunta mudou de "é nova?" para "está pendente?" de propósito: a antiga
 * (`ludmilla_email_mensagem_nova`, que não existe mais no banco) respondia
 * "já vi" e queimava a mensagem para sempre — IA que falhou por motivo
 * passageiro, regra mal configurada ou anexo que não subiu faziam o documento
 * desaparecer em silêncio. Agora o banco responde TRUE quando não há linha, ou
 * quando a linha existe e não foi concluída (com tentativa sobrando no teto).
 *
 * O protocolo entra na chave: assunto que cita dois protocolos precisa chegar
 * aos DOIS projetos, e com a chave antiga o segundo ouvia "já tratei".
 *
 * Falha de banco LANÇA em vez de virar `false`: tratar erro como "já conheço
 * esta mensagem" faria a robô pular a caixa inteira em silêncio.
 */
export async function mensagemPendente(accountId: string, messageId: string, protocolo: string): Promise<boolean> {
  const { data, error } = await supabase().rpc('ludmilla_email_mensagem_pendente' as never,
    { p_account_id: accountId, p_message_id: messageId, p_protocolo: protocolo } as never);
  if (error) throw new Error(`Não consegui conferir se a mensagem já foi tratada: ${error.message}`);
  return data === true;
}

/**
 * O que o banco respondeu ao pedido de abrir um anexo. As três respostas são
 * diferentes de propósito: eram duas (vazio e linha), e o vazio misturava
 * "já resolvido no card" com "o projeto não existe" — o log dizia a primeira
 * para as duas.
 */
export type AberturaDeAnexo =
  /** a linha está (ou voltou a ficar) `pendente`: é para subir o arquivo */
  | { situacao: 'aberto'; anexo: AnexoPendente }
  /** a linha já está `enviado` ou `bloqueado` NESTE projeto: nada a refazer */
  | { situacao: 'ja_resolvido' }
  /** o projeto não existe (apagado entre a listagem e o registro) ou não é da conta */
  | { situacao: 'projeto_inexistente' };

/**
 * Abre a linha do anexo e devolve o que `subirDocumento` precisa.
 *
 * A RPC devolve a linha DE NOVO quando ela tinha ficado `pendente` (run que
 * morreu antes de subir o arquivo) ou `erro` (storage recusou) — sem isso a
 * retentativa da mensagem não serviria para nada, porque o arquivo nunca
 * subiria. `enviado`/`bloqueado` voltam como `ja_resolvido`.
 *
 * O PROTOCOLO entra na chave do arquivo (`idArquivoDeEmail`): sem ele, um
 * e-mail que serve dois projetos colidia na UNIQUE e o documento ia para o card
 * do cliente errado. E a RPC devolve o `projeto_id` da linha justamente para
 * esta conferência: se não for o projeto que pedimos, isto estoura aqui, antes
 * de qualquer arquivo subir.
 *
 * `ocorrencia` desambigua arquivos de MESMO nome na mesma mensagem (1 = o
 * primeiro): sem ela o segundo colidia com o primeiro e sumia como "resolvido".
 */
export async function anexoDeEmail(
  accountId: string, protocolo: string, projectId: string, messageId: string, nomeArquivo: string, conferidoPor: string,
  ocorrencia = 1,
): Promise<AberturaDeAnexo> {
  const { data, error } = await supabase().rpc('ludmilla_email_anexo_novo' as never, {
    p_account_id: accountId, p_protocolo: protocolo, p_project_id: projectId,
    p_message_id: messageId, p_nome_arquivo: nomeArquivo, p_conferido_por: conferidoPor,
    p_ocorrencia: ocorrencia,
  } as never);
  if (error) throw new Error(`Não consegui abrir o anexo: ${error.message}`);
  const l = ((data ?? []) as {
    abertura: string; anexo_id: string | null; projeto_id: string | null; company_id: string | null; codigo: string | null;
  }[])[0];
  // A RPC responde SEMPRE uma linha. Vazio é função antiga no banco (de antes do
  // `abertura`): melhor estourar do que tratar o desconhecido como "resolvido".
  if (!l) throw new Error('o banco não respondeu ao pedido de abrir o anexo (a função ludmilla_email_anexo_novo está desatualizada?)');
  if (l.abertura === 'projeto_inexistente') return { situacao: 'projeto_inexistente' };
  if (l.projeto_id !== projectId) {
    // Nunca deve acontecer (a RPC já recusa), e é exatamente por isso que está
    // escrito: a alternativa é gravar documento no card de outro cliente.
    throw new Error(`a linha do anexo devolvida pelo banco é do projeto ${l.projeto_id}, e eu pedi ${projectId}`);
  }
  if (l.abertura === 'ja_resolvido') return { situacao: 'ja_resolvido' };
  if (l.abertura !== 'aberto' || !l.anexo_id || !l.company_id) {
    throw new Error(`resposta inesperada do banco ao abrir o anexo: ${l.abertura}`);
  }
  return {
    situacao: 'aberto',
    anexo: {
      id: l.anexo_id, project_id: l.projeto_id, company_id: l.company_id, protocolo,
      id_arquivo: idArquivoDeEmail(messageId, protocolo, nomeArquivo, ocorrencia),
      nome_arquivo: nomeArquivo, codigo: l.codigo ?? '',
    },
  };
}

export interface TentativaEmail {
  runId: string; accountId: string; messageId: string; protocolo: string;
  projectId: string | null; assunto: string; remetente: string; recebidoEm: string | null;
}

/**
 * Conta a tentativa ASSIM QUE a mensagem é aceita para tratamento — antes de
 * gastar a IA.
 *
 * Sem isto o teto de 5 tentativas só valia se o tratamento chegasse vivo até
 * `registrarEmailLido`: estourando antes (anexo com erro permanente, projeto
 * apagado entre a listagem e o registro), não existia linha, `tentativas` nunca
 * incrementava, e todo run seguinte baixava o corpo e **chamava a IA de novo** —
 * pagando o parecer indefinidamente, sem nada avisar.
 *
 * A linha nasce `concluida = false` (é o que faz o run seguinte tentar de novo,
 * correção C1) e os dados do tratamento são completados depois, por
 * `registrarEmailLido`. Devolve o número da tentativa.
 */
export async function abrirTentativaEmail(p: TentativaEmail): Promise<number> {
  const { data, error } = await supabase().rpc('ludmilla_email_tentativa' as never, {
    p_run_id: p.runId, p_account_id: p.accountId, p_message_id: p.messageId, p_protocolo: p.protocolo,
    p_project_id: p.projectId, p_assunto: p.assunto, p_remetente: p.remetente, p_recebido_em: p.recebidoEm,
  } as never);
  if (error) throw new Error(`Não consegui contar a tentativa desta mensagem: ${error.message}`);
  return Number(data ?? 0);
}

export interface EmailLido {
  runId: string; accountId: string; messageId: string; protocolo: string;
  projectId: string | null; assunto: string; remetente: string; recebidoEm: string | null;
  tipoDocumento: string | null; veredito: string | null; resumo: string | null;
  anexos: number; motivo: string | null; recomendacao: string | null;
  /**
   * `false` = houve falha passageira (a IA não respondeu, um anexo não subiu) e
   * um run futuro TEM de tentar de novo. `true` = não há mais nada a fazer com
   * esta mensagem. Quem CONTA a tentativa é `abrirTentativaEmail`, no começo do
   * tratamento (teto de 5); aqui a contagem não é mexida, senão a mesma
   * tentativa contaria duas vezes e o teto cairia para 2 e meia.
   */
  concluida: boolean;
  /** Qual anexo a IA leu (o PDF maior). Null quando não houve leitura. */
  arquivoLido: string | null;
}

export async function registrarEmailLido(p: EmailLido): Promise<void> {
  const { error } = await supabase().rpc('ludmilla_email_registrar' as never, {
    p_run_id: p.runId, p_account_id: p.accountId, p_message_id: p.messageId, p_protocolo: p.protocolo,
    p_project_id: p.projectId, p_assunto: p.assunto, p_remetente: p.remetente, p_recebido_em: p.recebidoEm,
    p_tipo_documento: p.tipoDocumento, p_veredito: p.veredito, p_resumo: p.resumo,
    p_anexos: p.anexos, p_motivo: p.motivo, p_recomendacao: p.recomendacao,
    p_concluida: p.concluida, p_arquivo_lido: p.arquivoLido,
  } as never);
  if (error) throw new Error(`Não consegui registrar o e-mail lido: ${error.message}`);
}
