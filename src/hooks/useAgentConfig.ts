import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── TIPOS ─────────────────────────────────────────────────────────────────────

export interface AgentConfigSafe {
  id: string;
  config_key: string;
  gmail_email: string | null;
  scan_times: string[];
  is_active: boolean;
  is_configured: boolean;
  configured_by: string | null;
  configured_at: string | null;
  last_tested_at: string | null;
  last_test_success: boolean | null;
  last_test_error: string | null;
  has_client_id: boolean;
  has_refresh_token: boolean;
}

// ── useAgentConfig (usa view segura — sem credenciais) ────────────────────────

export function useAgentConfig() {
  return useQuery({
    queryKey: ['agent-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_config_safe')
        .select('*')
        .eq('config_key', 'email_agent')
        .maybeSingle();
      if (error) throw error;
      return data as AgentConfigSafe | null;
    },
    staleTime: 1000 * 60 * 10,
  });
}

// ── useSaveAgentConfig (apenas admin — escreve na tabela real) ────────────────

export function useSaveAgentConfig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (payload: {
      gmail_email: string;
      gmail_client_id: string;
      gmail_client_secret: string;
      gmail_refresh_token: string;
      scan_times: string[];
      is_active: boolean;
    }) => {
      const { error } = await supabase
        .from('agent_config')
        .update({
          ...payload,
          is_configured:  true,
          configured_by:  user?.id,
          configured_at:  new Date().toISOString(),
          updated_at:     new Date().toISOString(),
          // Resetar status de teste ao salvar novas credenciais
          last_test_success: null,
          last_test_error:   null,
        })
        .eq('config_key', 'email_agent');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-config'] });
      toast.success('Configuração salva com sucesso!');
    },
    onError: () => toast.error('Erro ao salvar configuração'),
  });
}

// ── useTestGmailConnection ────────────────────────────────────────────────────

export function useTestGmailConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (creds: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-gmail`,
        {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientId:     creds.clientId,
            clientSecret: creds.clientSecret,
            refreshToken: creds.refreshToken,
          }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Teste falhou');
      return data as { success: true; emailAddress: string; messagesTotal: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-config'] });
      toast.success(`✅ Conexão OK — ${data.emailAddress}`);
    },
    onError: (e: Error) => toast.error(`❌ Falha: ${e.message}`),
  });
}
