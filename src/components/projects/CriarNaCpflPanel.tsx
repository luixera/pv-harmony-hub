import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import {
  useCriarProjetoCpfl,
  usePassosCriacao,
  usePortalAccounts,
  useLudmillaDisponivel,
  urlDoPrint,
  type PassoCriacao,
} from '@/hooks/useLudmilla';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

const NOMES_PASSO: Record<PassoCriacao['nome'], string> = {
  introducao:     'Introdução',
  dados_uc:       'Dados da UC',
  dados_projeto:  'Dados do Projeto',
  dados_cliente:  'Dados do Cliente',
  revisao:        'Revisão',
  concluido:      'Concluído',
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

interface Props {
  projectId: string;
  cpflNodeId?: string | null;
}

export function CriarNaCpflPanel({ projectId, cpflNodeId }: Props) {
  const disponivel = useLudmillaDisponivel();
  const { data: contas = [] } = usePortalAccounts();
  const cpflAccount = contas.find(c => c.connector === 'cpfl');

  const [runId, setRunId] = useState<string | null>(null);
  const criarMutation = useCriarProjetoCpfl();
  const { data: passosNovos = [] } = usePassosCriacao(runId);

  // Busca run ativo (na_fila ou rodando) para este projeto ao montar
  const { data: runAtivo } = useQuery({
    queryKey: ['run-ativo-criacao', projectId],
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from('portal_sync_runs' as never)
        .select('id')
        .eq('tipo', 'criar_projeto')
        .in('situacao', ['na_fila', 'rodando'])
        .filter('dados->>project_id', 'eq', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as { id: string } | null)?.id ?? null;
    },
    enabled: disponivel && !runId,
  });

  const idEfetivo = runId ?? runAtivo ?? null;
  const { data: passosAtivos = [] } = usePassosCriacao(runId ? null : idEfetivo);
  const passosExibidos = runId ? passosNovos : passosAtivos;

  if (!disponivel || !cpflAccount) return null;

  const concluido = passosExibidos.some(p => p.nome === 'concluido' && p.status === 'ok');
  const comErro    = passosExibidos.some(p => p.status === 'erro');
  const rodando    = !concluido && !comErro && passosExibidos.length > 0;

  function iniciar() {
    if (!cpflAccount) return;
    criarMutation.mutate(
      { accountId: cpflAccount.id, projectId },
      { onSuccess: (id) => setRunId(id) },
    );
  }

  if (cpflNodeId) {
    return (
      <div className="rounded-md border px-4 py-3 bg-green-50 dark:bg-green-950/20 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>Projeto registrado na CPFL — node <strong>{cpflNodeId}</strong></span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {rodando ? 'A Ludmilla está preenchendo o formulário…'
           : comErro ? 'Ocorreu um erro durante a criação.'
           : concluido ? 'Projeto criado com sucesso!'
           : 'Ainda não registrado na CPFL.'}
        </div>
        {!rodando && !concluido && (
          <Button
            size="sm"
            variant={comErro ? 'destructive' : 'default'}
            onClick={iniciar}
            disabled={criarMutation.isPending}
          >
            {criarMutation.isPending && (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            )}
            {comErro ? 'Tentar novamente' : 'Criar na CPFL'}
          </Button>
        )}
        {rodando && (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Em andamento
          </Badge>
        )}
      </div>

      {passosExibidos.length > 0 && (
        <div className="space-y-1.5">
          {passosExibidos.map(p => (
            <PassoItem key={p.id} passo={p} />
          ))}
        </div>
      )}
    </div>
  );
}
