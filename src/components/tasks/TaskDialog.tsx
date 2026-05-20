import { useState, useEffect, useRef } from 'react';
import { X, CheckSquare, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUsers } from '@/hooks/useUsers';
import { useProjects } from '@/hooks/useProjects';
import { useCreateTask, useUpdateTask, Task, TaskPriority } from '@/hooks/useTasks';

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task?: Task;
  defaultProjectId?: string;
}

const PRIORITY_CFG: Record<TaskPriority, { label: string; emoji: string; border: string; bg: string }> = {
  low:    { label: 'Baixa',   emoji: '🟢', border: '#2D6A4F', bg: '#E1F5EE' },
  medium: { label: 'Média',   emoji: '🟡', border: '#F5A800', bg: '#FEF3D0' },
  high:   { label: 'Alta',    emoji: '🟠', border: '#D85A30', bg: '#FFF0E6' },
  urgent: { label: 'Urgente', emoji: '🔴', border: '#E24B4A', bg: '#FCEBEB' },
};

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export function TaskDialog({ open, onOpenChange, task, defaultProjectId }: TaskDialogProps) {
  const { user } = useAuth();
  const { data: allUsers = [] } = useUsers();
  const { data: allProjects = [] } = useProjects();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const isEditing = !!task;

  // Form state
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority]       = useState<TaskPriority>('medium');
  const [dueDate, setDueDate]         = useState('');
  const [assignedTo, setAssignedTo]   = useState('');
  const [projectId, setProjectId]     = useState('');

  // Project search
  const [projectSearch, setProjectSearch] = useState('');
  const [projectDropOpen, setProjectDropOpen] = useState(false);
  const projectDropRef = useRef<HTMLDivElement>(null);

  // Populate form when editing
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setDueDate(task.due_date || '');
      setAssignedTo(task.assigned_to || '');
      setProjectId(task.project_id || '');
    } else {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setDueDate('');
      setAssignedTo(user?.id || '');
      setProjectId(defaultProjectId || '');
    }
  }, [task, user?.id, defaultProjectId, open]);

  // Close project dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projectDropRef.current && !projectDropRef.current.contains(e.target as Node)) {
        setProjectDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!open) return null;

  const today = new Date().toISOString().split('T')[0];
  const duePast = dueDate && dueDate < today;

  // Users available to assign (admin + staff)
  const assignableUsers = allUsers.filter(u => u.role === 'admin' || u.role === 'staff');

  // Projects for selector
  const filteredProjects = allProjects.filter(p => {
    if (!projectSearch) return true;
    const search = projectSearch.toLowerCase();
    return (
      p.code.toLowerCase().includes(search) ||
      (p.generalData?.holder_name || '').toLowerCase().includes(search)
    );
  });

  const selectedProject = allProjects.find(p => p.id === projectId);

  const roleLabel: Record<string, string> = { admin: 'Admin', staff: 'Staff' };

  const handleSubmit = async () => {
    if (!title.trim()) return;

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      due_date: dueDate || undefined,
      project_id: projectId || undefined,
      assigned_to: assignedTo || undefined,
    };

    if (isEditing) {
      await updateTask.mutateAsync({ id: task!.id, ...payload });
    } else {
      await createTask.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  const isPending = createTask.isPending || updateTask.isPending;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={() => onOpenChange(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(26,26,26,0.65)', backdropFilter: 'blur(2px)' }}
      />

      {/* Dialog */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px 16px', boxSizing: 'border-box',
        }}
        onClick={e => { if (e.target === e.currentTarget) onOpenChange(false); }}
      >
        <div
          style={{
            background: '#fff', borderRadius: 14,
            width: '100%', maxWidth: 520,
            boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column',
            maxHeight: '90vh', overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ background: '#1A1A1A', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(245,168,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckSquare size={15} color="#F5A800" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1 }}>
              {isEditing ? 'Editar Tarefa' : 'Nova Tarefa'}
            </p>
            <button
              onClick={() => onOpenChange(false)}
              style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>

            {/* Título */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Título *</p>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder='Ex: Verificar documentação do PRJ-XXXXX'
                autoFocus
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: `1px solid ${title.trim() ? '#E0E0E0' : '#F5A800'}`,
                  fontSize: 14, color: '#1A1A1A', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Descrição */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Descrição (opcional)</p>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder='Detalhes adicionais...'
                rows={3}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: '1px solid #E0E0E0', fontSize: 13, color: '#1A1A1A',
                  outline: 'none', resize: 'none', fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Prioridade */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Prioridade</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {PRIORITIES.map(p => {
                  const cfg = PRIORITY_CFG[p];
                  const active = priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      style={{
                        padding: '8px 4px', borderRadius: 8, border: `2px solid ${active ? cfg.border : '#E8E8E8'}`,
                        background: active ? cfg.bg : '#FAFAFA',
                        cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 14, marginBottom: 2 }}>{cfg.emoji}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: active ? cfg.border : '#888' }}>{cfg.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Data de vencimento */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Vencimento (opcional)</p>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: `1px solid ${duePast ? '#E24B4A' : '#E0E0E0'}`,
                  fontSize: 13, color: '#1A1A1A', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {duePast && (
                <p style={{ fontSize: 10, color: '#E24B4A', marginTop: 4 }}>⚠ Esta data já passou</p>
              )}
            </div>

            {/* Atribuir para */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Atribuir para</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Eu mesmo */}
                <button
                  type="button"
                  onClick={() => setAssignedTo(user?.id || '')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 8, border: `1.5px solid ${assignedTo === user?.id ? '#F5A800' : '#E8E8E8'}`,
                    background: assignedTo === user?.id ? '#FEF3D0' : '#FAFAFA',
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#F5A800', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1A1A1A', flexShrink: 0 }}>
                    {(user?.name || 'EU')[0].toUpperCase()}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', flex: 1 }}>
                    {user?.name} <span style={{ color: '#aaa', fontWeight: 400 }}>(eu mesmo)</span>
                  </span>
                  {assignedTo === user?.id && <span style={{ fontSize: 10, color: '#F5A800', fontWeight: 700 }}>✓</span>}
                </button>

                {/* Outros usuários */}
                {assignableUsers
                  .filter(u => u.id !== user?.id)
                  .map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setAssignedTo(u.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                        borderRadius: 8, border: `1.5px solid ${assignedTo === u.id ? '#F5A800' : '#E8E8E8'}`,
                        background: assignedTo === u.id ? '#FEF3D0' : '#FAFAFA',
                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: u.role === 'admin' ? '#FEF3D0' : '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: u.role === 'admin' ? '#854F0B' : '#185FA5', flexShrink: 0 }}>
                        {(u.name || '?')[0].toUpperCase()}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#1A1A1A', flex: 1 }}>{u.name}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: u.role === 'admin' ? '#FEF3D0' : '#E6F1FB', color: u.role === 'admin' ? '#854F0B' : '#185FA5' }}>
                        {roleLabel[u.role] || u.role}
                      </span>
                      {assignedTo === u.id && <span style={{ fontSize: 10, color: '#F5A800', fontWeight: 700 }}>✓</span>}
                    </button>
                  ))}
              </div>
            </div>

            {/* Projeto relacionado */}
            <div ref={projectDropRef} style={{ position: 'relative' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Projeto relacionado (opcional)</p>

              {selectedProject ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, border: '1px solid #F5A800', background: '#FEF3D0' }}>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#854F0B', flex: 1 }}>
                    {selectedProject.code} — {selectedProject.generalData?.holder_name || '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setProjectId(''); setProjectSearch(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#854F0B', padding: 0, display: 'flex' }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ position: 'relative' }}>
                    <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
                    <input
                      value={projectSearch}
                      onChange={e => { setProjectSearch(e.target.value); setProjectDropOpen(true); }}
                      onFocus={() => setProjectDropOpen(true)}
                      placeholder="Buscar por código ou titular..."
                      style={{
                        width: '100%', padding: '9px 12px 9px 30px', borderRadius: 8,
                        border: '1px solid #E0E0E0', fontSize: 12, color: '#1A1A1A',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  {projectDropOpen && filteredProjects.length > 0 && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                      background: '#fff', borderRadius: 8, border: '1px solid #E8E8E8',
                      boxShadow: '0 8px 20px rgba(0,0,0,0.10)', zIndex: 10,
                      maxHeight: 200, overflowY: 'auto',
                    }}>
                      {filteredProjects.slice(0, 20).map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setProjectId(p.id); setProjectSearch(''); setProjectDropOpen(false); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                            padding: '8px 12px', border: 'none', background: 'transparent',
                            cursor: 'pointer', textAlign: 'left',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#F8F8F8')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#F5A800', flexShrink: 0 }}>{p.code}</span>
                          <span style={{ fontSize: 11, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.generalData?.holder_name || '—'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid #F0F0F0', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #E8E8E8', background: '#FAFAFA', color: '#555', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!title.trim() || isPending}
              style={{
                flex: 2, padding: '10px 0', borderRadius: 8, border: 'none',
                background: title.trim() ? '#F5A800' : '#E0E0E0',
                color: title.trim() ? '#1A1A1A' : '#999',
                fontSize: 13, fontWeight: 700,
                cursor: title.trim() ? 'pointer' : 'default',
              }}
            >
              {isPending ? 'Salvando...' : isEditing ? 'Salvar Alterações' : 'Criar Tarefa'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
