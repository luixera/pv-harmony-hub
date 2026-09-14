import { chromium, Browser, BrowserContext } from 'playwright';
import { classificarErro } from './erros.js';
import { conector } from './conectores/index.js';
import { conectorDaConta, credenciais, finalizarRun, pegarRun, subirPrint, Run } from './fila.js';

/**
 * LUDMILLA — o laço.
 *
 * A cada N segundos pergunta à fila se há trabalho. Com run: abre um contexto
 * NOVO de navegador (nada de sessão vazando entre contas), executa o roteiro
 * do portal, grava resultado e print, fecha o contexto. Sem run: dorme.
 *
 * Só leitura, sempre: a Ludmilla nunca envia formulário no portal, e nunca
 * tenta resolver CAPTCHA — quando encontra um, para e explica.
 */

const POLL_SEGUNDOS = Number(process.env.LUDMILLA_POLL_SECONDS ?? 30);
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Contexto com cara de Chrome comum em português — o portal vê um navegador normal. */
async function novoContexto(navegador: Browser): Promise<BrowserContext> {
  return navegador.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });
}

async function executar(navegador: Browser, run: Run): Promise<void> {
  const contexto = await novoContexto(navegador);
  const page = await contexto.newPage();
  let printPath: string | undefined;
  try {
    const c = conector(await conectorDaConta(run.account_id));
    log('run iniciado', { run: run.id, tipo: run.tipo, portal: c.chave });

    if (run.tipo === 'reconhecimento') {
      const r = await c.reconhecer(page);
      printPath = await subirPrint(run.tenant_id, run.id, await page.screenshot({ fullPage: true }));
      await finalizarRun(run.id, { situacao: 'ok', resultado: r, printPath });
      log('reconhecimento ok', { run: run.id, captcha: r.captcha, campos: r.campos.length, waf: r.bloqueado_por_waf });
      return;
    }

    // daqui em diante precisa de senha: lida só agora, morre com o contexto
    const creds = await credenciais(run.account_id);

    if (run.tipo === 'teste_login') {
      const v = await c.testarLogin(page, creds);
      printPath = await subirPrint(run.tenant_id, run.id, await page.screenshot({ fullPage: true }));
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

    const protocolos = await c.varrer(page, creds);
    await finalizarRun(run.id, {
      situacao: 'ok', resultado: { protocolos }, protocolos: protocolos.length, situacaoConta: 'ok',
    });
    log('varredura ok', { run: run.id, protocolos: protocolos.length });
  } catch (e) {
    const erro = classificarErro(e);
    try {
      printPath = printPath ?? await subirPrint(run.tenant_id, run.id, await page.screenshot({ fullPage: true }));
    } catch { /* sem print é melhor do que sem fechamento */ }
    await finalizarRun(run.id, {
      situacao: 'erro', erro: erro.mensagem, printPath,
      situacaoConta: erro.situacaoConta === 'ok' ? undefined : erro.situacaoConta,
    });
    log('run com erro', { run: run.id, classe: erro.classe, mensagem: erro.mensagem });
  } finally {
    await contexto.close();
  }
}

async function principal() {
  log('ludmilla no ar', { poll: POLL_SEGUNDOS });
  const navegador = await chromium.launch({ headless: true });
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
    await executar(navegador, run);
    // pausa humana entre visitas — nunca martelar o portal
    await dormir(5_000);
  }
  await navegador.close();
}

principal().catch(e => { log('caiu', { erro: (e as Error).message }); process.exit(1); });
