import { supabase } from '@/integrations/supabase/client';

// Estado de tracking em memória (setado pelo AccessTracker após o login)
let sessionId: string | null = null;
let userId: string | null = null;
let tenantId: string | null = null;

export function setTrackingIdentity(uid: string | null, tid: string | null) {
  userId = uid;
  tenantId = tid ?? null;
}

/** Registra a sessão de acesso (IP + geolocalização) uma vez por login. */
export async function startSession() {
  if (sessionId) return;
  const stored = sessionStorage.getItem('access_session_id');
  if (stored) { sessionId = stored; return; }
  try {
    const { data } = await supabase.functions.invoke('log-session');
    if (data?.sessionId) {
      sessionId = data.sessionId as string;
      sessionStorage.setItem('access_session_id', sessionId);
    }
  } catch { /* silencioso — não atrapalha o login */ }
}

export function clearSession() {
  sessionId = null;
  sessionStorage.removeItem('access_session_id');
}

/** Registra uma navegação (clickstream). */
export async function logPageView(path: string) {
  if (!userId) return;
  try {
    await supabase.from('page_views' as never).insert({
      session_id: sessionId, user_id: userId, tenant_id: tenantId, path,
    } as never);
  } catch { /* silencioso */ }
}

/** Registra um evento de uso (ex.: package_download, doc_generated). */
export async function logEvent(type: string, meta: Record<string, unknown> = {}) {
  if (!userId) return;
  try {
    await supabase.from('activity_events' as never).insert({
      user_id: userId, tenant_id: tenantId, type, meta,
    } as never);
  } catch { /* silencioso */ }
}
