import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GripVertical, Plus, Trash2, Edit, Flag, CheckCircle, AlertTriangle, Clock, Hash } from 'lucide-react';
import { KanbanColumn, KanbanModel, useCreateKanbanColumn, useUpdateKanbanColumn, useDeleteKanbanColumn, useUpdateColumnOrder, useUpdateColumnRejectionStage } from '@/hooks/useKanbanConfig';
import { toast } from 'sonner';

interface KanbanColumnEditorProps {
  model: KanbanModel;
}

const colorOptions = [
  { value: 'bg-muted', label: 'Cinza', preview: 'bg-muted' },
  { value: 'bg-kanban-analysis', label: 'Azul', preview: 'bg-blue-500' },
  { value: 'bg-kanban-progress', label: 'Amarelo', preview: 'bg-yellow-500' },
  { value: 'bg-kanban-approved', label: 'Verde', preview: 'bg-green-500' },
  { value: 'bg-kanban-completed', label: 'Verde Escuro', preview: 'bg-emerald-600' },
  { value: 'bg-primary', label: 'Primária', preview: 'bg-primary' },
  { value: 'bg-destructive', label: 'Vermelho', preview: 'bg-red-500' },
  { value: 'bg-orange-500', label: 'Laranja', preview: 'bg-orange-500' },
  { value: 'bg-purple-500', label: 'Roxo', preview: 'bg-purple-500' },
];

export function KanbanColumnEditor({ model }: KanbanColumnEditorProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | null>(null);
  const [newColumn, setNewColumn] = useState({
    status_key: '',
    status_label: '',
    color: 'bg-muted',
    is_initial: false,
    is_final: false,
    is_rejection_stage: false,
    requires_protocol: false,
    stale_days: '' as string,
  });

  const createColumn = useCreateKanbanColumn();
  const updateColumn = useUpdateKanbanColumn();
  const deleteColumn = useDeleteKanbanColumn();
  const updateOrder = useUpdateColumnOrder();
  const updateRejectionStage = useUpdateColumnRejectionStage();

  const columns = model.columns || [];

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(columns);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    const updates = items.map((item, index) => ({
      id: item.id,
      order_index: index
    }));

    updateOrder.mutate(updates);
  };

  const handleAddColumn = () => {
    if (!newColumn.status_key || !newColumn.status_label) return;

    const staleDays = newColumn.stale_days !== '' ? parseInt(newColumn.stale_days, 10) : null;

    createColumn.mutate({
      kanban_model_id: model.id,
      status_key: newColumn.status_key,
      status_label: newColumn.status_label,
      color: newColumn.color,
      order_index: columns.length,
      is_initial: newColumn.is_initial,
      is_final: newColumn.is_final,
      is_rejection_stage: newColumn.is_rejection_stage,
      triggers_revision: newColumn.is_rejection_stage,
      requires_protocol: newColumn.requires_protocol,
      stale_days: isNaN(staleDays as number) ? null : staleDays,
    }, {
      onSuccess: (created) => {
        // If this is the rejection stage, ensure uniqueness
        if (newColumn.is_rejection_stage) {
          updateRejectionStage.mutate({
            columnId: created.id,
            modelId: model.id,
            isRejectionStage: true,
          });
        }
        setShowAddDialog(false);
        setNewColumn({
          status_key: '',
          status_label: '',
          color: 'bg-muted',
          is_initial: false,
          is_final: false,
          is_rejection_stage: false,
          requires_protocol: false,
          stale_days: '',
        });
      }
    });
  };

  const handleUpdateColumn = () => {
    if (!editingColumn) return;

    updateColumn.mutate({
      id: editingColumn.id,
      status_label: editingColumn.status_label,
      color: editingColumn.color,
      is_initial: editingColumn.is_initial,
      is_final: editingColumn.is_final,
      requires_protocol: editingColumn.requires_protocol,
      stale_days: editingColumn.stale_days ?? null,
    }, {
      onSuccess: () => {
        // Handle rejection stage change separately (needs uniqueness enforcement)
        const original = columns.find(c => c.id === editingColumn.id);
        if (original && original.is_rejection_stage !== editingColumn.is_rejection_stage) {
          if (editingColumn.is_rejection_stage) {
            const otherRejection = columns.find(
              c => c.id !== editingColumn.id && c.is_rejection_stage
            );
            if (otherRejection) {
              toast.warning(
                'Apenas uma coluna pode ser marcada como reprovação por modelo. A coluna anterior foi desmarcada automaticamente.'
              );
            }
          }
          updateRejectionStage.mutate({
            columnId: editingColumn.id,
            modelId: model.id,
            isRejectionStage: editingColumn.is_rejection_stage,
          });
        }
        setEditingColumn(null);
      }
    });
  };

  const handleDeleteColumn = (columnId: string) => {
    if (confirm('Tem certeza que deseja remover esta coluna? Projetos neste status podem ficar inconsistentes.')) {
      deleteColumn.mutate(columnId);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Colunas do Kanban</CardTitle>
            <CardDescription>Arraste para reordenar as colunas</CardDescription>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Coluna
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova Coluna</DialogTitle>
                <DialogDescription>
                  Adicione uma nova coluna ao modelo de Kanban
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Chave do Status (não pode ser alterada)</Label>
                  <Input
                    placeholder="ex: em_revisao"
                    value={newColumn.status_key}
                    onChange={(e) => setNewColumn({ ...newColumn, status_key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use apenas letras minúsculas e underscores
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Rótulo</Label>
                  <Input
                    placeholder="ex: Em Revisão"
                    value={newColumn.status_label}
                    onChange={(e) => setNewColumn({ ...newColumn, status_label: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cor</Label>
                  <Select value={newColumn.color} onValueChange={(v) => setNewColumn({ ...newColumn, color: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {colorOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded ${opt.preview}`} />
                            <span>{opt.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Status Inicial</Label>
                  <Switch
                    checked={newColumn.is_initial}
                    onCheckedChange={(v) => setNewColumn({ ...newColumn, is_initial: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Status Final</Label>
                  <Switch
                    checked={newColumn.is_final}
                    onCheckedChange={(v) => setNewColumn({ ...newColumn, is_final: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <Label className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      Coluna de Reprovação
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Projetos movidos para esta coluna ativarão o sistema de revisões
                    </p>
                  </div>
                  <Switch
                    checked={newColumn.is_rejection_stage}
                    onCheckedChange={(v) => setNewColumn({ ...newColumn, is_rejection_stage: v })}
                  />
                </div>
                {/* Toggle: Exige protocolo */}
                <div
                  style={{
                    background: '#F8F8F8',
                    borderRadius: 8,
                    padding: '10px 12px',
                    marginTop: 4,
                    border: '0.5px solid #EFEFEF',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Hash size={13} color="#378ADD" />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A' }}>
                        Exige número de protocolo
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: '#888', margin: 0, lineHeight: 1.4 }}>
                      Ao mover projeto para esta coluna, o sistema solicitará o número de protocolo da concessionária
                    </p>
                  </div>
                  <Switch
                    checked={newColumn.requires_protocol}
                    onCheckedChange={(v) => setNewColumn({ ...newColumn, requires_protocol: v })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600" />
                    Alerta de projeto parado (dias)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Ex: 7 (deixe vazio para sem limite)"
                    value={newColumn.stale_days}
                    onChange={(e) => setNewColumn({ ...newColumn, stale_days: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Projetos sem movimentação por este número de dias gerarão alertas. Deixe vazio para desativar.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleAddColumn} disabled={createColumn.isPending}>
                  Adicionar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="columns">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                {columns.map((column, index) => (
                  <Draggable key={column.id} draggableId={column.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`flex items-center gap-3 p-3 bg-card border rounded-lg ${
                          snapshot.isDragging ? 'shadow-lg ring-2 ring-primary' : ''
                        } ${column.is_rejection_stage ? 'border-red-300 bg-red-50' : ''}`}
                      >
                        <div {...provided.dragHandleProps} className="cursor-grab">
                          <GripVertical className="w-5 h-5 text-muted-foreground" />
                        </div>
                        
                        <div className={`w-4 h-4 rounded-full ${column.color}`} />
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{column.status_label}</span>
                            <code className="text-xs text-muted-foreground bg-muted px-1 rounded">
                              {column.status_key}
                            </code>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {column.is_initial && (
                            <Badge variant="outline" className="text-xs">
                              <Flag className="w-3 h-3 mr-1" />
                              Inicial
                            </Badge>
                          )}
                          {column.is_final && (
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Final
                            </Badge>
                          )}
                          {column.is_rejection_stage && (
                            <Badge
                              className="text-[9px] gap-1"
                              style={{
                                background: '#FCEBEB',
                                color: '#A32D2D',
                                border: '0.5px solid #E24B4A',
                              }}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Reprovação
                            </Badge>
                          )}
                          {column.requires_protocol && (
                            <Badge
                              className="text-[9px] gap-1"
                              style={{
                                background: '#E6F1FB',
                                color: '#185FA5',
                                border: '0.5px solid #378ADD',
                                borderRadius: 20,
                              }}
                            >
                              <Hash className="w-2.5 h-2.5" />
                              Protocolo obrigatório
                            </Badge>
                          )}
                          {column.stale_days != null && (
                            <Badge
                              className="text-[9px] gap-1"
                              style={{
                                background: '#FFFBEB',
                                color: '#92400E',
                                border: '0.5px solid #F59E0B',
                              }}
                            >
                              <Clock className="w-2.5 h-2.5" />
                              {column.stale_days}d
                            </Badge>
                          )}
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingColumn(column)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => handleDeleteColumn(column.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {columns.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            Nenhuma coluna configurada. Adicione colunas para começar.
          </div>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={!!editingColumn} onOpenChange={(open) => !open && setEditingColumn(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Coluna</DialogTitle>
            <DialogDescription>
              Edite as propriedades da coluna (a chave não pode ser alterada)
            </DialogDescription>
          </DialogHeader>
          {editingColumn && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Chave do Status</Label>
                <Input value={editingColumn.status_key} disabled />
              </div>
              <div className="space-y-2">
                <Label>Rótulo</Label>
                <Input
                  value={editingColumn.status_label}
                  onChange={(e) => setEditingColumn({ ...editingColumn, status_label: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Cor</Label>
                <Select 
                  value={editingColumn.color} 
                  onValueChange={(v) => setEditingColumn({ ...editingColumn, color: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {colorOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded ${opt.preview}`} />
                          <span>{opt.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Status Inicial</Label>
                <Switch
                  checked={editingColumn.is_initial}
                  onCheckedChange={(v) => setEditingColumn({ ...editingColumn, is_initial: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Status Final</Label>
                <Switch
                  checked={editingColumn.is_final}
                  onCheckedChange={(v) => setEditingColumn({ ...editingColumn, is_final: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <Label className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
                    Coluna de Reprovação
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Projetos movidos para esta coluna ativarão o sistema de revisões
                  </p>
                </div>
                <Switch
                  checked={editingColumn.is_rejection_stage}
                  onCheckedChange={(v) => setEditingColumn({ ...editingColumn, is_rejection_stage: v })}
                />
              </div>
              {/* Toggle: Exige protocolo (Edit) */}
              <div
                style={{
                  background: '#F8F8F8',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginTop: 4,
                  border: '0.5px solid #EFEFEF',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <Hash size={13} color="#378ADD" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A' }}>
                      Exige número de protocolo
                    </span>
                  </div>
                  <p style={{ fontSize: 10, color: '#888', margin: 0, lineHeight: 1.4 }}>
                    Ao mover projeto para esta coluna, o sistema solicitará o número de protocolo da concessionária
                  </p>
                </div>
                <Switch
                  checked={editingColumn.requires_protocol ?? false}
                  onCheckedChange={(v) => setEditingColumn({ ...editingColumn, requires_protocol: v })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  Alerta de projeto parado (dias)
                </Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="Ex: 7 (deixe vazio para sem limite)"
                  value={editingColumn.stale_days ?? ''}
                  onChange={(e) =>
                    setEditingColumn({
                      ...editingColumn,
                      stale_days: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Projetos sem movimentação por este número de dias gerarão alertas. Deixe vazio para desativar.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingColumn(null)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateColumn} disabled={updateColumn.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
