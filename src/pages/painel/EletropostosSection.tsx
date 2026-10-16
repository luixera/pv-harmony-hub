import { useCallback, useState } from 'react';
import { Download } from 'lucide-react';
import { GOLD, Loading, SectionTitle } from './ConsoleSections';
import { useResumo } from './eletropostos/consultas';
import { csvDoResumo, hojeBrasilia, menosDias } from './eletropostos/calculo';
import { VisaoGeral } from './eletropostos/VisaoGeral';
import { Carregadores } from './eletropostos/Carregadores';
import { Mapa } from './eletropostos/Mapa';
import { Coleta } from './eletropostos/Coleta';
import { Premissas } from './eletropostos/Premissas';
import { PainelLateral } from './eletropostos/PainelLateral';
import { botao, input, vazio } from './eletropostos/estilo';
import type { Filtro, Ordem } from './eletropostos/tipos';

/**
 * Eletropostos — monitor de carregadores de VE (S. J. do Rio Preto e região),
 * só GD Manager. Spec: docs/superpowers/specs/2026-10-15-eletropostos-design.md.
 *
 * O que era o painel local em localhost:8765 vive aqui, com as mesmas 5 abas.
 * O dado vem das RPCs `eletropostos_*`; o cálculo é do banco. A tela só
 * formata e filtra (ver eletropostos/calculo.ts, testado).
 */
type Aba = 'geral' | 'carregadores' | 'mapa' | 'coleta' | 'premissas';
const ABAS: { key: Aba; label: string }[] = [
  { key: 'geral', label: 'Visão geral' }, { key: 'carregadores', label: 'Carregadores' }, { key: 'mapa', label: 'Mapa' },
  { key: 'coleta', label: 'Coleta' }, { key: 'premissas', label: 'Premissas' },
];
const CHAVE_ABA = 'painel.eletropostos.aba';

export function EletropostosSection() {
  const hoje = hojeBrasilia();
  const [aba, setAba] = useState<Aba>(() => { try { return (sessionStorage.getItem(CHAVE_ABA) as Aba) || 'geral'; } catch { return 'geral'; } });
  const [de, setDe] = useState(menosDias(hoje, 6));
  const [ate, setAte] = useState(hoje);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>({ q: '', cidade: '', operadora: '', tipo: 'DC', mon: '' });
  const [ordem, setOrdem] = useState<Ordem>({ col: 'ocupacao', dir: -1 });
  const { data: resumo, isLoading, error } = useResumo(de, ate);

  const irPara = (a: Aba) => { setAba(a); try { sessionStorage.setItem(CHAVE_ABA, a); } catch { /* sem storage */ } };
  const fechar = useCallback(() => setSelecionado(null), []);
  const atalho = (dias: number) => { setAte(hoje); setDe(menosDias(hoje, dias - 1)); };
  const atalhoAtivo = (dias: number) => ate === hoje && de === menosDias(hoje, dias - 1);
  const exportar = () => {
    if (!resumo) return;
    const blob = new Blob(['﻿' + csvDoResumo(resumo)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `eletropostos_${de}_${ate}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };
  const comPeriodo = aba !== 'premissas';   // Coleta usa o período na assertividade

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <SectionTitle>Eletropostos</SectionTitle>
        {comPeriodo && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <div role="group" aria-label="Período" style={{ display: 'inline-flex', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, overflow: 'hidden' }}>
              {[[1, 'Hoje'], [7, '7 dias'], [30, '30 dias']].map(([n, r]) => (
                <button key={n} onClick={() => atalho(n as number)} aria-pressed={atalhoAtivo(n as number)}
                  style={{ all: 'unset', cursor: 'pointer', padding: '6px 12px', fontSize: 12.5, fontWeight: 600,
                    background: atalhoAtivo(n as number) ? GOLD : '#16161F', color: atalhoAtivo(n as number) ? '#1A1A1A' : '#bbb' }}>{r}</button>
              ))}
            </div>
            <input type="date" value={de} max={ate} onChange={e => e.target.value && setDe(e.target.value)} aria-label="Início" style={input} />
            <span style={{ color: '#777', fontSize: 12 }}>até</span>
            <input type="date" value={ate} min={de} max={hoje} onChange={e => e.target.value && setAte(e.target.value)} aria-label="Fim" style={input} />
            <button onClick={exportar} disabled={!resumo} style={{ ...botao, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={14} /> Exportar CSV</button>
          </div>
        )}
      </div>

      <nav aria-label="Abas" style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 18 }}>
        {ABAS.map(a => (
          <button key={a.key} onClick={() => irPara(a.key)} aria-current={aba === a.key ? 'page' : undefined}
            style={{ all: 'unset', cursor: 'pointer', padding: '8px 14px', fontSize: 13, fontWeight: 600,
              color: aba === a.key ? GOLD : '#999', borderBottom: aba === a.key ? `2px solid ${GOLD}` : '2px solid transparent', marginBottom: -1 }}>{a.label}</button>
        ))}
      </nav>

      {error && <div style={vazio}>Não foi possível ler os dados ({(error as Error).message}).</div>}
      {!error && (isLoading || !resumo) && <Loading />}
      {resumo && (
        <>
          {aba === 'geral' && <VisaoGeral resumo={resumo} de={de} ate={ate} abrir={setSelecionado} irParaColeta={() => irPara('coleta')} />}
          {aba === 'carregadores' && <Carregadores resumo={resumo} filtro={filtro} setFiltro={setFiltro} ordem={ordem} setOrdem={setOrdem} abrir={setSelecionado} />}
          {aba === 'mapa' && <Mapa resumo={resumo} abrir={setSelecionado} />}
          {aba === 'coleta' && <Coleta resumo={resumo} de={de} ate={ate} />}
          {aba === 'premissas' && <Premissas key={JSON.stringify(resumo.premissas)} premissas={resumo.premissas} />}
          {selecionado && <PainelLateral id={selecionado} de={de} ate={ate} premissas={resumo.premissas} fechar={fechar} irParaColeta={() => irPara('coleta')} />}
        </>
      )}
    </div>
  );
}
