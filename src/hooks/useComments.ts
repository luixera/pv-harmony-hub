import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';

type Comment = Database['public']['Tables']['comments']['Row'];

export interface CommentWithUser extends Comment {
  userName?: string;
  userRole?: string;
}

export function useComments(projectId: string | undefined) {
  return useQuery({
    queryKey: ['comments', projectId],
    queryFn: async (): Promise<CommentWithUser[]> => {
      if (!projectId) return [];

      const { data: comments, error } = await supabase
        .from('comments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Fetch user info for each comment
      const userIds = [...new Set(comments.map(c => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, role')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, { name: p.name, role: p.role }]));

      return comments.map(comment => ({
        ...comment,
        userName: profileMap.get(comment.user_id)?.name || 'Usuário',
        userRole: profileMap.get(comment.user_id)?.role,
      }));
    },
    enabled: !!projectId,
  });
}

export function useRecentComments() {
  return useQuery({
    queryKey: ['recent-comments'],
    queryFn: async (): Promise<CommentWithUser[]> => {
      const { data: comments, error } = await supabase
        .from('comments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Fetch user info
      const userIds = [...new Set(comments.map(c => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, role')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, { name: p.name, role: p.role }]));

      return comments.map(comment => ({
        ...comment,
        userName: profileMap.get(comment.user_id)?.name || 'Usuário',
        userRole: profileMap.get(comment.user_id)?.role,
      }));
    },
  });
}

interface AddCommentParams {
  projectId: string;
  message: string;
  type?: string;
}

export function useAddComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, message, type = 'comment' }: AddCommentParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { data, error } = await supabase
        .from('comments')
        .insert({
          project_id: projectId,
          user_id: user.id,
          message,
          type,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['recent-comments'] });
      toast.success('Comentário enviado');
    },
    onError: (error) => {
      console.error('Error adding comment:', error);
      toast.error('Erro ao enviar comentário');
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (comment: Comment) => {
      const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', comment.id);

      if (error) throw error;
    },
    onSuccess: (_, comment) => {
      queryClient.invalidateQueries({ queryKey: ['comments', comment.project_id] });
      queryClient.invalidateQueries({ queryKey: ['recent-comments'] });
      toast.success('Comentário removido');
    },
    onError: (error) => {
      console.error('Error deleting comment:', error);
      toast.error('Erro ao remover comentário');
    },
  });
}
