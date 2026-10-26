import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardCheck, Loader2, MessageSquare, Paperclip, Radar, ShieldQuestion, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRegistroLudmilla, type AtorLudmilla, type RegistroLudmilla } from '@/hooks/useLudmilla';
import { dataCurta as quando } from '@/components/ludmilla/decidir/visual';
import { cn } from '@/lib/utils';

/**
 * REGISTRO — o que a Ludmilla fez e o que a equipe fez através dela.
 *
 * Não é uma tabela de log: é leitura unificada do que já estava gravado
 * (visitas, recomendações, decisões, anexos, pareceres, códigos de imagem,
 * tarefas encerradas), então o histórico inteiro aparece desde o primeiro dia.
 * Movido de `pages/Ludmilla.tsx` sem mudar o que faz.
 */
const ICONE_ACAO: Record<RegistroLudmilla['acao'], typeof Radar> = {
  visita: Radar,
  recomendacao: ArrowRight,
  aplicada: CheckCircle2,
  ignorada: XCircle,
  anexo: Paperclip,
  parecer: MessageSquare,
  captcha_pedido: ShieldQuestion,
  captcha_respondido: ShieldQuestion,
  tarefa_encerrada: ClipboardCheck,
};

export function RegistroDaLudmilla() {
  const navigate = useNavigate();
  const [ator, setAtor] = useState<'todos' | AtorLudmilla>('todos');
  const [tudo, setTudo] = useState(false);
  const { data: registro = [], isLoading } = useRegistroLudmilla(tudo ? 400 : 60, ator === 'todos' ? undefined : ator);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Registro</h2>
        <span className="text-xs text-muted-foreground">o que ela fez e o que foi feito através dela</span>
        <div className="ml-auto flex gap-1">
          {([['todos', 'Tudo'], ['ludmilla', 'Ela fez'], ['equipe', 'A equipe fez']] as const).map(([v, r]) => (
            <Button key={v} size="sm" variant={ator === v ? 'default' : 'ghost'} aria-pressed={ator === v} onClick={() => setAtor(v)}>{r}</Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      ) : registro.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Nada registrado ainda.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {registro.map((e, i) => {
            const Icone = ICONE_ACAO[e.acao] ?? Radar;
            return (
              <div key={`${e.quando}-${i}`} className="flex gap-3 p-3">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                  e.situacao === 'erro' ? 'bg-red-100 text-red-700'
                    : e.situacao === 'aviso' ? 'bg-amber-100 text-amber-700'
                    : e.ator === 'ludmilla' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                  <Icone size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{e.titulo}</span>
                    {e.projeto && (
                      <button className="text-xs text-primary hover:underline" onClick={() => e.project_id && navigate(`/project/${e.project_id}`)}>
                        {e.projeto}
                      </button>
                    )}
                  </div>
                  {e.detalhe && <p className="text-xs text-muted-foreground break-words">{e.detalhe}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground whitespace-nowrap">{quando(e.quando)}</div>
                  <div className="text-[11px] text-muted-foreground">{e.ator === 'ludmilla' ? 'Ludmilla' : e.quem || 'equipe'}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {registro.length >= (tudo ? 400 : 60) && !tudo && (
        <Button variant="outline" size="sm" onClick={() => setTudo(true)}>Ver mais</Button>
      )}
    </div>
  );
}
