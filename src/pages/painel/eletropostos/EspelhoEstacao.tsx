import { useEffect, useState } from 'react';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { card, GOLD } from '../ConsoleSections';
import { relativo } from './calculo';
import { h3, mudo, sub, vazio } from './estilo';
import { COR_STATUS } from './tipos';

/**
 * Estação ao vivo — espelho por FOTOS do que o worker está fazendo (pedido do
 * usuário em 16/10/2026). A estação sobrescreve uma foto "atual" da tela do
 * aparelho a cada passo e registra a linha do passo; em falha guarda a foto
 * daquele momento. Aqui: a foto atual (atualizada a cada 4 s enquanto um ciclo
 * roda) e a linha do tempo do ciclo, com miniatura nas falhas. Tudo privado,
 * só master (bucket eletropostos-espelho, RPC eletropostos_espelho).
 */
const BUCKET = 'eletropostos-espelho';
const ATIVO_MS = 3 * 60_000;   // sem passo novo há 3 min = ciclo parado

interface Passo {
  id: number; ciclo: string; ts: string; fonte: string | null; passo: string;
  situacao: 'info' | 'ok' | 'falha' | 'fim'; mensagem: string | null; foto: string | null;
}
interface Estacao {
  estacao_id: string; nome: string; vista_em: string | null; foto_atual: string;
  foto_atual_em: string | null; ultimo: Passo | null; passos: Passo[];
}

const COR = { info: '#888', ok: COR_STATUS.livre, falha: COR_STATUS.fora, fim: GOLD } as const;

function useEspelho() {
  const [ativo, setAtivo] = useState(false);
  const q = useQuery({
    queryKey: ['eletropostos', 'espelho'],
    queryFn: async (): Promise<Estacao[]> => {
      const { data, error } = await supabase.rpc('eletropostos_espelho' as never);
      if (error) throw error;
      return (data ?? []) as Estacao[];
    },
    refetchInterval: ativo ? 4_000 : 60_000,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const ult = q.data?.map(e => e.ultimo?.ts).filter(Boolean).sort().pop();
    setAtivo(!!ult && Date.now() - new Date(ult).getTime() < ATIVO_MS);
  }, [q.data]);
  return { ...q, ativo };
}

/** URL assinada (60 s) de uma foto do bucket; `versao` força recarregar a "atual". */
function useFoto(caminho: string | null, versao: string | null | undefined) {
  return useQuery({
    queryKey: ['eletropostos', 'espelho-foto', caminho, versao],
    enabled: !!caminho,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho!, 60);
      if (error) return null;   // ainda sem foto (estação nunca enviou): não é erro de tela
      return data.signedUrl;
    },
    staleTime: 50_000,
  });
}

function Miniatura({ caminho }: { caminho: string }) {
  const { data: url } = useFoto(caminho, caminho);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Abrir a foto do momento da falha">
      <img src={url} alt="Tela do aparelho no momento da falha" style={{ width: 54, height: 96, objectFit: 'cover', borderRadius: 6, border: '1px solid #333' }} />
    </a>
  );
}

function PainelEstacao({ e, ativo }: { e: Estacao; ativo: boolean }) {
  const { data: url } = useFoto(e.foto_atual, e.foto_atual_em);
  const { isMobile } = useWindowSize();
  const agora = Date.now();
  const passos = [...e.passos].reverse();   // mais recente primeiro
  const falhas = e.passos.filter(p => p.situacao === 'falha').length;
  return (
    <div style={{ ...card, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(180px, 240px) 1fr', gap: 16, alignItems: 'start' }}>
      <div style={isMobile ? { width: 'min(240px, 70%)', margin: '0 auto' } : undefined}>
        <div style={{ position: 'relative', background: '#0E0E14', borderRadius: 12, overflow: 'hidden', border: '1px solid #222', aspectRatio: '9 / 16' }}>
          {url
            ? <img src={url} alt="Tela atual do aparelho da estação" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            : <div style={{ ...vazio, border: 'none', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sem foto ainda</div>}
          <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            background: ativo ? COR_STATUS.livre : '#333', color: ativo ? '#0E0E14' : '#bbb' }}>{ativo ? '● ao vivo' : 'parado'}</span>
        </div>
        <p style={{ ...mudo, fontSize: 11, margin: '6px 0 0' }}>Foto {relativo(e.foto_atual_em, agora)} · batida {relativo(e.vista_em, agora)}</p>
      </div>
      <div style={{ minWidth: 0 }}>
        <b style={{ color: '#fff', fontSize: 13 }}>{e.nome}</b>
        {e.ultimo && (
          <p style={{ margin: '4px 0 10px', fontSize: 13, color: '#ddd' }}>
            <span style={{ color: COR[e.ultimo.situacao] }}>●</span> {e.ultimo.fonte ? `${e.ultimo.fonte} · ` : ''}{e.ultimo.passo}
            {e.ultimo.mensagem && <span style={mudo}> — {e.ultimo.mensagem}</span>}
          </p>
        )}
        <p style={{ ...mudo, fontSize: 11, margin: '0 0 6px' }}>Ciclo {e.ultimo?.ciclo ?? '—'} · {e.passos.length} passos · {falhas} falha(s)</p>
        <div style={{ maxHeight: 340, overflow: 'auto', borderTop: '1px solid #1a1a22' }}>
          {passos.map(p => (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a1a22', fontSize: 12 }}>
              <span style={mudo}>{new Date(p.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span style={{ color: '#ddd', minWidth: 0 }}>
                <span style={{ color: COR[p.situacao] }}>●</span> {p.fonte ? <b>{p.fonte}</b> : null} {p.passo}
                {p.mensagem && <span style={{ ...mudo, display: 'block', fontSize: 11 }}>{p.mensagem}</span>}
              </span>
              {p.foto ? <Miniatura caminho={p.foto} /> : <span />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EspelhoEstacao() {
  const { data, isLoading, ativo } = useEspelho();
  return (
    <div>
      <h3 style={{ ...h3, marginTop: 24 }}>Estação ao vivo</h3>
      <p style={sub}>
        O que o robô está vendo e fazendo no aparelho: a foto da tela é atualizada a cada passo (a cada 4 s aqui enquanto um ciclo roda) e cada falha guarda a foto do momento.
        As fotos ficam 3 dias e só o master vê.
      </p>
      {isLoading ? <div style={vazio}>Carregando…</div>
        : !data?.length ? <div style={vazio}>A estação ainda não enviou nenhum passo para o espelho.</div>
        : data.map(e => <PainelEstacao key={e.estacao_id} e={e} ativo={ativo} />)}
    </div>
  );
}
