import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { buildTechnicalJsonFromProject } from '@/utils/cadEngine/buildTechnicalJson';
import {
  ConnectionEndpoint, DiagramSceneState, ManualConnection,
  initialConnections, initialPlacement, isConnectionResolvable,
} from '@/utils/cadEngine/editableLayout';
import { Point } from '@/utils/cadEngine/types';
import { buildProjectValues } from '@/utils/projectValues';
import { DiagramEditor } from '@/components/diagrams/DiagramEditor';

/**
 * Diagrama Unifilar do projeto — canvas interativo (arrastar, girar,
 * redimensionar, ligar com derivações/linhas soltas, adicionar componentes,
 * fotos e textos) sobre o `DiagramEditor` compartilhado (ver
 * `src/components/diagrams/DiagramEditor.tsx`). Aqui só entra o que é
 * específico do contexto "dentro do modal de um projeto":
 *
 * - Monta o JSON técnico e os valores de tag a partir do PROJETO real
 *   (`buildTechnicalJsonFromProject`/`buildProjectValues`).
 * - Persiste em `localStorage` por projeto — edição feita aqui é local a
 *   este navegador e NÃO afeta nenhum template salvo no motor de templates
 *   (aba própria, `/admin/diagram-templates`, restrita por enquanto à GD
 *   Manager — ver `useDiagramEngineAccess`).
 * - Reconcilia com os 5 componentes do cadastro do projeto a cada troca de
 *   equipamento (ver `reconcile()` abaixo).
 */

const STORAGE_PREFIX = 'unifilar-layout:';

interface SavedLayout {
  placements: DiagramSceneState['placements'];
  connections: unknown[]; // formato salvo pode ser antigo (string) ou novo (ConnectionEndpoint) — migrado abaixo
  photos?: DiagramSceneState['photos'];
  texts?: DiagramSceneState['texts'];
  groups?: DiagramSceneState['groups'];
  sheet?: DiagramSceneState['sheet'];
}

/** Diagramas salvos antes das ligações virarem `ConnectionEndpoint` gravavam
 *  `from`/`to` como string (id do componente) direto, sem o envelope
 *  `{kind,...}`. Migra na leitura para não quebrar diagramas já salvos no
 *  navegador do usuário. */
function migrateConnection(raw: unknown): ManualConnection {
  const c = raw as { id: string; from: unknown; to: unknown; waypoints?: Point[] };
  const toEndpoint = (e: unknown): ConnectionEndpoint =>
    typeof e === 'string' ? { kind: 'symbol', id: e } : (e as ConnectionEndpoint);
  return { id: c.id, from: toEndpoint(c.from), to: toEndpoint(c.to), waypoints: c.waypoints };
}

/**
 * Funde o estado salvo com os componentes atuais do projeto. Os componentes
 * derivados do projeto (`json.components`, ids fixos tipo `PV-01`) são
 * resincronizados a cada troca de equipamento — só posição/rotação/escala
 * editadas sobrevivem, e um componente removido do cadastro some do layout.
 * Componentes adicionados manualmente pelo usuário (prefixo `manual-`, ex.:
 * um DPS avulso) não têm origem no projeto — não dá para diferenciá-los "pela
 * ausência no cadastro atual" (um componente real removido do cadastro cairia
 * no mesmo caso), por isso o prefixo do id é o que decide, e eles sobrevivem
 * sempre. Fotos e textos são sempre avulsos — passam direto.
 */
function reconcile(json: ReturnType<typeof buildTechnicalJsonFromProject>, saved: SavedLayout | null): DiagramSceneState {
  const fresh = initialPlacement(json);
  if (!saved) return { placements: fresh, connections: initialConnections(json), photos: [], texts: [], groups: [] };

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
    groups: saved.groups ?? [], sheet: saved.sheet,
  };
}

function loadInitialState(project: ProjectWithDetails, json: ReturnType<typeof buildTechnicalJsonFromProject>): DiagramSceneState {
  const storageKey = `${STORAGE_PREFIX}${project.id}`;
  let saved: SavedLayout | null = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) saved = JSON.parse(raw);
  } catch { /* estado salvo corrompido — ignora e recomeça */ }
  return reconcile(json, saved);
}

export function UnifilarTab({ project }: { project: ProjectWithDetails }) {
  const json = useMemo(() => buildTechnicalJsonFromProject(project), [project]);
  const values = useMemo(() => buildProjectValues(project), [project]);
  const initialState = useMemo(() => loadInitialState(project, json), [project, json]);
  const storageKey = `${STORAGE_PREFIX}${project.id}`;

  const handleStateChange = (state: DiagramSceneState) => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage cheio/bloqueado — não é crítico */ }
  };

  const banner = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, background: '#FFF7E6',
      border: '1px solid #FDE4A8', borderRadius: 10, padding: '10px 14px', marginBottom: 16,
    }}>
      <FlaskConical size={15} style={{ color: '#854F0B', flexShrink: 0 }} />
      <p style={{ fontSize: 12, color: '#854F0B', margin: 0 }}>
        <strong>Alpha interno.</strong> Arraste símbolos, fotos e textos; puxe o
        quadrado azul no canto do símbolo selecionado pra redimensionar. Nas linhas: clique
        para selecionar e arraste pra mover o traço inteiro, duplo-clique adiciona um ponto de
        dobra, Delete remove a selecionada. Para ligar: clique na origem (um componente ou uma
        linha existente, pra criar uma derivação) e depois clique no destino (outro componente
        ou outra linha) — uma ligação sempre termina em algo, nunca fica solta no vazio. A
        edição aqui é só deste navegador — não sincroniza entre dispositivos e não altera
        nenhum modelo salvo no motor de templates.
      </p>
    </div>
  );

  return (
    <DiagramEditor
      stateKey={project.id}
      json={json}
      initialState={initialState}
      tagValues={values}
      onStateChange={handleStateChange}
      downloadBaseName={project.code}
      banner={banner}
      resetConfirmMessage="Restaurar o layout automático? Posições, ligações, componentes, fotos e textos adicionados manualmente neste projeto serão perdidos (só neste navegador)."
    />
  );
}
