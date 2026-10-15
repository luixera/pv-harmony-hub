import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { AlertTriangle, Clock, Satellite, Map as MapIcon, Zap, GitBranch, Factory, Search, ShieldCheck } from 'lucide-react';
import { card, GOLD, Loading } from './ConsoleSections';
// arquivo renomeado: 'Busca.tsx' colidia com 'busca.ts' em sistema de
// arquivos sem distincao de caixa (Windows), e o import resolvia para o util
import { Busca } from './rede/BarraDeBusca';
import { Legenda } from './rede/Legenda';
import { PainelLateral } from './rede/PainelLateral';
import { useRedeNoMapa } from './rede/consultas';
import { useDeck } from './rede/useDeck';
import { montarCamadas, type Alvo } from './rede/camadas';
import { desenharAtlas, type Atlas } from './rede/atlas';
import { ROTULOS } from './rede/estilos';
import { inteiro, mesesDesde, pct, rotuloIdade } from './rede/formato';
import { caixaDeConsulta, contemCaixa, type Caixa } from './rede/zoom';
import type { Camada, Selecao } from './rede/tipos';
import type { SugestaoRede } from './rede/busca';

/**
 * Capacidade de rede em BAIXA TENSÃO e risco de inversão de fluxo — 3ª
 * entrega (spec §12).
 *
 * O dado é a BDGD da ANEEL, pública e anual. NÃO cruza com projetos do GD
 * Manager e NÃO é parecer de acesso. A unidade é o transformador MT/BT: é
 * nele que a GD de baixa tensão se conecta (carga das UCs de BT, geração das
 * unidades de BT). O alimentador de MT é contexto, desligado por padrão.
 *
 * O servidor decide a amostra pela CONTAGEM da caixa (pontos até 4.000,
 * senão células) e devolve GeoJSON enxuto; a tela desenha tudo em WebGL
 * (deck.gl sobre o mapa) — a v2 em SVG movia até 120 mil elementos por
 * arrasto. A vista só volta ao servidor quando sai da caixa carregada (20%
 * maior que a tela) ou o zoom muda; com "atualizar ao mover" desligado, só
 * quando a pessoa pede ("Pesquisar nesta área").
 */
const LIBRARIES: ('places')[] = ['places'];   // as outras telas usam as mesmas; opções diferentes quebram o loader
const CENTRO_PADRAO = { lat: -22.9056, lng: -47.0616 };
const CHAVE_VISTA = 'painel.rede.vista';

interface Vista { lat: number; lng: number; zoom: number; camadas: Camada[]; satelite: boolean; autoAtualizar?: boolean }
const lerVista = (): Vista | null => {
  try { const v = sessionStorage.getItem(CHAVE_VISTA); return v ? JSON.parse(v) as Vista : null; } catch { return null; }
};
const guardarVista = (v: Vista) => {
  try { sessionStorage.setItem(CHAVE_VISTA, JSON.stringify(v)); } catch { /* sem storage, sem memória de vista */ }
};

const caixaDe = (b: google.maps.LatLngBounds): Caixa => {
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  return { oeste: sw.lng(), sul: sw.lat(), leste: ne.lng(), norte: ne.lat() };
};
const limitesDe = (c: Caixa) =>
  new google.maps.LatLngBounds({ lat: c.sul, lng: c.oeste }, { lat: c.norte, lng: c.leste });
/** Caixa de um polígono GeoJSON (a célula): o primeiro anel. */
const caixaDoPoligono = (geometria: unknown): Caixa | null => {
  const anel = (geometria as { coordinates?: number[][][] })?.coordinates?.[0];
  if (!anel?.length) return null;
  const xs = anel.map(p => p[0]), ys = anel.map(p => p[1]);
  return { oeste: Math.min(...xs), sul: Math.min(...ys), leste: Math.max(...xs), norte: Math.max(...ys) };
};

export function NetworkSection() {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script', libraries: LIBRARIES,
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? '',
  });
  const inicial = useRef(lerVista());
  // `center` e `options` têm de ser estáveis: a biblioteca compara por
  // identidade e chama setCenter/setOptions a cada mudança.
  const centroInicial = useRef(inicial.current ? { lat: inicial.current.lat, lng: inicial.current.lng } : CENTRO_PADRAO).current;
  const zoomInicial = useRef(inicial.current?.zoom ?? 13).current;
  const [mapa, setMapa] = useState<google.maps.Map | null>(null);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [pendente, setPendente] = useState<Caixa | null>(null);   // vista fora da caixa, à espera do "Pesquisar nesta área"
  const [zoom, setZoom] = useState(inicial.current?.zoom ?? 13);
  const [soRisco, setSoRisco] = useState(false);
  const [satelite, setSatelite] = useState(inicial.current?.satelite ?? true);
  const [autoAtualizar, setAutoAtualizar] = useState(inicial.current?.autoAtualizar ?? true);
  // BT é o assunto: só os trafos por padrão; alimentadores de MT quando a pessoa pedir
  const [camadas, setCamadas] = useState<Camada[]>(inicial.current?.camadas ?? ['pontos']);
  const [selecao, setSelecao] = useState<Selecao>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  // Duas consultas: a camada principal nunca espera pelos alimentadores.
  const camadasBase = useMemo(() => camadas.filter(c => c !== 'alimentadores'), [camadas]);
  const q = useRedeNoMapa({ caixa, zoom, soRisco, camadas: camadasBase });
  const qAlim = useRedeNoMapa({ caixa: camadas.includes('alimentadores') ? caixa : null, zoom, soRisco, camadas: ['alimentadores'] });
  const r = useMemo(() => q.data
    ? { ...q.data, alimentadores: qAlim.data?.alimentadores ?? null }
    : undefined, [q.data, qAlim.data]);
  const carregando = q.isFetching || qAlim.isFetching;

  // ── vista → consulta ────────────────────────────────────────────────────────
  const onIdle = useCallback(() => {
    if (!mapa) return;
    const b = mapa.getBounds(); const z = Math.floor(mapa.getZoom() ?? 13);   // a RPC recebe INTEGER
    if (!b) return;
    const vista = caixaDe(b);
    const precisa = !caixa || z !== zoom || !contemCaixa(caixa, vista);
    setZoom(z);
    if (!precisa) { setPendente(null); return; }
    if (autoAtualizar || !caixa) { setCaixa(caixaDeConsulta(vista)); setPendente(null); }
    else setPendente(vista);
  }, [mapa, zoom, caixa, autoAtualizar]);

  const pesquisarAqui = () => {
    if (!pendente) return;
    setCaixa(caixaDeConsulta(pendente)); setPendente(null);
  };

  useEffect(() => {
    if (!mapa) return;
    const c = mapa.getCenter();
    guardarVista({ lat: c?.lat() ?? CENTRO_PADRAO.lat, lng: c?.lng() ?? CENTRO_PADRAO.lng, zoom, camadas, satelite, autoAtualizar });
  }, [mapa, zoom, caixa, camadas, satelite, autoAtualizar]);

  // ── WebGL ──────────────────────────────────────────────────────────────────
  const { fabricas, aplicar, pronto } = useDeck(mapa);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  useEffect(() => { setAtlas(desenharAtlas()); }, []);

  const aoPassar = useCallback((a: Alvo | null) => {
    if (!a) return setSobre(null);
    if (a.tipo === 'trafo') { const p = a.f.properties; setSobre(`Trafo ${p.codigo} · ${ROTULOS[p.risco]} · ${pct(p.ocupacao_pct)}`); }
    else if (a.tipo === 'celula') { const c = a.f.properties; setSobre(`${inteiro(c.trafos)} trafos · ${inteiro(c.trafos_risco)} em risco · ${inteiro(c.trafos_atencao)} em atenção · clique para aproximar`); }
    else if (a.tipo === 'alimentador') { const al = a.f.properties; setSobre(`Alimentador ${al.codigo} · ${ROTULOS[al.risco]} · ${pct(al.ocupacao_pct)}`); }
    else { const s = a.f.properties; setSobre(`SE ${s.nome ?? s.codigo} · ${inteiro(s.alimentadores)} alimentadores · ${inteiro(s.alimentadores_risco)} em risco`); }
  }, []);
  const aoClicar = useCallback((a: Alvo) => {
    if (a.tipo === 'trafo') setSelecao({ tipo: 'trafo', id: a.f.properties.id, props: a.f.properties });
    else if (a.tipo === 'celula') { const c = caixaDoPoligono(a.f.geometry); if (c) mapa?.fitBounds(limitesDe(c)); }
    else if (a.tipo === 'alimentador') setSelecao({ tipo: 'alimentador', id: a.f.properties.id, props: a.f.properties });
    else { const s = a.f.properties; mapa?.panTo({ lat: s.lat, lng: s.lng }); }
  }, [mapa]);

  const layers = useMemo(() => (fabricas && atlas)
    ? montarCamadas(fabricas, r, { satelite, zoom, camadas, selecao, atlas, aoPassar, aoClicar })
    : [], [fabricas, atlas, r, satelite, zoom, camadas, selecao, aoPassar, aoClicar]);
  useEffect(() => { if (pronto) aplicar(layers); }, [pronto, layers, aplicar]);
  useEffect(() => { mapa?.setOptions({ draggableCursor: sobre ? 'pointer' : 'grab' }); }, [mapa, sobre]);

  // ── navegação ──────────────────────────────────────────────────────────────
  const enquadrar = useCallback((c: Caixa) => { mapa?.fitBounds(limitesDe(c), 40); }, [mapa]);
  const centrar = useCallback((lng: number, lat: number) => {
    mapa?.panTo({ lat, lng });
    if ((mapa?.getZoom() ?? 0) < 16) mapa?.setZoom(16);
  }, [mapa]);

  const escolherDaBusca = (s: SugestaoRede) => {
    const i = s.item;
    if (s.tipo === 'alimentador') {
      setCamadas(c => c.includes('alimentadores') ? c : [...c, 'alimentadores']);
      if (i.oeste !== null && i.sul !== null && i.leste !== null && i.norte !== null) {
        enquadrar({ oeste: i.oeste, sul: i.sul, leste: i.leste, norte: i.norte });
      }
      setSelecao({ tipo: 'alimentador', id: i.id });
    } else if (s.tipo === 'trafo' && i.lng !== null && i.lat !== null) {
      // o detalhe vem por RPC própria: abre na hora, sem esperar a resposta do mapa
      setSelecao({ tipo: 'trafo', id: i.id });
      centrar(i.lng, i.lat);
    } else if (i.lng !== null && i.lat !== null) {
      setCamadas(c => c.includes('subestacoes') ? c : [...c, 'subestacoes']);
      mapa?.panTo({ lat: i.lat, lng: i.lng }); mapa?.setZoom(14);
    }
  };

  const opcoesMapa = useMemo<google.maps.MapOptions>(() => ({
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
    gestureHandling: 'greedy',
    zoomControlOptions: isLoaded ? { position: google.maps.ControlPosition.RIGHT_TOP } : undefined,
  }), [isLoaded]);

  const alternar = (c: Camada) => setCamadas(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]);
  const base = r?.base ?? {};
  const idade = base.data_base ? mesesDesde(base.data_base) : null;
  const denso = r?.camada === 'celula' && zoom >= 14 && camadas.includes('pontos');

  const chip: React.CSSProperties = { fontSize: 11, color: '#9A9AA8', padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' };
  const alternador = (ativo: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', border: 'none', cursor: 'pointer',
    fontSize: 11.5, fontWeight: ativo ? 700 : 500, fontFamily: 'inherit',
    background: ativo ? 'rgba(245,168,0,0.16)' : 'transparent', color: ativo ? GOLD : '#9A9AA8',
  });
  const grupo: React.CSSProperties = { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' };
  const flutuante: React.CSSProperties = { background: 'rgba(14,14,20,0.92)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, padding: '7px 10px', fontSize: 11.5 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 48px)', minHeight: 560 }}>
      {/* cabeçalho: título, procedência, filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ marginRight: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0 }}>Capacidade de rede em baixa tensão</h2>
          <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '2px 0 0' }}>Risco de inversão de fluxo no transformador MT/BT, onde a GD se conecta</p>
        </div>
        {base.distribuidora && <span style={chip}>{base.distribuidora}</span>}
        {base.data_base && (
          <button type="button" onClick={() => setSelecao({ tipo: 'fonte' })} title="Abrir a ficha da fonte"
                  style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 5, color: '#E3B341', cursor: 'pointer', fontFamily: 'inherit',
                           background: 'rgba(245,168,0,0.1)', border: '1px solid rgba(245,168,0,0.25)' }}>
            <Clock size={11} /> Base de {new Date(base.data_base).toLocaleDateString('pt-BR')}{idade !== null && ` · ${rotuloIdade(idade)}`}
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="Camadas" style={grupo}>
            <button type="button" aria-pressed={camadas.includes('pontos')} onClick={() => alternar('pontos')} style={alternador(camadas.includes('pontos'))}><Zap size={12} /> Trafos MT/BT</button>
            <button type="button" aria-pressed={camadas.includes('alimentadores')} onClick={() => alternar('alimentadores')} style={alternador(camadas.includes('alimentadores'))}><GitBranch size={12} /> Alimentadores MT</button>
            <button type="button" aria-pressed={camadas.includes('subestacoes')} onClick={() => alternar('subestacoes')} style={alternador(camadas.includes('subestacoes'))}><Factory size={12} /> Subestações</button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#C6C6D0', cursor: 'pointer' }}>
            <input type="checkbox" checked={soRisco} onChange={e => setSoRisco(e.target.checked)} style={{ width: 15, height: 15, accentColor: GOLD, cursor: 'pointer' }} />
            Só o que não está com folga
          </label>
          <div role="group" aria-label="Camada do mapa" style={grupo}>
            <button type="button" aria-pressed={satelite} onClick={() => setSatelite(true)} style={alternador(satelite)}><Satellite size={12} /> Satélite</button>
            <button type="button" aria-pressed={!satelite} onClick={() => setSatelite(false)} style={alternador(!satelite)}><MapIcon size={12} /> Mapa</button>
          </div>
          <button type="button" aria-pressed={selecao?.tipo === 'fonte'} onClick={() => setSelecao(s => s?.tipo === 'fonte' ? null : { tipo: 'fonte' })}
                  style={{ ...alternador(selecao?.tipo === 'fonte'), borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)' }}>
            <ShieldCheck size={12} /> Fonte dos dados
          </button>
        </div>
      </div>

      {q.isError && (
        <div style={{ ...card, color: '#FF7A6B', fontSize: 13, padding: '10px 14px' }}>
          Não consegui ler a base de rede.{' '}
          <button type="button" onClick={() => void q.refetch()} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>Tentar de novo</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        {/* mapa */}
        <div style={{ flex: '999 1 480px', minWidth: 0, minHeight: 420, position: 'relative', ...card, padding: 0, overflow: 'hidden' }}>
          {!isLoaded ? <Loading /> : (
            <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }}
              center={centroInicial} zoom={zoomInicial}
              onLoad={m => setMapa(m)} onUnmount={() => setMapa(null)} onIdle={onIdle}
              mapTypeId={satelite ? 'hybrid' : 'roadmap'}
              options={opcoesMapa} />
          )}
          {/* faixa de carregamento: fina, sem esconder o mapa */}
          {carregando && <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />}
          {/* busca, atualização e avisos flutuantes */}
          <div style={{ position: 'absolute', top: 12, left: 12, right: 60, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto', flex: '0 1 360px', minWidth: 220 }}><Busca mapa={mapa} aoEscolherRede={escolherDaBusca} /></div>
            <label style={{ ...flutuante, pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, color: '#C6C6D0', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoAtualizar} onChange={e => setAutoAtualizar(e.target.checked)} style={{ width: 14, height: 14, accentColor: GOLD, cursor: 'pointer' }} />
              Atualizar ao mover o mapa
            </label>
            {pendente && !autoAtualizar && (
              <button type="button" onClick={pesquisarAqui}
                      style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: '#0E0E14',
                               background: GOLD, border: 'none', borderRadius: 9, padding: '8px 13px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
                <Search size={14} /> Pesquisar nesta área
              </button>
            )}
            {denso && r && (
              <span style={{ ...flutuante, pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#E3B341', border: '1px solid rgba(245,168,0,0.3)' }}>
                <AlertTriangle size={13} /> Área densa: {inteiro(r.resumo.total)} trafos aqui, resumidos em células. Aproxime para vê-los um a um.
              </span>
            )}
          </div>
          {/* legenda e faixa do que está sob o mouse: fixa, não esconde o ponto */}
          <div style={{ position: 'absolute', left: 12, bottom: 12, right: 12, display: 'flex', gap: 10, alignItems: 'flex-end', justifyContent: 'space-between', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}>
              <Legenda regras={r?.regras} satelite={satelite} camada={r?.camada} alimentadores={camadas.includes('alimentadores')} subestacoes={camadas.includes('subestacoes')} />
            </div>
            <span role="status" aria-live="polite"
                  style={{ ...flutuante, color: sobre ? '#fff' : '#8A8A96', maxWidth: 420, textAlign: 'right' }}>
              {sobre ?? (r?.camada === 'celula' ? 'Clique numa célula para aproximar' : 'Passe o mouse sobre um trafo')}
            </span>
          </div>
          {r && r.resumo.total === 0 && !q.isFetching && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 12.5, color: '#D5D5DD', background: 'rgba(14,14,20,0.9)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px' }}>
                Nenhum ponto de rede nesta área — fora da concessão carregada (CPFL Paulista e Piratininga).
              </span>
            </div>
          )}
        </div>

        {/* painel lateral: o equivalente acessível */}
        <div style={{ flex: '1 1 320px', maxWidth: 380, minHeight: 420, ...card, padding: 14 }}>
          <PainelLateral resposta={r} carregando={carregando} selecao={selecao} aoSelecionar={setSelecao}
                         aoEnquadrar={enquadrar} aoCentrar={centrar} />
        </div>
      </div>
    </div>
  );
}
