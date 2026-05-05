import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Download, Trash2, FileText, Loader2, File } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  useConcessionaireDocuments, 
  useUploadConcessionaireDocument,
  useDeleteConcessionaireDocument,
  ConcessionaireDocument 
} from '@/hooks/useConcessionaireDocuments';
import { EnergyConcessionaire } from '@/hooks/useEnergyConcessionaires';
import { useAuth } from '@/contexts/AuthContext';

interface ConcessionaireDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concessionaire: EnergyConcessionaire | null;
}

export function ConcessionaireDocumentsDialog({ 
  open, 
  onOpenChange, 
  concessionaire 
}: ConcessionaireDocumentsDialogProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === 'admin';
  
  const { data: documents = [], isLoading } = useConcessionaireDocuments(concessionaire?.id);
  const uploadMutation = useUploadConcessionaireDocument();
  const deleteMutation = useDeleteConcessionaireDocument();
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !concessionaire) return;
    
    for (let i = 0; i < files.length; i++) {
      await uploadMutation.mutateAsync({
        concessionaireId: concessionaire.id,
        file: files[i],
      });
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const handleDownload = async (doc: ConcessionaireDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from('concessionaire-documents')
        .createSignedUrl(doc.file_path, 60);
      
      if (error) throw error;
      
      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = doc.file_name;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Erro ao baixar documento');
    }
  };
  
  const handleDelete = async (doc: ConcessionaireDocument) => {
    if (!concessionaire) return;
    
    if (!confirm(`Tem certeza que deseja excluir "${doc.file_name}"?`)) return;
    
    await deleteMutation.mutateAsync({
      id: doc.id,
      filePath: doc.file_path,
      concessionaireId: concessionaire.id,
    });
  };
  
  const getFileIcon = (fileName: string) => {
    const ext = fileName.toLowerCase().split('.').pop();
    if (['pdf'].includes(ext || '')) return <FileText className="w-4 h-4 text-red-500" />;
    if (['doc', 'docx'].includes(ext || '')) return <FileText className="w-4 h-4 text-blue-500" />;
    if (['xls', 'xlsx'].includes(ext || '')) return <FileText className="w-4 h-4 text-green-500" />;
    return <File className="w-4 h-4 text-muted-foreground" />;
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Documentos - {concessionaire?.name}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Upload button (admin only) */}
          {isAdmin && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
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
                Enviar Documento
              </Button>
            </div>
          )}
          
          {/* Documents list */}
          <ScrollArea className="h-[300px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : documents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Nenhum documento cadastrado</p>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div 
                    key={doc.id} 
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    {getFileIcon(doc.file_name)}
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(doc.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Button 
                        size="icon" 
                        variant="ghost"
                        onClick={() => handleDownload(doc)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      
                      {isAdmin && (
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => handleDelete(doc)}
                          disabled={deleteMutation.isPending}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          
          {/* Info badge */}
          {!isAdmin && documents.length > 0 && (
            <Badge variant="secondary" className="w-full justify-center">
              Visualização apenas - Contate um administrador para alterações
            </Badge>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
