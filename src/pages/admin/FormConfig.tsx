import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  useFormConfigs, 
  useFormConfigDetails, 
  useActivateFormConfig,
  useDuplicateFormConfig,
  useCreateFormConfig
} from '@/hooks/useFormConfig';
import { FormFieldEditor } from '@/components/forms/FormFieldEditor';
import { FormPreview } from '@/components/forms/FormPreview';
import { 
  Settings2, 
  Eye, 
  Copy, 
  CheckCircle2, 
  Plus,
  AlertTriangle
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function FormConfig() {
  const { data: configs, isLoading } = useFormConfigs();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const { data: selectedConfig } = useFormConfigDetails(selectedConfigId);
  const activateMutation = useActivateFormConfig();
  const duplicateMutation = useDuplicateFormConfig();
  const createMutation = useCreateFormConfig();
  
  const [showNewConfigDialog, setShowNewConfigDialog] = useState(false);
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [newConfigName, setNewConfigName] = useState('');
  const [newConfigDescription, setNewConfigDescription] = useState('');
  const [activeTab, setActiveTab] = useState('editor');

  const handleCreateConfig = async () => {
    if (!newConfigName.trim()) return;
    
    await createMutation.mutateAsync({
      name: newConfigName,
      description: newConfigDescription
    });
    
    setShowNewConfigDialog(false);
    setNewConfigName('');
    setNewConfigDescription('');
  };

  const handleActivateConfig = async () => {
    if (!selectedConfigId) return;
    
    await activateMutation.mutateAsync(selectedConfigId);
    setShowActivateDialog(false);
  };

  const handleDuplicateConfig = async (configId: string) => {
    await duplicateMutation.mutateAsync(configId);
  };

  // Auto-select active config on load
  if (configs && !selectedConfigId) {
    const activeConfig = configs.find(c => c.is_active);
    if (activeConfig) {
      setSelectedConfigId(activeConfig.id);
    } else if (configs.length > 0) {
      setSelectedConfigId(configs[0].id);
    }
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Configuração de Formulários</h1>
            <p className="text-muted-foreground">
              Configure campos, obrigatoriedades e regras condicionais do formulário de projetos
            </p>
          </div>
          
          <Dialog open={showNewConfigDialog} onOpenChange={setShowNewConfigDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Nova Configuração
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova Configuração</DialogTitle>
                <DialogDescription>
                  Crie uma nova configuração de formulário. Você pode copiar campos de uma configuração existente depois.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    value={newConfigName}
                    onChange={(e) => setNewConfigName(e.target.value)}
                    placeholder="Ex: Configuração 2024"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Descrição</Label>
                  <Textarea
                    id="description"
                    value={newConfigDescription}
                    onChange={(e) => setNewConfigDescription(e.target.value)}
                    placeholder="Descreva as alterações nesta configuração..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowNewConfigDialog(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateConfig} disabled={createMutation.isPending}>
                  Criar Configuração
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Config Selection */}
        <div className="grid gap-4 md:grid-cols-4">
          {isLoading ? (
            <Card className="col-span-4">
              <CardContent className="py-8 text-center text-muted-foreground">
                Carregando configurações...
              </CardContent>
            </Card>
          ) : configs?.length === 0 ? (
            <Card className="col-span-4">
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhuma configuração encontrada.
              </CardContent>
            </Card>
          ) : (
            configs?.map((config) => (
              <Card 
                key={config.id}
                className={`cursor-pointer transition-all hover:border-primary/50 ${
                  selectedConfigId === config.id ? 'border-primary ring-2 ring-primary/20' : ''
                }`}
                onClick={() => setSelectedConfigId(config.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{config.name}</CardTitle>
                    {config.is_active && (
                      <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Ativa
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    {config.description || 'Sem descrição'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Criada em {format(new Date(config.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </span>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicateConfig(config.id);
                        }}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Config Editor */}
        {selectedConfig && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Settings2 className="w-5 h-5" />
                    {selectedConfig.name}
                    {selectedConfig.is_active && (
                      <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
                        Configuração Ativa
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Última atualização: {format(new Date(selectedConfig.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </CardDescription>
                </div>
                
                {!selectedConfig.is_active && (
                  <Dialog open={showActivateDialog} onOpenChange={setShowActivateDialog}>
                    <DialogTrigger asChild>
                      <Button variant="default">
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Ativar Configuração
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-amber-500" />
                          Confirmar Ativação
                        </DialogTitle>
                        <DialogDescription className="pt-2">
                          <strong className="text-foreground">Esta configuração será aplicada a todos os formulários do sistema:</strong>
                          <ul className="mt-2 list-disc list-inside space-y-1">
                            <li>Formulário público (link para clientes)</li>
                            <li>Formulário interno da empresa</li>
                            <li>Visualização do administrador</li>
                          </ul>
                          <p className="mt-3 text-amber-600">
                            Projetos já enviados não serão afetados. Esta alteração afeta apenas novos envios.
                          </p>
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowActivateDialog(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={handleActivateConfig} disabled={activateMutation.isPending}>
                          Confirmar Ativação
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="editor">
                    <Settings2 className="w-4 h-4 mr-2" />
                    Editor de Campos
                  </TabsTrigger>
                  <TabsTrigger value="preview">
                    <Eye className="w-4 h-4 mr-2" />
                    Preview
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="editor">
                  <FormFieldEditor config={selectedConfig} />
                </TabsContent>
                
                <TabsContent value="preview">
                  <FormPreview config={selectedConfig} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
