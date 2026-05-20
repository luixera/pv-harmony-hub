import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { Plus, Search, Users as UsersIcon, Pencil, User, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { UserRole } from '@/types';
import { useUsers, useUpdateUser, useDeleteUser } from '@/hooks/useUsers';
import { useCompanies } from '@/hooks/useCompanies';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StaffAccessSettings } from '@/components/staff/StaffAccessSettings';
import { Database } from '@/integrations/supabase/types';

type StaffAccessMode = Database['public']['Enums']['staff_access_mode'];

export default function Users() {
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
    companyId?: string;
    isActive?: boolean;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingUser, setDeletingUser] = useState<{ id: string; name: string } | null>(null);
  const {
    data: users = [],
    isLoading: usersLoading
  } = useUsers();
  const {
    data: companies = []
  } = useCompanies();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'staff' as UserRole,
    companyId: '',
    isActive: true,
    staffAccessMode: 'global' as StaffAccessMode,
    hideCompanyName: false,
  });
  const filteredUsers = users.filter(user => user.name.toLowerCase().includes(search.toLowerCase()) || user.email.toLowerCase().includes(search.toLowerCase()));
  const getCompanyName = (companyId?: string | null) => {
    if (!companyId) return '-';
    const company = companies.find(c => c.id === companyId);
    return company?.name || '-';
  };
  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <Badge variant="analysis">Administrador</Badge>;
      case 'staff':
        return <Badge variant="progress">Staff</Badge>;
      case 'company':
        return <Badge variant="approved">Empresa</Badge>;
    }
  };
  const handleOpenNew = () => {
    setEditingUser(null);
    setFormData({
      name: '',
      email: '',
      password: '',
      role: 'staff',
      companyId: '',
      isActive: true,
      staffAccessMode: 'global',
      hideCompanyName: false,
    });
    setIsDialogOpen(true);
  };
  const handleEdit = (user: typeof users[0]) => {
    setEditingUser({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
      companyId: user.company_id || undefined,
      isActive: user.active
    });
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      // Password is not editable here
      role: user.role as UserRole,
      companyId: user.company_id || '',
      isActive: user.active ?? true,
      staffAccessMode: (user as any).staff_access_mode || 'global',
      hideCompanyName: (user as any).hide_company_name || false,
    });
    setIsDialogOpen(true);
  };
  const handleSave = async () => {
    if (!formData.name || !formData.email) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    if (formData.role === 'company' && !formData.companyId) {
      toast.error('Selecione a empresa vinculada');
      return;
    }

    // For new users, password is required
    if (!editingUser && !formData.password) {
      toast.error('Senha é obrigatória para novos usuários');
      return;
    }
    if (!editingUser && formData.password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingUser) {
        // Update existing user
        const updateData: any = {
          id: editingUser.id,
          name: formData.name,
          role: formData.role,
          company_id: formData.role === 'company' ? formData.companyId : null,
          active: formData.isActive,
        };
        
        // Add staff-specific fields only for staff role
        if (formData.role === 'staff') {
          updateData.staff_access_mode = formData.staffAccessMode;
          updateData.hide_company_name = formData.hideCompanyName;
        }
        
        await updateUser.mutateAsync(updateData);
        toast.success('Usuário atualizado!');
      } else {
        // Create new user via edge function
        const {
          data,
          error
        } = await supabase.functions.invoke('create-user', {
          body: {
            email: formData.email,
            password: formData.password,
            name: formData.name,
            role: formData.role,
            companyId: formData.role === 'company' ? formData.companyId : undefined,
            active: formData.isActive
          }
        });
        if (error) {
          console.error('Edge function error:', error);
          throw new Error(error.message || 'Erro ao criar usuário');
        }
        if (data?.error) {
          throw new Error(data.error);
        }
        queryClient.invalidateQueries({ queryKey: ['users'] });
        toast.success('Usuário criado com sucesso!');
      }
      setIsDialogOpen(false);
    } catch (error: any) {
      console.error('Error saving user:', error);
      toast.error(error.message || 'Erro ao salvar usuário');
    } finally {
      setIsSubmitting(false);
    }
  };
  if (usersLoading) {
    return <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>;
  }
  return <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Usuários</h1>
            <p className="text-muted-foreground">Gerencie os usuários do sistema</p>
          </div>
          <Button variant="cta" onClick={handleOpenNew}>
            <Plus className="w-4 h-4" />
            Novo Usuário
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar usuário..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>

        {/* Users List */}
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} className="kpi-card bg-secondary">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Usuário</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Tipo</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Empresa</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => <tr key={user.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="w-5 h-5 text-primary" />
                        </div>
                        <p className="text-sm font-medium text-primary-foreground">{user.name}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{user.email}</td>
                    <td className="py-3 px-4">{getRoleBadge(user.role as UserRole)}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {getCompanyName(user.company_id)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={user.active !== false ? 'approved' : 'pending'}>
                        {user.active !== false ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => handleEdit(user)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Excluir"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeletingUser({ id: user.id, name: user.name })}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>)}
              </tbody>
            </table>
          </div>

          {filteredUsers.length === 0 && <div className="text-center py-12">
              <UsersIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Nenhum usuário encontrado</p>
            </div>}
        </motion.div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingUser} onOpenChange={open => { if (!open) setDeletingUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Usuário</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o usuário <strong>{deletingUser?.name}</strong>?
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setDeletingUser(null)} disabled={deleteUser.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteUser.isPending}
              onClick={() => {
                if (!deletingUser) return;
                deleteUser.mutate(deletingUser.id, {
                  onSuccess: () => setDeletingUser(null),
                });
              }}
            >
              {deleteUser.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Excluindo...</>
              ) : 'Excluir'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* User Form Dialog — modal=false so Select dropdowns (company) are not blocked by DismissableLayer */}
      <Dialog modal={false} open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
            </DialogTitle>
            <DialogDescription>
              {editingUser ? 'Atualize os dados do usuário' : 'Preencha os dados para cadastrar um novo usuário'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={formData.name} onChange={e => setFormData({
              ...formData,
              name: e.target.value
            })} placeholder="Nome completo" />
            </div>
            
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={formData.email} onChange={e => setFormData({
              ...formData,
              email: e.target.value
            })} placeholder="email@exemplo.com" disabled={!!editingUser} // Email cannot be changed after creation
            />
            </div>

            {/* Password field - only for new users */}
            {!editingUser && <div className="space-y-2">
                <Label>Senha *</Label>
                <div className="relative">
                  <Input 
                    type="text" 
                    value={formData.password} 
                    onChange={e => setFormData({
                      ...formData,
                      password: e.target.value
                    })} 
                    placeholder="Mínimo 6 caracteres" 
                    className="font-mono"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  ⚠️ A senha está visível apenas durante a criação. Copie-a agora para compartilhar com o usuário.
                  Após salvar, não será possível visualizá-la novamente.
                </p>
              </div>}
            
            <div className="space-y-2">
              <Label>Tipo de Usuário *</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'admin', label: 'Administrador' },
                  { value: 'staff', label: 'Staff' },
                  { value: 'company', label: 'Empresa' },
                ] as { value: UserRole; label: string }[]).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      role: opt.value,
                      companyId: opt.value !== 'company' ? '' : formData.companyId,
                    })}
                    className={[
                      'py-2 px-2 rounded-md border text-sm font-medium transition-colors text-center',
                      formData.role === opt.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-input hover:bg-muted text-foreground',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            
            {formData.role === 'company' && <div className="space-y-2">
                <Label>Empresa Vinculada *</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData({
              ...formData,
              companyId: v
            })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.filter(c => c.active).map(company => <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>)}
                  </SelectContent>
                </Select>
              </div>}

            <div className="flex items-center justify-between pt-2">
              <Label>Status do usuário</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {formData.isActive ? 'Ativo' : 'Inativo'}
                </span>
                <Switch checked={formData.isActive} onCheckedChange={checked => setFormData({
                ...formData,
                isActive: checked
              })} />
              </div>
            </div>

            {/* Staff Access Settings */}
            {formData.role === 'staff' && (
              <StaffAccessSettings
                staffAccessMode={formData.staffAccessMode}
                hideCompanyName={formData.hideCompanyName}
                onChange={({ staffAccessMode, hideCompanyName }) => setFormData({
                  ...formData,
                  staffAccessMode,
                  hideCompanyName,
                })}
              />
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button variant="cta" onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Salvando...
                </> : editingUser ? 'Salvar Alterações' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>;
}