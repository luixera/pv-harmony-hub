import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { AlertTriangle, Clock, Satellite, Map as MapIcon, Zap, GitBranch, Factory } from 'lucide-react';
import { card, GOLD, Loading } from './ConsoleSections';
// arquivo renomeado: 'Busca.tsx' colidia com 'busca.ts' em sistema de
// arquivos sem distincao de caixa (Windows), e o import resolvia para o util
import { Busca } from './rede/BarraDeBusca';
import { Legenda } from './rede/Legenda';
import { PainelLateral } from './rede/PainelLateral';
import { useRedeNoMapa } from './rede/consultas';
import { useCamadaVetorial, type Alvo } from './rede/useCamadaVetorial';
import { estiloAlimentador, estiloCelula, estiloContornoAlimentador, estiloPonto, estiloSubestacao, ROTULOS } from './rede/estilos';
import { inteiro, mesesDesde, pct, rotuloIdade } from './rede/formato';
import { caixaDeConsulta, contemCaixa, type Caixa } from './rede/zoom';
import type { Camada, PropsAlimentador, PropsCelula, PropsPonto, PropsSubestacao, Risco, Selecao } from './rede/tipos';
import type { SugestaoRede } from './rede/busca';

/**
 * Capacidade de rede e risco de inversão de fluxo — 2ª entrega (spec §11).
 *
 * O dado é a BDGD da ANEEL, pública e anual. NÃO cruza com projetos do GD
 * Manager e NÃO é parecer de acesso. O servidor decide a camada pelo zoom e
 * devolve GeoJSON pronto; aqui cada tipo de feição é UMA `google.maps.Data`
 * (ver useCamadaVetorial — era a recriação de 1.500 <Marker> que travava).
 *
 * A vista só volta ao servidor quando sai da caixa já carregada (20% maior
 * que a tela) ou quando o zoom muda. A lista lateral é o equivalente
 * acessível do mapa.
 */
const LIBRARIES: ('places')[] = ['places'];   // as outras telas usam as mesmas; opções diferentes quebram o loader
const CENTRO_PADRAO = { lat: -22.9056, lng: -47.0616 };
const CHAVE_VISTA = 'painel.rede.vista';

interface Vista { lat: number; lng: number; zoom: number; camadas: Camada[]; satelite: boolean }
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

export function NetworkSection() {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script', libraries: LIBRARIES,
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? '',
  });
  const inicial = useRef(lerVista());
  // `center` e `options` têm de ser estáveis: a biblioteca compara por
  // identidade e chama setCenter/setOptions a cada mudança — um objeto novo
  // por render devolveria o mapa ao centro inicial em todo clique.
  const centroInicial = useRef(inicial.current ? { lat: inicial.current.lat, lng: inicial.current.lng } : CENTRO_PADRAO).current;
  // o zoom só entra como valor inicial: depois quem manda é o mapa, e o estado
  // `zoom` (inteiro) serve às consultas e aos estilos — não volta para o mapa
  const zoomInicial = useRef(inicial.current?.zoom ?? 13).current;
  const [mapa, setMapa] = useState<google.maps.Map | null>(null);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [zoom, setZoom] = useState(inicial.current?.zoom ?? 13);
  const [soRisco, setSoRisco] = useState(false);
  const [satelite, setSatelite] = useState(inicial.current?.satelite ?? true);
  const [camadas, setCamadas] = useState<Camada[]>(inicial.current?.camadas ?? ['pontos', 'alimentadores']);
  const [selecao, setSelecao] = useState<Selecao>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  // trafo escolhido na busca: o detalhe abre quando a resposta com ele chegar
  const pendente = useRef<number | null>(null);

  // Duas consultas, não uma: a camada principal (pontos/células, resumo) volta
  // em dezenas de ms e nunca espera os alimentadores, que custam mais e são
  // secundários. As duas chegam em paralelo; o mapa monta o que chegou.
  const camadasBase = useMemo(() => camadas.filter(c => c !== 'alimentadores'), [camadas]);
  const q = useRedeNoMapa({ caixa, zoom, soRisco, camadas: camadasBase });
  const qAlim = useRedeNoMapa({ caixa: camadas.includes('alimentadores') ? caixa : null, zoom, soRisco, camadas: ['alimentadores'] });
  const r = useMemo(() => q.data
    ? { ...q.data, alimentadores: qAlim.data?.alimentadores ?? null }
    : undefined, [q.data, qAlim.data]);
  const carregando = q.isFetching || qAlim.isFetching;

  // ── vista → consulta: só quando sai da caixa carregada ou o zoom muda ──────
  const onIdle = useCallback(() => {
    if (!mapa) return;
    // zoom fracionário (roda do mouse) vira inteiro: a RPC recebe INTEGER e o
    // nível de célula é por degrau
    const b = mapa.getBounds(); const z = Math.floor(mapa.getZoom() ?? 13);
    if (!b) return;
    const vista = caixaDe(b);
    setZoom(z);
    setCaixa(atual => (atual && z === zoom && contemCaixa(atual, vista)) ? atual : caixaDeConsulta(vista));
  }, [mapa, zoom]);

  useEffect(() => {
    if (!mapa) return;
    const c = mapa.getCenter();
    guardarVista({ lat: c?.lat() ?? CENTRO_PADRAO.lat, lng: c?.lng() ?? CENTRO_PADRAO.lng, zoom, camadas, satelite });
  }, [mapa, zoom, caixa, camadas, satelite]);

  // ── estilos memoizados: um setStyle por mudança, não por render ────────────
  const estPonto = useMemo(() => (p: Record<string, unknown>) => estiloPonto(p.risco as Risco, satelite), [satelite]);
  const estCelula = useMemo(() => (p: Record<string, unknown>) => estiloCelula(p.risco as Risco, Number(p.nivel), satelite), [satelite]);
  const estAlim = useMemo(() => (p: Record<string, unknown>) => estiloAlimentador(p.risco as Risco, zoom, satelite), [zoom, satelite]);
  const estContorno = useMemo(() => () => estiloContornoAlimentador(zoom), [zoom]);
  const estSub = useMemo(() => () => estiloSubestacao(satelite), [satelite]);

  const sobrePonto = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const p = a.props as unknown as PropsPonto;
    setSobre(`Trafo ${p.codigo} · ${ROTULOS[p.risco]} · ${pct(p.ocupacao_pct)}`);
  };
  const sobreCelula = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const c = a.props as unknown as PropsCelula;
    setSobre(`${inteiro(c.trafos)} trafos · ${inteiro(c.trafos_risco)} em risco · clique para aproximar`);
  };
  const sobreAlim = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const al = a.props as unknown as PropsAlimentador;
    setSobre(`Alimentador ${al.codigo} · ${ROTULOS[al.risco]} · ${pct(al.ocupacao_pct)}`);
  };
  const sobreSub = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const s = a.props as unknown as PropsSubestacao;
    setSobre(`SE ${s.nome ?? s.codigo} · ${inteiro(s.alimentadores)} alimentadores · ${inteiro(s.alimentadores_risco)} em risco`);
  };

  const pontosRef = useCamadaVetorial({
    mapa, colecao: r?.pontos, visivel: camadas.includes('pontos'), estilo: estPonto, aoPassar: sobrePonto,
    aoClicar: a => setSelecao({ tipo: 'trafo', props: a.props as unknown as PropsPonto }),
  });
  useCamadaVetorial({
    mapa, colecao: r?.celulas, visivel: camadas.includes('pontos'), estilo: estCelula, aoPassar: sobreCelula,
    aoClicar: a => { const c = a.props as unknown as PropsCelula; mapa?.fitBounds(limitesDe(c)); },
  });
  // contorno escuro por baixo das linhas: só sobre imagem, onde a cor sozinha some
  useCamadaVetorial({ mapa, colecao: r?.alimentadores, visivel: camadas.includes('alimentadores') && satelite, estilo: estContorno });
  const alimRef = useCamadaVetorial({
    mapa, colecao: r?.alimentadores, visivel: camadas.includes('alimentadores'), estilo: estAlim, aoPassar: sobreAlim,
    aoClicar: a => setSelecao({ tipo: 'alimentador', id: a.id, props: a.props as unknown as PropsAlimentador }),
  });
  useCamadaVetorial({ mapa, colecao: r?.subestacoes, visivel: camadas.includes('subestacoes'), estilo: estSub, aoPassar: sobreSub });

  // ── destaque da seleção: overrideStyle, sem recriar camada ─────────────────
  useEffect(() => {
    pontosRef.current?.revertStyle(); alimRef.current?.revertStyle();
    if (selecao?.tipo === 'trafo') {
      const f = pontosRef.current?.getFeatureById(selecao.props.id);
      if (f) pontosRef.current?.overrideStyle(f, estiloPonto(selecao.props.risco, satelite, true));
    } else if (selecao?.tipo === 'alimentador') {
      const f = alimRef.current?.getFeatureById(selecao.id);
      const risco = (selecao.props?.risco ?? (f?.getProperty('risco') as Risco | undefined)) ?? 'sem_dado';
      if (f) alimRef.current?.overrideStyle(f, estiloAlimentador(risco, zoom, satelite, true));
    }
  }, [selecao, satelite, zoom, r, pontosRef, alimRef]);

  useEffect(() => {
    if (pendente.current === null || !r?.pontos) return;
    const f = r.pontos.features.find(x => x.id === pendente.current);
    if (f) { setSelecao({ tipo: 'trafo', props: f.properties }); pendente.current = null; }
  }, [r]);

  const enquadrar = (c: Caixa) => mapa?.fitBounds(limitesDe(c), 40);
  const centrar = (lng: number, lat: number) => {
    mapa?.panTo({ lat, lng });
    if ((mapa?.getZoom() ?? 0) < 16) mapa?.setZoom(16);
  };

  const escolherDaBusca = (s: SugestaoRede) => {
    const i = s.item;
    if (s.tipo === 'alimentador') {
      setCamadas(c => c.includes('alimentadores') ? c : [...c, 'alimentadores']);
      if (i.oeste !== null && i.sul !== null && i.leste !== null && i.norte !== null) {
        enquadrar({ oeste: i.oeste, sul: i.sul, leste: i.leste, norte: i.norte });
      }
      setSelecao({ tipo: 'alimentador', id: i.id });
    } else if (s.tipo === 'trafo' && i.lng !== null && i.lat !== null) {
      pendente.current = i.id;
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

  const chip: React.CSSProperties = { fontSize: 11, color: '#9A9AA8', padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' };
  const alternador = (ativo: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', border: 'none', cursor: 'pointer',
    fontSize: 11.5, fontWeight: ativo ? 700 : 500, fontFamily: 'inherit',
    background: ativo ? 'rgba(245,168,0,0.16)' : 'transparent', color: ativo ? GOLD : '#9A9AA8',
  });
  const grupo: React.CSSProperties = { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 48px)', minHeight: 560 }}>
      {/* cabeçalho: título, procedência, filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0, marginRight: 6 }}>Capacidade de rede e inversão de fluxo</h2>
        {base.distribuidora && <span style={chip}>{base.distribuidora}</span>}
        {base.data_base && (
          <span style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 5, color: '#E3B341',
                         background: 'rgba(245,168,0,0.1)', border: '1px solid rgba(245,168,0,0.25)' }}>
            <Clock size={11} /> Base de {new Date(base.data_base).toLocaleDateString('pt-BR')}{idade !== null && ` · ${rotuloIdade(idade)}`}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="Camadas" style={grupo}>
            <button type="button" aria-pressed={camadas.includes('pontos')} onClick={() => alternar('pontos')} style={alternador(camadas.includes('pontos'))}><Zap size={12} /> Transformadores</button>
            <button type="button" aria-pressed={camadas.includes('alimentadores')} onClick={() => alternar('alimentadores')} style={alternador(camadas.includes('alimentadores'))}><GitBranch size={12} /> Alimentadores</button>
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
          {/* busca flutuante */}
          <div style={{ position: 'absolute', top: 12, left: 12, right: 60, display: 'flex', gap: 8, flexWrap: 'wrap', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto', flex: '0 1 360px', minWidth: 220 }}><Busca mapa={mapa} aoEscolherRede={escolherDaBusca} /></div>
            {r?.excedeu && (
              <span style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#E3B341',
                             background: 'rgba(14,14,20,0.92)', border: '1px solid rgba(245,168,0,0.3)', borderRadius: 9, padding: '7px 10px' }}>
                <AlertTriangle size={13} /> {inteiro(r.resumo.total)} trafos aqui — mostrando os {inteiro(r.teto)} mais ocupados. Aproxime para ver todos.
              </span>
            )}
          </div>
          {/* legenda e faixa do que está sob o mouse: fixa, não esconde o ponto */}
          <div style={{ position: 'absolute', left: 12, bottom: 12, right: 12, display: 'flex', gap: 10, alignItems: 'flex-end', justifyContent: 'space-between', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}>
              <Legenda regras={r?.regras} satelite={satelite} alimentadores={camadas.includes('alimentadores')} subestacoes={camadas.includes('subestacoes')} />
            </div>
            <span role="status" aria-live="polite"
                  style={{ fontSize: 11.5, color: sobre ? '#fff' : '#8A8A96', background: 'rgba(14,14,20,0.9)', border: '1px solid rgba(255,255,255,0.1)',
                           borderRadius: 8, padding: '6px 10px', maxWidth: 420, textAlign: 'right' }}>
              {sobre ?? (r?.camada === 'celula' ? 'Clique numa célula para aproximar' : 'Passe o mouse sobre um ponto')}
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
