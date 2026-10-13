import { useRef, useState } from 'react';
import { FileSignature, Loader2, ShieldCheck, ShieldAlert, Eye, Check, X, Upload } from 'lucide-react';
import { format } from 'date-fns';
import {
  Assinatura, SituacaoAssinatura, useAprovarAssinatura, useAssinaturasDoProjeto,
  useCatalogoAssinavel, useCertificadoAtivo, usePedirAssinatura, useRecusarAssinatura, urlDoArquivo,
} from '@/hooks/useAssinaturas';

/**
 * ASSINATURAS DO PROJETO.
 *
 * O botão só aparece com certificado conferido. O arquivo escolhido aqui entra
 * com a marca do tipo (RPC): é isto, e só isto, que torna um documento
 * assinável — anexo da aba de Documentos não ganha botão.
 */

const ROTULO: Record<SituacaoAssinatura, { texto: string; cor: string; fundo: string }> = {
  preparando:    { texto: 'Preparando o PDF…',        cor: '#8A5300', fundo: '#FEF3D0' },
  conferir:      { texto: 'Confira antes de assinar', cor: '#185FA5', fundo: '#E3F0FB' },
  triagem:       { texto: 'Em triagem',               cor: '#8A5300', fundo: '#FEF3D0' },
  aguardando_ze: { texto: 'Esperando liberação',      cor: '#7C3AED', fundo: '#F3E8FF' },
  pendente:      { texto: 'Na fila para assinar',     cor: '#8A5300', fundo: '#FEF3D0' },
  assinando:     { texto: 'Assinando…',               cor: '#8A5300', fundo: '#FEF3D0' },
  assinado:      { texto: 'Assinado',                 cor: '#1B7F4C', fundo: '#E6F6EC' },
  recusado:      { texto: 'Recusado',                 cor: '#B3261E', fundo: '#FDECEA' },
  erro:          { texto: 'Deu erro',                 cor: '#B3261E', fundo: '#FDECEA' },
};

async function abrir(path: string | null) {
  if (!path) return;
  const url = await urlDoArquivo(path);
  if (url) window.open(url, '_blank', 'noopener');
}

const botaoClaro: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 7,
  border: '1px solid #E0E0E0', background: '#fff', color: '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const botaoForte: React.CSSProperties = {
  ...botaoClaro, border: 'none', background: '#F5A800', color: '#1A1A1A',
};

function Linha({ a, projectId }: { a: Assinatura; projectId: string }) {
  const aprovar = useAprovarAssinatura();
  const recusar = useRecusarAssinatura();
  const r = ROTULO[a.situacao];

  return (
    <div style={{ border: '1px solid #F0F0F0', borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: r.cor, background: r.fundo }}>
          {r.texto}
        </span>
        <span style={{ fontSize: 11, color: '#999', fontFamily: 'ui-monospace, monospace' }}>
          {a.codigo_verificacao}
        </span>
        <span style={{ fontSize: 11, color: '#999', marginLeft: 'auto' }}>
          {format(new Date(a.pedida_em), 'dd/MM/yyyy HH:mm')}
        </span>
      </div>

      {a.titular_nome && (
        <p style={{ fontSize: 12, color: '#666', marginTop: 6 }}>e-CPF de {a.titular_nome}</p>
      )}
      {a.motivo && <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{a.motivo}</p>}
      {/* `recusa` também guarda o motivo da DÚVIDA (linha em "Esperando liberação"):
          vermelho só quando o pedido foi de fato recusado */}
      {a.recusa && (
        <p style={{ fontSize: 12, color: a.situacao === 'recusado' ? '#B3261E' : '#888', marginTop: 4 }}>{a.recusa}</p>
      )}
      {a.erro && <p style={{ fontSize: 12, color: '#B3261E', marginTop: 4 }}>{a.erro}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {a.documento_aprovado_path && (
          <button onClick={() => abrir(a.documento_aprovado_path)} style={botaoClaro}>
            <Eye size={13} /> Ver o PDF
          </button>
        )}
        {a.situacao === 'conferir' && (
          <>
            <button
              onClick={() => aprovar.mutate({ id: a.id, projectId })}
              disabled={aprovar.isPending}
              style={botaoForte}
            >
              {aprovar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Está certo, assine
            </button>
            <button onClick={() => recusar.mutate({ id: a.id, projectId })} disabled={recusar.isPending} style={botaoClaro}>
              <X size={13} /> Cancelar
            </button>
          </>
        )}
        {['preparando', 'triagem', 'pendente', 'aguardando_ze', 'erro'].includes(a.situacao) && (
          <button onClick={() => recusar.mutate({ id: a.id, projectId })} disabled={recusar.isPending} style={botaoClaro}>
            <X size={13} /> Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * `companyId` é a empresa dona do projeto: o primeiro segmento do caminho no
 * bucket `project-documents` tem de ser o id dela (policy de INSERT do storage).
 */
export function TabAssinaturas({ projectId, companyId }: { projectId: string; companyId: string }) {
  const { data: assinaturas = [], isLoading } = useAssinaturasDoProjeto(projectId);
  const { data: catalogo = [] } = useCatalogoAssinavel();
  const { data: certificado } = useCertificadoAtivo();
  const pedir = usePedirAssinatura();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState('');
  const [motivo, setMotivo] = useState('');

  const podeAssinar = certificado?.situacao === 'ok';
  // espelha a RPC documento_para_assinar, que recusa origem 'gerado'
  const tiposQueAceitamArquivo = catalogo.filter(t => t.origem !== 'gerado');

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !tipo) return;
    try {
      await pedir.mutateAsync({ projectId, companyId, assinavelId: tipo, motivo: motivo.trim() || undefined, file });
      setMotivo('');
    } catch {
      // o toast de erro já saiu no onError do hook
    } finally {
      input.value = '';
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {/* estado do certificado */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 9, marginBottom: 14,
        background: podeAssinar ? '#E6F6EC' : '#FDECEA',
      }}>
        {podeAssinar ? <ShieldCheck size={16} color="#1B7F4C" /> : <ShieldAlert size={16} color="#B3261E" />}
        <span style={{ fontSize: 12, color: podeAssinar ? '#1B7F4C' : '#B3261E' }}>
          {!certificado
            ? 'Nenhum certificado cadastrado — o admin cadastra em Assinaturas.'
            : certificado.situacao === 'conferindo'
              ? 'Conferindo o certificado…'
              : podeAssinar
                ? `Certificado de ${certificado.titular_nome}${certificado.validade_fim ? ` · vence em ${format(new Date(`${certificado.validade_fim}T00:00:00`), 'dd/MM/yyyy')}` : ''}`
                : `Certificado ${certificado.situacao}${certificado.erro ? ` — ${certificado.erro}` : ''}`}
        </span>
      </div>

      {/* pedir */}
      {podeAssinar && (
        <div style={{ border: '1px dashed #E0E0E0', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>Assinar documento</p>
          <select
            value={tipo} onChange={e => setTipo(e.target.value)}
            style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 12, marginBottom: 8 }}
          >
            <option value="">Que documento é este?</option>
            {tiposQueAceitamArquivo.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          <input
            value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Para que é a assinatura? (opcional)"
            style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 12, marginBottom: 8 }}
          />
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.docx,.doc" style={{ display: 'none' }} onChange={escolher} />
          <button onClick={() => fileRef.current?.click()} disabled={!tipo || pedir.isPending} style={{ ...botaoForte, opacity: tipo ? 1 : 0.5 }}>
            {pedir.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Escolher o arquivo
          </button>
          <p style={{ fontSize: 10.5, color: '#999', marginTop: 8 }}>
            Só documento de projeto. Contrato, proposta e documento pessoal não entram aqui.
          </p>
        </div>
      )}

      {/* o que já houve */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Loader2 size={18} className="animate-spin" color="#F5A800" /></div>
      ) : assinaturas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
          <FileSignature size={32} color="#E0E0E0" />
          <p style={{ fontSize: 12, marginTop: 8 }}>Nenhuma assinatura neste projeto</p>
        </div>
      ) : (
        assinaturas.map(a => <Linha key={a.id} a={a} projectId={projectId} />)
      )}
    </div>
  );
}
