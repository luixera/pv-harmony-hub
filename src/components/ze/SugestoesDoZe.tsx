import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Check, X, Loader2, Pencil, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useZeSugestoes, useAceitarSugestao, useRecusarSugestao,
  type ZeTarefaSugerida, type AjustesDaSugestao,
} from '@/hooks/useZe';
import { cn } from '@/lib/utils';

/**
 * CAIXA DE SUGESTÕES DO ZÉ.
 *
 * Decisão do usuário (set/2026): a lista oficial de tarefas é o registro da
 * operação e NÃO recebe palpite de robô. O que o Zé propõe por conta própria
 * para aqui, e só vira tarefa quando o gestor aceita — podendo ajustar título,
 * prazo e prioridade antes.
 *
 * O mesmo componente aparece na aba "Sugestões do Zé" (/tasks) e na tela dele
 * (/ze); aceitar aqui e responder "cria a 1" no WhatsApp resolvem a mesma
 * linha.
 */

const ORIGEM: Record<ZeTarefaSugerida['origem'], string> = {
  rotina: 'da rotina',
  conversa: 'da conversa',
  varredura: 'da varredura',
};

const dataBR = (d: string | null) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : null);

function Cartao({ s }: { s: ZeTarefaSugerida }) {
  const aceitar = useAceitarSugestao();
  const recusar = useRecusarSugestao();
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(s.titulo);
  const [vencimento, setVencimento] = useState(s.vencimento ?? '');

  const ocupado = aceitar.isPending || recusar.isPending;

  const confirmar = () => {
    const ajustes: AjustesDaSugestao = {};
    if (titulo.trim() && titulo !== s.titulo) ajustes.titulo = titulo.trim();
    if (vencimento && vencimento !== s.vencimento) ajustes.vencimento = vencimento;
    aceitar.mutate({ id: s.id, ajustes: Object.keys(ajustes).length ? ajustes : undefined });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <MessageCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1 space-y-1">
          {editando ? (
            <Input value={titulo} onChange={e => setTitulo(e.target.value)} className="h-8 text-sm" autoFocus />
          ) : (
            <p className="text-sm font-medium text-gray-900">{s.titulo}</p>
          )}

          {s.motivo && <p className="text-xs text-gray-500">Porque {s.motivo}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-gray-400">
            <span>sugestão {ORIGEM[s.origem]}</span>
            {s.projeto?.code && (
              <span className="rounded bg-white px-1.5 py-0.5 font-medium text-gray-600">{s.projeto.code}</span>
            )}
            {editando ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                <Input
                  type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
                  className="h-7 w-36 text-[11px]"
                />
              </span>
            ) : (
              dataBR(s.vencimento) && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" /> {dataBR(s.vencimento)}
                </span>
              )
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={confirmar} disabled={ocupado} className="bg-emerald-600 hover:bg-emerald-700">
          {aceitar.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {editando ? 'Criar com os ajustes' : 'Criar tarefa'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditando(v => !v)} disabled={ocupado}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> {editando ? 'Cancelar edição' : 'Ajustar'}
        </Button>
        <Button
          size="sm" variant="ghost" className="text-gray-500"
          onClick={() => recusar.mutate(s.id)} disabled={ocupado}
        >
          <X className="mr-1 h-3.5 w-3.5" /> Descartar
        </Button>
      </div>
    </motion.div>
  );
}

export function SugestoesDoZe({ className, vazio }: { className?: string; vazio?: string }) {
  const { data: sugestoes = [], isLoading } = useZeSugestoes();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  if (sugestoes.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        {vazio ?? 'O Zé não tem nada sugerindo agora.'}
      </p>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <p className="text-xs text-gray-400">
        Isto <strong>não</strong> está na sua lista de tarefas. Só entra lá se você criar.
      </p>
      {sugestoes.map(s => <Cartao key={s.id} s={s} />)}
    </div>
  );
}
