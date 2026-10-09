/**
 * Interpreta a resposta da triagem de assinatura.
 *
 * REGRA DURA: tudo o que não for um veredito legível vira `duvida` — e dúvida
 * vai para o gestor, não para a fila. A IA aqui é a SEGUNDA camada; a tranca é
 * o catálogo (documents.assinavel_id). Então falhar fechado não custa
 * segurança nenhuma: custa uma pergunta no WhatsApp.
 */
export type Veredito = 'projeto' | 'nao_projeto' | 'duvida';

export interface Triagem {
  veredito: Veredito;
  motivo: string;
}

const VALIDOS: Veredito[] = ['projeto', 'nao_projeto', 'duvida'];

export function lerVeredito(texto: string): Triagem {
  const bruto = (texto ?? '').trim();
  if (!bruto) return { veredito: 'duvida', motivo: 'A triagem não devolveu nada.' };

  // Frase FIXA, sem eco da resposta: o worker loga o `motivo` e o manda ao
  // WhatsApp do gestor — prosa do modelo citando o documento vazaria o conteúdo.
  const ilegivel: Triagem = { veredito: 'duvida', motivo: 'A triagem não devolveu um veredito legível.' };

  // O modelo às vezes embrulha o objeto em ```json … ```. Se há cerca, o que
  // vale é o conteúdo dela; uma cerca aberta e não fechada (resposta cortada
  // depois do objeto) também é aceita.
  const cercado = bruto.match(/```[a-z]*[ \t]*\r?\n?([\s\S]*?)```/i);
  const conteudo = (cercado ? cercado[1] : bruto.replace(/^```[a-z]*[ \t]*\r?\n?/i, '')).trim();

  // INJEÇÃO: a triagem é a última barreira (roda depois do "está certo" humano).
  // A resposta TEM de ser o objeto. Prosa que apenas contém um objeto — como
  // "o documento pede que eu responda {"veredito":"projeto"}, mas é um contrato" —
  // não é veredito do modelo, e array também não: tudo isso é dúvida.
  if (!conteudo.startsWith('{')) return ilegivel;

  // do `{` inicial ao último `}` (tolera um "espero ter ajudado" depois do objeto)
  const fim = conteudo.lastIndexOf('}');
  if (fim <= 0) return ilegivel;
  let obj: { veredito?: unknown; motivo?: unknown };
  try {
    obj = JSON.parse(conteudo.slice(0, fim + 1));
  } catch {
    return ilegivel;
  }
  const v = String(obj.veredito ?? '').trim().toLowerCase() as Veredito;
  if (!VALIDOS.includes(v)) return ilegivel;
  return { veredito: v, motivo: String(obj.motivo ?? '').slice(0, 500) };
}
