import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { Plus, Search, Building2, Pencil, Eye, Link2, Copy, Check, RefreshCw, Loader2 } from 'lucide-react';
import { useCompanies, useCreateCompany, useUpdateCompany, useRegenerateCompanyToken } from '@/hooks/useCompanies';
import { useProjects } from '@/hooks/useProjects';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Database } from '@/integrations/supabase/types';
import { CompanyPricingFields, PricingState, emptyPricing, pricingToPayload, pricingFromCompany } from '@/components/admin/CompanyPricingFields';
type Company = Database['public']['Tables']['companies']['Row'];
export default function Companies() {
  const navigate = useNavigate();
  const {
    data: companies = [],
    isLoading
  } = useCompanies();
  const {
    data: projects = []
  } = useProjects();
  const createCompany = useCreateCompany();
  const updateCompany = useUpdateCompany();
  const regenerateToken = useRegenerateCompanyToken();
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    cnpj: '',
    contactName: '',
    email: '',
    phone: '',
    isActive: true
  });
  const [pricing, setPricing] = useState<PricingState>({ ...emptyPricing });
  const filteredCompanies = companies.filter(company => company.name.toLowerCase().includes(search.toLowerCase()) || company.contact_name.toLowerCase().includes(search.toLowerCase()) || company.contact_email.toLowerCase().includes(search.toLowerCase()));
  const getProjectCount = (companyId: string) => projects.filter(p => p.company_id === companyId).length;
  const getPublicLink = (token: string) => `${window.location.origin}/public-form/${token}`;
  const handleCopyLink = (company: Company) => {
    navigator.clipboard.writeText(getPublicLink(company.public_form_token));
    setCopiedId(company.id);
    toast.success('Link copiado!');
    setTimeout(() => setCopiedId(null), 2000);
  };
  const handleOpenNew = () => {
    setEditingCompany(null);
    setFormData({
      name: '',
      cnpj: '',
      contactName: '',
      email: '',
      phone: '',
      isActive: true
    });
    setPricing({ ...emptyPricing });
    setIsDialogOpen(true);
  };
  const handleEdit = (company: Company) => {
    setEditingCompany(company);
    setFormData({
      name: company.name,
      cnpj: company.cnpj,
      contactName: company.contact_name,
      email: company.contact_email,
      phone: company.contact_phone || '',
      isActive: company.active
    });
    setPricing(pricingFromCompany(company as unknown as Record<string, unknown>));
    setIsDialogOpen(true);
  };
  const handleSave = async () => {
    if (!formData.name || !formData.cnpj || !formData.contactName || !formData.email) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    try {
      if (editingCompany) {
        await updateCompany.mutateAsync({
          id: editingCompany.id,
          name: formData.name,
          cnpj: formData.cnpj,
          contact_name: formData.contactName,
          contact_email: formData.email,
          contact_phone: formData.phone || null,
          active: formData.isActive,
          ...pricingToPayload(pricing),
        } as never);
      } else {
        await createCompany.mutateAsync({
          name: formData.name,
          cnpj: formData.cnpj,
          contact_name: formData.contactName,
          contact_email: formData.email,
          contact_phone: formData.phone || null,
          active: formData.isActive,
          ...pricingToPayload(pricing),
        } as never);
      }
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Error saving company:', error);
    }
  };
  const handleViewAsCompany = (company: Company) => {
    sessionStorage.setItem('viewingAsCompany', JSON.stringify(company));
    navigate('/admin/view-as-company');
  };
  const handleRegenerateToken = (company: Company) => {
    regenerateToken.mutate(company.id);
  };
  if (isLoading) {
    return <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>;
  }
  return <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Empresas</h1>
            <p className="text-muted-foreground">Gerencie as empresas clientes</p>
          </div>
          <Button variant="cta" onClick={handleOpenNew}>
            <Plus className="w-4 h-4" />
            Nova Empresa
          </Button>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar empresa..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>

        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} className="kpi-card bg-muted">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Empresa</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Contato</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Projetos</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map(company => <tr key={company.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-primary-foreground">{company.name}</p>
                          <p className="text-xs text-muted-foreground">{company.cnpj}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{company.contact_name}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{company.contact_email}</td>
                    <td className="py-3 px-4 text-sm text-card-foreground">{getProjectCount(company.id)}</td>
                    <td className="py-3 px-4">
                      <Badge variant={company.active ? 'approved' : 'pending'}>{company.active ? 'Ativa' : 'Inativa'}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => handleEdit(company)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" title="Acessar como empresa" onClick={() => handleViewAsCompany(company)}><Eye className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" title="Copiar link público" onClick={() => handleCopyLink(company)}>
                          {copiedId === company.id ? <Check className="w-4 h-4 text-success" /> : <Link2 className="w-4 h-4" />}
                        </Button>
                      </div>
                    </td>
                  </tr>)}
              </tbody>
            </table>
          </div>
          {filteredCompanies.length === 0 && <div className="text-center py-12">
              <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Nenhuma empresa encontrada</p>
            </div>}
        </motion.div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCompany ? 'Editar Empresa' : 'Nova Empresa'}</DialogTitle>
            <DialogDescription>{editingCompany ? 'Atualize os dados da empresa' : 'Preencha os dados para cadastrar uma nova empresa'}</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Nome da Empresa *</Label><Input value={formData.name} onChange={e => setFormData({
              ...formData,
              name: e.target.value
            })} placeholder="Ex: Solar Tech LTDA" /></div>
            <div className="space-y-2"><Label>CNPJ *</Label><Input value={formData.cnpj} onChange={e => setFormData({
              ...formData,
              cnpj: e.target.value
            })} placeholder="00.000.000/0001-00" /></div>
            <div className="space-y-2"><Label>Nome do Contato *</Label><Input value={formData.contactName} onChange={e => setFormData({
              ...formData,
              contactName: e.target.value
            })} placeholder="Nome do responsável" /></div>
            <div className="space-y-2"><Label>Email do Contato *</Label><Input type="email" value={formData.email} onChange={e => setFormData({
              ...formData,
              email: e.target.value
            })} placeholder="contato@empresa.com" /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={formData.phone} onChange={e => setFormData({
              ...formData,
              phone: e.target.value
            })} placeholder="(00) 00000-0000" /></div>

            <div className="flex items-center justify-between pt-2">
              <Label>Status da empresa</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{formData.isActive ? 'Ativa' : 'Inativa'}</span>
                <Switch checked={formData.isActive} onCheckedChange={checked => setFormData({
                ...formData,
                isActive: checked
              })} />
              </div>
            </div>

            <CompanyPricingFields value={pricing} onChange={setPricing} />

            {editingCompany && <div className="pt-2 border-t border-border">
                <Label className="text-muted-foreground text-xs">Link público de envio</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input value={getPublicLink(editingCompany.public_form_token)} readOnly className="text-xs" />
                  <Button variant="outline" size="icon" onClick={() => handleCopyLink(editingCompany)} title="Copiar link"><Copy className="w-4 h-4" /></Button>
                  <Button variant="outline" size="icon" onClick={() => handleRegenerateToken(editingCompany)} title="Regenerar link"><RefreshCw className="w-4 h-4" /></Button>
                </div>
              </div>}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
            <Button variant="cta" onClick={handleSave} disabled={createCompany.isPending || updateCompany.isPending}>
              {(createCompany.isPending || updateCompany.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingCompany ? 'Salvar Alterações' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>;
}