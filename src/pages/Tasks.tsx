import { useState, useRef, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { motion } from 'framer-motion';
import {
  CheckSquare,
  Plus,
  MoreVertical,
  CheckCircle2,
  Circle,
  Loader2,
  FolderOpen,
  User,
  Calendar,
  XCircle,
  Pencil,
  PlayCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTasks, useUpdateTask, Task, TaskStatus, TaskPriority } from '@/hooks/useTasks';
import { TaskDialog } from '@/components/tasks/TaskDialog';
import { cn } from '@/lib/utils';

// ─── Priority config ──────────────────────────────────────────────────────────
const PRIORITY_CFG: Record<TaskPriority, { label: string; color: string; bg: string; border: string }> = {
  low:    { label: 'Baixa',   color: '#2D6A4F', bg: '#E1F5EE', border: '#2D6A4F' },
  medium: { label: 'Média',   color: '#F5A800', bg: '#FEF3D0', border: '#F5A800' },
  high:   { label: 'Alta',    color: '#D85A30', bg: '#FFF0E6', border: '#D85A30' },
  urgent: { label: 'Urgente', color: '#E24B4A', bg: '#FCEBEB', border: '#E24B4A' },
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending:     'Pendente',
  in_progress: 'Em andamento',
  completed:   'Concluída',
  cancelled:   'Cancelada',
};

type FilterView = 'mine' | 'by_me' | 'all';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDateBR(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR');
}

function isOverdue(dateStr: string | null, status: TaskStatus) {
  if (!dateStr || status === 'completed' || status === 'cancelled') return false;
  const today = new Date().toISOString().split('T')[0];
  return dateStr < today;
}

function isDueToday(dateStr: string | null) {
  if (!dateStr) return false;
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

// ─── Dropdown menu ────────────────────────────────────────────────────────────
interface DropdownMenuProps {
  task: Task;
  onEdit: () => void;
  onMarkInProgress: () => void;
  onCancel: () => void;
}

function TaskDropdown({ task, onEdit, onMarkInProgress, onCancel }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="p-1.5 rounded-md hover:bg-black/5 transition-colors text-gray-400 hover:text-gray-600"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[160px] py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onEdit(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </button>
          {task.status === 'pending' && (
            <button
              onClick={() => { onMarkInProgress(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              Marcar em andamento
            </button>
          )}
          <button
            onClick={() => { onCancel(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            Cancelar tarefa
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────
interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
}

function TaskCard({ task, onEdit }: TaskCardProps) {
  const updateTask = useUpdateTask();
  const navigate = useNavigate();
  const priority = PRIORITY_CFG[task.priority];
  const overdue = isOverdue(task.due_date, task.status);
  const today = isDueToday(task.due_date);
  const isDone = task.status === 'completed';

  // Atalho para o projeto da tarefa: o quadro já sabe abrir o modal sozinho
  // pelo parâmetro ?openProject=<id> (mesmo caminho usado por outros pontos do
  // sistema), então não é preciso uma rota nova. Tarefa solta — sem projeto —
  // continua sem clique, para não dar um "link morto".
  const projectId = task.project?.id ?? null;
  const abrirProjeto = projectId
    ? () => navigate(`/projects?openProject=${projectId}`)
    : undefined;

  function handleToggleComplete() {
    if (isDone) return;
    updateTask.mutate({ id: task.id, status: 'completed' });
  }

  function handleMarkInProgress() {
    updateTask.mutate({ id: task.id, status: 'in_progress' });
  }

  function handleCancel() {
    updateTask.mutate({ id: task.id, status: 'cancelled' });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-white rounded-xl border border-gray-100 shadow-sm flex items-stretch overflow-hidden',
        isDone && 'opacity-60'
      )}
    >
      {/* Priority border */}
      <div
        className="w-1 flex-shrink-0"
        style={{ backgroundColor: priority.border }}
      />

      {/* Content */}
      <div className="flex-1 px-4 py-3.5 flex items-start gap-3 min-w-0">
        {/* Checkbox — para o clique aqui e no menu, senão concluir a tarefa
            também navegaria para o projeto. */}
        <button
          onClick={e => { e.stopPropagation(); handleToggleComplete(); }}
          disabled={isDone || updateTask.isPending}
          className="mt-0.5 flex-shrink-0 text-gray-300 hover:text-green-500 transition-colors disabled:cursor-default"
        >
          {isDone ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <Circle className="w-5 h-5" />
          )}
        </button>

        {/* Main info — clicável quando a tarefa tem projeto */}
        <div
          className={cn('flex-1 min-w-0', abrirProjeto && 'cursor-pointer')}
          onClick={abrirProjeto}
          role={abrirProjeto ? 'link' : undefined}
          tabIndex={abrirProjeto ? 0 : undefined}
          onKeyDown={abrirProjeto ? e => { if (e.key === 'Enter') abrirProjeto(); } : undefined}
          title={abrirProjeto ? `Abrir o projeto ${task.project?.code}` : undefined}
        >
          <div className="flex items-start justify-between gap-2">
            <p className={cn(
              'text-sm font-medium text-gray-900 leading-snug',
              abrirProjeto && 'hover:underline',
              isDone && 'line-through text-gray-400',
            )}>
              {task.title}
            </p>

            <TaskDropdown
              task={task}
              onEdit={() => onEdit(task)}
              onMarkInProgress={handleMarkInProgress}
              onCancel={handleCancel}
            />
          </div>

          {task.description && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{task.description}</p>
          )}

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {/* Priority badge */}
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ color: priority.color, backgroundColor: priority.bg }}
            >
              {priority.label}
            </span>

            {/* Status badge (only if not pending) */}
            {task.status !== 'pending' && (
              <span className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium',
                task.status === 'in_progress' && 'bg-blue-50 text-blue-600',
                task.status === 'completed'   && 'bg-green-50 text-green-600',
                task.status === 'cancelled'   && 'bg-gray-100 text-gray-500',
              )}>
                {STATUS_LABELS[task.status]}
              </span>
            )}

            {/* Projeto — é o alvo do atalho, então destoa do cinza dos outros
                selos para anunciar que dali se chega a algum lugar. */}
            {task.project && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8A5300] bg-[rgba(245,168,0,0.12)] border border-[rgba(245,168,0,0.35)] rounded-full px-2 py-0.5 hover:bg-[rgba(245,168,0,0.22)] transition-colors"
              >
                <FolderOpen className="w-3 h-3" />
                {task.project.code}
              </span>
            )}

            {/* Assignee */}
            {task.assignee && (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                <User className="w-3 h-3" />
                {task.assignee.name}
              </span>
            )}

            {/* Due date */}
            {task.due_date && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[11px] font-medium',
                overdue ? 'text-red-500' : today ? 'text-orange-500' : 'text-gray-400'
              )}>
                <Calendar className="w-3 h-3" />
                {overdue ? `Venceu ${formatDateBR(task.due_date)}` : today ? 'Vence hoje' : formatDateBR(task.due_date)}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Tasks() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [view, setView]               = useState<FilterView>('mine');
  const [statusFilter, setStatus]     = useState<string>('');
  const [priorityFilter, setPriority] = useState<string>('');
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);

  // Build query filters
  const queryFilters = {
    ...(statusFilter  ? { status:      statusFilter  as TaskStatus  } : {}),
    ...(priorityFilter ? {} : {}), // priority filtered client-side (not in hook)
    ...(view === 'mine'  ? { assigned_to: user?.id } : {}),
    ...(view === 'by_me' ? { created_by:  user?.id } : {}),
  };

  const { data: tasks = [], isLoading } = useTasks(Object.keys(queryFilters).length ? queryFilters : undefined);

  // Client-side priority filter
  const filtered = priorityFilter
    ? tasks.filter(t => t.priority === priorityFilter)
    : tasks;

  const openCreate = () => { setEditingTask(undefined); setDialogOpen(true); };
  const openEdit   = (task: Task) => { setEditingTask(task); setDialogOpen(true); };

  return (
    <MainLayout>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #F5A800, #F5A80090)' }}
            >
              <CheckSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Tarefas</h1>
              <p className="text-xs text-gray-400">
                {isLoading ? '…' : `${filtered.length} tarefa${filtered.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>

          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            style={{ background: '#F5A800' }}
          >
            <Plus className="w-4 h-4" />
            Nova Tarefa
          </button>
        </motion.div>

        {/* Filter pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="flex flex-wrap gap-2"
        >
          {[
            { id: 'mine'  as FilterView, label: 'Minhas tarefas' },
            { id: 'by_me' as FilterView, label: 'Atribuídas por mim' },
            ...(isAdmin ? [{ id: 'all' as FilterView, label: 'Todas' }] : []),
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                view === v.id
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              )}
              style={view === v.id ? { background: '#F5A800', borderColor: '#F5A800' } : {}}
            >
              {v.label}
            </button>
          ))}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Status select */}
          <select
            value={statusFilter}
            onChange={e => setStatus(e.target.value)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-200 bg-white text-gray-500 focus:outline-none cursor-pointer"
          >
            <option value="">Todos os status</option>
            <option value="pending">Pendente</option>
            <option value="in_progress">Em andamento</option>
            <option value="completed">Concluída</option>
          </select>

          {/* Priority select */}
          <select
            value={priorityFilter}
            onChange={e => setPriority(e.target.value)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-200 bg-white text-gray-500 focus:outline-none cursor-pointer"
          >
            <option value="">Todas as prioridades</option>
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </select>
        </motion.div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 gap-3"
          >
            <CheckSquare className="w-12 h-12 text-gray-200" />
            <p className="text-sm font-medium text-gray-400">Nenhuma tarefa encontrada</p>
            <button
              onClick={openCreate}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#F5A800' }}
            >
              Criar primeira tarefa
            </button>
          </motion.div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map(task => (
              <TaskCard key={task.id} task={task} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
      />
    </MainLayout>
  );
}
