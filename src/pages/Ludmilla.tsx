import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Radar, CheckCircle2, XCircle, ArrowRight, ExternalLink, RefreshCw, Loader2, Clock, KeyRound, MonitorSmartphone } from 'lucide-react';
import {
  estadoDaEstacao, PortalUpdate, useAplicarUpdate, useIgnorarUpdate, useLudmillaDisponivel, usePedirRun,
  usePortalAccounts, usePortalUpdates,
} from '@/hooks/useLudmilla';
import { useStatusLabel, useStatusOrder } from '@/hooks/useStatusLabel';
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires';
import { cn } from '@/lib/utils';

/**
 * LUDMILLA — relatório de atualizações dos portais.
 *
 * Cada linha é um protocolo cujo status no portal pede atenção: mudou desde a
 * última visita, ou a tradução aponta uma etapa à frente da atual. A Ludmilla
 * só recomenda (decisão do usuário, set/2026): quem move o card é a pessoa,
 * aqui, com "Aplicar" — e pode escolher outra etapa que não a recomendada.
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

export function LinhaRecomendacao({ u }: { u: PortalUpdate }) {
  const navigate = useNavigate();
  const rotulo = useStatusLabel();
  const etapas = useStatusOrder();
  const aplicar = useAplicarUpdate();
  const ignorar = useIgnorarUpdate();
  const [etapa, setEtapa] = useState<string>(u.recomendacao ?? '');
  const pendente = u.situacao === 'pendente';

  return (
    <div className={cn('rounded-xl border bg-card p-4 space-y-3', !pendente && 'opacity-70')}>
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
            <span className="text-sm text-muted-foreground truncate">{u.titular_portal}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Protocolo {u.protocolo} · visto {quando(u.detectado_em)}
            {u.atualizar_protocolo && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                protocolo novo — casado por {u.casamento === 'cpf' ? 'CPF/CNPJ' : u.casamento === 'uc' ? 'UC' : 'título'}; no cadastro está {u.protocolo_anterior || '(vazio)'}
              </span>
            )}
            {u.raw?.['Última atualização'] ? ` · atualizado no portal em ${u.raw['Última atualização']}` : ''}
          </div>
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

export default function Ludmilla() {
  const disponivel = useLudmillaDisponivel();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<'pendente' | 'aplicada' | 'ignorada' | 'todas'>('pendente');
  const { data: updates = [], isLoading } = usePortalUpdates(filtro);
  const { data: contas = [] } = usePortalAccounts();
  const { data: concessionarias = [] } = useEnergyConcessionaires(false);
  const pedir = usePedirRun();

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
              O que mudou nos portais das concessionárias, com a recomendação de etapa. Ela lê; você decide.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/admin/energy-concessionaires')}>
            <KeyRound size={14} /> Acessos aos portais
          </Button>
        </div>

        {/* Contas: última varredura + verificar agora */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contas.length === 0 && (
            <div className="rounded-xl border p-4 text-sm text-muted-foreground sm:col-span-3">
              Nenhum portal configurado. Em Concessionárias, use o ícone de chave para cadastrar o acesso.
            </div>
          )}
          {contas.map(c => (
            <div key={c.id} className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{nomeDaConta(c.id)}</span>
                <span className={cn('text-xs',
                  c.situacao === 'ok' ? 'text-emerald-600' : c.situacao === 'nao_configurado' ? 'text-muted-foreground' : 'text-red-600')}>
                  {c.situacao === 'ok' ? 'conectada' : c.situacao === 'nao_configurado' ? 'sem acesso' : c.situacao === 'sessao_expirada' ? 'sessão expirada' : 'com erro'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock size={12} /> {c.ultima_varredura_em ? `última varredura ${quando(c.ultima_varredura_em)}` : 'ainda não varreu'}
              </div>
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
              {c.modo === 'local' && c.situacao === 'sessao_expirada' && (
                <p className="text-xs text-amber-700">Aguardando login na estação: ninguém digitou o código da imagem na última visita.</p>
              )}
              {c.ultimo_erro && <p className="text-xs text-red-600">{c.ultimo_erro}</p>}
              <Button size="sm" variant="outline" className="gap-2 w-full"
                disabled={!c.login || pedir.isPending}
                onClick={() => pedir.mutate({ accountId: c.id, tipo: 'varredura' })}>
                <RefreshCw size={14} /> Verificar agora
              </Button>
            </div>
          ))}
        </div>

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
        ) : updates.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            {filtro === 'pendente' ? 'Nada pendente — os portais estão como o sistema.' : 'Nenhuma linha aqui.'}
          </div>
        ) : (
          <div className="space-y-3">{updates.map(u => <LinhaRecomendacao key={u.id} u={u} />)}</div>
        )}
      </div>
    </MainLayout>
  );
}
