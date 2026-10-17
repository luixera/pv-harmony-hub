import { useEffect, useState } from 'react';
import { useWindowSize } from '@/hooks/useWindowSize';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { card, Loading } from '../ConsoleSections';
import { useDetalhe, useSalvarLocal } from './consultas';
import { faixa, fmt, mil, pct } from './calculo';
import { BarrasDia, LinhaTempo, MapaCalor, St } from './Graficos';
import { botaoOuro, h3, input, mudo, rotulo, vazio } from './estilo';
import type { Cadastro, Premissas } from './tipos';

interface Props { id: string; de: string; ate: string; premissas: Premissas; fechar: () => void; irParaColeta: () => void }

const NUMERICOS: (keyof Cadastro)[] = ['potencia_kw', 'conectores', 'preco_kwh', 'custo_energia_kwh', 'lat', 'lng'];

/** Gaveta à direita com o detalhe do local: métricas, gráficos, conectores e o cadastro editável. */
export function PainelLateral({ id, de, ate, premissas: P, fechar, irParaColeta }: Props) {
  const { data: d, isLoading } = useDetalhe(id, de, ate);
  const { isMobile } = useWindowSize();
  const salvar = useSalvarLocal();
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!d) return;
    const l = d.local;
    setForm({
      nome: l.nome ?? '', endereco: l.endereco ?? '', cidade: l.cidade ?? '', operadora: l.operadora ?? '', tipo: l.tipo ?? 'DC',
      potencia_kw: l.potencia_kw == null ? '' : String(l.potencia_kw), conectores: l.conectores == null ? '' : String(l.conectores),
      fonte_status: l.fonte_status ?? '', preco_kwh: l.preco_kwh == null ? '' : String(l.preco_kwh),
      custo_energia_kwh: l.custo_energia_kwh == null ? '' : String(l.custo_energia_kwh),
      lat: l.lat == null ? '' : String(l.lat), lng: l.lng == null ? '' : String(l.lng), observacoes: l.observacoes ?? '', ativo: l.ativo ? '1' : '',
      fonte_principal: l.fonte_principal ?? '',
    });
  }, [d]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [fechar]);

  const campo = (k: string, rot: string, tipo: 'text' | 'number' = 'text', placeholder?: string) => (
    <label style={rotulo}>{rot}
      <input type={tipo} step="any" value={form[k] ?? ''} placeholder={placeholder} onChange={e => setForm({ ...form, [k]: e.target.value })} style={input} />
    </label>
  );
  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    const corpo: Record<string, unknown> = { id };
    for (const [k, v] of Object.entries(form)) {
      if (k === 'ativo') corpo.ativo = v === '1';
      else if ((NUMERICOS as string[]).includes(k)) corpo[k] = v === '' ? null : Number(v);
      else corpo[k] = v;
    }
    try { await salvar.mutateAsync(corpo as Partial<Cadastro>); toast.success('Alterações salvas'); }
    catch (err) { toast.error((err as Error).message); }
  };

  const l = d?.local;
  const fontesDoLocal = [...new Set((d?.vinculos ?? []).map(v => v.fonte))].sort();
  return (
    <aside aria-label="Detalhe do local" style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(760px, 100%)', background: '#0E0E14',
      borderLeft: '1px solid rgba(255,255,255,0.08)', boxShadow: '-20px 0 40px rgba(0,0,0,.45)', overflow: 'auto', zIndex: 1000, padding: isMobile ? '14px 14px 48px' : '22px 26px 60px',
    }}>
      {isLoading || !d || !l ? <Loading /> : (
        <>
          <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16,
            ...(isMobile ? { position: 'sticky', top: -14, background: '#0E0E14', zIndex: 2, padding: '14px 0 10px', margin: '-14px 0 12px' } : {}) }}>
            <div>
              <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#fff', margin: 0 }}>{l.nome}</h2>
              <p style={{ margin: '4px 0 0', color: '#999', fontSize: 13 }}>
                {[l.operadora, l.cidade, l.tipo && `${l.tipo} ${l.potencia_kw ? fmt(l.potencia_kw, 0) + ' kW' : ''}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={fechar} aria-label="Fechar" autoFocus style={{ all: 'unset', cursor: 'pointer', padding: isMobile ? 10 : 6, borderRadius: 8, color: '#bbb', background: isMobile ? 'rgba(255,255,255,0.06)' : 'transparent', flex: 'none' }}><X size={18} /></button>
          </header>

          {l.monitorado ? (
            <>
              <dl style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden', margin: '0 0 16px' }}>
                {[
                  ['Ocupação', pct(l.ocupacao), ''],
                  ['Carregando por dia', `${fmt(l.horas_ocupado_dia / Math.max(1, l.conectores_monitorados), 1)} h`, 'por conector'],
                  ['Recargas', String(l.sessoes), l.sessoes ? `média ${fmt(d.conectores.reduce((a, c) => a + c.m.horas_ocupado * 60, 0) / l.sessoes, 0)} min` : ''],
                  ['Energia estimada', `${faixa(l.kwh_min, l.kwh_max, v => fmt(v / 1000, 1))} MWh`, ''],
                  ['Receita estimada', `R$ ${faixa(l.receita_min, l.receita_max, mil)} mil`, ''],
                  ['Margem sobre energia', `R$ ${faixa(l.margem_min, l.margem_max, mil)} mil`, ''],
                ].map(([t, v, s]) => (
                  <div key={t} style={{ background: '#16161F', padding: '12px 14px' }}>
                    <dt style={{ color: '#888', fontSize: 12 }}>{t}</dt>
                    <dd style={{ margin: '2px 0 0', fontSize: isMobile ? 17 : 20, fontWeight: 700, color: '#fff' }}>{v} {s && <small style={{ fontSize: 11, color: '#777', fontWeight: 400 }}>{s}</small>}</dd>
                  </div>
                ))}
              </dl>
              <div style={{ ...card, marginBottom: 14 }}><h3 style={h3}>Horas carregando por dia</h3><BarrasDia diario={d.diario} compacto={isMobile} /></div>
              <div style={{ ...card, marginBottom: 14 }}>
                <h3 style={h3}>Quando ele é usado</h3>
                <p style={{ ...mudo, fontSize: 12, margin: '-6px 0 10px' }}>Fração do tempo carregando, por dia da semana e hora (média do período).</p>
                <MapaCalor perfil={d.perfil} compacto={isMobile} />
              </div>
              <div style={{ ...card, marginBottom: 14 }}>
                <h3 style={h3}>Conectores</h3>
                {d.conectores.map(c => (
                  <div key={c.nome} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', padding: '8px 0', borderTop: '1px solid #1a1a22', fontSize: 12.5, color: '#ddd' }}>
                    <div><b>Conector {c.conector}</b> <span style={mudo}>{c.fonte} · {c.local_fonte}</span></div>
                    <div><St s={c.m.ultimo_status} /> <span style={mudo}>{c.m.ultimo_bruto || ''}</span></div>
                    <div style={{ ...mudo, fontSize: 12 }}>{pct(c.m.ocupacao)} ocupado · {fmt(c.m.horas_ocupado, 1)} h{c.m.horas_energia != null && c.m.horas_energia < c.m.horas_ocupado - 0.05 ? ` (${fmt(c.m.horas_energia, 1)} h de energia: potência dividida ou em preparação)` : ''} · {c.m.sessoes} recargas · {fmt(c.m.horas_fora, 1)} h fora de serviço · cobertura {pct(c.m.cobertura)}</div>
                    <div />
                    <div style={{ gridColumn: '1 / -1' }}><LinhaTempo pontos={d.linha_do_tempo[c.nome]} compacto={isMobile} /></div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ ...vazio, marginBottom: 16 }}>
              Este local ainda não tem fonte de status ligada. {l.fonte_status ? `Situação: ${l.fonte_status}.` : ''} Quando um coletor ler este local, vincule-o na aba{' '}
              <button onClick={() => { fechar(); irParaColeta(); }} style={{ all: 'unset', color: '#F5A800', cursor: 'pointer', textDecoration: 'underline' }}>Coleta</button>.
            </div>
          )}

          <form onSubmit={submeter} style={card}>
            <h3 style={h3}>Cadastro</h3>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px 14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>{campo('nome', 'Nome')}</div>
              <div style={{ gridColumn: '1 / -1' }}>{campo('endereco', 'Endereço')}</div>
              {campo('cidade', 'Cidade')}{campo('operadora', 'Operadora')}
              <label style={rotulo}>Tipo
                <select value={form.tipo ?? 'DC'} onChange={e => setForm({ ...form, tipo: e.target.value })} style={input}><option>DC</option><option>AC</option></select>
              </label>
              {campo('potencia_kw', 'Potência por conector (kW)', 'number')}
              {campo('conectores', 'Nº de conectores', 'number')}
              {campo('fonte_status', 'Fonte de status')}
              {fontesDoLocal.length > 1 && (
                <label style={rotulo}>Fonte que entra na conta
                  <select value={form.fonte_principal ?? ''} onChange={e => setForm({ ...form, fonte_principal: e.target.value })} style={input}>
                    <option value="">Automática (a que mais leu{d?.fonte_na_conta ? `: ${d.fonte_na_conta}` : ''})</option>
                    {fontesDoLocal.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              )}
              {campo('preco_kwh', 'Preço cobrado (R$/kWh)', 'number', `padrão ${fmt(P.preco_kwh_padrao, 2)}`)}
              {campo('custo_energia_kwh', 'Custo da energia (R$/kWh)', 'number', `padrão ${fmt(P.custo_energia_kwh_padrao, 2)}`)}
              {campo('lat', 'Latitude', 'number')}{campo('lng', 'Longitude', 'number')}
              <label style={{ ...rotulo, gridColumn: '1 / -1' }}>Observações
                <textarea rows={3} value={form.observacoes ?? ''} onChange={e => setForm({ ...form, observacoes: e.target.value })} style={{ ...input, resize: 'vertical' }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#999', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={form.ativo === '1'} onChange={e => setForm({ ...form, ativo: e.target.checked ? '1' : '' })} /> Ativo no sistema
              </label>
              <button type="submit" disabled={salvar.isPending} style={botaoOuro}>Salvar alterações</button>
            </div>
          </form>
          {d.vinculos.length > 0 && <p style={{ ...mudo, fontSize: 12, marginTop: 10 }}>Lido de: {d.vinculos.map(v => `${v.fonte} · ${v.nome || v.local_fonte}${v.na_conta === false ? ' (fora da conta, evita duplicar)' : ''}`).join('; ')}</p>}
        </>
      )}
    </aside>
  );
}
