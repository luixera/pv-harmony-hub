import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FlaskConical, LayoutTemplate, Lightbulb, Loader2 } from 'lucide-react';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { buildTechnicalJsonFromProject } from '@/utils/cadEngine/buildTechnicalJson';
import {
  ConnectionEndpoint, DiagramSceneState, ManualConnection,
  initialConnections, initialPlacement, inverterCountOf, isConnectionResolvable, multiplyInverterBranches,
} from '@/utils/cadEngine/editableLayout';
import { Point } from '@/utils/cadEngine/types';
import { buildProjectValues } from '@/utils/projectValues';
import { DiagramEditor } from '@/components/diagrams/DiagramEditor';
import { useProjectDiagram, useSaveProjectDiagram } from '@/hooks/useProjectDiagram';
import { useDiagramTemplates } from '@/hooks/useDiagramTemplates';
import { useEngineeringRuleMap } from '@/hooks/useEngineeringRules';
import {
  ProjectArrangementOption, suggestProjectArrangement,
} from '@/utils/engineering/rulesEngine';

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

  const reconciledProject = fresh.map(f => {
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
    groups: saved.groups ?? [], shapes: saved.shapes ?? [], sheet: saved.sheet,
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
  const handleStateChange = (state: DiagramSceneState) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      saveDiagram.mutate({ projectId: project.id, sceneData: state });
    }, 800);
  };

  const projectInverters = Math.max(1, Number(project.equipment?.inverter_quantity ?? 1) || 1);

  // ── Sugestões do Motor de Engenharia (Rules Engine, Fase 1) ──────────────
  const { ruleMap } = useEngineeringRuleMap();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const engineResult = useMemo(() => {
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
  }, [suggestOpen, ruleMap, project.equipment, projectInverters]);

  /** "Usar esta": gera o diagrama automático com o arranjo escolhido nas legendas. */
  const applySuggestion = (opt: ProjectArrangementOption) => {
    if (!confirm(`Usar "${opt.title}" (${opt.summary})? O diagrama atual será substituído pela cadeia automática com este arranjo.`)) return;
    let state: DiagramSceneState = {
      placements: initialPlacement(json),
      connections: initialConnections(json),
      photos: [], texts: [], groups: [],
    };
    if (projectInverters > 1) {
      const multiplied = multiplyInverterBranches(state, projectInverters);
      if (multiplied) state = multiplied;
    }
    // grava o arranjo escolhido nas legendas dos arranjos FV (ramal i → inversor i)
    let pvIdx = 0;
    state = {
      ...state,
      placements: state.placements.map(p => {
        if (p.kind !== 'pv-array') return p;
        const arr = opt.perInverter[Math.min(pvIdx++, opt.perInverter.length - 1)];
        const legend = [arr.label, arr.operatingVoltageV ? `~${arr.operatingVoltageV}V de operação` : ''].filter(Boolean);
        return { ...p, legend };
      }),
    };
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
