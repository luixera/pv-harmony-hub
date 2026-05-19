import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, User, Zap, Upload, Loader2, Building2 } from 'lucide-react';
import { MapPicker } from '@/components/maps/MapPicker';
import { toast } from 'sonner';
import { brazilianStates } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DocumentUploadField } from '@/components/forms/DocumentUploadField';
import { Database } from '@/integrations/supabase/types';
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires';
import { useQuery } from '@tanstack/react-query';

type DocumentType = Database['public']['Enums']['document_type'];

const steps = [
  { id: 1, title: 'Titular', icon: User },
  { id: 2, title: 'Equipamentos', icon: Zap },
  { id: 3, title: 'Anexos', icon: Upload },
];

interface FormDocuments {
  energyBillGenerator: File[];
  energyBillBeneficiaries: File[];
  holderDocument: File[];
  entranceStandardPhoto: File[];
  circuitBreakerPhoto: File[];
  otherPhotos: File[];
}

// Styled label helper for form fields
function FL({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: 'block', fontSize: 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      color: '#6B7280', marginBottom: 6,
    }}>
      {children}
    </label>
  );
}

function FieldGroup({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column' }}>
      <FL>{label}</FL>
      {children}
    </div>
  );
}

export default function NewProject() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isViewingAsCompany = !!sessionStorage.getItem('viewingAsCompany');
  const viewingCompany = isViewingAsCompany ? JSON.parse(sessionStorage.getItem('viewingAsCompany') || '{}') : null;
  const effectiveCompanyId = isViewingAsCompany && viewingCompany?.id ? viewingCompany.id : user?.companyId;

  const [formData, setFormData] = useState({
    holderName: '',
    holderCpfCnpj: '',
    holderEmail: '',
    holderPhone: '',
    address: '',
    addressNumber: '',
    neighborhood: '',
    cep: '',
    city: '',
    state: '',
    consumerUnitNumber: '',
    phaseType: '',
    isRural: false,
    coordinates: '',
    concessionaireId: '',
    inverterBrand: '',
    inverterModel: '',
    inverterPower: '',
    inverterQuantity: '1',
    moduleBrand: '',
    moduleModel: '',
    modulePower: '',
    moduleQuantity: '',
    observations: '',
  });

  const [useCompanyContact, setUseCompanyContact] = useState<'manual' | 'company'>('manual');

  const { data: companyData } = useQuery({
    queryKey: ['company-contact', effectiveCompanyId],
    queryFn: async () => {
      if (!effectiveCompanyId) return null;
      const { data, error } = await supabase
        .from('companies')
        .select('contact_email, contact_phone')
        .eq('id', effectiveCompanyId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveCompanyId,
  });

  useEffect(() => {
    if (useCompanyContact === 'company' && companyData) {
      setFormData(prev => ({
        ...prev,
        holderEmail: companyData.contact_email || '',
        holderPhone: companyData.contact_phone || '',
      }));
    }
  }, [useCompanyContact, companyData]);

  const { data: concessionaires = [] } = useEnergyConcessionaires();
  const [hasBeneficiaries, setHasBeneficiaries] = useState(false);
  const [noCircuitBreakerPhoto, setNoCircuitBreakerPhoto] = useState(false);
  const [circuitBreakerCurrent, setCircuitBreakerCurrent] = useState('');
  const [documents, setDocuments] = useState<FormDocuments>({
    energyBillGenerator: [],
    energyBillBeneficiaries: [],
    holderDocument: [],
    entranceStandardPhoto: [],
    circuitBreakerPhoto: [],
    otherPhotos: [],
  });

  const calculatedPower =
    formData.modulePower && formData.moduleQuantity
      ? (parseFloat(formData.modulePower) * parseInt(formData.moduleQuantity) / 1000).toFixed(2)
      : '0';

  const updateField = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateDocuments = (key: keyof FormDocuments, files: File[]) => {
    setDocuments(prev => ({ ...prev, [key]: files }));
  };

  const formatCPF = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const formatCEP = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 8);
    return numbers.replace(/(\d{5})(\d{3})/, '$1-$2');
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 10) return numbers.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return numbers.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        if (!formData.holderName || !formData.holderCpfCnpj) { toast.error('Preencha os dados do titular'); return false; }
        if (!formData.holderEmail || !formData.holderPhone) { toast.error('Preencha email e telefone do titular'); return false; }
        if (!formData.address || !formData.city || !formData.state) { toast.error('Preencha o endereço completo'); return false; }
        if (!formData.consumerUnitNumber || !formData.phaseType) { toast.error('Preencha os dados da unidade consumidora'); return false; }
        if (!formData.concessionaireId) { toast.error('Selecione a concessionária de energia'); return false; }
        if (formData.isRural && !formData.coordinates) { toast.error('Defina a localização no mapa para projetos rurais'); return false; }
        return true;
      case 2:
        if (!formData.inverterBrand || !formData.inverterModel || !formData.inverterPower || !formData.inverterQuantity) { toast.error('Preencha todos os dados do inversor'); return false; }
        if (!formData.moduleBrand || !formData.moduleModel || !formData.modulePower || !formData.moduleQuantity) { toast.error('Preencha todos os dados dos módulos'); return false; }
        return true;
      case 3: {
        const hasEnergyBill = documents.energyBillGenerator.length > 0;
        const hasBeneficiaryBills = !hasBeneficiaries || documents.energyBillBeneficiaries.length > 0;
        const hasHolderDoc = documents.holderDocument.length > 0;
        const hasEntrancePhoto = documents.entranceStandardPhoto.length > 0;
        const hasCircuitBreaker = noCircuitBreakerPhoto ? !!circuitBreakerCurrent : documents.circuitBreakerPhoto.length > 0;
        if (!hasEnergyBill || !hasBeneficiaryBills || !hasHolderDoc || !hasEntrancePhoto || !hasCircuitBreaker) {
          toast.error('Envie todos os documentos obrigatórios');
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    setCurrentStep(s => s + 1);
  };

  const uploadDocument = async (file: File, projectId: string, companyId: string, docType: DocumentType) => {
    const filePath = `${companyId}/${projectId}/${docType}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from('project-documents').upload(filePath, file);
    if (uploadError) throw uploadError;
    const { error: dbError } = await supabase.from('documents').insert({
      project_id: projectId,
      file_name: file.name,
      file_type: file.type,
      file_url: filePath,
      document_type: docType,
      uploaded_by: user?.id,
    });
    if (dbError) throw dbError;
  };

  const handleSubmit = async () => {
    if (!validateStep(3)) return;
    if (!effectiveCompanyId) { toast.error('Usuário sem empresa vinculada'); return; }
    setIsSubmitting(true);
    let projectId: string | null = null;
    const projectSource = isViewingAsCompany ? 'admin' : 'company_login';
    try {
      const fullAddress = [
        formData.address,
        formData.addressNumber && `nº ${formData.addressNumber}`,
        formData.neighborhood,
        formData.cep && `CEP: ${formData.cep}`,
      ].filter(Boolean).join(', ');

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          company_id: effectiveCompanyId,
          title: formData.holderName,
          source: projectSource as 'company_login' | 'admin',
          status: 'pending' as const,
          created_by: user?.id,
          concessionaire_id: formData.concessionaireId || null,
        })
        .select()
        .single();
      if (projectError) throw projectError;
      projectId = project.id;

      const { error: generalError } = await supabase.from('project_general_data').insert({
        project_id: project.id,
        holder_name: formData.holderName,
        holder_cpf_cnpj: formData.holderCpfCnpj.replace(/\D/g, ''),
        holder_email: formData.holderEmail,
        holder_phone: formData.holderPhone.replace(/\D/g, ''),
        address: fullAddress,
        city: formData.city,
        state: formData.state,
        is_rural: formData.isRural,
        coordinates: formData.isRural ? formData.coordinates || null : null,
        utility_company: 'A definir',
        uc_number: formData.consumerUnitNumber,
        phase_type: formData.phaseType,
        has_beneficiaries: hasBeneficiaries,
        circuit_breaker_current: noCircuitBreakerPhoto ? circuitBreakerCurrent : null,
        observations: formData.observations?.trim() || null,
      });
      if (generalError) throw generalError;

      const totalPower = parseFloat(formData.modulePower) * parseInt(formData.moduleQuantity) / 1000;
      const { error: equipmentError } = await supabase.from('project_equipment').insert({
        project_id: project.id,
        inverter_brand: formData.inverterBrand,
        inverter_model: formData.inverterModel,
        inverter_power: parseFloat(formData.inverterPower),
        inverter_quantity: parseInt(formData.inverterQuantity),
        module_brand: formData.moduleBrand,
        module_model: formData.moduleModel,
        module_power: parseFloat(formData.modulePower),
        module_quantity: parseInt(formData.moduleQuantity),
        total_installed_power: totalPower,
      });
      if (equipmentError) throw equipmentError;

      try {
        const { error: financialsError } = await supabase.from('project_financials').insert({
          project_id: project.id,
          project_value: 0,
          paid_value: 0,
          payment_status: 'pending' as const,
        });
        if (financialsError) console.warn('Non-critical: Failed to create financials record:', financialsError);
      } catch (financialsErr) {
        console.warn('Non-critical: Failed to create financials record:', financialsErr);
      }

      try {
        await supabase.from('project_history').insert({
          project_id: project.id,
          action: 'Projeto criado',
          description: `Projeto ${project.code} criado via painel da empresa`,
          user_id: user.id,
          user_name: user.name,
        });
      } catch (historyErr) {
        console.warn('Non-critical: Failed to create history entry:', historyErr);
      }

      const docMappings: { files: File[]; type: DocumentType }[] = [
        { files: documents.energyBillGenerator, type: 'energy_bill_generator' },
        { files: documents.energyBillBeneficiaries, type: 'energy_bill_beneficiaries' },
        { files: documents.holderDocument, type: 'holder_document' },
        { files: documents.entranceStandardPhoto, type: 'entrance_standard_photo' },
        { files: documents.circuitBreakerPhoto, type: 'breaker_photo' },
        { files: documents.otherPhotos, type: 'other_photos' },
      ];

      try {
        for (const mapping of docMappings) {
          for (const file of mapping.files) {
            await uploadDocument(file, project.id, effectiveCompanyId, mapping.type);
          }
        }
      } catch (uploadErr) {
        console.warn('Non-critical: Some documents failed to upload:', uploadErr);
      }

      // Auto-geocode address (non-critical, silently updates coordinates)
      if (!formData.isRural) {
        try {
          const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
          if (apiKey) {
            const query = `${fullAddress}, ${formData.city}, ${formData.state}, Brasil`;
            const resp = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`
            );
            const geo = await resp.json();
            if (geo.status === 'OK' && geo.results[0]) {
              const loc = geo.results[0].geometry.location;
              const coords = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
              await supabase.from('project_general_data').update({ coordinates: coords }).eq('project_id', project.id);
            }
          }
        } catch (geoErr) {
          console.warn('Non-critical: Failed to geocode address:', geoErr);
        }
      }

      toast.success('Projeto enviado com sucesso!');
      navigate('/project-success');
    } catch (error) {
      console.error('Error submitting project:', error);
      toast.error('Erro ao enviar projeto. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <MainLayout>
      {/* Page background */}
      <div style={{ background: '#F0F0F0', minHeight: '100%', padding: '24px 16px', boxSizing: 'border-box', margin: '-16px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>

          {/* Back + Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <button
              onClick={() => navigate(-1)}
              style={{
                width: 38, height: 38, borderRadius: 8,
                border: '1px solid #E5E7EB', background: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <ArrowLeft style={{ width: 18, height: 18, color: '#374151' }} />
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', lineHeight: 1.2, margin: 0 }}>
                Novo Projeto
              </h1>
              <p style={{ fontSize: 13, color: '#6B7280', marginTop: 2, marginBottom: 0 }}>
                Preencha os dados para homologação
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', marginBottom: 24 }}>
            {steps.map((step, index) => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: currentStep > step.id ? '#2D6A4F' : currentStep === step.id ? '#F5A800' : '#E0E0E0',
                    color: '#fff',
                    fontWeight: 700, fontSize: 14,
                    boxShadow: currentStep === step.id ? '0 0 0 4px rgba(245,168,0,0.18)' : 'none',
                    transition: 'all 0.3s', flexShrink: 0,
                  }}>
                    {currentStep > step.id
                      ? <Check style={{ width: 18, height: 18 }} />
                      : <span style={{ color: currentStep === step.id ? '#fff' : '#9E9E9E' }}>{step.id}</span>
                    }
                  </div>
                  <span style={{
                    fontSize: 11, marginTop: 6,
                    fontWeight: currentStep === step.id ? 700 : 400,
                    color: currentStep === step.id ? '#F5A800' : currentStep > step.id ? '#2D6A4F' : '#9E9E9E',
                  }}>
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div style={{
                    width: 80, height: 2, margin: '17px 12px 0',
                    background: currentStep > step.id ? '#2D6A4F' : '#E0E0E0',
                    borderRadius: 1, flexShrink: 0,
                  }} />
                )}
              </div>
            ))}
          </div>

          {/* Form card */}
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            style={{
              background: '#fff', borderRadius: 16,
              padding: '28px 24px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
              marginBottom: 20,
            }}
          >

            {/* ── STEP 1 — Titular ───────────────────────────────────────── */}
            {currentStep === 1 && (
              <div className="space-y-8">
                {/* Dados do Titular */}
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <User style={{ width: 18, height: 18, color: '#F5A800' }} />
                    Dados do Titular
                  </h3>

                  {/* Contact source radio */}
                  <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                    <Label className="text-sm font-medium mb-2 block">Dados de contato</Label>
                    <RadioGroup
                      value={useCompanyContact}
                      onValueChange={(v) => setUseCompanyContact(v as 'manual' | 'company')}
                      className="flex flex-wrap gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="manual" id="contact-manual" />
                        <Label htmlFor="contact-manual" className="font-normal cursor-pointer">
                          Preencher manualmente
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="company" id="contact-company" />
                        <Label htmlFor="contact-company" className="font-normal cursor-pointer flex items-center gap-1">
                          <Building2 className="w-4 h-4" />
                          Usar dados da empresa
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldGroup label="Nome do Titular *">
                      <Input value={formData.holderName} onChange={e => updateField('holderName', e.target.value)} placeholder="Nome completo" />
                    </FieldGroup>
                    <FieldGroup label="CPF *">
                      <Input value={formData.holderCpfCnpj} onChange={e => updateField('holderCpfCnpj', formatCPF(e.target.value))} placeholder="000.000.000-00" />
                    </FieldGroup>
                    <FieldGroup label="Email do Titular *">
                      <Input
                        type="email"
                        value={formData.holderEmail}
                        onChange={e => updateField('holderEmail', e.target.value)}
                        placeholder="email@exemplo.com"
                        disabled={useCompanyContact === 'company'}
                        className={useCompanyContact === 'company' ? 'bg-muted' : ''}
                      />
                    </FieldGroup>
                    <FieldGroup label="Telefone do Titular *">
                      <Input
                        value={formData.holderPhone}
                        onChange={e => updateField('holderPhone', formatPhone(e.target.value))}
                        placeholder="(00) 00000-0000"
                        disabled={useCompanyContact === 'company'}
                        className={useCompanyContact === 'company' ? 'bg-muted' : ''}
                      />
                    </FieldGroup>
                  </div>
                </div>

                {/* Endereço */}
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 16 }}>
                    Endereço do Imóvel
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldGroup label="Endereço *" className="md:col-span-2">
                      <Input value={formData.address} onChange={e => updateField('address', e.target.value)} placeholder="Rua, Avenida, etc." />
                    </FieldGroup>
                    <FieldGroup label="Número">
                      <Input value={formData.addressNumber} onChange={e => updateField('addressNumber', e.target.value)} placeholder="Nº" />
                    </FieldGroup>
                    <FieldGroup label="Bairro">
                      <Input value={formData.neighborhood} onChange={e => updateField('neighborhood', e.target.value)} placeholder="Bairro" />
                    </FieldGroup>
                    <FieldGroup label="CEP">
                      <Input value={formData.cep} onChange={e => updateField('cep', formatCEP(e.target.value))} placeholder="00000-000" />
                    </FieldGroup>
                    <FieldGroup label="Cidade *">
                      <Input value={formData.city} onChange={e => updateField('city', e.target.value)} placeholder="Cidade" />
                    </FieldGroup>
                    <FieldGroup label="Estado *">
                      <Select value={formData.state} onValueChange={v => updateField('state', v)}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {brazilianStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FieldGroup>
                  </div>
                </div>

                {/* Unidade Consumidora */}
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 16 }}>
                    Dados da Unidade Consumidora
                  </h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FieldGroup label="Número da UC *">
                        <Input value={formData.consumerUnitNumber} onChange={e => updateField('consumerUnitNumber', e.target.value)} placeholder="Número da unidade consumidora" />
                      </FieldGroup>
                      <FieldGroup label="Concessionária de Energia *">
                        <Select value={formData.concessionaireId} onValueChange={v => updateField('concessionaireId', v)}>
                          <SelectTrigger><SelectValue placeholder="Selecione a concessionária" /></SelectTrigger>
                          <SelectContent>
                            {concessionaires.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FieldGroup>
                    </div>

                    <div className="space-y-3">
                      <FL>Classe de Atendimento *</FL>
                      <RadioGroup value={formData.phaseType} onValueChange={v => updateField('phaseType', v)} className="flex flex-wrap gap-4">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="monofasico" id="monofasico" />
                          <Label htmlFor="monofasico" className="cursor-pointer">Monofásico</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="bifasico" id="bifasico" />
                          <Label htmlFor="bifasico" className="cursor-pointer">Bifásico</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="trifasico" id="trifasico" />
                          <Label htmlFor="trifasico" className="cursor-pointer">Trifásico</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <Checkbox checked={formData.isRural} onCheckedChange={c => updateField('isRural', !!c)} />
                      <Label className="cursor-pointer">Projeto rural?</Label>
                    </div>

                    {formData.isRural && (
                      <div className="space-y-2 pl-4 border-l-2 border-primary/20">
                        <MapPicker
                          label="Localização do imóvel rural *"
                          value={formData.coordinates}
                          onChange={coords => updateField('coordinates', coords)}
                          showAutocomplete={true}
                          height={280}
                          draggable={true}
                        />
                        {!formData.coordinates && (
                          <p className="text-xs text-amber-500">
                            Clique no mapa ou busque o endereço para definir a localização
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2 — Equipamentos ──────────────────────────────────── */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Zap style={{ width: 18, height: 18, color: '#F5A800' }} />
                  Equipamentos do Sistema
                </h3>

                {/* Inversor */}
                <div style={{ background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 12, padding: '16px 20px' }}>
                  <h4 style={{ fontWeight: 600, fontSize: 14, color: '#374151', marginBottom: 14 }}>Inversor</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldGroup label="Marca *">
                      <Input value={formData.inverterBrand} onChange={e => updateField('inverterBrand', e.target.value)} placeholder="Ex: Growatt, Sungrow" />
                    </FieldGroup>
                    <FieldGroup label="Modelo *">
                      <Input value={formData.inverterModel} onChange={e => updateField('inverterModel', e.target.value)} placeholder="Ex: MIN 6000TL-X" />
                    </FieldGroup>
                    <FieldGroup label="Potência (kW) *">
                      <Input type="number" value={formData.inverterPower} onChange={e => updateField('inverterPower', e.target.value)} placeholder="Ex: 6" />
                    </FieldGroup>
                    <FieldGroup label="Quantidade *">
                      <Input type="number" min="1" value={formData.inverterQuantity} onChange={e => updateField('inverterQuantity', e.target.value)} placeholder="1" />
                    </FieldGroup>
                  </div>
                </div>

                {/* Módulos */}
                <div style={{ background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 12, padding: '16px 20px' }}>
                  <h4 style={{ fontWeight: 600, fontSize: 14, color: '#374151', marginBottom: 14 }}>Módulos Fotovoltaicos</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldGroup label="Marca *">
                      <Input value={formData.moduleBrand} onChange={e => updateField('moduleBrand', e.target.value)} placeholder="Ex: Canadian Solar" />
                    </FieldGroup>
                    <FieldGroup label="Modelo *">
                      <Input value={formData.moduleModel} onChange={e => updateField('moduleModel', e.target.value)} placeholder="Ex: CS6W-545MS" />
                    </FieldGroup>
                    <FieldGroup label="Potência do módulo (Wp) *">
                      <Input type="number" value={formData.modulePower} onChange={e => updateField('modulePower', e.target.value)} placeholder="Ex: 545" />
                    </FieldGroup>
                    <FieldGroup label="Quantidade de módulos *">
                      <Input type="number" min="1" value={formData.moduleQuantity} onChange={e => updateField('moduleQuantity', e.target.value)} placeholder="Ex: 12" />
                    </FieldGroup>
                  </div>
                </div>

                {/* Potência calculada */}
                <div style={{ background: 'rgba(245,168,0,0.08)', borderRadius: 12, padding: '24px', textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 4 }}>Potência Total do Projeto</p>
                  <p style={{ fontSize: 32, fontWeight: 800, color: '#F5A800', margin: 0 }}>
                    {calculatedPower} <span style={{ fontSize: 18 }}>kWp</span>
                  </p>
                  <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
                    Calculado automaticamente: {formData.modulePower || 0} Wp × {formData.moduleQuantity || 0} módulos
                  </p>
                </div>
              </div>
            )}

            {/* ── STEP 3 — Anexos ───────────────────────────────────────── */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Upload style={{ width: 18, height: 18, color: '#F5A800' }} />
                  Anexos e Observações
                </h3>

                <DocumentUploadField
                  id="energy_bill_generator"
                  label="Conta de energia da unidade geradora"
                  required
                  files={documents.energyBillGenerator}
                  onFilesChange={files => updateDocuments('energyBillGenerator', files)}
                />
                <DocumentUploadField
                  id="energy_bill_beneficiaries"
                  label="Contas de energia das unidades beneficiárias"
                  multiple
                  files={documents.energyBillBeneficiaries}
                  onFilesChange={files => updateDocuments('energyBillBeneficiaries', files)}
                  conditionalCheckbox
                  conditionalLabel="Existem unidades beneficiárias?"
                  isConditionalActive={hasBeneficiaries}
                  onConditionalChange={setHasBeneficiaries}
                />
                <DocumentUploadField
                  id="holder_document"
                  label="Documento com foto do titular"
                  required
                  files={documents.holderDocument}
                  onFilesChange={files => updateDocuments('holderDocument', files)}
                />
                <DocumentUploadField
                  id="entrance_standard_photo"
                  label="Foto do padrão de entrada"
                  required
                  files={documents.entranceStandardPhoto}
                  onFilesChange={files => updateDocuments('entranceStandardPhoto', files)}
                />
                <DocumentUploadField
                  id="breaker_photo"
                  label="Foto do disjuntor de entrada"
                  required
                  files={documents.circuitBreakerPhoto}
                  onFilesChange={files => updateDocuments('circuitBreakerPhoto', files)}
                  hasAlternativeInput
                  alternativeLabel="Corrente do disjuntor (A)"
                  alternativeValue={circuitBreakerCurrent}
                  onAlternativeChange={setCircuitBreakerCurrent}
                  useAlternative={noCircuitBreakerPhoto}
                  onUseAlternativeChange={setNoCircuitBreakerPhoto}
                />
                <DocumentUploadField
                  id="other_photos"
                  label="Outras fotos (telhado, quadro geral, transformador)"
                  multiple
                  files={documents.otherPhotos}
                  onFilesChange={files => updateDocuments('otherPhotos', files)}
                />

                <div style={{ paddingTop: 16, borderTop: '1px solid #F3F4F6' }}>
                  <FieldGroup label="Observações do projeto (opcional)">
                    <Textarea
                      placeholder="Informe particularidades do projeto ou recados para o projetista..."
                      value={formData.observations}
                      onChange={e => updateField('observations', e.target.value)}
                      rows={4}
                    />
                  </FieldGroup>
                </div>

                {/* Summary */}
                <div style={{ background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 12, padding: '16px 20px', fontSize: 13 }}>
                  <h4 style={{ fontWeight: 700, color: '#1A1A1A', marginBottom: 12 }}>Resumo do Projeto</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <p><span style={{ color: '#6B7280' }}>Titular:</span> {formData.holderName}</p>
                    <p><span style={{ color: '#6B7280' }}>CPF:</span> {formData.holderCpfCnpj}</p>
                    <p><span style={{ color: '#6B7280' }}>Local:</span> {formData.city}/{formData.state}</p>
                    <p><span style={{ color: '#6B7280' }}>UC:</span> {formData.consumerUnitNumber}</p>
                    <p><span style={{ color: '#6B7280' }}>Potência:</span> {calculatedPower} kWp</p>
                    <p><span style={{ color: '#6B7280' }}>Módulos:</span> {formData.moduleQuantity}x {formData.moduleBrand}</p>
                    <p><span style={{ color: '#6B7280' }}>Inversor:</span> {formData.inverterBrand} {formData.inverterModel}</p>
                    <p><span style={{ color: '#6B7280' }}>Classe:</span> {formData.phaseType || '-'}</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 32 }}>
            <button
              onClick={() => setCurrentStep(s => s - 1)}
              disabled={currentStep === 1}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 20px', borderRadius: 8,
                border: '1.5px solid #D1D5DB', background: '#fff',
                color: currentStep === 1 ? '#D1D5DB' : '#374151',
                cursor: currentStep === 1 ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: 14,
              }}
            >
              <ArrowLeft style={{ width: 16, height: 16 }} />
              Voltar
            </button>

            {currentStep < 3 ? (
              <button
                onClick={handleNext}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 24px', borderRadius: 8,
                  border: 'none', background: '#F5A800', color: '#fff',
                  cursor: 'pointer', fontWeight: 700, fontSize: 14,
                }}
              >
                Continuar
                <ArrowRight style={{ width: 16, height: 16 }} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 24px', borderRadius: 8,
                  border: 'none',
                  background: isSubmitting ? '#FCD34D' : '#F5A800',
                  color: '#fff',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  fontWeight: 700, fontSize: 14,
                }}
              >
                {isSubmitting && <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />}
                <Check style={{ width: 16, height: 16 }} />
                Enviar Projeto
              </button>
            )}
          </div>

        </div>
      </div>
    </MainLayout>
  );
}
