import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, RefreshCw, Settings, ChevronDown, ChevronUp,
  Loader2, CheckCircle2, XCircle, Clock, AlertCircle,
  Info, HelpCircle, FileText, Image as ImageIcon,
  AlertTriangle, CheckSquare, Inbox, Calendar, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useEmailUpdates, useScanRuns, useApplySuggestion,
  useIgnoreSuggestion, useTriggerScan,
  EmailUpdate, EmailClassification, ScanRun,
} from '@/hooks/useEmailUpdates';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { AgentConfigDialog } from '@/components/email/AgentConfigDialog';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateBR(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractDomain(sender: string) {
  const match = sender.match(/@([\w.-]+)/) ;
  return match ? match[1] : sender;
}

// ── Classificação ─────────────────────────────────────────────────────────────

const CL_CFG: Record<EmailClassification | string, {
  label: string; icon: React.ReactNode;
  color: string; bg: string; border: string;
}> = {
  approved:      { label: 'Aprovado',      icon: <CheckCircle2 size={13} />, color: '#0F6E56', bg: '#E1F5EE', border: '#2D6A4F' },
  rejected:      { label: 'Reprovado',     icon: <XCircle size={13} />,      color: '#A32D2D', bg: '#FCEBEB', border: '#E24B4A' },
  pending:       { label: 'Pendência',     icon: <AlertCircle size={13} />,  color: '#854F0B', bg: '#FEF3D0', border: '#F5A800' },
  inspection:    { label: 'Vistoria',      icon: <Clock size={13} />,        color: '#185FA5', bg: '#E6F1FB', border: '#378ADD' },
  informational: { label: 'Informativo',   icon: <Info size={13} />,         color: '#555',    bg: '#F5F5F5', border: '#ccc'     },
  unknown:       { label: 'Desconhecido',  icon: <HelpCircle size={13} />,   color: '#888',    bg: '#F5F5F5', border: '#ddd'     },
};

const SUGGESTION_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  approved:           { label: 'Aprovado',           color: '#0F6E56', bg: '#E1F5EE', border: '#2D6A4F' },
  pendencia:          { label: 'Reprovado/Pendência', color: '#A32D2D', bg: '#FCEBEB', border: '#E24B4A' },
  vistoria_solicitada:{ label: 'Vistoria Solicitada', color: '#185FA5', bg: '#E6F1FB', border: '#378ADD' },
};

const STATUS_LABELS: Record<string, string> = {
  approved:            'Aprovado',
  pendencia:           'Pendência',
  vistoria_solicitada: 'Vistoria Solicitada',
  pending:             'Pendente',
  analysis:            'Em Análise',
  documentation:       'Documentação',
  approval:            'Aprovação',
  completed:           'Concluído',
};

// ── Contador regressivo ───────────────────────────────────────────────────────

function getNextScanTime(scanTimes: string[] = ['08:00', '17:00']): Date {
  const now = new Date();
  // Usa Intl para ler hora BRT com precisão, independente do fuso do sistema
  const brtStr = now.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const [brtH, brtM] = brtStr.split(':').map(Number);
  const brtNowMin = (isNaN(brtH) ? 0 : brtH) * 60 + (isNaN(brtM) ? 0 : brtM);

  const times = (scanTimes && scanTimes.length > 0 ? scanTimes : ['08:00', '17:00'])
    .map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; })
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  const nextMin = times.find(t => t > brtNowMin);
  const diffMin = nextMin !== undefined
    ? nextMin - brtNowMin
    : (24 * 60 - brtNowMin) + times[0];

  return new Date(now.getTime() + diffMin * 60 * 1000);
}

function useCountdown(scanTimes?: string[]) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const tick = () => {
      const diff = getNextScanTime(scanTimes).getTime() - Date.now();
      if (diff <= 0) { setRemaining('agora'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [scanTimes?.join(',')]);
  return remaining;
}

// ── Badge de classificação ────────────────────────────────────────────────────

function ClassBadge({ cl, size = 'sm' }: { cl: string; size?: 'xs' | 'sm' }) {
  const cfg = CL_CFG[cl] || CL_CFG.unknown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: size === 'xs' ? '2px 7px' : '3px 9px',
      borderRadius: 99, fontSize: size === 'xs' ? 10 : 11,
      fontWeight: 700, color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.border}`,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ── Card de email ─────────────────────────────────────────────────────────────

function gmailLink(update: EmailUpdate): string {
  const id = update.gmail_message_id;
  if (id && !id.startsWith('imap-uid-')) {
    const clean = id.replace(/^<|>$/g, '');
    return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(clean)}`;
  }
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`subject:(${update.subject})`)}`;
}

function EmailCard({ update, onOpenProject }: { update: EmailUpdate; onOpenProject: (id: string) => void }) {
  const [expanded, setExpanded]       = useState(false);
  const [showBody, setShowBody]       = useState(false);
  const applySuggestion  = useApplySuggestion();
  const ignoreSuggestion = useIgnoreSuggestion();

  const cl  = update.ai_classification;
  const cfg = CL_CFG[cl] || CL_CFG.unknown;
  const suggestion = update.ai_suggested_status ? SUGGESTION_CFG[update.ai_suggested_status] : null;
  const hasActionable = suggestion && update.status === 'pending' && update.project_id;

  const domain = extractDomain(update.sender);

  // Lógica de destaque: email da concessionária COM protocolo vinculado
  const isProtocolMatch = update.protocol_matched && update.match_type !== 'protocol';
  const isConcOnly      = update.match_type === 'concessionaire' && !update.protocol_matched;

  const borderLeftColor = isProtocolMatch
    ? '#F5A800'          // âmbar — protocolo vinculado via concessionária
    : isConcOnly
      ? '#B0B8C1'        // cinza — só da concessionária, sem protocolo
      : cfg.border;      // cor da classificação (comportamento original)

  const cardBg = isProtocolMatch ? '#FFFDF5' : '#fff';

  return (
    <div style={{
      background: cardBg, borderRadius: 12,
      border: `1px solid ${isProtocolMatch ? '#F5D580' : '#F0F0F0'}`,
      borderLeft: `4px solid ${borderLeftColor}`,
      overflow: 'hidden',
      opacity: update.status === 'applied' || update.status === 'ignored' ? 0.65 : 1,
      transition: 'box-shadow 0.15s',
    }}>
      {/* ── Linha de badges (fora do toggle — zero conflito de evento) ── */}
      <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {update.concessionaire_name && (
          <span style={{
            fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
            background: isProtocolMatch ? '#FEF3D0' : '#F0F0F0',
            color: isProtocolMatch ? '#854F0B' : '#555',
            letterSpacing: '0.03em',
          }}>
            {update.concessionaire_name}
          </span>
        )}

        {/* Badge "Protocolo vinculado" — clicável, abre modal do projeto */}
        {isProtocolMatch && update.project_id && (
          <button
            type="button"
            onClick={() => onOpenProject(update.project_id!)}
            title="Ver projeto vinculado"
            style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
              background: '#FEF3D0', color: '#854F0B',
              border: '1px solid #F5D580',
              display: 'inline-flex', alignItems: 'center', gap: 3,
              cursor: 'pointer', transition: 'background 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FAE5A0'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(245,168,0,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#FEF3D0'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            🔗 Protocolo vinculado
          </button>
        )}

        {/* Código do projeto — também clicável */}
        {update.project && update.project_id && (
          <button
            type="button"
            onClick={() => onOpenProject(update.project_id!)}
            title="Ver projeto"
            style={{
              fontSize: 12, fontWeight: 700, color: '#185FA5', background: '#E6F1FB',
              padding: '2px 7px', borderRadius: 5, border: '1px solid #B8D4F0',
              cursor: 'pointer', transition: 'background 0.15s',
              display: 'inline-flex', alignItems: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#C8E0F8'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#E6F1FB'; }}
          >
            {update.project.code}
          </button>
        )}

        {update.protocol_number && (
          <span style={{ fontSize: 11, color: '#888' }}>#{update.protocol_number}</span>
        )}
        <span style={{ fontSize: 11, color: '#aaa' }}>{domain}</span>
        <ClassBadge cl={cl} size="xs" />
        {update.attachments_count > 0 && (
          <span style={{ fontSize: 11, color: '#888', display: 'flex', alignItems: 'center', gap: 3 }}>
            📎 {update.attachments_count}
          </span>
        )}
        {update.status !== 'pending' && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
            background: update.status === 'applied' ? '#E1F5EE' : '#F5F5F5',
            color: update.status === 'applied' ? '#0F6E56' : '#888',
          }}>
            {update.status === 'applied' ? '✓ aplicado' : update.status === 'ignored' ? 'ignorado' : update.status}
          </span>
        )}
      </div>

      {/* ── Área de toggle (assunto + data + chevron) ── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v); }}
        style={{
          width: '100%', padding: '6px 16px 12px', background: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
        }}
      >
        {/* Ícone classificação */}
        <div style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0,
          background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: cfg.color,
        }}>
          {cfg.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Assunto */}
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', margin: 0, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {update.subject}
          </p>
          {/* Data */}
          <p style={{ fontSize: 11, color: '#aaa', margin: '3px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Calendar size={11} /> {formatDateBR(update.received_at)}
          </p>
        </div>

        {/* Chevron */}
        <div style={{ color: '#ccc', flexShrink: 0 }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Body expansível */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #F5F5F5' }}>

              {/* 1. Resumo IA */}
              {update.ai_summary && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, border: '1.5px solid #F5A800', background: '#FFFBF0' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#854F0B', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 4 }}>
                    🤖 Resumo do Claudinho
                    {update.ai_confidence > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#aaa', marginLeft: 4 }}>
                        {update.ai_confidence}% confiança
                      </span>
                    )}
                  </p>
                  <p style={{ fontSize: 12, color: '#1A1A1A', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {update.ai_summary}
                  </p>
                  {update.ai_reasoning && (
                    <p style={{ fontSize: 11, color: '#999', margin: '6px 0 0', fontStyle: 'italic' }}>
                      {update.ai_reasoning}
                    </p>
                  )}
                </div>
              )}

              {/* 2. Anexos */}
              {update.attachments && update.attachments.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                    📎 Anexos ({update.attachments.length})
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {update.attachments.map(att => (
                      <div key={att.id} style={{
                        padding: '8px 12px', borderRadius: 8,
                        background: att.processing_status === 'failed' ? '#FFF5F5' : '#FAFAFA',
                        border: `1px solid ${att.processing_status === 'failed' ? '#FFCDD2' : '#F0F0F0'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: att.ai_summary ? 5 : 0 }}>
                          {att.mime_type === 'application/pdf'
                            ? <FileText size={14} style={{ color: '#E24B4A', flexShrink: 0 }} />
                            : <ImageIcon size={14} style={{ color: '#378ADD', flexShrink: 0 }} />
                          }
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {att.filename}
                          </span>
                          {att.size_bytes && (
                            <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0 }}>{formatBytes(att.size_bytes)}</span>
                          )}
                          {att.ai_classification && att.processing_status !== 'failed' && (
                            <ClassBadge cl={att.ai_classification} size="xs" />
                          )}
                          {att.ai_confidence > 0 && att.processing_status !== 'failed' && (
                            <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0 }}>{att.ai_confidence}%</span>
                          )}
                        </div>
                        {att.processing_status === 'failed' && (
                          <p style={{ fontSize: 11, color: '#E24B4A', margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={11} /> Falha: {att.processing_error || 'erro ao processar'}
                          </p>
                        )}
                        {att.ai_summary && att.processing_status !== 'failed' && (
                          <p style={{ fontSize: 11, color: '#555', margin: 0, lineHeight: 1.4 }}>
                            {att.ai_summary}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Sugestão de status */}
              {hasActionable && suggestion && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8,
                  background: suggestion.bg,
                  border: `1.5px solid ${suggestion.border}`,
                }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: suggestion.color, margin: '0 0 5px' }}>
                    💡 Sugestão do Claudinho
                  </p>
                  <p style={{ fontSize: 12, color: '#1A1A1A', margin: '0 0 10px' }}>
                    Mover projeto <strong>{update.project?.code}</strong> de{' '}
                    <strong>{STATUS_LABELS[update.project?.status || ''] || update.project?.status}</strong>{' '}
                    para <strong>{suggestion.label}</strong>
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => ignoreSuggestion.mutate(update.id)}
                      disabled={ignoreSuggestion.isPending}
                      style={{
                        padding: '6px 14px', borderRadius: 8,
                        border: '1px solid #E0E0E0', background: '#fff',
                        fontSize: 12, fontWeight: 600, color: '#888', cursor: 'pointer',
                      }}
                    >
                      Ignorar
                    </button>
                    <button
                      onClick={() => applySuggestion.mutate({
                        updateId:  update.id,
                        projectId: update.project_id!,
                        newStatus: update.ai_suggested_status!,
                      })}
                      disabled={applySuggestion.isPending}
                      style={{
                        padding: '6px 16px', borderRadius: 8, border: 'none',
                        background: suggestion.color, color: '#fff',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      {applySuggestion.isPending
                        ? <Loader2 size={12} className="animate-spin" />
                        : null
                      }
                      Mover agora →
                    </button>
                  </div>
                </div>
              )}

              {/* 4. Ações do email */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={gmailLink(update)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', borderRadius: 8,
                    border: '1px solid #E0E0E0', background: '#fff',
                    fontSize: 11, fontWeight: 700, color: '#555',
                    textDecoration: 'none', cursor: 'pointer',
                  }}
                >
                  <ExternalLink size={12} /> Abrir no Gmail
                </a>
                <button
                  onClick={() => setShowBody(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, color: '#aaa', padding: 0,
                  }}
                >
                  {showBody ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  Ver corpo do email
                </button>
              </div>
              {showBody && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#F8F8F8', border: '1px solid #EEE' }}>
                  <p style={{ fontSize: 11, color: '#888', margin: '0 0 2px' }}>
                    <strong>De:</strong> {update.sender}
                  </p>
                  <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>
                    <strong>Recebido:</strong> {formatDateBR(update.received_at)}
                  </p>
                  <pre style={{ fontSize: 11, color: '#555', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'monospace', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>
                    {update.email_body || '(corpo vazio)'}
                  </pre>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Card de stat ──────────────────────────────────────────────────────────────

function StatCard({ label, value, color, bg, icon }: {
  label: string; value: number; color: string; bg: string; icon: React.ReactNode;
}) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', border: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <p style={{ fontSize: 20, fontWeight: 800, color: '#1A1A1A', margin: 0, lineHeight: 1 }}>{value}</p>
        <p style={{ fontSize: 11, color: '#999', margin: '2px 0 0' }}>{label}</p>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ updates, scanRuns }: { updates: EmailUpdate[]; scanRuns: ScanRun[] }) {
  const lastRun = scanRuns[0];

  // Agrupar por domínio do remetente
  const byDomain: Record<string, number> = {};
  updates.forEach(u => {
    const d = extractDomain(u.sender);
    byDomain[d] = (byDomain[d] || 0) + 1;
  });
  const domainEntries = Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Última varredura */}
      <div style={{ background: '#1A1A1A', borderRadius: 12, padding: '14px 16px' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>
          Última Varredura
        </p>
        {lastRun ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: lastRun.status === 'completed' ? '#2D6A4F' : lastRun.status === 'running' ? '#F5A800' : lastRun.status === 'timeout' ? '#F5A800' : '#E24B4A',
              }} />
              <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
                {lastRun.status === 'completed' ? 'Concluída'
                  : lastRun.status === 'running' ? 'Em execução'
                  : lastRun.status === 'timeout' ? 'Timeout (parcial)'
                  : 'Erro'}
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
              {formatDateBR(lastRun.started_at)}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
              {[
                { label: 'Projetos', value: lastRun.projects_found },
                { label: 'Anexos', value: lastRun.attachments_processed },
                { label: 'Aprovações', value: lastRun.approved_count },
                { label: 'Reprovações', value: lastRun.rejected_count },
              ].map(s => (
                <div key={s.label} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '6px 8px' }}>
                  <p style={{ fontSize: 16, fontWeight: 700, color: '#F5A800', margin: 0 }}>{s.value}</p>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', margin: 0 }}>Nenhuma varredura ainda</p>
        )}
      </div>

      {/* Por concessionária */}
      {domainEntries.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #F0F0F0' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>
            Por Remetente
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {domainEntries.map(([domain, count]) => (
              <div key={domain} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {domain}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1A1A', background: '#F5F5F5', padding: '1px 7px', borderRadius: 99, flexShrink: 0 }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Histórico de varreduras */}
      {scanRuns.length > 1 && (
        <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #F0F0F0' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>
            Histórico
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {scanRuns.slice(0, 5).map((run) => (
              <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: run.status === 'completed' ? '#2D6A4F' : run.status === 'running' ? '#F5A800' : '#E24B4A',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, color: '#555', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {new Date(run.started_at).toLocaleDateString('pt-BR')} {new Date(run.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1A1A', flexShrink: 0 }}>
                  {run.projects_found}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

type FilterCL     = EmailClassification | 'all';
type FilterSource = 'all' | 'concessionaire' | 'protocol_matched';

export default function EmailUpdates() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const navigate = useNavigate();
  const [configOpen,    setConfigOpen]    = useState(false);
  const [filterCL,      setFilterCL]      = useState<FilterCL>('all');
  const [filterSource,  setFilterSource]  = useState<FilterSource>('all');

  const openProject = useCallback((id: string) => {
    navigate(`/projects?openProject=${id}`);
  }, [navigate]);

  const { data: config                     } = useAgentConfig();
  const countdown = useCountdown(config?.scan_times);

  const { data: allUpdates = [], isLoading } = useEmailUpdates();
  const { data: scanRuns   = []            } = useScanRuns();
  const triggerScan = useTriggerScan();

  // Stats calculados
  const total       = allUpdates.length;
  const approved    = allUpdates.filter(u => u.ai_classification === 'approved').length;
  const rejected    = allUpdates.filter(u => u.ai_classification === 'rejected').length;
  const pending     = allUpdates.filter(u => u.ai_classification === 'pending').length;
  const actionable  = allUpdates.filter(u => u.status === 'pending' && u.ai_suggested_status).length;

  // Lista filtrada (classificação + origem)
  const filtered = allUpdates
    .filter(u => filterCL === 'all' || u.ai_classification === filterCL)
    .filter(u => {
      if (filterSource === 'concessionaire')    return u.match_type === 'concessionaire' || u.match_type === 'both';
      if (filterSource === 'protocol_matched')  return u.protocol_matched && u.match_type !== 'protocol';
      return true;
    });

  // Status do agente
  const agentStatus: 'active' | 'paused' | 'not_configured' | 'error' =
    !config || !config.is_configured
      ? 'not_configured'
      : !config.is_active
        ? 'paused'
        : config.last_test_success === false
          ? 'error'
          : 'active';

  const AGENT_STATUS_CFG = {
    active:         { label: '🟢 Claudinho ativo',       color: '#0F6E56', bg: '#E1F5EE', pulse: true  },
    paused:         { label: '⏸ Claudinho pausado',      color: '#854F0B', bg: '#FEF3D0', pulse: false },
    not_configured: { label: '⚠ Não configurado',     color: '#854F0B', bg: '#FEF3D0', pulse: false },
    error:          { label: '🔴 Erro de conexão',    color: '#A32D2D', bg: '#FCEBEB', pulse: false },
  };
  const statusCfg = AGENT_STATUS_CFG[agentStatus];

  return (
    <MainLayout>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Header ── */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#378ADD,#185FA5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Mail size={20} style={{ color: '#fff' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1A1A1A', margin: 0 }}>Claudinho dos Emails</h1>
              <p style={{ fontSize: 12, color: '#999', margin: 0 }}>
                {isLoading ? '…' : `${total} email${total !== 1 ? 's' : ''} analisado${total !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Badge status */}
            <button
              onClick={() => (agentStatus !== 'active') && isAdmin && setConfigOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 99, border: 'none',
                background: statusCfg.bg, color: statusCfg.color,
                fontSize: 12, fontWeight: 700,
                cursor: agentStatus !== 'active' && isAdmin ? 'pointer' : 'default',
                position: 'relative',
              }}
            >
              {statusCfg.pulse && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2D6A4F', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              )}
              {statusCfg.label}
            </button>

            {/* Configurar (admin) */}
            {isAdmin && (
              <button
                onClick={() => setConfigOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', fontSize: 12, fontWeight: 700, color: '#555', cursor: 'pointer' }}
              >
                <Settings size={14} /> Configurar
              </button>
            )}

            {/* Varrer agora */}
            <button
              onClick={() => triggerScan.mutate()}
              disabled={triggerScan.isPending}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 8, border: 'none',
                background: '#F5A800', color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: triggerScan.isPending ? 'not-allowed' : 'pointer',
                opacity: triggerScan.isPending ? 0.7 : 1,
              }}
            >
              {triggerScan.isPending
                ? <Loader2 size={14} className="animate-spin" />
                : <RefreshCw size={14} />
              }
              {triggerScan.isPending ? 'Varrendo...' : 'Varrer agora'}
            </button>
          </div>
        </motion.div>

        {/* ── Stats ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}
        >
          <StatCard label="Total analisados"   value={total}      color="#1A1A1A" bg="#F5F5F5"  icon={<Inbox size={16} />} />
          <StatCard label="Aprovações"         value={approved}   color="#0F6E56" bg="#E1F5EE"  icon={<CheckCircle2 size={16} />} />
          <StatCard label="Reprovações"        value={rejected}   color="#A32D2D" bg="#FCEBEB"  icon={<XCircle size={16} />} />
          <StatCard label="Pendências"         value={pending}    color="#854F0B" bg="#FEF3D0"  icon={<AlertCircle size={16} />} />
          <StatCard label="Aguard. ação"       value={actionable} color="#185FA5" bg="#E6F1FB"  icon={<CheckSquare size={16} />} />
        </motion.div>

        {/* ── Barra próxima varredura ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          style={{ background: '#1A1A1A', borderRadius: 10, padding: '10px 18px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
        >
          <Clock size={14} style={{ color: '#F5A800', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Próxima varredura em</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#F5A800', fontVariantNumeric: 'tabular-nums' }}>{countdown}</span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
            {(config?.scan_times || ['08:00', '17:00']).map(t => (
              <span key={t} style={{ padding: '2px 8px', borderRadius: 99, background: 'rgba(245,168,0,0.15)', fontSize: 11, fontWeight: 700, color: '#F5A800' }}>
                {t}
              </span>
            ))}
          </div>
          {scanRuns[0]?.finished_at && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>
              Última: {formatDateBR(scanRuns[0].finished_at)}
            </span>
          )}
        </motion.div>

        {/* ── Layout split ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

          {/* Lista */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Filtros — linha 1: classificação */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {([
                { id: 'all',           label: 'Todas' },
                { id: 'approved',      label: 'Aprovações' },
                { id: 'rejected',      label: 'Reprovações' },
                { id: 'pending',       label: 'Pendências' },
                { id: 'inspection',    label: 'Vistoria' },
                { id: 'informational', label: 'Informativo' },
              ] as { id: FilterCL; label: string }[]).map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilterCL(f.id)}
                  style={{
                    padding: '5px 13px', borderRadius: 99, border: '1.5px solid',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                    borderColor: filterCL === f.id ? '#F5A800' : '#E0E0E0',
                    background:  filterCL === f.id ? '#F5A800' : '#fff',
                    color:       filterCL === f.id ? '#fff'    : '#666',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Filtros — linha 2: origem do email */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {([
                { id: 'all',              label: '📥 Todos os emails' },
                { id: 'concessionaire',   label: '⚡ Concessionárias' },
                { id: 'protocol_matched', label: '🔗 Protocolo vinculado' },
              ] as { id: FilterSource; label: string }[]).map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilterSource(f.id)}
                  style={{
                    padding: '4px 12px', borderRadius: 99, border: '1.5px solid',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                    borderColor: filterSource === f.id ? '#378ADD' : '#E0E0E0',
                    background:  filterSource === f.id ? '#E6F1FB' : '#fff',
                    color:       filterSource === f.id ? '#185FA5' : '#888',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Cards */}
            {isLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <Loader2 size={24} className="animate-spin" style={{ color: '#F5A800' }} />
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', gap: 10 }}>
                <Mail size={40} style={{ color: '#E0E0E0' }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: '#aaa', margin: 0 }}>
                  {filterCL === 'all' ? 'Nenhum email analisado ainda' : 'Nenhum email com este filtro'}
                </p>
                {filterCL === 'all' && agentStatus === 'not_configured' && isAdmin && (
                  <button
                    onClick={() => setConfigOpen(true)}
                    style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}
                  >
                    Configurar Claudinho →
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(u => (
                  <EmailCard key={u.id} update={u} onOpenProject={openProject} />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <Sidebar updates={allUpdates} scanRuns={scanRuns} />
        </div>
      </div>

      {/* Dialog de configuração */}
      {isAdmin && (
        <AgentConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
      )}

      {/* CSS para animação de pulse */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </MainLayout>
  );
}
