import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFeatures } from '@/hooks/useTenant';
import {
  useNotificationRules, useSaveRule, useDeleteRule, sendTestEmail,
  NotificationRule, NOTIFY_EVENTS, NOTIFY_VARS,
} from '@/hooks/useNotificationRules';
import { toast } from 'sonner';
import { Zap, Plus, Pencil, Trash2, Mail, Loader2, Send, Lock, Bell } from 'lucide-react';

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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Zap className="w-6 h-6 text-primary" /> Automações</h1>
            <p className="text-muted-foreground">Avisos automáticos disparados por eventos dos projetos</p>
          </div>
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
