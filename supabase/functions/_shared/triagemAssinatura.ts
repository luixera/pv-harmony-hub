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

  // o primeiro objeto JSON do texto (o modelo às vezes embrulha em ```json)
  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) {
    // Frase FIXA, sem eco da resposta: o worker loga o `motivo` e o manda ao
    // WhatsApp do gestor — prosa do modelo citando o documento vazaria o conteúdo.
    return { veredito: 'duvida', motivo: 'A triagem não devolveu um veredito legível.' };
  }
  let obj: { veredito?: unknown; motivo?: unknown };
  try {
    obj = JSON.parse(bruto.slice(inicio, fim + 1));
  } catch {
    return { veredito: 'duvida', motivo: 'A triagem não devolveu um veredito legível.' };
  }
  const v = String(obj.veredito ?? '').trim().toLowerCase() as Veredito;
  if (!VALIDOS.includes(v)) {
    return { veredito: 'duvida', motivo: 'A triagem não devolveu um veredito legível.' };
  }
  return { veredito: v, motivo: String(obj.motivo ?? '').slice(0, 500) };
}
