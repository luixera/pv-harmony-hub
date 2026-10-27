/**
 * O TEXTO QUE A PESSOA EDITOU NA COBRANÇA, guardado por linha da caixa (`item.chave`) enquanto a
 * página está aberta. Sem isto, decidir tira a linha da lista, o detalhe é desmontado, e se a
 * linha volta (Desfazer, ou o banco recusou) o editor nasceria de novo com o modelo e a edição se
 * perderia. Só na memória da página: nada vai a banco, a `localStorage` nem a log (o texto cita
 * titular e UC), e some quando a página recarrega. Quem decide a vida da cobrança é o banco.
 */
const guardados = new Map<string, string>();

/** O que ficou no editor desta linha, ou null (abrir com o modelo). Texto apagado de propósito volta vazio. */
export function rascunhoGuardado(chave: string): string | null {
  return guardados.get(chave) ?? null;
}

/** A cada tecla: o texto como está na tela, sem recortar nem trocar nada. */
export function guardarRascunho(chave: string, texto: string): void {
  guardados.set(chave, texto);
}

/** Só para os testes. */
export function limparRascunhos(): void {
  guardados.clear();
}
