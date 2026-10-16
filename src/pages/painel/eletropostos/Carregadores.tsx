import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { card, GOLD } from '../ConsoleSections';
import { useSalvarLocal } from './consultas';
import { brl, faixa, filtrar, fmt, opcoes, ordenar, pct } from './calculo';
import { St } from './Graficos';
import { botao, input, mudo, td, th } from './estilo';
import type { ColunaOrdem, Filtro, Ordem, Resumo, Status } from './tipos';

const COLS: { col: ColunaOrdem; titulo: string; num?: boolean }[] = [
  { col: 'nome', titulo: 'Local' }, { col: 'cidade', titulo: 'Cidade' }, { col: 'operadora', titulo: 'Operadora' },
  { col: 'tipo', titulo: 'Tipo' }, { col: 'potencia_kw', titulo: 'kW', num: true }, { col: 'ocupacao', titulo: 'Ocupação' },
  { col: 'horas_ocupado_dia', titulo: 'h/dia por conector', num: true }, { col: 'sessoes', titulo: 'Recargas', num: true },
  { col: 'preco_efetivo', titulo: 'R$/kWh', num: true }, { col: 'receita_max', titulo: 'Receita est.', num: true },
  { col: 'agora', titulo: 'Agora' }, { col: 'fonte_status', titulo: 'Fonte de status' },
];

interface Props {
  resumo: Resumo; filtro: Filtro; setFiltro: (f: Filtro) => void; ordem: Ordem; setOrdem: (o: Ordem) => void; abrir: (id: string) => void;
}

export function Carregadores({ resumo, filtro, setFiltro, ordem, setOrdem, abrir }: Props) {
  const salvar = useSalvarLocal();
  const linhas = ordenar(filtrar(resumo.locais, filtro), ordem);
  const sel = (k: keyof Filtro) => ({ value: filtro[k], onChange: (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setFiltro({ ...filtro, [k]: e.target.value }) });
  const clicarColuna = (col: ColunaOrdem) => setOrdem({ col, dir: ordem.col === col ? (ordem.dir === 1 ? -1 : 1) : -1 });
  const novo = async () => {
    try {
      const id = await salvar.mutateAsync({ nome: 'Novo local', cidade: 'São José do Rio Preto', tipo: 'DC' });
      toast.success('Local adicionado'); abrir(id);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input type="text" placeholder="Buscar por nome ou endereço" aria-label="Buscar" style={{ ...input, minWidth: 220 }} {...sel('q')} />
        <select aria-label="Cidade" style={input} {...sel('cidade')}><option value="">Todas as cidades</option>{opcoes(resumo.locais, 'cidade').map(o => <option key={o}>{o}</option>)}</select>
        <select aria-label="Operadora" style={input} {...sel('operadora')}><option value="">Todas as operadoras</option>{opcoes(resumo.locais, 'operadora').map(o => <option key={o}>{o}</option>)}</select>
        <select aria-label="Tipo" style={input} {...sel('tipo')}><option value="">AC e DC</option><option value="DC">Só rápidos (DC)</option><option value="AC">Só AC</option></select>
        <select aria-label="Monitoramento" style={input} {...sel('mon')}><option value="">Monitorados ou não</option><option value="1">Só monitorados</option><option value="0">Sem monitoramento</option></select>
        <button onClick={novo} disabled={salvar.isPending} style={{ ...botao, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> Adicionar local</button>
        <span style={{ ...mudo, fontSize: 12 }}>{linhas.length} locais</span>
      </div>
      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 230px)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 980 }}>
          <thead>
            <tr>{COLS.map(c => (
              <th key={c.col} onClick={() => clicarColuna(c.col)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && clicarColuna(c.col)}
                aria-sort={ordem.col === c.col ? (ordem.dir === 1 ? 'ascending' : 'descending') : undefined}
                style={{ ...th, cursor: 'pointer', textAlign: c.num ? 'right' : 'left', color: ordem.col === c.col ? GOLD : th.color }}>
                {c.titulo}{ordem.col === c.col ? (ordem.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>))}</tr>
          </thead>
          <tbody>
            {linhas.length === 0 && <tr><td colSpan={COLS.length} style={{ ...td, padding: 24, color: '#777' }}>Nenhum local com esses filtros. Limpe a busca ou troque a cidade.</td></tr>}
            {linhas.map(l => (
              <tr key={l.id} tabIndex={0} onClick={() => abrir(l.id)} onKeyDown={e => e.key === 'Enter' && abrir(l.id)} style={{ cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <td style={{ ...td, fontWeight: 600, color: '#fff' }}>{l.nome}</td>
                <td style={td}>{l.cidade || '—'}</td>
                <td style={td}>{l.operadora || '—'}</td>
                <td style={td}>{l.tipo || '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(l.potencia_kw, 0)}</td>
                <td style={td}>{l.ocupacao == null ? <span style={mudo}>—</span> : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 60, height: 6, background: '#1e1e28', borderRadius: 3, overflow: 'hidden' }}>
                      <b style={{ display: 'block', height: '100%', width: `${Math.min(100, l.ocupacao * 100)}%`, background: GOLD }} />
                    </span>{pct(l.ocupacao)}
                  </span>)}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{l.monitorado ? fmt(l.horas_ocupado_dia / Math.max(1, l.conectores_monitorados), 1) : '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{l.monitorado ? l.sessoes : '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(l.preco_efetivo, 2)}{l.preco_estimado && <span style={mudo}>*</span>}</td>
                <td style={{ ...td, textAlign: 'right' }}>{l.monitorado ? faixa(l.receita_min, l.receita_max, brl) : '—'}</td>
                <td style={td}>{l.monitorado
                  ? (Object.entries(l.agora) as [Status, number][]).map(([s, n]) => <span key={s} style={{ marginRight: 8 }}>{n}× <St s={s} /></span>)
                  : <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', color: '#888' }}>não monitorado</span>}
                </td>
                <td style={{ ...td, color: '#777' }}>{l.fonte_status || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...mudo, fontSize: 11, marginTop: 8 }}>* preço padrão das premissas (o local não tem preço cadastrado).</p>
    </div>
  );
}
