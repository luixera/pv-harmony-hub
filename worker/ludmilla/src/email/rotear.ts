// worker/ludmilla/src/email/rotear.ts
import { contaDoEmail, finalizarRun, type Run } from '../fila.js';
import { modoAtual } from '../local.js';
import { executarVarreduraEnel } from './enel/run.js';
import { executarVarreduraEmail } from './index.js';

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/**
 * O run `varredura_email` tem dois modos, escolhidos pela CONTA:
 *  · protocolo_no_assunto (EDP) → `executarVarreduraEmail`, que NÃO foi alterado;
 *  · remetente (ENEL)           → `executarVarreduraEnel`.
 * Nada escapa daqui: o laço principal chama sem try, e exceção que escapasse
 * mataria o processo (`principal().catch` faz `process.exit(1)`).
 */
export async function executarAcompanhamentoEmail(run: Run): Promise<void> {
  // na estação local, o caminho de sempre recusa com a explicação
  if (modoAtual() === 'local') return executarVarreduraEmail(run);
  let conta: Awaited<ReturnType<typeof contaDoEmail>>;
  try {
    conta = await contaDoEmail(run.account_id);
  } catch (e) {
    log('não consegui ler a configuração da conta de e-mail', { nivel: 'falha', run: run.id, erro: (e as Error).message });
    await finalizarRun(run.id, { situacao: 'erro', erro: `Não consegui ler a configuração da conta: ${(e as Error).message}` })
      .catch(() => undefined);
    return;
  }
  // a ENEL busca numa janela fixa de 30 dias: `ultimaVarreduraEm` não muda mais nada nela
  if (conta.identificacao === 'remetente') return executarVarreduraEnel(run);
  return executarVarreduraEmail(run);
}
