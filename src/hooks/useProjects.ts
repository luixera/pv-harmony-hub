import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { toProjectStatus } from '@/lib/statusMapping';

type Project = Database['public']['Tables']['projects']['Row'];
type ProjectGeneralData = Database['public']['Tables']['project_general_data']['Row'];
type ProjectEquipment = Database['public']['Tables']['project_equipment']['Row'];
type ProjectFinancials = Database['public']['Tables']['project_financials']['Row'];
type ProjectStatus = Database['public']['Enums']['project_status'];

export interface FinancialRecord {
  id: string;
  project_value: number;
  amount_paid: number;
  status: string;
  due_date?: string | null;
}

export interface ProjectWithDetails extends Project {
  generalData?: ProjectGeneralData;
  equipment?: ProjectEquipment;
  financials?: ProjectFinancials;
  financialRecord?: FinancialRecord;
  companyName?: string;
  concessionaireName?: string;
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async (): Promise<ProjectWithDetails[]> => {
      // Fetch projects with company name and concessionaire name
      const { data: projects, error } = await supabase
        .from('projects')
        .select(`
          *,
          companies:company_id (name),
          energy_concessionaires:concessionaire_id (name)
        `)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch general data for all projects
      const projectIds = projects.map(p => p.id);
      
      const [generalDataRes, equipmentRes, financialsRes, financialRecordsRes] = await Promise.all([
        supabase.from('project_general_data').select('*').in('project_id', projectIds),
        supabase.from('project_equipment').select('*').in('project_id', projectIds),
        supabase.from('project_financials').select('*').in('project_id', projectIds),
        supabase.from('financials').select('id, project_id, project_value, amount_paid, status, due_date').in('project_id', projectIds),
      ]);

      const generalDataMap = new Map(generalDataRes.data?.map(d => [d.project_id, d]) || []);
      const equipmentMap = new Map(equipmentRes.data?.map(d => [d.project_id, d]) || []);
      const financialsMap = new Map(financialsRes.data?.map(d => [d.project_id, d]) || []);
      const financialRecordsMap = new Map(financialRecordsRes.data?.map(d => [d.project_id, d]) || []);

      return projects.map(p => ({
        ...p,
        generalData: generalDataMap.get(p.id),
        equipment: equipmentMap.get(p.id),
        financials: financialsMap.get(p.id),
        financialRecord: financialRecordsMap.get(p.id) as FinancialRecord | undefined,
        companyName: (p.companies as { name: string } | null)?.name,
        concessionaireName: (p.energy_concessionaires as { name: string } | null)?.name,
      }));
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: async (): Promise<ProjectWithDetails | null> => {
      if (!id) return null;

      const { data: project, error } = await supabase
        .from('projects')
        .select(`
          *,
          companies:company_id (name),
          energy_concessionaires:concessionaire_id (name)
        `)
        .eq('id', id)
        .eq('is_deleted', false)
        .single();

      if (error) throw error;

      const [generalDataRes, equipmentRes, financialsRes, financialRecordRes] = await Promise.all([
        supabase.from('project_general_data').select('*').eq('project_id', id).maybeSingle(),
        supabase.from('project_equipment').select('*').eq('project_id', id).maybeSingle(),
        supabase.from('project_financials').select('*').eq('project_id', id).maybeSingle(),
        supabase.from('financials').select('id, project_id, project_value, amount_paid, status, due_date').eq('project_id', id).maybeSingle(),
      ]);

      return {
        ...project,
        generalData: generalDataRes.data || undefined,
        equipment: equipmentRes.data || undefined,
        financials: financialsRes.data || undefined,
        financialRecord: financialRecordRes.data as FinancialRecord | undefined,
        companyName: (project.companies as { name: string } | null)?.name,
        concessionaireName: (project.energy_concessionaires as { name: string } | null)?.name,
      };
    },
    enabled: !!id,
  });
}

export function useUpdateProjectStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, status }: { projectId: string; status: ProjectStatus }) => {
      const safeStatus = toProjectStatus(status as string);
      if (!safeStatus) return;

      console.log('Tentando atualizar status para:', safeStatus, '| tipo:', typeof safeStatus);

      const { error } = await supabase
        .from('projects')
        .update({ status: safeStatus as ProjectStatus })
        .eq('id', projectId)
        .select();

      if (error) {
        console.error('Erro detalhado:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status: safeStatus,
        });
        throw error;
      }

      // Add history entry
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .single();

        await supabase.from('project_history').insert({
          project_id: projectId,
          action: 'Status alterado',
          description: `Status alterado para "${status}"`,
          user_id: user.id,
          user_name: profile?.name || user.email,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Status atualizado');
    },
    onError: (error) => {
      console.error('Error updating status:', error);
      toast.error('Erro ao atualizar status');
    },
  });
}

export function useUpdateProjectFinancials() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      projectId, 
      projectValue, 
      paidValue 
    }: { 
      projectId: string; 
      projectValue: number; 
      paidValue: number;
    }) => {
      const paymentStatus = paidValue >= projectValue ? 'paid' : paidValue > 0 ? 'partial' : 'pending';
      
      const { error } = await supabase
        .from('project_financials')
        .upsert({
          project_id: projectId,
          project_value: projectValue,
          paid_value: paidValue,
          payment_status: paymentStatus,
        }, { onConflict: 'project_id' });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['financials'] });
      toast.success('Dados financeiros salvos');
    },
    onError: (error) => {
      console.error('Error updating financials:', error);
      toast.error('Erro ao salvar dados financeiros');
    },
  });
}

export function useUpdateProjectData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      generalData,
      equipment,
    }: {
      projectId: string;
      generalData?: Partial<Omit<ProjectGeneralData, 'id' | 'project_id' | 'created_at' | 'updated_at'>>;
      equipment?: Partial<Omit<ProjectEquipment, 'id' | 'project_id' | 'created_at' | 'updated_at'>>;
    }) => {
      const updates: Promise<void>[] = [];

      if (generalData && Object.keys(generalData).length > 0) {
        updates.push(
          supabase
            .from('project_general_data')
            .update(generalData)
            .eq('project_id', projectId)
            .then(({ error }) => { if (error) throw error; })
        );
      }

      if (equipment && Object.keys(equipment).length > 0) {
        updates.push(
          supabase
            .from('project_equipment')
            .update(equipment)
            .eq('project_id', projectId)
            .then(({ error }) => { if (error) throw error; })
        );
      }

      await Promise.all(updates);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .single();

        await supabase.from('project_history').insert({
          project_id: projectId,
          action: 'Dados editados',
          description: 'Dados do projeto foram atualizados manualmente',
          user_id: user.id,
          user_name: profile?.name || user.email,
        });
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-history', variables.projectId] });
      toast.success('Dados salvos com sucesso');
    },
    onError: (error) => {
      console.error('Error updating project data:', error);
      toast.error('Erro ao salvar dados');
    },
  });
}

interface CreateProjectData {
  companyId: string;
  title: string;
  source: Database['public']['Enums']['project_source'];
  generalData: {
    holderName: string;
    holderCpfCnpj: string;
    holderEmail?: string;
    holderPhone?: string;
    address: string;
    city: string;
    state: string;
    isRural: boolean;
    coordinates?: string;
    utilityCompany: string;
    ucNumber: string;
    hasBeneficiaries: boolean;
    circuitBreakerCurrent?: string;
  };
  equipment: {
    totalInstalledPower: number;
    moduleQuantity: number;
    inverterModel: string;
    inverterBrand?: string;
    moduleBrand?: string;
    moduleModel?: string;
    modulePower?: number;
    inverterPower?: number;
    inverterQuantity?: number;
  };
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: CreateProjectData) => {
      // Create project
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          company_id: data.companyId,
          title: data.title,
          source: data.source,
          status: 'pending',
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // Create general data
      const { error: generalError } = await supabase
        .from('project_general_data')
        .insert({
          project_id: project.id,
          holder_name: data.generalData.holderName,
          holder_cpf_cnpj: data.generalData.holderCpfCnpj,
          holder_email: data.generalData.holderEmail,
          holder_phone: data.generalData.holderPhone,
          address: data.generalData.address,
          city: data.generalData.city,
          state: data.generalData.state,
          is_rural: data.generalData.isRural,
          coordinates: data.generalData.coordinates,
          utility_company: data.generalData.utilityCompany,
          uc_number: data.generalData.ucNumber,
          has_beneficiaries: data.generalData.hasBeneficiaries,
          circuit_breaker_current: data.generalData.circuitBreakerCurrent,
        });

      if (generalError) throw generalError;

      // Create equipment
      const { error: equipmentError } = await supabase
        .from('project_equipment')
        .insert({
          project_id: project.id,
          total_installed_power: data.equipment.totalInstalledPower,
          module_quantity: data.equipment.moduleQuantity,
          inverter_model: data.equipment.inverterModel,
          inverter_brand: data.equipment.inverterBrand,
          module_brand: data.equipment.moduleBrand,
          module_model: data.equipment.moduleModel,
          module_power: data.equipment.modulePower,
          inverter_power: data.equipment.inverterPower,
          inverter_quantity: data.equipment.inverterQuantity,
        });

      if (equipmentError) throw equipmentError;

      // Create financials with default values
      const { error: financialsError } = await supabase
        .from('project_financials')
        .insert({
          project_id: project.id,
          project_value: 0,
          paid_value: 0,
          payment_status: 'pending',
        });

      if (financialsError) throw financialsError;

      // Add history entry
      await supabase.from('project_history').insert({
        project_id: project.id,
        action: 'Projeto criado',
        description: `Projeto ${project.code} criado via ${data.source}`,
      });

      return project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
