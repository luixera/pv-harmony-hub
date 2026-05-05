import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  useProjectAssignments, 
  useAvailableStaffForProject,
  useAssignStaffToProject,
  useUnassignStaffFromProject 
} from '@/hooks/useProjectAssignments';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, UserPlus, UserMinus, Users } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface StaffAssignmentDialogProps {
  projectId: string;
  projectCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StaffAssignmentDialog({
  projectId,
  projectCode,
  open,
  onOpenChange,
}: StaffAssignmentDialogProps) {
  const { user } = useAuth();
  const [selectedStaff, setSelectedStaff] = useState<string>('');

  const { data: assignments = [], isLoading: loadingAssignments } = useProjectAssignments(projectId);
  const { data: availableStaff = [], isLoading: loadingStaff } = useAvailableStaffForProject(projectId);
  const assignStaff = useAssignStaffToProject();
  const unassignStaff = useUnassignStaffFromProject();

  const handleAssign = async () => {
    if (!selectedStaff || !user) return;
    
    await assignStaff.mutateAsync({
      projectId,
      staffUserId: selectedStaff,
      assignedBy: user.id,
    });
    
    setSelectedStaff('');
  };

  const handleUnassign = async (staffUserId: string) => {
    await unassignStaff.mutateAsync({
      projectId,
      staffUserId,
    });
  };

  const isLoading = loadingAssignments || loadingStaff;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Projetistas Atribuídos
          </DialogTitle>
          <DialogDescription>
            Gerencie os projetistas atribuídos ao projeto {projectCode}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Add Staff Section */}
            <div className="flex gap-2">
              <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecione um projetista..." />
                </SelectTrigger>
                <SelectContent>
                  {availableStaff.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-2">
                      Todos os projetistas já estão atribuídos
                    </div>
                  ) : (
                    availableStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        <div className="flex flex-col">
                          <span>{staff.name}</span>
                          <span className="text-xs text-muted-foreground">{staff.email}</span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button 
                onClick={handleAssign} 
                disabled={!selectedStaff || assignStaff.isPending}
              >
                {assignStaff.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
              </Button>
            </div>

            {/* Current Assignments List */}
            <div className="border rounded-lg">
              <div className="px-4 py-2 bg-muted/50 border-b">
                <h4 className="text-sm font-medium">Projetistas Atuais ({assignments.length})</h4>
              </div>
              <ScrollArea className="h-64">
                {assignments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Users className="w-10 h-10 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Nenhum projetista atribuído
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {assignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {assignment.staff_name || 'Staff'}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {assignment.staff_email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Atribuído em: {format(new Date(assignment.assigned_at), "dd/MM/yyyy", { locale: ptBR })}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleUnassign(assignment.staff_user_id)}
                          disabled={unassignStaff.isPending}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          {unassignStaff.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <UserMinus className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
