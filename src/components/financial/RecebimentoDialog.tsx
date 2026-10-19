import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Wallet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { VALID_PROJECT_STATUSES } from '@/lib/statusMapping';
import { useStatusLabel } from '@/hooks/useStatusLabel';
import { valorBR } from '@/lib/valorBR';
import {
  LinhaAberta, LinhaParaGravar, useCreditoDaEmpresa, useRegistrarRecebimento, useSugestaoRecebimento,
} from '@/hooks/useRecebimentos';

/**
 * REGISTRAR RECEBIMENTO — a empresa mandou um valor redondo.
 *
 * A pessoa digita valor e data; o banco sugere a distribuição (ARTs da mais
 * antiga para a mais nova, mensalidade com a sobra) e ela **ajusta**: desmarcar,
 * mudar o valor de qualquer linha. Nada é redistribuído pelo servidor.
 *
 * Trocar o valor refaz a sugestão do zero — é dinheiro diferente, e manter
 * ajustes antigos sobre uma distribuição nova confundiria mais do que ajudaria.
 * Mexer no filtro de etapa tem o mesmo efeito, e pela mesma razão: a
 * distribuição inteira muda quando um projeto deixa de concorrer ao valor.
 */

interface Props {
  companies: { id: string; name: string }[];
  companyIdInicial?: string | null;
  onClose: () => void;
  onDone?: () => void;
}

const fmt = formatCurrency;
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

// o parser mora em lib/valorBR.ts e tem teste próprio: "5.000" tem de dar
// 5000, não 5 — e isso não é óbvio o suficiente para ficar sem cobertura
const paraNumero = valorBR;

interface LinhaEditada { marcada: boolean; valor: number }

export function RecebimentoDialog({ companies, companyIdInicial, onClose, onDone }: Props) {
  const [companyId, setCompanyId] = useState<string>(companyIdInicial ?? '');
  const [valorTexto, setValorTexto] = useState('');
  const [data, setData] = useState(hoje());
  const [notes, setNotes] = useState('');
  // Etapas que podem receber a sugestao. Vazio = todas, que e o de sempre.
  const [etapas, setEtapas] = useState<string[]>([]);
  const [edicoes, setEdicoes] = useState<Record<string, LinhaEditada>>({});
  const [confirmandoSobra, setConfirmandoSobra] = useState(false);

  const valor = paraNumero(valorTexto);
  const { data: sugestao = [], isLoading, isError } = useSugestaoRecebimento(companyId || null, valor, etapas);
  const { data: credito = 0 } = useCreditoDaEmpresa(companyId || null);
  const registrar = useRegistrarRecebimento();
  const rotuloEtapa = useStatusLabel();

  const alternarEtapa = (etapa: string) => setEtapas(atual =>
    atual.includes(etapa) ? atual.filter(e => e !== etapa) : [...atual, etapa],
  );
  /** A linha ficou de fora do recorte? (mensalidade nunca fica: nao tem etapa) */
  const foraDoFiltro = (l: LinhaAberta) =>
    etapas.length > 0 && l.tipo === 'art' && !etapas.includes(l.etapa ?? '');

  // A sugestão manda enquanto a pessoa não mexeu: trocar o valor ou as etapas
  // recomeça (as duas coisas refazem a consulta, e com ela este efeito).
  useEffect(() => {
    const inicial: Record<string, LinhaEditada> = {};
    for (const l of sugestao) inicial[l.alvo_id] = { marcada: l.sugerido > 0, valor: l.sugerido };
    setEdicoes(inicial);
    setConfirmandoSobra(false);
  }, [sugestao]);

  const linhas = useMemo(
    () => sugestao.map(l => ({ base: l, ed: edicoes[l.alvo_id] ?? { marcada: false, valor: 0 } })),
    [sugestao, edicoes],
  );
  const aplicado = useMemo(
    () => Math.round(linhas.reduce((s, { ed }) => s + (ed.marcada ? ed.valor : 0), 0) * 100) / 100,
    [linhas],
  );
  const sobra = Math.round((valor - aplicado) * 100) / 100;

  const linhaInvalida = linhas.find(({ base, ed }) => ed.marcada && (ed.valor <= 0 || ed.valor > base.aberto));
  const passouDoValor = aplicado > valor;
  const podeConfirmar = !!companyId && valor > 0 && !!data && !passouDoValor && !linhaInvalida && !registrar.isPending;

  const mexer = (id: string, mudanca: Partial<LinhaEditada>) =>
    setEdicoes(prev => ({ ...prev, [id]: { ...(prev[id] ?? { marcada: false, valor: 0 }), ...mudanca } }));

  const confirmar = async () => {
    // sobra é crédito: a pessoa confirma de propósito, para não virar surpresa
    if (sobra > 0 && !confirmandoSobra) { setConfirmandoSobra(true); return; }
    const paraGravar: LinhaParaGravar[] = linhas
      .filter(({ ed }) => ed.marcada && ed.valor > 0)
      .map(({ base, ed }) => ({ tipo: base.tipo, alvo_id: base.alvo_id, valor: ed.valor }));
    try {
      await registrar.mutateAsync({ companyId, data, valor, linhas: paraGravar, notes: notes.trim() || undefined });
      onDone?.();
      onClose();
    } catch { /* o toast do hook já explicou */ }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" /> Registrar recebimento
          </DialogTitle>
          <DialogDescription>
            Lance o valor que a empresa pagou. O sistema sugere quitar as ARTs mais
            antigas e abater o restante — e você ajusta antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* empresa, valor e data */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Label htmlFor="rec-empresa">Empresa</Label>
              <select
                id="rec-empresa" value={companyId} onChange={e => setCompanyId(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Escolha a empresa…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rec-valor">Valor recebido</Label>
              <Input
                id="rec-valor" value={valorTexto} onChange={e => setValorTexto(e.target.value)}
                placeholder="5.000,00" inputMode="decimal" autoFocus className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="rec-data">Data</Label>
              <Input id="rec-data" type="date" value={data} max={hoje()}
                     onChange={e => setData(e.target.value)} className="mt-1" />
            </div>
          </div>

          {/* Filtro de etapa. Mora no BANCO, nao aqui: a ART fora do recorte e
              pulada antes de consumir o valor, e e assim que o dinheiro escorre
              para os proximos projetos. Desmarcar a linha na mao viraria sobra,
              e sobra vira credito da empresa — que nao e o que se quer.
              Pedido do usuario (out/2026): projeto ainda nao aprovado nao devia
              estar abocanhando o abatimento. */}
          {companyId && (
            <div>
              <Label>
                Etapas que podem receber
                {etapas.length > 0 && (
                  <span className="ml-1.5 font-normal text-amber-700">({etapas.length} selecionadas)</span>
                )}
              </Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {VALID_PROJECT_STATUSES.map(k => {
                  const on = etapas.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => alternarEtapa(k)}
                      aria-pressed={on}
                      className={'rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-tight transition-colors ' + (on
                        ? 'border-amber-400 bg-amber-100 text-amber-900'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted')}
                    >
                      {rotuloEtapa(k)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {etapas.length === 0
                  ? 'Nenhuma marcada = a sugestão considera todos os projetos em aberto.'
                  : 'Projeto em outra etapa fica com 0,00 e o valor segue para o próximo — mas continua na lista, e você pode marcá-lo na mão.'}
              </p>
            </div>
          )}

          {credito > 0 && (
            <p className="text-xs rounded-md bg-amber-50 text-amber-900 px-3 py-2">
              Esta empresa tem <strong>{fmt(credito)}</strong> de crédito de depósitos anteriores.
              Ele não entra sozinho: some ao valor recebido se quiser usá-lo agora.
            </p>
          )}

          {/* a sugestão */}
          {!companyId ? null : isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : isError ? (
            <p className="text-sm text-destructive">Não consegui ler o que esta empresa deve. Recarregue a página.</p>
          ) : sugestao.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Esta empresa não tem nada em aberto.
            </p>
          ) : (
            <div className="rounded-lg border divide-y">
              {linhas.map(({ base, ed }) => {
                const quita = ed.marcada && ed.valor >= base.aberto;
                const ruim = ed.marcada && (ed.valor <= 0 || ed.valor > base.aberto);
                const fora = foraDoFiltro(base);
                return (
                  <div key={base.alvo_id} className={'flex items-center gap-3 p-2.5' + (fora && !ed.marcada ? ' bg-muted/40' : '')}>
                    <input
                      type="checkbox" checked={ed.marcada} aria-label={'Incluir ' + base.rotulo}
                      onChange={e => mexer(base.alvo_id, {
                        marcada: e.target.checked,
                        valor: e.target.checked && ed.valor <= 0 ? base.aberto : ed.valor,
                      })}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{base.rotulo}</span>
                        {base.tipo === 'assinatura' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">mensalidade</span>
                        )}
                        {fora && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            fora do filtro · {rotuloEtapa(base.etapa ?? '')}
                          </span>
                        )}
                        {ed.marcada && (
                          <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (quita
                            ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800')}>
                            {quita ? 'quita' : 'abate'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {base.detalhe ? base.detalhe + ' · ' : ''}
                        aberto {fmt(base.aberto)} de {fmt(base.total)}
                        {base.vencimento ? ' · venc ' + new Date(base.vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
                      </p>
                    </div>
                    <Input
                      value={ed.valor > 0 ? String(ed.valor).replace('.', ',') : ''}
                      onChange={e => mexer(base.alvo_id, { valor: paraNumero(e.target.value), marcada: true })}
                      placeholder="0,00" inputMode="decimal"
                      aria-label={'Valor em ' + base.rotulo}
                      className={'w-28 text-right ' + (ruim ? 'border-destructive' : '')}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* o fechamento da conta */}
          {valor > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Recebido</span><strong>{fmt(valor)}</strong></div>
              <div className="flex justify-between text-muted-foreground"><span>Aplicado</span><span>{fmt(aplicado)}</span></div>
              <div className={'flex justify-between font-medium ' + (passouDoValor ? 'text-destructive' : sobra > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                <span>{passouDoValor ? 'Passou do recebido' : 'Sobra'}</span>
                <span>{fmt(Math.abs(sobra))}</span>
              </div>
            </div>
          )}

          {linhaInvalida && (
            <p className="text-xs text-destructive flex items-start gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              {linhaInvalida.ed.valor > linhaInvalida.base.aberto
                ? 'Uma linha passa do saldo em aberto do item (' + linhaInvalida.base.rotulo + ').'
                : 'Uma linha marcada está com valor zero (' + linhaInvalida.base.rotulo + ').'}
            </p>
          )}

          <div>
            <Label htmlFor="rec-obs">Observação (opcional)</Label>
            <Input id="rec-obs" value={notes} onChange={e => setNotes(e.target.value)}
                   placeholder="PIX, boleto, nº do comprovante…" className="mt-1" />
          </div>

          {confirmandoSobra && sobra > 0 && (
            <p className="text-xs rounded-md bg-amber-50 text-amber-900 px-3 py-2">
              Vão sobrar <strong>{fmt(sobra)}</strong>, que ficam como <strong>crédito</strong> da empresa
              e aparecem no próximo recebimento. Clique em confirmar de novo para gravar assim.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={registrar.isPending}>Cancelar</Button>
            <Button onClick={confirmar} disabled={!podeConfirmar} className="gap-2">
              {registrar.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <CheckCircle2 className="w-4 h-4" />}
              {confirmandoSobra && sobra > 0 ? 'Confirmar com sobra' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
