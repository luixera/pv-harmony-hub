import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Trash2, FileText, Loader2, Info } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  useConcessionaireTemplates,
  useUploadConcessionaireTemplate,
  useDeleteConcessionaireTemplate,
  ConcessionaireTemplate,
} from '@/hooks/useConcessionaireTemplates';
import { EnergyConcessionaire } from '@/hooks/useEnergyConcessionaires';
import { useAuth } from '@/contexts/AuthContext';

interface ConcessionaireTemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concessionaire: EnergyConcessionaire | null;
}

const TEMPLATE_VARIABLES = [
  { var: '{codigo_projeto}', desc: 'Código do projeto' },
  { var: '{empresa}', desc: 'Nome da empresa' },
  { var: '{concessionaria}', desc: 'Nome da concessionária' },
  { var: '{nome_titular}', desc: 'Nome do titular' },
  { var: '{cpf_cnpj}', desc: 'CPF/CNPJ do titular' },
  { var: '{email_titular}', desc: 'Email do titular' },
  { var: '{telefone_titular}', desc: 'Telefone do titular' },
  { var: '{endereco}', desc: 'Endereço' },
  { var: '{cidade}', desc: 'Cidade' },
  { var: '{estado}', desc: 'Estado' },
  { var: '{endereco_completo}', desc: 'Endereço completo (rua, cidade/estado)' },
  { var: '{uc}', desc: 'Número da UC' },
  { var: '{fase}', desc: 'Tipo de fase' },
  { var: '{disjuntor}', desc: 'Corrente do disjuntor' },
  { var: '{marca_modulo}', desc: 'Marca dos módulos' },
  { var: '{modelo_modulo}', desc: 'Modelo dos módulos' },
  { var: '{potencia_modulo}', desc: 'Potência dos módulos' },
  { var: '{qtd_modulos}', desc: 'Quantidade de módulos' },
  { var: '{marca_inversor}', desc: 'Marca do inversor' },
  { var: '{modelo_inversor}', desc: 'Modelo do inversor' },
  { var: '{potencia_inversor}', desc: 'Potência do inversor' },
  { var: '{qtd_inversores}', desc: 'Quantidade de inversores' },
  { var: '{potencia_total}', desc: 'Potência total instalada (kWp)' },
  { var: '{data_criacao}', desc: 'Data de criação do projeto' },
];

export function ConcessionaireTemplatesDialog({
  open,
  onOpenChange,
  concessionaire,
}: ConcessionaireTemplatesDialogProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === 'admin';

  const { data: templates = [], isLoading } = useConcessionaireTemplates(concessionaire?.id);
  const uploadMutation = useUploadConcessionaireTemplate();
  const deleteMutation = useDeleteConcessionaireTemplate();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !concessionaire) return;

    for (let i = 0; i < files.length; i++) {
      await uploadMutation.mutateAsync({
        concessionaireId: concessionaire.id,
        file: files[i],
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (template: ConcessionaireTemplate) => {
    if (!concessionaire) return;
    if (!confirm(`Tem certeza que deseja excluir "${template.name}"?`)) return;
    await deleteMutation.mutateAsync({
      concessionaireId: concessionaire.id,
      path: template.path,
    });
  };

  const getDisplayName = (fileName: string) => {
    // Remove timestamp prefix (e.g. "1712345678_modelo.docx" → "modelo.docx")
    return fileName.replace(/^\d+_/, '');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Templates de Documento - {concessionaire?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload (admin only) */}
          {isAdmin && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".docx"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="w-full gap-2"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Enviar Template (.docx)
              </Button>
            </div>
          )}

          {/* Templates list */}
          <ScrollArea className="h-[200px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Nenhum template cadastrado</p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => (
                  <div
                    key={template.path}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {getDisplayName(template.name)}
                      </p>
                      {template.created_at && (
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(template.created_at), "dd/MM/yyyy 'às' HH:mm", {
                            locale: ptBR,
                          })}
                        </p>
                      )}
                    </div>

                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(template)}
                        disabled={deleteMutation.isPending}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Variables reference */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium">Variáveis disponíveis no template</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Use essas variáveis no arquivo .docx. Elas serão substituídas pelos dados do projeto ao gerar o documento.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto">
              {TEMPLATE_VARIABLES.map(({ var: v, desc }) => (
                <div key={v} className="flex items-start gap-2 text-xs">
                  <code className="bg-background border rounded px-1 py-0.5 text-primary font-mono whitespace-nowrap">
                    {v}
                  </code>
                  <span className="text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
