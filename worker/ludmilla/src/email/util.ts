/**
 * Utilitários puros do acompanhamento por e-mail — sem rede, sem banco.
 * Tudo o que é comparação ou conta vive aqui; o roteiro só orquestra.
 */

export interface RegraEmail {
  id: string;
  /** trecho do remetente; null = qualquer remetente */
  remetente: string | null;
  /** trecho do assunto que identifica o documento */
  assunto: string;
  tipo_documento: string;
  anexar: boolean;
  ler_pdf: boolean;
}

export type Veredito = 'favoravel' | 'pendencia' | 'inconclusivo';

export const semAcento = (s: string): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Só os dígitos, sem zeros à esquerda: o protocolo do sistema tem um zero a mais que a nota. */
export const chaveProtocolo = (s: string): string =>
  (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/** Protocolos com menos de 8 dígitos não casam: evita colar e-mail por número de rua ou CEP. */
export function casaProtocolo(a: string, b: string): boolean {
  const x = chaveProtocolo(a);
  return x.length >= 8 && x === chaveProtocolo(b);
}

/** Os números que o assunto traz, já como chave (só dígitos, sem zero à esquerda). */
const numerosDoAssunto = (assunto: string): string[] =>
  ((assunto ?? '').match(/\d[\d.\-/]{6,}/g) ?? []).map(chaveProtocolo);

/** Acha, entre os protocolos dos projetos, aquele que aparece no assunto. */
export function protocoloDoAssunto(assunto: string, candidatos: string[]): string | null {
  const numeros = numerosDoAssunto(assunto);
  return candidatos.find(c => numeros.some(n => casaProtocolo(c, n))) ?? null;
}

/**
 * TODOS os protocolos da lista que o assunto cita — não só o primeiro.
 *
 * Um e-mail que cita dois protocolos serve dois projetos, e o laço do run trata
 * um protocolo por vez: quem decide o que fazer com os ANEXOS precisa saber
 * quantos projetos aquele e-mail serve. Comparação por dígitos, zeros à esquerda
 * removidos e piso de 8 dígitos (`casaProtocolo`), e sem repetir: o mesmo
 * protocolo duas vezes no assunto, ou duas grafias do mesmo número na lista,
 * contam uma só.
 *
 * Conta só os NOSSOS (os da lista): número de pedido, CEP ou protocolo de
 * atendimento no assunto não pode transformar o caso normal em "vários".
 */
export function protocolosNoAssunto(assunto: string, candidatos: string[]): string[] {
  const numeros = numerosDoAssunto(assunto);
  const vistos = new Set<string>();
  const achados: string[] = [];
  for (const c of candidatos) {
    const chave = chaveProtocolo(c);
    if (vistos.has(chave)) continue;
    if (numeros.some(n => casaProtocolo(c, n))) { vistos.add(chave); achados.push(c); }
  }
  return achados;
}

/** Primeira regra ativa cujo assunto (e remetente, quando a regra tiver) casa. */
export function regraQueCasa(regras: RegraEmail[], assunto: string, remetente: string): RegraEmail | null {
  const a = semAcento(assunto).toUpperCase();
  const r = semAcento(remetente).toLowerCase();
  return regras.find(x =>
    a.includes(semAcento(x.assunto).toUpperCase())
    && (!x.remetente || r.includes(semAcento(x.remetente).toLowerCase()))
  ) ?? null;
}

const palavras = (s: string): string[] =>
  semAcento(s).toUpperCase().split(/[^A-Z0-9]+/).filter(p => p.length > 2);

/** Compara primeiro e último nome, sem acento e sem caixa. Exige pelo menos duas palavras do sistema. */
export function casaTitular(doSistema: string, doEmail: string): boolean {
  const a = palavras(doSistema);
  const b = palavras(doEmail);
  if (a.length < 2 || b.length === 0) return false;
  return b.includes(a[0]) && b.includes(a[a.length - 1]);
}

/**
 * Dá para comparar este nome com outro?
 *
 * `casaTitular` devolve `false` tanto para "é outra pessoa" quanto para "não
 * tenho nome suficiente para comparar", e quem chamava lia os dois como
 * divergência: projeto cujo titular é "Ivanildo" (ou razão social de uma
 * palavra) + PDF dizendo "IVANILDO PEREIRA DOS SANTOS" bloqueava o anexo e
 * logava alarme de pessoa errada. Nome que falta é FALTA DE DADO, nunca
 * divergência — e isso vale para os dois lados da comparação.
 */
export const comparavelTitular = (s: string | null | undefined): boolean =>
  palavras(s ?? '').length >= 2;

export const normalizarEndereco = (s: string): string =>
  semAcento(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Rua (palavras com mais de 3 letras) e número têm de aparecer no endereço do e-mail. */
export function casaEndereco(doSistema: string, doEmail: string): boolean {
  const a = normalizarEndereco(doSistema);
  const b = normalizarEndereco(doEmail);
  if (!a || !b) return false;
  const numeros = a.match(/\b\d+\b/g) ?? [];
  const numero = numeros.length > 0 ? numeros[numeros.length - 1] : undefined;
  const rua = a.replace(/\b\d+\b/g, '').split(' ').filter(p => p.length > 3);
  if (rua.length === 0) return false;
  const ruaSet = new Set(b.split(' '));
  return rua.every(p => ruaSet.has(p)) && (!numero || new RegExp(`\\b${numero}\\b`).test(b));
}

// ── Que anexo é documento, e qual deles é o parecer ─────────────────────────

/** O mínimo que se sabe de um anexo antes de olhar o conteúdo. */
export interface AnexoBruto { nome: string; mime: string }

const EXTENSOES_DE_IMAGEM = /\.(png|jpe?g|gif|bmp|webp|svg|tiff?)$/i;

/**
 * Imagem NÃO é documento da concessionária.
 *
 * Um "ENVIO DE PARECER" com assinatura HTML traz `image001.png`…`image004.png`,
 * e cada uma virava linha em `portal_anexos`, arquivo no storage, registro em
 * `documents` e **comentário no card do cliente**: o logo da EDP entrando como
 * documento do projeto, quatro vezes.
 *
 * A regra é por EXCLUSÃO e não por lista branca de propósito: nenhuma
 * concessionária entrega parecer como PNG, mas pode entregar formato que a
 * gente não previu — e perder isso em silêncio seria pior.
 *
 * Ser "não imagem" NÃO quer dizer que o arquivo sobe. Quem decide o que o storage
 * de fato recebe é `destinoNoBucket`, logo abaixo: dwg, zip e p7s passam por aqui
 * (não são imagem) mas o bucket `project-documents` não os aceita, então são
 * RECUSADOS ali — contados, com ressalva no motivo, sem virar falha.
 */
export const ehImagem = (a: AnexoBruto): boolean =>
  /^image\//i.test((a.mime ?? '').trim()) || EXTENSOES_DE_IMAGEM.test((a.nome ?? '').trim());

// ── O que o bucket aceita (E2) ───────────────────────────────────────────────

/**
 * O limite do bucket `project-documents`: `storage.buckets.file_size_limit`.
 * Lido do banco em 12/10/2026 — 10485760 bytes (10 MiB).
 *
 * Os dois valores desta seção espelham o BANCO e não se atualizam sozinhos:
 *   select allowed_mime_types, file_size_limit from storage.buckets
 *    where id = 'project-documents';
 * Mudou lá, muda aqui (e o teste de `LIMITE_BUCKET_BYTES` lembra).
 */
export const LIMITE_BUCKET_BYTES = 10_485_760;

/** `allowed_mime_types` do bucket, tal como está no banco. */
const MIMES_DO_BUCKET: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * Cliente de e-mail que declara `application/octet-stream` para um PDF é
 * comum, e o storage confere o mime DECLARADO no upload: sem isto o PDF era
 * recusado e a mensagem ficava em retentativa para sempre. A extensão resgata os
 * quatro tipos de documento (imagem não chega aqui: `ehImagem` a tirou antes).
 */
const MIME_DA_EXTENSAO: ReadonlyMap<string, string> = new Map([
  ['pdf', 'application/pdf'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
]);

export type DestinoNoBucket =
  /** `mime` é o que vai no upload — o declarado, ou o da extensão quando o declarado é genérico */
  | { aceito: true; mime: string }
  | { aceito: false; motivo: 'tipo' | 'tamanho' };

/**
 * O storage aceita este anexo? Tipo e tamanho, como o bucket confere.
 *
 * Antes o worker mandava tudo o que não era imagem, e o storage recusava o
 * resto: um `.p7s` (assinatura digital, comum em parecer) virava falha, a
 * mensagem ficava pendente, e a cada run a IA relia o mesmo PDF já lido —
 * até 5 leituras pagas — antes de a mensagem ser abandonada no teto. Arquivo que
 * o bucket não aceita é IGNORADO (e contado), nunca falhado.
 *
 * "tipo" vem antes de "tamanho": um p7s de 20 MB é um tipo errado.
 */
export function destinoNoBucket(a: AnexoBruto & { bytes: { length: number } }): DestinoNoBucket {
  const declarado = (a.mime ?? '').split(';')[0].trim().toLowerCase();
  const extensao = /\.([a-z0-9]+)$/i.exec((a.nome ?? '').trim())?.[1]?.toLowerCase();
  const mime = MIMES_DO_BUCKET.has(declarado) ? declarado : (extensao ? MIME_DA_EXTENSAO.get(extensao) : undefined);
  if (!mime) return { aceito: false, motivo: 'tipo' };
  if (a.bytes.length > LIMITE_BUCKET_BYTES) return { aceito: false, motivo: 'tamanho' };
  return { aceito: true, mime };
}

// ── De qual protocolo é o arquivo (E1) ───────────────────────────────────────

/** Os números que o NOME do arquivo traz, já como chave (só dígitos, sem zero à esquerda). */
const numerosDoNome = (nome: string): string[] => ((nome ?? '').match(/\d+/g) ?? []).map(chaveProtocolo);

/**
 * O nome do arquivo traz o número deste protocolo? A EDP nomeia o parecer como
 * `PARECER_45006441002.pdf`. Comparação como a do assunto: por dígitos, sem zero
 * à esquerda, piso de 8 dígitos — "450064410021" não é "45006441002".
 */
export const nomeCitaProtocolo = (nome: string, protocolo: string): boolean =>
  numerosDoNome(nome).some(n => casaProtocolo(protocolo, n));

/**
 * Num e-mail que cita VÁRIOS protocolos, separa o que é DESTE protocolo do resto.
 *
 * Só o nome do arquivo é sinal confiável de dono. É `meus` o arquivo que traz o
 * número deste protocolo e NENHUM outro dos citados — o que traz dois números é
 * ambíguo (um parecer conjunto, ou a EDP juntando notas) e não vai para
 * nenhum dos cards: anexar nos dois é entregar a um cliente o documento que
 * fala do outro. `outros` é todo o resto (de outro protocolo, sem número, ambíguo).
 */
export function separarPorProtocolo<T extends { nome: string }>(
  anexos: T[], protocolo: string, citados: string[],
): { meus: T[]; outros: T[] } {
  const alvo = chaveProtocolo(protocolo);
  const todos = [...new Map([...citados, protocolo].map(c => [chaveProtocolo(c), c] as const)).values()];
  const meus: T[] = [];
  const outros: T[] = [];
  for (const a of anexos) {
    const dele = todos.filter(c => nomeCitaProtocolo(a.nome, c));
    if (dele.length === 1 && chaveProtocolo(dele[0]) === alvo) meus.push(a);
    else outros.push(a);
  }
  return { meus, outros };
}

// ── Anexos de mesmo nome na mesma mensagem (E5) ──────────────────────────────

/**
 * A posição de cada anexo entre os de MESMO nome (1 = o primeiro).
 *
 * Calculada sobre a lista INTEIRA da mensagem, antes de qualquer filtro: o
 * índice tem de ser o mesmo em todo run, senão a retentativa não retoma a mesma
 * linha de `portal_anexos` e anexa de novo. Nome diferente em caixa é nome diferente.
 */
export function ocorrenciasPorNome(anexos: { nome: string }[]): number[] {
  const vistos = new Map<string, number>();
  return anexos.map(a => {
    const n = (vistos.get(a.nome) ?? 0) + 1;
    vistos.set(a.nome, n);
    return n;
  });
}

/** Pode ser o parecer: o mime diz pdf, ou o nome termina em .pdf. */
export const ehPdf = (a: AnexoBruto): boolean =>
  /pdf$/i.test((a.mime ?? '').trim()) || /\.pdf$/i.test((a.nome ?? '').trim());

/**
 * O PDF que a IA vai ler é o MAIOR do e-mail: o parecer tem várias páginas, e
 * anexo técnico de uma página é menor.
 *
 * Antes era "o primeiro da lista", e o titular dele decidia o destino de TODOS
 * os anexos — e-mail com parecer + anexo técnico na ordem "errada" dava veredito
 * do documento errado e bloqueio por titular pelo documento errado. Continua
 * sendo UM só: ler todos multiplicaria o gasto de IA sem ganho claro.
 *
 * "O maior" vale para o e-mail que serve UM projeto. Se o assunto cita vários
 * protocolos, quem chama passa só os arquivos DO protocolo (`separarPorProtocolo`):
 * o maior do e-mail inteiro seria o PDF de outro cliente.
 */
export function pdfDoParecer<T extends AnexoBruto & { bytes: { length: number } }>(anexos: T[]): T | null {
  let escolhido: T | null = null;
  for (const a of anexos) {
    // empate fica com o primeiro: a escolha tem de ser a mesma em todo run
    if (ehPdf(a) && (!escolhido || a.bytes.length > escolhido.bytes.length)) escolhido = a;
  }
  return escolhido;
}

/**
 * A chave do ANEXO na fila (`portal_anexos.id_arquivo`) — a mesma expressão que
 * a RPC `ludmilla_email_id_arquivo` monta no banco.
 *
 * Ela TEM de carregar o protocolo. Um e-mail que cita dois protocolos no
 * assunto serve dois projetos, e com a chave antiga (`mensagem#arquivo`) o
 * segundo colidia com o primeiro na UNIQUE `(account_id, id_arquivo)`:
 *  · se a primeira subida tinha dado certo, a RPC devolvia vazio e o worker
 *    logava "já estava resolvido no card" — resolvido no card do OUTRO cliente,
 *    e nenhum run futuro tentava;
 *  · se a primeira tinha falhado, a linha devolvida era a do projeto A, o
 *    arquivo subia no caminho de B e o comentário aparecia no card de A.
 *
 * Dois anexos de MESMO nome no mesmo e-mail (e projeto) gerariam a mesma chave:
 * o segundo viraria "já resolvido" e desapareceria. O primeiro mantém a chave de
 * sempre; do segundo em diante entra a ocorrência (`…#parecer.pdf#2`). O índice
 * vem de `ocorrenciasPorNome`, que conta na mensagem inteira para ser estável.
 *
 * Mudar uma ponta sem a outra faz a robô anexar de novo o que já anexou: as
 * duas pontas vêm desta expressão, e o teste de formato existe para travá-la.
 */
export const idArquivoDeEmail = (
  messageId: string, protocolo: string, nomeArquivo: string, ocorrencia = 1,
): string => `${messageId}#${protocolo}#${nomeArquivo}${ocorrencia > 1 ? `#${ocorrencia}` : ''}`;

/** Etapa recomendada para o card. Null = só avisa que o documento chegou. */
export function recomendacaoDoVeredito(tipo: string, v: Veredito | null): string | null {
  if (tipo !== 'parecer') return null;
  if (v === 'favoravel') return 'approved';
  if (v === 'pendencia') return 'pendencia';
  return null;
}
