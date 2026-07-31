import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useDeleteProject } from '@/hooks/useDeleteProject';

interface DeleteProjectDialogProps {
  projectId: string;
  projectCode: string;
  companyName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function DeleteProjectDialog({
  projectId,
  projectCode,
  companyName,
  open,
  onOpenChange,
  onSuccess,
}: DeleteProjectDialogProps) {
  const [reason, setReason] = useState('');
  const deleteProject = useDeleteProject();

  // Rede de segurança: quem renderiza este diálogo é o card do projeto, e o
  // card some da lista no instante em que o projeto é excluído. Se o diálogo
  // for desmontado ABERTO, o Radix não roda a limpeza dele e o `<body>` fica
  // com `pointer-events: none` — a tela aparece normal mas não recebe clique
  // nenhum. Restaurar no desmonte cobre este caso e qualquer outro igual.
  useEffect(() => () => { document.body.style.pointerEvents = ''; }, []);

  const handleDelete = async () => {
    if (!reason.trim()) return;
    
    try {
      await deleteProject.mutateAsync({ projectId, reason: reason.trim() });
      setReason('');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      // Error is handled in the hook
    }
  };

  const isValid = reason.trim().length >= 10;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-destructive/10">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <AlertDialogTitle>Excluir Projeto</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <p className="text-sm font-medium text-foreground">{projectCode}</p>
                {companyName && (
                  <p className="text-xs text-muted-foreground">Empresa: {companyName}</p>
                )}
              </div>
              
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive font-medium">
                  Este projeto será removido do fluxo operacional do sistema.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Essa ação não pode ser desfeita pelo usuário. O projeto não aparecerá mais no Kanban, listagens ou dashboards.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="delete-reason" className="text-foreground">
                  Motivo da exclusão <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="delete-reason"
                  placeholder="Descreva o motivo da exclusão (mínimo 10 caracteres)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="min-h-[80px] resize-none"
                />
                {reason.length > 0 && reason.length < 10 && (
                  <p className="text-xs text-destructive">
                    O motivo deve ter pelo menos 10 caracteres
                  </p>
                )}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel 
            onClick={() => setReason('')}
            disabled={deleteProject.isPending}
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={!isValid || deleteProject.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteProject.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Excluindo...
              </>
            ) : (
              'Confirmar Exclusão'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
