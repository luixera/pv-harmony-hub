import { useEffect, useId, useRef, useState } from 'react';
import { Search, MapPin, Zap, Factory, GitBranch } from 'lucide-react';
import { useBuscaRede } from './consultas';
import { mesclarSugestoes, prepararTermo, sugestoesDaRede, type Sugestao, type SugestaoLugar, type SugestaoRede } from './busca';
import { CORES, COR_SUBESTACAO } from './estilos';

/**
 * Um campo só: Places (município, bairro, endereço) e a RPC `rede_buscar`
 * (código de trafo/alimentador, nome de subestação) em paralelo, numa lista
 * única navegável por teclado. Escolher um lugar enquadra a vista; escolher
 * um item da rede enquadra E abre o detalhe (quem chama decide como).
 */
export function Busca({ mapa, aoEscolherRede }: { mapa: google.maps.Map | null; aoEscolherRede: (s: SugestaoRede) => void }) {
  const [texto, setTexto] = useState('');
  const [termo, setTermo] = useState<string | null>(null);
  const [lugares, setLugares] = useState<SugestaoLugar[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const id = useId();
  const servico = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessao = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // 250 ms de debounce: digitar "Campinas" não pode disparar 8 consultas
  useEffect(() => {
    const t = setTimeout(() => setTermo(prepararTermo(texto)), 250);
    return () => clearTimeout(t);
  }, [texto]);

  const rede = useBuscaRede(termo);

  useEffect(() => {
    if (!termo || !window.google?.maps?.places) { setLugares([]); return; }
    servico.current ??= new google.maps.places.AutocompleteService();
    sessao.current ??= new google.maps.places.AutocompleteSessionToken();
    let vivo = true;
    void servico.current.getPlacePredictions({
      input: termo, sessionToken: sessao.current,
      componentRestrictions: { country: 'br' },
      locationBias: mapa?.getBounds() ?? undefined,
    }, (preds) => {
      if (!vivo) return;
      setLugares((preds ?? []).slice(0, 5).map(p => ({
        tipo: 'lugar', id: p.place_id,
        titulo: p.structured_formatting.main_text, subtitulo: p.structured_formatting.secondary_text ?? '',
      })));
    });
    return () => { vivo = false; };
  }, [termo, mapa]);

  const sugestoes: Sugestao[] = termo
    ? mesclarSugestoes(termo, sugestoesDaRede(rede.data ?? []), lugares) : [];
  const mostrar = aberto && termo !== null && (sugestoes.length > 0 || rede.isFetching);

  const escolher = (s: Sugestao) => {
    setAberto(false);
    setTexto(s.titulo);
    if (s.tipo === 'lugar') {
      if (!mapa) return;
      void new google.maps.Geocoder().geocode({ placeId: s.id }, (res, st) => {
        const g = res?.[0]?.geometry;
        if (st !== 'OK' || !g) return;
        if (g.viewport) mapa.fitBounds(g.viewport); else { mapa.setCenter(g.location); mapa.setZoom(15); }
      });
      sessao.current = null;   // a sessão do Places fecha na escolha
      return;
    }
    aoEscolherRede(s);
  };

  const teclado = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo(a => Math.min(a + 1, sugestoes.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && mostrar && sugestoes[ativo]) { e.preventDefault(); escolher(sugestoes[ativo]); }
    else if (e.key === 'Escape') setAberto(false);
  };

  const Icone = ({ s }: { s: Sugestao }) => {
    if (s.tipo === 'lugar') return <MapPin size={14} style={{ color: '#9A9AA8', flexShrink: 0 }} />;
    const cor = s.risco ? CORES[s.risco] : '#9A9AA8';
    if (s.tipo === 'subestacao') return <Factory size={14} style={{ color: COR_SUBESTACAO, flexShrink: 0 }} />;
    if (s.tipo === 'alimentador') return <GitBranch size={14} style={{ color: cor, flexShrink: 0 }} />;
    return <Zap size={14} style={{ color: cor, flexShrink: 0 }} />;
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <label htmlFor={`${id}-busca`} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Buscar município, endereço, trafo, alimentador ou subestação
      </label>
      <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: '#6B6B78', pointerEvents: 'none' }} />
      <input id={`${id}-busca`} type="search" role="combobox" aria-expanded={mostrar} autoComplete="off"
             aria-controls={`${id}-lista`} aria-activedescendant={mostrar ? `${id}-op-${ativo}` : undefined}
             value={texto} placeholder="Município, endereço, trafo, alimentador ou SE"
             onChange={e => { setTexto(e.target.value); setAberto(true); setAtivo(0); }}
             onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 120)}
             onKeyDown={teclado}
             style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 9, boxSizing: 'border-box',
                      border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(14,14,20,0.92)',
                      color: '#fff', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
      {mostrar && (
        <ul id={`${id}-lista`} role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: 40,
              margin: 0, padding: 4, listStyle: 'none', background: 'rgba(14,14,20,0.97)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
          {sugestoes.length === 0 && (
            <li style={{ padding: '9px 10px', fontSize: 12, color: '#8A8A96' }}>Procurando…</li>
          )}
          {sugestoes.map((s, i) => (
            <li key={`${s.tipo}-${s.id}`} id={`${id}-op-${i}`} role="option" aria-selected={i === ativo}
                onMouseDown={e => { e.preventDefault(); escolher(s); }} onMouseEnter={() => setAtivo(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 7,
                         cursor: 'pointer', background: i === ativo ? 'rgba(245,168,0,0.14)' : 'transparent' }}>
              <Icone s={s} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, color: '#fff', fontWeight: 600,
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.titulo}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: '#8A8A96' }}>{s.subtitulo}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
