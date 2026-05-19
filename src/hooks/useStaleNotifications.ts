/**
 * useStaleNotifications
 *
 * Runs on mount (admin only) and once every 10 minutes.
 * For each stale project it creates a notification — but only if no
 * "stale" notification for that project was already created in the last 24 h,
 * to avoid flooding the bell.
 *
 * Strategy (client-side dedup):
 *   1. Fetch stale projects from the `stale_projects` view.
 *   2. For each one, check if there is already a notification with
 *      type = 'stale' AND project_id = <id> created in the last 24 h.
 *   3. If not, insert one for every admin/staff user.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useStaleProjects, StaleProject } from '@/hooks/useKanbanConfig';

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function notifyStaleProject(project: StaleProject) {
  const daysText = Math.floor(project.days_stale);
  const title = `Projeto parado: ${project.code}`;
  const message = `O projeto ${project.code} está na etapa "${project.status_label}" há ${daysText} dia${daysText !== 1 ? 's' : ''} sem movimentação.`;

  // 1. Check dedup — was a stale notification already sent in the last 24h?
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('type', 'stale')
    .eq('project_id', project.id)
    .gte('created_at', since)
    .limit(1);

  if (existing && existing.length > 0) return; // Already notified recently

  // 2. Get all admin + staff user IDs
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, role')
    .in('role', ['admin', 'staff']);

  if (!profiles || profiles.length === 0) return;

  // 3. Insert one notification per user
  const rows = profiles.map((p) => ({
    user_id: p.id,
    title,
    message,
    type: 'stale',
    project_id: project.id,
  }));

  await supabase.from('notifications').insert(rows);
}

export function useStaleNotifications() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: staleProjects = [] } = useStaleProjects();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isAdmin) return;
    if (staleProjects.length === 0) return;

    const run = async () => {
      for (const project of staleProjects) {
        try {
          await notifyStaleProject(project);
        } catch (err) {
          console.warn('[useStaleNotifications] Error notifying project', project.code, err);
        }
      }
    };

    // Run immediately on first mount with data
    if (!ranRef.current) {
      ranRef.current = true;
      run();
    }

    // Then repeat on interval
    const timer = setInterval(run, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAdmin, staleProjects]);
}
