import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { urlDoPrint, useResponderCaptcha, type PortalCaptcha } from '@/hooks/useLudmilla';

/**
 * CÓDIGO DA IMAGEM — a estação fotografou o CAPTCHA do portal e espera uma
 * pessoa. Quem responder primeiro (aqui, do celular que seja) libera a
 * visita. A Ludmilla nunca lê a imagem: a foto é para você.
 *
 * Movido de `pages/Ludmilla.tsx` sem mudar o que faz; a página o põe acima de
 * todo alerta, em qualquer aba (expira em 5 min).
 */
export function CartaoCaptcha({ c, portal }: { c: PortalCaptcha; portal: string }) {
  const responder = useResponderCaptcha();
  const [imagem, setImagem] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { urlDoPrint(c.imagem_path).then(setImagem); }, [c.imagem_path]);
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const restam = Math.max(0, Math.round((new Date(c.expira_em).getTime() - agora) / 1000));
  const enviar = () => {
    if (!codigo.trim()) return;
    responder.mutate({ captchaId: c.id, resposta: codigo.trim() });
  };
  return (
    <div data-teste="captcha" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="w-5 h-5 text-amber-700" />
        <span className="font-semibold text-amber-900">A Ludmilla precisa do código da imagem — {portal}</span>
        <span className="ml-auto text-xs text-amber-800 tabular-nums">{Math.floor(restam / 60)}:{String(restam % 60).padStart(2, '0')}</span>
      </div>
      {c.tentativa > 1 && (
        <p className="text-xs text-amber-800">
          Tentativa {c.tentativa}{c.mensagem ? ` — o portal disse: "${c.mensagem}"` : ''}. Nova imagem abaixo.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {imagem
          ? <img src={imagem} alt="Código da imagem do portal" className="rounded border bg-white h-16 object-contain" />
          : <div className="h-16 w-40 rounded border bg-white flex items-center justify-center text-xs text-muted-foreground">carregando…</div>}
        <Input
          value={codigo} onChange={e => setCodigo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar(); }}
          placeholder="Digite os caracteres" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false}
          className="w-44 text-lg tracking-widest font-mono"
        />
        <Button onClick={enviar} disabled={!codigo.trim() || responder.isPending || restam === 0} className="gap-2">
          {responder.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Enviar
        </Button>
      </div>
      <p className="text-xs text-amber-800">
        A estação preenche o código no portal e entra. Se errar, ela manda outra imagem. Ninguém além de você lê a imagem.
      </p>
    </div>
  );
}
