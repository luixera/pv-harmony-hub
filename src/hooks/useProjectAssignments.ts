import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProjectAssignment {
  id: string;
  project_id: string;
  staff_user_id: string;
  assigned_by: string | null;
  assigned_at: string;
  staff_name?: string;
  staff_email?: string;
}

export function useProjectAssignments(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-assignments', projectId],
    queryFn: async (): Promise<ProjectAssignment[]> => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from('project_assignments')
        .select(`
          *,
          staff:staff_user_id (name, email)
        `)
        .eq('project_id', projectId);

      if (error) throw error;

      return data.map((assignment: any) => ({
        ...assignment,
        staff_name: assignment.staff?.name,
        staff_email: assignment.staff?.email,
      }));
    },
    enabled: !!projectId,
  });
}

export function useStaffAssignments(staffUserId: string | undefined) {
  return useQuery({
    queryKey: ['staff-assignments', staffUserId],
    queryFn: async (): Promise<ProjectAssignment[]> => {
      if (!staffUserId) return [];

      const { data, error } = await supabase
        .from('project_assignments')
        .select('*')
        .eq('staff_user_id', staffUserId);

      if (error) throw error;
      return data;
    },
    enabled: !!staffUserId,
  });
}

export function useAssignStaffToProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      staffUserId,
      assignedBy,
    }: {
      projectId: string;
      staffUserId: string;
      assignedBy: string;
    }) => {
      const { data, error } = await supabase
        .from('project_assignments')
        .insert({
          project_id: projectId,
          staff_user_id: staffUserId,
          assigned_by: assignedBy,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project-assignments', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['staff-assignments', variables.staffUserId] });
      toast.success('Projetista atribuído com sucesso');
    },
    onError: (error: any) => {
      console.error('Error assigning staff:', error);
      if (error.code === '23505') {
        toast.error('Este projetista já está atribuído a este projeto');
      } else {
        toast.error('Erro ao atribuir projetista');
      }
    },
  });
}

export function useUnassignStaffFromProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      staffUserId,
    }: {
      projectId: string;
      staffUserId: string;
    }) => {
      const { error } = await supabase
        .from('project_assignments')
        .delete()
        .eq('project_id', projectId)
        .eq('staff_user_id', staffUserId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project-assignments', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['staff-assignments', variables.staffUserId] });
      toast.success('Atribuição removida com sucesso');
    },
    onError: (error) => {
      console.error('Error unassigning staff:', error);
      toast.error('Erro ao remover atribuição');
    },
  });
}

export function useAvailableStaffForProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['available-staff', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      // Get all staff users
      const { data: staffUsers, error: staffError } = await supabase
        .from('profiles')
        .select('id, name, email, staff_access_mode')
        .eq('role', 'staff')
        .eq('active', true);

      if (staffError) throw staffError;

      // Get already assigned staff
      const { data: assignments, error: assignError } = await supabase
        .from('project_assignments')
        .select('staff_user_id')
        .eq('project_id', projectId);

      if (assignError) throw assignError;

      const assignedIds = new Set(assignments.map(a => a.staff_user_id));

      // Filter out already assigned staff
      return staffUsers.filter(user => !assignedIds.has(user.id));
    },
    enabled: !!projectId,
  });
}
