import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useCreateConcessionaire, useUpdateConcessionaire, EnergyConcessionaire } from '@/hooks/useEnergyConcessionaires';

interface ConcessionaireFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concessionaire?: EnergyConcessionaire | null;
}

export function ConcessionaireFormDialog({ 
  open, 
  onOpenChange, 
  concessionaire 
}: ConcessionaireFormDialogProps) {
  const [name, setName] = useState('');
  const createMutation = useCreateConcessionaire();
  const updateMutation = useUpdateConcessionaire();
  
  const isEditing = !!concessionaire;
  const isLoading = createMutation.isPending || updateMutation.isPending;
  
  useEffect(() => {
    if (open) {
      setName(concessionaire?.name || '');
    }
  }, [open, concessionaire]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) return;
    
    try {
      if (isEditing && concessionaire) {
        await updateMutation.mutateAsync({ id: concessionaire.id, name });
      } else {
        await createMutation.mutateAsync(name);
      }
      onOpenChange(false);
    } catch (error) {
      // Error handled by mutation
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar Concessionária' : 'Nova Concessionária'}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da Concessionária *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: CEMIG, CPFL, Enel..."
              autoFocus
            />
          </div>
          
          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEditing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
