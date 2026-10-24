import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, ClipboardCheck, ClipboardList, ExternalLink, FileText,
  Mail, MessageSquare, Paperclip, Radar, ShieldAlert, ShieldQuestion, XCircle, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rotuloCasamento, textoDaTrocaDeProtocolo } from '@/lib/ludmillaCartao';
import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import {
  acoesDoItem, situacaoDecidida, textoDaDecisao, visibilidadeDoDetalhe, type AcaoDaDecisao, type AcaoDoProjeto,
  type AnexoDoPortal, type EventoDoProjeto, type OQueChegou, type ParecerDoPortal, type VisibilidadeDoDetalhe,
} from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';
import { COR_DO_SELO, NOME_DO_MEIO, corDoStatusDoPortal, dataCurta } from './visual';

/**
 * O PAINEL DE DETALHE (spec §3.2): Quem · O que chegou · Documentos do projeto ·
 * A sugestão · Este projeto na Ludmilla, com os botões fixos embaixo. Só desenha:
 * os dados chegam prontos (DetalheConectado no app, fixtures no harness). Nos dois
 * layouts o corpo rola e os botões ficam à vista — um flex de coluna, NUNCA sticky
 * (não gruda dentro de overflow). O que aparece ou não vem de `visibilidadeDoDetalhe`.
 */

/** O cadastro do projeto: null = não há projeto casado. */
export type ProjetoDoQuem = { uc: string | null; protocoloNoCadastro: string | null } | null | 'carregando' | 'erro';

export interface DadosDoDetalhe {
  item: ItemDaCaixa;
  chegou: OQueChegou | null;
  ressalva: string | null;
  projeto: ProjetoDoQuem;
  documentos: { anexos: AnexoDoPortal[]; pareceres: ParecerDoPortal[] } | null;
  linhaDoTempo: EventoDoProjeto[] | 'carregando' | 'erro';
  etapas: { key: string; label: string }[];
  rotuloEtapa: (s: string | null | undefined) => string;
}

export interface PropsDoDetalhe {
  dados: DadosDoDetalhe;
  layout: 'painel' | 'folha';
  onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void;
  onAbrirProjeto: (projectId: string) => void;
  urlDoDocumento: (caminho: string) => Promise<string | null>;
}

const VEREDITO: Record<string, { texto: string; cor: string }> = {
  favoravel: { texto: 'favorável', cor: 'bg-emerald-100 text-emerald-800' },
  pendencia: { texto: 'com pendência', cor: 'bg-amber-100 text-amber-800' },
  inconclusivo: { texto: 'não consegui ler', cor: 'bg-slate-200 text-slate-700' },
};

const ICONE_DO_EVENTO: Record<AcaoDoProjeto, LucideIcon> = {
  visita: Radar, recomendacao: ArrowRight, aplicada: CheckCircle2, ignorada: XCircle, anexo: Paperclip,
  parecer: MessageSquare, captcha_pedido: ShieldQuestion, captcha_respondido: ShieldQuestion,
  tarefa_encerrada: ClipboardCheck, email: Mail, afazer: ClipboardList, afazer_feito: CheckCheck,
};

const semEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '');

async function abrirDocumento(caminho: string, urlDoDocumento: PropsDoDetalhe['urlDoDocumento']) {
  // a janela abre NO clique (o bloqueador de pop-up deixa) e recebe o endereço depois
  const janela = window.open('', '_blank');
  if (janela) janela.opener = null;
  const url = await urlDoDocumento(caminho);
  if (janela && url) janela.location.href = url;
  else janela?.close();
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

function Selos({ item }: { item: ItemDaCaixa }) {
  return (
    <div className="flex flex-wrap gap-1">
      {item.selos.map(s => (
        <span key={s.texto} className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', COR_DO_SELO[s.tom])}>{s.texto}</span>
      ))}
    </div>
  );
}

/** Um campo do cadastro: "…" enquanto carrega, "não consegui carregar" se a consulta falhou, "—" se não há. */
function doCadastro(projeto: ProjetoDoQuem, campo: 'uc' | 'protocoloNoCadastro'): ReactNode {
  if (projeto === 'carregando') return <span className="text-muted-foreground" aria-label="carregando">…</span>;
  if (projeto === 'erro') return <span className="text-xs text-muted-foreground">não consegui carregar</span>;
  return projeto?.[campo] ?? '—';
}

function Quem({ item, projeto, v }: { item: ItemDaCaixa; projeto: ProjetoDoQuem; v: VisibilidadeDoDetalhe }) {
  const casado = item.update && item.update.casamento !== 'protocolo' ? rotuloCasamento(item.update.casamento) : null;
  const linhas: [string, ReactNode][] = [
    ['Titular', (
      <>
        {item.titular ?? '—'}
        {item.noPortal && (
          <span className="block text-xs text-muted-foreground">no portal: <span className="font-mono">{item.noPortal}</span></span>
        )}
        {casado && <span className="block text-xs text-muted-foreground">casado por {casado}</span>}
      </>
    )],
    ['Empresa', item.empresa ?? '—'],
    ['UC', doCadastro(projeto, 'uc')],
  ];
  // o protocolo que veio da concessionária: em "Sem projeto casado" é a única pista
  if (v.rotuloDoProtocolo) linhas.push([v.rotuloDoProtocolo, <span className="font-mono">{item.protocolo ?? '—'}</span>]);
  linhas.push(['Protocolo no cadastro', doCadastro(projeto, 'protocoloNoCadastro')]);
  return (
    <Secao titulo="Quem">
      <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="pt-0.5 text-xs text-muted-foreground">{rotulo}</dt>
            <dd className="break-words">{valor}</dd>
          </div>
        ))}
      </dl>
    </Secao>
  );
}

function OQueChegouSecao({ item, chegou, ressalva, v }: {
  item: ItemDaCaixa; chegou: OQueChegou | null; ressalva: string | null; v: VisibilidadeDoDetalhe;
}) {
  return (
    <Secao titulo="O que chegou">
      {v.avisoDeBloqueio && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 text-sm">
            <b>Documento não anexado</b>
            {ressalva && <span className="block break-words text-xs">{ressalva}</span>}
          </div>
        </div>
      )}
      {item.afazer ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{semEmoji(item.afazer.titulo)}</p>
          <p className="break-words text-muted-foreground">{item.afazer.mensagem}</p>
          <p className="text-xs text-muted-foreground">{item.concessionaria} · {dataCurta(item.afazer.criado_em)}</p>
        </div>
      ) : chegou?.meio === 'email' ? (
        <div className="space-y-1.5 text-sm">
          <p className="text-xs text-muted-foreground">
            {chegou.remetente ?? 'remetente desconhecido'} ·{' '}
            {chegou.recebidoEm ? `e-mail recebido em ${dataCurta(chegou.recebidoEm)}` : `lido pela Ludmilla em ${dataCurta(chegou.lidoEm)}`}
          </p>
          <p className="break-words font-mono text-xs">{chegou.assunto ?? '(sem assunto)'}</p>
          <div className="flex flex-wrap items-center gap-2">
            {chegou.veredito && VEREDITO[chegou.veredito] && (
              <span className={cn('rounded px-1.5 py-0.5 text-[11px]', VEREDITO[chegou.veredito].cor)}>{VEREDITO[chegou.veredito].texto}</span>
            )}
            {chegou.anexos > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700"><Paperclip size={11} aria-hidden /> {chegou.anexos} no card</span>
            )}
          </div>
          {chegou.resumo && <p className="break-words">{chegou.resumo}</p>}
          {chegou.arquivoLido && (
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileText size={11} aria-hidden /> a IA leu <span className="font-mono">{chegou.arquivoLido}</span>
            </p>
          )}
        </div>
      ) : chegou?.meio === 'portal' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chegou.de && (
            <>
              <span className={cn('rounded px-2 py-0.5 text-xs', corDoStatusDoPortal(chegou.de))}>{chegou.de}</span>
              <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
            </>
          )}
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', corDoStatusDoPortal(chegou.para))}>{chegou.para}</span>
          {chegou.atualizadoNoPortal && <span className="text-xs text-muted-foreground">atualizado no portal em {chegou.atualizadoNoPortal}</span>}
        </div>
      ) : null}
    </Secao>
  );
}

/** Anexos e pareceres que a Ludmilla levou ao projeto inteiro — não só os deste cartão. */
function DocumentosDoProjeto({ documentos, urlDoDocumento }: {
  documentos: DadosDoDetalhe['documentos']; urlDoDocumento: PropsDoDetalhe['urlDoDocumento'];
}) {
  if (!documentos || (documentos.anexos.length === 0 && documentos.pareceres.length === 0)) return null;
  return (
    <Secao titulo="Documentos do projeto">
      <ul className="divide-y rounded-lg border text-xs">
        {documentos.anexos.map(a => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2">
            <Paperclip size={12} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono">{a.nome_arquivo}</span>
            <span className={cn('rounded px-1.5 py-0.5',
              a.situacao === 'enviado' ? 'bg-emerald-100 text-emerald-800'
                : a.situacao === 'bloqueado' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700')}>
              {a.situacao === 'enviado' ? 'no card' : a.situacao}
            </span>
            {a.document?.file_url && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" aria-label={`Abrir ${a.nome_arquivo}`}
                onClick={() => void abrirDocumento(a.document!.file_url, urlDoDocumento)}>
                <ExternalLink size={12} aria-hidden /> Abrir
              </Button>
            )}
          </li>
        ))}
        {documentos.pareceres.map(pa => (
          <li key={pa.id} className="flex items-start gap-2 px-3 py-2">
            <MessageSquare size={12} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 break-words">
              Parecer{pa.data ? ` de ${pa.data}` : ''}{pa.analise ? ` · ${pa.analise}` : ''}{pa.status ? ` · ${pa.status}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </Secao>
  );
}

/**
 * As opções do seletor: as etapas do Kanban e, se a recomendação não estiver entre elas
 * (modelo de Kanban ainda carregando, ou chave fora dele), a própria recomendação — o
 * seletor nunca começa num valor que ele não sabe mostrar. Não há opção vazia.
 */
function opcoesDeEtapa(etapas: DadosDoDetalhe['etapas'], recomendacao: string | null, rotuloEtapa: DadosDoDetalhe['rotuloEtapa']) {
  if (!recomendacao || etapas.some(e => e.key === recomendacao)) return etapas;
  return [{ key: recomendacao, label: rotuloEtapa(recomendacao) }, ...etapas];
}

function Sugestao({ item, etapa, onEtapa, etapas, rotuloEtapa, ressalva, v }: {
  item: ItemDaCaixa; etapa: string; onEtapa: (v: string) => void;
  etapas: DadosDoDetalhe['etapas']; rotuloEtapa: DadosDoDetalhe['rotuloEtapa']; ressalva: string | null;
  v: VisibilidadeDoDetalhe;
}) {
  const u = item.update;
  if (!u || !v.sugestao) return null;
  return (
    <Secao titulo="A sugestão">
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {u.project
            ? <>No sistema: <b className="text-foreground">{rotuloEtapa(u.project.status)}</b></>
            : <>Sem projeto casado no sistema</>}
          {u.recomendacao && <> · a Ludmilla sugere <b className="text-foreground">{rotuloEtapa(u.recomendacao)}</b></>}
        </p>
        {v.seletor && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Mover para</span>
            <Select value={etapa} onValueChange={onEtapa}>
              <SelectTrigger className="h-9 w-56" aria-label="Etapa"><SelectValue placeholder="escolha a etapa" /></SelectTrigger>
              <SelectContent>
                {opcoesDeEtapa(etapas, u.recomendacao, rotuloEtapa).map(e => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {u.recomendacao && etapa === u.recomendacao && <span className="text-xs text-emerald-700">recomendação da Ludmilla</span>}
          </div>
        )}
        {v.trocaDeProtocolo && (
          <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
            {textoDaTrocaDeProtocolo(u.casamento, u.protocolo_anterior)}. Aplicar grava <span className="font-mono">{u.protocolo}</span> no cadastro.
          </p>
        )}
        {ressalva && v.ressalvaNaSugestao && (
          <p className="flex items-start gap-1.5 break-words text-xs text-amber-800">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {ressalva}
          </p>
        )}
      </div>
    </Secao>
  );
}

function BotoesDaDecisao({ item, etapa, onDecidir, rotuloEtapa }: {
  item: ItemDaCaixa; etapa: string; onDecidir: PropsDoDetalhe['onDecidir']; rotuloEtapa: DadosDoDetalhe['rotuloEtapa'];
}) {
  const decidida = situacaoDecidida(item);
  if (decidida) {
    return (
      <p data-teste="botoes-da-decisao" className="text-sm text-muted-foreground">
        {decidida.rotulo}{decidida.por ? ` por ${decidida.por}` : ''}{decidida.em ? ` em ${dataCurta(decidida.em)}` : ''}.
      </p>
    );
  }
  // bloqueado: principal === null (sem Aplicar), só "Dispensar"; A fazer: só "Marcar como feito"
  const { principal, secundaria } = acoesDoItem(item, etapa || null);
  // o que o Aplicar vai fazer, à vista sem rolar (o mesmo texto do aviso com "Desfazer")
  const previa = principal?.acao === 'aplicar' && principal.habilitada
    ? textoDaDecisao(item, 'aplicar', etapa || null, rotuloEtapa) : null;
  return (
    <div data-teste="botoes-da-decisao" className="space-y-1.5">
      {previa && (
        <p data-teste="previa-da-decisao" className="flex items-start gap-1 break-words text-xs text-muted-foreground">
          <ArrowRight size={12} className="mt-0.5 shrink-0" aria-hidden /> {previa}
        </p>
      )}
      <div className="flex gap-2">
        {secundaria && (
          <Button variant="outline" className="flex-1 gap-1.5 sm:flex-none" onClick={() => onDecidir('ignorar', null)}>
            <XCircle size={15} aria-hidden /> {secundaria.rotulo}
          </Button>
        )}
        {principal && (
          <Button className="flex-1 gap-1.5 sm:flex-none" disabled={!principal.habilitada}
            onClick={() => onDecidir(principal.acao, principal.acao === 'aplicar' ? (etapa || null) : null)}>
            <CheckCircle2 size={15} aria-hidden /> {principal.rotulo}
          </Button>
        )}
      </div>
      {principal?.porque && <p className="text-xs text-muted-foreground">{principal.porque}</p>}
    </div>
  );
}

function LinhaDoTempo({ eventos }: { eventos: DadosDoDetalhe['linhaDoTempo'] }) {
  return (
    <Secao titulo="Este projeto na Ludmilla">
      {eventos === 'carregando' ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : eventos === 'erro' ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-800">
          <AlertTriangle size={12} className="shrink-0" aria-hidden /> Não consegui carregar o que a Ludmilla registrou para este projeto.
        </p>
      ) : eventos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nada registrado para este projeto.</p>
      ) : (
        <ol className="space-y-2">
          {eventos.map((e, i) => {
            const Icone = ICONE_DO_EVENTO[e.acao] ?? Radar;
            return (
              <li key={`${e.quando}-${i}`} className="flex gap-2 text-xs">
                <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                  e.situacao === 'erro' ? 'bg-red-100 text-red-700'
                    : e.situacao === 'aviso' ? 'bg-amber-100 text-amber-700'
                    : e.ator === 'ludmilla' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                  <Icone size={12} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{e.titulo}</span>
                  {e.detalhe && <span className="block break-words text-muted-foreground">{e.detalhe}</span>}
                </span>
                <span className="shrink-0 text-right text-muted-foreground">
                  <span className="block whitespace-nowrap">{dataCurta(e.quando)}</span>
                  <span className="block text-[11px]">{e.ator === 'ludmilla' ? 'Ludmilla' : e.quem || 'equipe'}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Secao>
  );
}

export function DetalheDaDecisao({ dados, layout, onDecidir, onAbrirProjeto, urlDoDocumento }: PropsDoDetalhe) {
  const { item } = dados;
  // nasce da recomendação; o componente pai troca a `key` quando ela muda no refetch
  const [etapa, setEtapa] = useState<string>(item.update?.recomendacao ?? '');
  const v = visibilidadeDoDetalhe(item);

  // Decidir desmonta o botão clicado e o foco cairia no <body>: o Tab recomeçaria do topo da
  // página e, na folha não modal, sair dela a fecha. O foco vem para o detalhe novo — só quando
  // estava perdido (não rouba de quem está na busca, num filtro ou numa linha).
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body || document.activeElement === null) {
      raiz.current?.focus({ preventScroll: true });
    }
  }, [item.chave]);

  const quem = <Quem item={item} projeto={dados.projeto} v={v} />;
  const chegou = <OQueChegouSecao item={item} chegou={dados.chegou} ressalva={dados.ressalva} v={v} />;
  const documentos = <DocumentosDoProjeto documentos={dados.documentos} urlDoDocumento={urlDoDocumento} />;
  const sugestao = <Sugestao item={item} etapa={etapa} onEtapa={setEtapa} etapas={dados.etapas} rotuloEtapa={dados.rotuloEtapa} ressalva={dados.ressalva} v={v} />;
  const botoes = <BotoesDaDecisao item={item} etapa={etapa} onDecidir={onDecidir} rotuloEtapa={dados.rotuloEtapa} />;
  const linha = v.linhaDoTempo ? <LinhaDoTempo eventos={dados.linhaDoTempo} /> : null;

  const abrirProjeto = item.projectId && item.codigo ? (
    <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      onClick={() => onAbrirProjeto(item.projectId!)}>
      Abrir {item.codigo} <ExternalLink size={13} aria-hidden />
    </button>
  ) : null;

  const cabecalho = layout === 'folha' ? (
    <div className="flex flex-wrap items-center justify-between gap-2"><Selos item={item} />{abrirProjeto}</div>
  ) : (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        {item.projectId && item.codigo ? (
          <button type="button" className="inline-flex items-center gap-1 text-lg font-semibold hover:underline"
            onClick={() => onAbrirProjeto(item.projectId!)}>
            {item.codigo} <ExternalLink size={14} aria-hidden />
          </button>
        ) : (
          <span className="text-lg font-semibold text-muted-foreground">{item.codigo ?? 'Sem projeto casado'}</span>
        )}
        <p className="text-xs text-muted-foreground">{item.concessionaria} · por {NOME_DO_MEIO[item.meio]} · {dataCurta(item.quando)}</p>
      </div>
      <Selos item={item} />
    </div>
  );

  // Nos dois layouts o corpo rola e os botões ficam à vista embaixo (a decisão é a ação
  // principal; com documentos e a troca de protocolo o corpo passa da altura da tela).
  return (
    <div ref={raiz} tabIndex={-1} data-detalhe={item.chave} className="flex min-h-0 flex-1 flex-col outline-none">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
        {cabecalho}
        {quem}{chegou}{documentos}{sugestao}{linha}
      </div>
      {layout === 'folha' ? (
        // `safe-area-bottom` zeraria o p-3 de baixo (botão colado na borda): a maior das duas folgas
        <div className="shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{botoes}</div>
      ) : (
        <div className="shrink-0 border-t px-4 py-3">{botoes}</div>
      )}
    </div>
  );
}
