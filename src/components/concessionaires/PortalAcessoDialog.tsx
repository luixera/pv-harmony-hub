import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Loader2, ShieldCheck, AlertTriangle, PlayCircle, Image as ImageIcon, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { EnergyConcessionaire } from '@/hooks/useEnergyConcessionaires';
import {
  conectorParaConcessionaria, PortalRun, urlDoPrint, usePedirRun, usePortalAccounts,
  usePortalRuns, useSetPortalCredentials, VereditoLogin,
} from '@/hooks/useLudmilla';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

/**
 * "Acesso ao portal" — onde o admin cadastra o login da Ludmilla no portal
 * de projetos da concessionária e pede o TESTE DE ACESSO.
 *
 * A senha entra e não volta: vai por RPC para o Vault. A tela só sabe que
 * está "configurado". O teste de acesso é o robô entrando de verdade, na
 * VPS, e contando o que viu depois da senha — é assim que se descobre se o
 * portal pede um segundo fator, sem ninguém precisar abrir o portal à mão.
 */

const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  nao_configurado: { rotulo: 'Não configurado', cor: 'text-muted-foreground' },
  ok:              { rotulo: 'Configurado',     cor: 'text-emerald-600' },
  sessao_expirada: { rotulo: 'Sessão expirada', cor: 'text-amber-600' },
  erro:            { rotulo: 'Com erro',        cor: 'text-red-600' },
};

const VEREDITO: Record<VereditoLogin['veredito'], { rotulo: string; cor: string }> = {
  entrou:             { rotulo: 'Entrou — chegou em "Meus Projetos"',  cor: 'text-emerald-600' },
  pediu_codigo_email: { rotulo: 'Pediu código por e-mail',             cor: 'text-amber-600' },
  pediu_codigo_sms:   { rotulo: 'Pediu código por SMS',                cor: 'text-amber-600' },
  senha_recusada:     { rotulo: 'Senha recusada',                      cor: 'text-red-600' },
  desconhecido:       { rotulo: 'Não reconheci a tela — veja o print', cor: 'text-muted-foreground' },
};

const TIPO: Record<string, string> = {
  reconhecimento: 'Reconhecimento da tela de login',
  teste_login: 'Teste de acesso',
  varredura: 'Varredura de protocolos',
};

function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function LinhaRun({ run }: { run: PortalRun }) {
  const [print, setPrint] = useState<string | null>(null);
  const abrirPrint = async () => {
    if (!run.print_path) return;
    const url = await urlDoPrint(run.print_path);
    if (url) setPrint(url);
  };
  const veredito = run.tipo === 'teste_login' && run.situacao === 'ok'
    ? (run.resultado as unknown as VereditoLogin | null) : null;
  const icone = run.situacao === 'ok' ? <CheckCircle2 size={14} className="text-emerald-600" />
    : run.situacao === 'erro' ? <XCircle size={14} className="text-red-600" />
    : <Clock size={14} className="text-muted-foreground animate-pulse" />;

  return (
    <div className="rounded-lg border p-3 text-sm space-y-1.5">
      <div className="flex items-center gap-2">
        {icone}
        <span className="font-medium">{TIPO[run.tipo] ?? run.tipo}</span>
        <span className="text-xs text-muted-foreground ml-auto">{quando(run.pedido_em)}</span>
      </div>
      {run.situacao === 'na_fila' && <p className="text-xs text-muted-foreground">Na fila — a Ludmilla pega em até 30 s.</p>}
      {run.situacao === 'rodando' && <p className="text-xs text-muted-foreground">A Ludmilla está no portal agora…</p>}
      {veredito && (
        <div>
          <p className={cn('font-medium', VEREDITO[veredito.veredito]?.cor)}>{VEREDITO[veredito.veredito]?.rotulo ?? veredito.veredito}</p>
          <p className="text-xs text-muted-foreground">{veredito.explicacao}</p>
        </div>
      )}
      {run.tipo === 'reconhecimento' && run.situacao === 'ok' && run.resultado && (
        <p className="text-xs text-muted-foreground">
          CAPTCHA: <b>{String(run.resultado.captcha)}</b> · campos: {Array.isArray(run.resultado.campos) ? run.resultado.campos.length : 0}
          {run.resultado.bloqueado_por_waf ? ' · bloqueado antes do login' : ''}
        </p>
      )}
      {run.erro && <p className="text-xs text-red-600">{run.erro}</p>}
      {run.print_path && (
        <div>
          {!print ? (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs gap-1" onClick={abrirPrint}>
              <ImageIcon size={12} /> Ver o print do que ela viu
            </Button>
          ) : (
            <a href={print} target="_blank" rel="noreferrer">
              <img src={print} alt="Print do portal" className="mt-1 rounded border max-h-72 object-contain" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function PortalAcessoDialog({
  open, onOpenChange, concessionaire,
}: { open: boolean; onOpenChange: (v: boolean) => void; concessionaire: EnergyConcessionaire | null }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: contas = [] } = usePortalAccounts();
  const conta = contas.find(c => c.concessionaire_id === concessionaire?.id) ?? null;
  const { data: runs = [] } = usePortalRuns(conta?.id);
  const gravar = useSetPortalCredentials();
  const pedir = usePedirRun();

  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  useEffect(() => { setLogin(conta?.login ?? ''); setSenha(''); }, [conta?.id, conta?.login, open]);

  const conector = concessionaire ? conectorParaConcessionaria(concessionaire.name) : null;
  const emAndamento = runs.some(r => r.situacao === 'na_fila' || r.situacao === 'rodando');

  const salvar = () => {
    if (!concessionaire) return;
    gravar.mutate({ concessionaireId: concessionaire.id, login: login.trim(), senha });
    setSenha('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" /> Acesso ao portal — {concessionaire?.name}
          </DialogTitle>
          <DialogDescription>
            A Ludmilla entra no portal de projetos com este login para ler o status dos protocolos.
            Só leitura: ela nunca envia nada no portal.
          </DialogDescription>
        </DialogHeader>

        {!conector ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>A Ludmilla ainda não tem roteiro para o portal da <b>{concessionaire?.name}</b>. Hoje ela sabe entrar na CPFL e na Elektro.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Situação */}
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className={cn('w-4 h-4', SITUACAO[conta?.situacao ?? 'nao_configurado'].cor)} />
              <span className={SITUACAO[conta?.situacao ?? 'nao_configurado'].cor}>
                {SITUACAO[conta?.situacao ?? 'nao_configurado'].rotulo}
              </span>
              {conta?.login && <span className="text-muted-foreground">· {conta.login}</span>}
            </div>
            {conta?.ultimo_erro && <p className="text-xs text-red-600 -mt-3">{conta.ultimo_erro}</p>}

            {/* Credenciais — só admin grava */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Login no portal (e-mail)</Label>
                <Input value={login} onChange={e => setLogin(e.target.value)} placeholder="projetista@empresa.com.br" disabled={!isAdmin} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label>Senha {conta?.login ? '(deixe em branco para manter)' : ''}</Label>
                <Input type="password" value={senha} onChange={e => setSenha(e.target.value)} disabled={!isAdmin} autoComplete="new-password" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-3">
              A senha é gravada cifrada no cofre do banco e não aparece mais para ninguém — só a Ludmilla, na hora de entrar.
            </p>

            <div className="flex flex-wrap gap-2">
              {isAdmin && (
                <Button onClick={salvar} disabled={gravar.isPending || !login.trim() || (!senha && !conta?.login)}>
                  {gravar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {conta?.login ? 'Atualizar acesso' : 'Gravar acesso'}
                </Button>
              )}
              <Button
                variant="outline" className="gap-2"
                disabled={!conta?.login || pedir.isPending || emAndamento}
                onClick={() => conta && pedir.mutate({ accountId: conta.id, tipo: 'teste_login' })}
              >
                <PlayCircle className="w-4 h-4" /> Testar acesso
              </Button>
              <Button
                variant="ghost" className="gap-2"
                disabled={!conta || pedir.isPending || emAndamento}
                onClick={() => conta && pedir.mutate({ accountId: conta.id, tipo: 'reconhecimento' })}
                title="Abre a tela de login sem entrar e descreve o que vê (CAPTCHA, campos, bloqueio)"
              >
                Só reconhecer a tela
              </Button>
            </div>

            {/* Runs */}
            {conta && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Últimas visitas da Ludmilla</h4>
                {runs.length === 0
                  ? <p className="text-sm text-muted-foreground">Nenhuma ainda. Grave o acesso e clique em "Testar acesso".</p>
                  : runs.map(r => <LinhaRun key={r.id} run={r} />)}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
