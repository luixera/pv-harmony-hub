import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classificarErro, ErroLudmilla } from '../erros.js';
import { credenciais, dadosCriacaoCpfl, finalizarRun, subirTexto, supabase, type Run } from '../fila.js';
import type { BrowserContext } from 'playwright';
import type { Navegador } from './navegador.js';
import { logarNaCpfl } from '../conectores/cpfl.js';
import { AgentePlaywright } from './navegador.js';
import { JS_MAPA } from './js.js';

import { roteiroCpfl60, type NomePasso, type StatusPasso } from './roteiro-cpfl60.js';
import { type DadosCriacaoCpfl } from './tipos.js';

/**
 * Run `criar_projeto`: da fila até o projeto salvo na CPFL, pela CLI
 * agent-browser (sessão própria por run, headless na VPS). Independente do
 * Playwright da varredura — que não muda.
 *
 * Variáveis de ambiente (VPS, /etc/ludmilla/env):
 *   LUDMILLA_AB_EXEC   caminho do Chrome/Chromium (opcional)
 *   LUDMILLA_AB_ARGS   argumentos do Chrome, separados por vírgula (opcional)
 *   LUDMILLA_AB_HEADED 1 = com janela (estação/validação)
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/** Entrada do portal: o B2C devolve em /Internet/Projeto, onde fica o cartão de perfil. */
const LOGIN_URL = 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto';

/**
 * Prova de sessão DENTRO do app de projetos: o menu "GERENCIE SEUS PROJETOS"
 * ou o link "Sair". Sem esta checagem, "Olá Usuário" + "Você não tem acesso a
 * essa página" passava por login bem-sucedido (incidente de 18/09 a 12/10).
 */
const JS_AUTENTICADO = `(() => {
  const t = (document.body.textContent || '');
  if (/Access denied|Acesso negado/i.test(document.title)) return false;
  return /GERENCIE SEUS PROJETOS/i.test(t) || !!Array.from(document.querySelectorAll('a')).find(a => /^\\s*Sair\\s*$/i.test(a.textContent || ''));
})()`;



/** Print da tela → bucket (pasta do run) → caminho. */
async function printParaBucket(ag: Navegador, caminho: string, nomeTmp: string): Promise<string | undefined> {
  const tmp = join(tmpdir(), nomeTmp);
  try {
    await ag.screenshot(tmp);
    const png = await readFile(tmp);
    const { error } = await supabase().storage.from('ludmilla').upload(caminho, png, { contentType: 'image/png', upsert: true });
    return error ? undefined : caminho;
  } catch {
    return undefined;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/** Grava cada passo em portal_criacao_passos com print; em erro, sobe também o mapa da tela. */
function registradorDePassos(ag: Navegador, dados: DadosCriacaoCpfl) {
  return async (passo: number, nome: NomePasso, status: StatusPasso, erro?: string, printPronto?: string): Promise<void> => {
    // "rodando" = a tela ANTES do passo; ok/erro = a tela DEPOIS. Os dois ficam no bucket.
    const sufixo = status === 'rodando' ? '-inicio' : '';
    const printPath = printPronto
      ?? await printParaBucket(ag, `${dados.tenant_id}/criacao/${dados.run_id}/passo-${passo}${sufixo}.png`, `ludmilla-${dados.run_id}-${passo}${sufixo}.png`);
    if (status === 'erro') {
      try {
        const mapa = await ag.js(JS_MAPA);
        await subirTexto(dados.tenant_id, dados.run_id, `criacao-passo-${passo}.campos.json`, JSON.stringify(mapa, null, 1));
      } catch { /* diagnóstico é bônus */ }
    }
    const { error } = await supabase().rpc('ludmilla_registrar_passo_criacao' as never, {
      p_run_id: dados.run_id, p_passo: passo, p_nome: nome, p_status: status,
      p_screenshot: printPath ?? null, p_erro: erro ?? null,
    } as never);
    if (error) throw new Error(`registrar passo: ${error.message}`);
  };
}

/**
 * Run `criar_projeto` — roda no MESMO navegador da varredura.
 *
 * Até 13/10/2026 a criação abria a CLI `agent-browser`. O portal recusa essa
 * CLI a partir da VPS: a navegação para `gestao-projetos` volta vazia
 * (`ERR_HTTP_RESPONSE_CODE_FAILURE`) mesmo com os 21 cookies da sessão da
 * varredura dentro do navegador — e a varredura, no mesmo IP e com a mesma
 * conta, entra sem tropeço 2×/dia. O roteiro não mudou: ele fala com a
 * interface `Navegador` (ver navegador.ts), e quem a cumpre agora é o
 * Playwright.
 */
export async function executarCriacao(run: Run, contexto: BrowserContext): Promise<void> {
  const ag = await AgentePlaywright.noContexto(contexto);
  log('criação iniciada', { run: run.id });
  try {
    const projectId = run.dados?.['project_id'] as string | undefined;
    if (!projectId) throw new ErroLudmilla('falhou', 'Run criar_projeto sem project_id nos dados.');

    const simular = run.dados?.['simular'] === true;
    const { data: proj } = await supabase().from('projects').select('cpfl_node_id').eq('id', projectId).maybeSingle();
    const nodeExistente = (proj as { cpfl_node_id?: string | null } | null)?.cpfl_node_id;
    if (nodeExistente && !simular) throw new ErroLudmilla('falhou', `Este projeto já está registrado na CPFL (projeto nº ${nodeExistente}). Não vou criar outro.`);

    const autonomiaRun = (run.dados?.['autonomia'] ?? {}) as Record<string, string>;
    const dados = await dadosCriacaoCpfl(run.id, projectId, run.tenant_id, autonomiaRun);
    const creds = await credenciais(run.account_id);

    // Passo 0 = login: aparece no painel com print, como os outros. Prints de
    // cada estágio (chegada do B2C, tela de perfil) ficam na pasta do run.
    const registrar = registradorDePassos(ag, dados);
    let ultimoPrintDoLogin: string | undefined;
    const printExtra = async (nome: string) => {
      const p = await printParaBucket(ag, `${dados.tenant_id}/criacao/${dados.run_id}/${nome}.png`, `ludmilla-${dados.run_id}-${nome}.png`);
      if (p) ultimoPrintDoLogin = p;
    };
    await registrar(0, 'login', 'rodando');
    try {
      // O MESMO login da varredura, na mesma aba: se quebrar, quebra para os
      // dois e a correção é num lugar só.
      await logarNaCpfl(ag.page, creds, LOGIN_URL);
      await printExtra('login-1-portal');
      const autenticado = await ag.js<boolean>(JS_AUTENTICADO).catch(() => false);
      if (!autenticado) {
        throw new ErroLudmilla('sessao_expirada',
          `Entrei na CPFL mas o portal não reconheceu a sessão ("${await ag.titulo()}").`);
      }
    } catch (e) {
      const msg = e instanceof ErroLudmilla ? e.message : `Login falhou: ${(e as Error).message.split('\n')[0].slice(0, 300)}`;
      // o print útil é o último estágio antes da falha (chegada do B2C / tela de perfil), não o "Access denied"
      await registrar(0, 'login', 'erro', msg, ultimoPrintDoLogin).catch(() => undefined);
      throw e;
    }
    await registrar(0, 'login', 'ok');

    const resultado = await roteiroCpfl60({ agente: ag, dados, log, registrar, simular });

    if (resultado.nodeId) {
      const { error } = await supabase().rpc('ludmilla_salvar_node_cpfl' as never, { p_project_id: projectId, p_node_id: resultado.nodeId } as never);
      if (error) throw new Error(`ludmilla_salvar_node_cpfl: ${error.message}`);
    }
    const printPath = await printParaBucket(ag, `${run.tenant_id}/${run.id}.png`, `ludmilla-${run.id}-final.png`);
    await finalizarRun(run.id, { situacao: 'ok', printPath, resultado: { node: resultado.nodeId, simulado: resultado.simulado, leituras: resultado.leituras } });
    log('criação ok', { run: run.id, node: resultado.nodeId, simulado: resultado.simulado });
  } catch (e) {
    const erro = classificarErro(e);
    const printPath = await printParaBucket(ag, `${run.tenant_id}/${run.id}.png`, `ludmilla-${run.id}-final.png`).catch(() => undefined);
    await finalizarRun(run.id, {
      situacao: 'erro', erro: erro.mensagem, printPath,
      // erro de formulário não é erro da conta: só login/sessão mudam a situação da conta
      situacaoConta: erro.situacaoConta === 'ok' ? undefined : erro.situacaoConta,
    }).catch(err => log('não consegui fechar o run', { erro: (err as Error).message }));
    log('criação com erro', { run: run.id, classe: erro.classe, mensagem: erro.mensagem });
  } finally {
    // fecha só a ABA; o contexto é do laço da varredura e segue vivo
    await ag.fechar().catch(() => undefined);
  }
}
