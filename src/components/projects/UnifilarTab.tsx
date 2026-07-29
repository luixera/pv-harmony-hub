import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FlaskConical, LayoutTemplate, Lightbulb, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { buildTechnicalJsonFromProject } from '@/utils/cadEngine/buildTechnicalJson';
import {
  ConnectionEndpoint, DiagramSceneState, ManualConnection,
  buildMicroSchematicScene, buildMultiArrangementScene, initialConnections, initialPlacement,
  inverterCountOf, isConnectionResolvable, microSchematicFit, multiplyInverterBranches, pickPaper,
} from '@/utils/cadEngine/editableLayout';
import { Point } from '@/utils/cadEngine/types';
import { buildProjectValues } from '@/utils/projectValues';
import { DiagramEditor } from '@/components/diagrams/DiagramEditor';
import { useProjectDiagram, useSaveProjectDiagram } from '@/hooks/useProjectDiagram';
import { useDiagramTemplates } from '@/hooks/useDiagramTemplates';
import { matchEntryRule, useEntryRules } from '@/hooks/useEntryRules';
import { useEngineeringRuleMap } from '@/hooks/useEngineeringRules';
import {
  MicroPlan, ProjectArrangementOption, inverterSpecsFromTechSpecs, isMicroinverter,
  microSpecsFromTechSpecs, ruleValue, suggestBreakerPlan, suggestElectricalSizing,
  suggestMicroinverterPlan, suggestProjectArrangement,
} from '@/utils/engineering/rulesEngine';
import { useEquipmentCatalog, useSaveEquipment } from '@/hooks/useEquipmentCatalog';
import { validateDiagram } from '@/utils/engineering/diagramValidator';
import { fetchLocationMap, LOCATION_MAP_MESSAGES } from '@/utils/cadEngine/locationMap';

/** Modelo de equipamento é texto livre e costuma ser longo
 *  ("ASTRONERGY CHSM66RN(DG)/F-BH610") — encurta pra legenda não invadir o
 *  bloco vizinho no desenho. */
const curto = (t: string, max = 30) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** Fase do projeto no vocabulário do motor (o cadastro é texto livre). */
function phaseTypeOf(raw: unknown): 'monofasico' | 'bifasico' | 'trifasico' {
  const s = String(raw ?? '').toLowerCase();
  return s.includes('tri') ? 'trifasico' : s.includes('bi') ? 'bifasico' : 'monofasico';
}

/**
 * Diagrama Unifilar do projeto — o `DiagramEditor` compartilhado alimentado
 * pelos dados do PROJETO real. Aqui só entra o que é específico do contexto
 * "dentro do modal de um projeto":
 *
 * - Monta o JSON técnico e os valores de tag (`buildTechnicalJsonFromProject`
 *   / `buildProjectValues`) — as tags {chave} de legendas/carimbo resolvem
 *   com os dados DESTE projeto.
 * - Persiste em `project_diagrams` (banco, autosave debounced) — o mesmo
 *   diagrama aparece pra equipe toda, em qualquer máquina. Diagramas antigos
 *   salvos em `localStorage` são lidos uma última vez como ponto de partida
 *   e migram pro banco na primeira edição.
 * - **Importa um modelo** do motor de templates: o diagrama do projeto passa
 *   a ser uma CÓPIA do modelo (editar aqui nunca altera o modelo). Modelos da
 *   mesma concessionária do projeto aparecem como sugeridos.
 * - Reconcilia com os 5 componentes do cadastro a cada troca de equipamento
 *   (ver `reconcile()`), EXCETO quando o diagrama veio de um modelo — um
 *   modelo é uma cena completa própria, sem a cadeia fixa do cadastro.
 */

const STORAGE_PREFIX = 'unifilar-layout:';

interface SavedLayout {
  placements: DiagramSceneState['placements'];
  connections: unknown[]; // formato salvo pode ser antigo (string) ou novo (ConnectionEndpoint) — migrado abaixo
  photos?: DiagramSceneState['photos'];
  texts?: DiagramSceneState['texts'];
  groups?: DiagramSceneState['groups'];
  shapes?: DiagramSceneState['shapes'];
  suppressedIds?: string[];
  sheet?: DiagramSceneState['sheet'];
}

/** Diagramas salvos antes das ligações virarem `ConnectionEndpoint` gravavam
 *  `from`/`to` como string (id do componente) direto, sem o envelope
 *  `{kind,...}`. Migra na leitura para não quebrar diagramas já salvos. */
function migrateConnection(raw: unknown): ManualConnection {
  const c = raw as { id: string; from: unknown; to: unknown; waypoints?: Point[]; label?: string };
  const toEndpoint = (e: unknown): ConnectionEndpoint =>
    typeof e === 'string' ? { kind: 'symbol', id: e } : (e as ConnectionEndpoint);
  return { id: c.id, from: toEndpoint(c.from), to: toEndpoint(c.to), waypoints: c.waypoints, label: c.label };
}

/** Cena que veio de um modelo: todos os componentes têm id `manual-` (modelos
 *  começam vazios, todo símbolo é adicionado pela paleta). Um diagrama normal
 *  de projeto sempre contém os ids fixos do cadastro (PV-01, INV-01, ...). */
function isTemplateScene(saved: SavedLayout): boolean {
  return saved.placements.length > 0 && saved.placements.every(p => p.id.startsWith('manual-'));
}

/**
 * Funde o estado salvo com os componentes atuais do projeto. Os componentes
 * derivados do projeto (ids fixos tipo `PV-01`) são resincronizados a cada
 * troca de equipamento; componentes com prefixo `manual-` sobrevivem sempre.
 * Cena vinda de um MODELO (só `manual-`) passa direto, sem semear a cadeia
 * fixa — o modelo é o diagrama inteiro.
 */
function reconcile(json: ReturnType<typeof buildTechnicalJsonFromProject>, saved: SavedLayout | null): DiagramSceneState {
  const fresh = initialPlacement(json);
  if (!saved) return { placements: fresh, connections: initialConnections(json), photos: [], texts: [], groups: [] };

  if (isTemplateScene(saved)) {
    const byId = new Map(saved.placements.map(p => [p.id, { ...p, scale: p.scale ?? 1 }]));
    const connections = (saved.connections ?? [])
      .map(migrateConnection)
      .filter(c => isConnectionResolvable(c, byId));
    return {
      placements: [...byId.values()], connections,
      photos: saved.photos ?? [], texts: saved.texts ?? [],
      groups: saved.groups ?? [], shapes: saved.shapes ?? [], sheet: saved.sheet,
    };
  }

  // componentes fixos que o usuário REMOVEU à mão não são semeados de novo
  const suppressed = new Set(saved.suppressedIds ?? []);
  const reconciledProject = fresh
    .filter(f => !suppressed.has(f.id))
    .map(f => {
      const s = saved.placements.find(p => p.id === f.id);
      return s ? { ...f, x: s.x, y: s.y, rotation: s.rotation, scale: s.scale ?? 1 } : f;
    });
  const manual = saved.placements
    .filter(p => p.id.startsWith('manual-'))
    .map(p => ({ ...p, scale: p.scale ?? 1 })); // diagramas salvos antes do redimensionamento não tinham "scale"
  const placements = [...reconciledProject, ...manual];

  const byId = new Map(placements.map(p => [p.id, p]));
  const connections = (saved.connections ?? [])
    .map(migrateConnection)
    .filter(c => isConnectionResolvable(c, byId));

  return {
    placements, connections,
    photos: saved.photos ?? [], texts: saved.texts ?? [],
    groups: saved.groups ?? [], shapes: saved.shapes ?? [],
    suppressedIds: saved.suppressedIds ?? [], sheet: saved.sheet,
  };
}

/** Último recurso: layout salvo no localStorage (formato antigo, por navegador). */
function loadLegacyLocalState(projectId: string): SavedLayout | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function UnifilarTab({ project }: { project: ProjectWithDetails }) {
  const json = useMemo(() => buildTechnicalJsonFromProject(project), [project]);
  const values = useMemo(() => buildProjectValues(project), [project]);
  const { data: dbScene, isLoading } = useProjectDiagram(project.id);
  const saveDiagram = useSaveProjectDiagram();
  const { data: templates = [] } = useDiagramTemplates();

  // Aplicar um modelo troca o estado inicial inteiro — o `stateKey` versionado
  // força o DiagramEditor a reseedar com a cena do modelo.
  const [applied, setApplied] = useState<{ v: number; state: DiagramSceneState } | null>(null);
  const [templatePick, setTemplatePick] = useState('');

  const initialState = useMemo(() => {
    if (applied) return applied.state;
    const saved = (dbScene as SavedLayout | null) ?? loadLegacyLocalState(project.id);
    return reconcile(json, saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dbScene só importa na carga; edições seguem via onStateChange
  }, [project.id, json, dbScene, applied]);

  const debounceRef = useRef<number | null>(null);
  // Cópia viva da cena pro VALIDADOR (o editor é quem manda o estado a cada
  // mudança; o autosave continua com o debounce dele).
  const [liveState, setLiveState] = useState<DiagramSceneState | null>(null);
  useEffect(() => { setLiveState(null); }, [initialState]); // reseed → volta a validar o estado inicial
  const handleStateChange = (state: DiagramSceneState) => {
    setLiveState(state);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      saveDiagram.mutate({ projectId: project.id, sceneData: state });
    }, 800);
  };

  const projectInverters = Math.max(1, Number(project.equipment?.inverter_quantity ?? 1) || 1);
  // Regras do padrão de entrada da concessionária do projeto — dão a legenda
  // do bloco PADRÃO DE ENTRADA no diagrama automático (disjuntor/categoria/caixa).
  const { data: entryRules = [] } = useEntryRules(project.concessionaire_id ?? undefined);
  // Datasheet do inversor do projeto (catálogo) — dá a corrente CA real, que é
  // a base exata do disjuntor de cada arranjo.
  const { data: inverterCatalogItems = [] } = useEquipmentCatalog('inverter');
  const inverterCatalog = useMemo(() => {
    const id = (project.equipment as { inverter_catalog_id?: string } | undefined)?.inverter_catalog_id;
    return id ? inverterCatalogItems.find(i => i.id === id) ?? null : null;
  }, [inverterCatalogItems, project.equipment]);

  // ── Sugestões do Motor de Engenharia (Rules Engine, Fase 1) ──────────────
  const { ruleMap } = useEngineeringRuleMap();
  const saveEquipment = useSaveEquipment();
  const [suggestOpen, setSuggestOpen] = useState(false);

  /** MICROINVERSOR: outro conjunto de regras (não tem janela de string — o que
   *  manda é o nº de entradas do micro e quantos cabem no ramal CA). Detecta
   *  pelo datasheet do catálogo e, sem ele, pelo nome do equipamento. */
  // "Tratar como microinversores": escape manual pra quando o modelo não é
  // reconhecido (marca nova, nome sem "micro"). O botão do painel também
  // grava a marcação no catálogo, pra o próximo projeto já nascer certo.
  const [forceMicro, setForceMicro] = useState(false);
  const autoMicro = useMemo(() => isMicroinverter(
    inverterCatalog?.tech_specs ?? null,
    [inverterCatalog?.brand, inverterCatalog?.model, project.equipment?.inverter_brand, project.equipment?.inverter_model]
      .filter(Boolean).join(' '),
    Number(project.equipment?.inverter_power ?? 0) || undefined,
  ), [inverterCatalog, project.equipment]);
  const isMicro = autoMicro || forceMicro;

  const microPlan = useMemo(() => {
    if (!isMicro || !suggestOpen || ruleMap.size === 0) return null;
    const e = project.equipment;
    return suggestMicroinverterPlan({
      totalModules: Math.max(0, Number(e?.module_quantity ?? 0) || 0),
      micro: microSpecsFromTechSpecs(inverterCatalog?.tech_specs ?? null, Number(e?.inverter_power ?? 0) || undefined),
      unitCount: projectInverters,
      phaseType: phaseTypeOf(project.generalData?.phase_type),
      includeGeneral: ruleValue(ruleMap, 'protections.include_general_ac_breaker', 1) !== 0,
    }, ruleMap);
  }, [isMicro, suggestOpen, ruleMap, project.equipment, project.generalData, inverterCatalog, projectInverters]);

  const engineResult = useMemo(() => {
    if (isMicro) return null;   // o caminho de microinversor tem painel próprio
    if (!suggestOpen || ruleMap.size === 0) return null;
    const e = project.equipment;
    const totalModules = Math.max(0, Number(e?.module_quantity ?? 0) || 0);
    const powerKw = Number(e?.inverter_power ?? 0) || undefined;
    return suggestProjectArrangement({
      totalModules,
      moduleSpecs: { powerW: Number(e?.module_power ?? 0) || undefined },
      // um item por inversor físico (specs repetidas; datasheet completo
      // virá do catálogo — sem ele, o motor usa as regras-fallback e avisa)
      inverters: Array.from({ length: projectInverters }, () => ({ powerKw })),
    }, ruleMap);
  }, [isMicro, suggestOpen, ruleMap, project.equipment, projectInverters]);

  // Dimensionamento elétrico simplificado (Fase 2): bitolas, queda, disjuntor
  const sizing = useMemo(() => {
    if (!suggestOpen || ruleMap.size === 0) return null;
    const rawPhase = String(project.generalData?.phase_type ?? '').toLowerCase();
    const phaseType = rawPhase.includes('tri') ? 'trifasico' as const
      : rawPhase.includes('bi') ? 'bifasico' as const : 'monofasico' as const;
    return suggestElectricalSizing({
      inverterPowerKw: Number(project.equipment?.inverter_power ?? 0) || undefined,
      phaseType,
    }, ruleMap);
  }, [suggestOpen, ruleMap, project.equipment, project.generalData]);

  // ── Validador elétrico local (checklist do engenheiro, sem IA) ───────────
  const [validationOpen, setValidationOpen] = useState(false);
  const validation = useMemo(
    () => validateDiagram(liveState ?? initialState, ruleMap),
    [liveState, initialState, ruleMap],
  );

  /** "Usar esta": gera o diagrama na topologia multi-arranjo (1 disjuntor CA
   *  por arranjo, junção em nó, disjuntor geral opcional por regra, DPS em
   *  paralelo depois da junção e caminho de referência pras cargas do local).
   *  A cena sai 100% `manual-` — editável livremente, sem reconcile por cima. */
  /** Insere/atualiza a PLANTA DE LOCALIZAÇÃO no diagrama que já existe —
   *  recorte de satélite das coordenadas do projeto, como manda a praxe. */
  const [mapLoading, setMapLoading] = useState(false);
  const insertLocationMap = async () => {
    setMapLoading(true);
    try {
      const { map, reason } = await fetchLocationMap(project.generalData?.coordinates);
      if (!map) {
        alert(`Planta de localização: ${LOCATION_MAP_MESSAGES[reason ?? 'falhou']}`);
        return;
      }
      const base = liveState ?? initialState;
      // troca a planta anterior (se houver) em vez de empilhar
      const photos = (base.photos ?? []).filter(p => !p.id.includes('-planta-'));
      const texts = (base.texts ?? []).filter(t => !t.id.includes('-planta-'));
      const groups = (base.groups ?? []).filter(g => g.title !== 'PLANTA DE LOCALIZAÇÃO');
      const stamp = Date.now();
      const state: DiagramSceneState = {
        ...base,
        photos: [...photos, { id: `manual-planta-${stamp}`, href: map.href, x: 18, y: 36, w: 54, h: 38 }],
        texts: [...texts, { id: `manual-planta-legenda-${stamp}`, value: map.caption, x: 18, y: 79, size: 2.2 }],
        groups: [{ id: `manual-group-planta-${stamp}`, title: 'PLANTA DE LOCALIZAÇÃO', x: 15, y: 32, w: 60, h: 50, style: 'solid' as const, moveContents: true }, ...groups],
      };
      setApplied(prev => ({ v: (prev?.v ?? 0) + 1, state }));
    } finally {
      setMapLoading(false);
    }
  };

  /** Dados do padrão de entrada/medidor/placa — iguais nos dois caminhos. */
  const sheetOptions = () => {
    const entryRule = matchEntryRule(entryRules, project.generalData?.phase_type, project.generalData?.circuit_breaker_current);
    return {
      entryBreakerLegend: entryRule
        ? [[`${entryRule.disjuntor}A`, entryRule.categoria ? `cat. ${entryRule.categoria}` : ''].filter(Boolean).join(' · '),
           entryRule.bitola ? `bitola ${entryRule.bitola} mm²` : ''].filter(Boolean)
        : [],
      meterLegend: entryRule?.caixa_medicao ? [`caixa ${entryRule.caixa_medicao}`] : [],
      warningVariant: ((project.concessionaireName ?? '').toLowerCase().includes('enel') ? 'enel' : 'generic') as 'enel' | 'generic',
      utilityName: project.concessionaireName ?? undefined,
      includeLoadsReference: ruleValue(ruleMap, 'arrays.include_loads_reference', 1) !== 0,
    };
  };

  /** MICROINVERSORES: gera o diagrama nas DUAS representações possíveis —
   *  'compacto' (1 fileira por ramal, com as quantidades nas legendas) ou
   *  'esquematico' (cada micro com os seus módulos, encadeados no barramento
   *  CA, como na prancha de referência). O plano elétrico é o mesmo. */
  const applyMicroPlan = async (plan: MicroPlan, style: 'compacto' | 'esquematico') => {
    const micro = microSpecsFromTechSpecs(inverterCatalog?.tech_specs ?? null, Number(project.equipment?.inverter_power ?? 0) || undefined);
    const microModel = [inverterCatalog?.brand, inverterCatalog?.model].filter(Boolean).join(' ')
      || [project.equipment?.inverter_brand, project.equipment?.inverter_model].filter(Boolean).join(' ')
      || 'Microinversor';
    const moduleModel = [project.equipment?.module_brand, project.equipment?.module_model].filter(Boolean).join(' ')
      || (project.equipment?.module_power ? `${project.equipment.module_power}Wp` : '');
    const microSpecLine = [
      micro.powerKw ? `${micro.powerKw * 1000}W` : '',
      micro.maxAcCurrentA ? `${micro.maxAcCurrentA}A` : '',
    ].filter(Boolean).join(' · ');
    const dcSizing = suggestElectricalSizing({ phaseType: phaseTypeOf(project.generalData?.phase_type) }, ruleMap);
    const locationMap = (await fetchLocationMap(project.generalData?.coordinates)).map;
    const common = {
      ...sheetOptions(),
      locationMap,
      includeGeneralBreaker: plan.branches.length > 1 && plan.generalBreakerA != null,
      generalBreakerA: plan.generalBreakerA,
      dcSection: dcSizing.dc ? `${dcSizing.dc.sectionMm2} mm²` : undefined,
      branchSection: plan.branchSectionMm2 ? `${plan.branchSectionMm2} mm²` : undefined,
      trunkSection: plan.trunkSectionMm2 ? `${plan.trunkSectionMm2} mm²` : undefined,
    };

    const state = style === 'esquematico'
      ? buildMicroSchematicScene({
          ...common,
          branches: plan.branches.map(b => ({ modulesPerUnit: b.modulesPerUnit, breakerA: b.breakerA })),
          microModel, microLegend: microSpecLine ? [microSpecLine] : [], moduleModel,
        })
      : buildMultiArrangementScene({
          ...common,
          paper: pickPaper({ rows: plan.branches.length, hasMap: !!locationMap }),
          inverterCount: plan.branches.length,
          inverterKind: 'microinverter',
          pvLabels: plan.branches.map((_, i) => (plan.branches.length > 1 ? `Módulos – Ramal ${i + 1}` : 'Módulos')),
          pvLegends: plan.branches.map(b => [
            `${b.units} × ${plan.modulesPerUnitCap} = ${b.modules} módulos`, curto(moduleModel),
          ].filter(Boolean)),
          inverterLabels: plan.branches.map((_, i) => (plan.branches.length > 1 ? `Microinversores – Ramal ${i + 1}` : 'Microinversores')),
          inverterLegends: plan.branches.map(b => [curto(`${b.units}× ${microModel}`), microSpecLine].filter(Boolean)),
          breakerLabels: plan.branches.map((_, i) => (plan.branches.length > 1 ? `Disjuntor Ramal ${i + 1}` : 'Disjuntor Geral CA')),
          branchBreakerA: plan.branches.map(b => b.breakerA),
        });
    setApplied(prev => ({ v: (prev?.v ?? 0) + 1, state }));
    setSuggestOpen(false);
  };

  const applySuggestion = async (opt: ProjectArrangementOption) => {
    if (!confirm(`Usar "${opt.title}" (${opt.summary})? O diagrama atual será substituído pela topologia automática com este arranjo.`)) return;
    const pvLegends = Array.from({ length: projectInverters }, (_, i) => {
      const arr = opt.perInverter[Math.min(i, opt.perInverter.length - 1)];
      return [arr.label, arr.operatingVoltageV ? `~${arr.operatingVoltageV}V de operação` : ''].filter(Boolean);
    });
    // padrão de entrada do projeto — as regras cadastradas em Concessionárias
    const entryRule = matchEntryRule(entryRules, project.generalData?.phase_type, project.generalData?.circuit_breaker_current);

    // Disjuntor geral: pergunta ao usuário (a regra decide só o padrão da caixa)
    const ruleWantsGeneral = ruleValue(ruleMap, 'protections.include_general_ac_breaker', 1) !== 0;
    const includeGeneral = projectInverters > 1
      ? confirm(`Colocar um disjuntor geral para seccionar os ${projectInverters} arranjos?\n\nEle é opcional (cada arranjo já tem o seu) e será dimensionado pela SOMA das correntes dos inversores.`)
      : ruleWantsGeneral;

    // Proteções: disjuntor de cada arranjo pela corrente CA do inversor
    const rawPhase = String(project.generalData?.phase_type ?? '').toLowerCase();
    const phaseType = rawPhase.includes('tri') ? 'trifasico' as const
      : rawPhase.includes('bi') ? 'bifasico' as const : 'monofasico' as const;
    const invSpecs = inverterSpecsFromTechSpecs(
      inverterCatalog?.tech_specs ?? null,
      Number(project.equipment?.inverter_power ?? 0) || undefined,
    );
    const plan = suggestBreakerPlan({
      inverters: Array.from({ length: projectInverters }, () => ({
        powerKw: invSpecs.powerKw, acCurrentA: invSpecs.maxAcCurrentA,
      })),
      phaseType,
      includeGeneral,
    }, ruleMap);
    const dcSizing = suggestElectricalSizing({ phaseType }, ruleMap);
    // planta de localização (recorte de satélite) — some silenciosamente se o
    // projeto não tiver coordenadas ou faltar a chave do Maps
    const locationMap = (await fetchLocationMap(project.generalData?.coordinates)).map;

    const state = buildMultiArrangementScene({
      paper: pickPaper({ rows: projectInverters, hasMap: !!locationMap }),
      inverterCount: projectInverters,
      pvLegends,
      locationMap,
      includeGeneralBreaker: includeGeneral,
      includeLoadsReference: ruleValue(ruleMap, 'arrays.include_loads_reference', 1) !== 0,
      branchBreakerA: plan.branches.map(b => b.breakerA),
      generalBreakerA: plan.generalBreakerA,
      dcSection: dcSizing.dc ? `${dcSizing.dc.sectionMm2} mm²` : undefined,
      branchSection: plan.branchSectionMm2 ? `${plan.branchSectionMm2} mm²` : undefined,
      trunkSection: plan.trunkSectionMm2 ? `${plan.trunkSectionMm2} mm²` : undefined,
      entryBreakerLegend: entryRule
        ? [[`${entryRule.disjuntor}A`, entryRule.categoria ? `cat. ${entryRule.categoria}` : ''].filter(Boolean).join(' · '),
           entryRule.bitola ? `bitola ${entryRule.bitola} mm²` : ''].filter(Boolean)
        : [],
      meterLegend: entryRule?.caixa_medicao ? [`caixa ${entryRule.caixa_medicao}`] : [],
      // ENEL usa a placa própria (AVISO / RETORNO GERADOR DE ENERGIA);
      // CPFL e demais usam a placa amarela CUIDADO / GERAÇÃO PRÓPRIA
      warningVariant: (project.concessionaireName ?? '').toLowerCase().includes('enel') ? 'enel' : 'generic',
      utilityName: project.concessionaireName ?? undefined,
    });
    setApplied(prev => ({ v: (prev?.v ?? 0) + 1, state }));
    setSuggestOpen(false);
  };

  const applyTemplate = () => {
    const t = templates.find(x => x.id === templatePick);
    if (!t) return;
    if (!confirm(`Aplicar o modelo "${t.name}" a este projeto? O diagrama atual deste projeto será substituído (o modelo em si não é alterado).`)) return;
    // paramétrico: modelo de 1 inversor num projeto com N — oferece replicar o ramal FV
    let state = t.scene_data;
    if (projectInverters > 1 && inverterCountOf(state) === 1) {
      if (confirm(`Este projeto tem ${projectInverters} inversores e o modelo desenha 1. Replicar o ramal FV (módulos + proteções + inversor) ${projectInverters}x automaticamente, todos ligando no mesmo barramento?`)) {
        const multiplied = multiplyInverterBranches(state, projectInverters);
        if (multiplied) state = multiplied;
        else alert('Não deu pra replicar automaticamente (topologia do modelo fora do padrão 1 ramal → 1 inversor) — o modelo foi aplicado como está.');
      }
    }
    setApplied(prev => ({ v: (prev?.v ?? 0) + 1, state }));
    setTemplatePick('');
  };

  // Casamento paramétrico: mesma concessionária (2 pts) + nº de inversores do
  // desenho igual ao do projeto (1 pt). Score > 0 = sugerido, melhor primeiro.
  const sortedTemplates = useMemo(() => {
    const scored = templates.map(t => {
      let score = 0;
      if (t.concessionaire_id && t.concessionaire_id === project.concessionaire_id) score += 2;
      const drawn = inverterCountOf(t.scene_data);
      if (drawn > 0 && (drawn === projectInverters || (drawn === 1 && projectInverters > 1))) score += 1;
      return { t, score, drawn };
    });
    const suggested = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    const rest = scored.filter(s => s.score === 0);
    return { suggested, rest };
  }, [templates, project.concessionaire_id, projectInverters]);

  if (isLoading) {
    return <div style={{ padding: 60, textAlign: 'center' }}><Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} /></div>;
  }

  const banner = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      {/* Sugestões do Motor de Engenharia — arranjos prontos pra escolher em 1 clique */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8, background: '#F3FAF4',
        border: '1px solid #BEE3C8', borderRadius: 10, padding: '10px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={15} style={{ color: '#2D7A3A', flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: '#2D7A3A', margin: 0, flex: 1 }}>
            <strong>Motor de engenharia:</strong> sugestões automáticas de arranjo de strings
            pra este projeto, seguindo as Regras de Engenharia.
          </p>
          <button
            onClick={() => setSuggestOpen(o => !o)}
            style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700,
              border: '1px solid #2D7A3A', cursor: 'pointer',
              background: suggestOpen ? '#2D7A3A' : '#fff', color: suggestOpen ? '#fff' : '#2D7A3A',
            }}
          >
            {suggestOpen ? 'Fechar' : 'Ver sugestões'}
          </button>
        </div>
        {/* Escape manual: modelo de microinversor que o motor não reconheceu
            (marca nova, modelo sem "micro" no nome). Um clique passa o projeto
            pro caminho de microinversores e, se o inversor veio do catálogo,
            deixa a marcação salva pra os próximos projetos. */}
        {suggestOpen && !autoMicro && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            background: '#fff', border: '1px solid #DDEEE2', borderRadius: 8, padding: '8px 12px', marginBottom: 8,
          }}>
            <span style={{ fontSize: 11.5, color: '#666', flex: 1, minWidth: 200 }}>
              {forceMicro
                ? 'Tratando como MICROINVERSORES (regras de entrada CC e ramal CA).'
                : 'Este projeto é com microinversores? O motor não reconheceu o modelo e está calculando como inversor de string.'}
            </span>
            <button
              onClick={async () => {
                setForceMicro(v => !v);
                if (!forceMicro && inverterCatalog) {
                  try {
                    await saveEquipment.mutateAsync({
                      id: inverterCatalog.id, type: 'inverter',
                      brand: inverterCatalog.brand, model: inverterCatalog.model, power: inverterCatalog.power,
                      datasheet_url: inverterCatalog.datasheet_url, inmetro_url: inverterCatalog.inmetro_url,
                      afci_url: inverterCatalog.afci_url,
                      tech_specs: { ...(inverterCatalog.tech_specs ?? {}), is_microinverter: 1 },
                    });
                  } catch (e) { console.error('não deu pra marcar no catálogo', e); }
                }
              }}
              style={{
                padding: '6px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                border: '1px solid #2D7A3A',
                background: forceMicro ? '#2D7A3A' : '#fff', color: forceMicro ? '#fff' : '#2D7A3A',
              }}
            >
              {forceMicro ? 'Voltar para inversor de string' : 'É microinversor'}
            </button>
          </div>
        )}
        {suggestOpen && microPlan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {microPlan.alerts.map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, borderRadius: 8, padding: '7px 10px',
                background: a.severity === 'warning' ? '#FFF7E6' : '#EAF3FF',
                color: a.severity === 'warning' ? '#854F0B' : '#1D4ED8',
                border: `1px solid ${a.severity === 'warning' ? '#FDE4A8' : '#BFDBFE'}`,
              }}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  {a.message}{a.suggestion ? <> <strong>{a.suggestion}</strong></> : null}
                  {a.source ? <span style={{ opacity: 0.7 }}> ({a.source})</span> : null}
                </span>
              </div>
            ))}
            <div style={{ background: '#fff', border: '1px solid #DDEEE2', borderRadius: 8, padding: '9px 12px' }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
                Projeto com microinversores: {microPlan.summary}
              </p>
              <p style={{ fontSize: 11, color: '#666', margin: '3px 0 0' }}>{microPlan.maxPerBranchReason}</p>
              {microPlan.branches.map((b, i) => (
                <p key={i} style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>• {b.explanation}</p>
              ))}
              {microPlan.generalExplanation && (
                <p style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>• {microPlan.generalExplanation}</p>
              )}
              {(() => {
                // a folha acompanha o desenho: tenta A4 e só sobe pra A3 se precisar
                const emA4 = microSchematicFit(microPlan.branches, false, 'A4');
                const fit = emA4.fits ? emA4 : microSchematicFit(microPlan.branches, false, 'A3');
                return (
                  <>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
                      <button
                        onClick={() => applyMicroPlan(microPlan, 'compacto')}
                        style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#2D7A3A', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Gerar compacto (1 linha por ramal)
                      </button>
                      <button
                        onClick={() => applyMicroPlan(microPlan, 'esquematico')}
                        disabled={!fit.possible}
                        title={fit.possible ? 'Cada microinversor com os seus módulos, encadeados no barramento CA' : fit.reason}
                        style={{
                          padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                          border: '1px solid #2D7A3A', background: '#fff',
                          color: fit.possible ? '#2D7A3A' : '#AAB6AC',
                          borderColor: fit.possible ? '#2D7A3A' : '#DDD',
                          cursor: fit.possible ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Gerar esquemático (seguimentação)
                      </button>
                    </div>
                    {!fit.possible && (
                      <p style={{ fontSize: 10.5, color: '#854F0B', margin: '6px 0 0' }}>{fit.reason}</p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
        {suggestOpen && engineResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {engineResult.alerts.map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, borderRadius: 8, padding: '7px 10px',
                background: a.severity === 'warning' ? '#FFF7E6' : '#EAF3FF',
                color: a.severity === 'warning' ? '#854F0B' : '#1D4ED8',
                border: `1px solid ${a.severity === 'warning' ? '#FDE4A8' : '#BFDBFE'}`,
              }}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  {a.message}{a.suggestion ? <> <strong>{a.suggestion}</strong></> : null}
                  {a.source ? <span style={{ opacity: 0.7 }}> ({a.source})</span> : null}
                </span>
              </div>
            ))}
            {engineResult.options.map(opt => (
              <div key={opt.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, background: '#fff',
                border: '1px solid #DDEEE2', borderRadius: 8, padding: '9px 12px', flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{opt.title}: {opt.summary}</p>
                  {opt.perInverter.map((arr, i) => (
                    <p key={i} style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>
                      {opt.perInverter.length > 1 ? `INV ${String(i + 1).padStart(2, '0')} — ` : ''}{arr.explanation}
                    </p>
                  ))}
                </div>
                <button
                  onClick={() => applySuggestion(opt)}
                  style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#2D7A3A', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Usar esta
                </button>
              </div>
            ))}
            {engineResult.options.length === 0 && !engineResult.alerts.some(a => a.code === 'missing_data') && (
              <p style={{ fontSize: 11.5, color: '#854F0B', margin: 0 }}>
                Nenhum arranjo válido — veja os avisos acima e ajuste o projeto ou as Regras de Engenharia.
              </p>
            )}
            {/* Dimensionamento elétrico simplificado (Fase 2) */}
            {sizing && (sizing.dc || sizing.ac || sizing.breakerA || sizing.groundSectionMm2) && (
              <div style={{ background: '#fff', border: '1px solid #DDEEE2', borderRadius: 8, padding: '9px 12px' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', margin: '0 0 4px' }}>Dimensionamento elétrico (simplificado)</p>
                {sizing.dc && <p style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>• {sizing.dc.explanation}</p>}
                {sizing.ac && <p style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>• {sizing.ac.explanation}</p>}
                {sizing.breakerExplanation && <p style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>• {sizing.breakerExplanation}</p>}
                {sizing.groundSectionMm2 && (
                  <p style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>
                    • Aterramento: condutor mínimo {sizing.groundSectionMm2}mm²{sizing.groundNotes ? ` — ${sizing.groundNotes}` : ''}.
                  </p>
                )}
                {sizing.alerts.map((a, i) => (
                  <p key={i} style={{ fontSize: 11, color: a.severity === 'warning' ? '#854F0B' : '#1D4ED8', margin: '3px 0 0' }}>
                    ⚠ {a.message} {a.suggestion ? <strong>{a.suggestion}</strong> : null}
                  </p>
                ))}
                <p style={{ fontSize: 10, color: '#999', margin: '4px 0 0' }}>
                  Estimativas com os comprimentos padrão das Regras (grupos Cabos/Queda de Tensão) — ajuste as regras conforme o padrão da empresa.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Validador elétrico local — checklist do engenheiro em tempo real (nunca bloqueia) */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        background: validation.warningCount > 0 ? '#FFF7E6' : '#F3FAF4',
        border: `1px solid ${validation.warningCount > 0 ? '#FDE4A8' : '#BEE3C8'}`,
        borderRadius: 10, padding: '10px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={15} style={{ color: validation.warningCount > 0 ? '#854F0B' : '#2D7A3A', flexShrink: 0 }} />
          <p style={{ fontSize: 12, margin: 0, flex: 1, color: validation.warningCount > 0 ? '#854F0B' : '#2D7A3A' }}>
            <strong>Validação do diagrama:</strong>{' '}
            {validation.silenced
              ? 'alertas desligados nas Regras de Engenharia (grupo Alertas).'
              : validation.warningCount > 0
                ? `${validation.warningCount} aviso(s)${validation.infoCount > 0 ? ` e ${validation.infoCount} observação(ões)` : ''} — nada bloqueia, mas o analista da concessionária vai olhar.`
                : validation.infoCount > 0
                  ? `sem avisos · ${validation.infoCount} observação(ões) (${validation.okCount} verificações ok).`
                  : `diagrama conforme — ${validation.okCount} verificações ok.`}
          </p>
          {/* Planta de localização: recorte de satélite das coordenadas */}
          <button
            onClick={insertLocationMap}
            disabled={mapLoading}
            title="Insere (ou atualiza) o recorte de satélite do local no canto do desenho"
            style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700,
              border: '1px solid #2D7A3A', background: '#fff', color: '#2D7A3A',
              cursor: mapLoading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: mapLoading ? 0.6 : 1, whiteSpace: 'nowrap',
            }}
          >
            <MapPin size={13} />
            {mapLoading ? 'Buscando…' : 'Planta de localização'}
          </button>
          <button
            onClick={() => setValidationOpen(o => !o)}
            style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${validation.warningCount > 0 ? '#854F0B' : '#2D7A3A'}`,
              background: validationOpen ? (validation.warningCount > 0 ? '#854F0B' : '#2D7A3A') : '#fff',
              color: validationOpen ? '#fff' : (validation.warningCount > 0 ? '#854F0B' : '#2D7A3A'),
            }}
          >
            {validationOpen ? 'Fechar' : 'Ver checklist'}
          </button>
        </div>
        {validationOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {validation.checks.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, borderRadius: 8,
                padding: '6px 10px', background: '#fff',
                border: `1px solid ${c.status === 'warning' ? '#FDE4A8' : c.status === 'info' ? '#BFDBFE' : '#DDEEE2'}`,
              }}>
                <span style={{
                  flexShrink: 0, marginTop: 1, fontWeight: 700,
                  color: c.status === 'ok' ? '#2D7A3A' : c.status === 'warning' ? '#854F0B' : '#1D4ED8',
                }}>
                  {c.status === 'ok' ? '✓' : c.status === 'warning' ? '⚠' : 'ℹ'}
                </span>
                <span style={{ color: '#333' }}>
                  <strong>{c.label}.</strong>{' '}
                  {c.detail ? <span>{c.detail} </span> : null}
                  {c.suggestion ? <span style={{ color: '#666' }}>{c.suggestion}</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, background: '#FFF7E6',
        border: '1px solid #FDE4A8', borderRadius: 10, padding: '10px 14px',
      }}>
        <FlaskConical size={15} style={{ color: '#854F0B', flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: '#854F0B', margin: 0, flex: 1, minWidth: 240 }}>
          <strong>Alpha interno.</strong> O diagrama deste projeto é salvo automaticamente no
          sistema (visível pra equipe toda). Selecione qualquer elemento pra editar no painel ao
          lado; Ctrl+Z desfaz; roda do mouse dá zoom; espaço + arrastar move a vista.
        </p>
        {templates.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <LayoutTemplate size={13} style={{ color: '#854F0B' }} />
            <select
              value={templatePick}
              onChange={e => setTemplatePick(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #E0C88A', fontSize: 12, background: '#fff', maxWidth: 220 }}
            >
              <option value="">Importar modelo…</option>
              {sortedTemplates.suggested.length > 0 && (
                <optgroup label="Sugeridos pra este projeto">
                  {sortedTemplates.suggested.map(({ t, drawn }) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{drawn > 0 ? ` (${drawn} inv.)` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {sortedTemplates.rest.length > 0 && (
                <optgroup label={sortedTemplates.suggested.length > 0 ? 'Outros modelos' : 'Modelos'}>
                  {sortedTemplates.rest.map(({ t }) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              )}
            </select>
            <button
              onClick={applyTemplate}
              disabled={!templatePick}
              style={{
                padding: '5px 10px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700,
                background: templatePick ? '#F5A800' : '#EEE', color: templatePick ? '#1A1A1A' : '#AAA',
                cursor: templatePick ? 'pointer' : 'not-allowed',
              }}
            >
              Aplicar
            </button>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <DiagramEditor
      stateKey={`${project.id}:${applied?.v ?? 0}`}
      json={json}
      initialState={initialState}
      tagValues={values}
      onStateChange={handleStateChange}
      downloadBaseName={project.code}
      banner={banner}
      resetConfirmMessage="Restaurar o layout automático? O diagrama atual deste projeto (incluindo um modelo aplicado) será substituído pela cadeia padrão do cadastro."
    />
  );
}
