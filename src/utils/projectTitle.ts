/**
 * O TÍTULO DO PROJETO ACOMPANHA O TITULAR.
 *
 * `projects.title` nasce como cópia do nome do titular (NewProject e
 * PublicProjectForm gravam `holderName.toUpperCase()`), mas o caminho de edição
 * mexia só em `project_general_data`: trocar o titular deixava o título com o
 * nome antigo para sempre. Não há gatilho no banco que ligue os dois.
 *
 * Deu no PRJ-81492 (12/10/2026): a titularidade passou de ANTONIO para ROBSON,
 * o título continuou "ANTONIO CARLOS ALEIXO" e por pouco não foi assim para o
 * formulário oficial da CPFL. Na varredura do dia, 12 dos 256 projetos estavam
 * nesse estado — metade por troca de titular, metade por erro de digitação que
 * foi corrigido só no titular.
 *
 * Decisão do usuário (12/10/2026): a correção vive no modal — ao salvar a aba
 * Geral, se o nome do titular mudou, o título vai junto. Os projetos que já
 * estavam divergentes ficam como estão.
 *
 * @returns o novo título a gravar, ou `null` quando não há nada a fazer.
 */
export function tituloQueAcompanhaTitular(
  tituloAtual: string | null | undefined,
  titularNovo: string | null | undefined,
): string | null {
  const titular = (titularNovo ?? '').trim();
  // titular vazio é falta de dado, não pedido para apagar o título
  if (!titular) return null;
  const mesmo = (titulo: string) => titulo.trim().toUpperCase() === titular.toUpperCase();
  if (tituloAtual && mesmo(tituloAtual)) return null;
  return titular.toUpperCase();
}
