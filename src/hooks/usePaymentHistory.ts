import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PaymentHistoryEntry {
  id: string;
  project_id: string;
  amount: number;
  payment_date: string;
  notes: string | null;
  registered_by: string | null;
  created_at: string;
}

// ── Invalidation helper ───────────────────────────────────────────────────────
// Call after any mutation that touches project_financials or payment_history
// so ALL financial views stay in sync simultaneously.
function invalidateAll(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  queryClient.invalidateQueries({ queryKey: ['payment-history', projectId] });
  queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  // ↓ These two ensure the Financial page KPIs and the PDF report always reflect
  //   the latest data immediately after any payment / value change.
  queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['financials'] }); // legacy table views
}

// ── Ensure project_financials record exists ───────────────────────────────────
// Some projects created before the migration may not have a row yet.
// Uses maybeSingle() + upsert to never throw on missing row.
async function ensureProjectFinancials(projectId: string) {
  const { data: existing, error: fetchErr } = await supabase
    .from('project_financials')
    .select('id, project_value, paid_value')
    .eq('project_id', projectId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  if (existing) return existing;

  // Row missing → create default record
  const { data: created, error: createErr } = await supabase
    .from('project_financials')
    .insert({
      project_id: projectId,
      project_value: 0,
      paid_value: 0,
      payment_status: 'pending',
    })
    .select('id, project_value, paid_value')
    .single();

  if (createErr) throw createErr;
  return created;
}

// ── Payment Status logic ──────────────────────────────────────────────────────
function computePaymentStatus(paid: number, total: number): 'pending' | 'partial' | 'paid' {
  if (paid <= 0) return 'pending';
  if (paid >= total) return 'paid';
  return 'partial';
}

// ── usePaymentHistory ─────────────────────────────────────────────────────────
export function usePaymentHistory(projectId: string | undefined) {
  return useQuery({
    queryKey: ['payment-history', projectId],
    queryFn: async (): Promise<PaymentHistoryEntry[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('payment_history')
        .select('*')
        .eq('project_id', projectId)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      return (data || []).map(r => ({ ...r, amount: Number(r.amount) }));
    },
    enabled: !!projectId,
  });
}

// ── useAddPaymentHistory ──────────────────────────────────────────────────────
export function useAddPaymentHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      amount,
      paymentDate,
      notes,
    }: {
      projectId: string;
      amount: number;
      paymentDate: string;
      notes?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Insert payment history record
      const { error: histErr } = await supabase.from('payment_history').insert({
        project_id: projectId,
        amount,
        payment_date: paymentDate,
        notes: notes || null,
        registered_by: user?.id || null,
      });
      if (histErr) throw histErr;

      // 2. Ensure project_financials row exists (safe for legacy projects)
      const fin = await ensureProjectFinancials(projectId);

      // 3. Compute new values with business-rule status
      const newPaid = Number(fin.paid_value) + amount;
      const projectValue = Number(fin.project_value);
      const paymentStatus = computePaymentStatus(newPaid, projectValue);

      // 4. Update project_financials
      const { error: updErr } = await supabase
        .from('project_financials')
        .update({ paid_value: newPaid, payment_status: paymentStatus })
        .eq('id', fin.id);
      if (updErr) throw updErr;
    },
    onSuccess: (_, vars) => {
      invalidateAll(queryClient, vars.projectId);
      toast.success('Pagamento registrado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao registrar pagamento');
    },
  });
}

// ── useUpdateProjectValue ─────────────────────────────────────────────────────
export function useUpdateProjectValue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      projectValue,
    }: {
      projectId: string;
      projectValue: number;
    }) => {
      // Ensure record exists first
      const fin = await ensureProjectFinancials(projectId);

      const paidValue = Number(fin.paid_value);
      const paymentStatus = computePaymentStatus(paidValue, projectValue);

      const { error } = await supabase
        .from('project_financials')
        .update({ project_value: projectValue, payment_status: paymentStatus })
        .eq('id', fin.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      invalidateAll(queryClient, vars.projectId);
      toast.success('Valor do projeto atualizado!');
    },
    onError: () => {
      toast.error('Erro ao atualizar valor do projeto');
    },
  });
}
