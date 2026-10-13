import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancialsByCompany } from "@/hooks/useFinancials";
import { useCompanySubscriptionStatement } from "@/hooks/useSubscriptionCharges";
import { useCreditoDaEmpresa } from "@/hooks/useRecebimentos";
import { useEmpresasResumo } from "@/hooks/useDossieFinanceiro";
import { RecebimentosBloco } from "@/components/financial/RecebimentosBloco";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Loader2, Repeat, Wallet } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * "Meu Financeiro" da empresa integradora.
 *
 * Esta é a tela que o CLIENTE abre, e por isso ela segue a mesma linguagem
 * visual do financeiro da equipe (preto/dourado, cartão branco de 12px,
 * dinheiro à direita em número tabular). Antes era shadcn de fábrica e
 * parecia outro produto — pedido do usuário, out/2026: "deixar esta página
 * com uma cara mais profissional".
 *
 * Na assinatura mensal a empresa paga DUAS coisas diferentes, e ver as duas
 * somadas num bloco só confunde (decisão do usuário, jul/2026): a mensalidade
 * uma vez por mês, e a ART de cada projeto. Por isso há um bloco para cada, e
 * os totais do topo somam os dois — é o que ela realmente deve.
 *
 * "Meus pagamentos" vem ANTES das tabelas porque é a primeira pergunta que a
 * empresa faz ao entrar: "o que eu já paguei e o que isso abateu?". Só
 * leitura — quem lança e quem estorna é a equipe do tenant.
 *
 * Empresa sem assinatura não vê o bloco de mensalidade (a RPC volta vazia).
 */

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #ECECEC', borderRadius: 12, overflow: 'hidden',
};
const TH: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
  color: '#8A8A8A', textAlign: 'left', padding: '9px 14px', borderBottom: '1px solid #ECECEC',
};
const TD: React.CSSProperties = { padding: '11px 14px', borderBottom: '1px solid #F4F4F2', fontSize: 12.5 };

const STATUS: Record<string, { label: string; bg: string; cor: string }> = {
  pending: { label: 'PENDENTE', bg: '#FEF3D0', cor: '#854F0B' },
  partial: { label: 'PARCIAL',  bg: '#E6F1FB', cor: '#185FA5' },
  paid:    { label: 'PAGA',     bg: '#E1F5EE', cor: '#0F6E56' },
};

function Selo({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      background: s.bg, color: s.cor, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function KpiEscuro({ label, valor, sub, cor }: {
  label: string; valor: string; sub?: string; cor: string;
}) {
  return (
    <div>
      <p style={{
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.44)', margin: 0,
      }}>
        {label}
      </p>
      <p style={{ ...NUM, fontSize: 22, fontWeight: 700, color: cor, margin: '7px 0 2px', letterSpacing: '-0.02em' }}>
        {valor}
      </p>
      {sub && <p style={{ ...NUM, fontSize: 11, color: 'rgba(255,255,255,0.38)', margin: 0 }}>{sub}</p>}
    </div>
  );
}

function CabecalhoCard({ titulo, sub, icone: Icone, pill }: {
  titulo: string; sub: string; icone?: typeof Wallet; pill?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px',
      borderBottom: '1px solid #ECECEC',
    }}>
      {Icone && <Icone size={15} style={{ color: '#8A8A8A', flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{titulo}</p>
        <p style={{ fontSize: 11, color: '#8A8A8A', margin: '2px 0 0' }}>{sub}</p>
      </div>
      {pill && (
        <span style={{
          ...NUM, fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 20,
          background: '#FEF3D0', color: '#854F0B', whiteSpace: 'nowrap',
        }}>
          {pill}
        </span>
      )}
    </div>
  );
}

export default function CompanyFinancial() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: financials = [], isLoading } = useFinancialsByCompany(user?.companyId);
  const { data: assinaturas = [], isLoading: loadingAssinaturas } = useCompanySubscriptionStatement();
  const { data: credito = 0 } = useCreditoDaEmpresa(user?.companyId ?? null);
  // a RPC devolve só a própria empresa para quem é usuário de empresa — é de
  // onde vem o nome, que o contexto de autenticação não carrega
  const { data: empresas = [] } = useEmpresasResumo();
  // casa pelo id em vez de pegar a primeira linha: para a empresa a RPC só
  // devolve a dela, mas se um dia alguém da equipe abrir esta tela, pegar
  // `[0]` mostraria o nome de OUTRA empresa no cabeçalho
  const minhaEmpresa = empresas.find(e => e.company_id === user?.companyId);

  const temAssinatura = assinaturas.length > 0;

  const projetos = financials.reduce((acc, f) => {
    acc.billed += f.project_value;
    acc.paid += f.paid_value;
    return acc;
  }, { billed: 0, paid: 0 });

  const assinatura = assinaturas.reduce((acc, s) => {
    acc.billed += s.amount;
    acc.paid += s.amount_paid;
    return acc;
  }, { billed: 0, paid: 0 });

  const totalBilled = projetos.billed + assinatura.billed;
  const totalPaid = projetos.paid + assinatura.paid;
  const totalPending = totalBilled - totalPaid;
  const pctPago = totalBilled > 0 ? (totalPaid / totalBilled) * 100 : 0;

  const abertos = financials.filter(f => f.project_value - f.paid_value > 0).length;
  const mensalidadesAbertas = assinaturas.filter(s => s.amount - s.amount_paid > 0).length;

  if (isLoading || loadingAssinaturas) {
    return (
      <MainLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Loader2 size={30} className="animate-spin" style={{ color: '#F5A800' }} />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div>
        {/* ── Cabeçalho ── */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 25, fontWeight: 700, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>
            Meu financeiro
          </h1>
          <p style={{ fontSize: 12.5, color: '#8A8A8A', margin: '3px 0 0' }}>
            {minhaEmpresa?.company_name ? minhaEmpresa.company_name + ' · ' : ''}
            {temAssinatura
              ? 'assinatura mensal e ARTs dos seus projetos'
              : 'seus valores e pagamentos'}
          </p>
        </div>

        {/* ── A posição, em três números ── */}
        <div style={{ background: '#1A1A1A', borderRadius: 14, padding: '22px 26px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, background: '#F5A800', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800,
              color: '#1A1A1A', flexShrink: 0,
            }}>
              GD
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#fff' }}>
                Sua posição com a GD Manager
              </p>
              <p style={{ margin: '1px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                Atualizado em {new Date().toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 26 }}>
            <KpiEscuro
              label="Total contratado" valor={fmt(totalBilled)} cor="#fff"
              sub={temAssinatura
                ? `${fmt(assinatura.billed)} assinatura · ${fmt(projetos.billed)} ARTs`
                : `${financials.length} ${financials.length === 1 ? 'projeto' : 'projetos'}`}
            />
            <KpiEscuro
              label="Total pago" valor={fmt(totalPaid)} cor="#4CAF7D"
              sub={`${pctPago.toFixed(0)}% do contratado`}
            />
            <KpiEscuro
              label="Em aberto" valor={fmt(totalPending)}
              cor={totalPending > 0 ? '#F5A800' : '#4CAF7D'}
              sub={temAssinatura
                ? `${mensalidadesAbertas} ${mensalidadesAbertas === 1 ? 'mensalidade' : 'mensalidades'} · ${abertos} ${abertos === 1 ? 'ART' : 'ARTs'}`
                : `${abertos} ${abertos === 1 ? 'projeto' : 'projetos'}`}
            />
          </div>
        </div>

        {/* O crédito é dinheiro dela parado aqui: aparece em destaque, não em
            letra miúda. */}
        {credito > 0 && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FEF9EC',
            border: '1px solid #F3E2B4', borderRadius: 10, padding: '12px 14px', marginBottom: 14,
          }}>
            <Wallet size={15} style={{ color: '#854F0B', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: '#5B4708', margin: 0, lineHeight: 1.55 }}>
              Você tem <strong>{fmt(credito)} de crédito</strong> de um pagamento anterior.
              Ele será usado no próximo lançamento que a GD Manager fizer.
            </p>
          </div>
        )}

        {/* ── O que foi pago e o que isso quitou ── */}
        <div style={{ marginBottom: 14 }}>
          <RecebimentosBloco
            companyId={user?.companyId ?? null}
            titulo="Meus pagamentos"
            subtitulo="Cada valor que você pagou e o que ele quitou"
            limite={300}
          />
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: temAssinatura ? 'repeat(auto-fit, minmax(330px, 1fr))' : '1fr',
          gap: 14, alignItems: 'start',
        }}>
          {/* ── Assinatura mensal — só para quem tem esse plano ── */}
          {temAssinatura && (
            <div style={CARD}>
              <CabecalhoCard
                titulo="Assinatura mensal" icone={Repeat}
                sub="A mensalidade cobre a franquia de projetos do mês"
              />
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Competência</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Mensalidade</th>
                    <th style={TH}>Projetos do mês</th>
                    <th style={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assinaturas.map(s => {
                    const pendente = s.amount - s.amount_paid;
                    return (
                      <tr key={s.id}>
                        <td style={{ ...TD, fontWeight: 600, textTransform: 'capitalize' }}>
                          {format(new Date(`${s.competence}T00:00:00`), "MMMM 'de' yyyy", { locale: ptBR })}
                        </td>
                        <td style={{ ...TD, ...NUM, textAlign: 'right', fontWeight: 700 }}>
                          {fmt(s.amount)}
                          {pendente > 0 && (
                            <span style={{ ...NUM, display: 'block', fontSize: 10.5, color: '#854F0B', fontWeight: 400 }}>
                              {fmt(pendente)} em aberto
                            </span>
                          )}
                        </td>
                        <td style={{ ...TD, fontSize: 11.5 }}>
                          {s.project_limit == null ? (
                            <span style={{ color: '#8A8A8A' }}>{s.projects_count}</span>
                          ) : (
                            <>
                              {s.projects_count} de {s.project_limit} da franquia
                              {s.excess_count > 0 && (
                                <span style={{ display: 'block', fontSize: 10.5, color: '#854F0B' }}>
                                  {s.excess_count} além da franquia
                                  {s.excess_value > 0 && ` · ${fmt(s.excess_value)} por projeto`}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td style={TD}><Selo status={s.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{
                fontSize: 11, color: '#8A8A8A', margin: 0, padding: '11px 18px',
                borderTop: '1px solid #F4F4F2', lineHeight: 1.55,
              }}>
                Cada projeto é cobrado à parte apenas pela ART; projeto que passa da
                franquia soma o valor adicional.
              </p>
            </div>
          )}

          {/* ── ARTs / projetos ── */}
          <div style={CARD}>
            <CabecalhoCard
              titulo={temAssinatura ? 'ARTs por projeto' : 'Meus projetos'}
              sub="Clique numa linha para abrir o projeto"
              pill={abertos > 0 ? `${abertos} em aberto` : undefined}
            />
            {financials.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#999', textAlign: 'center', padding: '28px 18px', margin: 0 }}>
                Nenhum registro financeiro encontrado.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Projeto</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Valor</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Em aberto</th>
                    <th style={TH}>Status</th>
                    <th style={{ ...TH, width: 26 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {financials.map(f => {
                    const pendente = f.project_value - f.paid_value;
                    return (
                      <tr
                        key={f.id}
                        onClick={() => navigate(`/project/${f.project_id}`)}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#FAFAFA'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={TD}>
                          <div style={{ fontWeight: 700 }}>{f.project?.code || '-'}</div>
                          <div style={{ fontSize: 11, color: '#8A8A8A', marginTop: 2 }}>
                            {f.project?.holder_name || '-'}
                          </div>
                        </td>
                        <td style={{ ...TD, ...NUM, textAlign: 'right' }}>{fmt(f.project_value)}</td>
                        <td style={{
                          ...TD, ...NUM, textAlign: 'right', fontWeight: pendente > 0 ? 700 : 400,
                          color: pendente > 0 ? '#1A1A1A' : '#B5B5B5',
                        }}>
                          {pendente > 0 ? fmt(pendente) : '—'}
                        </td>
                        <td style={TD}><Selo status={f.payment_status} /></td>
                        <td style={TD}><ChevronRight size={13} style={{ color: '#CCC' }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
