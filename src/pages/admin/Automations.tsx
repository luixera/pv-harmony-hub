import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFeatures } from '@/hooks/useTenant';
import {
  useNotificationRules, useSaveRule, useDeleteRule, sendTestEmail,
  NotificationRule, NOTIFY_EVENTS, NOTIFY_VARS,
} from '@/hooks/useNotificationRules';
import {
  useTaskAutomations, useSaveTaskAutomation, useDeleteTaskAutomation,
  TaskAutomation, TASK_AUTOMATION_VARS, TASK_PRIORITIES,
} from '@/hooks/useTaskAutomations';
import { useDefaultKanbanModel } from '@/hooks/useKanbanConfig';
import { useUsers } from '@/hooks/useUsers';
import { toast } from 'sonner';
import { Zap, Plus, Pencil, Trash2, Mail, Loader2, Send, Lock, Bell, ListChecks, ArrowRight, CalendarClock } from 'lucide-react';

export default function Automations() {
  const { user } = useAuth();
  const features = useTenantFeatures();
  const { data: rules = [], isLoading } = useNotificationRules();
  const deleteRule = useDeleteRule();
  const [editing, setEditing] = useState<NotificationRule | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const allowed = features.automations !== false;

  if (!allowed) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
          <Lock className="w-10 h-10 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Automações</h1>
          <p className="text-muted-foreground max-w-sm">
            Este recurso está disponível no plano Pro. Faça upgrade para enviar avisos automáticos por e-mail (e, em breve, WhatsApp).
          </p>
        </div>
      </MainLayout>
    );
  }

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (r: NotificationRule) => { setEditing(r); setDialogOpen(true); };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Zap className="w-6 h-6 text-primary" /> Automações</h1>
          <p className="text-muted-foreground">O que o sistema faz sozinho quando algo acontece nos projetos</p>
        </div>

        <Tabs defaultValue="tarefas">
          <TabsList>
            <TabsTrigger value="tarefas" className="gap-2"><ListChecks className="w-4 h-4" /> Tarefas automáticas</TabsTrigger>
            <TabsTrigger value="email" className="gap-2"><Mail className="w-4 h-4" /> Avisos por e-mail</TabsTrigger>
          </TabsList>

          <TabsContent value="tarefas" className="mt-6">
            <TaskAutomationsPanel tenantId={user?.tenantId ?? ''} />
          </TabsContent>

          <TabsContent value="email" className="mt-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-sm text-muted-foreground">Avisos por e-mail disparados por eventos dos projetos</p>
              <Button variant="cta" onClick={openNew}><Plus className="w-4 h-4" /> Nova automação</Button>
            </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border border-dashed border-border rounded-xl">
            <Bell className="w-9 h-9 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma automação ainda. Crie uma para avisar sua equipe quando um projeto chegar.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {rules.map(r => (
              <div key={r.id} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                <div className="p-2 rounded-lg bg-primary/10"><Mail className="w-4 h-4 text-primary" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {NOTIFY_EVENTS.find(e => e.value === r.event)?.label ?? r.event}
                    </span>
                    {!r.enabled && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">Desligada</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">→ {r.destination}</p>
                  {r.subject && <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">Assunto: {r.subject}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Remover "${r.name}"?`)) deleteRule.mutate(r.id); }}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
          </TabsContent>
        </Tabs>
      </div>

      {dialogOpen && (
        <RuleDialog editing={editing} tenantId={user?.tenantId ?? ''} onClose={() => setDialogOpen(false)} />
      )}
    </MainLayout>
  );
}

function RuleDialog({ editing, tenantId, onClose }: { editing: NotificationRule | null; tenantId: string; onClose: () => void }) {
  const save = useSaveRule();
  const [name, setName] = useState(editing?.name ?? 'Aviso de novo projeto');
  const [event] = useState(editing?.event ?? 'project_created');
  const [destination, setDestination] = useState(editing?.destination ?? '');
  const [subject, setSubject] = useState(editing?.subject ?? 'Novo projeto recebido: {codigo}');
  const [body, setBody] = useState(editing?.body ?? 'Um novo projeto chegou:\n\nCódigo: {codigo}\nTitular: {titular}\nEmpresa: {empresa}\nConcessionária: {concessionaria}\nCidade: {cidade}/{uf}\n\nPotência: {potencia_total}');
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    if (!destination.trim()) { toast.error('Informe o destinatário (e-mail)'); return; }
    await save.mutateAsync({
      id: editing?.id, tenant_id: tenantId, name: name.trim(), event,
      channel: 'email', destination: destination.trim(), subject: subject.trim(), body, enabled,
    });
    onClose();
  };

  const handleTest = async () => {
    const to = testTo.trim() || destination.split(',')[0]?.trim();
    if (!to) { toast.error('Informe um e-mail para o teste'); return; }
    setTesting(true);
    const r = await sendTestEmail(to, subject, body);
    setTesting(false);
    if (r.ok) toast.success(`E-mail de teste enviado para ${to}`);
    else toast.error(r.error ?? 'Falha no envio de teste');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar automação' : 'Nova automação'}</DialogTitle>
          <DialogDescription>Envia um e-mail automático quando o evento acontecer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Evento</Label>
              <Select value={event} disabled><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTIFY_EVENTS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Canal</Label>
              <Select value="email" disabled><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="email">E-mail</SelectItem></SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Destinatário(s) — e-mail</Label>
            <Input value={destination} onChange={e => setDestination(e.target.value)} placeholder="equipe@empresa.com, outro@empresa.com" />
            <p className="text-[11px] text-muted-foreground">Separe múltiplos e-mails por vírgula.</p>
          </div>

          <div className="space-y-2"><Label>Assunto</Label><Input value={subject} onChange={e => setSubject(e.target.value)} /></div>
          <div className="space-y-2"><Label>Mensagem</Label><Textarea rows={7} value={body} onChange={e => setBody(e.target.value)} /></div>

          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Variáveis disponíveis (clique para copiar)</p>
            <div className="flex flex-wrap gap-1.5">
              {NOTIFY_VARS.map(v => (
                <button key={v} type="button" onClick={() => { navigator.clipboard.writeText(`{${v}}`); toast.success(`{${v}} copiado`); }}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-background border border-border text-muted-foreground hover:text-foreground">
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Label>Automação ativa</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Teste */}
          <div className="flex items-end gap-2 pt-2 border-t border-border">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Testar envio para</Label>
              <Input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="seu@email.com" />
            </div>
            <Button variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Testar
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="cta" onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tarefas automáticas por mudança de etapa do Kanban
//
// As etapas oferecidas aqui saem do TEMPLATE DE KANBAN ativo (kanban_columns),
// nunca de uma lista escrita à mão: se o template ganhar, perder ou renomear
// uma coluna, esta tela acompanha sozinha. Quem cria a tarefa de fato é o
// gatilho trg_task_automations, no banco.
// ─────────────────────────────────────────────────────────────────────────────

function TaskAutomationsPanel({ tenantId }: { tenantId: string }) {
  const { data: rules = [], isLoading } = useTaskAutomations();
  const { data: kanban } = useDefaultKanbanModel();
  const { data: allUsers = [] } = useUsers();
  const del = useDeleteTaskAutomation();
  const [editing, setEditing] = useState<TaskAutomation | null>(null);
  const [open, setOpen] = useState(false);

  const etapas = kanban?.columns ?? [];
  const rotulo = (key: string | null) =>
    key == null ? 'Qualquer etapa' : (etapas.find(c => c.status_key === key)?.status_label ?? key);
  const nomeDe = (id: string) => allUsers.find(u => u.id === id)?.name ?? 'Usuário removido';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Quando o card muda de etapa no Kanban, uma tarefa é criada para o responsável com prazo em dias.
        </p>
        <Button variant="cta" onClick={() => { setEditing(null); setOpen(true); }} disabled={etapas.length === 0}>
          <Plus className="w-4 h-4" /> Nova tarefa automática
        </Button>
      </div>

      {etapas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border border-dashed border-border rounded-xl">
          <ListChecks className="w-9 h-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-sm">
            Nenhum modelo de Kanban ativo com colunas. Configure as etapas em
            Configurações → Kanban para poder criar tarefas automáticas.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border border-dashed border-border rounded-xl">
          <ListChecks className="w-9 h-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-md">
            Nenhuma tarefa automática ainda. Exemplo: quando o card entra em
            "Vistoria Solicitada", criar a tarefa "Agendar vistoria" para o projetista com 5 dias de prazo.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rules.map(r => (
            <div key={r.id} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
              <div className="p-2 rounded-lg bg-primary/10"><ListChecks className="w-4 h-4 text-primary" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{r.name}</span>
                  {!r.enabled && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">Desligada</span>}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground mt-1">
                  <span className="px-2 py-0.5 rounded-full bg-muted">{rotulo(r.from_status)}</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-0.5 rounded-full bg-muted text-foreground">{rotulo(r.to_status)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span>Para <strong className="text-foreground font-medium">{nomeDe(r.assigned_to)}</strong></span>
                  <span className="inline-flex items-center gap-1"><CalendarClock className="w-3 h-3" /> {r.days_to_complete} {r.days_to_complete === 1 ? 'dia' : 'dias'}</span>
                  <span>· {TASK_PRIORITIES.find(p => p.value === r.priority)?.label ?? r.priority}</span>
                </p>
                <p className="text-xs text-muted-foreground/80 mt-1 truncate">Tarefa: {r.title}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Remover "${r.name}"?`)) del.mutate(r.id); }}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <TaskAutomationDialog
          editing={editing}
          tenantId={tenantId}
          etapas={etapas.map(c => ({ key: c.status_key, label: c.status_label }))}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function TaskAutomationDialog({
  editing, tenantId, etapas, onClose,
}: {
  editing: TaskAutomation | null;
  tenantId: string;
  etapas: { key: string; label: string }[];
  onClose: () => void;
}) {
  const save = useSaveTaskAutomation();
  const { data: allUsers = [] } = useUsers();
  // Só admin e projetista recebem tarefa — a empresa integradora não executa
  // etapa interna (mesma regra do modal de tarefas).
  const responsaveis = allUsers.filter(u => u.role === 'admin' || u.role === 'staff');

  const [name, setName]         = useState(editing?.name ?? '');
  const [fromStatus, setFrom]   = useState(editing?.from_status ?? '__qualquer__');
  const [toStatus, setTo]       = useState(editing?.to_status ?? '');
  const [assignedTo, setAssign] = useState(editing?.assigned_to ?? '');
  const [days, setDays]         = useState(String(editing?.days_to_complete ?? 3));
  const [priority, setPriority] = useState<TaskAutomation['priority']>(editing?.priority ?? 'medium');
  const [title, setTitle]       = useState(editing?.title ?? '');
  const [description, setDesc]  = useState(editing?.description ?? '');
  const [enabled, setEnabled]   = useState(editing?.enabled ?? true);

  const handleSave = async () => {
    if (!name.trim())  { toast.error('Dê um nome à automação'); return; }
    if (!toStatus)     { toast.error('Escolha a etapa que dispara a tarefa'); return; }
    if (!assignedTo)   { toast.error('Escolha o responsável pela tarefa'); return; }
    if (!title.trim()) { toast.error('Escreva o título da tarefa'); return; }
    const dias = parseInt(days, 10);
    if (isNaN(dias) || dias < 0 || dias > 365) { toast.error('Prazo entre 0 e 365 dias'); return; }

    await save.mutateAsync({
      id: editing?.id,
      tenant_id: tenantId,
      name: name.trim(),
      from_status: fromStatus === '__qualquer__' ? null : fromStatus,
      to_status: toStatus,
      assigned_to: assignedTo,
      days_to_complete: dias,
      priority,
      title: title.trim(),
      description: description.trim() || null,
      enabled,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar tarefa automática' : 'Nova tarefa automática'}</DialogTitle>
          <DialogDescription>
            Cria uma tarefa para alguém da equipe assim que o card entra na etapa escolhida.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nome da automação</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Agendar vistoria" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Vindo da etapa</Label>
              <Select value={fromStatus} onValueChange={setFrom}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__qualquer__">Qualquer etapa</SelectItem>
                  {etapas.map(e => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quando entrar em</Label>
              <Select value={toStatus} onValueChange={setTo}>
                <SelectTrigger><SelectValue placeholder="Escolha a etapa" /></SelectTrigger>
                <SelectContent>
                  {etapas.map(e => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">
            As etapas são as do modelo de Kanban em uso — mudou lá, muda aqui.
          </p>

          <div className="space-y-2">
            <Label>Responsável pela tarefa</Label>
            <Select value={assignedTo} onValueChange={setAssign}>
              <SelectTrigger><SelectValue placeholder="Escolha um admin ou projetista" /></SelectTrigger>
              <SelectContent>
                {responsaveis.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.role === 'admin' ? 'Admin' : 'Projetista'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Prazo (dias)</Label>
              <Input type="number" min={0} max={365} value={days} onChange={e => setDays(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Contados a partir da mudança de etapa.</p>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={v => setPriority(v as TaskAutomation['priority'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Título da tarefa</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Agendar vistoria do {codigo}" />
          </div>

          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Textarea rows={4} value={description} onChange={e => setDesc(e.target.value)}
              placeholder={'Projeto {codigo} — {titular} ({empresa})\nEntrou em "{etapa}". Prazo de {dias} dias.'} />
          </div>

          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Variáveis disponíveis (clique para copiar)</p>
            <div className="flex flex-wrap gap-1.5">
              {TASK_AUTOMATION_VARS.map(v => (
                <button key={v} type="button"
                  onClick={() => { navigator.clipboard.writeText(`{${v}}`); toast.success(`{${v}} copiado`); }}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-background border border-border text-muted-foreground hover:text-foreground">
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Label>Automação ativa</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="cta" onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
