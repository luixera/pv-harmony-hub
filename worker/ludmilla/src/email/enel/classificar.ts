// worker/ludmilla/src/email/enel/classificar.ts
import { semAcento } from '../util.js';

/**
 * O que o CORPO de um e-mail da ENEL diz — por texto, sem IA. As frases vêm de
 * e-mails reais (spec §8):
 *  · tecnico.*: "a vistoria do sistema de microgeração fotovoltaica está APROVADA"
 *  · canalgd:   "Nota de serviço criada … para a troca do medidor bidirecional,
 *               com o prazo de execução de até N dias úteis"
 *  · canalgd:   "a tentativa de troca do medidor no dia … não foi executada pelo
 *               seguinte motivo: …" (ou "… não sendo executada …", ou, no
 *               reenvio da nota, "Motivo da rejeição: …")
 * Só vale a parte NOVA da mensagem: a citação traz o histórico (inclusive o
 * nosso pedido, "a NT … foi aprovada na etapa de vistoria").
 *
 * O texto chega ACHATADO (caixa.ts troca todo \s+ por um espaço): nada aqui pode
 * depender de quebra de linha, e nada pode ser quadrático (uma única mensagem
 * malformada, com 50 mil hífens, travava o robô por 10 s). Pode chegar também com
 * entidades HTML (`&ccedil;`, e até `&amp;ccedil;`, de codificação dupla).
 *
 * A direção é a do erro caro: dizer "aprovada" de uma vistoria que não foi
 * aprovada faz o sino mandar pedir a troca do relógio. Na dúvida devolve null, e
 * a robô só anota.
 */

export type Classificacao =
  | { tipo: 'resultado_vistoria'; aprovada: boolean }
  | { tipo: 'troca_relogio'; estado: 'agendada'; prazoDias: number | null }
  | { tipo: 'troca_relogio'; estado: 'nao_executada'; motivo: string | null }
  | null;

// ── Entidades HTML ────────────────────────────────────────────────────────────
const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ',
  aacute: 'á', acirc: 'â', atilde: 'ã', agrave: 'à', eacute: 'é', ecirc: 'ê', iacute: 'í',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', ccedil: 'ç',
  Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Agrave: 'À', Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Ccedil: 'Ç',
  // o "nº" (&ordm; aparece 64× no corpus), o travessão (&ndash; 20×) e as parentes
  ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', hellip: '…', rarr: '→',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', apos: "'", laquo: '«', raquo: '»',
};

/** `&ccedil;`, `&#231;`, `&#xE7;`. Entidade desconhecida (ou número impossível) fica como está. */
const ENTIDADE_HTML = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g;

function umaPassada(s: string): string {
  return s.replace(ENTIDADE_HTML, (todo, dec: string | undefined, hex: string | undefined, nome: string | undefined) => {
    if (nome !== undefined) return ENTIDADES[nome] ?? todo;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
    if (cp < 1 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return todo;
    return String.fromCodePoint(cp);
  });
}

/**
 * Até 2 passadas: a ENEL (ou o reenvio) deixa vir `rejei&amp;ccedil;&amp;atilde;o`,
 * codificado duas vezes. Termina ACHATANDO de novo: `&#10;` e `&#xA;` viram \n, e
 * um \n furava a janela `[^\n]` do "Em … escreveu:" (a citação não era cortada e
 * o histórico virava resultado). O texto fica como chega do caixa.ts.
 */
function decodificarEntidades(s: string): string {
  let r = s;
  if (s.includes('&')) for (let i = 0; i < 2; i++) r = umaPassada(r);
  return r.replace(/\s+/g, ' ');
}

// ── A citação ─────────────────────────────────────────────────────────────────
/**
 * Onde começa uma citação. Todas funcionam em texto de UMA linha só (sem `^` e
 * sem a flag `m`) e são lineares: um `(?<!-)` faz uma sequência de hífens ser
 * tentada UMA vez (sem ele, cada hífen da sequência recomeçava a tentativa).
 *  · "-----Mensagem original-----", "-----Original Message-----" e a mensagem
 *    encaminhada ("---------- Forwarded message ---------", "… Mensagem encaminhada …")
 *  · "Em qua., 10 de set. de 2026 às 10:00, Fulano <x@y> escreveu:" (e "No dia …
 *    escreveu:", "On … wrote:") — a janela é temperada: o início é o ÚLTIMO
 *    "Em/No dia/On" antes do "escreveu:", então um "em" da parte nova não vira o
 *    começo da citação
 *  · cabeçalho do Outlook: "De: … Enviado(a) (em):" e "From: … Sent:", com os dois
 *    rótulos a no máximo 200 caracteres um do outro
 * Não há marca para o ">" de resposta: no texto achatado ele é indistinguível de
 * "Prazo > 5 dias" ou "Menu > Notas", e cortar aí perdia texto novo (e a falha).
 */
const MARCAS_DE_CITACAO = [
  /(?<!-)-{3,}\s*(?:Mensagem original|Original Message|Forwarded message|Mensagem encaminhada)/i,
  /\b(?:Em|No dia|On) (?:(?!\b(?:Em|No dia|On) )[^\n]){0,160}?(?:escreveu|wrote):/i,
  /\bDe:\s(?:(?!\bDe:\s)[\s\S]){0,200}?\bEnviad[oa](?:\(a\))?(?:\s+em)?\s*:/,
  /\bFrom:\s(?:(?!\bFrom:\s)[\s\S]){0,200}?\bSent:/,
];

/** Corta no começo da primeira citação. */
export function semCitacao(corpo: string): string {
  let fim = corpo.length;
  for (const re of MARCAS_DE_CITACAO) {
    const m = re.exec(corpo);
    if (m && m.index < fim) fim = m.index;
  }
  return corpo.slice(0, fim);
}

const normalizar = (s: string): string => semAcento(s).toLowerCase().replace(/\s+/g, ' ');

/**
 * Sem acento, minúsculo e com os espaços colapsados — mais, para cada posição do
 * texto normalizado, onde ela começa no ORIGINAL. Serve para devolver o motivo
 * da falha com as maiúsculas e os acentos de quem escreveu.
 */
function normalizarComMapa(s: string): { t: string; origem: number[] } {
  let t = '';
  const origem: number[] = [];
  let pos = 0;
  let noEspaco = false;
  for (const ch of s) {
    const aqui = pos;
    pos += ch.length;
    if (/\s/.test(ch)) {
      if (!noEspaco) { t += ' '; origem.push(aqui); }
      noEspaco = true;
      continue;
    }
    noEspaco = false;
    const n = semAcento(ch).toLowerCase();
    for (let k = 0; k < n.length; k++) origem.push(aqui);
    t += n;
  }
  origem.push(s.length); // o fim do texto também é uma posição
  return { t, origem };
}

// ── A troca do relógio que FALHOU ─────────────────────────────────────────────
// Redações reais: "não foi executada", "não sendo executada" e, no reenvio da nota
// de serviço, "Motivo da rejeição". Mais as que ainda não apareceram: "não foi
// realizada", "não pôde/pode ser executada", "não foi possível executar/realizar",
// "não concluída". A resposta de falha também traz o "nota de serviço … troca do
// medidor" do reenvio, por isso a falha vem antes. "Reenviamos" NÃO é marca de
// falha: há reenvio sem falha.
const FALHA_DA_TROCA = new RegExp([
  String.raw`\bnao (?:foi|sendo) (?:executad|realizad)[ao]\b`,
  String.raw`\bnao pode ser executad[ao]\b`,
  String.raw`\bnao foi possivel (?:executar|realizar)\b`,
  String.raw`\bnao concluid[ao]\b`,
  String.raw`\bmotivo da rejeicao\b`,
].join('|'));
// "não foi executada" sozinho pode ser de outra coisa (uma visita, uma vistoria).
const FALA_DA_TROCA = /\b(?:troca|medidor|nota de servico|substituicao|relogio)\b/;

const INICIO_DO_MOTIVO = /(?:pelo seguinte motivo|motivo da rejeicao)\s*:?\s*/;
// O motivo termina onde a frase termina (ponto que não é de data), na data que o
// segue ("… Execução 21.08.2026", "… Medição em 14.05.2026") ou onde a frase
// seguinte começa.
const FIM_DO_MOTIVO = /\.(?!\d)|…|\b(?:em |no dia |na data de )?\d{1,2}[./]\d{1,2}\b|\b(?:reenviamos|realizamos|protocolo)\b|nota de servi/;
const MAX_MOTIVO = 80;

function extrairMotivo(t: string, origem: number[], original: string): string | null {
  const inicio = INICIO_DO_MOTIVO.exec(t);
  if (!inicio) return null;
  const de = inicio.index + inicio[0].length;
  const janela = t.slice(de, de + MAX_MOTIVO);
  const fim = FIM_DO_MOTIVO.exec(janela);
  let ate = fim ? fim.index : janela.length;
  if (!fim && de + MAX_MOTIVO < t.length) {
    // estourou o limite sem a frase acabar: não corta a palavra ao meio
    const espaco = janela.lastIndexOf(' ');
    if (espaco > 0) ate = espaco;
  }
  const motivo = original.slice(origem[de], origem[de + ate]).trim().replace(/[\s,;:–-]+$/, '');
  return motivo.length >= 3 ? motivo : null;
}

// ── O resultado da vistoria ───────────────────────────────────────────────────
// O verbo tem de ser da VISTORIA ("quem foi aprovado"). Na dúvida é null.
//  · Entre "vistoria" e "está/foi aprovada" não pode haver: outra "vistoria" (vale a
//    mais perto), negação, "se", outro verbo ("foi registrada e o projeto foi
//    aprovado"), conjunção que abre outra oração, ponto — nem um separador seguido
//    de outra palavra ([,:;?!()|/–—&] ou " - "): "Em relação à vistoria, o projeto
//    foi aprovado", "Vistoria (o projeto está aprovado)". A vírgula DIRETA ("…do
//    endereço acima, foi aprovada") continua valendo.
//  · O núcleo do sujeito não pode ser outra coisa: "solicitação/pedido/taxa … de
//    vistoria foi aprovada" é do pedido, não da vistoria. ("vídeo" fica fora da
//    lista: "o vídeo foi aprovado" é a vistoria virtual.)
//  · Não pode ser pergunta ("a vistoria foi aprovada?").
//  · Na frase de ANTES não pode haver negação, "ainda", "sem", "impossível" nem "se"
//    ("não foi possível confirmar que…", "para acompanhar se…"). A frase quebra em
//    [.;!?] seguido de espaço — "21.08.2026" e "Sr." não quebram.
//  · aprovada: anulada por qualquer "foi/está reprovada" ou "não foi aprovada" no
//    texto (o erro caro). reprovada: só anulada por um "aprovada" SOBRE A VISTORIA
//    (ou um "Foi aprovada." solto, sem sujeito); "o projeto foi aprovado. A vistoria
//    foi reprovada." é reprovada de verdade.
const NEGACOES = 'nao|nem|nunca|jamais|nenhum|nenhuma|ninguem|nada|tampouco';
const PALAVRAS_QUE_QUEBRAM = `vistoria|ainda|sem|se|${NEGACOES}|foi|esta|estao|sera|serao|e|ou|mas|porem|que`;
const CAMINHO_ATE_O_VERBO = String.raw`((?:(?!\b(?:${PALAVRAS_QUE_QUEBRAM})\b)[^.]){0,160}?)`;
const VISTORIA_COM_RESULTADO = new RegExp(
  String.raw`\bvistoria\b${CAMINHO_ATE_O_VERBO}\b(?:esta|foi)\s+(aprovad[ao]|reprovad[ao])\b`,
);
const OUTRO_SUJEITO_NO_CAMINHO = /[,:;?!()|\/\u2013\u2014&]\s*\S|\s-\s*\S/;
const NUCLEO_QUE_NAO_E_A_VISTORIA = /\b(?:solicitacao|pedido|agendamento|reagendamento|requerimento|abertura|marcacao|taxa|data|prazo|protocolo|nota|ordem|cadastro|documentacao|projeto|relatorio|laudo|formulario|ficha|termo|orcamento)\s+(?:de|da|do|para|pra)\s+(?:a\s+|sua\s+|essa\s+)?$/;
const NEGA_OU_CONDICIONA = new RegExp(String.raw`\b(?:${NEGACOES}|ainda|sem|impossivel|se)\b`);
// Fim de frase: ponto/;/!/? seguido de espaço (ou do fim). "21.08.2026" não quebra, e o
// ponto de "Sr.", "Sra.", "Dr.", "Dra.", "art.", "n." e "nº." também não.
const FIM_DE_FRASE = /(?:(?<!\b(?:sr|sra|dr|dra|art|n|nº|n°))\.|[;!?])(?=\s|$)/g;
const JANELA_DA_FRASE = 300;
const AFIRMA_REPROVADA = /\b(?:esta|foi)\s+reprovad[ao]\b/;
const AFIRMACAO_NEGADA = new RegExp(String.raw`\b(?:${NEGACOES})\s+(?:foi|esta)\s+aprovad[ao]\b`);
const APROVADA_DA_VISTORIA = new RegExp(
  String.raw`\bvistoria\b${CAMINHO_ATE_O_VERBO}\b(?:esta|foi)\s+aprovad[ao]\b`, 'g',
);
const APROVADA_SEM_SUJEITO = /(?:^|[.!?;])\s*(?:esta|foi)\s+aprovad[ao]\b/;

/** A frase em que "vistoria" (em `ate`) aparece, até a janela de 300 caracteres. */
function fraseAntes(t: string, ate: number): string {
  const antes = t.slice(Math.max(0, ate - JANELA_DA_FRASE), ate);
  let inicio = 0;
  for (const m of antes.matchAll(FIM_DE_FRASE)) inicio = (m.index ?? 0) + 1;
  return antes.slice(inicio);
}

/** Há, no texto, um "aprovada" SOBRE A VISTORIA (ou um "Foi aprovada." solto)? */
function afirmaAprovadaDaVistoria(t: string): boolean {
  for (const m of t.matchAll(APROVADA_DA_VISTORIA)) if (!OUTRO_SUJEITO_NO_CAMINHO.test(m[1])) return true;
  return APROVADA_SEM_SUJEITO.test(t);
}

function resultadoDaVistoria(t: string): Classificacao {
  const v = VISTORIA_COM_RESULTADO.exec(t);
  if (!v) return null;
  if (OUTRO_SUJEITO_NO_CAMINHO.test(v[1])) return null;
  if (NUCLEO_QUE_NAO_E_A_VISTORIA.test(t.slice(Math.max(0, v.index - 40), v.index))) return null;
  const depois = v.index + v[0].length;
  if (/^\s*\?/.test(t.slice(depois, depois + 4))) return null; // pergunta
  if (NEGA_OU_CONDICIONA.test(fraseAntes(t, v.index))) return null;
  const aprovada = v[2].startsWith('aprovad');
  if (aprovada) {
    if (AFIRMA_REPROVADA.test(t) || AFIRMACAO_NEGADA.test(t)) return null;
  } else if (afirmaAprovadaDaVistoria(t)) return null;
  return { tipo: 'resultado_vistoria', aprovada };
}

export function classificarCorpo(corpo: string | null | undefined): Classificacao {
  const util = semCitacao(decodificarEntidades(corpo ?? ''));
  const { t, origem } = normalizarComMapa(util);
  if (!t.trim()) return null;

  // A falha vem antes: a resposta de falha também fala em "nota de serviço".
  if (FALA_DA_TROCA.test(t) && FALHA_DA_TROCA.test(t)) {
    return { tipo: 'troca_relogio', estado: 'nao_executada', motivo: extrairMotivo(t, origem, util) };
  }
  if (/nota de servico[^.]{0,160}troca do medidor/.test(t)) {
    const m = /prazo (?:de|para) execucao (?:e )?de ate (\d+) dias/.exec(t);
    return { tipo: 'troca_relogio', estado: 'agendada', prazoDias: m ? Number(m[1]) : null };
  }
  return resultadoDaVistoria(t);
}

/**
 * O resultado da vistoria que a ENEL põe no ASSUNTO dos avisos do
 * atendimento.edsp: "Comunicado técnico sobre a nota: <NT> - Vistoria aprovada".
 * Padrão estrito, do começo ao fim do assunto (o observado em 24 de 24 e-mails):
 * só casa o assunto INTEIRO. Assunto da própria equipe ("VISTORIA - <NOME> -
 * NT …", "RE: VISTORIA …") não casa; "RE: Comunicado …" e "… aprovada com
 * ressalvas" também não — a robô só anota.
 */
export function classificarAssunto(assunto: string | null | undefined): Classificacao {
  const t = normalizar(assunto ?? '').trim();
  const m = /^comunicado tecnico sobre a nota:\s*\d+\s*-\s*vistoria\s+(aprovad[ao]|reprovad[ao])\s*$/.exec(t);
  return m ? { tipo: 'resultado_vistoria', aprovada: m[1].startsWith('aprovad') } : null;
}
