import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle, QrCode, RefreshCw, Send, Unplug, Loader2 } from 'lucide-react';
import { useAtualizarZeConfig, useZeAcao, useZeConfig, useZeDisponivel, type ZeConfig } from '@/hooks/useZe';
import { cn } from '@/lib/utils';

/**
 * ZÉ — tela de administração. Entrega 1: só a conexão do WhatsApp e as
 * preferências básicas. Rotinas, conversa, aprendizados e execuções entram
 * nas entregas seguintes (spec §12).
 */

const SITUACAO: Record<ZeConfig['situacao'], { rotulo: string; cor: string }> = {
  desconectado: { rotulo: 'Desconectado', cor: 'bg-slate-100 text-slate-700' },
  aguardando_qr: { rotulo: 'Aguardando leitura do QR', cor: 'bg-amber-100 text-amber-800' },
  conectado: { rotulo: 'Conectado', cor: 'bg-emerald-100 text-emerald-800' },
};

const numeroBonito = (jid: string | null) => {
  const d = jid?.split('@')[0]?.replace(/\D/g, '') ?? '';
  return d ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : '—';
};

export default function Ze() {
  const disponivel = useZeDisponivel();
  const { data: cfg, isLoading } = useZeConfig();
  const acao = useZeAcao();
  const atualizar = useAtualizarZeConfig();

  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-muted-foreground">
          O Zé está disponível só para o administrador do GD Manager.
        </div>
      </MainLayout>
    );
  }

  const situacao = cfg?.situacao ?? 'desconectado';
  const ocupado = acao.isPending;

  return (
    <MainLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-7 h-7 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-semibold">Zé — assistente no WhatsApp</h1>
            <p className="text-sm text-muted-foreground">
              José conecta no SEU número e fala com você pelo chat "Você". Ele nunca manda mensagem para terceiros.
            </p>
          </div>
        </div>

        {/* ── Conexão ────────────────────────────────────────────────────── */}
        <section className="rounded-xl border p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">Conexão</h2>
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', SITUACAO[situacao].cor)}>
              {isLoading ? 'carregando…' : SITUACAO[situacao].rotulo}
            </span>
          </div>

          {cfg?.phone_jid && (
            <p className="text-sm">Número: <span className="font-mono">{numeroBonito(cfg.phone_jid)}</span></p>
          )}

          {situacao === 'aguardando_qr' && (
            <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4">
              {cfg?.qr_code
                ? <img src={cfg.qr_code} alt="QR Code do WhatsApp" className="h-64 w-64" />
                : (
                  <div className="flex h-64 w-64 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> gerando QR…
                  </div>
                )}
              <p className="text-xs text-muted-foreground text-center">
                No celular: WhatsApp → ⋮ → Dispositivos conectados → Conectar dispositivo.
                O QR troca a cada ~20 s; a tela acompanha sozinha.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {situacao !== 'conectado' && (
              <Button onClick={() => acao.mutate('conectar')} disabled={ocupado}>
                <QrCode className="mr-2 h-4 w-4" /> {situacao === 'aguardando_qr' ? 'Gerar QR de novo' : 'Conectar'}
              </Button>
            )}
            <Button variant="outline" onClick={() => acao.mutate('estado')} disabled={ocupado}>
              <RefreshCw className={cn('mr-2 h-4 w-4', ocupado && 'animate-spin')} /> Atualizar estado
            </Button>
            {situacao === 'conectado' && (
              <>
                <Button variant="secondary" onClick={() => acao.mutate('teste_envio')} disabled={ocupado}>
                  <Send className="mr-2 h-4 w-4" /> Testar envio para mim
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => { if (confirm('Desconectar o Zé do seu WhatsApp?')) acao.mutate('desconectar'); }}
                  disabled={ocupado}
                >
                  <Unplug className="mr-2 h-4 w-4" /> Desconectar
                </Button>
              </>
            )}
          </div>
        </section>

        {/* ── Preferências ───────────────────────────────────────────────── */}
        {cfg && (
          <section className="rounded-xl border p-5 space-y-4">
            <h2 className="font-medium">Preferências</h2>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Ignorar grupos na revisão de conversas</span>
              <Switch checked={cfg.ignorar_grupos} onCheckedChange={(v) => atualizar.mutate({ ignorar_grupos: v })} />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Horas sem resposta para me avisar</span>
              <Input
                type="number" min={1} max={72} className="w-24" defaultValue={cfg.horas_sem_resposta}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= 72 && n !== cfg.horas_sem_resposta) atualizar.mutate({ horas_sem_resposta: n });
                }}
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Transcrever áudios</span>
              <Select
                value={cfg.transcrever_audios}
                onValueChange={(v) => atualizar.mutate({ transcrever_audios: v as ZeConfig['transcrever_audios'] })}
              >
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos (conversas individuais)</SelectItem>
                  <SelectItem value="so_meus">Só os meus (chat "Você")</SelectItem>
                  <SelectItem value="nenhum">Nenhum</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <p className="text-xs text-muted-foreground">
              A transcrição entra na Entrega 4; a preferência já fica guardada.
            </p>
          </section>
        )}
      </div>
    </MainLayout>
  );
}
