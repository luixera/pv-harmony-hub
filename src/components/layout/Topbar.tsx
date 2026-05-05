import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Bell, LogOut, User, Settings, Menu, Search, Loader2, X, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from '@/hooks/useNotifications';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface TopbarProps {
  onMenuClick?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando', analysis: 'Em Análise', documentation: 'Documentação',
  approval: 'Aprovação', approved: 'Aprovado', completed: 'Concluído',
};

interface SearchResult {
  id: string;
  code: string;
  holder_name: string;
  status: string;
}

// ── Global Search ──────────────────────────────────────────────────────────────
function GlobalSearch({ onOpenModal }: { onOpenModal: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const [gdRes, codeRes] = await Promise.all([
        supabase
          .from('project_general_data')
          .select('project_id, holder_name')
          .or(`holder_name.ilike.%${q}%,holder_cpf_cnpj.ilike.%${q}%,holder_email.ilike.%${q}%,uc_number.ilike.%${q}%`)
          .limit(6),
        supabase
          .from('projects')
          .select('id, code, status')
          .ilike('code', `%${q}%`)
          .eq('is_deleted', false)
          .limit(6),
      ]);

      const projectIds = new Set([
        ...(gdRes.data || []).map(d => d.project_id),
        ...(codeRes.data || []).map(p => p.id),
      ]);

      if (projectIds.size === 0) { setResults([]); setOpen(true); setLoading(false); return; }

      const { data: projects } = await supabase
        .from('projects')
        .select('id, code, status')
        .in('id', Array.from(projectIds))
        .eq('is_deleted', false)
        .limit(6);

      const gdMap = new Map((gdRes.data || []).map(d => [d.project_id, d]));
      const mapped: SearchResult[] = (projects || []).map(p => ({
        id: p.id,
        code: p.code,
        holder_name: gdMap.get(p.id)?.holder_name || '—',
        status: p.status,
      }));

      setResults(mapped);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelect = (id: string) => {
    onOpenModal(id);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: 280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8F8F8', border: '1px solid #E8E8E8', borderRadius: 8, padding: '6px 10px' }}>
        {loading
          ? <Loader2 size={14} style={{ color: '#F5A800', flexShrink: 0, animation: 'spin 1s linear infinite' }} className="animate-spin" />
          : <Search size={14} style={{ color: '#888', flexShrink: 0 }} />
        }
        <input
          value={query}
          onChange={handleChange}
          onFocus={() => { if (results.length > 0 || query.length >= 2) setOpen(true); }}
          placeholder="Buscar projeto, titular, CPF..."
          style={{ flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: 13, color: '#1A1A1A', minWidth: 0 }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#999' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: '#fff', borderRadius: 10, border: '0.5px solid #E0E0E0', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, overflow: 'hidden' }}>
          {results.length === 0 ? (
            <p style={{ padding: '14px 16px', fontSize: 13, color: '#999', textAlign: 'center' }}>Nenhum resultado encontrado</p>
          ) : (
            results.map(r => (
              <button
                key={r.id}
                onClick={() => handleSelect(r.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8F8F8')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#F5A800' }}>{r.code}</span>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#F0F0F0', color: '#666', fontWeight: 600 }}>{STATUS_LABELS[r.status] || r.status}</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.holder_name}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Notification Bell ─────────────────────────────────────────────────────────
function NotificationBell({ onOpenModal }: { onOpenModal: (id: string) => void }) {
  const { data: notifications = [] } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = (notif: typeof notifications[0]) => {
    if (!notif.read) markAsRead.mutate(notif.id);
    if (notif.project_id) { onOpenModal(notif.project_id); setOpen(false); }
  };

  const typeIcon: Record<string, string> = {
    info: '💬', status: '🔄', document: '📄', financial: '💰',
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ position: 'relative', width: 40, height: 40, borderRadius: 8, border: 'none', background: open ? '#F8F8F8' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8,
            background: '#E24B4A', color: '#fff', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
            border: '2px solid #fff',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340, background: '#fff', borderRadius: 12, border: '0.5px solid #E0E0E0', boxShadow: '0 12px 40px rgba(0,0,0,0.14)', zIndex: 200, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #F0F0F0' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A' }}>Notificações</p>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead.mutate()}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#F5A800', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <CheckCheck size={12} /> Marcar todas como lidas
              </button>
            )}
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: '#999' }}>Nenhuma notificação</p>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{ display: 'flex', gap: 10, width: '100%', padding: '12px 16px', border: 'none', textAlign: 'left', cursor: 'pointer', background: n.read ? '#fff' : '#F8F8F8', borderBottom: '1px solid #F5F5F5' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F0F0F0')}
                  onMouseLeave={e => (e.currentTarget.style.background = n.read ? '#fff' : '#F8F8F8')}
                >
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{typeIcon[n.type] || '🔔'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <p style={{ fontSize: 12, fontWeight: n.read ? 500 : 700, color: '#1A1A1A', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</p>
                      {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3B82F6', flexShrink: 0 }} />}
                    </div>
                    <p style={{ fontSize: 11, color: '#666', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</p>
                    <p style={{ fontSize: 10, color: '#999', marginTop: 3 }}>
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          <div style={{ padding: '10px 16px', borderTop: '1px solid #F0F0F0', textAlign: 'center' }}>
            <p style={{ fontSize: 11, color: '#999' }}>Ver todas as notificações (em breve)</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Topbar ───────────────────────────────────────────────────────────────
export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const pageTitle = user?.role === 'admin' ? 'Painel Administrativo'
    : user?.role === 'staff' ? 'Área do Projetista'
    : 'Área da Empresa';

  return (
    <>
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="h-14 md:h-16 bg-white border-b border-[#E5E5E5] flex items-center justify-between px-4 md:px-6 sticky top-0 z-30"
      >
        <div className="flex items-center gap-3">
          {isMobile && (
            <button
              onClick={onMenuClick}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground -ml-1"
              aria-label="Abrir menu"
            >
              <Menu className="w-6 h-6" />
            </button>
          )}
          <h1 className="text-base md:text-lg font-semibold text-foreground">
            {pageTitle}
          </h1>
        </div>

        {/* Global Search — desktop only */}
        {!isMobile && (
          <GlobalSearch onOpenModal={setModalProjectId} />
        )}

        <div className="flex items-center gap-1 md:gap-2">
          <NotificationBell onOpenModal={setModalProjectId} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 h-10 py-1 px-2 md:px-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: user?.avatar ? 'transparent' : '#F5A800', border: '2px solid #F5A800' }}>
                  {user?.avatar
                    ? <img src={user.avatar} alt={user?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A' }}>
                        {user?.name ? (user.name.trim().split(' ').length > 1
                          ? (user.name.trim().split(' ')[0][0] + user.name.trim().split(' ').slice(-1)[0][0]).toUpperCase()
                          : user.name.slice(0, 2).toUpperCase()
                        ) : <User className="w-4 h-4" style={{ color: '#1A1A1A' }} />}
                      </span>
                  }
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-sm font-medium leading-tight">{user?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize leading-tight">{user?.role}</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover border-border">
              <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/profile')} className="min-h-[44px]">
                <User className="w-4 h-4 mr-2" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')} className="min-h-[44px]">
                <Settings className="w-4 h-4 mr-2" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive min-h-[44px]">
                <LogOut className="w-4 h-4 mr-2" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.header>

      {modalProjectId && (
        <ProjectModal
          projectId={modalProjectId}
          onClose={() => setModalProjectId(null)}
        />
      )}
    </>
  );
}
