import { useRef, useState } from 'react';
import { Loader2, Lock, Plus, Trash2, Upload, Users } from 'lucide-react';
import {
  formatarPercentual, formatarUcCpfl, lerPercentual, mesmoTitular, validarUc,
} from '@/lib/beneficiarias';
import {
  Beneficiaria, lerContaBeneficiaria, subirContaBeneficiaria,
  useBeneficiarias, useRemoverBeneficiaria, useSalvarBeneficiaria,
} from '@/hooks/useBeneficiarias';
import { ResumoRateio } from './BeneficiariasForm';

/**
 * BLOCO DE BENEFICIÁRIAS NO MODAL DO PROJETO — depois que o projeto existe.
 *
 * Fica abaixo da UC e do titular da geradora. Quem edita é decisão do banco
 * (RLS): a empresa até a análise, a equipe até a criação na CPFL, ninguém
 * depois. `podeEditar` só decide se a tela MOSTRA os controles; a trava real
 * é a política — se ela recusar, o erro chega no toast.
 *
 * Depois da criação na CPFL (`cpflNodeId`), o bloco é só leitura e diz que as
 * linhas são as que o portal aceitou: alterar aqui não altera lá.
 */

const CARD: React.CSSProperties = { border: '1px solid #E6E6E3', borderRadius: 12, background: '#fff', overflow: 'hidden' };
const INPUT: React.CSSProperties = {
  padding: '7px 9px', border: '1px solid #D6D6D2', borderRadius: 7, fontSize: 12.5, background: '#fff',
  outline: 'none', fontVariantNumeric: 'tabular-nums',
};
const TAG: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', padding: '3px 7px', borderRadius: 5,
  textTransform: 'uppercase', whiteSpace: 'nowrap',
};
const SUB: React.CSSProperties = { fontSize: 11, color: '#8A8A8A', margin: '3px 0 0', lineHeight: 1.5 };

function Origem({ b }: { b: Beneficiaria }) {
  if (b.holder_mismatch) return <span style={{ ...TAG, background: '#FDECEC', color: '#A32D2D' }}>titular diferente</span>;
  if (b.origin === 'confirmado_no_portal') return <span style={{ ...TAG, background: '#E6F1FB', color: '#185FA5' }}>confirmada no portal</span>;
  if (b.origin === 'lido_da_conta') return <span style={{ ...TAG, background: '#F1F0FB', color: '#3C3489' }}>lida da conta</span>;
  return <span style={{ ...TAG, background: '#F1EFE8', color: '#5F5E5A' }}>digitada</span>;
}

export function BeneficiariasBloco({
  projectId, companyId, concessionaria, docGeradora, podeEditar, cpflNodeId, ehCpfl, compacto,
}: {
  projectId: string;
  companyId: string | null | undefined;
  concessionaria: string | null | undefined;
  docGeradora: string | null | undefined;
  /** a tela acha que esta pessoa pode editar (o banco confirma ou recusa) */
  podeEditar: boolean;
  cpflNodeId: string | null | undefined;
  /** projeto é da CPFL: a trava do portal e a mensagem fazem sentido */
  ehCpfl: boolean;
  compacto?: boolean;
}) {
  const { data: linhas = [], isLoading } = useBeneficiarias(projectId);
  const salvar = useSalvarBeneficiaria();
  const remover = useRemoverBeneficiaria();
  const [novaUc, setNovaUc] = useState('');
  const [novoPct, setNovoPct] = useState('');
  const [novaFoto, setNovaFoto] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [adicionando, setAdicionando] = useState(false);
  const inputFoto = useRef<HTMLInputElement>(null);

  const travado = !!cpflNodeId;
  const edita = podeEditar && !travado;
  const percentuais = linhas.map(l => l.percent);
  const comProblema = linhas.filter(l => l.holder_mismatch);

  // tela vazia e sem edição: nem aparece (projeto sem beneficiária é o comum)
  if (!isLoading && linhas.length === 0 && !edita) return null;

  const adicionar = async () => {
    const v = validarUc(novaUc, concessionaria);
    const p = lerPercentual(novoPct);
    if (!v.ok || p === null) return;
    setAdicionando(true);
    try {
      let document_id: string | null = null;
      let leitura: Awaited<ReturnType<typeof lerContaBeneficiaria>> | null = null;
      if (novaFoto) {
        setLendo(true);
        try { leitura = await lerContaBeneficiaria(novaFoto); } catch { leitura = null; }
        setLendo(false);
        if (companyId) {
          try { document_id = await subirContaBeneficiaria({ file: novaFoto, projectId, companyId }); } catch { document_id = null; }
        }
      }
      const iguais = mesmoTitular(docGeradora, leitura?.holder_doc);
      await salvar.mutateAsync({
        projectId,
        linha: {
          uc_number: v.uc, percent: p, document_id,
          holder_name: leitura?.holder_name ?? null, holder_doc: leitura?.holder_doc ?? null, address: leitura?.address ?? null,
          origin: leitura ? 'lido_da_conta' : 'digitado', holder_mismatch: iguais === false,
          position: linhas.length,
        },
      });
      setNovaUc(''); setNovoPct(''); setNovaFoto(null);
    } catch { /* o toast do hook já explicou */ } finally { setAdicionando(false); setLendo(false); }
  };

  const vNova = novaUc.trim() ? validarUc(novaUc, concessionaria) : null;
  const pNovo = novoPct.trim() ? lerPercentual(novoPct) : undefined;

  return (
    <div style={{ ...CARD, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px', borderBottom: '1px solid #E6E6E3' }}>
        <Users size={14} style={{ color: '#8A8A8A' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700 }}>
            Unidades beneficiárias
            {linhas.length > 0 && <span style={{ fontWeight: 400, color: '#8A8A8A' }}> · autoconsumo remoto · {linhas.length}</span>}
          </p>
          <p style={{ ...SUB, margin: 0 }}>
            {travado
              ? `Criado na CPFL (nº ${cpflNodeId}). As beneficiárias abaixo são as que o portal aceitou; alterar aqui não altera lá.`
              : edita ? 'A geradora fica com o que sobra dos percentuais.' : 'Só leitura.'}
          </p>
        </div>
        {travado && <Lock size={14} style={{ color: '#8A8A8A' }} />}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 18 }}><Loader2 size={16} className="animate-spin" style={{ color: '#F5A800' }} /></div>
      ) : (
        <>
          {linhas.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['UC', 'Titular / endereço', 'Percentual', 'Origem', ''].map((h, i) => (
                    <th key={h + i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#8A8A8A', textAlign: i === 2 ? 'right' : 'left', padding: '8px 12px', borderBottom: '1px solid #E6E6E3' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map(b => (
                  <LinhaBloco key={b.id} b={b} projectId={projectId} edita={edita} ehCpfl={ehCpfl}
                    salvar={salvar} remover={remover} />
                ))}
                {!travado ? null : (
                  <tr>
                    <td colSpan={2} style={{ padding: '9px 12px', fontSize: 12, color: '#8A8A8A' }}>Geradora (resto)</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: '#854F0B', fontVariantNumeric: 'tabular-nums' }}>
                      {formatarPercentual(Math.max(0, 100 - percentuais.reduce((s, p) => s + p, 0)))}
                    </td>
                    <td colSpan={2} style={{ padding: '9px 12px' }}><span style={{ ...TAG, background: '#FEF3D0', color: '#854F0B' }}>calculado</span></td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {edita && (
            <div style={{ padding: '12px 16px', borderTop: linhas.length ? '1px solid #F2F2F0' : 'none', background: '#FBFBFA' }}>
              <div style={{ display: 'grid', gridTemplateColumns: compacto ? '1fr 1fr' : 'minmax(0,1fr) 120px minmax(0,1fr) auto', gap: 8, alignItems: 'start' }}>
                <div>
                  <input value={novaUc} onChange={e => setNovaUc(e.target.value)} placeholder="Nº da UC da beneficiária" inputMode="numeric"
                    style={{ ...INPUT, width: '100%', borderColor: vNova ? (vNova.ok ? '#9FE1CB' : '#F09595') : '#D6D6D2' }} />
                  {vNova && !vNova.ok && <p style={{ ...SUB, color: '#A32D2D' }}>{vNova.motivo}</p>}
                </div>
                <div>
                  <input value={novoPct} onChange={e => setNovoPct(e.target.value)} placeholder="% (ex. 30)" inputMode="decimal"
                    style={{ ...INPUT, width: '100%', textAlign: 'right', borderColor: pNovo === null ? '#F09595' : '#D6D6D2' }} />
                </div>
                <div>
                  <input ref={inputFoto} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setNovaFoto(e.target.files?.[0] ?? null)} />
                  <button type="button" onClick={() => inputFoto.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, textAlign: 'left',
                      border: novaFoto ? '1px solid #BDB8EE' : '1px dashed #CFCFCB', background: novaFoto ? '#F1F0FB' : '#fff', color: novaFoto ? '#3C3489' : '#8A8A8A' }}>
                    <Upload size={12} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{novaFoto ? novaFoto.name : 'conta (opcional)'}</span>
                  </button>
                </div>
                <button type="button" onClick={adicionar} disabled={adicionando || !vNova?.ok || !pNovo}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: adicionando || !vNova?.ok || !pNovo ? '#EEE' : '#F5A800', color: adicionando || !vNova?.ok || !pNovo ? '#AAA' : '#1A1A1A' }}>
                  {adicionando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  {lendo ? 'lendo…' : 'Adicionar'}
                </button>
              </div>
            </div>
          )}

          {linhas.length > 0 && !travado && (
            <div style={{ padding: '0 16px 14px' }}><ResumoRateio percentuais={percentuais} /></div>
          )}

          {comProblema.length > 0 && ehCpfl && !travado && (
            <div style={{ margin: '0 16px 14px', display: 'flex', gap: 9, alignItems: 'flex-start', background: '#FDECEC', border: '1px solid #F7C1C1', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: '#A32D2D', lineHeight: 1.55 }}>
              <span>⛔</span>
              <div>
                <b>A Ludmilla não vai criar este projeto na CPFL</b> enquanto houver beneficiária de outro titular
                ({comProblema.map(b => formatarUcCpfl(b.uc_number)).join(', ')}). Remova a linha ou confirme o titular pela conta.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LinhaBloco({ b, projectId, edita, ehCpfl, salvar, remover }: {
  b: Beneficiaria; projectId: string; edita: boolean; ehCpfl: boolean;
  salvar: ReturnType<typeof useSalvarBeneficiaria>;
  remover: ReturnType<typeof useRemoverBeneficiaria>;
}) {
  const [pct, setPct] = useState<string>(String(b.percent).replace('.', ','));
  const p = lerPercentual(pct);
  const mudou = p !== null && p !== b.percent;
  const td: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid #F4F4F2', fontSize: 12.5, verticalAlign: 'top' };

  return (
    <tr>
      <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: b.holder_mismatch ? '#A32D2D' : '#1A1A1A', whiteSpace: 'nowrap' }}>
        {ehCpfl ? formatarUcCpfl(b.uc_number) : b.uc_number}
      </td>
      <td style={td}>
        {b.holder_name ? <span>{b.holder_name}</span> : <span style={{ color: '#B5B5B5' }}>titular não lido</span>}
        {b.address && <span style={{ ...SUB, display: 'block' }}>{b.address}</span>}
        {b.holder_mismatch && <span style={{ ...SUB, display: 'block', color: '#A32D2D' }}>Não é o titular da geradora — o portal vai recusar esta UC.</span>}
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {edita ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <input value={pct} onChange={e => setPct(e.target.value)} inputMode="decimal"
              onBlur={() => { if (mudou) salvar.mutate({ projectId, linha: { ...b, percent: p } }); }}
              style={{ ...INPUT, width: 92, textAlign: 'right', borderColor: p === null ? '#F09595' : mudou ? '#F5A800' : '#D6D6D2' }} />
            <span style={{ fontSize: 11, color: '#8A8A8A' }}>%</span>
          </span>
        ) : (
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{formatarPercentual(b.percent)}</b>
        )}
      </td>
      <td style={td}><Origem b={b} /></td>
      <td style={{ ...td, textAlign: 'right' }}>
        {edita && (
          <button type="button" title="Remover" disabled={remover.isPending}
            onClick={() => { if (window.confirm(`Remover a beneficiária ${b.uc_number}?`)) remover.mutate({ projectId, id: b.id }); }}
            style={{ border: 'none', background: 'none', color: '#B5B5B5', cursor: 'pointer', padding: 2 }}>
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}
