import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { criarFilaDeDecisoes, ESPERA_DO_DESFAZER_MS, type FilaDeDecisoes } from '@/lib/ludmillaFilaDeDecisoes';
import { limparOcultos, type ItemDaCaixa } from '@/lib/ludmillaCaixa';

/** Quanto a decisão espera antes de ir ao banco (a janela do "Desfazer"): vive em `ludmillaFilaDeDecisoes`, onde o vitest a protege. */
export { ESPERA_DO_DESFAZER_MS };

function semChave(o: ReadonlySet<string>, chave: string): ReadonlySet<string> {
  const n = new Set(o);
  n.delete(chave);
  return n;
}

/**
 * A fila em React. `ocultos` = o que a pessoa já decidiu e a lista não mostra
 * mais — fica oculto até a decisão chegar ao banco e o refetch trazer o item como
 * não pendente (`limparOcultos`). Sair da página grava na hora; fechar a aba com
 * decisão esperando faz o navegador perguntar.
 */
export function useFilaDeDecisoes(itens: ItemDaCaixa[]) {
  const [ocultos, setOcultos] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [emEspera, setEmEspera] = useState<string[]>([]);
  const filaRef = useRef<FilaDeDecisoes | null>(null);
  if (filaRef.current === null) {
    filaRef.current = criarFilaDeDecisoes({
      esperaMs: ESPERA_DO_DESFAZER_MS,
      aoMudar: setEmEspera,
      // o banco recusou (alguém decidiu antes, rede caiu): a linha volta; o hook
      // da mutação já mostrou o erro
      aoFalhar: chave => setOcultos(o => semChave(o, chave)),
    });
  }
  const fila = filaRef.current;

  useEffect(() => () => fila.descarregar(), [fila]);

  useEffect(() => {
    if (emEspera.length === 0) return;
    const segurar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [emEspera.length]);

  useEffect(() => {
    setOcultos(o => {
      if (o.size === 0) return o;
      const n = limparOcultos(o, itens);
      return n.size === o.size ? o : n;
    });
  }, [itens]);

  const decidir = useCallback((chave: string, texto: string, executar: () => Promise<unknown>) => {
    setOcultos(o => new Set(o).add(chave));
    fila.adiar({ chave, executar });
    toast(texto, {
      duration: ESPERA_DO_DESFAZER_MS,
      // no alto: embaixo ele cobriria os botões fixos do detalhe no celular
      position: 'top-center',
      // com o detalhe aberto (Radix) o body fica sem clique; o aviso precisa dele
      style: { pointerEvents: 'auto' },
      action: {
        label: 'Desfazer',
        onClick: () => {
          if (fila.desfazer(chave)) setOcultos(o => semChave(o, chave));
          else toast.info('Já foi gravado. Para voltar, mude a etapa no card do projeto.');
        },
      },
    });
  }, [fila]);

  return { ocultos, emEspera, decidir };
}
