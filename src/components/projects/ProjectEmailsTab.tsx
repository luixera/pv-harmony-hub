import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, ExternalLink, Loader2, Mail, Paperclip, Search } from 'lucide-react';

/**
 * Aba "Notificações" do modal do projeto: os e-mails da concessionária que
 * falam DESTE projeto.
 *
 * A busca é a RPC `project_emails`, que devolve tanto os e-mails já
 * VINCULADOS pelo Claudinho (por protocolo, UC ou titular) quanto os que ainda
 * não foram vinculados mas citam um desses três — assim a correspondência
 * aparece aqui antes mesmo da próxima varredura.
 *
 * Aqui é só leitura: aplicar ou descartar a sugestão de etapa continua num
 * lugar só, a tela de E-mails (decisão do usuário, pra não duplicar o fluxo).
 */

export interface ProjectEmailRow {
  id: string;
  subject: string | null;
  sender: string | null;
  received_at: string | null;
  ai_summary: string | null;
  ai_classification: string | null;
  ai_suggested_status: string | null;
  ai_confidence: number | null;
  attachments_count: number | null;
  attachments_summary: string | null;
  status: string | null;
  match_type: string | null;
  protocol_number: string | null;
  concessionaire_name: string | null;
  apenas_sugerido: boolean;
}

const CLASSIF: Record<string, { label: string; bg: string; color: string }> = {
  approved:      { label: 'Aprovação',   bg: '#E1F5EE', color: '#0F6E56' },
  rejected:      { label: 'Reprovação',  bg: '#FDE7E3', color: '#B23A1B' },
  pending:       { label: 'Pendência',   bg: '#FEF3D0', color: '#854F0B' },
  inspection:    { label: 'Vistoria',    bg: '#EDE7FB', color: '#5B3BA8' },
  informational: { label: 'Informativo', bg: '#E6F1FB', color: '#185FA5' },
  unknown:       { label: 'Sem análise', bg: '#F0F0F0', color: '#666' },
};

/** Por onde o e-mail casou com o projeto — a origem muda a confiança. */
const ORIGEM: Record<string, string> = {
  protocol: 'protocolo',
  both: 'protocolo',
  uc: 'unidade consumidora',
  holder: 'nome do titular',
  concessionaire: 'concessionária',
};

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function ProjectEmailsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { data: emails = [], isLoading, error } = useQuery({
    queryKey: ['project-emails', projectId],
    queryFn: async (): Promise<ProjectEmailRow[]> => {
      const { data, error } = await supabase.rpc('project_emails' as never, { _project_id: projectId } as never);
      if (error) throw error;
      return (data ?? []) as unknown as ProjectEmailRow[];
    },
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 50 }}>
        <Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} />
      </div>
    );
  }

  if (error) {
    return (
      <p style={{ fontSize: 13, color: '#B23A1B', padding: 20 }}>
        Não deu pra carregar os e-mails deste projeto.
      </p>
    );
  }

  const vinculados = emails.filter(e => !e.apenas_sugerido);
  const sugeridos = emails.filter(e => e.apenas_sugerido);

  return (
    <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
            Notificações da concessionária
          </p>
          <p style={{ fontSize: 11.5, color: '#888', margin: '2px 0 0' }}>
            E-mails que citam o protocolo, a unidade consumidora ou o titular deste projeto.
          </p>
        </div>
        <button
          onClick={() => navigate('/email-updates')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
            border: '1px solid #E0E0E0', background: '#fff', color: '#555', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          <ExternalLink size={13} /> Abrir tela de E-mails
        </button>
      </div>

      {emails.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>
          <Mail size={26} style={{ opacity: 0.4 }} />
          <p style={{ fontSize: 13, margin: '8px 0 0' }}>Nenhum e-mail relacionado a este projeto ainda.</p>
          <p style={{ fontSize: 11.5, margin: '3px 0 0' }}>
            O Claudinho varre a caixa de entrada e relaciona pelo protocolo, pela UC ou pelo nome do titular.
          </p>
        </div>
      )}

      {vinculados.map(e => <EmailCard key={e.id} email={e} />)}

      {sugeridos.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
            <Search size={13} style={{ color: '#854F0B' }} />
            <p style={{ fontSize: 12, fontWeight: 700, color: '#854F0B', margin: 0 }}>
              Encontrados na busca ({sugeridos.length})
            </p>
          </div>
          <p style={{ fontSize: 11, color: '#999', margin: '-6px 0 0' }}>
            Citam este projeto mas ainda não foram vinculados pelo Claudinho — o vínculo acontece na próxima varredura.
          </p>
          {sugeridos.map(e => <EmailCard key={e.id} email={e} sugerido />)}
        </>
      )}
    </div>
  );
}

function EmailCard({ email, sugerido }: { email: ProjectEmailRow; sugerido?: boolean }) {
  const cl = CLASSIF[email.ai_classification ?? 'unknown'] ?? CLASSIF.unknown;
  const origem = ORIGEM[email.match_type ?? ''] ?? null;
  return (
    <div style={{
      border: `1px solid ${sugerido ? '#FDE4A8' : '#EFEFEF'}`, borderRadius: 10, padding: '11px 13px',
      background: sugerido ? '#FFFBF0' : '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
            {email.subject || '(sem assunto)'}
          </p>
          <p style={{ fontSize: 11, color: '#999', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {email.sender || '—'} · {fmtData(email.received_at)}
            {email.concessionaire_name ? ` · ${email.concessionaire_name}` : ''}
          </p>
        </div>
        <span style={{ fontSize: 9.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: cl.bg, color: cl.color, whiteSpace: 'nowrap' }}>
          {cl.label}
        </span>
      </div>

      {email.ai_summary && (
        <p style={{ fontSize: 12, color: '#555', margin: '8px 0 0', lineHeight: 1.55 }}>{email.ai_summary}</p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        {origem && (
          <span style={{ fontSize: 10.5, color: '#777' }}>
            Relacionado pelo <strong>{origem}</strong>
            {email.protocol_number ? ` ${email.protocol_number}` : ''}
          </span>
        )}
        {(email.attachments_count ?? 0) > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#777' }}>
            <Paperclip size={11} /> {email.attachments_count} anexo(s)
          </span>
        )}
        {email.status === 'applied' && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#0F6E56' }}>Sugestão já aplicada</span>
        )}
        {email.ai_suggested_status && email.status !== 'applied' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#854F0B' }}>
            <AlertTriangle size={11} /> Sugere mudar a etapa — aplique pela tela de E-mails
          </span>
        )}
      </div>
    </div>
  );
}
