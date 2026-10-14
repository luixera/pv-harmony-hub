import { CORES, COR_SUBESTACAO, ORDEM, ROTULOS, descricaoDe } from './estilos';
import type { Regras, Risco } from './tipos';

const Forma = ({ risco, satelite }: { risco: Risco; satelite: boolean }) => {
  const cor = CORES[risco];
  if (risco === 'risco') return <span style={{ width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: `12px solid ${cor}` }} />;
  if (risco === 'atencao') return <span style={{ width: 13, height: 13, borderRadius: 7, border: `4px solid ${cor}`, background: satelite ? '#0E0E14' : 'transparent', boxSizing: 'border-box' }} />;
  if (risco === 'sem_dado') return <span style={{ width: 12, height: 12, background: satelite ? cor : 'transparent', border: `2px solid ${cor}`, boxSizing: 'border-box' }} />;
  return <span style={{ width: 12, height: 12, borderRadius: 6, background: cor, border: `1.6px solid ${satelite ? '#07070B' : 'rgba(255,255,255,0.45)'}`, boxSizing: 'border-box' }} />;
};

/** Forma + cor + o limiar REAL (lido de rede_regras pela RPC), nunca cor sozinha. */
export function Legenda({ regras, satelite, alimentadores, subestacoes }:
  { regras: Regras | undefined; satelite: boolean; alimentadores: boolean; subestacoes: boolean }) {
  return (
    <div aria-label="Legenda" style={{ background: 'rgba(14,14,20,0.92)', border: '1px solid rgba(255,255,255,0.1)',
                                       borderRadius: 11, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
        Risco de inversão de fluxo
      </p>
      {ORDEM.map(r => (
        <span key={r} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}><Forma risco={r} satelite={satelite} /></span>
          <span>{ROTULOS[r]}{regras && <span style={{ color: '#8A8A96' }}> — {descricaoDe(r, regras)}</span>}</span>
        </span>
      ))}
      {alimentadores && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5, color: '#D5D5DD',
                       paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ width: 14, display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ height: 3, background: CORES.risco }} /><span style={{ height: 1.5, background: CORES.folga, opacity: 0.7 }} />
          </span>
          Alimentador — traço grosso em risco, fino com folga
        </span>
      )}
      {subestacoes && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>
            <span style={{ width: 10, height: 10, background: COR_SUBESTACAO, transform: 'rotate(45deg)' }} />
          </span>
          Subestação
        </span>
      )}
    </div>
  );
}
