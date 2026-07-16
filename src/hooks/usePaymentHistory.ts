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
  entry_type: 'payment' | 'reversal';
  reverses_payment_id: string | null;
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
      return (data || []).map(r => ({ ...r, amount: Number(r.amount) })) as PaymentHistoryEntry[];
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

// ── Settle a single project (quitação) ────────────────────────────────────────
// Registra um pagamento igual ao saldo em aberto, quitando o projeto.
async function settleProject(projectId: string, paymentDate: string, notes: string | null) {
  const { data: { user } } = await supabase.auth.getUser();
  const fin = await ensureProjectFinancials(projectId);
  const projectValue = Number(fin.project_value);
  const balance = projectValue - Number(fin.paid_value);
  if (balance <= 0.009) return { settled: false }; // já quitado / sem saldo

  const { error: histErr } = await supabase.from('payment_history').insert({
    project_id: projectId,
    amount: balance,
    payment_date: paymentDate,
    notes: notes || 'Quitação',
    registered_by: user?.id || null,
    entry_type: 'payment',
  });
  if (histErr) throw histErr;

  const { error: updErr } = await supabase
    .from('project_financials')
    .update({ paid_value: projectValue, payment_status: 'paid' })
    .eq('id', fin.id);
  if (updErr) throw updErr;
  return { settled: true };
}

// ── useBatchSettle ────────────────────────────────────────────────────────────
// Quitação rápida de vários projetos com as mesmas regras (data + observação).
export function useBatchSettle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectIds, paymentDate, notes,
    }: { projectIds: string[]; paymentDate: string; notes?: string }) => {
      let count = 0;
      for (const id of projectIds) {
        const r = await settleProject(id, paymentDate, notes || null);
        if (r.settled) count++;
      }
      return count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['financials'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['payment-history'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      toast.success(count > 0 ? `${count} projeto(s) quitado(s)!` : 'Nenhum projeto tinha saldo em aberto');
    },
    onError: () => toast.error('Erro ao quitar projetos'),
  });
}

// ── Reverse the active payments of a project (estorno de quitação) ─────────────
// Insere linhas de reversão (valor negativo) para cada pagamento ainda ativo e
// recalcula o saldo. Preserva a trilha de auditoria.
async function reverseProject(projectId: string, reason: string | null) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rows, error: rowsErr } = await supabase
    .from('payment_history')
    .select('*')
    .eq('project_id', projectId);
  if (rowsErr) throw rowsErr;

  const all = (rows || []) as PaymentHistoryEntry[];
  const reversedIds = new Set(
    all.filter(r => r.entry_type === 'reversal' && r.reverses_payment_id)
       .map(r => r.reverses_payment_id as string)
  );
  const active = all.filter(r => r.entry_type === 'payment' && !reversedIds.has(r.id));
  if (active.length === 0) return { reversed: 0, amount: 0 };

  const today = new Date().toISOString().split('T')[0];
  let reversedAmount = 0;
  for (const p of active) {
    const amt = Number(p.amount);
    const { error } = await supabase.from('payment_history').insert({
      project_id: projectId,
      amount: -amt,
      payment_date: today,
      notes: reason || 'Estorno de quitação',
      registered_by: user?.id || null,
      entry_type: 'reversal',
      reverses_payment_id: p.id,
    });
    if (error) throw error;
    reversedAmount += amt;
  }

  const fin = await ensureProjectFinancials(projectId);
  const newPaid = Math.max(0, Number(fin.paid_value) - reversedAmount);
  const status = computePaymentStatus(newPaid, Number(fin.project_value));
  const { error: updErr } = await supabase
    .from('project_financials')
    .update({ paid_value: newPaid, payment_status: status })
    .eq('id', fin.id);
  if (updErr) throw updErr;
  return { reversed: active.length, amount: reversedAmount };
}

// ── useReverseSinglePayment ───────────────────────────────────────────────────
// Estorna UM pagamento específico (usado no histórico do modal).
export function useReverseSinglePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      payment, reason,
    }: { payment: PaymentHistoryEntry; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const today = new Date().toISOString().split('T')[0];

      const { error } = await supabase.from('payment_history').insert({
        project_id: payment.project_id,
        amount: -Number(payment.amount),
        payment_date: today,
        notes: reason || 'Estorno de pagamento',
        registered_by: user?.id || null,
        entry_type: 'reversal',
        reverses_payment_id: payment.id,
      });
      if (error) throw error;

      const fin = await ensureProjectFinancials(payment.project_id);
      const newPaid = Math.max(0, Number(fin.paid_value) - Number(payment.amount));
      const status = computePaymentStatus(newPaid, Number(fin.project_value));
      const { error: updErr } = await supabase
        .from('project_financials')
        .update({ paid_value: newPaid, payment_status: status })
        .eq('id', fin.id);
      if (updErr) throw updErr;
    },
    onSuccess: (_, vars) => {
      invalidateAll(queryClient, vars.payment.project_id);
      toast.success('Pagamento estornado');
    },
    onError: () => toast.error('Erro ao estornar pagamento'),
  });
}

// ── useBatchReverse ───────────────────────────────────────────────────────────
// Estorno de quitação em lote (reverte todos os pagamentos ativos dos projetos).
export function useBatchReverse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectIds, reason,
    }: { projectIds: string[]; reason?: string }) => {
      let count = 0;
      for (const id of projectIds) {
        const r = await reverseProject(id, reason || null);
        if (r.reversed > 0) count++;
      }
      return count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['financials'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['payment-history'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      toast.success(count > 0 ? `Quitação estornada em ${count} projeto(s)` : 'Nenhum pagamento a estornar');
    },
    onError: () => toast.error('Erro ao estornar quitação'),
  });
}
