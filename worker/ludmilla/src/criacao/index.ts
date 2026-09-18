import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classificarErro, ErroLudmilla } from '../erros.js';
import { credenciais, dadosCriacaoCpfl, finalizarRun, subirTexto, supabase, type Run } from '../fila.js';
import { Agente } from './agente.js';
import { JS_MAPA } from './js.js';
import { entrarNaCpfl } from './login.js';
import { roteiroCpfl60, type NomePasso, type StatusPasso } from './roteiro-cpfl60.js';
import type { DadosCriacaoCpfl } from './tipos.js';

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

export function agenteDoAmbiente(sessao: string): Agente {
  return new Agente({
    sessao,
    headed: process.env.LUDMILLA_AB_HEADED === '1',
    perfil: process.env.LUDMILLA_AB_PERFIL || undefined,
    executavel: process.env.LUDMILLA_AB_EXEC || undefined,
    argsChrome: process.env.LUDMILLA_AB_ARGS || undefined,
  });
}

/** Print da tela → bucket (pasta do run) → caminho. */
async function printParaBucket(ag: Agente, caminho: string, nomeTmp: string): Promise<string | undefined> {
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
function registradorDePassos(ag: Agente, dados: DadosCriacaoCpfl) {
  return async (passo: number, nome: NomePasso, status: StatusPasso, erro?: string): Promise<void> => {
    // "rodando" = a tela ANTES do passo; ok/erro = a tela DEPOIS. Os dois ficam no bucket.
    const sufixo = status === 'rodando' ? '-inicio' : '';
    const printPath = await printParaBucket(ag, `${dados.tenant_id}/criacao/${dados.run_id}/passo-${passo}${sufixo}.png`, `ludmilla-${dados.run_id}-${passo}${sufixo}.png`);
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

export async function executarCriacao(run: Run): Promise<void> {
  const curto = run.id.slice(0, 8);
  const ag = agenteDoAmbiente(`criacao-${curto}`);
  const nomeCofre = `cpfl-${curto}`;
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
    const printExtra = (nome: string) => printParaBucket(ag, `${dados.tenant_id}/criacao/${dados.run_id}/${nome}.png`, `ludmilla-${dados.run_id}-${nome}.png`).then(() => undefined);
    await registrar(0, 'login', 'rodando');
    try {
      await entrarNaCpfl(ag, creds, nomeCofre, log, printExtra);
    } catch (e) {
      const msg = e instanceof ErroLudmilla ? e.message : `Login falhou: ${(e as Error).message.split('\n')[0].slice(0, 300)}`;
      await registrar(0, 'login', 'erro', msg).catch(() => undefined);
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
    await ag.authApagar(nomeCofre).catch(() => undefined);
    await ag.fechar().catch(() => undefined);
  }
}
