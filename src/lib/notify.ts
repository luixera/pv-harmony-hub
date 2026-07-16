import { supabase } from '@/integrations/supabase/client';

/** Dispara as automações de um evento (fire-and-forget; não bloqueia o fluxo). */
export async function dispatchNotification(projectId: string, event: string) {
  try {
    await supabase.functions.invoke('notify-dispatch', { body: { projectId, event } });
  } catch (e) {
    console.error('dispatchNotification', e);
  }
}
