import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, KeyRound, Loader2, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { useCriarApiKey, useLudmillaApiKeys, useRevogarApiKey, urlDaApiDeStatus } from '@/hooks/useLudmillaApiKeys';

/**
 * CHAVES DA API DE STATUS — a porta por onde a pessoa (ou um script dela)
 * entrega o status lido num portal que a Ludmilla não consegue ler sozinha.
 * Nasceu pela Elektro (13/10/2026): o Portal GD bloqueia navegador
 * automatizado antes do login, até na estação local.
 *
 * A chave aparece UMA vez, na criação. O banco guarda só o hash — se perder,
 * revoga e cria outra.
 */
export function ChavesDaApi({ concessionaria }: { concessionaria: string }) {
  const { data: chaves = [], isLoading } = useLudmillaApiKeys();
  const criar = useCriarApiKey();
  const revogar = useRevogarApiKey();
  const [nome, setNome] = useState('');
  const [recemCriada, setRecemCriada] = useState<{ prefixo: string; chave: string } | null>(null);

  const copiar = async (texto: string, oQue: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success(`${oQue} copiado`); }
    catch { toast.error('Não consegui copiar — selecione e copie à mão'); }
  };

  const exemplo = `curl -X POST "${urlDaApiDeStatus()}" \\
  -H "Authorization: Bearer ${recemCriada?.chave ?? 'gdm_SUA_CHAVE'}" \\
  -H "Content-Type: application/json" \\
  -d '{"concessionaria":"${concessionaria}","protocolos":[{"protocolo":"NUMERO","status":"COMO ESTA NO PORTAL","titular":"NOME"}]}'`;

  const ativas = chaves.filter(c => !c.revogada_em);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4" />
        <p className="text-sm font-semibold">API de status</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Para portal que a Ludmilla não consegue ler sozinha: você entra, lê a lista e entrega
        protocolo + status por aqui. O resto é igual à varredura — casamento com o projeto e
        recomendação na página Ludmilla, para confirmar.
      </p>

      <div className="flex gap-2">
        <Input
          value={nome} onChange={e => setNome(e.target.value)}
          placeholder='Nome da chave (ex.: "celular do Luiz")' className="h-9"
        />
        <Button
          size="sm" className="gap-2 shrink-0" disabled={!nome.trim() || criar.isPending}
          onClick={() => criar.mutate(nome.trim(), {
            onSuccess: r => { setRecemCriada({ prefixo: r.prefixo, chave: r.chave }); setNome(''); },
          })}
        >
          {criar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          Gerar chave
        </Button>
      </div>

      {recemCriada && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Copie agora — esta chave não aparece de novo.
          </p>
          <div className="flex gap-2 items-center">
            <code className="text-xs break-all flex-1">{recemCriada.chave}</code>
            <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => copiar(recemCriada.chave, 'Chave')}>
              <Copy className="w-3.5 h-3.5" /> Copiar
            </Button>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Exemplo de chamada</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-background p-2 text-[11px]">{exemplo}</pre>
            <Button size="sm" variant="ghost" className="gap-1 mt-1" onClick={() => copiar(exemplo, 'Exemplo')}>
              <Copy className="w-3.5 h-3.5" /> Copiar exemplo
            </Button>
          </details>
        </div>
      )}

      <div className="space-y-1">
        {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
        {!isLoading && ativas.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma chave ativa.</p>
        )}
        {ativas.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-2 text-xs rounded-md border px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium truncate">{c.nome}</p>
              <p className="text-muted-foreground">
                <code>{c.prefixo}</code> · criada {new Date(c.criado_em).toLocaleDateString('pt-BR')}
                {c.ultimo_uso_em ? ` · último uso ${new Date(c.ultimo_uso_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ' · nunca usada'}
              </p>
            </div>
            <Button
              size="sm" variant="ghost" className="gap-1 text-red-600 shrink-0"
              disabled={revogar.isPending}
              onClick={() => { if (confirm(`Revogar a chave "${c.nome}"? Quem a usa para de conseguir enviar.`)) revogar.mutate(c.id); }}
            >
              <ShieldOff className="w-3.5 h-3.5" /> Revogar
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
