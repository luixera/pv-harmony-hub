import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { card, GOLD, Loading } from '../ConsoleSections';
import { botao, botaoOuro, h3, input, mudo, rotulo, sub } from './estilo';
import type { Local } from './tipos';

/**
 * Periodicidade e cidades da coleta — pedido do usuário em 16/10/2026.
 *
 * Faixas de POTÊNCIA de carregamento → intervalo de leitura: a estação escolhe
 * a faixa pela maior potência do carregador e arredonda o intervalo a múltiplos
 * do ciclo de 8 min (a Tupi, na VPS, segue em 5 min pela API). Cidades: só os
 * locais de cidade marcada são lidos; local sem cadastro continua lido.
 * Dado das RPCs `eletropostos_coleta_config` / `_salvar`.
 */
interface Faixa { ate_kw: number | null; intervalo_min: number }
interface Config { faixas: Faixa[]; cidades: string[]; fora: { fonte: string; local_fonte: string }[]; atualizado_em?: string }

function useConfig() {
  return useQuery({
    queryKey: ['eletropostos', 'coleta-config'],
    queryFn: async (): Promise<Config> => {
      const { data, error } = await supabase.rpc('eletropostos_coleta_config' as never);
      if (error) throw error;
      return data as Config;
    },
    staleTime: 60_000,
  });
}

export function ConfiguracaoColeta({ locais }: { locais: Local[] }) {
  const qc = useQueryClient();
  const { data, isLoading } = useConfig();
  const [faixas, setFaixas] = useState<{ ate_kw: string; intervalo_min: string }[]>([]);
  const [cidades, setCidades] = useState<string[]>([]);
  useEffect(() => {
    if (!data) return;
    setFaixas(data.faixas.map(f => ({ ate_kw: f.ate_kw == null ? '' : String(f.ate_kw), intervalo_min: String(f.intervalo_min) })));
    setCidades(data.cidades);
  }, [data]);
  const salvar = useMutation({
    mutationFn: async () => {
      const p_faixas = faixas.map(f => ({ ate_kw: f.ate_kw.trim() === '' ? null : Number(f.ate_kw), intervalo_min: Number(f.intervalo_min) }));
      const { data: d, error } = await supabase.rpc('eletropostos_coleta_config_salvar' as never, { p_faixas, p_cidades: cidades } as never);
      if (error) throw error;
      return d as Config;
    },
    onSuccess: () => { toast.success('Configuração da coleta salva'); void qc.invalidateQueries({ queryKey: ['eletropostos'] }); },
    onError: e => toast.error((e as Error).message),
  });
  if (isLoading || !data) return <Loading />;

  const contagem = new Map<string, number>();
  for (const l of locais) if (l.cidade) contagem.set(l.cidade, (contagem.get(l.cidade) ?? 0) + 1);
  const todasCidades = [...contagem.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const ordenadas = [...faixas].map((f, i) => ({ f, i }));
  const mudar = (i: number, k: 'ate_kw' | 'intervalo_min', v: string) => setFaixas(faixas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  const remover = (i: number) => setFaixas(faixas.filter((_, j) => j !== i));
  const adicionar = () => setFaixas([{ ate_kw: '', intervalo_min: '8' }, ...faixas]);
  const alternar = (c: string) => setCidades(cidades.includes(c) ? cidades.filter(x => x !== c) : [...cidades, c]);
  const foraN = data.fora.length;

  return (
    <div>
      <h3 style={{ ...h3, marginTop: 24 }}>Periodicidade e cidades</h3>
      <p style={sub}>
        Quanto maior a potência, mais rápido o carregador muda de estado — por isso o intervalo de leitura é por <b>faixa de potência</b>.
        A estação escolhe a faixa pela maior potência do carregador e arredonda o intervalo a múltiplos do ciclo de 8 min; a Tupi (VPS) segue em 5 min.
        Só os locais das <b>cidades marcadas</b> são lidos; local ainda sem cadastro continua sendo lido.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <b style={{ fontSize: 13, color: '#fff' }}>Faixas de potência</b>
            <button type="button" onClick={adicionar} style={{ ...botao, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px' }}><Plus size={13} /> Faixa</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr auto', gap: '8px 10px', alignItems: 'center', fontSize: 12.5, color: '#ddd' }}>
            {ordenadas.map(({ f, i }) => (
              <div key={i} style={{ display: 'contents' }}>
                <span style={mudo}>{f.ate_kw.trim() === '' ? 'acima de tudo' : 'até'}</span>
                <input type="number" step="any" min={0} value={f.ate_kw} placeholder="∞" aria-label="Potência até (kW)" onChange={e => mudar(i, 'ate_kw', e.target.value)} style={{ ...input, width: '100%' }} />
                <span style={mudo}>kW → a cada</span>
                <input type="number" min={1} max={240} value={f.intervalo_min} aria-label="Intervalo (min)" onChange={e => mudar(i, 'intervalo_min', e.target.value)} style={{ ...input, width: '100%' }} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={mudo}>min</span>
                  <button type="button" onClick={() => remover(i)} aria-label="Remover faixa" disabled={faixas.length <= 1} style={{ all: 'unset', cursor: 'pointer', color: '#888', padding: 4 }}><Trash2 size={13} /></button>
                </span>
              </div>
            ))}
          </div>
          <p style={{ ...mudo, fontSize: 11, marginTop: 10 }}>Deixe o campo de kW vazio na faixa "acima de tudo" (precisa existir exatamente uma). Apps: mínimo prático de 8 min, arredondado para 8, 16, 24…</p>
        </div>
        <div style={card}>
          <b style={{ fontSize: 13, color: '#fff', display: 'block', marginBottom: 10 }}>Cidades monitoradas</b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {todasCidades.map(c => (
              <label key={c} style={{ ...rotulo, flexDirection: 'row', alignItems: 'center', gap: 8, color: '#ddd', fontSize: 13 }}>
                <input type="checkbox" checked={cidades.includes(c)} onChange={() => alternar(c)} />
                {c} <span style={mudo}>· {contagem.get(c)} locais</span>
              </label>
            ))}
          </div>
          <p style={{ ...mudo, fontSize: 11, marginTop: 10 }}>
            {foraN > 0 ? `${foraN} local(is) vinculado(s) ficam fora da coleta com a configuração salva.` : 'Nenhum local vinculado fica fora da coleta com a configuração salva.'}
            {data.atualizado_em && ` Última alteração: ${new Date(data.atualizado_em).toLocaleString('pt-BR')}.`}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" onClick={() => salvar.mutate()} disabled={salvar.isPending} style={{ ...botaoOuro, color: '#1A1A1A', background: GOLD }}>Salvar configuração da coleta</button>
      </div>
    </div>
  );
}
