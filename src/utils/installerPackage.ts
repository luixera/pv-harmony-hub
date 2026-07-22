import PizZip from 'pizzip';
import { supabase } from '@/integrations/supabase/client';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { PackageItem, REUSABLE_PHOTO_TYPES, PROJECT_DOCUMENT_TYPES } from '@/hooks/useInstallerPackage';
import { sanitizeFileName } from '@/lib/utils';
import { imageToPdfBlob } from '@/lib/equipmentDocs';
import { buildProjectValues } from '@/utils/projectValues';
import { generateResumoPdf } from '@/utils/resumoPdf';
import { generateDocxFromTemplate } from '@/utils/docxGenerator';
import { downloadTemplateBuffer } from '@/hooks/useConcessionaireTemplates';
import { fetchEntryRules, matchEntryRule, entryRuleValues } from '@/hooks/useEntryRules';

export interface PhotoCandidate {
  projectCode: string;
  holder: string;
  path: string;
  fileName: string;
}

export interface ResolvedEntry {
  index: number;
  label: string;
  fileLabel: string;         // nome padronizado do arquivo (derivado da origem)
  ext: string;
  required: boolean;
  status: 'ok' | 'missing' | 'reusable_missing';
  blob?: Blob;
  docType?: string;          // para itens de foto reutilizável
  candidates?: PhotoCandidate[];
}

const extFromName = (name: string, fallback = 'pdf') => {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : fallback;
};

/** Converte para PDF quando é imagem; mantém PDF; demais formatos ficam como estão. */
export async function toPdfBlob(blob: Blob, fileName: string): Promise<{ blob: Blob; ext: string }> {
  const isImg = blob.type.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(fileName);
  const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test(fileName);
  if (isImg) {
    const f = new File([blob], fileName || 'imagem', { type: blob.type || 'image/jpeg' });
    return { blob: await imageToPdfBlob(f), ext: 'pdf' };
  }
  if (isPdf) return { blob, ext: 'pdf' };
  return { blob, ext: extFromName(fileName) };
}

async function downloadFromBucket(bucket: string, path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) { console.error('download', bucket, path, error); return null; }
  return data;
}

/** Último documento de um tipo enviado no projeto. */
async function latestProjectDoc(projectId: string, docType: string) {
  const { data } = await supabase
    .from('documents')
    .select('file_url, file_name')
    .eq('project_id', projectId)
    .eq('document_type', docType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { file_url: string; file_name: string } | null;
}

/** Fotos de outros projetos com mesmo disjuntor + fase, do mesmo tipo. */
export async function fetchPhotoCandidates(project: ProjectWithDetails, docType: string): Promise<PhotoCandidate[]> {
  const breaker = project.generalData?.circuit_breaker_current;
  const phase = project.generalData?.phase_type;
  if (!breaker || !phase) return [];

  const { data: gds } = await supabase
    .from('project_general_data')
    .select('project_id, holder_name')
    .eq('circuit_breaker_current', breaker)
    .eq('phase_type', phase);
  const others = (gds ?? []).filter(x => x.project_id !== project.id);
  if (others.length === 0) return [];

  const ids = others.map(x => x.project_id);
  const holderById = new Map(others.map(x => [x.project_id, x.holder_name as string]));

  const { data: docs } = await supabase
    .from('documents')
    .select('file_url, file_name, project_id')
    .in('project_id', ids)
    .eq('document_type', docType)
    .order('created_at', { ascending: false });
  if (!docs || docs.length === 0) return [];

  const { data: projs } = await supabase.from('projects').select('id, code').in('id', ids);
  const codeById = new Map((projs ?? []).map(p => [p.id, p.code as string]));

  return docs.map(d => ({
    path: d.file_url as string,
    fileName: d.file_name as string,
    projectCode: codeById.get(d.project_id as string) ?? '',
    holder: holderById.get(d.project_id as string) ?? '',
  }));
}

/** Resolve o item de equipamento (INMETRO/datasheet/AFCI) do inversor ou módulo. */
async function resolveEquipmentDoc(
  project: ProjectWithDetails,
  which: 'inverter' | 'module',
  kind: 'inmetro' | 'datasheet' | 'afci',
) {
  const eq = project.equipment as (NonNullable<ProjectWithDetails['equipment']> & { inverter_catalog_id?: string; module_catalog_id?: string }) | undefined;
  if (!eq) return null;
  const catalogId = which === 'inverter' ? eq.inverter_catalog_id : eq.module_catalog_id;
  const brand = which === 'inverter' ? eq.inverter_brand : eq.module_brand;
  const model = which === 'inverter' ? eq.inverter_model : eq.module_model;

  type Row = { datasheet_url: string | null; inmetro_url: string | null; afci_url: string | null };
  const COLS = 'datasheet_url, inmetro_url, afci_url';
  const pick = (r: Row | null) => !r ? null
    : kind === 'inmetro' ? r.inmetro_url : kind === 'afci' ? r.afci_url : r.datasheet_url;

  // 1) tenta o item vinculado do catálogo
  let path: string | null = null;
  if (catalogId) {
    const { data } = await supabase.from('equipment_catalog' as never).select(COLS).eq('id', catalogId).maybeSingle();
    path = pick(data as Row | null);
  }
  // 2) se o vínculo não tem ESTE documento, procura por marca+modelo — outro
  //    registro da mesma marca/modelo pode ter o arquivo. Isso conserta o caso
  //    do inversor digitado à mão ou vinculado a um item sem INMETRO.
  if (!path && brand && model) {
    const { data } = await supabase.from('equipment_catalog' as never)
      .select(COLS).eq('type', which).ilike('brand', brand).ilike('model', model)
      .not(kind === 'inmetro' ? 'inmetro_url' : kind === 'afci' ? 'afci_url' : 'datasheet_url', 'is', null)
      .limit(1).maybeSingle();
    path = pick(data as Row | null);
  }
  if (!path) return null;
  return downloadFromBucket('equipment-documents', path);
}

/** Resolve todos os itens do pacote para blobs (ou marca faltantes). */
export async function resolveInstallerPackage(project: ProjectWithDetails, items: PackageItem[]): Promise<ResolvedEntry[]> {
  const values = buildProjectValues(project);
  // Variáveis do padrão de entrada da concessionária (categoria por fase + disjuntor)
  if (project.concessionaire_id) {
    const rules = await fetchEntryRules(project.concessionaire_id);
    const rule = matchEntryRule(rules, project.generalData?.phase_type, project.generalData?.circuit_breaker_current);
    Object.assign(values, entryRuleValues(rule));
  }
  const out: ResolvedEntry[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const base: ResolvedEntry = { index: i, label: item.label, fileLabel: item.label, ext: 'pdf', required: item.required, status: 'missing' };

    try {
      if (item.source_type === 'summary') {
        base.fileLabel = 'RESUMO';
        base.blob = await generateResumoPdf(project);
        base.ext = 'pdf'; base.status = 'ok';

      } else if (item.source_type === 'project_document') {
        const docType = item.ref ?? '';
        // nome padronizado a partir do tipo real do documento (corrige rótulos errados)
        base.fileLabel = PROJECT_DOCUMENT_TYPES.find(d => d.value === docType)?.label ?? item.label;
        const doc = await latestProjectDoc(project.id, docType);
        if (doc) {
          const raw = await downloadFromBucket('project-documents', doc.file_url);
          if (raw) { const r = await toPdfBlob(raw, doc.file_name); base.blob = r.blob; base.ext = r.ext; base.status = 'ok'; }
        }
        if (base.status !== 'ok' && REUSABLE_PHOTO_TYPES.includes(docType)) {
          base.docType = docType;
          base.candidates = await fetchPhotoCandidates(project, docType);
          base.status = 'reusable_missing';
        }

      } else if (item.source_type === 'concessionaire_template') {
        base.fileLabel = item.label;
        if (item.ref) {
          const buffer = await downloadTemplateBuffer(item.ref);
          base.blob = await generateDocxFromTemplate(buffer, values);
          base.ext = 'docx'; base.status = 'ok';
        }

      } else if (item.source_type === 'equipment_inmetro' || item.source_type === 'equipment_datasheet' || item.source_type === 'equipment_afci') {
        // AFCI é exclusivo de inversor
        const which: 'inverter' | 'module' =
          item.source_type === 'equipment_afci' ? 'inverter' : (item.ref === 'module' ? 'module' : 'inverter');
        const kind = item.source_type === 'equipment_inmetro' ? 'inmetro'
          : item.source_type === 'equipment_afci' ? 'afci' : 'datasheet';
        const kindLabel = kind === 'inmetro' ? 'INMETRO' : kind === 'afci' ? 'AFCI' : 'DATASHEET';
        base.fileLabel = `${kindLabel} ${which === 'inverter' ? 'INVERSOR' : 'MODULO'}`;
        const blob = await resolveEquipmentDoc(project, which, kind);
        if (blob) { base.blob = blob; base.ext = 'pdf'; base.status = 'ok'; }
      }
    } catch (e) {
      console.error('resolve item', item, e);
    }

    out.push(base);
  }
  return out;
}

/** Baixa uma foto candidata (do bucket project-documents) já convertida em PDF. */
export async function loadCandidateBlob(path: string): Promise<{ blob: Blob; ext: string } | null> {
  const raw = await downloadFromBucket('project-documents', path);
  if (!raw) return null;
  return toPdfBlob(raw, path);
}

/** Lê os blobs das entradas resolvidas e gera o ZIP numerado. */
export async function buildInstallerZipAsync(project: ProjectWithDetails, entries: ResolvedEntry[]): Promise<Blob> {
  const zip = new PizZip();
  for (const e of entries) {
    if (!e.blob) continue;
    const buf = await e.blob.arrayBuffer();
    const name = `${e.index}_${sanitizeFileName((e.fileLabel || e.label).toUpperCase())}.${e.ext}`;
    zip.file(name, buf);
  }
  const content = zip.generate({ type: 'blob', mimeType: 'application/zip' });
  return content as Blob;
}
