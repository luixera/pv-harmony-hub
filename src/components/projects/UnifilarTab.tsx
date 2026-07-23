import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, FlaskConical, Download, FileImage, RotateCw, Link2, Trash2, RefreshCw,
  Image as ImageIcon, Plus,
} from 'lucide-react';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { buildTechnicalJsonFromProject } from '@/utils/cadEngine/buildTechnicalJson';
import {
  ManualConnection, PlacedPhoto, PlacedSymbol, buildSceneFromPlacement,
  computeConnectorPoints, initialConnections, initialPlacement, snapToGrid,
} from '@/utils/cadEngine/editableLayout';
import { ComponentKind, Point } from '@/utils/cadEngine/types';
import { sceneToSvgInner, primitiveToSvg } from '@/utils/cadEngine/exportSvg';
import { sceneToPdfBlob } from '@/utils/cadEngine/exportPdf';
import { KIND_LABEL, SYMBOL_BBOX, SYMBOL_DEFS } from '@/utils/cadEngine/symbols';
import { CENTER_Y, PAPER, PITCH_X, START_X } from '@/utils/cadEngine/paper';
import { sanitizeFileName } from '@/lib/utils';

/**
 * Diagrama Unifilar (alpha) — visível apenas para o master. Editor interativo
 * mínimo sobre o CAD Engine: arrastar, girar, ligar (com desenho manual do
 * traço) e adicionar componentes/fotos avulsos (o "ManualLayoutSource" da
 * proposta §17.2). Sem motor de roteamento automático, sem templates
 * reutilizáveis ainda — ver DIAGRAMA UNIFILAR/cad-engine-arquitetura.md.
 *
 * O layout editado é salvo só neste navegador (localStorage por projeto) —
 * não é sincronizado entre usuários/dispositivos nem persistido no banco.
 */

const STORAGE_PREFIX = 'unifilar-layout:';
const ALL_KINDS = Object.keys(KIND_LABEL) as ComponentKind[];

interface SavedLayout { placements: PlacedSymbol[]; connections: ManualConnection[]; photos?: PlacedPhoto[] }

/**
 * Funde o estado salvo com os componentes atuais do projeto. Os componentes
 * derivados do projeto (`json.components`, ids fixos tipo `PV-01`) são
 * resincronizados a cada troca de equipamento — só posição/rotação editadas
 * sobrevivem, e um componente removido do cadastro some do layout. Componentes
 * adicionados manualmente pelo usuário (prefixo `manual-`, ex.: um DPS avulso)
 * não têm origem no projeto — não dá para diferenciá-los "pela ausência no
 * cadastro atual" (um componente real removido do cadastro cairia no mesmo
 * caso), por isso o prefixo do id é o que decide, e eles sobrevivem sempre.
 */
function reconcile(json: ReturnType<typeof buildTechnicalJsonFromProject>, saved: SavedLayout | null): SavedLayout {
  const fresh = initialPlacement(json);
  if (!saved) return { placements: fresh, connections: initialConnections(json), photos: [] };

  const reconciledProject = fresh.map(f => {
    const s = saved.placements.find(p => p.id === f.id);
    return s ? { ...f, x: s.x, y: s.y, rotation: s.rotation } : f;
  });
  const manual = saved.placements.filter(p => p.id.startsWith('manual-'));
  const placements = [...reconciledProject, ...manual];

  const validIds = new Set(placements.map(p => p.id));
  const connections = saved.connections.filter(c => validIds.has(c.from) && validIds.has(c.to));

  return { placements, connections, photos: saved.photos ?? [] };
}

export function UnifilarTab({ project }: { project: ProjectWithDetails }) {
  const json = useMemo(() => buildTechnicalJsonFromProject(project), [project]);
  const storageKey = `${STORAGE_PREFIX}${project.id}`;

  const [placements, setPlacements] = useState<PlacedSymbol[]>([]);
  const [connections, setConnections] = useState<ManualConnection[]>([]);
  const [photos, setPhotos] = useState<PlacedPhoto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [drawnWaypoints, setDrawnWaypoints] = useState<Point[]>([]);
  const [snap, setSnap] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Carrega do localStorage (ou monta o layout inicial) sempre que o projeto muda.
  useEffect(() => {
    let saved: SavedLayout | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch { /* estado salvo corrompido — ignora e recomeça */ }
    const merged = reconcile(json, saved);
    setPlacements(merged.placements);
    setConnections(merged.connections);
    setPhotos(merged.photos ?? []);
    setSelectedId(null);
    setSelectedPhotoId(null);
    setLinkMode(false);
    setLinkFrom(null);
    setDrawnWaypoints([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à troca de projeto
  }, [project.id]);

  // Salva a cada mudança (debounce simples via microtask — edições são raras/manuais).
  useEffect(() => {
    if (placements.length === 0) return; // ainda não carregou
    try { localStorage.setItem(storageKey, JSON.stringify({ placements, connections, photos })); } catch { /* storage cheio/bloqueado — não é crítico */ }
  }, [placements, connections, photos, storageKey]);

  const scene = useMemo(() => buildSceneFromPlacement(json, placements, connections, photos), [json, placements, connections, photos]);

  // ── Interação: arrastar símbolos, fotos, pontos de dobra das linhas ──────
  const svgRef = useRef<SVGSVGElement>(null);
  type DragState =
    | { type: 'symbol'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'waypoint'; connId: string; index: number; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'photo'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
    | { type: 'photo-resize'; id: string; startX: number; startY: number; origW: number; origH: number; moved: boolean };
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
      } else if (drag.type === 'waypoint') {
        let nx = drag.origX + dx, ny = drag.origY + dy;
        if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
        setConnections(prev => prev.map(c => {
          if (c.id !== drag.connId) return c;
          const waypoints = [...(c.waypoints ?? [])];
          waypoints[drag.index] = { x: nx, y: ny };
          return { ...c, waypoints };
        }));
      } else if (drag.type === 'photo') {
        const nx = drag.origX + dx, ny = drag.origY + dy;
        setPhotos(prev => prev.map(ph => (ph.id === drag.id ? { ...ph, x: nx, y: ny } : ph)));
      } else if (drag.type === 'photo-resize') {
        const newW = Math.max(15, drag.origW + dx);
        const newH = Math.max(10, drag.origH * (newW / drag.origW));
        setPhotos(prev => prev.map(ph => (ph.id === drag.id ? { ...ph, w: newW, h: newH } : ph)));
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.type === 'symbol' && !drag.moved) handleSymbolClick(drag.id); // arrasto não ocorreu → foi um clique
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSymbolClick é estável o bastante (fecha sobre state via setState funcional)
  }, [snap]);

  // Esc cancela uma ligação/desenho de linha em andamento.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && linkMode && linkFrom) { setLinkFrom(null); setDrawnWaypoints([]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkMode, linkFrom]);

  const handleSymbolMouseDown = (e: React.MouseEvent, p: PlacedSymbol) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'symbol', id: p.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y, moved: false };
  };

  const handleSymbolClick = (id: string) => {
    if (linkMode) {
      if (!linkFrom) { setLinkFrom(id); setDrawnWaypoints([]); return; }
      if (linkFrom === id) { setLinkFrom(null); setDrawnWaypoints([]); return; } // clicou no mesmo: cancela
      setConnections(prev => [...prev, {
        id: `manual-${Date.now()}`, from: linkFrom, to: id,
        waypoints: drawnWaypoints.length ? drawnWaypoints : undefined,
      }]);
      setLinkFrom(null);
      setDrawnWaypoints([]);
      return;
    }
    setSelectedId(prev => (prev === id ? null : id));
    setSelectedPhotoId(null);
  };

  // Enquanto uma ligação está sendo criada (linkFrom setado), clicar no canvas
  // vazio vai acrescentando pontos ao traço — é o modo "desenhar linha".
  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!linkMode || !linkFrom || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pxToMm = PAPER.widthMm / rect.width;
    const x = (e.clientX - rect.left) * pxToMm;
    const y = (e.clientY - rect.top) * pxToMm;
    const pt = snap ? { x: snapToGrid(x), y: snapToGrid(y) } : { x, y };
    setDrawnWaypoints(prev => [...prev, pt]);
  };

  const rotateSelected = () => {
    if (!selectedId) return;
    setPlacements(prev => prev.map(p => (p.id === selectedId ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  };

  const removeConnection = (id: string) => setConnections(prev => prev.filter(c => c.id !== id));

  // Arrastar um ponto de dobra já existente.
  const handleWaypointMouseDown = (e: React.MouseEvent, connId: string, index: number, at: Point) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'waypoint', connId, index, startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, moved: false };
  };

  // Clicar (e arrastar) no meio de um trecho cria um novo ponto de dobra ali.
  const handleAddWaypoint = (e: React.MouseEvent, connId: string, index: number, at: Point) => {
    e.preventDefault();
    e.stopPropagation();
    setConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const waypoints = [...(c.waypoints ?? [])];
      waypoints.splice(index, 0, at);
      return { ...c, waypoints };
    }));
    dragRef.current = { type: 'waypoint', connId, index, startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, moved: false };
  };

  const removeWaypoint = (connId: string, index: number) => {
    setConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const waypoints = [...(c.waypoints ?? [])];
      waypoints.splice(index, 1);
      return { ...c, waypoints };
    }));
  };

  // ── Componentes adicionados livremente (não vêm do cadastro do projeto) ──
  // Mesma convenção do reconcile(): id prefixado com "manual-" (ver addComponent abaixo).
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
      rotation: 0,
    };
    setPlacements(prev => [...prev, newSymbol]);
    setSelectedId(id);
    setSelectedPhotoId(null);
  };

  const removeSelected = () => {
    if (selectedPhotoId) {
      setPhotos(prev => prev.filter(ph => ph.id !== selectedPhotoId));
      setSelectedPhotoId(null);
      return;
    }
    if (selectedId && isManualSymbol(selectedId)) {
      setPlacements(prev => prev.filter(p => p.id !== selectedId));
      setConnections(prev => prev.filter(c => c.from !== selectedId && c.to !== selectedId));
      setSelectedId(null);
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
        setSelectedId(null);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoMouseDown = (e: React.MouseEvent, ph: PlacedPhoto) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPhotoId(ph.id);
    setSelectedId(null);
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

  const resetLayout = () => {
    if (!confirm('Restaurar o layout automático? Posições, ligações, componentes e fotos adicionados manualmente neste projeto serão perdidos (só neste navegador).')) return;
    localStorage.removeItem(storageKey);
    setPlacements(initialPlacement(json));
    setConnections(initialConnections(json));
    setPhotos([]);
    setSelectedId(null);
    setSelectedPhotoId(null);
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
    download(new Blob([svg], { type: 'image/svg+xml' }), `unifilar_${sanitizeFileName(project.code)}.svg`);
  };
  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try { download(await sceneToPdfBlob(scene), `unifilar_${sanitizeFileName(project.code)}.pdf`); }
    finally { setGeneratingPdf(false); }
  };

  const byId = useMemo(() => new Map(placements.map(p => [p.id, p])), [placements]);
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const canRemoveSelected = (!!selectedId && isManualSymbol(selectedId)) || !!selectedPhotoId;

  if (placements.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} /></div>;
  }

  const btnStyle = (active = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
    border: active ? 'none' : '1px solid #E0E0E0', background: active ? '#2B8CFF' : '#fff',
    color: active ? '#fff' : '#333', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  });

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, background: '#FFF7E6',
        border: '1px solid #FDE4A8', borderRadius: 10, padding: '10px 14px', marginBottom: 16,
      }}>
        <FlaskConical size={15} style={{ color: '#854F0B', flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: '#854F0B', margin: 0 }}>
          <strong>Alpha interno (só master).</strong> Arraste os símbolos (clique em qualquer parte
          da figura) e gire o selecionado. Para ligar: clique na origem, depois clique no destino
          (liga direto) ou clique em pontos do canvas antes do destino para desenhar o traço à mão
          — Esc cancela. Depois de criada, arraste o traço para adicionar mais dobras. Adicione
          componentes extras e fotos pela barra abaixo. Nada disso sincroniza entre dispositivos
          nem gera template reutilizável — fica só neste navegador.
        </p>
      </div>

      {/* Barra de ferramentas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button
          onClick={() => { setLinkMode(m => !m); setLinkFrom(null); setDrawnWaypoints([]); setSelectedId(null); setSelectedPhotoId(null); }}
          style={btnStyle(linkMode)}
        >
          <Link2 size={13} />
          {linkMode
            ? (linkFrom ? `Ligar ${labelOf(linkFrom)} a… (${drawnWaypoints.length} pontos, Esc cancela)` : 'Clique no componente de origem')
            : 'Ligar / desenhar linha'}
        </button>

        <button onClick={rotateSelected} disabled={!selectedId} style={{ ...btnStyle(), color: selectedId ? '#333' : '#bbb', cursor: selectedId ? 'pointer' : 'not-allowed' }}>
          <RotateCw size={13} /> {selectedId ? `Girar ${labelOf(selectedId)}` : 'Girar (selecione um símbolo)'}
        </button>

        <button onClick={removeSelected} disabled={!canRemoveSelected} style={{ ...btnStyle(), color: canRemoveSelected ? '#A32D2D' : '#ccc', cursor: canRemoveSelected ? 'pointer' : 'not-allowed' }}>
          <Trash2 size={13} /> Remover selecionado
        </button>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555' }}>
          <input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Ajustar à grade
        </label>

        <button onClick={resetLayout} style={{ ...btnStyle(), color: '#A32D2D' }}>
          <RefreshCw size={13} /> Restaurar automático
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

      {/* Adicionar componentes/fotos avulsos */}
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
      </div>

      {/* Canvas */}
      <div style={{ background: '#F4F4F4', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${PAPER.widthMm} ${PAPER.heightMm}`}
          style={{ width: 900, maxWidth: '100%', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', flexShrink: 0, cursor: linkMode && linkFrom ? 'crosshair' : linkMode ? 'pointer' : 'default' }}
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

          {/* Traço em andamento (modo desenhar linha) */}
          {linkMode && linkFrom && byId.get(linkFrom) && (() => {
            const from = byId.get(linkFrom)!;
            const start = { x: from.x + SYMBOL_BBOX.w / 2, y: from.y + SYMBOL_BBOX.h / 2 };
            const pts = [start, ...drawnWaypoints].map(p => `${p.x},${p.y}`).join(' ');
            return (
              <g>
                <polyline points={pts} fill="none" stroke="#2B8CFF" strokeWidth={0.35} strokeDasharray="1.5,1" />
                {drawnWaypoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1} fill="#2B8CFF" />)}
              </g>
            );
          })()}

          {/* Condutores — recalculados a cada posição atual; pontos de dobra são arrastáveis */}
          {connections.map(conn => {
            const a = byId.get(conn.from), b = byId.get(conn.to);
            if (!a || !b) return null;
            const routePoints = computeConnectorPoints(a, b, conn.waypoints);
            const pointsStr = routePoints.map(p => `${p.x},${p.y}`).join(' ');
            const waypoints = conn.waypoints ?? [];
            return (
              <g key={conn.id}>
                <polyline points={pointsStr} fill="none" stroke="#B0271A" strokeWidth={0.4} />
                {/* trecho invisível mais grosso — alvo de clique maior para arrastar/criar dobra */}
                {routePoints.slice(0, -1).map((p, i) => {
                  const q = routePoints[i + 1];
                  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                  return (
                    <line
                      key={i}
                      x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                      stroke="transparent" strokeWidth={2.5}
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={e => handleAddWaypoint(e, conn.id, i, mid)}
                      onClick={e => e.stopPropagation()}
                    />
                  );
                })}
                {waypoints.map((wp, i) => (
                  <circle
                    key={i}
                    cx={wp.x} cy={wp.y} r={1.3}
                    fill="#fff" stroke="#B0271A" strokeWidth={0.4}
                    style={{ cursor: 'move' }}
                    onMouseDown={e => handleWaypointMouseDown(e, conn.id, i, wp)}
                    onClick={e => e.stopPropagation()}
                    onDoubleClick={e => { e.stopPropagation(); removeWaypoint(conn.id, i); }}
                  />
                ))}
              </g>
            );
          })}

          {/* Símbolos — arrastáveis, giráveis, clicáveis */}
          {placements.map(p => {
            const isSelected = selectedId === p.id;
            const isLinkFrom = linkFrom === p.id;
            const inner = (SYMBOL_DEFS[p.kind] ?? []).map((prim, i) => (
              <g key={i} dangerouslySetInnerHTML={{ __html: primitiveToSvg(prim, '#1A1A1A', 0.35) }} />
            ));
            return (
              <g key={p.id}>
                <g
                  transform={`translate(${p.x},${p.y}) rotate(${p.rotation},${SYMBOL_BBOX.w / 2},${SYMBOL_BBOX.h / 2})`}
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
                <text x={p.x + SYMBOL_BBOX.w / 2} y={p.y + SYMBOL_BBOX.h + 5} fontSize={2.6} textAnchor="middle" fontWeight="bold" fill="#333">{p.label}</text>
                {p.legend.map((line, i) => (
                  <text key={i} x={p.x + SYMBOL_BBOX.w / 2} y={p.y + SYMBOL_BBOX.h + 5 + (i + 1) * 3.6} fontSize={2.4} textAnchor="middle" fill="#333">{line}</text>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {connections.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#555' }}>
                <span>{labelOf(c.from)} → {labelOf(c.to)}</span>
                <button onClick={() => removeConnection(c.id)} style={{ border: 'none', background: 'none', color: '#A32D2D', cursor: 'pointer', display: 'flex' }} title="Remover ligação">
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
