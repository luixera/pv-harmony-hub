import { useState } from 'react';
import { CheckCircle2, ChevronRight, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { urlDoPrint, usePassosCriacao, type PassoCriacao, type PortalRun } from '@/hooks/useLudmilla';
import { useProjetosDasCriacoes } from '@/hooks/useLudmillaDecidir';
import { rotuloDaCriacao, type ProjetoDaCriacao } from '@/lib/ludmillaPainel';
import { dataCurta as quando } from '@/components/ludmilla/decidir/visual';
import { cn } from '@/lib/utils';

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

/**
 * Um pedido "Criar na CPFL" — movido de `pages/Ludmilla.tsx`. O título passou a ser o CÓDIGO do
 * projeto (era "Projeto 1a2b3c4d…") e o cartão mostra o número que a CPFL deu (`resultado.node`,
 * senão `projects.cpfl_node_id`) — decisão 10 do plano.
 */
function CardCriacaoCpfl({ run, projetoDe }: { run: PortalRun; projetoDe: (id: string) => ProjetoDaCriacao | null }) {
  const [expandido, setExpandido] = useState(false);
  const { data: passos = [] } = usePassosCriacao(expandido ? run.id : null);
  const [printUrls, setPrintUrls] = useState<Record<string, string>>({});
  const { titulo, numeroCpfl } = rotuloDaCriacao(run, projetoDe);

  async function carregarPrint(passo: PassoCriacao) {
    if (!passo.screenshot || printUrls[passo.id]) return;
    const url = await urlDoPrint(passo.screenshot);
    if (url) setPrintUrls(prev => ({ ...prev, [passo.id]: url }));
  }

  const situacaoCor = run.situacao === 'ok'
    ? 'text-emerald-600' : run.situacao === 'erro'
      ? 'text-red-600' : run.situacao === 'rodando'
        ? 'text-blue-600' : 'text-muted-foreground';

  return (
    <div data-criacao={run.id} className="rounded-xl border bg-card overflow-hidden">
      <button type="button" onClick={() => setExpandido(e => !e)} aria-expanded={expandido}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{titulo}</span>
            {numeroCpfl && <span className="text-xs text-muted-foreground">CPFL nº <span className="font-mono">{numeroCpfl}</span></span>}
            <span className={cn('text-xs font-semibold', situacaoCor)}>
              {run.situacao === 'na_fila' ? 'na fila'
               : run.situacao === 'rodando' ? 'em andamento'
               : run.situacao === 'ok' ? 'concluído'
               : 'erro'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{quando(run.pedido_em)}</div>
        </div>
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', expandido && 'rotate-90')} />
      </button>

      {run.situacao === 'erro' && run.erro && <p className="px-4 pb-3 text-xs text-red-600">{run.erro}</p>}

      {expandido && (
        <div className="px-4 pb-4 space-y-2">
          {passos.length === 0 && run.situacao !== 'na_fila' && (
            <p className="text-xs text-muted-foreground">Nenhum passo registrado ainda.</p>
          )}
          {passos.map(p => (
            <div key={p.id} className="border rounded-md overflow-hidden">
              <button type="button" onClick={() => carregarPrint(p)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left">
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
                    <img src={printUrls[p.id]} alt={`Screenshot — ${NOMES_PASSO[p.nome]}`}
                      className="rounded border w-full max-h-48 object-cover object-top" />
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
 * Aba Criações na CPFL. Cada tentativa vira um run: sem o agrupamento, 20 cartões de erro do
 * mesmo projeto enchem a aba. Por padrão, só a última por projeto (5 no máximo).
 */
export function AbaCriacoesCpfl({ runs }: { runs: PortalRun[] }) {
  const [historico, setHistorico] = useState(false);
  const ids = runs.map(r => r.dados?.['project_id']).filter((x): x is string => typeof x === 'string');
  const { data: projetos = [] } = useProjetosDasCriacoes(ids);
  const projetoDe = (id: string) => projetos.find(p => p.id === id) ?? null;

  const visiveis = (() => {
    if (historico) return runs;
    const porProjeto = new Map<string, PortalRun>();
    for (const r of runs) {
      const chave = String(r.dados?.['project_id'] ?? r.id);
      if (!porProjeto.has(chave)) porProjeto.set(chave, r);
    }
    return [...porProjeto.values()].slice(0, 5);
  })();

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        Nenhuma criação pedida ainda. O botão "Criar na CPFL" fica no modal do projeto.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Criações no portal CPFL</h2>
        {runs.length > visiveis.length || historico ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setHistorico(v => !v)}>
            {historico ? 'Só a última por projeto' : `Ver histórico (${runs.length})`}
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">{visiveis.map(r => <CardCriacaoCpfl key={r.id} run={r} projetoDe={projetoDe} />)}</div>
    </div>
  );
}
