import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── TIPOS ─────────────────────────────────────────────────────────────────────

export type EmailClassification =
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'inspection'
  | 'informational'
  | 'unknown';

export type UpdateStatus = 'pending' | 'applied' | 'ignored' | 'reviewed';

export interface EmailAttachment {
  id: string;
  email_update_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  ai_summary: string | null;
  ai_classification: string | null;
  ai_confidence: number;
  extracted_text: string | null;
  processing_status: string;
  processing_error: string | null;
  created_at: string;
}

export type MatchType = 'protocol' | 'concessionaire' | 'both';

export interface EmailUpdate {
  id: string;
  gmail_message_id: string;
  subject: string;
  sender: string;
  received_at: string;
  email_body: string | null;
  project_id: string | null;
  protocol_number: string | null;
  // Concessionária
  concessionaire_id: string | null;
  concessionaire_name: string | null;
  protocol_matched: boolean;
  match_type: MatchType;
  // IA
  ai_summary: string | null;
  ai_classification: EmailClassification;
  ai_suggested_status: string | null;
  ai_confidence: number;
  ai_reasoning: string | null;
  attachments_count: number;
  attachments_processed: number;
  attachments_summary: string | null;
  attachment_classification: string | null;
  status: UpdateStatus;
  applied_by: string | null;
  applied_at: string | null;
  scan_run_id: string | null;
  created_at: string;
  // Joins
  project?: { id: string; code: string; status: string } | null;
  attachments?: EmailAttachment[];
}

export interface ScanRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  emails_analyzed: number;
  projects_found: number;
  approved_count: number;
  rejected_count: number;
  pending_count: number;
  inspection_count: number;
  attachments_processed: number;
  status: 'running' | 'completed' | 'error';
  error_message: string | null;
}

// ── useEmailUpdates ───────────────────────────────────────────────────────────

export function useEmailUpdates(filters?: {
  classification?: string;
  status?: string;
  matchType?: MatchType | 'protocol_matched';
}) {
  return useQuery({
    queryKey: ['email-updates', filters],
    queryFn: async () => {
      let q = supabase
        .from('email_updates')
        .select(`
          *,
          project:projects(id, code, status),
          attachments:email_attachments(*)
        `)
        .order('received_at', { ascending: false })
        .limit(100);

      if (filters?.classification) q = q.eq('ai_classification', filters.classification);
      if (filters?.status)         q = q.eq('status', filters.status);
      if (filters?.matchType === 'protocol_matched') {
        q = q.eq('protocol_matched', true).neq('match_type', 'protocol');
      } else if (filters?.matchType) {
        q = q.eq('match_type', filters.matchType);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as EmailUpdate[];
    },
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });
}

// ── useScanRuns ───────────────────────────────────────────────────────────────

export function useScanRuns() {
  return useQuery({
    queryKey: ['scan-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_scan_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as ScanRun[];
    },
    staleTime: 1000 * 60 * 5,
  });
}

// ── useApplySuggestion ────────────────────────────────────────────────────────

export function useApplySuggestion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      updateId,
      projectId,
      newStatus,
    }: {
      updateId: string;
      projectId: string;
      newStatus: string;
    }) => {
      // Mover projeto para o novo status
      const { error: pe } = await supabase
        .from('projects')
        .update({ status: newStatus })
        .eq('id', projectId);
      if (pe) throw pe;

      // Marcar update como aplicado
      const { error: ue } = await supabase
        .from('email_updates')
        .update({
          status:     'applied',
          applied_by: user?.id,
          applied_at: new Date().toISOString(),
        })
        .eq('id', updateId);
      if (ue) throw ue;

      // Registrar comentário no projeto
      await supabase
        .from('comments')
        .insert({
          project_id: projectId,
          user_id:    user?.id,
          message:    `📧 Status atualizado pelo Claudinho dos Emails para: ${newStatus}`,
          type:       'email_agent',
        });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-updates'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['projects'],      exact: false });
      toast.success('Status do projeto atualizado!');
    },
    onError: () => toast.error('Erro ao aplicar sugestão'),
  });
}

// ── useIgnoreSuggestion ───────────────────────────────────────────────────────

export function useIgnoreSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updateId: string) => {
      const { error } = await supabase
        .from('email_updates')
        .update({ status: 'ignored' })
        .eq('id', updateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-updates'], exact: false });
    },
    onError: () => toast.error('Erro ao ignorar sugestão'),
  });
}

// ── useTriggerScan ────────────────────────────────────────────────────────────

export function useTriggerScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scan-emails`,
        {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao iniciar varredura');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Varredura iniciada! Aguarde alguns instantes...');
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['email-updates'], exact: false });
        queryClient.invalidateQueries({ queryKey: ['scan-runs'],     exact: false });
      }, 12000);
    },
    onError: (e: Error) => toast.error(`Erro ao iniciar varredura: ${e.message}`),
  });
}
