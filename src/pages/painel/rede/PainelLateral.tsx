import { memo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Copy, Crosshair, FileText, GitBranch, Scale, ShieldCheck } from 'lucide-react';
import { GOLD } from '../ConsoleSections';
import { anularParecer, enviarPdfParecer, registrarParecer, urlDoParecer, useDetalheAlimentador, useDetalheTrafo, useFontes } from './consultas';
import { acertoDoModelo, FORMULARIO_VAZIO, montarRegistro, RESULTADOS, rotuloResultado, rotuloTipo, sha256DeArquivo, TIPOS, type Formulario } from './confronto';
import { CORES, ORDEM, ROTULOS } from './estilos';
import { bytesLegiveis, data, dataHora, hashCurto, inteiro, kva, kw, mesesDesde, pct, percentualDe, rotuloIdade } from './formato';
import type { DetalheTrafo, FonteImportacao, Importacao, Mudancas, Parecer, PropsAlimentador, PropsPonto, RegrasCompletas, RespostaMapa, Risco, Selecao } from './tipos';
import type { Caixa } from './zoom';

/**
 * O equivalente acessível do mapa — não enfeite. Mil marcadores não se
 * navegam por teclado; esta coluna sim. Tem os mesmos dados do mapa, na
 * mesma ordem de importância: resumo da área, lista contextual, detalhe.
 *
 * `memo` de propósito: a seção re-renderiza a cada passagem do mouse (faixa
 * de status), e a v2 refazia aqui uma lista de 4.000 itens por hover.
 */
interface Props {
  resposta: RespostaMapa | undefined; carregando: boolean; selecao: Selecao;
  aoSelecionar: (s: Selecao) => void; aoEnquadrar: (c: Caixa) => void; aoCentrar: (lng: number, lat: number) => void;
}

const PAGINA = 40;
const rotuloSecao: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 };
const linha: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '9px 12px', background: '#16161F' };
const bloco: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 10, overflow: 'hidden' };
const botaoLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' };
const chave: React.CSSProperties = { fontSize: 12, color: '#9A9AA8' };
const valor: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#fff', textAlign: 'right' };
const nota: React.CSSProperties = { fontSize: 11, color: '#8A8A96', margin: 0, lineHeight: 1.5 };

const Ponto = ({ risco }: { risco: Risco }) =>
  <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0, background: CORES[risco] }} />;

const Par = ({ k, v, forte }: { k: string; v: React.ReactNode; forte?: boolean }) => (
  <div style={{ ...linha, ...(forte ? { background: 'rgba(255,255,255,0.08)' } : {}) }}>
    <span style={chave}>{k}</span><span style={valor}>{v}</span>
  </div>
);

function Copiar({ texto }: { texto: string }) {
  const [feito, setFeito] = useState(false);
  return (
    <button type="button" aria-label="Copiar" title="Copiar"
            onClick={() => { void navigator.clipboard?.writeText(texto).then(() => { setFeito(true); setTimeout(() => setFeito(false), 1500); }); }}
            style={{ ...botaoLink, fontSize: 11 }}>
      {feito ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function Resumo({ r, camada }: { r: RespostaMapa['resumo']; camada: 'celula' | 'ponto' }) {
  const tile = (risco: Risco, rotulo: string) => (
    <div key={risco} style={{ background: `${CORES[risco]}1A`, border: `1px solid ${CORES[risco]}47`, borderRadius: 10, padding: '10px 12px' }}>
      <p style={{ fontSize: 19, fontWeight: 800, color: risco === 'folga' ? '#5DD372' : risco === 'risco' ? '#FF7A6B' : CORES[risco], margin: 0 }}>
        {percentualDe(r[risco], r.total)}%
      </p>
      <p style={{ fontSize: 11, color: '#9A9AA8', margin: '2px 0 0' }}>{rotulo} · {inteiro(r[risco])}</p>
    </div>
  );
  return (
    <div>
      <p style={{ ...rotuloSecao, marginBottom: 9 }}>Área visível · {inteiro(r.total)} trafos MT/BT{camada === 'celula' ? ' (resumidos em células)' : ''}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {tile('folga', 'com folga')}{tile('atencao', 'em atenção')}{tile('risco', 'em risco')}{tile('sem_dado', 'sem dado')}
      </div>
    </div>
  );
}

function BarraOcupacao({ ocupacao, risco, limiarRisco }: { ocupacao: number | null; risco: Risco; limiarRisco: number }) {
  if (ocupacao === null) return null;
  const escala = Math.max(limiarRisco * 1.5, ocupacao);   // a marca dos 100% nunca cola na borda
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Ocupação da margem</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: CORES[risco] }}>{pct(ocupacao)}</span>
      </div>
      <div style={{ height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (ocupacao / escala) * 100)}%`, height: '100%', background: CORES[risco], borderRadius: 5 }} />
        <div aria-hidden style={{ position: 'absolute', left: `${(limiarRisco / escala) * 100}%`, top: -2, bottom: -2, width: 2, background: '#E8E8EE' }} />
      </div>
      <p style={{ ...nota, marginTop: 5 }}>A marca clara é o limite de {limiarRisco}%{ocupacao >= limiarRisco ? ' — a barra passou dele.' : '.'}</p>
    </div>
  );
}

function Procedencia({ base, fonte }: { base: RespostaMapa['base']; fonte?: FonteImportacao | null }) {
  const dataBase = fonte?.data_base ?? base.data_base;
  const idade = dataBase ? mesesDesde(dataBase) : null;
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <p style={rotuloSecao}>Procedência do dado</p>
      {[['Fonte', 'BDGD · ANEEL'], ['Distribuidora', base.distribuidora ?? '—'],
        ['Arquivo', fonte?.arquivo_origem ?? '—'], ['Versão', fonte?.versao_bdgd ?? '—'],
        ['Data-base', data(dataBase)], ['Baixado em', dataHora(fonte?.baixado_em)],
        ['Importado em', dataHora(fonte?.concluido_em ?? base.importado_em)]].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
          <span style={{ color: '#9A9AA8', flexShrink: 0 }}>{k}</span>
          <span style={{ color: '#D5D5DD', fontWeight: 600, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
        <span style={{ color: '#9A9AA8' }}>SHA-256 do zip</span>
        <span style={{ color: '#D5D5DD', fontWeight: 600, display: 'inline-flex', gap: 6, alignItems: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
          {hashCurto(fonte?.hash_sha256)}{fonte?.hash_sha256 && <Copiar texto={fonte.hash_sha256} />}
        </span>
      </div>
      {idade !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#9A9AA8' }}>Idade do dado</span><span style={{ color: '#E3B341', fontWeight: 700 }}>{rotuloIdade(idade)}</span>
        </div>
      )}
    </div>
  );
}

const FASES: Record<number, string> = { 1: 'monofásico', 2: 'bifásico', 3: 'trifásico' };
const n0 = (v: number | null | undefined) => v == null ? '—' : inteiro(v);
const fator = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/** A fórmula com os números de verdade: o que o semáforo está dizendo, e por quê. */
function ContaAberta({ d }: { d: DetalheTrafo }) {
  const g = d.regras;
  const carga = d.carga_min_diurna_kw; const gd = d.gd_conectada_kw;
  if (carga == null || carga <= 0 || gd == null) {
    return (
      <div style={{ border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 11, padding: 12 }}>
        <p style={{ ...rotuloSecao, marginBottom: 6 }}>Conta aberta</p>
        <p style={nota}>
          Não dá para fechar a conta: {carga == null || carga <= 0 ? 'a base não traz carga das UCs deste trafo' : 'a base não traz a geração conectada'}.
          Por isso o estado é "sem dado" — ausência de dado não é ausência de risco.
        </p>
      </div>
    );
  }
  const capacidade = carga * g.fator;
  const margem = capacidade - gd;
  const ocupacao = (gd / capacidade) * 100;
  const passo = (k: React.ReactNode, v: React.ReactNode, destaque = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ color: destaque ? '#D5D5DD' : '#9A9AA8', fontWeight: destaque ? 600 : 400 }}>{k}</span>
      <span style={{ color: destaque ? CORES[d.risco] : '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  );
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: 12 }}>
      <p style={{ ...rotuloSecao, marginBottom: 4 }}>Conta aberta</p>
      {passo(`Carga mínima diurna estimada (${g.janela_inicio}h–${g.janela_fim}h)`, kw(carga))}
      {passo(`× fator de segurança ${fator(g.fator)} = capacidade de absorção`, kw(capacidade))}
      {passo('− GD já conectada em BT', kw(gd))}
      {passo('= margem até a inversão', kw(margem), true)}
      {passo('Ocupação = GD ÷ capacidade', pct(ocupacao), true)}
      <p style={{ ...nota, marginTop: 8 }}>
        Atenção a partir de {g.atencao}% e risco a partir de {g.risco}% (regras do Motor de Engenharia vigentes nesta carga).
        A carga é estimativa pela curva de carga das UCs, não medição.
      </p>
    </div>
  );
}

function BaseAnterior({ d }: { d: DetalheTrafo }) {
  const a = d.anterior;
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={rotuloSecao}>Na carga anterior</p>
      {!a ? (
        <p style={nota}>Primeira carga com histórico. A comparação começa na próxima BDGD publicada pela ANEEL.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#D5D5DD' }}>
            <Ponto risco={a.risco} /> {ROTULOS[a.risco]} · {pct(a.ocupacao_pct)}
            <span style={{ color: '#8A8A96' }}>→</span>
            <Ponto risco={d.risco} /> {ROTULOS[d.risco]} · {pct(d.ocupacao_pct)}
          </div>
          <p style={nota}>Base de {data(a.data_base)}: GD {kw(a.gd_conectada_kw)} → {kw(d.gd_conectada_kw)} · carga {kw(a.carga_min_diurna_kw)} → {kw(d.carga_min_diurna_kw)}{!a.ativo ? ' · estava inativo' : ''}</p>
        </>
      )}
    </div>
  );
}

function CamposBdgd({ bdgd }: { bdgd: DetalheTrafo['bdgd'] }) {
  return (
    <details style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: '10px 12px' }}>
      <summary style={{ ...rotuloSecao, cursor: 'pointer', listStyle: 'none' }}>Campos brutos da BDGD · camada {String(bdgd.camada)}</summary>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(bdgd).filter(([k]) => k !== 'camada').map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5 }}>
            <span style={{ color: '#9A9AA8', fontFamily: 'ui-monospace, monospace' }}>{k}</span>
            <span style={{ color: '#D5D5DD', fontWeight: 600, textAlign: 'right' }}>{v == null ? '—' : String(v)}</span>
          </div>
        ))}
        <p style={{ ...nota, marginTop: 4 }}>Com estes nomes você confere a linha no arquivo da ANEEL.</p>
      </div>
    </details>
  );
}

// ── Confronto com a distribuidora (spec §13) ──────────────────────────────────
const campo: React.CSSProperties = { width: '100%', padding: '7px 9px', borderRadius: 7, boxSizing: 'border-box', fontSize: 12,
  border: '1px solid rgba(255,255,255,0.14)', background: '#0E0E14', color: '#fff', fontFamily: 'inherit', outline: 'none' };
const rotuloCampo: React.CSSProperties = { display: 'block', fontSize: 10.5, color: '#9A9AA8', marginBottom: 3 };

function Acerto({ acerto }: { acerto: boolean | null }) {
  const [cor, texto] = acerto === null ? ['#8A8A96', 'sem conta (modelo sem dado)']
    : acerto ? ['#5DD372', 'o modelo acertou'] : ['#FF7A6B', 'o modelo errou'];
  return <span style={{ fontSize: 11, fontWeight: 700, color: cor, padding: '2px 8px', borderRadius: 20, background: `${cor}1F`, border: `1px solid ${cor}66` }}>{texto}</span>;
}

function ParecerView({ p, aoAnular }: { p: Parecer; aoAnular: (id: number) => void }) {
  const dif = (k: string, deles: number | null, nosso: number | null, fmt: (v: number | null | undefined) => string) =>
    deles == null ? null : (
      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
        <span style={{ color: '#9A9AA8' }}>{k}</span>
        <span style={{ color: '#D5D5DD' }}>{fmt(deles)} <span style={{ color: '#6B6B78' }}>· base {fmt(nosso)}</span></span>
      </div>);
  return (
    <div style={{ background: '#16161F', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>{rotuloTipo(p.tipo)}</span>
        <span style={{ fontSize: 11, color: '#8A8A96' }}>{p.numero_estudo ?? ''}{p.data_documento ? ` · ${data(p.data_documento)}` : ''}</span>
        <span style={{ marginLeft: 'auto' }}><Acerto acerto={p.acerto} /></span>
      </div>
      <p style={{ fontSize: 12, color: '#D5D5DD', margin: 0 }}>{rotuloResultado(p.resultado)}{p.potencia_injetavel_kw != null ? ` · injetável ${kw(p.potencia_injetavel_kw)}` : ''}</p>
      <p style={{ ...nota }}>Na hora do registro o modelo dizia <strong style={{ color: CORES[p.risco_modelo] }}>{ROTULOS[p.risco_modelo]}</strong>{p.ocupacao_modelo != null ? ` (${pct(p.ocupacao_modelo)})` : ''}{p.importacao_id ? ` · carga #${p.importacao_id}` : ''}.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {p.codigo_distribuidora && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}><span style={{ color: '#9A9AA8' }}>Posto na distribuidora</span><span style={{ color: '#fff', fontWeight: 700 }}>{p.codigo_distribuidora}</span></div>}
        {p.potencia_solicitada_kw != null && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}><span style={{ color: '#9A9AA8' }}>Potência solicitada</span><span style={{ color: '#D5D5DD' }}>{kw(p.potencia_solicitada_kw)}</span></div>}
        {dif('UCs', p.ucs_distribuidora, null, v => v == null ? '—' : inteiro(v))}
        {dif('Unidades de GD', p.gd_unidades_distribuidora, null, v => v == null ? '—' : inteiro(v))}
        {dif('GD conectada', p.gd_kw_distribuidora, p.gd_modelo_kw, kw)}
        {dif('Carga mínima', p.carga_min_distribuidora_kw, p.carga_modelo_kw, kw)}
      </div>
      {p.observacoes && <p style={nota}>{p.observacoes}</p>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {p.arquivo_caminho && (
          <button type="button" style={botaoLink} onClick={() => { void urlDoParecer(p.arquivo_caminho!).then(u => window.open(u, '_blank', 'noopener')); }}>
            <FileText size={12} /> {p.arquivo_nome ?? 'PDF'}
          </button>
        )}
        {p.arquivo_hash_sha256 && <span style={{ fontSize: 10.5, color: '#6B6B78', fontFamily: 'ui-monospace, monospace' }}>sha256 {hashCurto(p.arquivo_hash_sha256)}</span>}
        <button type="button" style={{ ...botaoLink, marginLeft: 'auto', color: '#8A8A96', fontSize: 11 }}
                onClick={() => { if (window.confirm('Anular este registro? Ele fica guardado, mas sai da conta.')) aoAnular(p.id); }}>anular</button>
      </div>
    </div>
  );
}

function Confronto({ d }: { d: DetalheTrafo }) {
  const fila = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState<Formulario>(FORMULARIO_VAZIO);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: keyof Formulario) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(v => ({ ...v, [k]: e.target.value }));
  const atualizar = () => { void fila.invalidateQueries({ queryKey: ['rede-trafo', d.id] }); void fila.invalidateQueries({ queryKey: ['rede-fontes'] }); void fila.invalidateQueries({ queryKey: ['rede-buscar'] }); };
  const previsto = acertoDoModelo(d.risco, f.resultado);

  const gravar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(null); setEnviando(true);
    try {
      let anexo: { nome: string; hash: string; caminho: string } | undefined;
      if (arquivo) {
        const hash = await sha256DeArquivo(arquivo);
        anexo = { nome: arquivo.name, hash, caminho: await enviarPdfParecer(d.id, hash, arquivo) };
      }
      await registrarParecer(montarRegistro(d.id, f, anexo));
      setF(FORMULARIO_VAZIO); setArquivo(null); setAberto(false); atualizar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui registrar.');
    } finally { setEnviando(false); }
  };
  const anular = (id: number) => { void anularParecer(id).then(atualizar).catch(x => setErro(x instanceof Error ? x.message : 'Não consegui anular.')); };

  const campoNum = (k: keyof Formulario, rotulo: string, dica?: string) => (
    <label style={{ display: 'block' }}><span style={rotuloCampo}>{rotulo}</span>
      <input type="text" inputMode="decimal" value={f[k]} onChange={set(k)} placeholder={dica} style={campo} /></label>
  );
  const campoTxt = (k: keyof Formulario, rotulo: string, dica?: string, tipo = 'text') => (
    <label style={{ display: 'block' }}><span style={rotuloCampo}>{rotulo}</span>
      <input type={tipo} value={f[k]} onChange={set(k)} placeholder={dica} style={campo} /></label>
  );

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <p style={{ ...rotuloSecao, display: 'flex', alignItems: 'center', gap: 6 }}><Scale size={12} /> Confronto com a distribuidora</p>
      {d.pareceres.length === 0
        ? <p style={nota}>Nenhum orçamento ou parecer registrado neste trafo. Registre o documento real da concessionária: o número do posto vira pesquisável e o modelo ganha uma conta de acertos.</p>
        : d.pareceres.map(p => <ParecerView key={p.id} p={p} aoAnular={anular} />)}
      {!aberto && <button type="button" onClick={() => setAberto(true)} style={botaoLink}><FileText size={12} /> Registrar orçamento ou parecer</button>}
      {aberto && (
        <form onSubmit={e => { void gravar(e); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'block' }}><span style={rotuloCampo}>Documento</span>
              <select value={f.tipo} onChange={set('tipo')} style={campo}>{TIPOS.map(t => <option key={t} value={t}>{rotuloTipo(t)}</option>)}</select></label>
            {campoTxt('data_documento', 'Data', undefined, 'date')}
          </div>
          <label style={{ display: 'block' }}><span style={rotuloCampo}>O que a distribuidora concluiu</span>
            <select value={f.resultado} onChange={set('resultado')} style={campo}>{RESULTADOS.map(r => <option key={r} value={r}>{rotuloResultado(r)}</option>)}</select></label>
          <p style={{ ...nota, margin: 0 }}>Com o modelo dizendo <strong style={{ color: CORES[d.risco] }}>{ROTULOS[d.risco]}</strong>, este resultado conta como {previsto === null ? 'sem conta' : previsto ? <strong style={{ color: '#5DD372' }}>acerto</strong> : <strong style={{ color: '#FF7A6B' }}>erro</strong>}.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {campoTxt('codigo_distribuidora', 'Posto de transformação (número da distribuidora)', '189049')}
            {campoTxt('numero_estudo', 'Nº do estudo', 'OC00693/10-2026')}
            {campoTxt('numero_pedido', 'Nº do pedido / atividade', '2248586925')}
            {campoNum('potencia_solicitada_kw', 'Potência solicitada (kW)', '12')}
            {campoNum('potencia_injetavel_kw', 'Injetável permitida (kW)', '4')}
            {campoNum('ucs_distribuidora', 'UCs no posto (deles)', '45')}
            {campoNum('gd_unidades_distribuidora', 'Unidades de GD (deles)', '5')}
            {campoNum('gd_kw_distribuidora', 'GD conectada (deles, kW)', '18,85')}
            {campoNum('carga_min_distribuidora_kw', 'Carga mínima (deles, kW)', '11')}
          </div>
          <label style={{ display: 'block' }}><span style={rotuloCampo}>Observações</span>
            <textarea value={f.observacoes} onChange={set('observacoes')} rows={2} style={{ ...campo, resize: 'vertical' }} /></label>
          <label style={{ display: 'block' }}><span style={rotuloCampo}>PDF do documento (opcional; guarda o arquivo e o SHA-256)</span>
            <input type="file" accept="application/pdf" onChange={e => setArquivo(e.target.files?.[0] ?? null)} style={{ fontSize: 11.5, color: '#C6C6D0' }} /></label>
          {erro && <p style={{ ...nota, color: '#FF7A6B' }}>{erro}</p>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" disabled={enviando} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: GOLD, color: '#0E0E14', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Registrando…' : 'Registrar'}
            </button>
            <button type="button" onClick={() => { setAberto(false); setErro(null); }} style={botaoLink}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}

function DetalheTrafoView({ id, props, base, aoVoltar, aoAbrirAlimentador, aoCentrar }:
  { id: number; props?: PropsPonto; base: RespostaMapa['base']; aoVoltar: () => void; aoAbrirAlimentador: (id: number) => void; aoCentrar: (lng: number, lat: number) => void }) {
  const q = useDetalheTrafo(id);
  const d = q.data;
  const risco: Risco = d?.risco ?? props?.risco ?? 'sem_dado';
  const codigo = d?.codigo ?? props?.codigo ?? `#${id}`;
  const veredito: Record<Risco, [string, string]> = {
    risco: ['Margem esgotada', 'A geração já conectada supera a carga mínima diurna estimada. Um novo projeto em baixa tensão neste trafo tende a inverter o fluxo.'],
    atencao: ['Margem apertada', `A geração conectada já passa de ${d?.regras.atencao ?? 60}% da margem estimada. Cabe pouco antes da inversão.`],
    folga: ['Há margem aparente', `A geração conectada fica abaixo de ${d?.regras.atencao ?? 60}% da capacidade de absorção estimada.`],
    sem_dado: ['Sem dado para avaliar', 'A base não traz carga ou geração para este trafo. Ausência de dado não é ausência de risco.'],
  };
  const [titulo, texto] = veredito[risco];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={aoVoltar} style={botaoLink}><ArrowLeft size={13} /> Voltar à lista</button>
      <div>
        <p style={rotuloSecao}>Transformador MT/BT · conexão em baixa tensão</p>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '4px 0 0' }}>{codigo}</h3>
        <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
          {d?.alimentador ? `Alimentador ${d.alimentador.codigo}` : d ? 'alimentador não informado' : 'lendo…'}{d?.subestacao ? ` · SE ${d.subestacao.nome ?? d.subestacao.codigo}` : ''}
        </p>
      </div>
      <div style={{ background: `${CORES[risco]}1A`, border: `1px solid ${CORES[risco]}59`, borderRadius: 11, padding: 13 }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800, color: CORES[risco], margin: '0 0 6px' }}>
          <AlertTriangle size={14} /> {titulo}
        </p>
        <p style={{ fontSize: 12.5, color: '#D5D5DD', margin: 0, lineHeight: 1.5 }}>{texto}</p>
      </div>
      {q.isError && <p style={{ ...nota, color: '#FF7A6B' }}>Não consegui ler o detalhe deste trafo.</p>}
      {d && (
        <>
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 6 }}>A rede de baixa tensão deste trafo</p>
            <div style={bloco}>
              <Par k="UCs atendidas" v={d.unidades_consumidoras == null ? <span title="Chega na próxima carga da BDGD" style={{ color: '#8A8A96' }}>—</span> : n0(d.unidades_consumidoras)} />
              <Par k="Unidades de GD já conectadas" v={d.gd_unidades == null ? <span style={{ color: '#8A8A96' }}>—</span> : n0(d.gd_unidades)} />
              <Par k="Potência nominal" v={kva(d.potencia_nominal_kva)} />
              <Par k="Ligação" v={d.fases ? `${FASES[d.fases] ?? `${d.fases} fases`}` : '—'} />
              <Par k="Tensão secundária" v={d.tensao_secundaria_v == null ? '—' : `${inteiro(d.tensao_secundaria_v)} V`} />
            </div>
            {d.unidades_consumidoras == null && <p style={{ ...nota, marginTop: 6 }}>UCs e unidades de GD por trafo passam a vir na próxima carga da BDGD.</p>}
          </div>
          <ContaAberta d={d} />
          <BarraOcupacao ocupacao={d.ocupacao_pct} risco={risco} limiarRisco={d.regras.risco} />
          <BaseAnterior d={d} />
          <Confronto d={d} />
          {d.alimentador && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={rotuloSecao}>Contexto de média tensão</p>
              {[['Alimentador', d.alimentador.codigo], ['Trafos no alimentador', `${inteiro(d.alimentador.trafos)} · ${inteiro(d.alimentador.trafos_risco)} em risco`],
                ['Ocupação do alimentador', pct(d.alimentador.ocupacao_pct)]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#9A9AA8' }}>{k}</span><span style={{ color: '#D5D5DD', fontWeight: 600, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
              <button type="button" onClick={() => aoAbrirAlimentador(d.alimentador!.id)} style={botaoLink}><GitBranch size={12} /> Ver o alimentador</button>
            </div>
          )}
          <CamposBdgd bdgd={d.bdgd} />
          <button type="button" onClick={() => aoCentrar(d.lng, d.lat)} style={botaoLink}><Crosshair size={13} /> Centralizar no mapa</button>
          <Procedencia base={{ ...base, distribuidora: d.distribuidora.nome }} fonte={d.fonte} />
        </>
      )}
    </div>
  );
}

function DetalheAlimentadorView({ id, props, regras, base, aoVoltar, aoEnquadrar }:
  { id: number; props?: PropsAlimentador; regras: RespostaMapa['regras']; base: RespostaMapa['base']; aoVoltar: () => void; aoEnquadrar: (c: Caixa) => void }) {
  const q = useDetalheAlimentador(id);
  const a = q.data;
  const risco: Risco = a?.risco ?? props?.risco ?? 'sem_dado';
  const codigo = a?.codigo ?? props?.codigo ?? `#${id}`;
  const caixa: Caixa | null =
    a && a.oeste !== null && a.sul !== null && a.leste !== null && a.norte !== null
      ? { oeste: a.oeste, sul: a.sul, leste: a.leste, norte: a.norte }
      : props ? { oeste: props.oeste, sul: props.sul, leste: props.leste, norte: props.norte } : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={aoVoltar} style={botaoLink}><ArrowLeft size={13} /> Voltar à lista</button>
      <div>
        <p style={rotuloSecao}>Alimentador de média tensão · contexto</p>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '4px 0 0' }}>{codigo}</h3>
        <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
          {a?.subestacao ? `SE ${a.subestacao}` : props?.subestacao ? `SE ${props.subestacao}` : 'subestação não informada'}
          {a?.distribuidora ? ` · ${a.distribuidora}` : ''}
        </p>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600,
                     color: '#ddd', padding: '4px 9px', borderRadius: 20, background: `${CORES[risco]}2E`, border: `1px solid ${CORES[risco]}80` }}>
        <AlertTriangle size={11} style={{ color: CORES[risco] }} /> {ROTULOS[risco]}
      </span>
      <p style={nota}>A MT raramente é o gargalo da GD em baixa tensão; o que decide é o trafo. Este agregado mostra onde a geração já pesa no circuito inteiro.</p>
      {a && (
        <>
          <div style={bloco}>
            <Par k="Carga mínima diurna estimada" v={kw(a.carga_min_diurna_kw)} />
            <Par k="GD já conectada" v={kw(a.gd_conectada_kw)} />
            <Par k="Margem até a inversão" v={<span style={{ color: CORES[risco] }}>{kw(a.margem_kw)}</span>} forte />
          </div>
          <BarraOcupacao ocupacao={a.ocupacao_pct} risco={risco} limiarRisco={regras.risco} />
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 7 }}>Trafos MT/BT neste alimentador · {inteiro(a.trafos)}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {ORDEM.map(r => {
                const n = { risco: a.trafos_risco, atencao: a.trafos_atencao, folga: a.trafos_folga, sem_dado: a.trafos_sem_dado }[r];
                return (
                  <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Ponto risco={r} /><span style={{ flex: 1, color: '#D5D5DD' }}>{ROTULOS[r]}</span>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{inteiro(n)}</span>
                    <span style={{ width: 36, textAlign: 'right', color: '#8A8A96' }}>{percentualDe(n, a.trafos)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          {!a.tem_tracado && <p style={nota}>Este alimentador ainda não tem traçado na base; a caixa vem dos trafos.</p>}
        </>
      )}
      {caixa && <button type="button" onClick={() => aoEnquadrar(caixa)} style={botaoLink}><Crosshair size={13} /> Enquadrar este alimentador</button>}
      <Procedencia base={base} />
    </div>
  );
}

function MudancasView({ m }: { m: Mudancas | null }) {
  if (!m) return <p style={nota}>Sem histórico registrado para esta carga.</p>;
  if (!m.anterior) return <p style={nota}>Sem carga anterior com histórico para comparar — a comparação começa na próxima BDGD.</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={nota}>Comparada à carga de {data(m.anterior.data_base)} (importação #{m.anterior.importacao_id}):</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 4, fontSize: 11.5, color: '#D5D5DD' }}>
        <span>Trafos novos: <strong>{n0(m.novos)}</strong></span><span>Inativados: <strong>{n0(m.inativados)}</strong></span>
        <span>Mudaram de estado: <strong>{n0(m.mudaram)}</strong></span><span>Iguais: <strong>{n0(m.iguais)}</strong></span>
      </div>
      {!!m.transicoes?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
          {m.transicoes.slice(0, 6).map(t => (
            <div key={`${t.de}-${t.para}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#D5D5DD' }}>
              <Ponto risco={t.de} />{ROTULOS[t.de]} <span style={{ color: '#8A8A96' }}>→</span> <Ponto risco={t.para} />{ROTULOS[t.para]}
              <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{inteiro(t.n)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportacaoView({ i }: { i: Importacao }) {
  const cor = i.situacao === 'concluida' ? '#5DD372' : i.situacao === 'falhou' ? '#FF7A6B' : GOLD;
  return (
    <details style={{ background: '#16161F', borderRadius: 9, padding: '9px 11px' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#D5D5DD' }}>
        <span style={{ fontWeight: 700, color: '#fff' }}>#{i.id}</span>
        <span>base {data(i.data_base)}</span>
        {i.versao_bdgd && <span style={{ color: '#9A9AA8' }}>{i.versao_bdgd}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: cor, textTransform: 'uppercase' }}>{i.situacao}</span>
      </summary>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5 }}>
        {[['Arquivo', i.arquivo_origem ?? '—'], ['Tamanho do zip', bytesLegiveis(i.tamanho_bytes)], ['Baixado em', dataHora(i.baixado_em)],
          ['Concluída em', dataHora(i.concluido_em)],
          ['Linhas', Object.entries(i.linhas_por_camada ?? {}).map(([k, v]) => `${k} ${inteiro(v)}`).join(' · ') || '—'],
          ['Regras na carga', i.regras ? `fator ${fator(i.regras.fator)} · atenção ${i.regras.atencao}% · risco ${i.regras.risco}% · janela ${i.regras.janela_inicio}h–${i.regras.janela_fim}h` : '—']].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: '#9A9AA8', flexShrink: 0 }}>{k}</span><span style={{ color: '#D5D5DD', fontWeight: 600, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ color: '#9A9AA8' }}>SHA-256</span>
          <span style={{ color: '#D5D5DD', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, wordBreak: 'break-all', textAlign: 'right', display: 'inline-flex', gap: 6, alignItems: 'flex-start' }}>
            {i.hash_sha256 ?? 'não registrado nesta carga'}{i.hash_sha256 && <Copiar texto={i.hash_sha256} />}
          </span>
        </div>
        {i.erro && <p style={{ ...nota, color: '#FF7A6B' }}>{i.erro}</p>}
        <div style={{ marginTop: 4 }}><p style={{ ...rotuloSecao, marginBottom: 4 }}>Mudanças</p><MudancasView m={i.mudancas} /></div>
      </div>
    </details>
  );
}

function FichaDaFonte({ aoVoltar }: { aoVoltar: () => void }) {
  const q = useFontes(true);
  const f = q.data;
  const regras = (g: RegrasCompletas) => `fator ${fator(g.fator)} · atenção ≥ ${g.atencao}% · risco ≥ ${g.risco}% · janela ${g.janela_inicio}h–${g.janela_fim}h`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={aoVoltar} style={botaoLink}><ArrowLeft size={13} /> Voltar</button>
      <div>
        <p style={rotuloSecao}>Auditoria</p>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={16} color={GOLD} /> Fonte dos dados</h3>
        <p style={{ ...nota, marginTop: 4 }}>
          O que está no mapa vem da BDGD (Base de Dados Geográfica da Distribuidora) que cada concessionária entrega à ANEEL, data-base 31/12. Aqui está qual arquivo, de que versão, com que regras e o que mudou desde a carga anterior.
        </p>
      </div>
      {q.isLoading && <p style={nota}>lendo…</p>}
      {q.isError && <p style={{ ...nota, color: '#FF7A6B' }}>Não consegui ler a ficha da fonte.</p>}
      {f && (
        <>
          <div style={{ border: '1px solid rgba(245,168,0,0.3)', background: 'rgba(245,168,0,0.08)', borderRadius: 11, padding: 12 }}>
            <p style={{ ...rotuloSecao, color: '#E3B341', marginBottom: 4 }}>Regras vigentes agora</p>
            <p style={{ fontSize: 12, color: '#D5D5DD', margin: 0 }}>{regras(f.regras_atuais)}</p>
            <p style={{ ...nota, marginTop: 4 }}>Mudar uma regra no Motor de Engenharia muda o semáforo na próxima recarga; cada carga guarda as regras com que foi calculada.</p>
          </div>
          {f.distribuidoras.map(d => (
            <div key={d.distribuidora.id} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0 }}>{d.distribuidora.nome}</p>
                <p style={{ ...nota }}>{d.distribuidora.sigla} · código ANEEL {d.distribuidora.codigo_aneel ?? '—'} · {d.distribuidora.uf} · data-base {data(d.distribuidora.data_base)}</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6, fontSize: 11.5, color: '#D5D5DD' }}>
                <span>Trafos ativos <strong>{inteiro(d.trafos.ativos)}</strong></span>
                <span>Inativos <strong>{inteiro(d.trafos.inativos)}</strong></span>
                <span style={{ color: CORES.risco }}>Em risco <strong>{inteiro(d.trafos.risco)}</strong></span>
                <span style={{ color: CORES.atencao }}>Em atenção <strong>{inteiro(d.trafos.atencao)}</strong></span>
                <span>Com folga <strong>{inteiro(d.trafos.folga)}</strong></span>
                <span>Sem dado <strong>{inteiro(d.trafos.sem_dado)}</strong></span>
                <span>Com UCs contadas <strong>{inteiro(d.trafos.com_ucs)}</strong></span>
                <span>Alimentadores <strong>{inteiro(d.alimentadores.ativos)}</strong> · traçado {inteiro(d.alimentadores.com_tracado)}</span>
              </div>
              {d.trafos.com_ucs === 0 && <p style={nota}>UCs e unidades de GD por trafo entram na próxima carga.</p>}
              <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, padding: '8px 10px', fontSize: 11.5, color: '#D5D5DD' }}>
                <p style={{ ...rotuloSecao, marginBottom: 4 }}>Confronto com pareceres reais</p>
                {d.confrontos.n === 0 ? <span style={{ color: '#8A8A96' }}>Nenhum orçamento ou parecer registrado ainda.</span> : (
                  <span>{inteiro(d.confrontos.n)} registrados · <strong style={{ color: '#5DD372' }}>{inteiro(d.confrontos.acertos)} acertos</strong> · <strong style={{ color: '#FF7A6B' }}>{inteiro(d.confrontos.erros)} erros</strong>
                    {d.confrontos.sem_conta > 0 ? ` · ${inteiro(d.confrontos.sem_conta)} sem conta` : ''}
                    {d.confrontos.acertos + d.confrontos.erros > 0 ? ` · taxa de acerto ${percentualDe(d.confrontos.acertos, d.confrontos.acertos + d.confrontos.erros)}%` : ''}</span>
                )}
              </div>
              <p style={{ ...rotuloSecao, marginTop: 2 }}>Cargas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {d.importacoes.map(i => <ImportacaoView key={i.id} i={i} />)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export const PainelLateral = memo(function PainelLateral({ resposta, carregando, selecao, aoSelecionar, aoEnquadrar, aoCentrar }: Props) {
  const [mostrar, setMostrar] = useState(PAGINA);
  const pontos = resposta?.pontos?.features ?? [];
  const alims = (resposta?.alimentadores?.features.map(f => f.properties) ?? [])
    .slice().sort((a, b) => (b.ocupacao_pct ?? -1) - (a.ocupacao_pct ?? -1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
      {resposta && !selecao && <Resumo r={resposta.resumo} camada={resposta.camada} />}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy={carregando}>
        {selecao?.tipo === 'fonte' && <FichaDaFonte aoVoltar={() => aoSelecionar(null)} />}
        {selecao?.tipo === 'trafo' && (
          <DetalheTrafoView id={selecao.id} props={selecao.props} base={resposta?.base ?? {}}
                            aoVoltar={() => aoSelecionar(null)} aoAbrirAlimentador={id => aoSelecionar({ tipo: 'alimentador', id })} aoCentrar={aoCentrar} />
        )}
        {selecao?.tipo === 'alimentador' && resposta && (
          <DetalheAlimentadorView id={selecao.id} props={selecao.props} regras={resposta.regras} base={resposta.base}
                                  aoVoltar={() => aoSelecionar(null)} aoEnquadrar={aoEnquadrar} />
        )}

        {!selecao && resposta?.camada === 'ponto' && pontos.length > 0 && (
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 6 }}>Transformadores nesta vista · dos mais ocupados aos com folga</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {pontos.slice(0, mostrar).map(f => {
                const p = f.properties;
                const [lng, lat] = ((f.geometry as { coordinates?: number[] })?.coordinates ?? [0, 0]);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => { aoSelecionar({ tipo: 'trafo', id: p.id, props: p }); aoCentrar(lng, lat); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: 'none',
                                     border: 'none', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                      <Ponto risco={p.risco} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#ddd' }}>{p.codigo}</span>
                      <span style={{ fontSize: 11, color: '#8A8A96', whiteSpace: 'nowrap' }}>{pct(p.ocupacao_pct)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {pontos.length > mostrar && (
              <button type="button" onClick={() => setMostrar(m => m + PAGINA)} style={{ ...botaoLink, marginTop: 6 }}>
                Mostrar mais {Math.min(PAGINA, pontos.length - mostrar)} de {inteiro(pontos.length - mostrar)} restantes
              </button>
            )}
          </div>
        )}

        {!selecao && resposta?.camada === 'celula' && alims.length === 0 && (
          <p style={nota}>
            Área densa: os trafos estão resumidos em células. Aproxime (ou clique numa célula) até caberem um a um — aí a lista aparece aqui.
            Os alimentadores de MT aparecem a partir do zoom 9 quando a camada está ligada; até o 10, só os em risco ou atenção.
          </p>
        )}

        {!selecao && alims.length > 0 && (
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 6 }}>Alimentadores de MT mais saturados na vista</p>
            <div style={bloco}>
              {alims.slice(0, 12).map(a => (
                <button key={a.id} type="button" onClick={() => aoSelecionar({ tipo: 'alimentador', id: a.id, props: a })}
                        style={{ ...linha, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', alignItems: 'center' }}>
                  <Ponto risco={a.risco} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{a.codigo}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: '#8A8A96' }}>
                      {a.subestacao ? `SE ${a.subestacao} · ` : ''}{inteiro(a.trafos)} trafos · {inteiro(a.trafos_risco)} em risco
                    </span>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: CORES[a.risco] }}>{pct(a.ocupacao_pct)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!selecao && resposta && <Procedencia base={resposta.base} />}
      </div>
    </div>
  );
});
