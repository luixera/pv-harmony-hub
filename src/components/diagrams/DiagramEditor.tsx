import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Download, FileImage, RotateCw, Link2, Trash2, RefreshCw,
  Image as ImageIcon, Plus, Type, BoxSelect, FileText,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Copy,
} from 'lucide-react';
import {
  ConnectionEndpoint, DiagramSceneState, ManualConnection, PlacedGroup, PlacedPhoto, PlacedSymbol, PlacedText,
  SheetOptions, blockCenter, buildSceneFromPlacement, buildSheetFurnitureScene, computeAllConnectionPoints,
  connectionDependsOn, connectionLabelPosition, detachDerivations, findNearestPort, findNearestSymbol,
  initialConnections, initialPlacement, nearestPointOnPolyline, pointAtT, portPagePosition,
  SNAP_RADIUS, snapToGrid, usedKindsOf,
} from '@/utils/cadEngine/editableLayout';
import { ComponentKind, Point, TechnicalJsonMvp } from '@/utils/cadEngine/types';
import { sceneToSvgInner, primitiveToSvg, blockTransform } from '@/utils/cadEngine/exportSvg';
import { sceneToPdfBlob } from '@/utils/cadEngine/exportPdf';
import { KIND_LABEL, SYMBOL_BBOX, SYMBOL_DEFS, SYMBOL_PORTS } from '@/utils/cadEngine/symbols';
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
  const [groups, setGroups] = useState<PlacedGroup[]>([]);
  const [sheet, setSheet] = useState<SheetOptions>({});
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Multi-seleção de símbolos (shift+clique / retângulo de seleção) — sempre contém `selectedId` quando há um. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<ConnectionEndpoint | null>(null);
  const [drawnWaypoints, setDrawnWaypoints] = useState<Point[]>([]);
  const [snap, setSnap] = useState(true);
  const [sheetPanelOpen, setSheetPanelOpen] = useState(false);
  const [showUnderlay, setShowUnderlay] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  /** Janela visível da folha (zoom/pan) — viewBox do SVG em mm. */
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: PAPER.widthMm, h: PAPER.heightMm });
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [historyTick, setHistoryTick] = useState(0); // só pra reabilitar/desabilitar os botões desfazer/refazer

  const clearSelection = () => {
    setSelectedId(null); setSelectedIds(new Set());
    setSelectedPhotoId(null); setSelectedTextId(null); setSelectedConnId(null); setSelectedGroupId(null);
  };

  // ── Desfazer/refazer ──────────────────────────────────────────────────────
  // Snapshots do DiagramSceneState inteiro, tirados no INÍCIO de cada ação
  // que muda o desenho (não a cada mousemove) — o estado é pequeno o
  // suficiente (fotos são a exceção; ainda ok pra ~50 passos).
  const HISTORY_MAX = 50;
  const currentStateRef = useRef<DiagramSceneState>({ placements: [], connections: [], photos: [], texts: [], groups: [], sheet: {} });
  const historyRef = useRef<{ undo: DiagramSceneState[]; redo: DiagramSceneState[] }>({ undo: [], redo: [] });
  const snapshot = () => {
    historyRef.current.undo.push(currentStateRef.current);
    if (historyRef.current.undo.length > HISTORY_MAX) historyRef.current.undo.shift();
    historyRef.current.redo = [];
    setHistoryTick(t => t + 1);
  };
  const applyState = (s: DiagramSceneState) => {
    setPlacements(s.placements);
    setConnections(s.connections);
    setPhotos(s.photos);
    setTexts(s.texts);
    setGroups(s.groups ?? []);
    setSheet(s.sheet ?? {});
    clearSelection();
  };
  const undo = () => {
    const prev = historyRef.current.undo.pop();
    if (!prev) return;
    historyRef.current.redo.push(currentStateRef.current);
    applyState(prev);
    setHistoryTick(t => t + 1);
  };
  const redo = () => {
    const next = historyRef.current.redo.pop();
    if (!next) return;
    historyRef.current.undo.push(currentStateRef.current);
    applyState(next);
    setHistoryTick(t => t + 1);
  };

  // Reseeda o estado interno sempre que o "documento" (projeto/template) muda.
  useEffect(() => {
    setPlacements(initialState.placements);
    setConnections(initialState.connections);
    setPhotos(initialState.photos);
    setTexts(initialState.texts);
    setGroups(initialState.groups ?? []); // diagramas salvos antes dos grupos não têm o campo
    setSheet(initialState.sheet ?? {});
    clearSelection();
    setLinkMode(false);
    setLinkFrom(null);
    setDrawnWaypoints([]);
    setSheetPanelOpen(false);
    setShowUnderlay(true);
    setViewBox({ x: 0, y: 0, w: PAPER.widthMm, h: PAPER.heightMm });
    historyRef.current = { undo: [], redo: [] };
    currentStateRef.current = {
      placements: initialState.placements, connections: initialState.connections,
      photos: initialState.photos, texts: initialState.texts,
      groups: initialState.groups ?? [], sheet: initialState.sheet ?? {},
    };
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à troca de documento
  }, [stateKey]);

  // Notifica o dono (localStorage por projeto, ou o motor de templates) a cada mudança.
  useEffect(() => {
    if (!loaded) return;
    const state: DiagramSceneState = { placements, connections, photos, texts, groups, sheet };
    currentStateRef.current = state; // espelho pro desfazer/refazer (snapshot lê daqui)
    onStateChange(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStateChange não entra: reagimos à mudança de estado, não à identidade da função
  }, [placements, connections, photos, texts, groups, sheet, loaded]);

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
    () => buildSceneFromPlacement(json, { placements, connections, photos, texts, groups, sheet }, values),
    [json, placements, connections, photos, texts, groups, sheet, values],
  );
  // Geometria de TODOS os condutores, resolvida em ordem de dependência
  // (derivações formais depois das linhas-mãe) — a mesma fonte usada pelo
  // export, então o que se vê ao vivo é o que sai no arquivo.
  const allConnPoints = useMemo(() => computeAllConnectionPoints(connections, byId), [connections, byId]);
  // Mobília da folha (moldura, cabeçalho, carimbo, legenda automática) —
  // camada estática atrás do conteúdo interativo; reage a mudanças de
  // símbolos usados (legenda) e dos campos do carimbo.
  const furnitureSvg = useMemo(
    () => sceneToSvgInner(buildSheetFurnitureScene(json, usedKindsOf(placements), sheet, values)),
    [json, placements, sheet, values],
  );

  // ── Interação: arrastar símbolos, fotos, textos, linhas inteiras e pontos ─
  const svgRef = useRef<SVGSVGElement>(null);
  const viewBoxRef = useRef(viewBox);
  useEffect(() => { viewBoxRef.current = viewBox; }, [viewBox]);
  const spaceHeldRef = useRef(false);
  type DragState =
    | { type: 'symbol'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean; origPositions?: Record<string, { x: number; y: number }> }
    | { type: 'symbol-resize'; id: string; startX: number; startY: number; origScale: number; moved: boolean }
    | { type: 'pan'; startX: number; startY: number; origVb: { x: number; y: number; w: number; h: number }; moved: boolean }
    | { type: 'marquee'; startX: number; startY: number; startMm: Point; moved: boolean }
    | { type: 'waypoint'; connId: string; index: number; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'endpoint'; connId: string; which: 'from' | 'to'; startX: number; startY: number; origX: number; origY: number; lastX: number; lastY: number; origEndpoint: ConnectionEndpoint; moved: boolean }
    | { type: 'conn-move'; connId: string; startX: number; startY: number; origWaypoints: Point[]; origFromAt: Point | null; origToAt: Point | null; moved: boolean }
    | { type: 'photo'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'photo-resize'; id: string; startX: number; startY: number; origW: number; origH: number; moved: boolean }
    | { type: 'text'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'group'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'group-resize'; id: string; startX: number; startY: number; origW: number; origH: number; moved: boolean };
  // `preState`: estado capturado no mousedown — só vira passo de desfazer se o
  // arrasto realmente mover (evita poluir o histórico com cliques de seleção).
  const dragRef = useRef<(DragState & { preState?: DiagramSceneState }) | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const pxToMm = viewBoxRef.current.w / rect.width; // considera o zoom atual
      const dx = (e.clientX - drag.startX) * pxToMm;
      const dy = (e.clientY - drag.startY) * pxToMm;
      const wasMoved = drag.moved;
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) drag.moved = true;
      if (!wasMoved && drag.moved && drag.preState) {
        // primeiro movimento real deste arrasto: o estado pré-arrasto vira um passo de desfazer
        historyRef.current.undo.push(drag.preState);
        if (historyRef.current.undo.length > HISTORY_MAX) historyRef.current.undo.shift();
        historyRef.current.redo = [];
        setHistoryTick(t => t + 1);
        drag.preState = undefined;
      }

      if (drag.type === 'pan') {
        const vb = drag.origVb;
        const maxX = PAPER.widthMm - vb.w, maxY = PAPER.heightMm - vb.h;
        setViewBox({
          x: Math.max(0, Math.min(maxX, vb.x - dx)),
          y: Math.max(0, Math.min(maxY, vb.y - dy)),
          w: vb.w, h: vb.h,
        });
      } else if (drag.type === 'marquee') {
        const vb = viewBoxRef.current;
        const mmX = vb.x + (e.clientX - rect.left) * pxToMm;
        const mmY = vb.y + (e.clientY - rect.top) * pxToMm;
        setMarquee({ x1: drag.startMm.x, y1: drag.startMm.y, x2: mmX, y2: mmY });
      } else if (drag.type === 'symbol') {
        if (drag.origPositions) {
          // multi-seleção: move todos os selecionados juntos, mantendo o arranjo
          const sdx = snap ? snapToGrid(dx) : dx, sdy = snap ? snapToGrid(dy) : dy;
          setPlacements(prev => prev.map(p => {
            const orig = drag.origPositions![p.id];
            return orig ? { ...p, x: orig.x + sdx, y: orig.y + sdy } : p;
          }));
        } else {
          let nx = drag.origX + dx, ny = drag.origY + dy;
          if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
          setPlacements(prev => prev.map(p => (p.id === drag.id ? { ...p, x: nx, y: ny } : p)));
        }
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
      } else if (drag.type === 'group') {
        let nx = drag.origX + dx, ny = drag.origY + dy;
        if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
        setGroups(prev => prev.map(g => (g.id === drag.id ? { ...g, x: nx, y: ny } : g)));
      } else if (drag.type === 'group-resize') {
        let nw = Math.max(20, drag.origW + dx), nh = Math.max(15, drag.origH + dy);
        if (snap) { nw = snapToGrid(nw); nh = snapToGrid(nh); }
        setGroups(prev => prev.map(g => (g.id === drag.id ? { ...g, w: nw, h: nh } : g)));
      }
    };
    const onUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.type === 'marquee') {
        setMarquee(null);
        if (drag.moved && svgRef.current) {
          const rect = svgRef.current.getBoundingClientRect();
          const vb = viewBoxRef.current;
          const pxToMm = vb.w / rect.width;
          const endX = vb.x + (e.clientX - rect.left) * pxToMm;
          const endY = vb.y + (e.clientY - rect.top) * pxToMm;
          const x0 = Math.min(drag.startMm.x, endX), x1 = Math.max(drag.startMm.x, endX);
          const y0 = Math.min(drag.startMm.y, endY), y1 = Math.max(drag.startMm.y, endY);
          const inside = placementsRef.current.filter(p => {
            const cx = p.x + (SYMBOL_BBOX.w * p.scale) / 2, cy = p.y + (SYMBOL_BBOX.h * p.scale) / 2;
            return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
          });
          setSelectedIds(new Set(inside.map(p => p.id)));
          setSelectedId(inside.length > 0 ? inside[inside.length - 1].id : null);
          setSelectedPhotoId(null); setSelectedTextId(null); setSelectedConnId(null); setSelectedGroupId(null);
          marqueeJustFinishedRef.current = true; // o click que vem em seguida não deve limpar a seleção recém-feita
        }
        return;
      }
      if (drag.type === 'symbol' && !drag.moved) handleSymbolClick(drag.id, e.shiftKey); // arrasto não ocorreu → foi um clique
      if (drag.type === 'endpoint' && drag.moved) {
        // Uma ponta só pode ficar numa porta, num componente ou em cima de
        // outra linha — nunca solta no vazio. Do alvo mais específico pro
        // mais genérico: porta nomeada → componente (lado automático) →
        // derivação FORMAL sobre outra linha (com vínculo vivo). Se não
        // achar nenhum dos três, desfaz o arrasto e volta pra posição/âncora
        // original.
        const dropPt = { x: drag.lastX, y: drag.lastY };
        const idsNow = new Map(placementsRef.current.map(p => [p.id, p]));
        const nearPort = findNearestPort(dropPt, placementsRef.current);
        const nearSymbol = nearPort ? null : findNearestSymbol(dropPt, placementsRef.current);
        const nearLine = (nearPort || nearSymbol) ? null : nearestLineHit(dropPt, connectionsRef.current, idsNow, drag.connId);
        const resolved: ConnectionEndpoint | null = nearPort
          ? { kind: 'port', id: nearPort.symbolId, port: nearPort.portId }
          : nearSymbol
            ? { kind: 'symbol', id: nearSymbol.id }
            : nearLine ? { kind: 'line', connId: nearLine.connId, t: nearLine.t } : null;
        setConnections(prev => prev.map(c => {
          if (c.id !== drag.connId) return c;
          const pt: ConnectionEndpoint = resolved ?? drag.origEndpoint;
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
    // arrastar um símbolo que faz parte da multi-seleção move o conjunto inteiro
    const origPositions = selectedIds.size > 1 && selectedIds.has(p.id)
      ? Object.fromEntries(placements.filter(x => selectedIds.has(x.id)).map(x => [x.id, { x: x.x, y: x.y }]))
      : undefined;
    dragRef.current = { type: 'symbol', id: p.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y, moved: false, origPositions, preState: currentStateRef.current };
  };

  const handleSymbolResizeMouseDown = (e: React.MouseEvent, p: PlacedSymbol) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'symbol-resize', id: p.id, startX: e.clientX, startY: e.clientY, origScale: p.scale, moved: false, preState: currentStateRef.current };
  };

  const finishLink = (to: ConnectionEndpoint) => {
    if (!linkFrom) return;
    snapshot();
    setConnections(prev => [...prev, {
      id: `manual-${Date.now()}`, from: linkFrom, to,
      waypoints: drawnWaypoints.length ? drawnWaypoints : undefined,
    }]);
    setLinkFrom(null);
    setDrawnWaypoints([]);
  };

  const handleSymbolClick = (id: string, shiftKey = false) => {
    if (linkMode) {
      if (!linkFrom) { setLinkFrom({ kind: 'symbol', id }); setDrawnWaypoints([]); return; }
      if (linkFrom.kind === 'symbol' && linkFrom.id === id) { setLinkFrom(null); setDrawnWaypoints([]); return; } // clicou no mesmo: cancela
      finishLink({ kind: 'symbol', id });
      return;
    }
    if (shiftKey) {
      // shift+clique: entra/sai da multi-seleção sem desmarcar os demais
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (selectedId && !next.has(selectedId)) next.add(selectedId);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedId(next.has(id) ? id : (next.values().next().value ?? null));
        return next;
      });
      setSelectedPhotoId(null); setSelectedTextId(null); setSelectedConnId(null); setSelectedGroupId(null);
      return;
    }
    const wasSelected = selectedId === id && selectedIds.size <= 1;
    setSelectedId(wasSelected ? null : id);
    setSelectedIds(wasSelected ? new Set() : new Set([id]));
    setSelectedPhotoId(null); setSelectedTextId(null); setSelectedConnId(null); setSelectedGroupId(null);
  };

  // Clique direto numa bolinha de porta (visíveis no modo ligar): a ponta
  // vira a PORTA específica, não o componente com lado automático.
  const handlePortClick = (symbolId: string, portId: string) => {
    if (!linkMode) return;
    const ep: ConnectionEndpoint = { kind: 'port', id: symbolId, port: portId };
    if (!linkFrom) { setLinkFrom(ep); setDrawnWaypoints([]); return; }
    if (linkFrom.kind === 'port' && linkFrom.id === symbolId && linkFrom.port === portId) {
      setLinkFrom(null); setDrawnWaypoints([]); // clicou de novo na própria origem: cancela
      return;
    }
    finishLink(ep);
  };

  const clientToMm = (clientX: number, clientY: number, applySnap = true): Point | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const vb = viewBoxRef.current;
    const pxToMm = vb.w / rect.width;
    const x = vb.x + (clientX - rect.left) * pxToMm;
    const y = vb.y + (clientY - rect.top) * pxToMm;
    return applySnap && snap ? { x: snapToGrid(x), y: snapToGrid(y) } : { x, y };
  };

  // Derivação candidata: o ponto mais próximo sobre alguma linha, dentro do
  // raio de captura, com o `t` (fração do traçado) que a derivação FORMAL
  // grava — mover a linha-mãe depois arrasta a derivação junto.
  // `excludeConnId` ignora a própria linha E qualquer linha que dependa dela
  // (grudar a ponta de A numa linha que deriva de A criaria um ciclo — as
  // duas sumiriam da tela).
  const nearestLineHit = (
    pt: Point, conns: ManualConnection[], ids: Map<string, PlacedSymbol>, excludeConnId?: string,
  ): { connId: string; t: number; point: Point } | null => {
    const allPts = computeAllConnectionPoints(conns, ids);
    const byConnId = new Map(conns.map(c => [c.id, c]));
    let best: { connId: string; t: number; point: Point; dist: number } | null = null;
    for (const conn of conns) {
      if (excludeConnId && connectionDependsOn(conn, excludeConnId, byConnId)) continue;
      const pts = allPts.get(conn.id);
      if (!pts) continue;
      const found = nearestPointOnPolyline(pt, pts);
      if (found && found.dist <= SNAP_RADIUS && (!best || found.dist < best.dist)) {
        best = { connId: conn.id, t: found.t, point: found.point, dist: found.dist };
      }
    }
    return best ? { connId: best.connId, t: best.t, point: best.point } : null;
  };

  // Resolve um clique cru no canvas pra uma ponta de ligação de verdade —
  // do alvo mais específico pro mais genérico: uma PORTA nomeada (raio
  // apertado, pixel-perfeita), o componente (lado automático), ou um ponto
  // sobre outra linha (derivação FORMAL, com vínculo vivo). Longe dos três,
  // `null` — linhas nunca começam/terminam soltas no vazio.
  const resolveClickEndpoint = (pt: Point): ConnectionEndpoint | null => {
    const port = findNearestPort(pt, placements);
    if (port) return { kind: 'port', id: port.symbolId, port: port.portId };
    const symbol = findNearestSymbol(pt, placements);
    if (symbol) return { kind: 'symbol', id: symbol.id };
    const lineHit = nearestLineHit(pt, connections, byId);
    return lineHit ? { kind: 'line', connId: lineHit.connId, t: lineHit.t } : null;
  };

  // Mousedown em área vazia: espaço (ou botão do meio) segurado = pan;
  // senão, fora do modo de ligar, inicia o retângulo de multi-seleção.
  const marqueeJustFinishedRef = useRef(false);
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || spaceHeldRef.current) {
      e.preventDefault();
      dragRef.current = { type: 'pan', startX: e.clientX, startY: e.clientY, origVb: viewBoxRef.current, moved: false };
      return;
    }
    if (e.button !== 0 || linkMode) return;
    const pt = clientToMm(e.clientX, e.clientY, false);
    if (!pt) return;
    dragRef.current = { type: 'marquee', startX: e.clientX, startY: e.clientY, startMm: pt, moved: false };
  };

  // Clique em área vazia do canvas: fora do modo de ligar, desmarca tudo. No
  // modo de ligar: sem origem ainda, só inicia se o clique acertar um
  // componente ou uma linha existente (nunca um ponto solto); com origem já
  // escolhida, um clique perto de um componente/linha FECHA a ligação ali
  // (derivação, se for numa linha); longe dos dois, vira só mais um ponto de
  // dobra do traço (o desenho do meio do caminho continua livre).
  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (marqueeJustFinishedRef.current) { marqueeJustFinishedRef.current = false; return; }
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
    snapshot();
    setPlacements(prev => prev.map(p => (p.id === selectedId ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  };

  const removeConnection = (id: string) => {
    snapshot();
    // derivações que nasciam desta linha não somem junto: viram ponto fixo na posição atual
    setConnections(prev => detachDerivations(prev, new Set([id]), allConnPoints));
    if (selectedConnId === id) setSelectedConnId(null);
  };

  const handleConnMouseDown = (e: React.MouseEvent, connId: string) => {
    if (linkMode) return; // deixa propagar pro clique de canvas (cria ponto/derivação ali)
    e.preventDefault();
    e.stopPropagation();
    clearSelection();
    setSelectedConnId(connId);
    const conn = connections.find(c => c.id === connId);
    if (!conn) return;
    let seedWaypoints = conn.waypoints ?? [];
    if (seedWaypoints.length === 0) {
      const full = allConnPoints.get(conn.id) ?? [];
      seedWaypoints = full.slice(1, -1);
    }
    dragRef.current = {
      type: 'conn-move', connId,
      startX: e.clientX, startY: e.clientY,
      origWaypoints: seedWaypoints,
      origFromAt: conn.from.kind === 'point' ? conn.from.at : null,
      origToAt: conn.to.kind === 'point' ? conn.to.at : null,
      moved: false,
      preState: currentStateRef.current,
    };
  };

  // Duplo-clique no meio de um trecho cria um novo ponto de dobra ali.
  const handleConnDoubleClick = (connId: string, index: number, at: Point) => {
    if (linkMode) return;
    snapshot();
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
    dragRef.current = { type: 'waypoint', connId, index, startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, moved: false, preState: currentStateRef.current };
  };

  const removeWaypoint = (connId: string, index: number) => {
    if (linkMode) return;
    snapshot();
    setConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const waypoints = [...(c.waypoints ?? [])];
      waypoints.splice(index, 1);
      return { ...c, waypoints };
    }));
  };

  // Arrastar uma ponta em derivação (formal ou ponto fixo legado) de uma
  // ligação — vira ponto livre durante o arrasto e, ao soltar, gruda de novo
  // em porta/componente/linha (ver onUp acima) ou volta pra âncora original
  // se não achar nenhum dos três perto (inclusive o vínculo formal, que não
  // se perde num arrasto cancelado).
  const handleEndpointMouseDown = (e: React.MouseEvent, connId: string, which: 'from' | 'to', at: Point, origEndpoint: ConnectionEndpoint) => {
    if (linkMode) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedConnId(connId);
    dragRef.current = { type: 'endpoint', connId, which, startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, lastX: at.x, lastY: at.y, origEndpoint, moved: false, preState: currentStateRef.current };
  };

  // ── Componentes adicionados livremente (não vêm do cadastro do projeto) ──
  // Mesma convenção do reconcile() de quem chama: id prefixado com "manual-"
  // (ver addComponent abaixo). No modo template, TODO componente é manual
  // (o template começa vazio, sem cadeia fixa) — o mesmo prefixo cobre isso.
  const isManualSymbol = (id: string) => id.startsWith('manual-');

  const addComponent = (kind: ComponentKind) => {
    snapshot();
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
    clearSelection();
    setSelectedId(id);
    setSelectedIds(new Set([id]));
  };

  const removeSelected = () => {
    if (selectedGroupId) {
      snapshot();
      setGroups(prev => prev.filter(g => g.id !== selectedGroupId));
      setSelectedGroupId(null);
      return;
    }
    if (selectedConnId) {
      snapshot();
      setConnections(prev => prev.filter(c => c.id !== selectedConnId));
      setSelectedConnId(null);
      return;
    }
    if (selectedTextId) {
      snapshot();
      setTexts(prev => prev.filter(t => t.id !== selectedTextId));
      setSelectedTextId(null);
      return;
    }
    if (selectedPhotoId) {
      snapshot();
      setPhotos(prev => prev.filter(ph => ph.id !== selectedPhotoId));
      setSelectedPhotoId(null);
      return;
    }
    // símbolos: remove todos os MANUAIS da multi-seleção (os do cadastro do projeto ficam)
    const ids = selectedIds.size > 0 ? selectedIds : (selectedId ? new Set([selectedId]) : new Set<string>());
    const removable = [...ids].filter(isManualSymbol);
    if (removable.length > 0) {
      snapshot();
      const removeSet = new Set(removable);
      const refsRemoved = (e: ConnectionEndpoint) => (e.kind === 'symbol' || e.kind === 'port') && removeSet.has(e.id);
      // ligações que encostavam nos símbolos removidos caem; derivações que
      // nasciam DELAS não caem em cascata — viram ponto fixo na posição atual
      const droppedIds = new Set(connections.filter(c => refsRemoved(c.from) || refsRemoved(c.to)).map(c => c.id));
      setPlacements(prev => prev.filter(p => !removeSet.has(p.id)));
      setConnections(prev => detachDerivations(prev, droppedIds, allConnPoints));
      setSelectedId(null);
      setSelectedIds(new Set());
    }
  };

  const canRemoveSelected = !!selectedGroupId || !!selectedConnId || !!selectedTextId || !!selectedPhotoId
    || [...(selectedIds.size > 0 ? selectedIds : (selectedId ? [selectedId] : []))].some(isManualSymbol);

  // Duplicar os símbolos selecionados (Ctrl+D / botão) — só os manuais podem
  // ser removidos depois, mas duplicar qualquer um vira sempre um "manual-".
  const duplicateSelected = () => {
    const ids = selectedIds.size > 0 ? selectedIds : (selectedId ? new Set([selectedId]) : new Set<string>());
    const originals = placements.filter(p => ids.has(p.id));
    if (originals.length === 0) return;
    snapshot();
    const copies: PlacedSymbol[] = originals.map((p, i) => ({
      ...p,
      id: `manual-${p.kind}-${Date.now()}-${i}`,
      x: p.x + 8, y: p.y + 8,
    }));
    setPlacements(prev => [...prev, ...copies]);
    setSelectedIds(new Set(copies.map(c => c.id)));
    setSelectedId(copies[copies.length - 1].id);
  };

  // Teclado: Esc cancela ligação; Delete remove; Ctrl+Z/Ctrl+Shift+Z (ou
  // Ctrl+Y) desfaz/refaz; Ctrl+D duplica; espaço segurado = pan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') { spaceHeldRef.current = true; return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === 'Escape' && linkMode && linkFrom) { setLinkFrom(null); setDrawnWaypoints([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeldRef.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  });

  // Zoom com a roda do mouse, centrado no cursor. Listener nativo com
  // passive:false — o onWheel do React não deixa dar preventDefault confiável.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const vb = viewBoxRef.current;
      const pxToMm = vb.w / rect.width;
      const mmX = vb.x + (e.clientX - rect.left) * pxToMm;
      const mmY = vb.y + (e.clientY - rect.top) * pxToMm;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const newW = Math.max(30, Math.min(PAPER.widthMm, vb.w * factor));
      const newH = newW * (PAPER.heightMm / PAPER.widthMm);
      // mantém o ponto sob o cursor parado durante o zoom
      const fx = (mmX - vb.x) / vb.w, fy = (mmY - vb.y) / vb.h;
      const nx = Math.max(0, Math.min(PAPER.widthMm - newW, mmX - fx * newW));
      const ny = Math.max(0, Math.min(PAPER.heightMm - newH, mmY - fy * newH));
      setViewBox({ x: nx, y: ny, w: newW, h: newH });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [loaded]);

  const zoomFit = () => setViewBox({ x: 0, y: 0, w: PAPER.widthMm, h: PAPER.heightMm });
  const zoomStep = (dir: 1 | -1) => {
    const vb = viewBoxRef.current;
    const factor = dir > 0 ? 1 / 1.3 : 1.3;
    const newW = Math.max(30, Math.min(PAPER.widthMm, vb.w * factor));
    const newH = newW * (PAPER.heightMm / PAPER.widthMm);
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    setViewBox({
      x: Math.max(0, Math.min(PAPER.widthMm - newW, cx - newW / 2)),
      y: Math.max(0, Math.min(PAPER.heightMm - newH, cy - newH / 2)),
      w: newW, h: newH,
    });
  };

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
        snapshot();
        setPhotos(prev => [...prev, { id, href, x: START_X, y: CENTER_Y - hMm / 2, w: wMm, h: hMm }]);
        clearSelection();
        setSelectedPhotoId(id);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoMouseDown = (e: React.MouseEvent, ph: PlacedPhoto) => {
    e.preventDefault();
    e.stopPropagation();
    clearSelection();
    setSelectedPhotoId(ph.id);
    dragRef.current = { type: 'photo', id: ph.id, startX: e.clientX, startY: e.clientY, origX: ph.x, origY: ph.y, moved: false, preState: currentStateRef.current };
  };

  const handlePhotoResizeMouseDown = (e: React.MouseEvent, ph: PlacedPhoto) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'photo-resize', id: ph.id, startX: e.clientX, startY: e.clientY, origW: ph.w, origH: ph.h, moved: false, preState: currentStateRef.current };
  };

  const removePhoto = (id: string) => {
    snapshot();
    setPhotos(prev => prev.filter(p => p.id !== id));
    if (selectedPhotoId === id) setSelectedPhotoId(null);
  };

  // ── Textos soltos ─────────────────────────────────────────────────────────
  const handleAddText = () => {
    snapshot();
    const id = `manual-text-${Date.now()}`;
    setTexts(prev => [...prev, { id, value: 'Texto', x: START_X, y: CENTER_Y - 30, size: 3.2 }]);
    clearSelection();
    setSelectedTextId(id); // o painel de propriedades abre já com o campo pra digitar
  };

  const handleTextMouseDown = (e: React.MouseEvent, t: PlacedText) => {
    e.preventDefault();
    e.stopPropagation();
    clearSelection();
    setSelectedTextId(t.id);
    dragRef.current = { type: 'text', id: t.id, startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y, moved: false, preState: currentStateRef.current };
  };

  const removeText = (id: string) => {
    snapshot();
    setTexts(prev => prev.filter(t => t.id !== id));
    if (selectedTextId === id) setSelectedTextId(null);
  };

  // ── Caixas de agrupamento ─────────────────────────────────────────────────
  const handleAddGroup = () => {
    snapshot();
    const id = `group-${Date.now()}`;
    setGroups(prev => [...prev, { id, title: 'Grupo', x: START_X, y: CENTER_Y - 25, w: 80, h: 50 }]);
    clearSelection();
    setSelectedGroupId(id); // título edita no painel de propriedades
  };

  const handleGroupMouseDown = (e: React.MouseEvent, g: PlacedGroup) => {
    if (linkMode) return; // no modo ligar, o clique é do canvas
    e.preventDefault();
    e.stopPropagation();
    clearSelection();
    setSelectedGroupId(g.id);
    dragRef.current = { type: 'group', id: g.id, startX: e.clientX, startY: e.clientY, origX: g.x, origY: g.y, moved: false, preState: currentStateRef.current };
  };

  const handleGroupResizeMouseDown = (e: React.MouseEvent, g: PlacedGroup) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'group-resize', id: g.id, startX: e.clientX, startY: e.clientY, origW: g.w, origH: g.h, moved: false, preState: currentStateRef.current };
  };

  const resetLayout = () => {
    if (!confirm(resetConfirmMessage)) return;
    snapshot();
    setPlacements(initialPlacement(json));
    setConnections(initialConnections(json));
    setPhotos([]);
    setTexts([]);
    setGroups([]);
    // `sheet` (resp. técnico/ART/revisão) sobrevive ao reset — é metadado da
    // folha digitado pelo usuário, não parte do layout.
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
  const portNameOf = (symbolId: string, portId: string) => {
    const sym = byId.get(symbolId);
    return (sym ? SYMBOL_PORTS[sym.kind] : []).find(p => p.id === portId)?.name ?? portId;
  };
  const labelOfEndpoint = (e: ConnectionEndpoint): string => {
    if (e.kind === 'symbol') return labelOf(e.id);
    if (e.kind === 'port') return `${labelOf(e.id)} · ${portNameOf(e.id, e.port)}`;
    if (e.kind === 'line') return 'Derivação';
    return 'Ponto';
  };

  // Fundo de referência (PDF original importado) vs. fotos comuns do diagrama.
  const underlays = photos.filter(p => p.underlay);
  const regularPhotos = photos.filter(p => !p.underlay);
  const removeUnderlay = () => {
    if (!confirm('Remover o PDF original do fundo? Ele não sai no PDF/SVG exportado, é só referência do editor.')) return;
    snapshot();
    setPhotos(prev => prev.filter(p => !p.underlay));
  };

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
          onClick={undo}
          disabled={historyRef.current.undo.length === 0}
          title="Desfazer (Ctrl+Z)"
          style={{ ...btnStyle(), color: historyRef.current.undo.length ? '#333' : '#bbb', cursor: historyRef.current.undo.length ? 'pointer' : 'not-allowed' }}
        >
          <Undo2 size={13} /> Desfazer
        </button>
        <button
          onClick={redo}
          disabled={historyRef.current.redo.length === 0}
          title="Refazer (Ctrl+Shift+Z ou Ctrl+Y)"
          style={{ ...btnStyle(), color: historyRef.current.redo.length ? '#333' : '#bbb', cursor: historyRef.current.redo.length ? 'pointer' : 'not-allowed' }}
        >
          <Redo2 size={13} /> Refazer
        </button>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: '1px solid #E0E0E0', borderRadius: 8, padding: 2 }} title="Zoom: roda do mouse (no cursor); segure espaço e arraste pra mover a vista">
          <button onClick={() => zoomStep(1)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 7px', display: 'flex' }} title="Aproximar"><ZoomIn size={13} /></button>
          <button onClick={() => zoomStep(-1)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 7px', display: 'flex' }} title="Afastar"><ZoomOut size={13} /></button>
          <button onClick={zoomFit} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 7px', display: 'flex' }} title="Ver a folha inteira"><Maximize size={13} /></button>
          <span style={{ fontSize: 10.5, color: '#888', padding: '0 5px', minWidth: 34, textAlign: 'center' }}>{Math.round((PAPER.widthMm / viewBox.w) * 100)}%</span>
        </div>

        <button onClick={() => setSheetPanelOpen(o => !o)} style={btnStyle(sheetPanelOpen)}>
          <FileText size={13} /> Dados da folha
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

        {underlays.length > 0 && (
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555' }} title="O PDF original importado, esmaecido no fundo — só referência, não sai no arquivo exportado">
              <input type="checkbox" checked={showUnderlay} onChange={e => setShowUnderlay(e.target.checked)} /> Ver original no fundo
            </label>
            <button onClick={removeUnderlay} style={{ ...btnStyle(), color: '#A32D2D', padding: '5px 9px', fontSize: 11 }}>
              Remover fundo
            </button>
          </>
        )}

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

      {/* Dados da folha: carimbo (resp. técnico/ART/revisão) + legenda automática */}
      {sheetPanelOpen && (
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 12,
          background: '#FAFAFA', border: '1px solid #E8E8E8', borderRadius: 10, padding: '10px 14px',
        }}>
          {([
            ['respTecnico', 'Resp. técnico (nome + CREA)', 'Ex.: FULANO DE TAL — CREA 0000000000-SP', 240],
            ['art', 'ART', 'Nº da ART', 150],
            ['revisao', 'Revisão', '00', 70],
          ] as const).map(([field, label, placeholder, width]) => (
            <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600 }}>
              {label}
              <input
                value={sheet[field] ?? ''}
                onChange={e => setSheet(prev => ({ ...prev, [field]: e.target.value }))}
                placeholder={placeholder}
                style={{ width, padding: '6px 8px', borderRadius: 7, border: '1px solid #DDD', fontSize: 12, fontWeight: 400 }}
              />
            </label>
          ))}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555', paddingBottom: 7 }}>
            <input
              type="checkbox"
              checked={sheet.showLegend !== false}
              onChange={e => setSheet(prev => ({ ...prev, showLegend: e.target.checked }))}
            />
            Tabela de legenda automática
          </label>
          <p style={{ fontSize: 10.5, color: '#999', margin: 0, paddingBottom: 8, flexBasis: '100%' }}>
            Os campos aceitam tags do projeto (ex.: <code>{'{concessionaria}'}</code>) e saem no carimbo do PDF/SVG.
            A legenda lista automaticamente os símbolos usados no diagrama.
          </p>
        </div>
      )}

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
        <button
          onClick={handleAddGroup}
          title="Caixa tracejada de agrupamento com título (ex.: QG – Sistema Fotovoltaico)"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, border: '1px solid #E0E0E0', background: '#fff', color: '#333', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <BoxSelect size={11} /> Grupo
        </button>
      </div>

      {/* Canvas + painel de propriedades */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ background: '#F4F4F4', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'center', overflowX: 'auto', flex: 1, minWidth: 0 }}>
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          style={{ width: 900, maxWidth: '100%', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', flexShrink: 0, cursor: linkMode ? 'crosshair' : 'default' }}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
        >
          {/* Moldura, cabeçalho, carimbo e legenda automática — camada estática */}
          <g dangerouslySetInnerHTML={{ __html: furnitureSvg }} />

          {/* Fundo de referência (PDF original importado) — esmaecido, travado, nunca exportado */}
          {showUnderlay && underlays.map(u => (
            <image
              key={u.id}
              href={u.href} x={u.x} y={u.y} width={u.w} height={u.h}
              preserveAspectRatio="none" opacity={0.35}
              pointerEvents="none"
            />
          ))}

          {/* Fotos — atrás dos símbolos/linhas */}
          {regularPhotos.map(ph => {
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

          {/* Caixas de agrupamento — atrás de linhas/símbolos, arrastáveis/redimensionáveis */}
          {groups.map(g => {
            const isSelected = selectedGroupId === g.id;
            return (
              <g key={g.id}>
                <rect
                  x={g.x} y={g.y} width={g.w} height={g.h}
                  fill="none" stroke={isSelected ? '#2B8CFF' : '#7A7A7A'}
                  strokeWidth={isSelected ? 0.5 : 0.3} strokeDasharray="2,1.4"
                  pointerEvents="none"
                />
                {/* borda invisível mais grossa: área de clique da caixa (o miolo fica livre pros símbolos dentro dela) */}
                <rect
                  x={g.x} y={g.y} width={g.w} height={g.h}
                  fill="none" stroke="transparent" strokeWidth={2.5}
                  pointerEvents={linkMode ? 'none' : 'stroke'}
                  onMouseDown={e => handleGroupMouseDown(e, g)}
                  onClick={e => e.stopPropagation()}
                  style={{ cursor: linkMode ? 'crosshair' : 'grab' }}
                />
                <text
                  x={g.x + 2} y={g.y - 1.4} fontSize={2.6} fontWeight="bold" fill={isSelected ? '#2B8CFF' : '#555'}
                  onMouseDown={e => handleGroupMouseDown(e, g)}
                  onClick={e => e.stopPropagation()}
                  style={{ cursor: linkMode ? 'crosshair' : 'grab' }}
                >
                  {resolveProjectTags(g.title, values)}
                </text>
                {isSelected && (
                  <rect
                    x={g.x + g.w - 1.5} y={g.y + g.h - 1.5} width={3} height={3}
                    fill="#2B8CFF" style={{ cursor: 'nwse-resize' }}
                    onMouseDown={e => handleGroupResizeMouseDown(e, g)}
                    onClick={e => e.stopPropagation()}
                  />
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
            const start = ((): Point | null => {
              if (linkFrom.kind === 'point') return linkFrom.at;
              if (linkFrom.kind === 'line') {
                const pts = allConnPoints.get(linkFrom.connId);
                return pts ? pointAtT(pts, linkFrom.t) : null;
              }
              const sym = byId.get(linkFrom.id);
              if (!sym) return null;
              if (linkFrom.kind === 'port') {
                const port = (SYMBOL_PORTS[sym.kind] ?? []).find(p => p.id === linkFrom.port);
                return port ? portPagePosition(sym, port) : blockCenter(sym);
              }
              return blockCenter(sym);
            })();
            if (!start) return null;
            const pts = [start, ...drawnWaypoints].map(p => `${p.x},${p.y}`).join(' ');
            return (
              <g>
                <polyline points={pts} fill="none" stroke="#2B8CFF" strokeWidth={0.35} strokeDasharray="1.5,1" />
                {drawnWaypoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1} fill="#2B8CFF" />)}
              </g>
            );
          })()}

          {/* Condutores — recalculados a cada posição atual (derivações formais
              acompanham a linha-mãe); clicáveis, arrastáveis como bloco */}
          {connections.map(conn => {
            const routePoints = allConnPoints.get(conn.id);
            if (!routePoints) return null;
            const pointsStr = routePoints.map(p => `${p.x},${p.y}`).join(' ');
            const waypoints = conn.waypoints ?? [];
            const isSelected = selectedConnId === conn.id;
            return (
              <g key={conn.id}>
                <polyline points={pointsStr} fill="none" stroke="#B0271A" strokeWidth={isSelected ? 0.7 : 0.4} />
                {isSelected && (
                  <polyline points={pointsStr} fill="none" stroke="#2B8CFF" strokeWidth={1.1} strokeDasharray="2,1.5" opacity={0.5} />
                )}
                {conn.label && (() => {
                  const { at, anchor } = connectionLabelPosition(routePoints);
                  return (
                    <text
                      x={at.x} y={at.y} fontSize={2.2} textAnchor={anchor} fill="#333"
                      onClick={e => { e.stopPropagation(); clearSelection(); setSelectedConnId(conn.id); }}
                      style={{ cursor: 'pointer' }}
                    >
                      {resolveProjectTags(conn.label, values)}
                    </text>
                  );
                })()}
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
                {(['from', 'to'] as const).map(which => {
                  const ep = conn[which];
                  if (ep.kind === 'symbol' || ep.kind === 'port') return null;
                  const at = which === 'from' ? routePoints[0] : routePoints[routePoints.length - 1];
                  // derivação FORMAL: nó preto (•) de junção, arrastável; ponto
                  // fixo legado: quadradinho azul, também arrastável
                  return ep.kind === 'line' ? (
                    <circle
                      key={which}
                      cx={at.x} cy={at.y} r={1.1} fill="#B0271A" stroke="#fff" strokeWidth={0.25}
                      style={{ cursor: linkMode ? 'crosshair' : 'move' }}
                      onMouseDown={e => handleEndpointMouseDown(e, conn.id, which, at, ep)}
                      onClick={e => e.stopPropagation()}
                    >
                      <title>Derivação — nasce desta linha e a acompanha; arraste pra reconectar</title>
                    </circle>
                  ) : (
                    <rect
                      key={which}
                      x={at.x - 1} y={at.y - 1} width={2} height={2} fill="#2B8CFF"
                      style={{ cursor: linkMode ? 'crosshair' : 'move' }}
                      onMouseDown={e => handleEndpointMouseDown(e, conn.id, which, at, ep)}
                      onClick={e => e.stopPropagation()}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Símbolos — arrastáveis, giráveis, redimensionáveis, clicáveis */}
          {placements.map(p => {
            const isSelected = selectedId === p.id || selectedIds.has(p.id);
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

          {/* Portas de conexão — visíveis no modo ligar: clicar numa gruda a
              ligação naquele ponto específico da geometria (ex.: lado CA do
              inversor), em vez do lado automático */}
          {linkMode && placements.map(p => (SYMBOL_PORTS[p.kind] ?? []).map(port => {
            const at = portPagePosition(p, port);
            const isOrigin = linkFrom?.kind === 'port' && linkFrom.id === p.id && linkFrom.port === port.id;
            return (
              <g key={`${p.id}:${port.id}`}>
                <circle
                  cx={at.x} cy={at.y} r={1.1}
                  fill={isOrigin ? '#F5A800' : '#fff'} stroke={isOrigin ? '#F5A800' : '#2B8CFF'} strokeWidth={0.35}
                  style={{ cursor: 'crosshair' }}
                  onClick={e => { e.stopPropagation(); handlePortClick(p.id, port.id); }}
                >
                  <title>{`${p.label} · ${port.name}`}</title>
                </circle>
              </g>
            );
          }))}

          {/* Retângulo de multi-seleção em andamento */}
          {marquee && (
            <rect
              x={Math.min(marquee.x1, marquee.x2)} y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)} height={Math.abs(marquee.y2 - marquee.y1)}
              fill="#2B8CFF" fillOpacity={0.08} stroke="#2B8CFF" strokeWidth={0.3} strokeDasharray="1.5,1"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>

      {/* Painel de propriedades — contextual à seleção atual */}
      {(() => {
        const sel = selectedId ? byId.get(selectedId) : null;
        const selConn = selectedConnId ? connections.find(c => c.id === selectedConnId) : null;
        const selGroup = selectedGroupId ? groups.find(g => g.id === selectedGroupId) : null;
        const selText = selectedTextId ? texts.find(t => t.id === selectedTextId) : null;
        const showPanel = !!sel || selectedIds.size > 1 || !!selConn || !!selGroup || !!selText;
        if (!showPanel) return null;
        const fieldStyle: React.CSSProperties = { width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid #DDD', fontSize: 12, boxSizing: 'border-box' };
        const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3, display: 'block' };
        return (
          <div style={{ width: 240, flexShrink: 0, background: '#fff', border: '1px solid #E8E8E8', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {selectedIds.size > 1 ? (
              <>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{selectedIds.size} componentes selecionados</p>
                <button onClick={duplicateSelected} style={{ ...btnStyle(), justifyContent: 'center' }}>
                  <Copy size={13} /> Duplicar (Ctrl+D)
                </button>
                <button onClick={removeSelected} disabled={!canRemoveSelected} style={{ ...btnStyle(), justifyContent: 'center', color: canRemoveSelected ? '#A32D2D' : '#ccc' }}>
                  <Trash2 size={13} /> Remover manuais
                </button>
                <p style={{ fontSize: 10.5, color: '#999', margin: 0 }}>Arraste qualquer um pra mover o conjunto inteiro. Shift+clique tira/põe da seleção.</p>
              </>
            ) : sel ? (
              <>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{KIND_LABEL[sel.kind]}</p>
                <div>
                  <label style={labelStyle}>Nome</label>
                  <input
                    value={sel.label} onFocus={snapshot} style={fieldStyle}
                    onChange={e => setPlacements(prev => prev.map(p => (p.id === sel.id ? { ...p, label: e.target.value } : p)))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Legenda (uma linha por item, aceita {'{tags}'})</label>
                  <textarea
                    value={sel.legend.join('\n')} onFocus={snapshot} rows={3} style={{ ...fieldStyle, resize: 'vertical' }}
                    onChange={e => {
                      const legend = e.target.value.split('\n');
                      setPlacements(prev => prev.map(p => (p.id === sel.id ? { ...p, legend } : p)));
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Tamanho ({sel.scale.toFixed(1)}×)</label>
                  <input
                    type="range" min={0.4} max={3} step={0.1} value={sel.scale} style={{ width: '100%' }}
                    onMouseDown={snapshot}
                    onChange={e => {
                      const scale = Number(e.target.value);
                      setPlacements(prev => prev.map(p => (p.id === sel.id ? { ...p, scale } : p)));
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={rotateSelected} style={{ ...btnStyle(), flex: 1, justifyContent: 'center' }} title="Girar 90°">
                    <RotateCw size={13} /> {sel.rotation}°
                  </button>
                  <button onClick={duplicateSelected} style={{ ...btnStyle(), flex: 1, justifyContent: 'center' }} title="Duplicar (Ctrl+D)">
                    <Copy size={13} />
                  </button>
                </div>
                {isManualSymbol(sel.id) && (
                  <button onClick={removeSelected} style={{ ...btnStyle(), justifyContent: 'center', color: '#A32D2D' }}>
                    <Trash2 size={13} /> Remover
                  </button>
                )}
              </>
            ) : selConn ? (
              <>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Ligação</p>
                <p style={{ fontSize: 11.5, color: '#777', margin: 0 }}>{labelOfEndpoint(selConn.from)} → {labelOfEndpoint(selConn.to)}</p>
                <div>
                  <label style={labelStyle}>Bitola / especificação do condutor</label>
                  <input
                    value={selConn.label ?? ''} onFocus={snapshot} placeholder="Ex.: 2#6mm² + #6mm²" style={fieldStyle}
                    onChange={e => {
                      const label = e.target.value;
                      setConnections(prev => prev.map(c => (c.id === selConn.id ? { ...c, label: label || undefined } : c)));
                    }}
                  />
                </div>
                <p style={{ fontSize: 10.5, color: '#999', margin: 0 }}>Duplo-clique num trecho cria ponto de dobra; arraste os pontos pra moldar o traço.</p>
                <button onClick={removeSelected} style={{ ...btnStyle(), justifyContent: 'center', color: '#A32D2D' }}>
                  <Trash2 size={13} /> Remover ligação
                </button>
              </>
            ) : selGroup ? (
              <>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Grupo</p>
                <div>
                  <label style={labelStyle}>Título</label>
                  <input
                    value={selGroup.title} onFocus={snapshot} style={fieldStyle}
                    onChange={e => setGroups(prev => prev.map(g => (g.id === selGroup.id ? { ...g, title: e.target.value } : g)))}
                  />
                </div>
                <button onClick={removeSelected} style={{ ...btnStyle(), justifyContent: 'center', color: '#A32D2D' }}>
                  <Trash2 size={13} /> Remover grupo
                </button>
              </>
            ) : selText ? (
              <>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Texto</p>
                <div>
                  <label style={labelStyle}>Conteúdo (aceita {'{tags}'})</label>
                  <textarea
                    value={selText.value} onFocus={snapshot} rows={3} autoFocus style={{ ...fieldStyle, resize: 'vertical' }}
                    onChange={e => setTexts(prev => prev.map(t => (t.id === selText.id ? { ...t, value: e.target.value } : t)))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Tamanho da fonte (mm)</label>
                  <input
                    type="number" min={1.5} max={10} step={0.2} value={selText.size} onFocus={snapshot} style={fieldStyle}
                    onChange={e => {
                      const size = Math.max(1.5, Math.min(10, Number(e.target.value) || 3.2));
                      setTexts(prev => prev.map(t => (t.id === selText.id ? { ...t, size } : t)));
                    }}
                  />
                </div>
                <button onClick={removeSelected} style={{ ...btnStyle(), justifyContent: 'center', color: '#A32D2D' }}>
                  <Trash2 size={13} /> Remover texto
                </button>
              </>
            ) : null}
          </div>
        );
      })()}
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
