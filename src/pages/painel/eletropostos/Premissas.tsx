import { useState } from 'react';
import { toast } from 'sonner';
import { card } from '../ConsoleSections';
import { useSalvarPremissas } from './consultas';
import { botaoOuro, input, rotulo, sub } from './estilo';
import type { Premissas as P } from './tipos';

const CAMPOS: { k: keyof P; rotulo: string; ajuda: string }[] = [
  { k: 'dc_fator_min', rotulo: 'DC – potência média mínima (fração da nominal)', ajuda: 'A curva de carga reduz a potência depois de ~55% de bateria.' },
  { k: 'dc_fator_max', rotulo: 'DC – potência média máxima (fração da nominal)', ajuda: '' },
  { k: 'ac_kw_min', rotulo: 'AC – teto do carregador de bordo, mínimo (kW)', ajuda: 'Em AC quem limita é o carro.' },
  { k: 'ac_kw_max', rotulo: 'AC – teto do carregador de bordo, máximo (kW)', ajuda: '' },
  { k: 'ac_fator_min', rotulo: 'AC – fração do tempo plugado consumindo, mín.', ajuda: 'Carro cheio e ainda plugado não consome.' },
  { k: 'ac_fator_max', rotulo: 'AC – fração do tempo plugado consumindo, máx.', ajuda: '' },
  { k: 'preco_kwh_padrao', rotulo: 'Preço padrão cobrado (R$/kWh)', ajuda: 'Usado quando o local não tem preço cadastrado. Média da cidade: R$ 2,12.' },
  { k: 'custo_energia_kwh_padrao', rotulo: 'Custo padrão da energia (R$/kWh)', ajuda: 'Usado quando o local não tem custo cadastrado.' },
];

export function Premissas({ premissas }: { premissas: P }) {
  const salvar = useSalvarPremissas();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(CAMPOS.map(c => [c.k, String(premissas[c.k])])));
  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    const corpo: Partial<P> = {};
    for (const c of CAMPOS) { const n = Number(v[c.k]); if (Number.isFinite(n)) (corpo as Record<string, number>)[c.k] = n; }
    try { await salvar.mutateAsync(corpo); toast.success('Premissas salvas'); }
    catch (err) { toast.error((err as Error).message); }
  };
  return (
    <div>
      <p style={sub}>Valores usados para estimar energia e receita a partir do tempo de uso. O tempo carregando é medido; energia e receita são estimadas e aparecem sempre como faixa.</p>
      <form onSubmit={submeter} style={{ ...card, maxWidth: 760 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px 16px' }}>
          {CAMPOS.map(c => (
            <label key={c.k} style={rotulo}>
              {c.rotulo}
              <input type="number" step="0.01" value={v[c.k]} onChange={e => setV({ ...v, [c.k]: e.target.value })} style={input} />
              {c.ajuda && <span style={{ fontSize: 11, color: '#777' }}>{c.ajuda}</span>}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="submit" disabled={salvar.isPending} style={botaoOuro}>Salvar premissas</button>
        </div>
      </form>
    </div>
  );
}
