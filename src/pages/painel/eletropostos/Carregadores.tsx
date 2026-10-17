import { useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useWindowSize } from '@/hooks/useWindowSize';
import { card, GOLD } from '../ConsoleSections';
import { useSalvarLocal } from './consultas';
import { brl, faixa, filtrar, fmt, opcoes, ordenar, pct } from './calculo';
import { St } from './Graficos';
import { botao, input, mudo, td, th } from './estilo';
import type { ColunaOrdem, Filtro, Local, Ordem, Resumo, Status } from './tipos';

const COLS: { col: ColunaOrdem; titulo: string; num?: boolean }[] = [
  { col: 'nome', titulo: 'Local' }, { col: 'cidade', titulo: 'Cidade' }, { col: 'operadora', titulo: 'Operadora' },
  { col: 'tipo', titulo: 'Tipo' }, { col: 'potencia_kw', titulo: 'kW', num: true }, { col: 'ocupacao', titulo: 'Ocupação' },
  { col: 'horas_ocupado_dia', titulo: 'h/dia por conector', num: true }, { col: 'sessoes', titulo: 'Recargas', num: true },
  { col: 'preco_efetivo', titulo: 'R$/kWh', num: true }, { col: 'receita_max', titulo: 'Receita est.', num: true },
  { col: 'agora', titulo: 'Agora' }, { col: 'fonte_status', titulo: 'Fonte de status' },
];

/** Ordens que fazem sentido no celular (sem cabeçalho de coluna para tocar). */
const ORDENS_CELULAR: { valor: string; rotulo: string; ordem: Ordem }[] = [
  { valor: 'ocupacao', rotulo: 'Mais ocupados', ordem: { col: 'ocupacao', dir: -1 } },
  { valor: 'agora', rotulo: 'Carregando agora', ordem: { col: 'agora', dir: -1 } },
  { valor: 'receita_max', rotulo: 'Maior receita', ordem: { col: 'receita_max', dir: -1 } },
  { valor: 'potencia_kw', rotulo: 'Maior potência', ordem: { col: 'potencia_kw', dir: -1 } },
  { valor: 'nome', rotulo: 'Nome (A–Z)', ordem: { col: 'nome', dir: 1 } },
];

interface Props {
  resumo: Resumo; filtro: Filtro; setFiltro: (f: Filtro) => void; ordem: Ordem; setOrdem: (o: Ordem) => void; abrir: (id: string) => void;
}

const Barra = ({ v }: { v: number }) => (
  <span style={{ display: 'inline-block', width: 60, height: 6, background: '#1e1e28', borderRadius: 3, overflow: 'hidden', verticalAlign: 'middle' }}>
    <b style={{ display: 'block', height: '100%', width: `${Math.min(100, v * 100)}%`, background: GOLD }} />
  </span>
);

/** Cartão do celular: o que se quer saber de relance — onde é, quanto é usado e como está agora. */
function CartaoLocal({ l, abrir }: { l: Local; abrir: (id: string) => void }) {
  const agora = Object.entries(l.agora) as [Status, number][];
  return (
    <button type="button" onClick={() => abrir(l.id)}
      style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'block', width: '100%', ...card, padding: '12px 14px' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', minWidth: 0 }}>{l.nome}</span>
        <span style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>{l.tipo ?? '—'}{l.potencia_kw ? ` · ${fmt(l.potencia_kw, 0)} kW` : ''}</span>
      </span>
      <span style={{ display: 'block', fontSize: 12, color: '#888', marginTop: 2 }}>
        {[l.cidade, l.operadora].filter(Boolean).join(' · ') || '—'}
      </span>
      {l.monitorado ? (
        <>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, color: '#ddd' }}>
            <Barra v={l.ocupacao ?? 0} /> <b>{pct(l.ocupacao)}</b>
            <span style={mudo}>· {fmt(l.horas_ocupado_dia / Math.max(1, l.conectores_monitorados), 1)} h/dia/conector · {l.sessoes} recargas</span>
          </span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            {agora.map(([s, n]) => <span key={s} style={{ fontSize: 12 }}>{n}× <St s={s} /></span>)}
          </span>
        </>
      ) : (
        <span style={{ display: 'inline-block', marginTop: 8, fontSize: 11, padding: '1px 8px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', color: '#888' }}>
          não monitorado{l.fonte_status ? ` · ${l.fonte_status}` : ''}
        </span>
      )}
    </button>
  );
}

export function Carregadores({ resumo, filtro, setFiltro, ordem, setOrdem, abrir }: Props) {
  const { isMobile } = useWindowSize();
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const salvar = useSalvarLocal();
  const linhas = ordenar(filtrar(resumo.locais, filtro), ordem);
  const sel = (k: keyof Filtro) => ({ value: filtro[k], onChange: (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setFiltro({ ...filtro, [k]: e.target.value }) });
  const clicarColuna = (col: ColunaOrdem) => setOrdem({ col, dir: ordem.col === col ? (ordem.dir === 1 ? -1 : 1) : -1 });
  const ativos = (['cidade', 'operadora', 'tipo', 'mon'] as const).filter(k => filtro[k] !== '').length;
  const novo = async () => {
    try {
      const id = await salvar.mutateAsync({ nome: 'Novo local', cidade: 'São José do Rio Preto', tipo: 'DC' });
      toast.success('Local adicionado'); abrir(id);
    } catch (e) { toast.error((e as Error).message); }
  };

  const selects = (
    <>
      <select aria-label="Cidade" style={input} {...sel('cidade')}><option value="">Todas as cidades</option>{opcoes(resumo.locais, 'cidade').map(o => <option key={o}>{o}</option>)}</select>
      <select aria-label="Operadora" style={input} {...sel('operadora')}><option value="">Todas as operadoras</option>{opcoes(resumo.locais, 'operadora').map(o => <option key={o}>{o}</option>)}</select>
      <select aria-label="Tipo" style={input} {...sel('tipo')}><option value="">AC e DC</option><option value="DC">Só rápidos (DC)</option><option value="AC">Só AC</option></select>
      <select aria-label="Monitoramento" style={input} {...sel('mon')}><option value="">Monitorados ou não</option><option value="1">Só monitorados</option><option value="0">Sem monitoramento</option></select>
    </>
  );

  if (isMobile) {
    const ordemAtual = ORDENS_CELULAR.find(o => o.ordem.col === ordem.col && o.ordem.dir === ordem.dir)?.valor ?? 'ocupacao';
    const alto = { ...input, minHeight: 44, fontSize: 15, width: '100%' };   // 15 px: o iOS não dá zoom ao focar
    return (
      <div>
        <input type="search" placeholder="Buscar por nome ou endereço" aria-label="Buscar" style={alto} {...sel('q')} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={() => setFiltrosAbertos(v => !v)} aria-expanded={filtrosAbertos}
            style={{ ...botao, flex: 1, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              borderColor: ativos ? GOLD : botao.borderColor, color: ativos ? GOLD : botao.color }}>
            <SlidersHorizontal size={15} /> Filtros{ativos ? ` (${ativos})` : ''}
          </button>
          <select aria-label="Ordenar por" value={ordemAtual} style={{ ...alto, flex: 1, width: 'auto' }}
            onChange={e => setOrdem(ORDENS_CELULAR.find(o => o.valor === e.target.value)!.ordem)}>
            {ORDENS_CELULAR.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </div>
        {filtrosAbertos && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            {selects}
            {ativos > 0 && (
              <button type="button" onClick={() => setFiltro({ ...filtro, cidade: '', operadora: '', tipo: '', mon: '' })}
                style={{ ...botao, gridColumn: '1 / -1', minHeight: 40 }}>Limpar filtros</button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 2px 8px' }}>
          <span style={{ ...mudo, fontSize: 12 }}>{linhas.length} locais</span>
          <button type="button" onClick={novo} disabled={salvar.isPending}
            style={{ ...botao, minHeight: 36, padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> Adicionar</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {linhas.length === 0 && <p style={{ ...mudo, fontSize: 13, padding: 16, textAlign: 'center' }}>Nenhum local com esses filtros.</p>}
          {linhas.map(l => <CartaoLocal key={l.id} l={l} abrir={abrir} />)}
        </div>
        <p style={{ ...mudo, fontSize: 11, marginTop: 10 }}>Toque num local para ver o detalhe e editar o cadastro.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input type="text" placeholder="Buscar por nome ou endereço" aria-label="Buscar" style={{ ...input, minWidth: 220 }} {...sel('q')} />
        {selects}
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Barra v={l.ocupacao} />{pct(l.ocupacao)}</span>)}
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
