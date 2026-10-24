/**
 * Utilitários puros do roteiro de criação na CPFL — sem navegador, sem banco,
 * cobertos por teste. Tudo o que é conta ou parse vive aqui; o roteiro só
 * orquestra.
 */

/** Número com ponto decimal e sem zeros à direita (0.62, 2.25, 8). */
export const numero = (n: number, casas = 3): string => Number(n.toFixed(casas)).toString();

/** Hoje + N dias em AAAA-MM-DD (o input type=date do Drupal só aceita ISO). */
export function dataMais(dias: number, hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Fases → value do select "Número de Fases da UC" (mapa de 17/09/2026:
 * 2746 Monofásico · 2751 Bifásico · 2756 Trifásico) e texto da "Conexão do
 * Inversor" (cujo value é o próprio texto).
 */
export function valorFases(numFases: number | null | undefined, phaseType: string | null | undefined): { select: string; texto: string } {
  const n = numFases ?? (/tri/i.test(phaseType ?? '') ? 3 : /mono/i.test(phaseType ?? '') ? 1 : /bi/i.test(phaseType ?? '') ? 2 : null);
  if (n === 1) return { select: '2746', texto: 'Monofásico' };
  if (n === 3) return { select: '2756', texto: 'Trifásico' };
  return { select: '2751', texto: 'Bifásico' };
}

/** 'sim' | 'nao' → regex do rótulo do radio (o rótulo inteiro é a palavra). */
export const simNao = (v: string | undefined): RegExp => (/^s/i.test(v ?? '') ? /^Sim\s*$/i : /^N[aã]o\s*$/i);

/** Chaves cujo valor no FormData está vazio, nulo ou "0" — o que o servidor recusa como obrigatório. */
export function camposFaltando(fd: Record<string, string | null | undefined>, chaves: string[]): string[] {
  return chaves.filter(k => {
    const v = (fd[k] ?? '').toString().trim();
    return v === '' || Number(v) === 0;
  });
}

/** Número do projeto na URL depois do Salvar: /node/<id>/edit. */
export function extrairNodeId(url: string): string | null {
  const m = /\/node\/(\d+)\/edit/.exec(url);
  return m ? m[1] : null;
}

/**
 * Lê o HTML devolvido pelo POST do Avançar e devolve os campos que o Drupal
 * marcou como inválidos (aria-invalid / is-invalid / error) e as mensagens
 * em vermelho (invalid-feedback, messages--error, form-item--error-message).
 */
export function errosDoHtml(html: string): { campos: string[]; mensagens: string[] } {
  const campos = new Set<string>();
  const reTag = /<(input|select|textarea)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = reTag.exec(html))) {
    const tag = m[0];
    const invalido = /aria-invalid="true"/i.test(tag) || /class="[^"]*\b(is-invalid|error)\b[^"]*"/i.test(tag);
    if (!invalido) continue;
    const name = /\bname="([^"]+)"/i.exec(tag)?.[1] ?? /\bid="([^"]+)"/i.exec(tag)?.[1];
    if (name) campos.add(name);
  }
  const mensagens = new Set<string>();
  const reMsg = /<div[^>]*class="[^"]*\b(invalid-feedback|messages--error|form-item--error-message|alert-danger)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  while ((m = reMsg.exec(html))) {
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (texto) mensagens.add(texto.slice(0, 200));
  }
  return { campos: [...campos], mensagens: [...mensagens] };
}

/** CPF (11 dígitos) = Pessoa Física; CNPJ (14) = Pessoa Jurídica. */
export const pessoaFisica = (doc: string): boolean => doc.replace(/\D/g, '').length === 11;

/** Área ocupada pelos arranjos: módulos × m² por módulo, arredondado. */
export const areaArranjos = (modulos: number, m2PorModulo: number): string => String(Math.round(modulos * m2PorModulo));

// ── beneficiárias (autoconsumo remoto, 22/10/2026) ───────────────────────────

/** UC só com dígitos — como o portal da CPFL mostra na linha da beneficiária. */
export const normalizarUc = (texto: string | null | undefined): string => (texto ?? '').replace(/\D/g, '');

const arred4 = (n: number): number => Math.round(n * 10000) / 10000;

/** O que fica com a geradora: 100 − soma das beneficiárias (4 casas; nunca negativo). */
export function restoGeradora(percentuais: number[]): number {
  const soma = arred4(percentuais.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0));
  return arred4(Math.max(0, 100 - soma));
}

/** Percentual como o campo do portal espera: vírgula, 4 casas ("30,0000"). */
export const percentualPortal = (n: number): string => arred4(n).toFixed(4).replace('.', ',');

/**
 * Lê o que o portal mostra em "Percentual da sua microgeradora" ("0,0000%",
 * "100,00%", " 20,0000 % "). Devolve null se não houver número.
 */
export function lerPercentualPortal(texto: string | null | undefined): number | null {
  const m = (texto ?? '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace('.', '').replace(',', '.'));
  // "1.234,5" não existe aqui (percentual ≤ 100): o único separador é o decimal
  const n2 = Number(m[0].replace(',', '.'));
  return Number.isFinite(n2) ? arred4(n2) : Number.isFinite(n) ? arred4(n) : null;
}

/** Dois percentuais do portal são "iguais" dentro do arredondamento de 4 casas. */
export const percentuaisBatem = (a: number, b: number): boolean => Math.abs(arred4(a) - arred4(b)) < 0.00005;
