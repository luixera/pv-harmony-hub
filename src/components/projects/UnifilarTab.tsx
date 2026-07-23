import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, FlaskConical, Download, FileImage, RotateCw, Link2, Trash2, RefreshCw } from 'lucide-react';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { buildTechnicalJsonFromProject } from '@/utils/cadEngine/buildTechnicalJson';
import {
  ManualConnection, PlacedSymbol, buildSceneFromPlacement,
  initialConnections, initialPlacement, orthogonalPath, snapToGrid,
} from '@/utils/cadEngine/editableLayout';
import { sceneToSvgInner, primitiveToSvg } from '@/utils/cadEngine/exportSvg';
import { sceneToPdfBlob } from '@/utils/cadEngine/exportPdf';
import { SYMBOL_BBOX, SYMBOL_DEFS } from '@/utils/cadEngine/symbols';
import { PAPER } from '@/utils/cadEngine/paper';
import { sanitizeFileName } from '@/lib/utils';

/**
 * Diagrama Unifilar (alpha) — visível apenas para o master. Editor interativo
 * mínimo sobre o CAD Engine: arrastar, girar e ligar componentes manualmente
 * (o "ManualLayoutSource" da proposta §17.2). Sem motor de roteamento
 * automático, sem catálogo de símbolos além dos 5 já implementados, sem
 * templates reutilizáveis ainda — ver DIAGRAMA UNIFILAR/cad-engine-arquitetura.md.
 *
 * O layout editado é salvo só neste navegador (localStorage por projeto) —
 * não é sincronizado entre usuários/dispositivos nem persistido no banco.
 */

const STORAGE_PREFIX = 'unifilar-layout:';

interface SavedLayout { placements: PlacedSymbol[]; connections: ManualConnection[] }

/** Funde o estado salvo com os componentes atuais do projeto — descarta ids
 *  que não existem mais e posiciona os que foram adicionados depois. */
function reconcile(json: ReturnType<typeof buildTechnicalJsonFromProject>, saved: SavedLayout | null): SavedLayout {
  const fresh = initialPlacement(json);
  if (!saved) return { placements: fresh, connections: initialConnections(json) };

  const validIds = new Set(json.components.map(c => c.id));
  const byId = new Map(saved.placements.filter(p => validIds.has(p.id)).map(p => [p.id, p]));
  const placements = fresh.map(f => {
    const s = byId.get(f.id);
    return s ? { ...f, x: s.x, y: s.y, rotation: s.rotation } : f;
  });
  const connections = saved.connections.filter(c => validIds.has(c.from) && validIds.has(c.to));
  return { placements, connections };
}

export function UnifilarTab({ project }: { project: ProjectWithDetails }) {
  const json = useMemo(() => buildTechnicalJsonFromProject(project), [project]);
  const storageKey = `${STORAGE_PREFIX}${project.id}`;

  const [placements, setPlacements] = useState<PlacedSymbol[]>([]);
  const [connections, setConnections] = useState<ManualConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
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
    setSelectedId(null);
    setLinkMode(false);
    setLinkFrom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à troca de projeto
  }, [project.id]);

  // Salva a cada mudança (debounce simples via microtask — edições são raras/manuais).
  useEffect(() => {
    if (placements.length === 0) return; // ainda não carregou
    try { localStorage.setItem(storageKey, JSON.stringify({ placements, connections })); } catch { /* storage cheio/bloqueado — não é crítico */ }
  }, [placements, connections, storageKey]);

  const scene = useMemo(() => buildSceneFromPlacement(json, placements, connections), [json, placements, connections]);

  // ── Interação: arrastar ──────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const pxToMm = PAPER.widthMm / rect.width;
      const dx = (e.clientX - drag.startX) * pxToMm;
      const dy = (e.clientY - drag.startY) * pxToMm;
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) drag.moved = true;
      let nx = drag.origX + dx, ny = drag.origY + dy;
      if (snap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
      setPlacements(prev => prev.map(p => (p.id === drag.id ? { ...p, x: nx, y: ny } : p)));
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (!drag.moved) handleSymbolClick(drag.id); // arrasto não ocorreu → foi um clique
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSymbolClick é estável o bastante (fecha sobre state via setState funcional)
  }, [snap]);

  const handleSymbolMouseDown = (e: React.MouseEvent, p: PlacedSymbol) => {
    e.preventDefault();
    dragRef.current = { id: p.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y, moved: false };
  };

  const handleSymbolClick = (id: string) => {
    if (linkMode) {
      if (!linkFrom) { setLinkFrom(id); return; }
      if (linkFrom === id) { setLinkFrom(null); return; } // clicou no mesmo: cancela
      setConnections(prev => [...prev, { id: `manual-${Date.now()}`, from: linkFrom, to: id }]);
      setLinkFrom(null);
      return;
    }
    setSelectedId(prev => (prev === id ? null : id));
  };

  const rotateSelected = () => {
    if (!selectedId) return;
    setPlacements(prev => prev.map(p => (p.id === selectedId ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  };

  const removeConnection = (id: string) => setConnections(prev => prev.filter(c => c.id !== id));

  const resetLayout = () => {
    if (!confirm('Restaurar o layout automático? As posições e ligações manuais deste projeto serão perdidas (só neste navegador).')) return;
    localStorage.removeItem(storageKey);
    setPlacements(initialPlacement(json));
    setConnections(initialConnections(json));
    setSelectedId(null);
    setLinkFrom(null);
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

  if (placements.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} /></div>;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, background: '#FFF7E6',
        border: '1px solid #FDE4A8', borderRadius: 10, padding: '10px 14px', marginBottom: 16,
      }}>
        <FlaskConical size={15} style={{ color: '#854F0B', flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: '#854F0B', margin: 0 }}>
          <strong>Alpha interno (só master).</strong> Arraste os símbolos, gire o selecionado e ligue
          componentes manualmente. Sem motor de roteamento automático ainda; o layout é salvo
          só neste navegador — não sincroniza entre dispositivos nem gera template reutilizável.
        </p>
      </div>

      {/* Barra de ferramentas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          onClick={() => { setLinkMode(m => !m); setLinkFrom(null); setSelectedId(null); }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
            border: linkMode ? 'none' : '1px solid #E0E0E0', background: linkMode ? '#2B8CFF' : '#fff',
            color: linkMode ? '#fff' : '#333', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Link2 size={13} /> {linkMode ? (linkFrom ? `Ligar ${labelOf(linkFrom)} a…` : 'Escolha a origem') : 'Ligar componentes'}
        </button>

        <button
          onClick={rotateSelected}
          disabled={!selectedId}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
            border: '1px solid #E0E0E0', background: '#fff', color: selectedId ? '#333' : '#bbb',
            fontSize: 12, fontWeight: 600, cursor: selectedId ? 'pointer' : 'not-allowed',
          }}
        >
          <RotateCw size={13} /> {selectedId ? `Girar ${labelOf(selectedId)}` : 'Girar (selecione um símbolo)'}
        </button>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555' }}>
          <input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Ajustar à grade
        </label>

        <button
          onClick={resetLayout}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', color: '#A32D2D', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          <RefreshCw size={13} /> Restaurar automático
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={handleDownloadSvg}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', color: '#333', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
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

      {/* Canvas */}
      <div style={{ background: '#F4F4F4', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${PAPER.widthMm} ${PAPER.heightMm}`}
          style={{ width: 900, maxWidth: '100%', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', flexShrink: 0, cursor: linkMode ? 'crosshair' : 'default' }}
        >
          {/* Moldura, cabeçalho e carimbo — estáticos */}
          <g dangerouslySetInnerHTML={{ __html: sceneToSvgInner(buildSceneFromPlacement(json, [], [])) }} />

          {/* Condutores — recalculados a cada posição atual */}
          {connections.map(conn => {
            const a = byId.get(conn.from), b = byId.get(conn.to);
            if (!a || !b) return null;
            const ca = { x: a.x + SYMBOL_BBOX.w / 2, y: a.y + SYMBOL_BBOX.h / 2 };
            const cb = { x: b.x + SYMBOL_BBOX.w / 2, y: b.y + SYMBOL_BBOX.h / 2 };
            const points = orthogonalPath(ca, cb).map(p => `${p.x},${p.y}`).join(' ');
            return <polyline key={conn.id} points={points} fill="none" stroke="#B0271A" strokeWidth={0.4} />;
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
                  style={{ cursor: linkMode ? 'crosshair' : 'grab' }}
                >
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
