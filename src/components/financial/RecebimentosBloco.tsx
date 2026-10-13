import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Wallet } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Recebimento, useEstornarRecebimento, useRecebimentos } from '@/hooks/useRecebimentos';

/**
 * PAGAMENTOS RECEBIDOS — "o valor pago no dia e o que ele quitou".
 *
 * O mesmo bloco serve o admin (`/admin/financial`, todas as empresas ou o
 * dossiê de uma) e a empresa (`/company/financial`, só a dela, sem estorno).
 * A empresa já lê os próprios recebimentos por RLS; o componente não inventa
 * acesso.
 *
 * Escrito na linguagem visual da tela do financeiro (preto/dourado, cartão
 * branco de 12px) e não em shadcn: o bloco vive dentro dessas telas, e em
 * shadcn ele parecia outro produto encaixado no meio.
 *
 * Dois modos:
 *   - `compacto` — só os últimos, para o panorama. O histórico completo é
 *     pergunta de dossiê, não de visão geral.
 *   - cheio — o histórico da empresa escolhida.
 */

const fmt = formatCurrency;

const dia = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #ECECEC', borderRadius: 12, overflow: 'hidden',
};
const TAG: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', padding: '3px 7px',
  borderRadius: 5, textTransform: 'uppercase', whiteSpace: 'nowrap',
};
const SELO: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, padding: '3px 7px', borderRadius: 5, flexShrink: 0,
};
const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

function Linhas({ r }: { r: Recebimento }) {
  if (r.linhas.length === 0) {
    return (
      <p style={{ fontSize: 11.5, color: '#999', padding: '10px 18px', margin: 0 }}>
        Este valor não foi aplicado em nada — ficou inteiro como crédito.
      </p>
    );
  }
  return (
    <div>
      {r.linhas.map((l, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 11,
            padding: '9px 18px 9px 42px',
            borderBottom: i === r.linhas.length - 1 ? 'none' : '1px solid #F2F2F0',
          }}
        >
          <span style={{
            ...SELO,
            background: l.quitou ? '#E1F5EE' : '#E6F1FB',
            color: l.quitou ? '#0F6E56' : '#185FA5',
          }}>
            {l.quitou ? 'QUITOU' : 'ABATEU'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 12.5, fontWeight: 600, margin: 0, color: '#1A1A1A',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {l.rotulo}
              {l.tipo === 'assinatura' && (
                <span style={{ ...SELO, background: '#F1F0FB', color: '#3C3489', marginLeft: 6 }}>
                  MENSALIDADE
                </span>
              )}
            </p>
            {l.detalhe && (
              <p style={{
                fontSize: 11, color: '#999', margin: '1px 0 0',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {l.detalhe}
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ ...NUM, fontSize: 12.5, fontWeight: 700, margin: 0, color: '#1A1A1A' }}>
              {fmt(l.valor)}
            </p>
            {!l.quitou && l.total > 0 && (
              <p style={{ ...NUM, fontSize: 10.5, color: '#999', margin: 0 }}>de {fmt(l.total)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Cartao({ r, podeEstornar, mostrarEmpresa, ultimo }: {
  r: Recebimento; podeEstornar: boolean; mostrarEmpresa: boolean; ultimo: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const estornar = useEstornarRecebimento();
  const estornado = !!r.reversed_at;
  const deduzido = r.origin === 'reconstruido';

  return (
    <div style={{
      borderBottom: ultimo ? 'none' : '1px solid #F4F4F2',
      opacity: estornado ? 0.62 : 1,
    }}>
      <button
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 11,
          padding: '12px 18px', border: 'none', background: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {aberto
          ? <ChevronDown size={14} style={{ color: '#B5B5B5', flexShrink: 0 }} />
          : <ChevronRight size={14} style={{ color: '#B5B5B5', flexShrink: 0 }} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ ...NUM, fontSize: 13, fontWeight: 700, color: '#1A1A1A' }}>
              {dia(r.received_date)}
            </span>
            {mostrarEmpresa && (
              <span style={{
                fontSize: 12, color: '#8A8A8A', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220,
              }}>
                {r.company_name}
              </span>
            )}
            {deduzido && (
              <span
                style={{ ...TAG, background: '#F1F0FB', color: '#3C3489', border: '1px dashed #BDB8EE' }}
                title="Não foi lançado por ninguém: o sistema somou os pagamentos desta empresa nesta data para reconstruir o depósito."
              >
                reconstruído
              </span>
            )}
            {estornado && (
              <span style={{ ...TAG, background: '#FDECEC', color: '#A32D2D' }}>estornado</span>
            )}
            {r.credit > 0 && !estornado && (
              <span style={{ ...TAG, background: '#FEF3D0', color: '#854F0B' }}>
                {fmt(r.credit)} de crédito
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: '#B5B5B5', margin: '3px 0 0' }}>
            {r.linhas.length === 1 ? '1 item' : r.linhas.length + ' itens'}
            {deduzido ? ' · deduzido do histórico do dia' : ' · lançado por ' + r.criado_por}
            {r.notes ? ' · ' + r.notes : ''}
          </p>
        </div>

        <span style={{
          ...NUM, fontSize: 15, fontWeight: 700, flexShrink: 0, letterSpacing: '-0.02em',
          color: estornado ? '#B5B5B5' : '#1A1A1A',
          textDecoration: estornado ? 'line-through' : 'none',
        }}>
          {fmt(r.amount)}
        </span>
      </button>

      {aberto && (
        <div style={{ background: '#FBFBFA', borderTop: '1px solid #F0F0EE' }}>
          <Linhas r={r} />
          {deduzido && (
            <p style={{
              fontSize: 11, color: '#3C3489', background: '#F6F5FD',
              padding: '9px 18px', margin: 0, borderTop: '1px solid #EDEBF9', lineHeight: 1.5,
            }}>
              Reconstruído: o sistema somou os pagamentos desta empresa nesta data.
              Se sobrou dinheiro no depósito original, essa sobra não foi registrada
              na época e portanto não aparece como crédito. Como este agrupamento é
              deduzido, ele não tem estorno — para desfazer um pagamento, use o
              estorno dentro do projeto, que é onde ele foi lançado.
            </p>
          )}
          {estornado && r.reversal_reason && (
            <p style={{
              fontSize: 11.5, color: '#A32D2D', padding: '9px 18px', margin: 0,
              borderTop: '1px solid #F0F0EE',
            }}>
              Estorno: {r.reversal_reason}
            </p>
          )}
          {/* Cartão reconstruído NÃO tem estorno. Ele é um agrupamento deduzido;
              estorná-lo lançaria contrapartidas negativas em pagamentos reais,
              e quem clicasse achando que estava desfazendo a RECONSTRUÇÃO
              estaria desfazendo DINHEIRO. Para reverter um pagamento antigo, o
              caminho continua sendo o estorno dentro do projeto. */}
          {(r.credit > 0 || (podeEstornar && !estornado && !deduzido)) && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: 10, padding: '10px 18px', borderTop: '1px solid #F0F0EE', flexWrap: 'wrap',
            }}>
              <p style={{ fontSize: 11, color: '#8A8A8A', margin: 0 }}>
                {r.credit > 0
                  ? `Sobra de ${fmt(r.credit)} guardada como crédito — entra no próximo recebimento.`
                  : ''}
              </p>
              {podeEstornar && !estornado && !deduzido && (
                <button
                  onClick={() => {
                    const motivo = window.prompt(
                      'Estornar este recebimento desfaz todas as parcelas dele. Qual o motivo?',
                    );
                    if (motivo === null) return;
                    estornar.mutate({ id: r.id, motivo: motivo.trim() || undefined });
                  }}
                  disabled={estornar.isPending}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5,
                    fontWeight: 700, color: '#E24B4A', background: 'none', border: 'none',
                    cursor: estornar.isPending ? 'default' : 'pointer', padding: 0,
                    opacity: estornar.isPending ? 0.5 : 1,
                  }}
                >
                  {estornar.isPending
                    ? <Loader2 size={13} className="animate-spin" />
                    : <RotateCcw size={13} />}
                  Estornar o recebimento inteiro
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RecebimentosBloco({
  companyId, podeEstornar, titulo, subtitulo, limite = 50, compacto, rodape,
}: {
  /** nulo = todas as empresas do tenant (visão do admin) */
  companyId?: string | null;
  podeEstornar?: boolean;
  titulo?: string;
  subtitulo?: string;
  limite?: number;
  /** panorama: mostra só os últimos e não promete histórico completo */
  compacto?: boolean;
  rodape?: React.ReactNode;
}) {
  const { data: todos = [], isLoading, isError } = useRecebimentos(companyId ?? null, limite);
  const recebimentos = compacto ? todos.slice(0, 4) : todos;
  const total = todos
    .filter(r => !r.reversed_at)
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div style={CARD}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 18px', borderBottom: '1px solid #ECECEC',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: '#FEF3D0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Wallet size={14} color="#854F0B" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
            {titulo ?? 'Pagamentos recebidos'}
          </p>
          <p style={{ fontSize: 11, color: '#8A8A8A', margin: '2px 0 0' }}>
            {subtitulo ?? 'O valor que entrou e o que ele quitou'}
            {todos.length > 0 && ` · ${todos.length} ${todos.length === 1 ? 'recebimento' : 'recebimentos'}`}
          </p>
        </div>
        {total > 0 && (
          <span style={{
            ...NUM, fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 20,
            background: '#E1F5EE', color: '#0F6E56', whiteSpace: 'nowrap',
          }}>
            {fmt(total)}
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '26px 0' }}>
          <Loader2 size={18} className="animate-spin" style={{ color: '#F5A800' }} />
        </div>
      ) : isError ? (
        <p style={{ fontSize: 12.5, color: '#E24B4A', padding: '18px', margin: 0 }}>
          Não consegui ler os recebimentos. Recarregue a página.
        </p>
      ) : recebimentos.length === 0 ? (
        <p style={{
          fontSize: 12.5, color: '#999', padding: '24px 18px', margin: 0,
          textAlign: 'center', lineHeight: 1.6,
        }}>
          Nenhum pagamento registrado ainda. Quando um valor for lançado, ele aparece
          aqui com o que foi quitado e o que foi abatido.
        </p>
      ) : (
        <>
          {recebimentos.map((r, i) => (
            <Cartao
              key={r.id}
              r={r}
              podeEstornar={!!podeEstornar}
              mostrarEmpresa={!companyId}
              ultimo={i === recebimentos.length - 1 && !rodape && todos.length <= recebimentos.length}
            />
          ))}
          {rodape && (
            <div style={{ padding: '11px 18px', borderTop: '1px solid #ECECEC', textAlign: 'center' }}>
              {rodape}
            </div>
          )}
        </>
      )}
    </div>
  );
}
