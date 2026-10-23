/**
 * A FILA DE DECISÕES COM "DESFAZER" — sem React.
 *
 * Decisão do plano (22/10/2026): "Desfazer" não desfaz nada no banco — a decisão
 * ESPERA alguns segundos antes de ir. Assim a mesma RPC de hoje
 * (`ludmilla_aplicar_update`, `ludmilla_ignorar_update`, `ludmilla_afazer_feito`)
 * continua sendo a única coisa que grava, e desfazer é só não mandar.
 */

/**
 * Quanto a decisão espera antes de ir ao banco (é a janela do "Desfazer").
 * Decisão do usuário (22/10/2026): 8 s. Mora aqui, e não no hook, para o vitest
 * (ambiente `node`, sem DOM) conseguir proteger o número.
 */
export const ESPERA_DO_DESFAZER_MS = 8_000;

export interface DecisaoAdiada {
  chave: string;
  executar: () => Promise<unknown>;
}

export interface OpcoesDaFila {
  esperaMs: number;
  /** o conjunto do que está esperando mudou (a tela liga/desliga o aviso de saída) */
  aoMudar: (emEspera: string[]) => void;
  /** a gravação falhou: a tela devolve o item à lista */
  aoFalhar: (chave: string, erro: unknown) => void;
  relogio?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
}

export interface FilaDeDecisoes {
  adiar(d: DecisaoAdiada): void;
  /** true = cancelou a tempo; false = já tinha ido (ou nunca esteve na fila) */
  desfazer(chave: string): boolean;
  /** grava agora tudo o que está esperando (saída da página) */
  descarregar(): void;
  emEspera(): string[];
}

export function criarFilaDeDecisoes(op: OpcoesDaFila): FilaDeDecisoes {
  const relogio = op.relogio ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const espera = new Map<string, { timer: unknown; executar: () => Promise<unknown> }>();
  const avisar = () => op.aoMudar([...espera.keys()]);

  const disparar = (chave: string) => {
    const d = espera.get(chave);
    if (!d) return;
    relogio.clearTimeout(d.timer);
    espera.delete(chave);
    avisar();
    Promise.resolve()
      .then(() => d.executar())
      .catch(e => op.aoFalhar(chave, e));
  };

  return {
    adiar(d) {
      const velha = espera.get(d.chave);
      if (velha) relogio.clearTimeout(velha.timer);
      const timer = relogio.setTimeout(() => disparar(d.chave), op.esperaMs);
      espera.set(d.chave, { timer, executar: d.executar });
      avisar();
    },
    desfazer(chave) {
      const d = espera.get(chave);
      if (!d) return false;
      relogio.clearTimeout(d.timer);
      espera.delete(chave);
      avisar();
      return true;
    },
    descarregar() {
      for (const chave of [...espera.keys()]) disparar(chave);
    },
    emEspera: () => [...espera.keys()],
  };
}
