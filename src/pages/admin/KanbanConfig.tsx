import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Copy, Kanban, Settings, Building2, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { 
  useKanbanModels, 
  useKanbanModelDetails, 
  useCreateKanbanModel, 
  useDuplicateKanbanModel,
  useUpdateKanbanModel
} from '@/hooks/useKanbanConfig';
import { KanbanColumnEditor } from '@/components/kanban/KanbanColumnEditor';
import { KanbanPreview } from '@/components/kanban/KanbanPreview';
import { CompanyKanbanAssignment } from '@/components/kanban/CompanyKanbanAssignment';

export default function KanbanConfig() {
  const { data: models = [], isLoading } = useKanbanModels();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const { data: selectedModel, isLoading: isLoadingDetails } = useKanbanModelDetails(selectedModelId);
  
  const createModel = useCreateKanbanModel();
  const duplicateModel = useDuplicateKanbanModel();
  const updateModel = useUpdateKanbanModel();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newModelData, setNewModelData] = useState({ name: '', description: '' });
  const [activeTab, setActiveTab] = useState('models');

  // Set first model as selected on load
  useState(() => {
    if (models.length > 0 && !selectedModelId) {
      const activeModel = models.find(m => m.is_active);
      setSelectedModelId(activeModel?.id || models[0].id);
    }
  });

  const handleCreateModel = () => {
    if (!newModelData.name) return;

    createModel.mutate(newModelData, {
      onSuccess: (model) => {
        setShowCreateDialog(false);
        setNewModelData({ name: '', description: '' });
        setSelectedModelId(model.id);
      }
    });
  };

  const handleDuplicateModel = (modelId: string) => {
    duplicateModel.mutate(modelId, {
      onSuccess: (model) => {
        setSelectedModelId(model.id);
      }
    });
  };

  const handleToggleActive = (modelId: string, isActive: boolean) => {
    updateModel.mutate({ id: modelId, is_active: !isActive });
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <Kanban className="w-8 h-8 text-primary" />
              Configuração de Kanban
            </h1>
            <p className="text-muted-foreground mt-1">
              Configure modelos de Kanban e atribua a empresas
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="models" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Modelos
            </TabsTrigger>
            <TabsTrigger value="companies" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Empresas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Models List */}
              <div className="lg:col-span-1 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Modelos de Kanban</h2>
                  <Button size="sm" onClick={() => setShowCreateDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Novo
                  </Button>
                </div>

                <div className="space-y-2">
                  {models.map((model, index) => (
                    <motion.div
                      key={model.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card 
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          selectedModelId === model.id ? 'ring-2 ring-primary' : ''
                        }`}
                        onClick={() => setSelectedModelId(model.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="font-medium">{model.name}</h3>
                                {model.is_active ? (
                                  <Badge variant="success">Ativo</Badge>
                                ) : (
                                  <Badge variant="secondary">Inativo</Badge>
                                )}
                              </div>
                              {model.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {model.description}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateModel(model.id);
                              }}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}

                  {models.length === 0 && (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        Nenhum modelo criado. Clique em "Novo" para começar.
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              {/* Model Editor */}
              <div className="lg:col-span-2 space-y-6">
                {isLoadingDetails ? (
                  <Card>
                    <CardContent className="py-12 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </CardContent>
                  </Card>
                ) : selectedModel ? (
                  <>
                    {/* Model Info */}
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle>{selectedModel.name}</CardTitle>
                            <CardDescription>
                              {selectedModel.description || 'Sem descrição'}
                            </CardDescription>
                          </div>
                          <Button
                            variant={selectedModel.is_active ? 'destructive' : 'default'}
                            size="sm"
                            onClick={() => handleToggleActive(selectedModel.id, selectedModel.is_active)}
                          >
                            {selectedModel.is_active ? 'Desativar' : 'Ativar'}
                          </Button>
                        </div>
                      </CardHeader>
                    </Card>

                    {/* Column Editor */}
                    <KanbanColumnEditor model={selectedModel} />

                    {/* Preview */}
                    <KanbanPreview model={selectedModel} />
                  </>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      Selecione um modelo para editar ou crie um novo.
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="companies" className="mt-6">
            <CompanyKanbanAssignment />
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Modelo de Kanban</DialogTitle>
            <DialogDescription>
              Crie um novo modelo de Kanban para configurar fluxos personalizados
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome</label>
              <Input
                placeholder="ex: Fluxo Simplificado"
                value={newModelData.name}
                onChange={(e) => setNewModelData({ ...newModelData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição (opcional)</label>
              <Textarea
                placeholder="Descreva o propósito deste modelo..."
                value={newModelData.description}
                onChange={(e) => setNewModelData({ ...newModelData, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateModel} disabled={createModel.isPending || !newModelData.name}>
              Criar Modelo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
