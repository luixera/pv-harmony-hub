import { toast } from 'sonner';
import { card, Loading } from '../ConsoleSections';
import { useColeta, useVincular } from './consultas';
import { atrasada, pct, relativo } from './calculo';
import { h3, input, manchete, mudo, sub, td, th, vazio } from './estilo';
import { COR_STATUS, type Resumo } from './tipos';
import { Assertividade } from './Assertividade';

export function Coleta({ resumo, de, ate }: { resumo: Resumo; de: string; ate: string }) {
  const { data: c, isLoading } = useColeta();
  const vincular = useVincular();
  if (isLoading || !c) return <Loading />;
  const agora = new Date(c.agora).getTime();
  const nv = resumo.nao_vinculados;
  const locais = [...resumo.locais].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const situacao = (ok: boolean, texto: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600 }}>
      <i style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? COR_STATUS.livre : COR_STATUS.fora, display: 'inline-block' }} />{texto}
    </span>
  );
  const onVincular = async (fonte: string, local_fonte: string, local_id: string) => {
    if (!local_id) return;
    try { await vincular.mutateAsync({ fonte, local_fonte, local_id }); toast.success('Vínculo salvo'); }
    catch (e) { toast.error((e as Error).message); }
  };
  const tabela = (cab: string[], linhas: React.ReactNode[][], chave: (i: number) => string, vazioTexto: string) => (
    <div style={{ ...card, padding: 0, overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
        <thead><tr>{cab.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {linhas.length === 0 && <tr><td colSpan={cab.length} style={{ ...td, color: '#777', padding: 18 }}>{vazioTexto}</td></tr>}
          {linhas.map((l, i) => <tr key={chave(i)}>{l.map((celula, j) => <td key={j} style={{ ...td, whiteSpace: j === l.length - 1 ? 'normal' : 'nowrap' }}>{celula}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
  const todasEmDia = c.fontes.length > 0 && c.fontes.every(f => !atrasada(f.ultima_ok, agora));
  return (
    <div>
      <p style={manchete}>{c.fontes.length ? (todasEmDia ? 'Todas as fontes leram nos últimos 15 minutos.' : 'Há fonte sem leitura recente — confira abaixo.') : 'O coletor ainda não rodou.'}</p>
      <p style={sub}>{c.inicio
        ? `Coletando desde ${new Date(c.inicio).toLocaleString('pt-BR')} · ${c.total_leituras.toLocaleString('pt-BR')} leituras gravadas.`
        : 'O coletor da Tupi roda na VPS a cada 5 minutos; a estação local (BlueStacks) manda as leituras dos apps.'}</p>

      <h3 style={h3}>Fontes</h3>
      {tabela(['Fonte', 'Última leitura com sucesso', 'Varreduras', 'Com sucesso', 'Situação'],
        c.fontes.map(f => [<b key="f">{f.fonte}</b>, relativo(f.ultima_ok, agora), String(f.total), pct(f.total ? f.oks / f.total : null),
          atrasada(f.ultima_ok, agora) ? situacao(false, 'Sem leitura recente') : situacao(true, 'Em dia')]),
        i => c.fontes[i].fonte, 'Nenhuma varredura registrada.')}

      <h3 style={{ ...h3, marginTop: 24 }}>Estações locais</h3>
      <p style={sub}>O PC com o BlueStacks bate a cada coleta. Mais de 15 minutos sem batida = estação parada.</p>
      {tabela(['Estação', 'Última batida', 'Situação'],
        c.estacoes.map(e => [<b key="e">{e.nome}</b>, relativo(e.vista_em, agora),
          !e.ativa ? <span key="s" style={mudo}>desativada</span> : atrasada(e.vista_em, agora) ? situacao(false, 'Parada') : situacao(true, 'Em dia')]),
        i => c.estacoes[i].id, 'Nenhuma estação registrada ainda (entrega 2).')}

      <h3 style={{ ...h3, marginTop: 24 }}>Locais lidos sem vínculo</h3>
      <p style={sub}>As fontes informam estes locais, mas o sistema não achou um cadastro a menos de 150 m. Escolha a qual local cada um pertence.</p>
      {nv.length ? tabela(['Como a fonte chama', 'Fonte', 'Vincular a'],
        nv.map(v => [<span key="n">{v.nome || v.local_fonte}<br /><span style={mudo}>{v.local_fonte}</span></span>, v.fonte,
          <select key="s" defaultValue="" style={input} onChange={e => onVincular(v.fonte, v.local_fonte, e.target.value)}>
            <option value="">Escolha um local…</option>
            {locais.map(l => <option key={l.id} value={l.id}>{l.nome} ({l.cidade || ''})</option>)}
          </select>]),
        i => `${nv[i].fonte}:${nv[i].local_fonte}`, '') : <div style={vazio}>Tudo vinculado.</div>}

      <h3 style={{ ...h3, marginTop: 24 }}>Últimos erros</h3>
      {c.erros.length ? tabela(['Quando', 'Fonte', 'Erro'],
        c.erros.map(e => [new Date(e.ts_utc).toLocaleString('pt-BR'), e.fonte, <span key="e" style={mudo}>{e.erro}</span>]),
        i => `${c.erros[i].ts_utc}-${i}`, '') : <div style={vazio}>Nenhum erro registrado.</div>}
      <Assertividade de={de} ate={ate} />
    </div>
  );
}
