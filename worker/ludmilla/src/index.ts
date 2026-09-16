import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { classificarErro, ErroLudmilla } from './erros.js';
import { conector, type CanalCaptcha, type Conector } from './conectores/index.js';
import {
  anexoEnviado, anexoErro, anexosPendentes, conectorDaConta, credenciais, dadosCriacaoCpfl, entrarNaEstacao, fecharCaptcha, finalizarRun,
  lerCaptcha, pedirCaptcha, pegarRun, protocolosDeInteresse, pulsar, sessaoViva, subirDocumento, subirPrint, subirTexto, temCriacaoPendente, Run,
} from './fila.js';
import { criarProjeto } from './conectores/cpfl-criar.js';
import { avisar, carregarEnvDaEstacao, dirPerfilChrome, modoAtual, pedirLoginNoTerminal } from './local.js';

/**
 * LUDMILLA — o laço.
 *
 * A cada N segundos pergunta à fila se há trabalho. Com run: abre um contexto
 * de navegador, executa o roteiro do portal, grava resultado e print. Sem
 * run: dorme.
 *
 * Dois modos, o mesmo laço:
 *  - VPS (padrão): service role, Chromium headless, contas `modo='vps'`,
 *    contexto NOVO por run (nada de sessão vazando entre contas).
 *  - local (LUDMILLA_MODO=local): máquina de pessoa (coworking), usuário
 *    operador, Chrome de verdade com janela e perfil por portal, contas
 *    `modo='local'`. É por onde a Elektro entra: a pessoa digita o código da
 *    imagem — no PC ou de longe, pela /ludmilla. Portal que sabe `manterViva`
 *    fica com o Chrome aberto entre visitas (sessão viva): o código só volta
 *    a ser pedido quando o servidor derruba a sessão.
 *
 * Só leitura, sempre: a Ludmilla nunca envia formulário no portal além do
 * login, e nunca tenta resolver CAPTCHA — quem resolve é uma pessoa.
 */

const POLL_SEGUNDOS = Number(process.env.LUDMILLA_POLL_SECONDS ?? 30);
const TOQUE_MINUTOS = Number(process.env.LUDMILLA_SESSAO_VIVA_MIN ?? 10);
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Abre (ou reaproveita) o contexto de navegador para um portal (chave do conector). */
type Abrir = (chave: string) => Promise<BrowserContext>;

/** VPS: contexto com cara de Chrome comum em português — o portal vê um navegador normal. */
async function novoContexto(navegador: Browser): Promise<BrowserContext> {
  return navegador.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });
}

/**
 * Estação: o Chrome instalado na máquina, com janela, num perfil só da
 * Ludmilla e separado por portal (cookies de um nunca encostam no outro).
 * A pessoa vê a tela e digita o CAPTCHA quando o robô pedir.
 */
async function contextoLocal(chave: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(dirPerfilChrome(chave), {
    channel: 'chrome',
    headless: false,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: null,
    args: ['--window-size=1366,860'],
  });
}

/** Sessões vivas da estação: um Chrome aberto por portal, tocado de tempos em tempos. */
interface SessaoViva { contexto: BrowserContext; conector: Conector; accountId: string; desde: number; ultimoToque: number }
const vivas = new Map<string, SessaoViva>();

async function encerrarViva(chave: string, motivo: string) {
  const v = vivas.get(chave);
  if (!v) return;
  vivas.delete(chave);
  log('sessão no portal encerrada', { portal: chave, motivo, durou_min: Math.round((Date.now() - v.desde) / 60_000) });
  await sessaoViva(v.accountId, false);
  await v.contexto.close().catch(() => undefined);
}

/** Toca os portais com sessão viva; quem já não está logado é fechado. */
async function tocarVivas() {
  for (const [chave, v] of [...vivas.entries()]) {
    if (Date.now() - v.ultimoToque < TOQUE_MINUTOS * 60_000) continue;
    const page = v.contexto.pages()[0];
    const continua = page && v.conector.manterViva ? await v.conector.manterViva(page).catch(() => false) : false;
    if (continua) {
      v.ultimoToque = Date.now();
      log('sessão no portal continua viva', { portal: chave, ha_min: Math.round((Date.now() - v.desde) / 60_000) });
    } else {
      await encerrarViva(chave, 'o portal pediu login de novo');
    }
  }
}

/** O que sobra de um run para o laço decidir o destino do navegador. */
interface Fim { chave: string; contexto: BrowserContext; page?: Page; conector: Conector; ok: boolean }

/** Canal pelo qual a equipe responde o código da imagem deste run (pela /ludmilla). */
const canalDoRun = (run: Run): CanalCaptcha => ({
  pedir: (png, tentativa, mensagem) => pedirCaptcha(run, png, tentativa, mensagem),
  ler: lerCaptcha,
  fechar: fecharCaptcha,
});

async function executar(abrir: Abrir, run: Run): Promise<Fim | null> {
  let contexto: BrowserContext | undefined;
  let page: Page | undefined;
  let c: Conector | undefined;
  let printPath: string | undefined;
  let ok = false;
  const print = async () => page ? subirPrint(run.tenant_id, run.id, await page.screenshot({ fullPage: true })) : undefined;
  const captcha = canalDoRun(run);
  try {
    c = conector(await conectorDaConta(run.account_id));
    log('run iniciado', { run: run.id, tipo: run.tipo, portal: c.chave });
    contexto = await abrir(c.chave);
    page = contexto.pages()[0] ?? await contexto.newPage();

    if (run.tipo === 'reconhecimento') {
      const r = await c.reconhecer(page);
      printPath = await print();
      await finalizarRun(run.id, { situacao: 'ok', resultado: r, printPath });
      log('reconhecimento ok', { run: run.id, captcha: r.captcha, campos: r.campos.length, waf: r.bloqueado_por_waf });
      return { chave: c.chave, contexto, page, conector: c, ok: false }; // reconhecimento não entra: nada a manter
    }

    // daqui em diante precisa de senha: lida só agora, morre com o contexto
    const creds = await credenciais(run.account_id);

    if (run.tipo === 'teste_login') {
      const v = await c.testarLogin(page, creds, { captcha });
      printPath = await print();
      // senha recusada é erro da CONTA (fica em ultimo_erro); o resto é informação
      const recusada = v.veredito === 'senha_recusada';
      await finalizarRun(run.id, {
        situacao: recusada ? 'erro' : 'ok',
        resultado: v, printPath,
        erro: recusada ? v.explicacao : undefined,
        situacaoConta: recusada ? 'erro' : v.veredito === 'entrou' ? 'ok' : undefined,
      });
      log('teste de login', { run: run.id, veredito: v.veredito });
      ok = v.veredito === 'entrou';
      return { chave: c.chave, contexto, page, conector: c, ok };
    }

    if (run.tipo === 'descoberta') {
      const arquivos: string[] = [];
      const d = await c.descobrir(page, creds, async t => {
        arquivos.push(await subirTexto(run.tenant_id, run.id, `${t.nome}.html`, t.html));
        if (t.rede) await subirTexto(run.tenant_id, run.id, `${t.nome}.rede.json`, JSON.stringify(t.rede, null, 1));
        if (t.png) await subirPrint(run.tenant_id, `${run.id}/${t.nome}`, t.png);
        if (t.api) await subirTexto(run.tenant_id, run.id, `${t.nome}.api.json`, JSON.stringify(t.api, null, 1));
      }, { captcha });
      printPath = await print();
      await finalizarRun(run.id, {
        situacao: 'ok', printPath, situacaoConta: 'ok',
        resultado: { telas: d.telas.map((t, k) => ({ nome: t.nome, url: t.url, arquivo: arquivos[k], bytes: t.html.length, requisicoes: t.rede?.length ?? 0 })) },
      });
      log('descoberta ok', { run: run.id, telas: d.telas.map(t => t.nome) });
      ok = true;
      return { chave: c.chave, contexto, page, conector: c, ok };
    }

    if (run.tipo === 'criar_projeto') {
      const projectId = run.dados?.['project_id'] as string | undefined;
      if (!projectId) throw new ErroLudmilla('falhou', 'Run criar_projeto sem project_id nos dados.');
      const dadosCriacao = await dadosCriacaoCpfl(run.id, projectId, run.tenant_id);
      await criarProjeto(page, dadosCriacao);
      printPath = await print();
      await finalizarRun(run.id, { situacao: 'ok', printPath, situacaoConta: 'ok' });
      log('criação CPFL ok', { run: run.id, project: projectId });
      ok = true;
      return { chave: c.chave, contexto, page, conector: c, ok };
    }

    const protocolos = await c.varrer(page, creds, { protocolosDeInteresse: await protocolosDeInteresse(run.account_id), captcha });
    // print da tela onde a leitura terminou (a lista, na aba certa) — só a
    // janela, não a página inteira: é prova do caminho, não cópia da lista
    printPath = await subirPrint(run.tenant_id, run.id, await page.screenshot({ fullPage: false })).catch(() => undefined);
    await finalizarRun(run.id, {
      situacao: 'ok', resultado: { protocolos }, protocolos: protocolos.length, situacaoConta: 'ok', printPath,
    });
    log('varredura ok', { run: run.id, protocolos: protocolos.length });
    ok = true;

    // Anexos: o fechamento do run já decidiu (no banco) quais arquivos podem
    // ir para qual card — projeto casado pelo número E titular/UC conferidos.
    // Com a sessão do portal ainda aberta, baixa e coloca no card.
    if (c.baixarAnexo) {
      const pendentes = await anexosPendentes(run.account_id).catch(e => { log('anexos indisponíveis', { erro: (e as Error).message }); return []; });
      let enviados = 0;
      for (const a of pendentes) {
        try {
          const bytes = await c.baixarAnexo(page, a.id_arquivo);
          if (!bytes || bytes.length < 100) { await anexoErro(a.id, 'O portal não devolveu o conteúdo do arquivo.'); continue; }
          const mime = /\.pdf$/i.test(a.nome_arquivo) ? 'application/pdf' : 'application/octet-stream';
          const path = await subirDocumento(a, bytes, mime);
          await anexoEnviado(a.id, path, mime);
          enviados++;
          log('anexo no card', { projeto: a.codigo, arquivo: a.nome_arquivo });
        } catch (e) {
          await anexoErro(a.id, (e as Error).message);
          log('anexo falhou', { projeto: a.codigo, arquivo: a.nome_arquivo, erro: (e as Error).message });
        }
        await dormir(600);
      }
      if (pendentes.length > 0) log('anexos', { pedidos: pendentes.length, enviados });
    }
    return { chave: c.chave, contexto, page, conector: c, ok };
  } catch (e) {
    const erro = classificarErro(e);
    try {
      printPath = printPath ?? await print();
    } catch { /* sem print é melhor do que sem fechamento */ }
    await finalizarRun(run.id, {
      situacao: 'erro', erro: erro.mensagem, printPath,
      situacaoConta: erro.situacaoConta === 'ok' ? undefined : erro.situacaoConta,
    });
    log('run com erro', { run: run.id, classe: erro.classe, mensagem: erro.mensagem });
    return contexto && c ? { chave: c.chave, contexto, page, conector: c, ok: false } : null;
  }
}

/**
 * Destino do navegador depois do run. VPS: fecha sempre. Estação: se o portal
 * sabe manter a sessão e o run entrou, o Chrome fica aberto (sessão viva);
 * senão fecha — no modo local isto fecha o Chrome inteiro, a janela só
 * existe enquanto há trabalho ou sessão.
 */
async function destino(fim: Fim | null, modo: 'vps' | 'local', accountId: string) {
  if (!fim) return;
  const { chave, contexto, page, conector: c, ok } = fim;
  if (modo === 'local' && c.manterViva && ok && page) {
    const continua = await c.manterViva(page).catch(() => false);
    if (continua) {
      const jaViva = vivas.get(chave);
      vivas.set(chave, { contexto, conector: c, accountId, desde: jaViva?.desde ?? Date.now(), ultimoToque: Date.now() });
      await sessaoViva(accountId, true);
      log('sessão no portal viva', { portal: chave });
      return;
    }
  }
  vivas.delete(chave);
  await sessaoViva(accountId, false);
  await contexto.close().catch(() => undefined);
}

/** `node dist/index.js --login`: primeira vez na estação — grava a sessão do operador. */
async function loginDaEstacao(): Promise<void> {
  if (modoAtual() !== 'local') throw new Error('--login é só para a estação local (LUDMILLA_MODO=local).');
  const email = await entrarNaEstacao(await pedirLoginNoTerminal());
  log('estação entrou no GD Manager', { usuario: email });
  console.log(`Pronto: a estação vai trabalhar como ${email}. A sessão fica guardada nesta máquina.`);
}

async function principal() {
  const modo = modoAtual();
  if (modo === 'local') carregarEnvDaEstacao();
  if (process.argv.includes('--login')) { await loginDaEstacao(); return; }

  log('ludmilla no ar', { poll: POLL_SEGUNDOS, modo });
  let abrir: Abrir;
  let navegador: Browser | null = null;
  let batimento: NodeJS.Timeout | null = null;
  if (modo === 'local') {
    // sessão do usuário operador (gravada pelo --login); as RPCs _local checam quem é
    let email: string;
    try {
      email = await entrarNaEstacao();
    } catch (e) {
      avisar('Ludmilla parada', (e as Error).message);
      throw e;
    }
    log('estação pronta', { usuario: email });
    await pulsar();
    batimento = setInterval(() => { void pulsar(); }, 60_000);
    // sessão viva: o próximo run do mesmo portal reaproveita o Chrome aberto
    abrir = async chave => vivas.get(chave)?.contexto ?? contextoLocal(chave);
  } else {
    // Headless shell. O Chromium completo (channel 'chromium') cai com SIGTRAP no
    // crashpad sob o endurecimento do systemd; e a leitura dos portais é pela
    // API interna, não pela tela renderizada.
    const n = await chromium.launch({ headless: true });
    navegador = n;
    abrir = () => novoContexto(n);
  }
  let parar = false;
  const encerrar = () => { parar = true; log('encerrando'); };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);

  while (!parar) {
    let run: Run | null = null;
    try {
      run = await pegarRun();
    } catch (e) {
      log('fila indisponível', { erro: (e as Error).message });
    }
    if (!run) {
      if (modo === 'local') await tocarVivas();
      // Poll dinâmico: 5 s quando há criação pendente; normal quando quieto
      const criacao = await temCriacaoPendente().catch(() => false);
      await dormir(criacao ? 5_000 : POLL_SEGUNDOS * 1_000);
      continue;
    }
    const fim = await executar(abrir, run);
    await destino(fim, modo, run.account_id);
    // pausa humana entre visitas — nunca martelar o portal
    await dormir(5_000);
  }
  if (batimento) clearInterval(batimento);
  for (const chave of [...vivas.keys()]) await encerrarViva(chave, 'a estação está parando');
  await navegador?.close();
}

principal().catch(e => { log('caiu', { erro: (e as Error).message }); process.exit(1); });
