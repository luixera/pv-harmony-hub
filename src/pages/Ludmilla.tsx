import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Radar, CheckCircle2, XCircle, ArrowRight, ExternalLink, RefreshCw, Loader2, Clock, KeyRound, MonitorSmartphone, ShieldQuestion, ChevronRight, Paperclip, MessageSquare, ClipboardCheck, Mail, Globe, Inbox, AlertTriangle, ShieldAlert } from 'lucide-react';
import {
  estadoDaEstacao, PortalCaptcha, PortalRun, PortalUpdate, PassoCriacao, urlDoPrint,
  useAplicarUpdate, useIgnorarUpdate, useLudmillaDisponivel, usePedirRun, usePortalAccounts,
  usePortalCaptchas, usePortalUpdates, usePassosCriacao, useRunsCriacaoCpfl, useResponderCaptcha,
  useRegistroLudmilla, useUltimoRunEmail, type AtorLudmilla, type PortalAccount, type RegistroLudmilla,
} from '@/hooks/useLudmilla';
import { useAgentConfig, type AgentConfigSafe } from '@/hooks/useAgentConfig';
import { RegrasEmail } from '@/components/ludmilla/RegrasEmail';
import { ContadoresEmail, MensagensEmail } from '@/components/ludmilla/MensagensEmail';
import { detalheDoCartaoDeEmail, identidadeDoCartao, mensagemDeErro, textoDaTrocaDeProtocolo } from '@/lib/ludmillaCartao';
import { useStatusLabel, useStatusOrder } from '@/hooks/useStatusLabel';
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires';
import { cn } from '@/lib/utils';

/**
 * LUDMILLA — relatório de atualizações das concessionárias.
 *
 * Cada linha é um protocolo cujo status pede atenção: mudou desde a última
 * visita, ou a tradução aponta uma etapa à frente da atual. A Ludmilla só
 * recomenda (decisão do usuário, set/2026): quem move o card é a pessoa,
 * aqui, com "Aplicar" — e pode escolher outra etapa que não a recomendada.
 *
 * Há DOIS meios de acompanhamento, e cada cartão diz qual é o seu
 * (`portal_accounts.acompanhamento`): `portal`, em que ela entra no site da
 * concessionária, e `email`, em que ela lê a caixa e interpreta as mensagens
 * (EDP). Os campos de um meio não aparecem no cartão do outro — pedido do
 * usuário, out/2026: "campos separados por concessionária na tela de
 * manutenção dela".
 */

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Cor do selo pelo status do portal (CPFL: Aprovado / Reprovado / Pendente / Em Andamento / Cancelado). */
function corDoPortal(status: string) {
  const s = status.toLowerCase();
  if (s.includes('aprov') && !s.includes('reprov')) return 'bg-emerald-100 text-emerald-800';
  if (s.includes('reprov') || s.includes('cancel')) return 'bg-red-100 text-red-800';
  if (s.includes('andamento')) return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
}

/**
 * CÓDIGO DA IMAGEM — a estação fotografou o CAPTCHA do portal e espera uma
 * pessoa. Quem responder primeiro (aqui, do celular que seja) libera a
 * visita. A Ludmilla nunca lê a imagem: a foto é para você.
 */
function CartaoCaptcha({ c, portal }: { c: PortalCaptcha; portal: string }) {
  const responder = useResponderCaptcha();
  const [imagem, setImagem] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { urlDoPrint(c.imagem_path).then(setImagem); }, [c.imagem_path]);
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const restam = Math.max(0, Math.round((new Date(c.expira_em).getTime() - agora) / 1000));
  const enviar = () => {
    if (!codigo.trim()) return;
    responder.mutate({ captchaId: c.id, resposta: codigo.trim() });
  };
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="w-5 h-5 text-amber-700" />
        <span className="font-semibold text-amber-900">A Ludmilla precisa do código da imagem — {portal}</span>
        <span className="ml-auto text-xs text-amber-800 tabular-nums">{Math.floor(restam / 60)}:{String(restam % 60).padStart(2, '0')}</span>
      </div>
      {c.tentativa > 1 && (
        <p className="text-xs text-amber-800">
          Tentativa {c.tentativa}{c.mensagem ? ` — o portal disse: "${c.mensagem}"` : ''}. Nova imagem abaixo.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {imagem
          ? <img src={imagem} alt="Código da imagem do portal" className="rounded border bg-white h-16 object-contain" />
          : <div className="h-16 w-40 rounded border bg-white flex items-center justify-center text-xs text-muted-foreground">carregando…</div>}
        <Input
          value={codigo} onChange={e => setCodigo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar(); }}
          placeholder="Digite os caracteres" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false}
          className="w-44 text-lg tracking-widest font-mono"
        />
        <Button onClick={enviar} disabled={!codigo.trim() || responder.isPending || restam === 0} className="gap-2">
          {responder.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Enviar
        </Button>
      </div>
      <p className="text-xs text-amber-800">
        A estação preenche o código no portal e entra. Se errar, ela manda outra imagem. Ninguém além de você lê a imagem.
      </p>
    </div>
  );
}

export function LinhaRecomendacao({ u }: { u: PortalUpdate }) {
  const navigate = useNavigate();
  const rotulo = useStatusLabel();
  const etapas = useStatusOrder();
  const aplicar = useAplicarUpdate();
  const ignorar = useIgnorarUpdate();
  const [etapa, setEtapa] = useState<string>(u.recomendacao ?? '');
  const pendente = u.situacao === 'pendente';
  const { titular, noPortal, empresa } = identidadeDoCartao(u);
  // Só o cartão de E-MAIL (EDP, ENEL) tem detalhe; o da CPFL devolve null e fica como era.
  const email = detalheDoCartaoDeEmail(u);

  return (
    <div className={cn('rounded-xl border bg-card p-4 space-y-3', !pendente && 'opacity-70', email?.bloqueio && 'border-red-300 overflow-hidden')}>
      {/* Bloqueio: o documento NÃO foi anexado. Sem a faixa, o cartão parecia uma
          recomendação comum (revisão final, I-1) — e o motivo ficava só no banco. */}
      {email?.bloqueio && (
        <div className="-mx-4 -mt-4 flex items-start gap-2 border-b border-red-300 bg-red-100 px-4 py-2 text-red-900">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0 text-sm">
            <b>Documento não anexado</b>
            {email.motivo && <span className="block break-words text-xs">{email.motivo}</span>}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {u.project ? (
              <button className="font-semibold hover:underline inline-flex items-center gap-1" onClick={() => navigate(`/project/${u.project!.id}`)}>
                {u.project.code} <ExternalLink size={12} />
              </button>
            ) : (
              <span className="font-semibold text-muted-foreground">Sem projeto casado</span>
            )}
          </div>
          {/* Pedido do usuário (16/10/2026): TODO cartão diz de quem é (titular) e de qual
              empresa — portal CPFL, e-mail EDP e e-mail ENEL. Falta um dos dois: traço. */}
          <dl className="mt-1.5 grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
            <dt className="text-xs text-muted-foreground pt-0.5">Titular</dt>
            <dd className="font-medium break-words">
              {titular ?? <span className="font-normal text-muted-foreground">—</span>}
              {noPortal && (
                <span className="block text-xs font-normal text-muted-foreground">
                  no portal: <span className="font-mono">{noPortal}</span>
                </span>
              )}
            </dd>
            <dt className="text-xs text-muted-foreground pt-0.5">Empresa</dt>
            <dd className="break-words">
              {empresa ?? <span className="text-muted-foreground">—</span>}
            </dd>
          </dl>
          <div className="mt-1.5 text-xs text-muted-foreground">
            Protocolo {u.protocolo} · visto {quando(u.detectado_em)}
            {u.atualizar_protocolo && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                {textoDaTrocaDeProtocolo(u.casamento, u.protocolo_anterior)}
              </span>
            )}
            {u.raw?.['Última atualização'] ? ` · atualizado no portal em ${u.raw['Última atualização']}` : ''}
          </div>
          {/* E-mail: COMO o projeto foi achado (sempre — achado só pelo nome pede mais
              cuidado de quem confere), o dia do e-mail e o porquê (ressalva). No bloqueio
              o motivo já está na faixa vermelha, não se repete. */}
          {email && (
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {(email.achado || email.data) && (
                <div>
                  {email.achado}
                  {email.achado && email.data ? ' · ' : ''}
                  {email.data && `${email.data.rotulo} ${quando(email.data.iso)}`}
                </div>
              )}
              {email.motivo && !email.bloqueio && (
                <p className="inline-flex items-start gap-1 break-words text-amber-700">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {email.motivo}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {u.status_anterior && (
            <>
              <span className={cn('px-2 py-0.5 rounded text-xs', corDoPortal(u.status_anterior))}>{u.status_anterior}</span>
              <ArrowRight size={14} className="text-muted-foreground" />
            </>
          )}
          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', corDoPortal(u.status_portal))}>{u.status_portal}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          No sistema: <b className="text-foreground">{rotulo(u.project?.status)}</b>
        </span>
        {pendente ? (
          <>
            <span className="text-muted-foreground">→ mover para</span>
            <Select value={etapa} onValueChange={setEtapa}>
              <SelectTrigger className="h-8 w-56"><SelectValue placeholder={u.recomendacao ? undefined : 'escolha a etapa'} /></SelectTrigger>
              <SelectContent>
                {etapas.map(e => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {u.recomendacao && etapa === u.recomendacao && (
              <span className="text-xs text-emerald-700">recomendação da Ludmilla</span>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" className="gap-1" disabled={ignorar.isPending} onClick={() => ignorar.mutate(u.id)}>
                <XCircle size={14} /> Ignorar
              </Button>
              <Button size="sm" className="gap-1" disabled={(!etapa && !u.atualizar_protocolo) || !u.project || aplicar.isPending}
                onClick={() => aplicar.mutate({ id: u.id, status: etapa || undefined })}>
                {aplicar.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {u.atualizar_protocolo && !etapa ? 'Atualizar protocolo' : 'Aplicar'}
              </Button>
            </div>
          </>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">
            {u.situacao === 'aplicada' ? 'Aplicada' : 'Ignorada'}{u.aplicada_em ? ` em ${quando(u.aplicada_em)}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

const NOMES_PASSO: Record<PassoCriacao['nome'], string> = {
  login:          'Login na CPFL',
  introducao:     'Introdução',
  dados_uc:       'Dados da UC',
  dados_projeto:  'Dados do Projeto',
  dados_cliente:  'Dados do Cliente',
  revisao:        'Revisão',
  concluido:      'Concluído',
  simulado:       'Simulação concluída (sem salvar)',
};

function CardCriacaoCpfl({ run }: { run: PortalRun }) {
  const [expandido, setExpandido] = useState(false);
  const { data: passos = [] } = usePassosCriacao(expandido ? run.id : null);
  const [printUrls, setPrintUrls] = useState<Record<string, string>>({});

  async function carregarPrint(passo: PassoCriacao) {
    if (!passo.screenshot || printUrls[passo.id]) return;
    const url = await urlDoPrint(passo.screenshot);
    if (url) setPrintUrls(prev => ({ ...prev, [passo.id]: url }));
  }

  const projectId = run.dados?.['project_id'] as string | undefined;
  const situacaoCor = run.situacao === 'ok'
    ? 'text-emerald-600' : run.situacao === 'erro'
      ? 'text-red-600' : run.situacao === 'rodando'
        ? 'text-blue-600' : 'text-muted-foreground';

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpandido(e => !e)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {projectId ? `Projeto ${projectId.slice(0, 8)}…` : 'Criar na CPFL'}
            </span>
            <span className={cn('text-xs font-semibold', situacaoCor)}>
              {run.situacao === 'na_fila' ? 'na fila'
               : run.situacao === 'rodando' ? 'em andamento'
               : run.situacao === 'ok' ? 'concluído'
               : `erro`}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{quando(run.pedido_em)}</div>
        </div>
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', expandido && 'rotate-90')} />
      </button>

      {run.situacao === 'erro' && run.erro && (
        <p className="px-4 pb-3 text-xs text-red-600">{run.erro}</p>
      )}

      {expandido && (
        <div className="px-4 pb-4 space-y-2">
          {passos.length === 0 && run.situacao !== 'na_fila' && (
            <p className="text-xs text-muted-foreground">Nenhum passo registrado ainda.</p>
          )}
          {passos.map(p => (
            <div key={p.id} className="border rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => carregarPrint(p)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
              >
                {p.status === 'ok'
                  ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  : p.status === 'erro'
                    ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    : <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />}
                <span className="flex-1 font-medium">{NOMES_PASSO[p.nome] ?? p.nome}</span>
                {p.screenshot && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {p.erro && <p className="px-3 pb-2 text-xs text-red-600">{p.erro}</p>}
              {printUrls[p.id] && (
                <div className="px-3 pb-3">
                  <a href={printUrls[p.id]} target="_blank" rel="noopener noreferrer">
                    <img
                      src={printUrls[p.id]}
                      alt={`Screenshot — ${NOMES_PASSO[p.nome]}`}
                      className="rounded border w-full max-h-48 object-cover object-top"
                    />
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * REGISTRO — o que a Ludmilla fez e o que a equipe fez através dela.
 *
 * Não é uma tabela de log: é leitura unificada do que já estava gravado
 * (visitas, recomendações, decisões, anexos, pareceres, códigos de imagem,
 * tarefas encerradas), então o histórico inteiro aparece desde o primeiro dia.
 */
const ICONE_ACAO: Record<RegistroLudmilla['acao'], typeof Radar> = {
  visita: Radar,
  recomendacao: ArrowRight,
  aplicada: CheckCircle2,
  ignorada: XCircle,
  anexo: Paperclip,
  parecer: MessageSquare,
  captcha_pedido: ShieldQuestion,
  captcha_respondido: ShieldQuestion,
  tarefa_encerrada: ClipboardCheck,
};

function RegistroDaLudmilla() {
  const navigate = useNavigate();
  const [ator, setAtor] = useState<'todos' | AtorLudmilla>('todos');
  const [tudo, setTudo] = useState(false);
  const { data: registro = [], isLoading } = useRegistroLudmilla(tudo ? 400 : 60, ator === 'todos' ? undefined : ator);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Registro</h2>
        <span className="text-xs text-muted-foreground">o que ela fez e o que foi feito através dela</span>
        <div className="ml-auto flex gap-1">
          {([['todos', 'Tudo'], ['ludmilla', 'Ela fez'], ['equipe', 'A equipe fez']] as const).map(([v, r]) => (
            <Button key={v} size="sm" variant={ator === v ? 'default' : 'ghost'} onClick={() => setAtor(v)}>{r}</Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      ) : registro.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Nada registrado ainda.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {registro.map((e, i) => {
            const Icone = ICONE_ACAO[e.acao] ?? Radar;
            return (
              <div key={`${e.quando}-${i}`} className="flex gap-3 p-3">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                  e.situacao === 'erro' ? 'bg-red-100 text-red-700'
                    : e.situacao === 'aviso' ? 'bg-amber-100 text-amber-700'
                    : e.ator === 'ludmilla' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                  <Icone size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{e.titulo}</span>
                    {e.projeto && (
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => e.project_id && navigate(`/project/${e.project_id}`)}
                      >
                        {e.projeto}
                      </button>
                    )}
                  </div>
                  {e.detalhe && <p className="text-xs text-muted-foreground break-words">{e.detalhe}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground whitespace-nowrap">{quando(e.quando)}</div>
                  <div className="text-[11px] text-muted-foreground">{e.ator === 'ludmilla' ? 'Ludmilla' : e.quem || 'equipe'}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {registro.length >= (tudo ? 400 : 60) && !tudo && (
        <Button variant="outline" size="sm" onClick={() => setTudo(true)}>Ver mais</Button>
      )}
    </div>
  );
}

/**
 * O CORPO DO CARTÃO DE QUEM É ACOMPANHADA POR E-MAIL. Não tem nada de portal:
 * nem estação local, nem sessão viva, nem login — a credencial aqui é a caixa
 * do agente de e-mails, por tenant. Traz os contadores da última leitura, as
 * regras que ensinam a robô a reconhecer os e-mails, e o que ela já leu.
 */
function BlocoEmail({ conta, caixa }: { conta: PortalAccount; caixa: AgentConfigSafe | null | undefined }) {
  const { data: run = null } = useUltimoRunEmail(conta.id);

  return (
    <div className="space-y-3 pt-1">
      <div className="text-xs text-muted-foreground flex flex-wrap items-start gap-1.5">
        <Inbox size={12} className="mt-0.5 shrink-0" />
        {caixa?.gmail_email ? (
          <span>
            Caixa <b className="text-foreground">{caixa.gmail_email}</b> — a mesma do agente de e-mails.
            Ela só lê: nunca marca como lido nem move mensagem.
          </span>
        ) : (
          <span className="text-amber-700">
            A caixa de e-mail deste tenant não está configurada — sem ela não há o que ler.
            Configure em Claudinho / Agente de e-mails.
          </span>
        )}
      </div>

      <ContadoresEmail run={run} identificacao={conta.identificacao} />

      <div className="rounded-lg border bg-muted/20 p-3">
        <RegrasEmail accountId={conta.id} tenantId={conta.tenant_id} />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h4 className="text-sm font-medium">O que ela leu na caixa</h4>
          <span className="text-xs text-muted-foreground">
            o que precisa de você vem no alto, separado do histórico
          </span>
        </div>
        <MensagensEmail accountId={conta.id} />
      </div>
    </div>
  );
}

export default function Ludmilla() {
  const disponivel = useLudmillaDisponivel();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<'pendente' | 'aplicada' | 'ignorada' | 'todas'>('pendente');
  const {
    data: updates = [], isLoading, isError, error: erroDasRecomendacoes, isFetching, refetch,
  } = usePortalUpdates(filtro);
  const { data: contas = [] } = usePortalAccounts();
  const { data: concessionarias = [] } = useEnergyConcessionaires(false);
  const { data: captchas = [] } = usePortalCaptchas();
  const { data: runsCriacao = [] } = useRunsCriacaoCpfl();
  const [historicoCriacoes, setHistoricoCriacoes] = useState(false);
  const pedir = usePedirRun();
  // a caixa do agente de e-mails é por tenant, não por conta: uma consulta
  // serve para todos os cartões acompanhados por e-mail
  const { data: caixa } = useAgentConfig();
  const caixaPronta = !!caixa?.is_configured && !!caixa.gmail_email;

  // Cada tentativa vira um run: sem isto, 20 cartões de erro do mesmo projeto
  // empurram as Recomendações para fora da tela. Por padrão, o último por projeto.
  const criacoesVisiveis = (() => {
    if (historicoCriacoes) return runsCriacao;
    const porProjeto = new Map<string, PortalRun>();
    for (const r of runsCriacao) {
      const chave = String(r.dados?.['project_id'] ?? r.id);
      if (!porProjeto.has(chave)) porProjeto.set(chave, r);
    }
    return [...porProjeto.values()].slice(0, 5);
  })();

  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-muted-foreground">A Ludmilla está disponível só para a equipe do GD Manager.</div>
      </MainLayout>
    );
  }

  const nomeDaConta = (id: string) => {
    const c = contas.find(a => a.id === id);
    return concessionarias.find(x => x.id === c?.concessionaire_id)?.name ?? c?.connector?.toUpperCase() ?? '';
  };

  return (
    <MainLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Radar className="w-6 h-6 text-primary" /></div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">Ludmilla</h1>
            <p className="text-sm text-muted-foreground">
              O que mudou nas concessionárias — no portal ou na caixa de e-mail — com a recomendação de etapa. Ela lê; você decide.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/admin/energy-concessionaires')}>
            <KeyRound size={14} /> Acessos aos portais
          </Button>
        </div>

        {/* Código da imagem pedido pela estação: primeiro de tudo, é urgente (5 min) */}
        {captchas.map(c => <CartaoCaptcha key={c.id} c={c} portal={nomeDaConta(c.account_id)} />)}

        {/* Contas: última varredura + verificar agora */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contas.length === 0 && (
            <div className="rounded-xl border p-4 text-sm text-muted-foreground sm:col-span-3">
              Nenhum portal configurado. Em Concessionárias, use o ícone de chave para cadastrar o acesso.
            </div>
          )}
          {contas.map(c => (
            <div key={c.id} className={cn('rounded-xl border bg-card p-4 space-y-2',
              // quem é acompanhada por e-mail tem regras e histórico para
              // mostrar: numa coluna de um terço não caberia nada legível
              c.acompanhamento === 'email' && 'sm:col-span-2 lg:col-span-3')}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{nomeDaConta(c.id)}</span>
                <span className={cn('text-xs',
                  c.situacao === 'ok' ? 'text-emerald-600' : c.situacao === 'nao_configurado' ? 'text-muted-foreground' : 'text-red-600')}>
                  {c.situacao === 'ok' ? 'conectada' : c.situacao === 'nao_configurado' ? 'sem acesso' : c.situacao === 'sessao_expirada' ? 'sessão expirada' : 'com erro'}
                </span>
              </div>
              {/* COMO esta concessionária é acompanhada. `modo` diz ONDE o robô
                  roda; `acompanhamento` diz por que meio ele acompanha. */}
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                {c.acompanhamento === 'email' ? <Mail size={12} /> : <Globe size={12} />}
                Acompanho por <b className="text-foreground">
                  {c.acompanhamento === 'email' ? 'e-mail'
                    : c.modo === 'local' ? 'portal (estação local)' : 'portal (VPS)'}
                </b>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock size={12} />
                {c.acompanhamento === 'email'
                  ? (c.ultima_varredura_em ? `última leitura da caixa ${quando(c.ultima_varredura_em)}` : 'ainda não leu a caixa')
                  : (c.ultima_varredura_em ? `última varredura ${quando(c.ultima_varredura_em)}` : 'ainda não varreu')}
              </div>
              {c.acompanhamento === 'email' ? (
                <BlocoEmail conta={c} caixa={caixa} />
              ) : (
                <>
                  {/* conta na estação local (Elektro): a estação pulsa a cada minuto */}
                  {(() => {
                    const e = estadoDaEstacao(c);
                    if (!e) return null;
                    return (
                      <div className={cn('text-xs flex items-center gap-1.5', e.online ? 'text-emerald-600' : 'text-amber-600')}>
                        <MonitorSmartphone size={12} />
                        <span className={cn('inline-block w-2 h-2 rounded-full', e.online ? 'bg-emerald-500' : 'bg-amber-500')} />
                        {e.texto}
                      </div>
                    );
                  })()}
                  {c.modo === 'local' && c.sessao_viva_desde && (
                    <p className="text-xs text-emerald-700">Sessão no portal viva desde {quando(c.sessao_viva_desde)} — a estação toca o portal a cada 10 min; sem pedir código.</p>
                  )}
                  {c.modo === 'local' && c.situacao === 'sessao_expirada' && !c.sessao_viva_desde && (
                    <p className="text-xs text-amber-700">Aguardando login na estação: ninguém digitou o código da imagem na última visita.</p>
                  )}
                </>
              )}
              {c.ultimo_erro && <p className="text-xs text-red-600">{c.ultimo_erro}</p>}
              {/* No e-mail não há login de portal: o que destrava o botão é a
                  caixa configurada no tenant. */}
              <Button size="sm" variant="outline" className="gap-2 w-full"
                disabled={(c.acompanhamento === 'email' ? !caixaPronta : !c.login) || pedir.isPending}
                onClick={() => pedir.mutate({
                  accountId: c.id,
                  tipo: c.acompanhamento === 'email' ? 'varredura_email' : 'varredura',
                })}>
                <RefreshCw size={14} /> Verificar agora
              </Button>
            </div>
          ))}
        </div>

        {/* Criações CPFL */}
        {runsCriacao.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Criações no portal CPFL</h2>
              {runsCriacao.length > criacoesVisiveis.length || historicoCriacoes ? (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setHistoricoCriacoes(v => !v)}>
                  {historicoCriacoes ? 'Só a última por projeto' : `Ver histórico (${runsCriacao.length})`}
                </Button>
              ) : null}
            </div>
            <div className="space-y-2">
              {criacoesVisiveis.map(r => <CardCriacaoCpfl key={r.id} run={r} />)}
            </div>
          </div>
        )}

        {/* Relatório */}
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Recomendações</h2>
          <div className="ml-auto flex gap-1">
            {(['pendente', 'aplicada', 'ignorada', 'todas'] as const).map(f => (
              <Button key={f} size="sm" variant={filtro === f ? 'default' : 'ghost'} onClick={() => setFiltro(f)}>
                {f === 'pendente' ? 'Pendentes' : f === 'aplicada' ? 'Aplicadas' : f === 'ignorada' ? 'Ignoradas' : 'Todas'}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
        ) : (
          <>
            {/* Consulta que falhou NÃO é lista vazia: dizer "Nada pendente" esconderia
                as recomendações (e o contador da barra lateral some junto). O aviso vem
                sempre que há erro; se ainda há linhas de antes, elas ficam abaixo. */}
            {isError && (
              <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900 flex flex-wrap items-center gap-3">
                <AlertTriangle size={18} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <b>Não consegui carregar as recomendações.</b>{' '}
                  Isto não quer dizer que não haja nenhuma pendente — a consulta falhou.
                  {mensagemDeErro(erroDasRecomendacoes) && (
                    <span className="block text-xs text-red-800 break-words mt-0.5">{mensagemDeErro(erroDasRecomendacoes)}</span>
                  )}
                </div>
                <Button size="sm" variant="outline" className="gap-2" disabled={isFetching} onClick={() => void refetch()}>
                  {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Tentar de novo
                </Button>
              </div>
            )}
            {updates.length === 0 ? (
              !isError && (
                <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
                  {filtro === 'pendente' ? 'Nada pendente — os portais estão como o sistema.' : 'Nenhuma linha aqui.'}
                </div>
              )
            ) : (
              // `etapa` nasce de `u.recomendacao`; sem a chave nova a seleção não acompanha o
              // refetch (a robô repete a leitura e muda a recomendação) e o "Aplicar" mandaria
              // uma etapa velha — ou nenhuma, e o banco usaria a nova sem o toast saber.
              <div className="space-y-3">{updates.map(u => <LinhaRecomendacao key={`${u.id}|${u.recomendacao ?? ''}`} u={u} />)}</div>
            )}
          </>
        )}

        <RegistroDaLudmilla />
      </div>
    </MainLayout>
  );
}
