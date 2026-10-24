import { useRef } from 'react';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import {
  formatarPercentual, lerPercentual, mesmoTitular, resumirRateio, validarUc,
} from '@/lib/beneficiarias';
import { LinhaDeEnvio, lerContaBeneficiaria } from '@/hooks/useBeneficiarias';

/**
 * BLOCO DE BENEFICIÁRIAS NO ENVIO DO PROJETO — antes de o projeto existir.
 *
 * Um componente só para `NewProject` e `PublicProjectForm` (os dois tinham o
 * checkbox e o upload duplicados). Cada linha: nº da UC, percentual e a foto
 * da conta (opcional). Quando a foto entra, o Claudinho lê UC e titular: se o
 * titular difere do da geradora, a linha avisa — é o que o portal recusa.
 *
 * A geradora NÃO é uma linha: fica com 100 − soma, mostrado sempre. As
 * regras são as do portal (spec 2026-10-22, §1) e moram em lib/beneficiarias.
 */

const CARD: React.CSSProperties = { border: '1px solid #E6E6E3', borderRadius: 12, background: '#fff' };
const INPUT: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #D6D6D2', borderRadius: 8, fontSize: 13,
  background: '#fff', outline: 'none', fontVariantNumeric: 'tabular-nums',
};
const LABEL: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: '#1A1A1A' };
const SUB: React.CSSProperties = { fontSize: 11, color: '#8A8A8A', margin: '4px 0 0', lineHeight: 1.5 };

let proximaChave = 1;
export const novaLinhaDeEnvio = (): LinhaDeEnvio =>
  ({ chave: 'b' + (proximaChave++), uc: '', percentual: '', foto: null, leitura: null, lendo: false });

export interface ValidacaoDoEnvio {
  ok: boolean;
  erro?: string;
  /** só quando ok: prontas para gravar */
  linhas: { uc: string; percent: number; foto: File | null; leitura: LinhaDeEnvio['leitura'] }[];
}

/** O que o formulário confere antes de enviar — e o que grava. */
export function validarLinhasDeEnvio(
  ativo: boolean, linhas: LinhaDeEnvio[], concessionaria: string | null | undefined,
): ValidacaoDoEnvio {
  if (!ativo) return { ok: true, linhas: [] };
  if (linhas.length === 0) return { ok: false, erro: 'Marcou que há beneficiárias, mas nenhuma foi informada.', linhas: [] };
  const prontas: ValidacaoDoEnvio['linhas'] = [];
  const vistas = new Set<string>();
  for (const [i, l] of linhas.entries()) {
    const v = validarUc(l.uc, concessionaria);
    if (!v.ok) return { ok: false, erro: `Beneficiária ${i + 1}: ${v.motivo}`, linhas: [] };
    if (vistas.has(v.uc)) return { ok: false, erro: `A UC ${l.uc} está repetida.`, linhas: [] };
    vistas.add(v.uc);
    const p = lerPercentual(l.percentual);
    if (p === null) return { ok: false, erro: `Beneficiária ${i + 1} (UC ${l.uc}): informe um percentual entre 0 e 100.`, linhas: [] };
    prontas.push({ uc: v.uc, percent: p, foto: l.foto, leitura: l.leitura });
  }
  const r = resumirRateio(prontas.map(p => p.percent));
  if (r.estourou) return { ok: false, erro: `As beneficiárias somam ${formatarPercentual(r.soma)} — passa de 100%. O resto é da geradora e não pode ser negativo.`, linhas: [] };
  return { ok: true, linhas: prontas };
}

/** Soma das beneficiárias e o que fica com a geradora — o mesmo painel nas duas telas. */
export function ResumoRateio({ percentuais }: { percentuais: (number | null)[] }) {
  const r = resumirRateio(percentuais);
  const cores = ['#7F77DD', '#AFA9EC', '#CECBF6', '#9FE1CB', '#5DCAA5', '#85B7EB'];
  return (
    <div style={{ background: '#FAFAF9', border: '1px solid #E6E6E3', borderRadius: 10, padding: '11px 14px', marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 12.5 }}>
          Beneficiárias somam <b style={{ fontVariantNumeric: 'tabular-nums', color: r.estourou ? '#A32D2D' : '#1A1A1A' }}>{formatarPercentual(r.soma)}</b>
        </p>
        <p style={{ margin: 0, fontSize: 12.5 }}>
          Fica com a geradora: <b style={{ fontVariantNumeric: 'tabular-nums', color: '#854F0B' }}>{r.estourou ? '—' : formatarPercentual(r.geradora)}</b>
        </p>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: '#EEEEEB', overflow: 'hidden', display: 'flex', width: '100%', marginTop: 8 }}>
        {percentuais.map((p, i) => p ? (
          <i key={i} style={{ display: 'block', height: '100%', width: `${Math.min(100, p)}%`, background: cores[i % cores.length] }} />
        ) : null)}
        {!r.estourou && r.geradora > 0 && (
          <i style={{ display: 'block', height: '100%', width: `${r.geradora}%`, background: '#F5A800' }} />
        )}
      </div>
      <p style={{ ...SUB, color: r.estourou ? '#A32D2D' : '#8A8A8A' }}>
        {r.estourou
          ? 'A soma passou de 100%. Reduza algum percentual.'
          : 'A geradora também pode receber créditos: é o que sobra. O portal exige que o total feche em 100%.'}
      </p>
    </div>
  );
}

export function BeneficiariasForm({
  ativo, onAtivoChange, linhas, onLinhasChange, concessionaria, docGeradora,
}: {
  ativo: boolean;
  onAtivoChange: (v: boolean) => void;
  linhas: LinhaDeEnvio[];
  onLinhasChange: (linhas: LinhaDeEnvio[]) => void;
  /** nome da concessionária do projeto, para o formato da UC */
  concessionaria: string | null | undefined;
  /** CPF/CNPJ do titular da geradora, para conferir o titular lido */
  docGeradora: string | null | undefined;
}) {
  const mudar = (chave: string, patch: Partial<LinhaDeEnvio>) =>
    onLinhasChange(linhas.map(l => (l.chave === chave ? { ...l, ...patch } : l)));

  const lerFoto = async (chave: string, file: File | null) => {
    if (!file) { mudar(chave, { foto: null, leitura: null, lendo: false }); return; }
    mudar(chave, { foto: file, lendo: true, leitura: null });
    try {
      const leitura = await lerContaBeneficiaria(file);
      // a UC digitada é a chave: se estava vazia, a lida preenche; se difere, a tela avisa
      const atual = linhas.find(l => l.chave === chave);
      const ucVazia = !atual?.uc.trim();
      onLinhasChange(linhas.map(l => l.chave === chave
        ? { ...l, foto: file, lendo: false, leitura, uc: ucVazia && leitura.uc ? leitura.uc : l.uc }
        : l));
    } catch {
      mudar(chave, { lendo: false, leitura: null });
    }
  };

  const percentuais = linhas.map(l => lerPercentual(l.percentual));

  return (
    <div style={CARD}>
      <div style={{ padding: '14px 18px', borderBottom: ativo ? '1px solid #E6E6E3' : 'none' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={ativo} onChange={e => {
            onAtivoChange(e.target.checked);
            if (e.target.checked && linhas.length === 0) onLinhasChange([novaLinhaDeEnvio()]);
          }} style={{ width: 16, height: 16, accentColor: '#F5A800' }} />
          Existem unidades beneficiárias?
        </label>
        <p style={SUB}>Para autoconsumo remoto: a geradora manda a sobra dos créditos para estas unidades.</p>
      </div>

      {ativo && (
        <div style={{ padding: '6px 18px 16px' }}>
          {linhas.map((l, i) => (
            <LinhaForm
              key={l.chave} linha={l} indice={i} concessionaria={concessionaria} docGeradora={docGeradora}
              onMudar={patch => mudar(l.chave, patch)}
              onFoto={f => lerFoto(l.chave, f)}
              onRemover={() => onLinhasChange(linhas.filter(x => x.chave !== l.chave))}
              podeRemover={linhas.length > 1}
            />
          ))}
          <button type="button" onClick={() => onLinhasChange([...linhas, novaLinhaDeEnvio()])}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '8px 12px', border: '1px solid #D6D6D2', borderRadius: 8, background: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={14} /> Adicionar beneficiária
          </button>
          <ResumoRateio percentuais={percentuais} />
        </div>
      )}
    </div>
  );
}

function LinhaForm({ linha, indice, concessionaria, docGeradora, onMudar, onFoto, onRemover, podeRemover }: {
  linha: LinhaDeEnvio; indice: number;
  concessionaria: string | null | undefined; docGeradora: string | null | undefined;
  onMudar: (p: Partial<LinhaDeEnvio>) => void;
  onFoto: (f: File | null) => void;
  onRemover: () => void;
  podeRemover: boolean;
}) {
  const inputFoto = useRef<HTMLInputElement>(null);
  const v = linha.uc.trim() ? validarUc(linha.uc, concessionaria) : null;
  const p = linha.percentual.trim() ? lerPercentual(linha.percentual) : undefined;
  const titular = linha.leitura ? mesmoTitular(docGeradora, linha.leitura.holder_doc) : null;
  const ucLidaDifere = !!linha.leitura?.uc && !!v?.ok && linha.leitura.uc !== v.uc;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px minmax(0, 1fr) 36px', gap: 10, alignItems: 'start', padding: '12px 0', borderBottom: '1px solid #F2F2F0' }}>
      <div>
        <label style={LABEL} htmlFor={`benef-uc-${linha.chave}`}>Nº da UC da beneficiária {indice + 1}</label>
        <input id={`benef-uc-${linha.chave}`} value={linha.uc} onChange={e => onMudar({ uc: e.target.value })}
          placeholder="1.260.283.036-50" inputMode="numeric"
          style={{ ...INPUT, borderColor: v ? (v.ok ? '#9FE1CB' : '#F09595') : '#D6D6D2' }} />
        {v && !v.ok && <p style={{ ...SUB, color: '#A32D2D' }}>{v.motivo}</p>}
        {v?.ok && linha.leitura && titular === true && <p style={{ ...SUB, color: '#0F6E56' }}>Titular lido da conta confere com a geradora.</p>}
        {v?.ok && linha.leitura && titular === false && (
          <p style={{ ...SUB, color: '#A32D2D' }}>
            Titular lido: <b>{linha.leitura.holder_name ?? '?'}</b> — não é o titular da geradora. O portal vai recusar esta UC.
          </p>
        )}
        {ucLidaDifere && (
          <p style={{ ...SUB, color: '#854F0B' }}>
            Na conta a UC é <b>{linha.leitura!.uc}</b>.{' '}
            <button type="button" onClick={() => onMudar({ uc: linha.leitura!.uc! })}
              style={{ padding: 0, border: 'none', background: 'none', color: '#185FA5', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>
              Usar a UC da conta
            </button>
          </p>
        )}
        {v?.ok && !linha.leitura && !linha.lendo && <p style={SUB}>Sem conta anexada: o titular só será conferido no portal.</p>}
      </div>

      <div>
        <label style={LABEL} htmlFor={`benef-pct-${linha.chave}`}>Percentual</label>
        <input id={`benef-pct-${linha.chave}`} value={linha.percentual} onChange={e => onMudar({ percentual: e.target.value })}
          placeholder="30,0000" inputMode="decimal"
          style={{ ...INPUT, textAlign: 'right', borderColor: p === null ? '#F09595' : '#D6D6D2' }} />
        <p style={{ ...SUB, color: p === null ? '#A32D2D' : '#8A8A8A' }}>{p === null ? 'entre 0 e 100' : 'até 4 casas'}</p>
      </div>

      <div>
        <label style={LABEL}>Conta de energia</label>
        <input ref={inputFoto} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
          onChange={e => onFoto(e.target.files?.[0] ?? null)} />
        <button type="button" onClick={() => inputFoto.current?.click()} disabled={linha.lendo}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
            border: linha.foto ? '1px solid #BDB8EE' : '1px dashed #CFCFCB', background: linha.foto ? '#F1F0FB' : '#FAFAF9',
            color: linha.foto ? '#3C3489' : '#8A8A8A', fontSize: 11.5, textAlign: 'left',
          }}>
          {linha.lendo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {linha.lendo ? 'Claudinho lendo…' : linha.foto ? linha.foto.name : 'anexar (opcional)'}
          </span>
        </button>
        <p style={SUB}>{linha.foto ? (linha.leitura ? 'lida pelo Claudinho' : linha.lendo ? '' : 'não consegui ler; fica só anexada') : 'se vier, o Claudinho lê UC e titular'}</p>
      </div>

      <button type="button" onClick={onRemover} disabled={!podeRemover} title="Remover"
        style={{ width: 34, height: 34, marginTop: 22, border: '1px solid #E6E6E3', borderRadius: 8, background: '#fff', color: podeRemover ? '#8A8A8A' : '#DDD', cursor: podeRemover ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
