import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, User, Zap, Upload, Loader2, Building2, MapPin, Sparkles, FileText, AlertTriangle, CheckCircle2, X, Info } from 'lucide-react';
import { MapPicker } from '@/components/maps/MapPicker';
import { toast } from 'sonner';
import { brazilianStates } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantFeatures } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import { DocumentUploadField } from '@/components/forms/DocumentUploadField';
import { Database } from '@/integrations/supabase/types';
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires';
import { validateFile, sanitizeFileName } from '@/lib/utils';
import { upperizeStrings } from '@/lib/textCase';
import { useQuery } from '@tanstack/react-query';

type DocumentType = Database['public']['Enums']['document_type'];

// ── Tipos Claudinho Verifica ──────────────────────────────────────────────────

interface FieldResult {
  value: string | null;
  confidence: number;
  source: string;
}

interface TitleComparison {
  energy_bill_name: string | null;
  document_name: string | null;
  document_type_detected: string;
  match: boolean;
  similarity: number;
  unexpected_document: boolean;
}

interface ClaudinhoResult {
  ok: boolean;
  mode: 'analyze' | 'compare';
  holder_name?: FieldResult;
  cpf_cnpj?: FieldResult;
  address?: FieldResult;
  address_number?: FieldResult;
  neighborhood?: FieldResult;
  city?: FieldResult;
  state?: FieldResult;
  cep?: FieldResult;
  uc_number?: FieldResult;
  phase_type?: FieldResult;
  concessionaire_hint?: FieldResult;
  inverter_brand?: FieldResult;
  inverter_model?: FieldResult;
  inverter_power?: FieldResult;
  inverter_quantity?: FieldResult;
  module_brand?: FieldResult;
  module_model?: FieldResult;
  module_power?: FieldResult;
  module_quantity?: FieldResult;
  circuit_breaker_current?: FieldResult;
  document_types_detected?: string[];
  title_comparison?: TitleComparison;
  error?: string;
}

// mapa: tipo detectado → campo do formulário de documentos
const DOC_TYPE_TO_FIELD: Record<string, keyof FormDocuments> = {
  energy_bill: 'energyBillGenerator',
  rg: 'holderDocument',
  cnh: 'holderDocument',
  cnpj: 'holderDocument',
  contrato_social: 'holderDocument',
};

// ── Passos ────────────────────────────────────────────────────────────────────

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

// ── Helpers visuais ───────────────────────────────────────────────────────────

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

/** Wrapper de campo com indicador de confiança do Claudinho */
function AIField({
  label,
  confidence,
  source,
  children,
  className,
}: {
  label: string;
  confidence?: number;
  source?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const hasAI = confidence !== undefined && confidence > 0;
  const color = !hasAI ? undefined
    : confidence >= 85 ? '#16A34A'
    : confidence >= 60 ? '#D97706'
    : '#DC2626';
  const bg = !hasAI ? undefined
    : confidence >= 85 ? 'rgba(22,163,74,0.06)'
    : confidence >= 60 ? 'rgba(217,119,6,0.06)'
    : 'rgba(220,38,38,0.06)';
  const icon = !hasAI ? null
    : confidence >= 85 ? <CheckCircle2 size={11} />
    : <AlertTriangle size={11} />;

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <FL>{label}</FL>
        {hasAI && color && (
          <span
            title={`Confiança ${confidence}% — extraído de: ${source}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 10, fontWeight: 600, color,
              padding: '1px 6px', borderRadius: 10,
              background: bg, cursor: 'help',
            }}
          >
            {icon} {confidence}%
          </span>
        )}
      </div>
      <div style={hasAI ? { borderRadius: 8, outline: `1.5px solid ${color}`, background: bg } : {}}>
        {children}
      </div>
      {hasAI && confidence < 85 && (
        <p style={{ fontSize: 10, color: color, marginTop: 3 }}>
          {confidence < 60
            ? '⚠️ Baixa confiança — verifique este campo cuidadosamente.'
            : '⚠️ Confirme se o valor está correto.'}
        </p>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function NewProject() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // ── Modo de entrada ──────────────────────────────────────────────────────────
  // null = escolha ainda não feita, 'auto' = Claudinho, 'manual' = formulário direto
  const [entryMode, setEntryMode] = useState<null | 'auto' | 'manual'>(null);
  const tenantFeatures = useTenantFeatures();

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Claudinho Verifica
  const [claudinhoFiles, setClaudinhoFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [claudinhoResult, setClaudinhoResult] = useState<ClaudinhoResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // confiança por campo (preenchida após análise)
  const [fieldConfidence, setFieldConfidence] = useState<Record<string, { confidence: number; source: string }>>({});
  // comparativo de titularidade (resultado final)
  const [titleComparison, setTitleComparison] = useState<TitleComparison | null>(null);
  const [isComparingTitle, setIsComparingTitle] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);

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
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [showMapPreview, setShowMapPreview] = useState(false);

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

  // ── Formatadores ─────────────────────────────────────────────────────────────

  const formatCpfCnpj = (value: string) => {
    const n = value.replace(/\D/g, '').slice(0, 14);
    if (n.length <= 11) {
      return n
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }
    return n
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
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

  // ── Geocode ───────────────────────────────────────────────────────────────────

  const geocodeAddress = useCallback(async () => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
    if (!apiKey) { toast.error('Chave do Google Maps não configurada'); return; }
    if (!formData.address || !formData.city || !formData.state) {
      toast.error('Preencha pelo menos o endereço, cidade e estado');
      return;
    }
    const query = [
      formData.address,
      formData.addressNumber && `nº ${formData.addressNumber}`,
      formData.neighborhood,
      formData.city,
      formData.state,
      'Brasil',
    ].filter(Boolean).join(', ');
    setIsGeocoding(true);
    try {
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`
      );
      const geo = await resp.json();
      if (geo.status === 'OK' && geo.results[0]) {
        const loc = geo.results[0].geometry.location;
        updateField('coordinates', `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`);
        setShowMapPreview(true);
        toast.success('Localização encontrada! Verifique no mapa.');
      } else {
        toast.error('Endereço não encontrado. Marque no mapa manualmente.');
        setShowMapPreview(true);
      }
    } catch { toast.error('Erro ao buscar localização'); }
    finally { setIsGeocoding(false); }
  }, [formData.address, formData.addressNumber, formData.neighborhood, formData.city, formData.state]);

  // ── Claudinho Verifica ────────────────────────────────────────────────────────

  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove prefixo data:...;base64,
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const runClaudinhoAnalyze = async () => {
    if (claudinhoFiles.length === 0) {
      toast.error('Adicione pelo menos um documento para analisar');
      return;
    }
    setIsAnalyzing(true);
    try {
      const docs = await Promise.all(
        claudinhoFiles.map(async (file) => ({
          base64: await toBase64(file),
          mimeType: file.type || 'application/octet-stream',
        }))
      );

      const { data, error } = await supabase.functions.invoke('claudinho-verifica', {
        body: { mode: 'analyze', documents: docs },
      });

      if (error || !data?.ok) {
        toast.error(data?.error || 'Erro ao analisar documentos');
        return;
      }

      const result: ClaudinhoResult = data;
      setClaudinhoResult(result);

      // Pré-preencher formulário com os dados extraídos
      const updates: Partial<typeof formData> = {};
      const conf: Record<string, { confidence: number; source: string }> = {};

      const applyField = (key: keyof typeof formData, field?: FieldResult) => {
        if (field?.value) {
          (updates as any)[key] = field.value;
          conf[key] = { confidence: field.confidence, source: field.source };
        }
      };

      applyField('holderName', result.holder_name);
      applyField('holderCpfCnpj', result.cpf_cnpj
        ? { ...result.cpf_cnpj, value: result.cpf_cnpj.value ? formatCpfCnpj(result.cpf_cnpj.value) : null }
        : undefined);
      applyField('address', result.address);
      applyField('addressNumber', result.address_number);
      applyField('neighborhood', result.neighborhood);
      applyField('city', result.city);
      applyField('state', result.state);
      applyField('cep', result.cep
        ? { ...result.cep, value: result.cep.value ? formatCEP(result.cep.value) : null }
        : undefined);
      applyField('consumerUnitNumber', result.uc_number);
      applyField('phaseType', result.phase_type);
      applyField('inverterBrand', result.inverter_brand);
      applyField('inverterModel', result.inverter_model);
      applyField('inverterPower', result.inverter_power);
      applyField('inverterQuantity', result.inverter_quantity);
      applyField('moduleBrand', result.module_brand);
      applyField('moduleModel', result.module_model);
      applyField('modulePower', result.module_power);
      applyField('moduleQuantity', result.module_quantity);

      if (result.circuit_breaker_current?.value) {
        setCircuitBreakerCurrent(result.circuit_breaker_current.value);
        conf['circuitBreakerCurrent'] = {
          confidence: result.circuit_breaker_current.confidence,
          source: result.circuit_breaker_current.source,
        };
      }

      setFormData(prev => ({ ...prev, ...updates }));
      setFieldConfidence(conf);

      // Auto-mapear documentos enviados para os campos de documentos
      const detected = result.document_types_detected || [];
      const newDocs = { ...documents };
      claudinhoFiles.forEach((file, i) => {
        const type = detected[i];
        const field = type ? DOC_TYPE_TO_FIELD[type] : undefined;
        if (field && newDocs[field].length === 0) {
          newDocs[field] = [file];
        }
      });
      setDocuments(newDocs);

      // Verificar concessionária
      if (result.concessionaire_hint?.value) {
        const hint = result.concessionaire_hint.value.toLowerCase();
        const match = concessionaires.find(c => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase()));
        if (match) {
          updates.concessionaireId = match.id;
          setFormData(prev => ({ ...prev, concessionaireId: match.id }));
        }
      }

      // Salvar comparativo de titularidade
      if (result.title_comparison) {
        setTitleComparison(result.title_comparison);
      }

      toast.success(`Claudinho analisou ${claudinhoFiles.length} documento(s) com sucesso!`);
      setCurrentStep(1); // vai para a etapa de revisão
    } catch (err: any) {
      toast.error('Erro inesperado na análise: ' + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Comparativo leve na submissão (quando não usou Claudinho)
  const runTitleCompare = async (): Promise<TitleComparison | null> => {
    const bill = documents.energyBillGenerator[0];
    const doc = documents.holderDocument[0];
    if (!bill || !doc) return null;
    setIsComparingTitle(true);
    try {
      const [billB64, docB64] = await Promise.all([toBase64(bill), toBase64(doc)]);
      const { data, error } = await supabase.functions.invoke('claudinho-verifica', {
        body: {
          mode: 'compare',
          documents: [
            { base64: billB64, mimeType: bill.type, hint: 'energy_bill' },
            { base64: docB64, mimeType: doc.type, hint: 'identity_document' },
          ],
        },
      });
      if (error || !data?.ok) return null;
      return data.title_comparison as TitleComparison;
    } catch { return null; }
    finally { setIsComparingTitle(false); }
  };

  // ── Drag & drop para a etapa 0 ───────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f =>
      ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'].includes(f.type)
    );
    if (files.length > 0) setClaudinhoFiles(prev => [...prev, ...files]);
  };

  // ── Validação ─────────────────────────────────────────────────────────────────

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
      default: return true;
    }
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    setCurrentStep(s => s + 1);
  };

  // ── Upload de documento ───────────────────────────────────────────────────────

  const uploadDocument = async (file: File, projectId: string, companyId: string, docType: DocumentType) => {
    const validationError = validateFile(file);
    if (validationError) throw new Error(validationError);
    const safeFileName = sanitizeFileName(file.name);
    const filePath = `${companyId}/${projectId}/${docType}/${Date.now()}_${safeFileName}`;
    const { error: uploadError } = await supabase.storage.from('project-documents').upload(filePath, file);
    if (uploadError) throw uploadError;
    const { error: dbError } = await supabase.from('documents').insert({
      project_id: projectId,
      file_name: safeFileName,
      file_type: file.type,
      file_url: filePath,
      document_type: docType,
      uploaded_by: user?.id,
    });
    if (dbError) throw dbError;
  };

  // ── Submissão ─────────────────────────────────────────────────────────────────

  const doSubmit = async (transferConfirmed?: boolean) => {
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
          title: formData.holderName.toUpperCase(),
          source: projectSource as 'company_login' | 'admin',
          status: 'pending' as const,
          created_by: user?.id,
          concessionaire_id: formData.concessionaireId || null,
        })
        .select()
        .single();
      if (projectError) throw projectError;
      projectId = project.id;

      // Determinar flags de titularidade
      const tc = titleComparison;
      const titleMatch = tc ? tc.match : null;
      const titleTransfer = tc && !tc.match && transferConfirmed ? true : null;

      const { error: generalError } = await supabase.from('project_general_data').insert(upperizeStrings({
        project_id: project.id,
        holder_name: formData.holderName,
        holder_cpf_cnpj: formData.holderCpfCnpj.replace(/\D/g, ''),
        holder_email: formData.holderEmail,
        holder_phone: formData.holderPhone.replace(/\D/g, ''),
        address: fullAddress,
        city: formData.city,
        state: formData.state,
        is_rural: formData.isRural,
        coordinates: formData.coordinates || null,
        utility_company: 'A definir',
        uc_number: formData.consumerUnitNumber,
        phase_type: formData.phaseType,
        has_beneficiaries: hasBeneficiaries,
        circuit_breaker_current: noCircuitBreakerPhoto ? circuitBreakerCurrent : null,
        observations: formData.observations?.trim() || null,
        // Claudinho Verifica
        title_match: titleMatch,
        title_transfer: titleTransfer,
        claudinho_ran: entryMode === 'auto',
        claudinho_data: claudinhoResult ? JSON.stringify(claudinhoResult) : null,
      }));
      if (generalError) throw generalError;

      const totalPower = parseFloat(formData.modulePower) * parseInt(formData.moduleQuantity) / 1000;
      const { error: equipmentError } = await supabase.from('project_equipment').insert(upperizeStrings({
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
      }));
      if (equipmentError) throw equipmentError;

      try {
        await supabase.from('project_financials').insert({
          project_id: project.id, project_value: 0, paid_value: 0, payment_status: 'pending' as const,
        });
      } catch { /* non-critical */ }

      try {
        await supabase.from('project_history').insert({
          project_id: project.id, action: 'Projeto criado',
          description: `Projeto ${project.code} criado${entryMode === 'auto' ? ' com Claudinho Verifica' : ''}`,
          user_id: user.id, user_name: user.name,
        });
        if (tc && !tc.match) {
          await supabase.from('project_history').insert({
            project_id: project.id, action: '⚠️ Divergência de titularidade',
            description: `Conta: "${tc.energy_bill_name}" | Documento: "${tc.document_name}". ${transferConfirmed ? 'Troca de titularidade confirmada pelo usuário.' : 'Usuário prosseguiu sem confirmação.'}`,
            user_id: user.id, user_name: user.name,
          });
        }
        if (tc?.unexpected_document) {
          await supabase.from('project_history').insert({
            project_id: project.id, action: '⚠️ Documento inesperado',
            description: `Tipo de documento identificado: "${tc.document_type_detected}" (esperado: RG, CNH ou CNPJ).`,
            user_id: user.id, user_name: user.name,
          });
        }
      } catch { /* non-critical */ }

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
      } catch (uploadErr) { console.warn('Non-critical: upload error:', uploadErr); }

      // Auto-geocode se não tiver coordenadas
      if (!formData.coordinates) {
        try {
          const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
          if (apiKey) {
            const query = `${fullAddress}, ${formData.city}, ${formData.state}, Brasil`;
            const resp = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`);
            const geo = await resp.json();
            if (geo.status === 'OK' && geo.results[0]) {
              const loc = geo.results[0].geometry.location;
              await supabase.from('project_general_data').update({
                coordinates: `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`,
              }).eq('project_id', project.id);
            }
          }
        } catch { /* non-critical */ }
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

  const handleSubmit = async () => {
    if (!validateStep(3)) return;

    // Se já rodou o Claudinho (modo auto), usa o comparativo já salvo
    if (entryMode === 'auto' && titleComparison) {
      if (!titleComparison.match || titleComparison.unexpected_document) {
        setShowTitleModal(true);
        return;
      }
      await doSubmit();
      return;
    }

    // Modo manual: roda comparativo leve agora
    const tc = await runTitleCompare();
    setTitleComparison(tc);

    if (tc && (!tc.match || tc.unexpected_document)) {
      setShowTitleModal(true);
      return;
    }

    await doSubmit();
  };

  // ── Confiança de campo ────────────────────────────────────────────────────────

  const fc = (key: string) => fieldConfidence[key];

  // ── RENDER ────────────────────────────────────────────────────────────────────

  // Tela 0-a: escolha do modo de entrada
  if (entryMode === null) {
    return (
      <MainLayout>
        <div style={{ background: '#F0F0F0', minHeight: '100%', padding: '40px 16px', boxSizing: 'border-box', margin: '-16px' }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
              <button onClick={() => navigate(-1)} style={{ width: 38, height: 38, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <ArrowLeft style={{ width: 18, height: 18, color: '#374151' }} />
              </button>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Novo Projeto</h1>
                <p style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Como prefere preencher os dados?</p>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              {/* Opção automática — apenas se o plano do tenant inclui o Claudinho */}
              {tenantFeatures.claudinho !== false && (
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setEntryMode('auto')}
                style={{
                  background: '#fff', borderRadius: 16, padding: '24px 24px',
                  border: '2px solid #F5A800', cursor: 'pointer', textAlign: 'left',
                  boxShadow: '0 2px 12px rgba(245,168,0,0.15)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(245,168,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Sparkles style={{ width: 24, height: 24, color: '#F5A800' }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A' }}>Claudinho Verifica</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#F5A800', color: '#fff' }}>NOVO</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
                      Envie os documentos e o agente preenche o formulário automaticamente.
                      Mais rápido e com verificação de titularidade.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                      {['Conta de energia', 'RG / CNH / CNPJ', 'Pedido de compra (opcional)'].map(tag => (
                        <span key={tag} style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: 'rgba(245,168,0,0.1)', color: '#92400E' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.button>
              )}

              {/* Opção manual */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setEntryMode('manual')}
                style={{
                  background: '#fff', borderRadius: 16, padding: '24px 24px',
                  border: '2px solid #E5E7EB', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FileText style={{ width: 24, height: 24, color: '#6B7280' }} />
                  </div>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A', display: 'block', marginBottom: 4 }}>
                      Preencher manualmente
                    </span>
                    <p style={{ fontSize: 13, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
                      Formulário tradicional em 3 etapas. Os documentos são enviados no final.
                    </p>
                  </div>
                </div>
              </motion.button>
            </div>
          </div>
        </div>
      </MainLayout>
    );
  }

  // Tela 0-b: upload para o Claudinho
  if (entryMode === 'auto' && currentStep === 1 && !claudinhoResult) {
    return (
      <MainLayout>
        <div style={{ background: '#F0F0F0', minHeight: '100%', padding: '24px 16px', boxSizing: 'border-box', margin: '-16px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
              <button onClick={() => setEntryMode(null)} style={{ width: 38, height: 38, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <ArrowLeft style={{ width: 18, height: 18, color: '#374151' }} />
              </button>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles style={{ width: 20, height: 20, color: '#F5A800' }} />
                  Claudinho Verifica
                </h1>
                <p style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
                  Envie os documentos e deixa o agente trabalhar
                </p>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 20 }}
            >
              {/* Zona de drop */}
              <div
                ref={dropZoneRef}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('claudinho-input')?.click()}
                style={{
                  border: `2px dashed ${isDragOver ? '#F5A800' : '#E5E7EB'}`,
                  borderRadius: 12, padding: '32px 24px',
                  background: isDragOver ? 'rgba(245,168,0,0.04)' : '#FAFAFA',
                  cursor: 'pointer', textAlign: 'center',
                  transition: 'all 0.2s', marginBottom: 20,
                }}
              >
                <Upload style={{ width: 32, height: 32, color: isDragOver ? '#F5A800' : '#9CA3AF', margin: '0 auto 12px' }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                  Arraste os documentos ou clique para selecionar
                </p>
                <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
                  PDF, JPG, PNG, HEIC — até 10 MB por arquivo
                </p>
                <input
                  id="claudinho-input"
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.heic,.webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    setClaudinhoFiles(prev => [...prev, ...files]);
                  }}
                />
              </div>

              {/* Lista de arquivos */}
              {claudinhoFiles.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>
                    {claudinhoFiles.length} arquivo(s) selecionado(s):
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {claudinhoFiles.map((file, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F9FAFB', borderRadius: 8, padding: '8px 12px' }}>
                        <FileText style={{ width: 16, height: 16, color: '#6B7280', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </span>
                        <span style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0 }}>
                          {(file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setClaudinhoFiles(prev => prev.filter((_, j) => j !== i)); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}
                        >
                          <X style={{ width: 14, height: 14, color: '#9CA3AF' }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dica de documentos */}
              <div style={{ background: 'rgba(245,168,0,0.06)', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 6 }}>📄 Documentos recomendados:</p>
                <ul style={{ fontSize: 12, color: '#78350F', margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                  <li><strong>Conta de energia</strong> — extrai nome, endereço, UC, classe</li>
                  <li><strong>RG, CNH</strong> (pessoa física) <strong>ou Cartão CNPJ</strong> (PJ) — verifica titularidade</li>
                  <li><strong>Pedido de compra</strong> (opcional) — preenche equipamentos automaticamente</li>
                </ul>
              </div>

              <button
                onClick={runClaudinhoAnalyze}
                disabled={isAnalyzing || claudinhoFiles.length === 0}
                style={{
                  width: '100%', padding: '14px', borderRadius: 10, border: 'none',
                  background: claudinhoFiles.length === 0 ? '#E5E7EB' : '#F5A800',
                  color: claudinhoFiles.length === 0 ? '#9CA3AF' : '#fff',
                  fontSize: 15, fontWeight: 700, cursor: claudinhoFiles.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 0.2s',
                }}
              >
                {isAnalyzing
                  ? <><Loader2 style={{ width: 18, height: 18 }} className="animate-spin" /> Claudinho está analisando...</>
                  : <><Sparkles style={{ width: 18, height: 18 }} /> Analisar documentos</>}
              </button>
            </motion.div>
          </div>
        </div>
      </MainLayout>
    );
  }

  // ── Formulário principal (etapas 1-3) ────────────────────────────────────────

  return (
    <>
    <MainLayout>
      <div className="uppercase-fields" style={{ background: '#F0F0F0', minHeight: '100%', padding: '24px 16px', boxSizing: 'border-box', margin: '-16px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>

          {/* Back + Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <button
              onClick={() => currentStep === 1 ? (claudinhoResult ? setClaudinhoResult(null) : setEntryMode(null)) : setCurrentStep(s => s - 1)}
              style={{ width: 38, height: 38, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >
              <ArrowLeft style={{ width: 18, height: 18, color: '#374151' }} />
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', lineHeight: 1.2, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                Novo Projeto
                {entryMode === 'auto' && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(245,168,0,0.15)', color: '#92400E' }}>✨ Claudinho Verifica</span>}
              </h1>
              <p style={{ fontSize: 13, color: '#6B7280', marginTop: 2, marginBottom: 0 }}>Preencha os dados para homologação</p>
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
                    color: '#fff', fontWeight: 700, fontSize: 14,
                    boxShadow: currentStep === step.id ? '0 0 0 4px rgba(245,168,0,0.18)' : 'none',
                    transition: 'all 0.3s', flexShrink: 0,
                  }}>
                    {currentStep > step.id ? <Check style={{ width: 18, height: 18 }} /> : <span style={{ color: currentStep === step.id ? '#fff' : '#9E9E9E' }}>{step.id}</span>}
                  </div>
                  <span style={{ fontSize: 11, marginTop: 6, fontWeight: currentStep === step.id ? 700 : 400, color: currentStep === step.id ? '#F5A800' : currentStep > step.id ? '#2D6A4F' : '#9E9E9E' }}>
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div style={{ width: 80, height: 2, margin: '17px 12px 0', background: currentStep > step.id ? '#2D6A4F' : '#E0E0E0', borderRadius: 1, flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>

          {/* Banner do Claudinho quando pré-preencheu */}
          {entryMode === 'auto' && claudinhoResult && currentStep === 1 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ background: 'rgba(245,168,0,0.08)', border: '1px solid rgba(245,168,0,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <Sparkles style={{ width: 18, height: 18, color: '#F5A800', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', margin: 0 }}>
                  Claudinho preencheu o formulário automaticamente
                </p>
                <p style={{ fontSize: 11, color: '#78350F', margin: 0 }}>
                  Revise os campos destacados — as cores indicam o nível de confiança de cada informação.
                </p>
              </div>
            </motion.div>
          )}

          {/* Form card */}
          <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            style={{ background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 20 }}
          >

            {/* ── STEP 1 — Titular ─────────────────────────────────────────── */}
            {currentStep === 1 && (
              <div className="space-y-8">
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <User style={{ width: 18, height: 18, color: '#F5A800' }} />
                    Dados do Titular
                  </h3>

                  <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                    <Label className="text-sm font-medium mb-2 block">Dados de contato</Label>
                    <RadioGroup value={useCompanyContact} onValueChange={(v) => setUseCompanyContact(v as 'manual' | 'company')} className="flex flex-wrap gap-4">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="manual" id="contact-manual" />
                        <Label htmlFor="contact-manual" className="font-normal cursor-pointer">Preencher manualmente</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="company" id="contact-company" />
                        <Label htmlFor="contact-company" className="font-normal cursor-pointer flex items-center gap-1">
                          <Building2 className="w-4 h-4" /> Usar dados da empresa
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AIField label="Nome do Titular *" confidence={fc('holderName')?.confidence} source={fc('holderName')?.source}>
                      <Input value={formData.holderName} onChange={e => updateField('holderName', e.target.value)} placeholder="Nome completo" />
                    </AIField>
                    <AIField label="CPF / CNPJ *" confidence={fc('holderCpfCnpj')?.confidence} source={fc('holderCpfCnpj')?.source}>
                      <Input value={formData.holderCpfCnpj} onChange={e => updateField('holderCpfCnpj', formatCpfCnpj(e.target.value))} placeholder="000.000.000-00 ou 00.000.000/0001-00" />
                    </AIField>
                    <AIField label="Email do Titular *">
                      <Input type="email" value={formData.holderEmail} onChange={e => updateField('holderEmail', e.target.value)} placeholder="email@exemplo.com" disabled={useCompanyContact === 'company'} className={useCompanyContact === 'company' ? 'bg-muted' : ''} />
                    </AIField>
                    <AIField label="Telefone do Titular *">
                      <Input value={formData.holderPhone} onChange={e => updateField('holderPhone', formatPhone(e.target.value))} placeholder="(00) 00000-0000" disabled={useCompanyContact === 'company'} className={useCompanyContact === 'company' ? 'bg-muted' : ''} />
                    </AIField>
                  </div>
                </div>

                {/* Endereço */}
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 16 }}>Endereço do Imóvel</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AIField label="Endereço *" className="md:col-span-2" confidence={fc('address')?.confidence} source={fc('address')?.source}>
                      <Input value={formData.address} onChange={e => updateField('address', e.target.value)} placeholder="Rua, Avenida, etc." />
                    </AIField>
                    <AIField label="Número" confidence={fc('addressNumber')?.confidence} source={fc('addressNumber')?.source}>
                      <Input value={formData.addressNumber} onChange={e => updateField('addressNumber', e.target.value)} placeholder="Nº" />
                    </AIField>
                    <AIField label="Bairro" confidence={fc('neighborhood')?.confidence} source={fc('neighborhood')?.source}>
                      <Input value={formData.neighborhood} onChange={e => updateField('neighborhood', e.target.value)} placeholder="Bairro" />
                    </AIField>
                    <AIField label="CEP" confidence={fc('cep')?.confidence} source={fc('cep')?.source}>
                      <Input value={formData.cep} onChange={e => updateField('cep', formatCEP(e.target.value))} placeholder="00000-000" />
                    </AIField>
                    <AIField label="Cidade *" confidence={fc('city')?.confidence} source={fc('city')?.source}>
                      <Input value={formData.city} onChange={e => updateField('city', e.target.value)} placeholder="Cidade" />
                    </AIField>
                    <AIField label="Estado *" confidence={fc('state')?.confidence} source={fc('state')?.source}>
                      <Select value={formData.state} onValueChange={v => updateField('state', v)}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>{brazilianStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </AIField>
                  </div>

                  {/* Mapa */}
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>LOCALIZAÇÃO NO MAPA</span>
                      <button type="button" onClick={geocodeAddress} disabled={isGeocoding || !formData.address || !formData.city || !formData.state} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: (!formData.address || !formData.city || !formData.state) ? '#E5E7EB' : '#F5A800', color: (!formData.address || !formData.city || !formData.state) ? '#9CA3AF' : '#fff', transition: 'all 0.2s' }}>
                        {isGeocoding ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> Buscando...</> : <><MapPin style={{ width: 13, height: 13 }} /> Buscar no mapa</>}
                      </button>
                    </div>
                    {(showMapPreview || formData.coordinates) ? (
                      <div className="space-y-2">
                        <MapPicker label="" value={formData.coordinates} onChange={coords => updateField('coordinates', coords)} showAutocomplete={false} height={260} draggable={true} />
                        <p style={{ fontSize: 11, color: '#6B7280' }}>📌 Arraste o marcador ou edite as coordenadas se necessário.</p>
                        <Input value={formData.coordinates} onChange={e => updateField('coordinates', e.target.value)} placeholder="Ex: -23.550520, -46.633308" style={{ fontSize: 12, fontFamily: 'monospace' }} />
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: '#9CA3AF', padding: '10px 0' }}>Preencha endereço, cidade e estado e clique em "Buscar no mapa".</p>
                    )}
                  </div>
                </div>

                {/* Unidade Consumidora */}
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', marginBottom: 16 }}>Dados da Unidade Consumidora</h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <AIField label="Número da UC *" confidence={fc('consumerUnitNumber')?.confidence} source={fc('consumerUnitNumber')?.source}>
                        <Input value={formData.consumerUnitNumber} onChange={e => updateField('consumerUnitNumber', e.target.value)} placeholder="Número da unidade consumidora" />
                      </AIField>
                      <FieldGroup label="Concessionária de Energia *">
                        <Select value={formData.concessionaireId} onValueChange={v => updateField('concessionaireId', v)}>
                          <SelectTrigger><SelectValue placeholder="Selecione a concessionária" /></SelectTrigger>
                          <SelectContent>{concessionaires.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </FieldGroup>
                    </div>

                    <div className="space-y-3">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <FL>Classe de Atendimento *</FL>
                        {fc('phaseType') && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: fc('phaseType')!.confidence >= 85 ? '#16A34A' : '#D97706' }}>
                            {fc('phaseType')!.confidence >= 85 ? '✅' : '⚠️'} {fc('phaseType')!.confidence}% confiança
                          </span>
                        )}
                      </div>
                      <RadioGroup value={formData.phaseType} onValueChange={v => updateField('phaseType', v)} className="flex flex-wrap gap-4">
                        {[['monofasico', 'Monofásico'], ['bifasico', 'Bifásico'], ['trifasico', 'Trifásico']].map(([val, label]) => (
                          <div key={val} className="flex items-center space-x-2">
                            <RadioGroupItem value={val} id={val} />
                            <Label htmlFor={val} className="cursor-pointer">{label}</Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <Checkbox checked={formData.isRural} onCheckedChange={c => updateField('isRural', !!c)} />
                      <Label className="cursor-pointer">Projeto rural?</Label>
                    </div>
                    {formData.isRural && (
                      <div className="space-y-2 pl-4 border-l-2 border-primary/20">
                        <MapPicker label="Localização do imóvel rural *" value={formData.coordinates} onChange={coords => updateField('coordinates', coords)} showAutocomplete={true} height={280} draggable={true} />
                        {!formData.coordinates && <p className="text-xs text-amber-500">Clique no mapa ou busque o endereço</p>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2 — Equipamentos ─────────────────────────────────────── */}
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
                    <AIField label="Marca *" confidence={fc('inverterBrand')?.confidence} source={fc('inverterBrand')?.source}>
                      <Input value={formData.inverterBrand} onChange={e => updateField('inverterBrand', e.target.value)} placeholder="Ex: Growatt, Sungrow" />
                    </AIField>
                    <AIField label="Modelo *" confidence={fc('inverterModel')?.confidence} source={fc('inverterModel')?.source}>
                      <Input value={formData.inverterModel} onChange={e => updateField('inverterModel', e.target.value)} placeholder="Ex: MIN 6000TL-X" />
                    </AIField>
                    <AIField label="Potência (kW) *" confidence={fc('inverterPower')?.confidence} source={fc('inverterPower')?.source}>
                      <Input type="number" value={formData.inverterPower} onChange={e => updateField('inverterPower', e.target.value)} placeholder="Ex: 6" />
                    </AIField>
                    <AIField label="Quantidade *" confidence={fc('inverterQuantity')?.confidence} source={fc('inverterQuantity')?.source}>
                      <Input type="number" min="1" value={formData.inverterQuantity} onChange={e => updateField('inverterQuantity', e.target.value)} placeholder="1" />
                    </AIField>
                  </div>
                </div>

                {/* Módulos */}
                <div style={{ background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 12, padding: '16px 20px' }}>
                  <h4 style={{ fontWeight: 600, fontSize: 14, color: '#374151', marginBottom: 14 }}>Módulos Fotovoltaicos</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AIField label="Marca *" confidence={fc('moduleBrand')?.confidence} source={fc('moduleBrand')?.source}>
                      <Input value={formData.moduleBrand} onChange={e => updateField('moduleBrand', e.target.value)} placeholder="Ex: Canadian Solar" />
                    </AIField>
                    <AIField label="Modelo *" confidence={fc('moduleModel')?.confidence} source={fc('moduleModel')?.source}>
                      <Input value={formData.moduleModel} onChange={e => updateField('moduleModel', e.target.value)} placeholder="Ex: CS6W-545MS" />
                    </AIField>
                    <AIField label="Potência do módulo (Wp) *" confidence={fc('modulePower')?.confidence} source={fc('modulePower')?.source}>
                      <Input type="number" value={formData.modulePower} onChange={e => updateField('modulePower', e.target.value)} placeholder="Ex: 545" />
                    </AIField>
                    <AIField label="Quantidade de módulos *" confidence={fc('moduleQuantity')?.confidence} source={fc('moduleQuantity')?.source}>
                      <Input type="number" min="1" value={formData.moduleQuantity} onChange={e => updateField('moduleQuantity', e.target.value)} placeholder="Ex: 12" />
                    </AIField>
                  </div>
                </div>

                <div style={{ background: 'rgba(245,168,0,0.08)', borderRadius: 12, padding: '24px', textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 4 }}>Potência Total do Projeto</p>
                  <p style={{ fontSize: 32, fontWeight: 800, color: '#F5A800', margin: 0 }}>{calculatedPower} <span style={{ fontSize: 18 }}>kWp</span></p>
                  <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
                    Calculado: {formData.modulePower || 0} Wp × {formData.moduleQuantity || 0} módulos
                  </p>
                </div>
              </div>
            )}

            {/* ── STEP 3 — Anexos ──────────────────────────────────────────── */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Upload style={{ width: 18, height: 18, color: '#F5A800' }} />
                  Anexos e Observações
                </h3>

                {/* Banner de docs já mapeados pelo Claudinho */}
                {entryMode === 'auto' && (documents.energyBillGenerator.length > 0 || documents.holderDocument.length > 0) && (
                  <div style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 style={{ width: 16, height: 16, color: '#16A34A', flexShrink: 0 }} />
                    <p style={{ fontSize: 12, color: '#15803D', margin: 0 }}>
                      Claudinho já mapeou {documents.energyBillGenerator.length > 0 ? 'a conta de energia' : ''}{documents.energyBillGenerator.length > 0 && documents.holderDocument.length > 0 ? ' e ' : ''}{documents.holderDocument.length > 0 ? 'o documento do titular' : ''} para os campos abaixo.
                    </p>
                  </div>
                )}

                <DocumentUploadField id="energy_bill_generator" label="Conta de energia da unidade geradora" required files={documents.energyBillGenerator} onFilesChange={files => updateDocuments('energyBillGenerator', files)} />
                <DocumentUploadField id="energy_bill_beneficiaries" label="Contas de energia das unidades beneficiárias" multiple files={documents.energyBillBeneficiaries} onFilesChange={files => updateDocuments('energyBillBeneficiaries', files)} conditionalCheckbox conditionalLabel="Existem unidades beneficiárias?" isConditionalActive={hasBeneficiaries} onConditionalChange={setHasBeneficiaries} />
                <DocumentUploadField id="holder_document" label="Documento com foto do titular" required files={documents.holderDocument} onFilesChange={files => updateDocuments('holderDocument', files)} />
                <DocumentUploadField id="entrance_standard_photo" label="Foto do padrão de entrada" required files={documents.entranceStandardPhoto} onFilesChange={files => updateDocuments('entranceStandardPhoto', files)} />
                <DocumentUploadField id="circuit_breaker_photo" label="Foto do disjuntor de entrada" required files={documents.circuitBreakerPhoto} onFilesChange={files => updateDocuments('circuitBreakerPhoto', files)} hasAlternativeInput alternativeLabel="Corrente do disjuntor (A)" alternativeValue={circuitBreakerCurrent} onAlternativeChange={setCircuitBreakerCurrent} useAlternative={noCircuitBreakerPhoto} onUseAlternativeChange={setNoCircuitBreakerPhoto} />
                <DocumentUploadField id="other_photos" label="Outras fotos (telhado, quadro geral, transformador)" multiple files={documents.otherPhotos} onFilesChange={files => updateDocuments('otherPhotos', files)} />

                <div style={{ paddingTop: 16, borderTop: '1px solid #F3F4F6' }}>
                  <FieldGroup label="Observações do projeto (opcional)">
                    <Textarea className="keep-case" placeholder="Informe particularidades do projeto ou recados para o projetista..." value={formData.observations} onChange={e => updateField('observations', e.target.value)} rows={4} />
                  </FieldGroup>
                </div>

                {/* Resumo */}
                <div style={{ background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 12, padding: '16px 20px', fontSize: 13 }}>
                  <h4 style={{ fontWeight: 700, color: '#1A1A1A', marginBottom: 12 }}>Resumo do Projeto</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <p><span style={{ color: '#6B7280' }}>Titular:</span> {formData.holderName}</p>
                    <p><span style={{ color: '#6B7280' }}>CPF/CNPJ:</span> {formData.holderCpfCnpj}</p>
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
              onClick={() => currentStep === 1 ? (claudinhoResult ? setClaudinhoResult(null) : setEntryMode(null)) : setCurrentStep(s => s - 1)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              <ArrowLeft style={{ width: 16, height: 16 }} />
              Voltar
            </button>

            {currentStep < 3 ? (
              <button onClick={handleNext} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                Continuar <ArrowRight style={{ width: 16, height: 16 }} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || isComparingTitle}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', borderRadius: 8, border: 'none', background: (isSubmitting || isComparingTitle) ? '#FCD34D' : '#F5A800', color: '#fff', cursor: (isSubmitting || isComparingTitle) ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14 }}
              >
                {isComparingTitle && <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />}
                {isSubmitting && <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />}
                <Check style={{ width: 16, height: 16 }} />
                {isComparingTitle ? 'Verificando titularidade...' : 'Enviar Projeto'}
              </button>
            )}
          </div>
        </div>
      </div>
    </MainLayout>

    {/* ── Modal de titularidade ─────────────────────────────────────────────── */}
    <AnimatePresence>
      {showTitleModal && titleComparison && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,168,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle style={{ width: 22, height: 22, color: '#F5A800' }} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
                  {titleComparison.unexpected_document ? 'Documento inesperado' : 'Divergência de titularidade'}
                </h3>
                <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>Claudinho Verifica identificou uma inconsistência</p>
              </div>
            </div>

            <div style={{ background: '#FFF8E6', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
              {titleComparison.unexpected_document ? (
                <p style={{ fontSize: 13, color: '#92400E', margin: 0 }}>
                  O documento enviado foi identificado como <strong>"{titleComparison.document_type_detected}"</strong>, que não é um RG, CNH ou Cartão CNPJ. Certifique-se de que o documento correto foi enviado.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: '#92400E', marginBottom: 8 }}>
                    Os nomes nos documentos não correspondem ({titleComparison.similarity}% de similaridade):
                  </p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ background: '#fff', borderRadius: 8, padding: '8px 12px' }}>
                      <p style={{ fontSize: 11, color: '#6B7280', margin: '0 0 2px' }}>Conta de energia</p>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', margin: 0 }}>{titleComparison.energy_bill_name || '—'}</p>
                    </div>
                    <div style={{ background: '#fff', borderRadius: 8, padding: '8px 12px' }}>
                      <p style={{ fontSize: 11, color: '#6B7280', margin: '0 0 2px' }}>Documento do titular</p>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', margin: 0 }}>{titleComparison.document_name || '—'}</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {!titleComparison.unexpected_document && (
              <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 16 }}>
                A troca de titularidade já foi efetuada?
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!titleComparison.unexpected_document && (
                <button
                  onClick={() => { setShowTitleModal(false); doSubmit(true); }}
                  style={{ padding: '12px', borderRadius: 10, border: 'none', background: '#F5A800', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  Sim, troca efetuada — enviar mesmo assim
                </button>
              )}
              <button
                onClick={() => { setShowTitleModal(false); doSubmit(false); }}
                style={{ padding: '12px', borderRadius: 10, border: '1.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                {titleComparison.unexpected_document ? 'Entendi, enviar mesmo assim' : 'Não, mas quero enviar mesmo assim'}
              </button>
              <button
                onClick={() => setShowTitleModal(false)}
                style={{ padding: '12px', borderRadius: 10, border: 'none', background: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer' }}
              >
                Cancelar e corrigir os documentos
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
