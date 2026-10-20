import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useApagarRegraEmail, useRegrasEmail, useSalvarRegraEmail,
  type RegraEmail, type TipoDocumentoEmail,
} from '@/hooks/useLudmilla';
import { cn } from '@/lib/utils';

/**
 * AS REGRAS DE LEITURA — o que a Ludmilla procura na caixa desta concessionária.
 *
 * Uma linha = "e-mail com este trecho no assunto (e deste remetente, quando a
 * regra informa um) é um documento deste tipo". As regras moram no banco, nunca
 * no código, justamente para o usuário ajustar sozinho quando a concessionária
 * muda o assunto dos e-mails.
 *
 * Só `admin` grava (RLS); staff lê. Mudança de regra vale da próxima leitura em
 * diante — para os e-mails já lidos, a recuperação é "ler de novo" no histórico.
 */

export const ROTULO_TIPO: Record<TipoDocumentoEmail, string> = {
  parecer:             'parecer de acesso',
  carta_obras:         'carta de obras',
  nota:                'nota de serviço',
  outro:               'outro documento',
  // ENEL: o tipo da regra é só uma dica — o que o e-mail É sai do texto e do PDF
  carta_projeto:       'carta do projeto',
  resultado_vistoria:  'resultado da vistoria',
  troca_relogio:       'troca do relógio',
  resposta_automatica: 'resposta automática',
  devolucao:           'e-mail devolvido',
  comunicado:          'comunicado (ignorar)',
};

const TIPOS: TipoDocumentoEmail[] = [
  'parecer', 'carta_obras', 'nota', 'outro',
  'carta_projeto', 'resultado_vistoria', 'troca_relogio', 'resposta_automatica', 'devolucao', 'comunicado',
];

const SEM_DOCUMENTO: TipoDocumentoEmail[] = ['resposta_automatica', 'devolucao', 'comunicado'];
const LE_COM_IA: TipoDocumentoEmail[] = ['parecer', 'carta_projeto', 'resultado_vistoria', 'troca_relogio'];

/** Selo que também é botão: um clique inverte o campo da regra. */
function Chave({ ligado, rotuloLigado, rotuloDesligado, cor, onClick, disabled }: {
  ligado: boolean; rotuloLigado: string; rotuloDesligado: string;
  cor: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      title={disabled ? 'Só o admin muda as regras' : 'Clique para inverter'}
      className={cn('px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors',
        ligado ? cor : 'bg-muted text-muted-foreground',
        disabled ? 'cursor-default' : 'hover:ring-1 hover:ring-primary/40')}
    >
      {ligado ? rotuloLigado : rotuloDesligado}
    </button>
  );
}

export function RegrasEmail({ accountId, tenantId }: { accountId: string; tenantId: string }) {
  const { user } = useAuth();
  const podeEditar = user?.role === 'admin';
  const { data: regras = [], isLoading } = useRegrasEmail(accountId);
  const salvar = useSalvarRegraEmail();
  const apagar = useApagarRegraEmail();
  const [assunto, setAssunto] = useState('');
  const [remetente, setRemetente] = useState('');
  const [tipo, setTipo] = useState<TipoDocumentoEmail>('parecer');
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const base = { account_id: accountId, tenant_id: tenantId };

  // Assunto vazio é válido ("qualquer assunto deste remetente"), mas a regra precisa
  // de pelo menos um dos dois: sem assunto e sem remetente ela casaria com TUDO.
  const regraCompleta = assunto.trim() !== '' || remetente.trim() !== '';

  function adicionar() {
    if (!regraCompleta) return;
    salvar.mutate({
      ...base,
      assunto: assunto.trim(),
      remetente: remetente.trim() || null,
      tipo_documento: tipo,
      // os mesmos padrões que a migração semeou para a ENEL: resposta automática,
      // e-mail devolvido e comunicado não levam documento nenhum ao card
      anexar: !SEM_DOCUMENTO.includes(tipo),
      // o parecer (e, na ENEL, a carta, o resultado da vistoria e a troca do relógio)
      // precisa de IA: o assunto diz que chegou, só o conteúdo distingue aprovado de pendência
      ler_pdf: LE_COM_IA.includes(tipo),
      ativo: true,
      ordem: Math.max(0, ...regras.map(r => r.ordem)) + 1,
    });
    setAssunto(''); setRemetente('');
  }

  const inverter = (r: RegraEmail, campo: 'anexar' | 'ler_pdf' | 'ativo') =>
    salvar.mutate({ ...base, id: r.id, [campo]: !r[campo] });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-sm font-medium">O que ela procura na caixa</h4>
        <span className="text-xs text-muted-foreground">
          assunto e remetente que fazem um e-mail ser reconhecido — {podeEditar ? 'edite aqui' : 'só o admin edita'}
        </span>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Carregando as regras…
        </div>
      ) : regras.length === 0 ? (
        <p className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-md px-2 py-1.5">
          Nenhuma regra cadastrada. Sem pelo menos uma regra ativa a Ludmilla se recusa a ler a caixa —
          ela não saberia o que é documento e o que é ruído.
        </p>
      ) : (
        <div className="space-y-1.5">
          {regras.map(r => (
            <div key={r.id}
              className={cn('flex flex-wrap items-center gap-2 text-xs border rounded-md px-2 py-1.5',
                !r.ativo && 'opacity-60')}>
              {r.assunto.trim() === '' ? (
                <span className="font-medium italic text-muted-foreground">qualquer assunto</span>
              ) : (
                <span className="font-medium font-mono truncate max-w-[14rem]" title={r.assunto}>{r.assunto}</span>
              )}
              <span className="text-muted-foreground truncate max-w-[12rem]" title={r.remetente ?? undefined}>
                {r.remetente ?? 'qualquer remetente'}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 whitespace-nowrap">
                {ROTULO_TIPO[r.tipo_documento] ?? r.tipo_documento}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Chave ligado={r.anexar} rotuloLigado="anexa no card" rotuloDesligado="não anexa"
                  cor="bg-emerald-100 text-emerald-800" disabled={!podeEditar || salvar.isPending}
                  onClick={() => inverter(r, 'anexar')} />
                <Chave ligado={r.ler_pdf} rotuloLigado="lê o PDF com IA" rotuloDesligado="não lê o PDF"
                  cor="bg-blue-100 text-blue-800" disabled={!podeEditar || salvar.isPending}
                  onClick={() => inverter(r, 'ler_pdf')} />
                <Chave ligado={r.ativo} rotuloLigado="ativa" rotuloDesligado="desligada"
                  cor="bg-slate-200 text-slate-800" disabled={!podeEditar || salvar.isPending}
                  onClick={() => inverter(r, 'ativo')} />
                {podeEditar && (
                  confirmar === r.id ? (
                    <span className="flex items-center gap-1">
                      <Button size="sm" variant="destructive" className="h-6 px-2 text-[11px]"
                        disabled={apagar.isPending}
                        onClick={() => { apagar.mutate(r.id); setConfirmar(null); }}>
                        apagar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                        onClick={() => setConfirmar(null)}>
                        não
                      </Button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmar(r.id)}
                      aria-label={`Apagar a regra ${r.assunto.trim() || r.remetente?.trim() || 'sem assunto'}`} title="Apagar esta regra">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Input value={assunto} onChange={e => setAssunto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') adicionar(); }}
            placeholder="Assunto (ou vazio)" className="h-8 w-48 text-xs" />
          <Input value={remetente} onChange={e => setRemetente(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') adicionar(); }}
            placeholder="Remetente (opcional)" className="h-8 w-48 text-xs" />
          <Select value={tipo} onValueChange={v => setTipo(v as TipoDocumentoEmail)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS.map(t => <SelectItem key={t} value={t}>{ROTULO_TIPO[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1 h-8"
            onClick={adicionar} disabled={!regraCompleta || salvar.isPending}>
            {salvar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Adicionar
          </Button>
        </div>
      )}
    </div>
  );
}
