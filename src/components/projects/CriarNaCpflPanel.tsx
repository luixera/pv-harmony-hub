import { useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react';
import {
  useCriarProjetoCpfl,
  useEnviosCpfl,
  useNovoEnvioCpfl,
  usePassosCriacao,
  usePortalAccounts,
  useLudmillaDisponivel,
  urlDoPrint,
  type PassoCriacao,
} from '@/hooks/useLudmilla';
import { useBeneficiarias } from '@/hooks/useBeneficiarias';
import { formatarUcCpfl, resumirRateio } from '@/lib/beneficiarias';
import { listarEnvios, type EnvioCpfl } from '@/lib/criacaoCpfl';
import { cn } from '@/lib/utils';

const NOMES_PASSO: Record<PassoCriacao['nome'], string> = {
  login:          'Login na CPFL',
  introducao:     'Introdução',
  dados_uc:       'Dados da UC',
  dados_projeto:  'Dados do Projeto',
  dados_cliente:  'Dados do Cliente',
  revisao:        'Revisão',
  concluido:      'Concluído',
  simulado:       'Simulação concluída — nada foi salvo',
};

function PassoItem({ passo }: { passo: PassoCriacao }) {
  const [aberto, setAberto] = useState(false);
  const [printUrl, setPrintUrl] = useState<string | null>(null);

  async function verPrint() {
    if (!passo.screenshot) return;
    if (!printUrl) {
      const url = await urlDoPrint(passo.screenshot);
      setPrintUrl(url);
    }
    setAberto(a => !a);
  }

  const icone = passo.status === 'ok'
    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    : passo.status === 'erro'
      ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
      : <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={passo.screenshot ? verPrint : undefined}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
      >
        {icone}
        <span className="flex-1 font-medium">{NOMES_PASSO[passo.nome] ?? passo.nome}</span>
        {passo.screenshot && (
          aberto
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {passo.erro && (
        <p className="px-3 pb-2 text-xs text-red-600">{passo.erro}</p>
      )}

      {aberto && printUrl && (
        <div className="px-3 pb-3">
          <a href={printUrl} target="_blank" rel="noopener noreferrer"
             className="block relative group">
            <img
              src={printUrl}
              alt={`Screenshot — ${NOMES_PASSO[passo.nome]}`}
              className="rounded border w-full max-h-64 object-cover object-top"
            />
            <span className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <ExternalLink className="h-4 w-4 text-white drop-shadow" />
            </span>
          </a>
        </div>
      )}
    </div>
  );
}

const COR_DA_SITUACAO: Record<EnvioCpfl['situacao'], string> = {
  ok:      'text-emerald-600',
  erro:    'text-red-600',
  rodando: 'text-blue-600',
  na_fila: 'text-muted-foreground',
};

/**
 * Um envio à CPFL (um run `criar_projeto`), com os passos e os prints DELE. Os passos só são
 * consultados quando o envio está aberto ou ativo: um projeto reprovado três vezes não carrega
 * três listas de prints ao abrir o modal.
 */
function EnvioItem({ envio, aberto, onAlternar }: { envio: EnvioCpfl; aberto: boolean; onAlternar: () => void }) {
  const { data: passos = [], isLoading } = usePassosCriacao(aberto || envio.ativo ? envio.runId : null, !envio.ativo);
  const passoComErro = passos.some(p => p.status === 'erro');

  return (
    <div data-envio={envio.runId} className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left min-w-0"
      >
        {aberto
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="font-medium shrink-0">{envio.titulo}</span>
        <span className="text-xs text-muted-foreground shrink-0">· {format(new Date(envio.pedidoEm), 'dd/MM/yyyy HH:mm')}</span>
        <span className={cn('text-xs font-semibold truncate min-w-0', COR_DA_SITUACAO[envio.situacao])} title={envio.rotulo}>
          · {envio.rotulo}
        </span>
        {envio.ativo && <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0 ml-auto" />}
      </button>

      {aberto && (
        <div className="px-3 pb-3 space-y-1.5">
          {envio.reenvioDe && (
            <p className="text-xs text-muted-foreground">
              Novo envio — o anterior era o nº <span className="font-mono">{envio.reenvioDe}</span>.
            </p>
          )}
          {/* erro antes do passo 1 (login, dados do projeto): só o run sabe contar */}
          {envio.situacao === 'erro' && envio.erro && !passoComErro && (
            <p className="text-xs text-red-600 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2">{envio.erro}</p>
          )}
          {passos.length === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground">
              {envio.situacao === 'na_fila'
                ? 'Na fila — os passos aparecem quando a Ludmilla começar.'
                : 'Nenhum passo registrado neste envio.'}
            </p>
          )}
          {passos.map(p => (
            <PassoItem key={p.id} passo={p} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  projectId: string;
  cpflNodeId?: string | null;
  concessionaireName?: string | null;
}

export function CriarNaCpflPanel({ projectId, cpflNodeId, concessionaireName }: Props) {
  const disponivel = useLudmillaDisponivel();
  const { data: contas = [] } = usePortalAccounts();
  const cpflAccount = contas.find(c => c.connector === 'cpfl');
  const ehCpfl = /cpfl/i.test(concessionaireName ?? '');

  const criarMutation = useCriarProjetoCpfl();
  const novoEnvio = useNovoEnvioCpfl();
  const [confirmando, setConfirmando] = useState(false);

  // Pré-checagem das beneficiárias: o que o portal recusaria, dito antes de
  // a Ludmilla começar (a RPC também recusa; isto é só para o botão não
  // prometer o que não vai acontecer).
  const { data: beneficiarias = [] } = useBeneficiarias(projectId);
  const comOutroTitular = beneficiarias.filter(b => b.holder_mismatch);
  const rateio = resumirRateio(beneficiarias.map(b => b.percent));
  const bloqueio = comOutroTitular.length > 0
    ? `Beneficiária de outro titular (${comOutroTitular.map(b => formatarUcCpfl(b.uc_number)).join(', ')}) — a CPFL recusa. Remova a linha ou confirme o titular pela conta.`
    : rateio.estourou
      ? `As beneficiárias somam ${rateio.soma}% — passa de 100. Ajuste os percentuais.`
      : null;
  const modalidade = beneficiarias.length > 0 ? 'autoconsumo remoto' : 'geração local';

  // Cada envio é um run; a lista substitui o "run recente" de antes (03/11/2026). Simulação
  // antiga fica fora: o modal deixou de simular em 02/11/2026.
  const { data: runs = [] } = useEnviosCpfl(projectId);
  const { envios, abreSozinho } = listarEnvios(runs);
  const ativo = [...envios].reverse().find(e => e.ativo) ?? null;
  const ultimo = envios[envios.length - 1] ?? null;
  const ultimoComErro = !ativo && ultimo?.situacao === 'erro';

  // o que a pessoa abriu ou fechou à mão vence o "abre sozinho"
  const [alternados, setAlternados] = useState<Record<string, boolean>>({});
  const estaAberto = (runId: string) => alternados[runId] ?? runId === abreSozinho;

  if (!disponivel || !cpflAccount || !ehCpfl) return null;

  function iniciar() {
    if (!cpflAccount) return;
    criarMutation.mutate({ accountId: cpflAccount.id, projectId });
  }

  function confirmarNovoEnvio() {
    if (!cpflAccount || !cpflNodeId) return;
    novoEnvio.mutate({ accountId: cpflAccount.id, projectId, nodeAtual: cpflNodeId });
  }

  return (
    <div className="space-y-3">
      {ativo ? (
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {ativo.situacao === 'na_fila'
              ? 'Na fila — a Ludmilla começa em instantes…'
              : 'A Ludmilla está preenchendo o formulário…'}
          </div>
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Em andamento
          </Badge>
        </div>
      ) : cpflNodeId ? (
        <div className="rounded-md border px-4 py-3 bg-green-50 dark:bg-green-950/20 text-sm text-green-700 dark:text-green-400 flex items-center gap-2 flex-wrap">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[12rem]">Projeto registrado na CPFL — nº <strong>{cpflNodeId}</strong></span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmando(true)}
            disabled={novoEnvio.isPending || !!bloqueio}
            title={bloqueio ?? 'A CPFL reprovou? A Ludmilla cria outro projeto no portal com os dados de hoje.'}
          >
            {novoEnvio.isPending
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
            Novo envio
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {ultimoComErro ? 'O último envio deu erro — veja os passos abaixo.' : 'Ainda não registrado na CPFL.'}
          </div>
          <Button
            size="sm"
            variant={ultimoComErro ? 'destructive' : 'default'}
            onClick={iniciar}
            disabled={criarMutation.isPending || !!bloqueio}
            title={bloqueio ?? `Cria o projeto na CPFL em ${modalidade}`}
          >
            {criarMutation.isPending && (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            )}
            {ultimoComErro ? 'Tentar novamente' : 'Criar na CPFL'}
          </Button>
        </div>
      )}

      {/* o que vai ser pedido ao portal, e o que impede de pedir */}
      {!ativo && (
        <p className="text-xs text-muted-foreground">
          Sistema de compensação: <strong>{modalidade}</strong>
          {beneficiarias.length > 0 && ` · ${beneficiarias.length} ${beneficiarias.length === 1 ? 'beneficiária' : 'beneficiárias'} · geradora fica com ${rateio.estourou ? '—' : rateio.geradora + '%'}`}
        </p>
      )}
      {bloqueio && !ativo && (
        <p className="text-xs text-red-700 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2">
          ⛔ {bloqueio}
        </p>
      )}

      {/* um item por envio, com os prints daquele envio (envio 1, envio 2…) */}
      {envios.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground">Envios</div>
          {envios.map(e => (
            <EnvioItem
              key={e.runId}
              envio={e}
              aberto={estaAberto(e.runId)}
              onAlternar={() => setAlternados(a => ({ ...a, [e.runId]: !estaAberto(e.runId) }))}
            />
          ))}
        </div>
      )}

      {/* fora dos ramos acima: quando o número some, a faixa verde sai e o diálogo continua montado */}
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Novo envio à CPFL</AlertDialogTitle>
            <AlertDialogDescription>
              A Ludmilla vai criar outro projeto na CPFL com os dados de hoje. Use quando a CPFL
              reprovou. O nº {cpflNodeId} fica guardado no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={novoEnvio.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarNovoEnvio} disabled={novoEnvio.isPending}>
              Fazer novo envio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
