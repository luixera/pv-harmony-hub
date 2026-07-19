import { supabase } from '@/integrations/supabase/client';

/**
 * Envio de eventos de observabilidade (erros e segurança) para o painel.
 *
 * Regras desta camada:
 *  - nunca lançar: registrar log não pode quebrar a tela do usuário;
 *  - nunca bloquear: todas as chamadas são "dispare e esqueça";
 *  - nunca mandar senha ou token — só mensagem, rota e contexto.
 */

/** Evita inundar o servidor com o mesmo erro repetido (ex.: loop de render). */
const enviadosRecentemente = new Map<string, number>();
const JANELA_REPETICAO_MS = 60_000;

function repetido(chave: string): boolean {
  const agora = Date.now();
  const anterior = enviadosRecentemente.get(chave);
  if (anterior && agora - anterior < JANELA_REPETICAO_MS) return true;
  enviadosRecentemente.set(chave, agora);
  if (enviadosRecentemente.size > 100) enviadosRecentemente.clear();
  return false;
}

type AcaoSistema =
  | 'login_failed'
  | 'frontend_error'
  | 'frontend_crash'
  | 'forbidden_access'
  | 'invalid_form_token';

export async function logSystemEvent(
  action: AcaoSistema,
  message: string,
  metadata: Record<string, unknown> = {},
) {
  const chave = `${action}|${message}`.slice(0, 200);
  if (repetido(chave)) return;
  try {
    await supabase.functions.invoke('log-event', {
      body: {
        action,
        message: String(message).slice(0, 1000),
        route: typeof window !== 'undefined' ? window.location.pathname : null,
        metadata,
      },
    });
  } catch { /* silencioso por definição */ }
}

/** Captura erros que escapam de qualquer try/catch da aplicação. */
export function installGlobalErrorLogging() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    // Erros de carregamento de imagem/script não têm mensagem útil.
    if (!e.message) return;
    void logSystemEvent('frontend_error', e.message, {
      arquivo: e.filename, linha: e.lineno, coluna: e.colno,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const motivo = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '');
    if (!motivo) return;
    void logSystemEvent('frontend_error', motivo, { tipo: 'promise_rejeitada' });
  });
}
