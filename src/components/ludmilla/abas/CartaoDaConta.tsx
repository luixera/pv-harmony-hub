import { Clock, Globe, Inbox, KeyRound, Mail, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RegrasEmail } from '@/components/ludmilla/RegrasEmail';
import { ContadoresEmail, MensagensEmail } from '@/components/ludmilla/MensagensEmail';
import { estadoDaEstacao, useUltimoRunEmail, type PortalAccount, type TipoRun } from '@/hooks/useLudmilla';
import type { AgentConfigSafe } from '@/hooks/useAgentConfig';
import { dataCurta as quando } from '@/components/ludmilla/decidir/visual';
import { cn } from '@/lib/utils';

/**
 * O CORPO DO CARTÃO DE QUEM É ACOMPANHADA POR E-MAIL. Não tem nada de portal:
 * nem estação local, nem sessão viva, nem login — a credencial aqui é a caixa
 * do agente de e-mails, por tenant. Traz os contadores da última leitura, as
 * regras que ensinam a robô a reconhecer os e-mails, e o que ela já leu.
 */
function BlocoEmail({ conta, caixa, caixaPronta, caixaFalhou }: {
  conta: PortalAccount; caixa: AgentConfigSafe | null | undefined; caixaPronta: boolean | null; caixaFalhou: boolean;
}) {
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
        ) : caixaFalhou ? (
          // a consulta falhou: não afirmar que a caixa não existe, mas também não ficar "conferindo" para sempre
          <span data-teste="caixa-falhou" className="text-amber-700">
            Não deu para conferir a caixa de e-mail agora. Sem saber se ela está configurada, o
            "Verificar agora" fica desligado — recarregue a página daqui a pouco.
          </span>
        ) : caixaPronta === null ? (
          <span>Conferindo a caixa de e-mail do tenant…</span>
        ) : (
          <span className="text-amber-700">
            A caixa de e-mail deste tenant não está configurada — sem ela não há o que ler.
            Configure em Claudinho / Agente de e-mails.
          </span>
        )}
      </div>

      <ContadoresEmail run={run} identificacao={conta.identificacao} />

      {/* spec §3.3: as regras ficam RECOLHIDAS — é configuração, não decisão */}
      <details className="rounded-lg border bg-muted/20 p-3">
        <summary className="cursor-pointer text-sm font-medium">Regras de leitura dos e-mails</summary>
        <div className="pt-2"><RegrasEmail accountId={conta.id} tenantId={conta.tenant_id} /></div>
      </details>

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

/**
 * O cartão de cada conta — movido de `pages/Ludmilla.tsx` (era o `contas.map`). Mudou só o
 * pedido pela spec §3.3: as regras de e-mail recolhidas e o botão "Acesso ao portal".
 */
export function CartaoDaConta({ conta: c, nome, caixa, caixaPronta, caixaFalhou, agora, verificando, onVerificar, onAcessoAoPortal }: {
  conta: PortalAccount;
  nome: string;
  caixa: AgentConfigSafe | null | undefined;
  /** true = configurada · false = não configurada · null = sem resposta (carregando ou falhou) */
  caixaPronta: boolean | null;
  /** a consulta da caixa falhou sem resposta anterior: o bloco de e-mail diz isso, e não "conferindo" */
  caixaFalhou: boolean;
  agora: number;
  verificando: boolean;
  onVerificar: (tipo: TipoRun) => void;
  onAcessoAoPortal: () => void;
}) {
  const estacao = c.acompanhamento === 'email' ? null : estadoDaEstacao(c, agora);
  return (
    <div data-conta={c.id} className={cn('rounded-xl border bg-card p-4 space-y-2',
      // quem é acompanhada por e-mail tem regras e histórico para mostrar:
      // numa coluna de um terço não caberia nada legível
      c.acompanhamento === 'email' && 'sm:col-span-2 lg:col-span-3')}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{nome}</span>
        <span className={cn('text-xs',
          c.situacao === 'ok' ? 'text-emerald-600' : c.situacao === 'nao_configurado' ? 'text-muted-foreground' : 'text-red-600')}>
          {c.situacao === 'ok' ? 'conectada' : c.situacao === 'nao_configurado' ? 'sem acesso' : c.situacao === 'sessao_expirada' ? 'sessão expirada' : 'com erro'}
        </span>
      </div>
      {/* COMO esta concessionária é acompanhada. `modo` diz ONDE o robô roda;
          `acompanhamento` diz por que meio ele acompanha. */}
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        {c.acompanhamento === 'email' ? <Mail size={12} /> : <Globe size={12} />}
        Acompanho por <b className="text-foreground">
          {c.acompanhamento === 'email' ? 'e-mail' : c.modo === 'local' ? 'portal (estação local)' : 'portal (VPS)'}
        </b>
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock size={12} />
        {c.acompanhamento === 'email'
          ? (c.ultima_varredura_em ? `última leitura da caixa ${quando(c.ultima_varredura_em)}` : 'ainda não leu a caixa')
          : (c.ultima_varredura_em ? `última varredura ${quando(c.ultima_varredura_em)}` : 'ainda não varreu')}
      </div>
      {c.acompanhamento === 'email' ? (
        <BlocoEmail conta={c} caixa={caixa} caixaPronta={caixaPronta} caixaFalhou={caixaFalhou} />
      ) : (
        <>
          {/* conta na estação local (Elektro): a estação pulsa a cada minuto */}
          {estacao && (
            <div className={cn('text-xs flex items-center gap-1.5', estacao.online ? 'text-emerald-600' : 'text-amber-600')}>
              <MonitorSmartphone size={12} />
              <span className={cn('inline-block w-2 h-2 rounded-full', estacao.online ? 'bg-emerald-500' : 'bg-amber-500')} />
              {estacao.texto}
            </div>
          )}
          {c.modo === 'local' && c.sessao_viva_desde && (
            <p className="text-xs text-emerald-700">Sessão no portal viva desde {quando(c.sessao_viva_desde)} — a estação toca o portal a cada 10 min; sem pedir código.</p>
          )}
          {c.modo === 'local' && c.situacao === 'sessao_expirada' && !c.sessao_viva_desde && (
            <p className="text-xs text-amber-700">Aguardando login na estação: ninguém digitou o código da imagem na última visita.</p>
          )}
        </>
      )}
      {c.ultimo_erro && <p className="text-xs text-red-600">{c.ultimo_erro}</p>}
      <div className="flex flex-wrap gap-2">
        {/* No e-mail não há login de portal: o que destrava o botão é a caixa configurada no tenant. */}
        <Button size="sm" variant="outline" className="gap-2 flex-1"
          disabled={(c.acompanhamento === 'email' ? caixaPronta !== true : !c.login) || verificando}
          onClick={() => onVerificar(c.acompanhamento === 'email' ? 'varredura_email' : 'varredura')}>
          <RefreshCw size={14} /> Verificar agora
        </Button>
        {c.acompanhamento !== 'email' && (
          <Button size="sm" variant="ghost" className="gap-2" onClick={onAcessoAoPortal}>
            <KeyRound size={14} /> Acesso ao portal
          </Button>
        )}
      </div>
    </div>
  );
}
