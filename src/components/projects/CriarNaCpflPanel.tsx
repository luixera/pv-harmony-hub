import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import {
  useCriarProjetoCpfl,
  usePassosCriacao,
  usePortalAccounts,
  useRunCriacao,
  useLudmillaDisponivel,
  urlDoPrint,
  type PassoCriacao,
} from '@/hooks/useLudmilla';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

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

  const [runId, setRunId] = useState<string | null>(null);
  const criarMutation = useCriarProjetoCpfl();

  // Último run deste projeto ao montar (ativo ou o que acabou de terminar):
  // é o que mostra "na fila" e o erro de quem falhou antes do passo 1 (login).
  const { data: runRecente } = useQuery({
    queryKey: ['run-recente-criacao', projectId],
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from('portal_sync_runs' as never)
        .select('id, situacao, terminado_em')
        .eq('tipo', 'criar_projeto')
        .filter('dados->>project_id', 'eq', projectId)
        .order('pedido_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      const r = data as { id: string; situacao: string; terminado_em: string | null } | null;
      if (!r) return null;
      // terminado há mais de 1 h não interessa mais
      if (r.terminado_em && Date.now() - new Date(r.terminado_em).getTime() > 3_600_000) return null;
      return r.id;
    },
    enabled: disponivel && !runId,
  });

  const idEfetivo = runId ?? runRecente ?? null;
  const { data: run } = useRunCriacao(idEfetivo);
  const runTerminou = run?.situacao === 'ok' || run?.situacao === 'erro';
  const { data: passosExibidos = [] } = usePassosCriacao(idEfetivo, runTerminou);

  if (!disponivel || !cpflAccount || !ehCpfl) return null;

  const concluido    = passosExibidos.some(p => p.nome === 'concluido' && p.status === 'ok');
  const simulado     = passosExibidos.some(p => p.nome === 'simulado' && p.status === 'ok');
  const passoComErro = passosExibidos.some(p => p.status === 'erro');
  const comErro      = passoComErro || run?.situacao === 'erro';
  const naFila       = run?.situacao === 'na_fila' && passosExibidos.length === 0;
  const rodando      = !concluido && !simulado && !comErro && (passosExibidos.length > 0 || naFila || run?.situacao === 'rodando');

  function iniciar(simular = false) {
    if (!cpflAccount) return;
    criarMutation.mutate(
      { accountId: cpflAccount.id, projectId, simular },
      { onSuccess: (id) => setRunId(id) },
    );
  }

  const botaoSimular = !rodando && (
    <Button size="sm" variant="outline" onClick={() => iniciar(true)} disabled={criarMutation.isPending}
      title="A Ludmilla preenche o formulário inteiro, tira os prints de cada etapa e para antes do Salvar — nada é criado no portal.">
      Simular
    </Button>
  );

  if (cpflNodeId && passosExibidos.length === 0) {
    return (
      <div className="rounded-md border px-4 py-3 bg-green-50 dark:bg-green-950/20 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="flex-1">Projeto registrado na CPFL — node <strong>{cpflNodeId}</strong></span>
        {botaoSimular}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {naFila ? 'Na fila — a Ludmilla começa em instantes…'
           : rodando ? 'A Ludmilla está preenchendo o formulário…'
           : comErro ? 'Ocorreu um erro durante a criação.'
           : concluido ? 'Projeto criado com sucesso!'
           : simulado ? 'Simulação concluída: tudo preenchido até a revisão, sem salvar.'
           : cpflNodeId ? `Projeto registrado na CPFL — node ${cpflNodeId}`
           : 'Ainda não registrado na CPFL.'}
        </div>
        <div className="flex items-center gap-2">
          {botaoSimular}
          {!rodando && !concluido && !cpflNodeId && (
            <Button
              size="sm"
              variant={comErro ? 'destructive' : 'default'}
              onClick={() => iniciar(false)}
              disabled={criarMutation.isPending}
            >
              {criarMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              {comErro ? 'Tentar novamente' : 'Criar na CPFL'}
            </Button>
          )}
        </div>
        {rodando && (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Em andamento
          </Badge>
        )}
      </div>

      {/* erro antes do passo 1 (login, dados do projeto): só o run sabe contar */}
      {run?.situacao === 'erro' && !passoComErro && run.erro && (
        <p className="text-xs text-red-600 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2">{run.erro}</p>
      )}

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
