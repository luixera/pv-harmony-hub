import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, ChevronRight, ExternalLink, FileText, Loader2, Paperclip, RotateCcw, ShieldAlert,
} from 'lucide-react';
import {
  atencaoDaMensagem, contadorDoRun, useMensagensEmail, useRelerEmail,
  type AtencaoEmail, type IdentificacaoConta, type MensagemEmail, type PortalRun,
} from '@/hooks/useLudmilla';
import { ROTULO_TIPO } from '@/components/ludmilla/RegrasEmail';
import { referenciaDaMensagem } from '@/lib/ludmillaCartao';
import { cn } from '@/lib/utils';

/**
 * O QUE A LUDMILLA LEU NA CAIXA — e, antes disso, o que ela não conseguiu ler.
 *
 * Esta tela é a ÚNICA recuperação de uma mensagem que travou. O robô para de
 * tentar na 5ª tentativa e não avisa ninguém; o e-mail que nenhuma regra
 * reconheceu é marcado como concluído de propósito (insistir faria a robô
 * rebaixar o mesmo e-mail duas vezes por dia para sempre). Nos dois casos o
 * documento ficaria invisível para sempre. Por isso as linhas que pedem atenção
 * vêm PRIMEIRO, separadas da lista cronológica, e cada uma tem "ler de novo".
 */

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const VEREDITO: Record<string, { texto: string; cor: string }> = {
  favoravel:     { texto: 'favorável',        cor: 'bg-emerald-100 text-emerald-800' },
  pendencia:     { texto: 'com pendência',    cor: 'bg-amber-100 text-amber-800' },
  inconclusivo:  { texto: 'não consegui ler', cor: 'bg-slate-200 text-slate-700' },
};

const GRUPO: Record<Exclude<AtencaoEmail, null>, { titulo: string; explica: string; cor: string }> = {
  desistiu: {
    titulo: 'Desisti depois de 5 tentativas',
    explica: 'Não volto nelas sozinha. Enquanto ninguém mandar ler de novo, o documento não chega ao card.',
    cor: 'border-red-300 bg-red-50',
  },
  a_tentar: {
    titulo: 'Vou tentar de novo',
    explica: 'Algo passageiro falhou (a leitura por IA ou o envio do anexo). Tento na próxima leitura da caixa.',
    cor: 'border-blue-300 bg-blue-50',
  },
  nao_reconheci: {
    titulo: 'Não reconheci estes e-mails',
    explica: 'Nenhuma regra casou com o assunto/remetente, então não cheguei a projeto nenhum. Corrija a regra acima e mande ler de novo — a regra nova, sozinha, não alcança o passado.',
    cor: 'border-amber-300 bg-amber-50',
  },
  ressalva: {
    titulo: 'Terminei, mas com um porém',
    explica: 'Olhe o motivo de cada linha: pode ser anexo que eu me recusei a mandar porque o titular divergia.',
    cor: 'border-amber-200 bg-amber-50/60',
  },
};

/** Um contador do último run, só quando o run o gravou. */
function Contador({ run, chave, rotulo, destaque }: {
  run: PortalRun | null; chave: string; rotulo: string; destaque?: boolean;
}) {
  const n = contadorDoRun(run, chave);
  if (n === null) return null;
  return (
    <div className={cn('rounded-lg border px-2.5 py-1.5 min-w-[7rem]',
      destaque && n > 0 ? 'border-amber-300 bg-amber-50' : 'bg-muted/40')}>
      <div className="text-base font-semibold tabular-nums leading-none">{n}</div>
      <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{rotulo}</div>
    </div>
  );
}

/**
 * Soma de contadores do `resultado` (ex.: não identificados + conflitos). Some se o
 * run não gravou nenhum deles; um que falte conta como zero, desde que outro exista.
 */
function ContadorSoma({ run, chaves, rotulo, destaque }: {
  run: PortalRun | null; chaves: string[]; rotulo: string; destaque?: boolean;
}) {
  const valores = chaves.map(c => contadorDoRun(run, c)).filter((v): v is number => v !== null);
  if (valores.length === 0) return null;
  const n = valores.reduce((a, b) => a + b, 0);
  return (
    <div className={cn('rounded-lg border px-2.5 py-1.5 min-w-[7rem]',
      destaque && n > 0 ? 'border-amber-300 bg-amber-50' : 'bg-muted/40')}>
      <div className="text-base font-semibold tabular-nums leading-none">{n}</div>
      <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{rotulo}</div>
    </div>
  );
}

/**
 * Os números da última leitura da caixa. São a rede de segurança do automático:
 * `imagens descartadas` é o ÚNICO lugar onde apareceria um documento legítimo
 * que a concessionária mandou escaneado como imagem, e `não anexei` é o número
 * que o usuário precisa olhar antes de confiar no automático.
 *
 * `identificacao` escolhe o jogo de quadros. Quem identifica POR REMETENTE (ENEL)
 * parte do e-mail e descobre o projeto, então o que importa é COMO achou (pelo
 * protocolo, pela UC, pelo nome) e quantos ficaram para a pessoa decidir ("levantei
 * a mão"). As chaves são as de `resultadoEnel` (worker/ludmilla/src/email/enel/run.ts).
 * Quem identifica pelo protocolo no assunto (EDP) segue com os quadros de sempre.
 */
export function ContadoresEmail({ run, identificacao = 'protocolo_no_assunto' }: {
  run: PortalRun | null; identificacao?: IdentificacaoConta;
}) {
  const porRemetente = identificacao === 'remetente';
  if (!run) {
    return (
      <p className="text-xs text-muted-foreground">
        Ela ainda não leu a caixa. O primeiro "Verificar agora" é manual e de propósito:{' '}
        {porRemetente
          ? 'a primeira leitura olha os últimos 30 dias dos remetentes das regras abaixo, então pode trazer muita coisa de uma vez.'
          : 'a busca por protocolo acha e-mail antigo, então a primeira leitura pode trazer muita coisa de uma vez.'}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        Na última leitura da caixa — {quando(run.pedido_em)}
        {run.situacao !== 'ok' && (
          <span className={cn('ml-2 px-1.5 py-0.5 rounded text-[11px]',
            run.situacao === 'erro' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800')}>
            {run.situacao === 'na_fila' ? 'na fila' : run.situacao === 'rodando' ? 'lendo agora' : 'terminou com erro'}
          </span>
        )}
      </div>
      {run.erro && <p className="text-xs text-red-600">{run.erro}</p>}
      {porRemetente ? (
        <div className="flex flex-wrap gap-2">
          <Contador run={run} chave="lidos" rotulo="e-mails lidos" />
          <Contador run={run} chave="por_protocolo" rotulo="achei pelo protocolo" />
          <Contador run={run} chave="por_uc" rotulo="achei pela UC" />
          <Contador run={run} chave="por_titular" rotulo="achei pelo nome" />
          {/* não achei o projeto, ou achei mais de um: sobra para a pessoa conferir à mão */}
          <ContadorSoma run={run} chaves={['nao_identificados', 'conflitos']} rotulo="levantei a mão: confira à mão" destaque />
          <Contador run={run} chave="bloqueados" rotulo="bloqueados: titular divergiu" destaque />
          <Contador run={run} chave="avisos" rotulo="avisos no sino" />
          <Contador run={run} chave="anexados" rotulo="documentos anexados" />
          <Contador run={run} chave="imagens_ignoradas" rotulo="imagens descartadas" destaque />
          <Contador run={run} chave="a_tentar_de_novo" rotulo="ficaram para a próxima" destaque />
          <Contador run={run} chave="falhas" rotulo="falhas" destaque />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Contador run={run} chave="protocolos" rotulo="projetos conferidos" />
          {/* C2: no e-mail este número NÃO é recomendação (como no portal) — é
              documento que de fato chegou ao card, e é verificável sem IA. */}
          <Contador run={run} chave="anexados" rotulo="documentos anexados" />
          <Contador run={run} chave="bloqueados" rotulo="não anexei: titular divergiu" destaque />
          <Contador run={run} chave="imagens_ignoradas" rotulo="imagens descartadas" destaque />
          <Contador run={run} chave="a_tentar_de_novo" rotulo="ficaram para a próxima" destaque />
          <Contador run={run} chave="falhas" rotulo="falhas" destaque />
        </div>
      )}
    </div>
  );
}

function LinhaMensagem({ m, atencao }: { m: MensagemEmail; atencao: AtencaoEmail }) {
  const navigate = useNavigate();
  const reler = useRelerEmail();
  const v = m.veredito ? VEREDITO[m.veredito] : null;
  const referencia = referenciaDaMensagem(m.protocolo, m.project?.code);

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {m.project ? (
            <button className="font-semibold hover:underline inline-flex items-center gap-1"
              onClick={() => navigate(`/project/${m.project!.id}`)}>
              {m.project.code} <ExternalLink size={10} />
            </button>
          ) : (
            <span className="font-semibold text-muted-foreground">sem projeto casado</span>
          )}
          {/* a ENEL grava a chave '' (o e-mail não tem protocolo antes de ser identificado):
              nunca uma linha com "protocolo" e nada depois */}
          {referencia && <span className="text-muted-foreground">{referencia}</span>}
          {m.tipo_documento && (
            <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 whitespace-nowrap">
              {ROTULO_TIPO[m.tipo_documento] ?? m.tipo_documento}
            </span>
          )}
          {v && <span className={cn('px-1.5 py-0.5 rounded whitespace-nowrap', v.cor)}>{v.texto}</span>}
          {m.anexos > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Paperclip size={10} /> {m.anexos} no card
            </span>
          )}
          {atencao === 'a_tentar' && (
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 whitespace-nowrap">
              tentativa {m.tentativas} de 5
            </span>
          )}
          {atencao === 'desistiu' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-800 whitespace-nowrap">
              <ShieldAlert size={10} /> {m.tentativas} tentativas — desisti
            </span>
          )}
        </div>
        <p className="text-muted-foreground break-words">
          <span className="font-mono">{m.assunto || '(sem assunto)'}</span>
          {m.remetente ? ` — ${m.remetente}` : ''}
        </p>
        {/* C4: qual anexo a IA leu. Quando o e-mail traz mais de um PDF ela lê o
            MAIOR, e sem isto não há como conferir se foi o documento certo. */}
        {m.arquivo_lido && (
          <p className="inline-flex items-center gap-1 text-muted-foreground">
            <FileText size={10} /> a IA leu <span className="font-mono">{m.arquivo_lido}</span>
          </p>
        )}
        {m.resumo && <p className="text-muted-foreground break-words">{m.resumo}</p>}
        {m.motivo && (
          <p className="inline-flex items-start gap-1 text-amber-700 break-words">
            <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {m.motivo}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-muted-foreground whitespace-nowrap">
          {quando(m.recebido_em ?? m.created_at)}
        </span>
        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]"
          disabled={reler.isPending}
          title="Zera as tentativas e devolve a mensagem para a fila de leitura. Não move o card do projeto."
          onClick={() => reler.mutate(m.id)}>
          {reler.isPending ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Ler de novo
        </Button>
      </div>
    </div>
  );
}

export function MensagensEmail({ accountId }: { accountId: string }) {
  const { data: mensagens = [], isLoading } = useMensagensEmail(accountId);
  const [verTudo, setVerTudo] = useState(false);

  const comAtencao = mensagens
    .map(m => ({ m, a: atencaoDaMensagem(m) }))
    .filter((x): x is { m: MensagemEmail; a: Exclude<AtencaoEmail, null> } => x.a !== null);
  const ordem: Exclude<AtencaoEmail, null>[] = ['desistiu', 'a_tentar', 'nao_reconheci', 'ressalva'];
  const grupos = ordem
    .map(a => ({ a, itens: comAtencao.filter(x => x.a === a).map(x => x.m) }))
    .filter(g => g.itens.length > 0);

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Carregando o que ela leu…
      </div>
    );
  }

  if (mensagens.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhum e-mail lido ainda. Quando ela ler, cada mensagem aparece aqui com o documento que chegou ao card —
        e as que precisarem de você vêm separadas, no alto.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {grupos.map(({ a, itens }) => (
        <div key={a} className={cn('rounded-lg border divide-y', GRUPO[a].cor)}>
          <div className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={13} className="text-amber-700" />
              <span className="text-sm font-medium">{GRUPO[a].titulo}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{itens.length}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{GRUPO[a].explica}</p>
          </div>
          {itens.map(m => <LinhaMensagem key={m.id} m={m} atencao={a} />)}
        </div>
      ))}

      <button type="button" onClick={() => setVerTudo(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight size={13} className={cn('transition-transform', verTudo && 'rotate-90')} />
        {verTudo ? 'Esconder o histórico' : `Ver tudo o que ela leu (${mensagens.length})`}
      </button>
      {verTudo && (
        <div className="rounded-lg border bg-card divide-y">
          {mensagens.map(m => <LinhaMensagem key={m.id} m={m} atencao={atencaoDaMensagem(m)} />)}
        </div>
      )}
    </div>
  );
}
