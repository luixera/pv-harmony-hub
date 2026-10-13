import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GoogleMap, useJsApiLoader, Marker, Rectangle } from '@react-google-maps/api';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Clock, Satellite, Map } from 'lucide-react';
import { card, GOLD, Loading, SectionTitle } from './ConsoleSections';

/**
 * Capacidade de rede e risco de inversão de fluxo.
 *
 * O dado é a BDGD da ANEEL, pública e anual. Isto NÃO cruza com projetos do
 * GD Manager (decisão de escopo de 10/10/2026) e NÃO é parecer de acesso:
 * só a distribuidora emite parecer, com estudo por ponto de conexão.
 *
 * Zoom < 12 lê células agregadas; daí para cima, trafos reais. Quem decide é
 * a RPC `rede_no_mapa`, não a tela — a tela só manda a caixa e o zoom.
 *
 * Cor nunca sozinha: cada estado tem forma própria (o validador de paleta
 * reprovou verde×âmbar em protanopia com ΔE 3,5; com estas cores dá 12,6).
 * E a lista lateral é o equivalente acessível do mapa, não enfeite — mil
 * marcadores não se navegam por teclado.
 */

const CORES: Record<string, string> = {
  folga: '#1F7A3D', atencao: '#F5A800', risco: '#F0523F', sem_dado: '#8A8A96',
};
const ROTULOS: Record<string, string> = {
  folga: 'Sem risco aparente', atencao: 'Atenção', risco: 'Risco', sem_dado: 'Sem dado',
};
const CENTRO_PADRAO = { lat: -22.9056, lng: -47.0616 };

interface Ponto {
  id: number; codigo: string; risco: string; lng: number; lat: number;
  potencia_nominal_kva: number | null; carga_min_diurna_kw: number | null;
  gd_conectada_kw: number | null; margem_kw: number | null;
  ocupacao_pct: number | null; alimentador: string | null; subestacao: string | null;
}
interface Celula {
  id: number; risco: string; trafos: number; trafos_risco: number; trafos_atencao: number;
  oeste: number; sul: number; leste: number; norte: number;
}
interface Base {
  distribuidora?: string; sigla?: string; data_base?: string | null; importado_em?: string | null;
}
interface Resposta {
  camada: 'celula' | 'ponto';
  base: Base;
  itens: (Ponto | Celula)[];
  total: number;
  excedeu: boolean;
}

/**
 * Marcador por estado: **forma** distinta, não só cor.
 *
 * As cores são as validadas contra daltonismo (verde×âmbar dá ΔE 12,6 em
 * protanopia) e NÃO mudam entre as camadas. O que muda é o miolo e o contorno.
 *
 * POR QUE AS DUAS VERSÕES: no desenho original, "atenção" e "sem dado" eram
 * anéis **vazados** (`fillColor: 'transparent'`) — ótimo sobre o fundo escuro
 * liso do console, e quase invisível sobre foto de satélite, onde o interior
 * mostra o telhado. Sobre imagem, todo marcador ganha miolo opaco e contorno
 * escuro; é o contorno que separa a marca da foto, clara ou escura.
 *
 * E "sem dado" deixou de ser anel fino para ser QUADRADO: distinguir anel
 * grosso de anel fino só pela espessura já era frágil, e sobre imagem não
 * sobrevive. Quadrado cinza não se confunde com nenhum círculo.
 *
 * LIMITE MEDIDO, e não escondido (13/10/2026). Contra os tons típicos de
 * imagem, o contorno escuro `#07070B` dá 15,9:1 em telhado claro e 9,8:1 em
 * concreto, mas só 2,1:1 em vegetação e 1,4:1 em asfalto. Considerando que a
 * marca se lê quando o contorno **ou** o preenchimento separa do fundo, sobram
 * **4 combinações fracas em 24**: folga, risco e sem-dado sobre vegetação, e
 * folga sobre asfalto — todas marca escura sobre fundo escuro. Contorno branco
 * foi testado e é pior (7 em 24: falha em telhado e concreto).
 *
 * O que sustenta a leitura nesses quatro casos: a FORMA (que não depende de
 * contraste), o marcador maior no satélite, e sobretudo a LISTA LATERAL, que é
 * o equivalente acessível e não depende do mapa. Se na prática incomodar, o
 * próximo passo é um halo de duas cores — dois marcadores por ponto, o que o
 * teto de 1500 feições da RPC torna viável (3000 marcadores).
 */
function iconeDe(risco: string, satelite: boolean): google.maps.Symbol {
  const cor = CORES[risco] ?? CORES.sem_dado;
  // Sobre imagem, o contorno escuro é o que garante a leitura; sobre o mapa
  // liso, um fio claro basta e fica mais leve.
  const contorno = satelite ? '#07070B' : 'rgba(255,255,255,0.45)';
  const peso = satelite ? 2.2 : 1.6;
  // Miolo dos vazados: opaco sobre imagem, transparente sobre o mapa liso.
  const miolo = satelite ? '#0E0E14' : 'transparent';
  const opacidadeMiolo = satelite ? 0.92 : 0;
  // Maior sobre imagem: área não compensa contraste, mas um alvo maior é mais
  // fácil de achar e de clicar num fundo cheio de textura.
  const s = satelite ? 1.25 : 1;

  if (risco === 'risco') {
    return { path: 'M 0 -8 L 7 6 L -7 6 Z', fillColor: cor, fillOpacity: 1,
             strokeColor: satelite ? '#07070B' : '#0E0E14',
             strokeWeight: satelite ? 2 : 1.5, scale: s };
  }
  if (risco === 'atencao') {
    return { path: google.maps.SymbolPath.CIRCLE, fillColor: miolo,
             fillOpacity: opacidadeMiolo, strokeColor: cor,
             strokeWeight: 4, scale: 6 * s };
  }
  if (risco === 'sem_dado') {
    return { path: 'M -5.5 -5.5 L 5.5 -5.5 L 5.5 5.5 L -5.5 5.5 Z',
             fillColor: satelite ? cor : miolo,
             fillOpacity: satelite ? 0.85 : opacidadeMiolo,
             strokeColor: satelite ? '#07070B' : cor,
             strokeWeight: 2, scale: s };
  }
  return { path: google.maps.SymbolPath.CIRCLE, fillColor: cor, fillOpacity: 1,
           strokeColor: contorno, strokeWeight: peso, scale: 6 * s };
}

const mesesDesde = (iso: string) => {
  const d = new Date(iso);
  const meses = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
  return Math.max(0, Math.round(meses));
};

export function NetworkSection() {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? '',
  });

  const mapaRef = useRef<google.maps.Map | null>(null);
  const [caixa, setCaixa] = useState({ oeste: -47.12, sul: -23.0, leste: -46.96, norte: -22.84 });
  const [zoom, setZoom] = useState(14);
  const [soRisco, setSoRisco] = useState(false);
  const [aberto, setAberto] = useState<Ponto | null>(null);
  // Satélite por padrão: o que se quer ver aqui é o contexto físico do ponto —
  // galpão, loteamento, área rural. `hybrid` e não `satellite` porque sem os
  // rótulos de via não se sabe onde se está.
  const [satelite, setSatelite] = useState(true);

  const q = useQuery({
    // A caixa entra na chave arredondada a 2 casas: arrastar meia rua não
    // invalida o cache, e `onIdle` só dispara quando o mapa para de se mover.
    queryKey: ['rede-no-mapa', caixa.oeste.toFixed(2), caixa.sul.toFixed(2),
               caixa.leste.toFixed(2), caixa.norte.toFixed(2), zoom, soRisco],
    queryFn: async (): Promise<Resposta> => {
      const { data, error } = await supabase.rpc('rede_no_mapa' as never, {
        p_oeste: caixa.oeste, p_sul: caixa.sul, p_leste: caixa.leste,
        p_norte: caixa.norte, p_zoom: zoom, p_so_risco: soRisco,
      } as never);
      if (error) throw error;
      return data as Resposta;
    },
    staleTime: 60_000,
    placeholderData: anterior => anterior,   // o mapa não pisca ao arrastar
  });

  // Guardamos a instância do mapa em vez de confiar no `this` do listener:
  // o `onIdle` do @react-google-maps/api não recebe argumento.
  const onLoad = useCallback((mapa: google.maps.Map) => { mapaRef.current = mapa; }, []);
  const onUnmount = useCallback(() => { mapaRef.current = null; }, []);

  const onIdle = useCallback(() => {
    const b = mapaRef.current?.getBounds();
    if (!b) return;
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    setCaixa({ oeste: sw.lng(), sul: sw.lat(), leste: ne.lng(), norte: ne.lat() });
    setZoom(mapaRef.current?.getZoom() ?? 14);
  }, []);

  const pontos = useMemo(
    () => (q.data?.camada === 'ponto' ? (q.data.itens as Ponto[]) : []),
    [q.data],
  );
  const celulas = useMemo(
    () => (q.data?.camada === 'celula' ? (q.data.itens as Celula[]) : []),
    [q.data],
  );

  const base = q.data?.base ?? {};
  const idade = base.data_base ? mesesDesde(base.data_base) : null;

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <SectionTitle>Capacidade de rede e inversão de fluxo</SectionTitle>

      {/* procedência e idade do dado: a spec adotou a opção B (defasagem não
          descontada), então a idade precisa ficar à vista — é ela que segura
          a leitura otimista do semáforo */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {base.distribuidora && (
          <span style={{ fontSize: 11, color: '#9A9AA8', padding: '3px 9px', borderRadius: 20,
                         background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {base.distribuidora}
          </span>
        )}
        {base.data_base && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
                         color: '#E3B341', padding: '3px 9px', borderRadius: 20,
                         background: 'rgba(245,168,0,0.1)', border: '1px solid rgba(245,168,0,0.25)' }}>
            <Clock size={11} />
            Base de {new Date(base.data_base).toLocaleDateString('pt-BR')}
            {idade !== null && ` · ${idade} ${idade === 1 ? 'mês' : 'meses'} atrás`}
          </span>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12,
                        color: '#C6C6D0', cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={soRisco} onChange={e => setSoRisco(e.target.checked)}
                 style={{ width: 15, height: 15, accentColor: GOLD, cursor: 'pointer' }} />
          Só o que não está com folga
        </label>

        {/* camada base: satélite (com rótulos de via) ou mapa liso */}
        <div role="group" aria-label="Camada do mapa"
             style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
                      border: '1px solid rgba(255,255,255,0.12)' }}>
          {([['Satélite', true], ['Mapa', false]] as const).map(([rotulo, valor]) => (
            <button key={rotulo} type="button" onClick={() => setSatelite(valor)}
                    aria-pressed={satelite === valor}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
                             padding: '5px 11px', border: 'none', cursor: 'pointer',
                             fontSize: 11.5, fontWeight: satelite === valor ? 700 : 500,
                             fontFamily: 'inherit',
                             background: satelite === valor ? 'rgba(245,168,0,0.16)' : 'transparent',
                             color: satelite === valor ? GOLD : '#9A9AA8' }}>
              {valor ? <Satellite size={12} /> : <Map size={12} />} {rotulo}
            </button>
          ))}
        </div>
      </div>

      {q.isError && (
        <div style={{ ...card, color: '#FF7A6B', fontSize: 13, marginBottom: 12 }}>
          Não consegui ler a base de rede.{' '}
          <button type="button" onClick={() => void q.refetch()}
                  style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer',
                           fontSize: 13, padding: 0, textDecoration: 'underline' }}>
            Tentar de novo
          </button>
        </div>
      )}

      {!q.isError && q.data && q.data.total === 0 && (
        <div style={{ ...card, color: '#777', fontSize: 13, marginBottom: 12 }}>
          Nenhum ponto de rede nesta área. Se a base nunca foi importada, não há o que mostrar ainda.
        </div>
      )}

      {q.data?.excedeu && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                      color: '#E3B341', fontSize: 12.5 }}>
          <AlertTriangle size={14} />
          {q.data.total.toLocaleString('pt-BR')} pontos nesta vista — aproxime para ver cada um.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
        <div style={{ flex: '999 1 420px', minWidth: 0, ...card, padding: 0, overflow: 'hidden', minHeight: 460 }}>
          {!isLoaded ? <Loading /> : (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: 460 }}
              center={CENTRO_PADRAO}
              zoom={14}
              onLoad={onLoad}
              onUnmount={onUnmount}
              onIdle={onIdle}
              // `mapTypeId` controlado por nós, com o controle nativo desligado:
              // o seletor fica no cabeçalho da seção, no estilo do console.
              mapTypeId={satelite ? 'hybrid' : 'roadmap'}
              options={{ mapTypeControl: false, streetViewControl: false, fullscreenControl: false }}
            >
              {pontos.map(p => (
                <Marker key={p.id} position={{ lat: p.lat, lng: p.lng }}
                        icon={iconeDe(p.risco, satelite)} title={`${p.codigo} · ${ROTULOS[p.risco]}`}
                        onClick={() => setAberto(p)} />
              ))}
              {celulas.map(c => (
                <Rectangle key={c.id}
                  bounds={{ west: c.oeste, south: c.sul, east: c.leste, north: c.norte }}
                  // Sobre imagem a célula precisa de borda forte e miolo mais
                  // fraco: 0,3 de cor saturada sobre foto fica barro, e some.
                  options={satelite
                    ? { fillColor: CORES[c.risco], fillOpacity: 0.22,
                        strokeColor: CORES[c.risco], strokeOpacity: 1, strokeWeight: 2.5 }
                    : { fillColor: CORES[c.risco], fillOpacity: 0.3,
                        strokeColor: CORES[c.risco], strokeOpacity: 0.6, strokeWeight: 1 }} />
              ))}
            </GoogleMap>
          )}
        </div>

        {/* a lista é o equivalente acessível do mapa */}
        <div style={{ flex: '1 1 320px', maxWidth: 380, ...card, display: 'flex',
                      flexDirection: 'column', gap: 10, minHeight: 460 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase',
                      letterSpacing: '0.07em', margin: 0 }}>
            {q.data?.camada === 'ponto' ? 'Transformadores nesta vista' : 'Aproxime para listar os transformadores'}
          </p>

          {aberto ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: '#fff', margin: 0 }}>{aberto.codigo}</h3>
                <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
                  {aberto.alimentador ?? 'alimentador não informado'}
                  {aberto.subestacao ? ` · ${aberto.subestacao}` : ''}
                </p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                             fontSize: 11.5, fontWeight: 600, color: '#ddd', padding: '4px 9px',
                             borderRadius: 20, background: `${CORES[aberto.risco]}2E`,
                             border: `1px solid ${CORES[aberto.risco]}80` }}>
                <AlertTriangle size={11} style={{ color: CORES[aberto.risco] }} />
                {ROTULOS[aberto.risco]}
              </span>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '7px 10px',
                           margin: 0, fontSize: 12 }}>
                <dt style={{ color: '#9A9AA8' }}>Potência nominal</dt>
                <dd style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
                  {aberto.potencia_nominal_kva ?? '—'} kVA</dd>
                <dt style={{ color: '#9A9AA8' }}>Carga mínima diurna estimada</dt>
                <dd style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
                  {aberto.carga_min_diurna_kw ?? '—'} kW</dd>
                <dt style={{ color: '#9A9AA8' }}>GD já conectada</dt>
                <dd style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
                  {aberto.gd_conectada_kw ?? '—'} kW</dd>
                <dt style={{ color: '#D5D5DD', fontWeight: 600 }}>Margem até a inversão</dt>
                <dd style={{ margin: 0, fontWeight: 800, color: CORES[aberto.risco] }}>
                  {aberto.margem_kw ?? '—'} kW</dd>
              </dl>
              <button type="button" onClick={() => setAberto(null)}
                      style={{ alignSelf: 'flex-start', background: 'none', border: 'none',
                               color: GOLD, cursor: 'pointer', fontSize: 12, padding: 0,
                               textDecoration: 'underline' }}>
                Voltar à lista
              </button>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex',
                         flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 400 }}>
              {pontos.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => setAberto(p)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                                   padding: '9px 10px', background: 'none', border: 'none',
                                   borderRadius: 7, cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0,
                                   background: CORES[p.risco] }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#ddd' }}>{p.codigo}</span>
                    <span style={{ fontSize: 11, color: '#8A8A96', whiteSpace: 'nowrap' }}>
                      {p.ocupacao_pct !== null ? `${p.ocupacao_pct}%` : 'sem dado'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 'auto', padding: '11px 12px', borderRadius: 9,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ fontSize: 11.5, color: '#9A9AA8', margin: 0, lineHeight: 1.55 }}>
              <strong style={{ color: '#D5D5DD' }}>Indicativo, não é parecer.</strong>{' '}
              A carga mínima é estimada da curva das unidades consumidoras. Só a distribuidora
              emite o parecer de acesso, com estudo por ponto de conexão.
            </p>
          </div>
        </div>
      </div>

      {/* legenda: cor + forma */}
      <div style={{ ...card, marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase',
                       letterSpacing: '0.07em' }}>Risco de inversão de fluxo</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: CORES.folga,
                         border: `1.6px solid ${satelite ? '#07070B' : 'rgba(255,255,255,0.45)'}`,
                         boxSizing: 'border-box' }} />
          Sem risco aparente
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 13, height: 13, borderRadius: 7, border: `4px solid ${CORES.atencao}`,
                         background: satelite ? '#0E0E14' : 'transparent', boxSizing: 'border-box' }} />
          Atenção
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 0, height: 0, borderLeft: '7px solid transparent',
                         borderRight: '7px solid transparent', borderBottom: `12px solid ${CORES.risco}` }} />
          Risco
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          {/* quadrado, e não anel fino: sobre satélite a diferença de espessura
              entre dois anéis não se lê */}
          <span style={{ width: 12, height: 12, background: satelite ? CORES.sem_dado : 'transparent',
                         border: `2px solid ${CORES.sem_dado}`, boxSizing: 'border-box' }} />
          Sem dado
        </span>
      </div>
    </div>
  );
}
