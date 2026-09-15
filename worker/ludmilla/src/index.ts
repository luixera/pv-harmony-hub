import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { classificarErro } from './erros.js';
import { conector } from './conectores/index.js';
import {
  anexoEnviado, anexoErro, anexosPendentes, conectorDaConta, credenciais, entrarNaEstacao, finalizarRun, pegarRun,
  protocolosDeInteresse, pulsar, subirDocumento, subirPrint, subirTexto, Run,
} from './fila.js';
import { avisar, carregarEnvDaEstacao, dirPerfilChrome, modoAtual, pedirLoginNoTerminal } from './local.js';

/**
 * LUDMILLA — o laço.
 *
 * A cada N segundos pergunta à fila se há trabalho. Com run: abre um contexto
 * NOVO de navegador (nada de sessão vazando entre contas), executa o roteiro
 * do portal, grava resultado e print, fecha o contexto. Sem run: dorme.
 *
 * Dois modos, o mesmo laço:
 *  - VPS (padrão): service role, Chromium headless, contas `modo='vps'`.
 *  - local (LUDMILLA_MODO=local): máquina de pessoa (coworking), usuário
 *    operador, Chrome de verdade com janela e perfil por portal, contas
 *    `modo='local'`. É por onde a Elektro entra: a pessoa digita o CAPTCHA.
 *
 * Só leitura, sempre: a Ludmilla nunca envia formulário no portal, e nunca
 * tenta resolver CAPTCHA — quando encontra um, para e explica (ou, na
 * estação, chama a pessoa).
 */

const POLL_SEGUNDOS = Number(process.env.LUDMILLA_POLL_SECONDS ?? 30);
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Abre o contexto de navegador para um portal (chave do conector). */
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

async function executar(abrir: Abrir, run: Run): Promise<void> {
  let contexto: BrowserContext | undefined;
  let page: Page | undefined;
  let printPath: string | undefined;
  const print = async () => page ? subirPrint(run.tenant_id, run.id, await page.screenshot({ fullPage: true })) : undefined;
  try {
    const c = conector(await conectorDaConta(run.account_id));
    log('run iniciado', { run: run.id, tipo: run.tipo, portal: c.chave });
    contexto = await abrir(c.chave);
    page = contexto.pages()[0] ?? await contexto.newPage();

    if (run.tipo === 'reconhecimento') {
      const r = await c.reconhecer(page);
      printPath = await print();
      await finalizarRun(run.id, { situacao: 'ok', resultado: r, printPath });
      log('reconhecimento ok', { run: run.id, captcha: r.captcha, campos: r.campos.length, waf: r.bloqueado_por_waf });
      return;
    }

    // daqui em diante precisa de senha: lida só agora, morre com o contexto
    const creds = await credenciais(run.account_id);

    if (run.tipo === 'teste_login') {
      const v = await c.testarLogin(page, creds);
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
      return;
    }

    if (run.tipo === 'descoberta') {
      const arquivos: string[] = [];
      const d = await c.descobrir(page, creds, async t => {
        arquivos.push(await subirTexto(run.tenant_id, run.id, `${t.nome}.html`, t.html));
        if (t.rede) await subirTexto(run.tenant_id, run.id, `${t.nome}.rede.json`, JSON.stringify(t.rede, null, 1));
        if (t.png) await subirPrint(run.tenant_id, `${run.id}/${t.nome}`, t.png);
        if (t.api) await subirTexto(run.tenant_id, run.id, `${t.nome}.api.json`, JSON.stringify(t.api, null, 1));
      });
      printPath = await print();
      await finalizarRun(run.id, {
        situacao: 'ok', printPath, situacaoConta: 'ok',
        resultado: { telas: d.telas.map((t, k) => ({ nome: t.nome, url: t.url, arquivo: arquivos[k], bytes: t.html.length, requisicoes: t.rede?.length ?? 0 })) },
      });
      log('descoberta ok', { run: run.id, telas: d.telas.map(t => t.nome) });
      return;
    }

    const protocolos = await c.varrer(page, creds, { protocolosDeInteresse: await protocolosDeInteresse(run.account_id) });
    // print da tela onde a leitura terminou (a lista, na aba certa) — só a
    // janela, não a página inteira: é prova do caminho, não cópia da lista
    printPath = await subirPrint(run.tenant_id, run.id, await page.screenshot({ fullPage: false })).catch(() => undefined);
    await finalizarRun(run.id, {
      situacao: 'ok', resultado: { protocolos }, protocolos: protocolos.length, situacaoConta: 'ok', printPath,
    });
    log('varredura ok', { run: run.id, protocolos: protocolos.length });

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
  } finally {
    // no modo local isto fecha o Chrome inteiro — a janela só existe enquanto há trabalho
    await contexto?.close().catch(() => undefined);
  }
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
    abrir = contextoLocal;
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
    if (!run) { await dormir(POLL_SEGUNDOS * 1000); continue; }
    await executar(abrir, run);
    // pausa humana entre visitas — nunca martelar o portal
    await dormir(5_000);
  }
  if (batimento) clearInterval(batimento);
  await navegador?.close();
}

principal().catch(e => { log('caiu', { erro: (e as Error).message }); process.exit(1); });
