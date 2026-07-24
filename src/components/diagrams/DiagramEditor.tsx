import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Download, FileImage, RotateCw, Link2, Trash2, RefreshCw,
  Image as ImageIcon, Plus, Pencil, Type,
} from 'lucide-react';
import {
  ConnectionEndpoint, DiagramSceneState, ManualConnection, PlacedPhoto, PlacedSymbol, PlacedText,
  blockCenter, buildSceneFromPlacement, computeConnectorPoints, findNearestSymbol,
  initialConnections, initialPlacement, isConnectionResolvable, nearestPointOnPolyline,
  SNAP_RADIUS, snapToGrid,
} from '@/utils/cadEngine/editableLayout';
import { ComponentKind, Point, TechnicalJsonMvp } from '@/utils/cadEngine/types';
import { sceneToSvgInner, primitiveToSvg, blockTransform } from '@/utils/cadEngine/exportSvg';
import { sceneToPdfBlob } from '@/utils/cadEngine/exportPdf';
import { KIND_LABEL, SYMBOL_BBOX, SYMBOL_DEFS } from '@/utils/cadEngine/symbols';
import { CENTER_Y, PAPER, PITCH_X, START_X } from '@/utils/cadEngine/paper';
import { resolveProjectTags, TEMPLATE_VARIABLES } from '@/utils/projectValues';
import { sanitizeFileName } from '@/lib/utils';

/**
 * Canvas SVG interativo do CAD Engine — arrastar, girar, redimensionar,
 * ligar (com desenho manual do traço e derivações — uma linha sempre termina
 * num componente ou em cima de outra linha, nunca solta no vazio) e
 * adicionar componentes/fotos/textos avulsos. Extraído de `UnifilarTab.tsx`
 * pra ser reaproveitado tanto por projeto (aba dentro do modal, com os 5
 * componentes do cadastro + persistência em localStorage) quanto pelo motor
 * de templates (aba própria, começa vazio + persistência em
 * `diagram_templates`, sem tag resolvida — mostra `{chave}` cru).
 *
 * Este componente não sabe de onde vêm os dados nem pra onde vão: recebe o
 * estado inicial e devolve cada mudança via `onStateChange` — quem chama
 * decide como/onde persistir.
 */

const ALL_KINDS = Object.keys(KIND_LABEL) as ComponentKind[];
const MIN_SCALE = 0.4, MAX_SCALE = 3;

const TAGS_BY_CATEGORY = (() => {
  const map = new Map<string, typeof TEMPLATE_VARIABLES>();
  for (const v of TEMPLATE_VARIABLES) {
    if (!map.has(v.category)) map.set(v.category, []);
    map.get(v.category)!.push(v);
  }
  return map;
})();

export interface DiagramEditorProps {
  /** Muda quando o "documento" muda (id do projeto ou do template) — reseeda o estado interno. */
  stateKey: string;
  json: TechnicalJsonMvp;
  initialState: DiagramSceneState;
  /** Ausente: mostra as tags `{chave}` cruas (modo template). Presente: resolve contra dados reais (modo projeto). */
  tagValues?: Record<string, string>;
  onStateChange: (state: DiagramSceneState) => void;
  downloadBaseName: string;
  banner: React.ReactNode;
  resetConfirmMessage: string;
}

export function DiagramEditor({
  stateKey, json, initialState, tagValues, onStateChange, downloadBaseName, banner, resetConfirmMessage,
}: DiagramEditorProps) {
  const values = tagValues ?? {};

  const [placements, setPlacements] = useState<PlacedSymbol[]>([]);
  const [connections, setConnections] = useState<ManualConnection[]>([]);
  const [photos, setPhotos] = useState<PlacedPhoto[]>([]);
  const [texts, setTexts] = useState<PlacedText[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<ConnectionEndpoint | null>(null);
  const [drawnWaypoints, setDrawnWaypoints] = useState<Point[]>([]);
  const [snap, setSnap] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const clearSelection = () => {
    setSelectedId(null); setSelectedPhotoId(null); setSelectedTextId(null); setSelectedConnId(null);
  };

  // Reseeda o estado interno sempre que o "documento" (projeto/template) muda.
  useEffect(() => {
    setPlacements(initialState.placements);
    setConnections(initialState.connections);
    setPhotos(initialState.photos);
    setTexts(initialState.texts);
    clearSelection();
    setLinkMode(false);
    setLinkFrom(null);
    setDrawnWaypoints([]);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à troca de documento
  }, [stateKey]);

  // Notifica o dono (localStorage por projeto, ou o motor de templates) a cada mudança.
  useEffect(() => {
    if (!loaded) return;
    onStateChange({ placements, connections, photos, texts });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStateChange não entra: reagimos à mudança de estado, não à identidade da função
  }, [placements, connections, photos, texts, loaded]);

  const byId = useMemo(() => new Map(placements.map(p => [p.id, p])), [placements]);
  // Espelha `placements`/`connections` num ref pra ler a versão mais recente
  // dentro do listener de mouseup persistente (que só resubscreve quando
  // `snap` muda — ler o estado direto ali arriscaria pegar uma versão
  // desatualizada).
  const placementsRef = useRef(placements);
  useEffect(() => { placementsRef.current = placements; }, [placements]);
  const connectionsRef = useRef(connections);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  const scene = useMemo(
    () => buildSceneFromPlacement(json, placements, connections, photos, texts, values),
    [json, placements, connections, photos, texts, values],
  );

  // ── Interação: arrastar símbolos, fotos, textos, linhas inteiras e pontos ─
  const svgRef = useRef<SVGSVGElement>(null);
  type DragState =
    | { type: 'symbol'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'symbol-resize'; id: string; startX: number; startY: number; origScale: number; moved: boolean }
    | { type: 'waypoint'; connId: string; index: number; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'endpoint'; connId: string; which: 'from' | 'to'; startX: number; startY: number; origX: number; origY: number; lastX: number; lastY: number; moved: boolean }
    | { type: 'conn-move'; connId: string; startX: number; startY: number; origWaypoints: Point[]; origFromAt: Point | null; origToAt: Point | null; moved: boolean }
    | { type: 'photo'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'photo-resize'; id: string; startX: number; startY: number; origW: number; origH: number; moved: boolean }
    | { type: 'text'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean };
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const pxToMm = PAPER.widthMm / rect.width;
      const dx = (e.clientX - drag.startX) * pxToMm;
      const dy = (e.clientY - drag.startY) * pxToMm;
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) drag.moved = true;

      if (drag.type === 'symbol') {
        let nx = drag.origX + dx, ny = drag.origY + dy;
        if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
        setPlacements(prev => prev.map(p => (p.id === drag.id ? { ...p, x: nx, y: ny } : p)));
      } else if (drag.type === 'symbol-resize') {
        const deltaScale = dx / SYMBOL_BBOX.w; // cada W mm arrastados = +1x de escala
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, drag.origScale + deltaScale));
        setPlacements(prev => prev.map(p => (p.id === drag.id ? { ...p, scale: newScale } : p)));
      } else if (drag.type === 'waypoint') {
        let nx = drag.origX + dx, ny = drag.origY + dy;
        if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
        setConnections(prev => prev.map(c => {
          if (c.id !== drag.connId) return c;
          const waypoints = [...(c.waypoints ?? [])];
          waypoints[drag.index] = { x: nx, y: ny };
          return { ...c, waypoints };
        }));
      } else if (drag.type === 'endpoint') {
        let nx = drag.origX + dx, ny = drag.origY + dy;
        if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
        drag.lastX = nx; drag.lastY = ny;
        setConnections(prev => prev.map(c => {
          if (c.id !== drag.connId) return c;
          const pt: ConnectionEndpoint = { kind: 'point', at: { x: nx, y: ny } };
          return drag.which === 'from' ? { ...c, from: pt } : { ...c, to: pt };
        }));
      } else if (drag.type === 'conn-move') {
        const nWaypoints = drag.origWaypoints.map(p => ({ x: p.x + dx, y: p.y + dy }));
        setConnections(prev => prev.map(c => {
          if (c.id !== drag.connId) return c;
          const next: ManualConnection = { ...c, waypoints: nWaypoints.length ? nWaypoints : undefined };
          if (drag.origFromAt) next.from = { kind: 'point', at: { x: drag.origFromAt.x + dx, y: drag.origFromAt.y + dy } };
          if (drag.origToAt) next.to = { kind: 'point', at: { x: drag.origToAt.x + dx, y: drag.origToAt.y + dy } };
          return next;
        }));
      } else if (drag.type === 'photo') {
        const nx = drag.origX + dx, ny = drag.origY + dy;
        setPhotos(prev => prev.map(ph => (ph.id === drag.id ? { ...ph, x: nx, y: ny } : ph)));
      } else if (drag.type === 'photo-resize') {
        const newW = Math.max(15, drag.origW + dx);
        const newH = Math.max(10, drag.origH * (newW / drag.origW));
        setPhotos(prev => prev.map(ph => (ph.id === drag.id ? { ...ph, w: newW, h: newH } : ph)));
      } else if (drag.type === 'text') {
        let nx = drag.origX + dx, ny = drag.origY + dy;
        if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
        setTexts(prev => prev.map(t => (t.id === drag.id ? { ...t, x: nx, y: ny } : t)));
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.type === 'symbol' && !drag.moved) handleSymbolClick(drag.id); // arrasto não ocorreu → foi um clique
      if (drag.type === 'endpoint' && drag.moved) {
        // Uma ponta só pode ficar num componente ou em cima de outra linha —
        // nunca solta no vazio. Perto de um componente, gruda nele; senão,
        // perto de outra linha (que não seja ela mesma), gruda no ponto
        // exato sobre ela; se não achar nenhum dos dois, desfaz o arrasto e
        // volta pra posição original (não deixa soltar no vazio).
        const dropPt = { x: drag.lastX, y: drag.lastY };
        const nearSymbol = findNearestSymbol(dropPt, placementsRef.current);
        const idsNow = new Map(placementsRef.current.map(p => [p.id, p]));
        const nearLine = nearSymbol ? null : nearestLinePoint(dropPt, connectionsRef.current, idsNow, drag.connId);
        const resolved: ConnectionEndpoint | null = nearSymbol
          ? { kind: 'symbol', id: nearSymbol.id }
          : nearLine ? { kind: 'point', at: nearLine } : null;
        setConnections(prev => prev.map(c => {
          if (c.id !== drag.connId) return c;
          const pt: ConnectionEndpoint = resolved ?? { kind: 'point', at: { x: drag.origX, y: drag.origY } };
          return drag.which === 'from' ? { ...c, from: pt } : { ...c, to: pt };
        }));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSymbolClick é estável o bastante (fecha sobre state via setState funcional)
  }, [snap]);

  const handleSymbolMouseDown = (e: React.MouseEvent, p: PlacedSymbol) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'symbol', id: p.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y, moved: false };
  };

  const handleSymbolResizeMouseDown = (e: React.MouseEvent, p: PlacedSymbol) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'symbol-resize', id: p.id, startX: e.clientX, startY: e.clientY, origScale: p.scale, moved: false };
  };

  const finishLink = (to: ConnectionEndpoint) => {
    if (!linkFrom) return;
    setConnections(prev => [...prev, {
      id: `manual-${Date.now()}`, from: linkFrom, to,
      waypoints: drawnWaypoints.length ? drawnWaypoints : undefined,
    }]);
    setLinkFrom(null);
    setDrawnWaypoints([]);
  };

  const handleSymbolClick = (id: string) => {
    if (linkMode) {
      if (!linkFrom) { setLinkFrom({ kind: 'symbol', id }); setDrawnWaypoints([]); return; }
      if (linkFrom.kind === 'symbol' && linkFrom.id === id) { setLinkFrom(null); setDrawnWaypoints([]); return; } // clicou no mesmo: cancela
      finishLink({ kind: 'symbol', id });
      return;
    }
    setSelectedId(prev => (prev === id ? null : id));
    setSelectedPhotoId(null); setSelectedTextId(null); setSelectedConnId(null);
  };

  const clientToMm = (clientX: number, clientY: number): Point | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const pxToMm = PAPER.widthMm / rect.width;
    const x = (clientX - rect.left) * pxToMm;
    const y = (clientY - rect.top) * pxToMm;
    return snap ? { x: snapToGrid(x), y: snapToGrid(y) } : { x, y };
  };

  // Ponto mais próximo sobre alguma linha existente, dentro do raio de
  // captura — `excludeConnId` ignora a própria linha (usado ao arrastar a
  // ponta de uma ligação, senão ela sempre "acerta" a si mesma).
  const nearestLinePoint = (
    pt: Point, conns: ManualConnection[], ids: Map<string, PlacedSymbol>, excludeConnId?: string,
  ): Point | null => {
    let best: { point: Point; dist: number } | null = null;
    for (const conn of conns) {
      if (conn.id === excludeConnId) continue;
      if (!isConnectionResolvable(conn, ids)) continue;
      const pts = computeConnectorPoints(conn.from, conn.to, ids, conn.waypoints);
      const found = nearestPointOnPolyline(pt, pts);
      if (found && found.dist <= SNAP_RADIUS && (!best || found.dist < best.dist)) best = found;
    }
    return best ? best.point : null;
  };

  // Resolve um clique cru no canvas pra uma ponta de ligação de verdade:
  // linhas só podem conectar componentes entre si ou a outras linhas — nunca
  // ficam soltas no vazio. Perto de um componente vira aquele componente
  // (pixel-perfeito via edgePoint); perto de uma linha existente vira o ponto
  // exato sobre ela (derivação); longe dos dois, `null` (não é um lugar
  // válido pra iniciar/terminar uma ligação).
  const resolveClickEndpoint = (pt: Point): ConnectionEndpoint | null => {
    const symbol = findNearestSymbol(pt, placements);
    if (symbol) return { kind: 'symbol', id: symbol.id };
    const linePoint = nearestLinePoint(pt, connections, byId);
    return linePoint ? { kind: 'point', at: linePoint } : null;
  };

  // Clique em área vazia do canvas: fora do modo de ligar, desmarca tudo. No
  // modo de ligar: sem origem ainda, só inicia se o clique acertar um
  // componente ou uma linha existente (nunca um ponto solto); com origem já
  // escolhida, um clique perto de um componente/linha FECHA a ligação ali
  // (derivação, se for numa linha); longe dos dois, vira só mais um ponto de
  // dobra do traço (o desenho do meio do caminho continua livre).
  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!linkMode) { clearSelection(); return; }
    const pt = clientToMm(e.clientX, e.clientY);
    if (!pt) return;
    const resolved = resolveClickEndpoint(pt);
    if (!linkFrom) {
      if (resolved) { setLinkFrom(resolved); setDrawnWaypoints([]); }
      return;
    }
    if (resolved) {
      if (resolved.kind === 'symbol' && linkFrom.kind === 'symbol' && linkFrom.id === resolved.id) {
        setLinkFrom(null); setDrawnWaypoints([]); // clicou de novo na própria origem: cancela
        return;
      }
      finishLink(resolved);
      return;
    }
    setDrawnWaypoints(prev => [...prev, pt]);
  };

  const rotateSelected = () => {
    if (!selectedId) return;
    setPlacements(prev => prev.map(p => (p.id === selectedId ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  };

  const handleEditSymbolText = (p: PlacedSymbol) => {
    const newLabel = window.prompt('Nome do componente:', p.label);
    if (newLabel === null) return;
    const legendRaw = window.prompt('Legenda (uma linha por item; pode usar tags do projeto entre chaves, ex.: {potencia_total}):', p.legend.join('\n'));
    const legend = legendRaw === null ? p.legend : legendRaw.split('\n').map(s => s.trim()).filter(Boolean);
    setPlacements(prev => prev.map(x => (x.id === p.id ? { ...x, label: newLabel, legend } : x)));
  };

  const removeConnection = (id: string) => {
    setConnections(prev => prev.filter(c => c.id !== id));
    if (selectedConnId === id) setSelectedConnId(null);
  };

  const handleConnMouseDown = (e: React.MouseEvent, connId: string) => {
    if (linkMode) return; // deixa propagar pro clique de canvas (cria ponto/derivação ali)
    e.preventDefault();
    e.stopPropagation();
    setSelectedConnId(connId);
    setSelectedId(null); setSelectedPhotoId(null); setSelectedTextId(null);
    const conn = connections.find(c => c.id === connId);
    if (!conn) return;
    let seedWaypoints = conn.waypoints ?? [];
    if (seedWaypoints.length === 0) {
      const full = computeConnectorPoints(conn.from, conn.to, byId, undefined);
      seedWaypoints = full.slice(1, -1);
    }
    dragRef.current = {
      type: 'conn-move', connId,
      startX: e.clientX, startY: e.clientY,
      origWaypoints: seedWaypoints,
      origFromAt: conn.from.kind === 'point' ? conn.from.at : null,
      origToAt: conn.to.kind === 'point' ? conn.to.at : null,
      moved: false,
    };
  };

  // Duplo-clique no meio de um trecho cria um novo ponto de dobra ali.
  const handleConnDoubleClick = (connId: string, index: number, at: Point) => {
    if (linkMode) return;
    setConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const waypoints = [...(c.waypoints ?? [])];
      waypoints.splice(index, 0, at);
      return { ...c, waypoints };
    }));
    setSelectedConnId(connId);
  };

  // Arrastar um ponto de dobra já existente.
  const handleWaypointMouseDown = (e: React.MouseEvent, connId: string, index: number, at: Point) => {
    if (linkMode) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedConnId(connId);
    dragRef.current = { type: 'waypoint', connId, index, startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, moved: false };
  };

  const removeWaypoint = (connId: string, index: number) => {
    if (linkMode) return;
    setConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const waypoints = [...(c.waypoints ?? [])];
      waypoints.splice(index, 1);
      return { ...c, waypoints };
    }));
  };

  // Arrastar uma ponta em derivação (ponto sobre outra linha) de uma
  // ligação — solta no fim do arrasto, gruda de novo em componente/linha
  // (ver onUp acima) ou volta pro lugar se não achar nenhum dos dois perto.
  const handleEndpointMouseDown = (e: React.MouseEvent, connId: string, which: 'from' | 'to', at: Point) => {
    if (linkMode) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedConnId(connId);
    dragRef.current = { type: 'endpoint', connId, which, startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, lastX: at.x, lastY: at.y, moved: false };
  };

  // ── Componentes adicionados livremente (não vêm do cadastro do projeto) ──
  // Mesma convenção do reconcile() de quem chama: id prefixado com "manual-"
  // (ver addComponent abaixo). No modo template, TODO componente é manual
  // (o template começa vazio, sem cadeia fixa) — o mesmo prefixo cobre isso.
  const isManualSymbol = (id: string) => id.startsWith('manual-');

  const addComponent = (kind: ComponentKind) => {
    const manualCount = placements.length - json.components.length;
    const sameKindCount = placements.filter(p => p.kind === kind).length;
    const col = manualCount % 5;
    const row = Math.floor(manualCount / 5);
    const id = `manual-${kind}-${Date.now()}`;
    const newSymbol: PlacedSymbol = {
      id, kind, label: `${KIND_LABEL[kind]} ${sameKindCount + 1}`, legend: [],
      x: START_X + col * PITCH_X,
      y: CENTER_Y - SYMBOL_BBOX.h / 2 + 42 + row * 34,
      rotation: 0, scale: 1,
    };
    setPlacements(prev => [...prev, newSymbol]);
    setSelectedId(id);
    setSelectedPhotoId(null); setSelectedTextId(null); setSelectedConnId(null);
  };

  const removeSelected = () => {
    if (selectedConnId) {
      setConnections(prev => prev.filter(c => c.id !== selectedConnId));
      setSelectedConnId(null);
      return;
    }
    if (selectedTextId) {
      setTexts(prev => prev.filter(t => t.id !== selectedTextId));
      setSelectedTextId(null);
      return;
    }
    if (selectedPhotoId) {
      setPhotos(prev => prev.filter(ph => ph.id !== selectedPhotoId));
      setSelectedPhotoId(null);
      return;
    }
    if (selectedId && isManualSymbol(selectedId)) {
      const id = selectedId;
      setPlacements(prev => prev.filter(p => p.id !== id));
      setConnections(prev => prev.filter(c =>
        !(c.from.kind === 'symbol' && c.from.id === id) && !(c.to.kind === 'symbol' && c.to.id === id)
      ));
      setSelectedId(null);
    }
  };

  const canRemoveSelected = !!selectedConnId || !!selectedTextId || !!selectedPhotoId || (!!selectedId && isManualSymbol(selectedId));

  // Esc cancela uma ligação em andamento; Delete/Backspace remove o que estiver selecionado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape' && linkMode && linkFrom) { setLinkFrom(null); setDrawnWaypoints([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkMode, linkFrom, selectedConnId, selectedTextId, selectedPhotoId, selectedId]);

  // ── Tags do projeto (mesmo catálogo dos templates .docx) ─────────────────
  const insertTag = (key: string) => {
    if (!key) return;
    if (selectedTextId) {
      setTexts(prev => prev.map(t => (t.id === selectedTextId ? { ...t, value: `${t.value} {${key}}`.trim() } : t)));
      return;
    }
    if (selectedId) {
      setPlacements(prev => prev.map(p => (p.id === selectedId ? { ...p, legend: [...p.legend, `{${key}}`] } : p)));
    }
  };

  // ── Fotos ─────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Redimensiona/comprime no upload — evita estourar a cota do localStorage.
        const MAX_DIM = 900;
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const cw = Math.max(1, Math.round(img.width * scale));
        const ch = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, cw, ch);
        const href = canvas.toDataURL('image/jpeg', 0.78);
        const wMm = 70;
        const hMm = wMm * (ch / cw);
        const id = `photo-${Date.now()}`;
        setPhotos(prev => [...prev, { id, href, x: START_X, y: CENTER_Y - hMm / 2, w: wMm, h: hMm }]);
        setSelectedPhotoId(id);
        setSelectedId(null); setSelectedTextId(null); setSelectedConnId(null);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoMouseDown = (e: React.MouseEvent, ph: PlacedPhoto) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPhotoId(ph.id);
    setSelectedId(null); setSelectedTextId(null); setSelectedConnId(null);
    dragRef.current = { type: 'photo', id: ph.id, startX: e.clientX, startY: e.clientY, origX: ph.x, origY: ph.y, moved: false };
  };

  const handlePhotoResizeMouseDown = (e: React.MouseEvent, ph: PlacedPhoto) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'photo-resize', id: ph.id, startX: e.clientX, startY: e.clientY, origW: ph.w, origH: ph.h, moved: false };
  };

  const removePhoto = (id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
    if (selectedPhotoId === id) setSelectedPhotoId(null);
  };

  // ── Textos soltos ─────────────────────────────────────────────────────────
  const handleAddText = () => {
    const value = window.prompt('Texto (pode usar tags do projeto entre chaves, ex.: {nome_titular}):', '');
    if (!value) return;
    const id = `manual-text-${Date.now()}`;
    setTexts(prev => [...prev, { id, value, x: START_X, y: CENTER_Y - 30, size: 3.2 }]);
    setSelectedTextId(id);
    setSelectedId(null); setSelectedPhotoId(null); setSelectedConnId(null);
  };

  const handleEditText = (t: PlacedText) => {
    const value = window.prompt('Editar texto:', t.value);
    if (value === null) return;
    setTexts(prev => prev.map(x => (x.id === t.id ? { ...x, value } : x)));
  };

  const handleTextMouseDown = (e: React.MouseEvent, t: PlacedText) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedTextId(t.id);
    setSelectedId(null); setSelectedPhotoId(null); setSelectedConnId(null);
    dragRef.current = { type: 'text', id: t.id, startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y, moved: false };
  };

  const removeText = (id: string) => {
    setTexts(prev => prev.filter(t => t.id !== id));
    if (selectedTextId === id) setSelectedTextId(null);
  };

  const resetLayout = () => {
    if (!confirm(resetConfirmMessage)) return;
    setPlacements(initialPlacement(json));
    setConnections(initialConnections(json));
    setPhotos([]);
    setTexts([]);
    clearSelection();
    setLinkFrom(null);
    setDrawnWaypoints([]);
  };

  // ── Download ──────────────────────────────────────────────────────────────
  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const handleDownloadSvg = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.paper.widthMm} ${scene.paper.heightMm}" width="${scene.paper.widthMm}mm" height="${scene.paper.heightMm}mm" style="background:#fff">${sceneToSvgInner(scene)}</svg>`;
    download(new Blob([svg], { type: 'image/svg+xml' }), `unifilar_${sanitizeFileName(downloadBaseName)}.svg`);
  };
  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try { download(await sceneToPdfBlob(scene), `unifilar_${sanitizeFileName(downloadBaseName)}.pdf`); }
    finally { setGeneratingPdf(false); }
  };

  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const labelOfEndpoint = (e: ConnectionEndpoint) => (e.kind === 'symbol' ? labelOf(e.id) : 'Ponto');

  if (!loaded) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} /></div>;
  }

  const btnStyle = (active = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
    border: active ? 'none' : '1px solid #E0E0E0', background: active ? '#2B8CFF' : '#fff',
    color: active ? '#fff' : '#333', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  });
  const canInsertTag = !!selectedTextId || !!selectedId;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
      {banner}

      {/* Barra de ferramentas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button
          onClick={() => { setLinkMode(m => !m); setLinkFrom(null); setDrawnWaypoints([]); clearSelection(); }}
          style={btnStyle(linkMode)}
        >
          <Link2 size={13} />
          {linkMode
            ? (linkFrom ? `Ligando ${labelOfEndpoint(linkFrom)} a… (${drawnWaypoints.length} pontos, Esc cancela)` : 'Clique num componente ou numa linha existente')
            : 'Ligar / desenhar linha'}
        </button>

        <button onClick={rotateSelected} disabled={!selectedId} style={{ ...btnStyle(), color: selectedId ? '#333' : '#bbb', cursor: selectedId ? 'pointer' : 'not-allowed' }}>
          <RotateCw size={13} /> {selectedId ? `Girar ${labelOf(selectedId)}` : 'Girar (selecione um símbolo)'}
        </button>

        <button
          onClick={() => selectedId && handleEditSymbolText(byId.get(selectedId)!)}
          disabled={!selectedId}
          style={{ ...btnStyle(), color: selectedId ? '#333' : '#bbb', cursor: selectedId ? 'pointer' : 'not-allowed' }}
        >
          <Pencil size={13} /> Editar texto
        </button>

        {canInsertTag && (
          <select
            value=""
            onChange={e => { insertTag(e.target.value); e.target.value = ''; }}
            style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 12, color: '#333', background: '#fff', cursor: 'pointer' }}
          >
            <option value="" disabled>+ tag do projeto…</option>
            {[...TAGS_BY_CATEGORY.entries()].map(([cat, vars]) => (
              <optgroup key={cat} label={cat}>
                {vars.map(v => <option key={v.key} value={v.key}>{v.desc}</option>)}
              </optgroup>
            ))}
          </select>
        )}

        <button onClick={removeSelected} disabled={!canRemoveSelected} style={{ ...btnStyle(), color: canRemoveSelected ? '#A32D2D' : '#ccc', cursor: canRemoveSelected ? 'pointer' : 'not-allowed' }}>
          <Trash2 size={13} /> Remover selecionado
        </button>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555' }}>
          <input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Ajustar à grade
        </label>

        <button onClick={resetLayout} style={{ ...btnStyle(), color: '#A32D2D' }}>
          <RefreshCw size={13} /> {json.components.length > 0 ? 'Restaurar automático' : 'Limpar tudo'}
        </button>

        <div style={{ flex: 1 }} />

        <button onClick={handleDownloadSvg} style={btnStyle()}>
          <FileImage size={13} /> Baixar SVG
        </button>
        <button
          onClick={handleDownloadPdf}
          disabled={generatingPdf}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontSize: 12, fontWeight: 700, cursor: generatingPdf ? 'not-allowed' : 'pointer', opacity: generatingPdf ? 0.7 : 1 }}
        >
          {generatingPdf ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Baixar PDF
        </button>
      </div>

      {/* Adicionar componentes/fotos/textos avulsos */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12, paddingTop: 8, borderTop: '1px dashed #E0E0E0' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>Adicionar</span>
        {ALL_KINDS.map(kind => (
          <button
            key={kind}
            onClick={() => addComponent(kind)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, border: '1px solid #E0E0E0', background: '#fff', color: '#333', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={11} /> {KIND_LABEL[kind]}
          </button>
        ))}
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoFile} />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, border: '1px solid #E0E0E0', background: '#fff', color: '#333', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <ImageIcon size={11} /> Foto
        </button>
        <button
          onClick={handleAddText}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, border: '1px solid #E0E0E0', background: '#fff', color: '#333', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <Type size={11} /> Texto
        </button>
      </div>

      {/* Canvas */}
      <div style={{ background: '#F4F4F4', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${PAPER.widthMm} ${PAPER.heightMm}`}
          style={{ width: 900, maxWidth: '100%', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', flexShrink: 0, cursor: linkMode ? 'crosshair' : 'default' }}
          onClick={handleCanvasClick}
        >
          {/* Moldura, cabeçalho e carimbo — estáticos */}
          <g dangerouslySetInnerHTML={{ __html: sceneToSvgInner(buildSceneFromPlacement(json, [], [])) }} />

          {/* Fotos — atrás dos símbolos/linhas */}
          {photos.map(ph => {
            const isSelected = selectedPhotoId === ph.id;
            return (
              <g key={ph.id}>
                <image
                  href={ph.href} x={ph.x} y={ph.y} width={ph.w} height={ph.h}
                  preserveAspectRatio="none"
                  onMouseDown={e => handlePhotoMouseDown(e, ph)}
                  onClick={e => e.stopPropagation()}
                  style={{ cursor: 'grab' }}
                />
                {isSelected && (
                  <>
                    <rect x={ph.x} y={ph.y} width={ph.w} height={ph.h} fill="none" stroke="#2B8CFF" strokeWidth={0.6} strokeDasharray="2,1.5" />
                    <rect
                      x={ph.x + ph.w - 3} y={ph.y + ph.h - 3} width={4} height={4}
                      fill="#2B8CFF" style={{ cursor: 'nwse-resize' }}
                      onMouseDown={e => handlePhotoResizeMouseDown(e, ph)}
                      onClick={e => e.stopPropagation()}
                    />
                    <g
                      transform={`translate(${ph.x + ph.w + 1.5},${ph.y - 1.5})`}
                      onClick={e => { e.stopPropagation(); removePhoto(ph.id); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle cx={0} cy={0} r={2.6} fill="#A32D2D" />
                      <line x1={-1.2} y1={-1.2} x2={1.2} y2={1.2} stroke="#fff" strokeWidth={0.5} />
                      <line x1={-1.2} y1={1.2} x2={1.2} y2={-1.2} stroke="#fff" strokeWidth={0.5} />
                    </g>
                  </>
                )}
              </g>
            );
          })}

          {/* Textos soltos */}
          {texts.map(t => {
            const isSelected = selectedTextId === t.id;
            return (
              <g key={t.id}>
                <text
                  x={t.x} y={t.y} fontSize={t.size} fill="#333"
                  onMouseDown={e => handleTextMouseDown(e, t)}
                  onClick={e => e.stopPropagation()}
                  onDoubleClick={e => { e.stopPropagation(); handleEditText(t); }}
                  style={{ cursor: 'grab' }}
                >
                  {resolveProjectTags(t.value, values)}
                </text>
                {isSelected && (
                  <g
                    transform={`translate(${t.x - 2},${t.y - t.size - 1})`}
                    onClick={e => { e.stopPropagation(); removeText(t.id); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle cx={0} cy={0} r={2.2} fill="#A32D2D" />
                    <line x1={-1} y1={-1} x2={1} y2={1} stroke="#fff" strokeWidth={0.4} />
                    <line x1={-1} y1={1} x2={1} y2={-1} stroke="#fff" strokeWidth={0.4} />
                  </g>
                )}
              </g>
            );
          })}

          {/* Traço em andamento (modo ligar/desenhar) */}
          {linkMode && linkFrom && (() => {
            const start = linkFrom.kind === 'point' ? linkFrom.at : (byId.get(linkFrom.id) ? blockCenter(byId.get(linkFrom.id)!) : null);
            if (!start) return null;
            const pts = [start, ...drawnWaypoints].map(p => `${p.x},${p.y}`).join(' ');
            return (
              <g>
                <polyline points={pts} fill="none" stroke="#2B8CFF" strokeWidth={0.35} strokeDasharray="1.5,1" />
                {drawnWaypoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1} fill="#2B8CFF" />)}
              </g>
            );
          })()}

          {/* Condutores — recalculados a cada posição atual; clicáveis, arrastáveis como bloco */}
          {connections.map(conn => {
            if (!isConnectionResolvable(conn, byId)) return null;
            const routePoints = computeConnectorPoints(conn.from, conn.to, byId, conn.waypoints);
            const pointsStr = routePoints.map(p => `${p.x},${p.y}`).join(' ');
            const waypoints = conn.waypoints ?? [];
            const isSelected = selectedConnId === conn.id;
            return (
              <g key={conn.id}>
                <polyline points={pointsStr} fill="none" stroke="#B0271A" strokeWidth={isSelected ? 0.7 : 0.4} />
                {isSelected && (
                  <polyline points={pointsStr} fill="none" stroke="#2B8CFF" strokeWidth={1.1} strokeDasharray="2,1.5" opacity={0.5} />
                )}
                {/* trecho invisível mais grosso — alvo de clique maior para selecionar/arrastar/duplo-clique */}
                {routePoints.slice(0, -1).map((p, i) => {
                  const q = routePoints[i + 1];
                  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                  return (
                    <line
                      key={i}
                      x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                      stroke="transparent" strokeWidth={2.5}
                      style={{ cursor: linkMode ? 'crosshair' : 'grab' }}
                      onMouseDown={e => handleConnMouseDown(e, conn.id)}
                      onClick={e => e.stopPropagation()}
                      onDoubleClick={e => { e.stopPropagation(); handleConnDoubleClick(conn.id, i, mid); }}
                    />
                  );
                })}
                {waypoints.map((wp, i) => (
                  <circle
                    key={i}
                    cx={wp.x} cy={wp.y} r={1.3}
                    fill="#fff" stroke="#B0271A" strokeWidth={0.4}
                    style={{ cursor: linkMode ? 'crosshair' : 'move' }}
                    onMouseDown={e => handleWaypointMouseDown(e, conn.id, i, wp)}
                    onClick={e => e.stopPropagation()}
                    onDoubleClick={e => { e.stopPropagation(); removeWaypoint(conn.id, i); }}
                  />
                ))}
                {conn.from.kind === 'point' && (() => {
                  const at = conn.from.at;
                  return (
                    <rect
                      x={at.x - 1} y={at.y - 1} width={2} height={2} fill="#2B8CFF"
                      style={{ cursor: linkMode ? 'crosshair' : 'move' }}
                      onMouseDown={e => handleEndpointMouseDown(e, conn.id, 'from', at)}
                      onClick={e => e.stopPropagation()}
                    />
                  );
                })()}
                {conn.to.kind === 'point' && (() => {
                  const at = conn.to.at;
                  return (
                    <rect
                      x={at.x - 1} y={at.y - 1} width={2} height={2} fill="#2B8CFF"
                      style={{ cursor: linkMode ? 'crosshair' : 'move' }}
                      onMouseDown={e => handleEndpointMouseDown(e, conn.id, 'to', at)}
                      onClick={e => e.stopPropagation()}
                    />
                  );
                })()}
              </g>
            );
          })}

          {/* Símbolos — arrastáveis, giráveis, redimensionáveis, clicáveis */}
          {placements.map(p => {
            const isSelected = selectedId === p.id;
            const isLinkFrom = linkFrom?.kind === 'symbol' && linkFrom.id === p.id;
            const inner = (SYMBOL_DEFS[p.kind] ?? []).map((prim, i) => (
              <g key={i} dangerouslySetInnerHTML={{ __html: primitiveToSvg(prim, '#1A1A1A', 0.35) }} />
            ));
            const scaledW = SYMBOL_BBOX.w * p.scale, scaledH = SYMBOL_BBOX.h * p.scale;
            return (
              <g key={p.id}>
                <g
                  transform={blockTransform({ at: { x: p.x, y: p.y }, rotation: p.rotation, scale: p.scale })}
                  onMouseDown={e => handleSymbolMouseDown(e, p)}
                  onClick={e => e.stopPropagation()}
                  onDoubleClick={e => { e.stopPropagation(); handleEditSymbolText(p); }}
                  style={{ cursor: linkMode ? 'crosshair' : 'grab' }}
                >
                  {/* área de clique invisível: sem isto, símbolos com fill="none" só respondem
                      a clique bem em cima do traço fino — não no meio da figura */}
                  <rect x={0} y={0} width={SYMBOL_BBOX.w} height={SYMBOL_BBOX.h} fill="transparent" />
                  {(isSelected || isLinkFrom) && (
                    <rect
                      x={-2} y={-2} width={SYMBOL_BBOX.w + 4} height={SYMBOL_BBOX.h + 4}
                      fill="none" stroke={isLinkFrom ? '#F5A800' : '#2B8CFF'} strokeWidth={0.6} strokeDasharray="2,1.5"
                    />
                  )}
                  {inner}
                </g>
                {isSelected && (
                  <rect
                    x={p.x + scaledW - 1.2} y={p.y + scaledH - 1.2} width={2.4} height={2.4}
                    fill="#2B8CFF" style={{ cursor: 'nwse-resize' }}
                    onMouseDown={e => handleSymbolResizeMouseDown(e, p)}
                    onClick={e => e.stopPropagation()}
                  />
                )}
                <text x={p.x + scaledW / 2} y={p.y + scaledH + 5} fontSize={2.6} textAnchor="middle" fontWeight="bold" fill="#333">{resolveProjectTags(p.label, values)}</text>
                {p.legend.map((line, i) => (
                  <text key={i} x={p.x + scaledW / 2} y={p.y + scaledH + 5 + (i + 1) * 3.6} fontSize={2.4} textAnchor="middle" fill="#333">{resolveProjectTags(line, values)}</text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Ligações — lista com remoção */}
      {connections.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Ligações</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {connections.map(c => (
              <div
                key={c.id}
                onClick={() => setSelectedConnId(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#555',
                  cursor: 'pointer', borderRadius: 6, padding: '4px 6px',
                  background: selectedConnId === c.id ? '#EAF3FF' : 'transparent',
                }}
              >
                <span>{labelOfEndpoint(c.from)} → {labelOfEndpoint(c.to)}</span>
                <button
                  onClick={e => { e.stopPropagation(); removeConnection(c.id); }}
                  style={{ border: 'none', background: 'none', color: '#A32D2D', cursor: 'pointer', display: 'flex' }}
                  title="Remover ligação"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
