// worker/ludmilla/src/email/enel/identificar.ts
import { comparavelTitular, semAcento } from '../util.js';

/**
 * De qual projeto é este e-mail da ENEL?
 *
 * PRINCÍPIO (spec §6.1): a robô procura os NOSSOS números dentro do e-mail —
 * nunca trata um número qualquer do e-mail como protocolo. As respostas da ENEL
 * trazem NT (9 dígitos), instalação (10), nota de serviço (12), protocolo de
 * contato (10) e número SF; o protocolo de contato tem o MESMO tamanho da UC.
 * Só casa o número que for exatamente o de um projeto nosso, como número inteiro:
 * protocolo/NT com 9+ dígitos; UC com 7+ (sem os zeros à esquerda).
 *
 * Puro: sem banco, sem rede.
 */

export interface ProjetoEnel {
  project_id: string;
  company_id: string;
  codigo: string;
  protocolo: string | null;
  uc: string | null;
  titular: string | null;
  status: string;
  /** false = concluído/arquivado: o número RECONHECE o e-mail, mas nada vai para o card */
  ativo: boolean;
}

export type Sinal = 'protocolo' | 'uc' | 'titular';

export type Identificacao =
  | { tipo: 'achado'; projeto: ProjetoEnel; por: Sinal }
  | { tipo: 'inativo'; projeto: ProjetoEnel; por: Sinal }
  | { tipo: 'conflito'; motivo: string; codigos: string[] }
  | { tipo: 'nenhum' };

/** NT e protocolo: 9 dígitos; nada menor é aceito como protocolo (data tem 8, CEP tem 8). */
export const MIN_DIGITOS = 9;

/**
 * UC: 7 dígitos, sem os zeros à esquerda. Metade das UCs da ENEL tem 7 ou 8 dígitos
 * ("0088101266" no cadastro, "Instalação: 88101266" na Carta). Um número qualquer de 7 ou 8
 * dígitos no e-mail só conta se for EXATAMENTE a UC de um projeto nosso.
 */
export const MIN_DIGITOS_UC = 7;

/** As sequências de dígitos com `minimo`+ dígitos (9, o da NT, por padrão), sem zero à esquerda. */
export function numerosDoTexto(texto: string | null | undefined, minimo = MIN_DIGITOS): Set<string> {
  const s = new Set<string>();
  for (const bruto of (texto ?? '').match(/\d+/g) ?? []) {
    const n = bruto.replace(/^0+/, '');
    if (n.length >= minimo) s.add(n);
  }
  return s;
}

/** Os números que podem ser UC: 7+ dígitos, sem zero à esquerda. */
const numerosDeUc = (texto: string | null | undefined): Set<string> => numerosDoTexto(texto, MIN_DIGITOS_UC);

const algumEm = (a: Set<string>, b: Set<string>): boolean => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

// ── O nome do titular: um TRECHO INTEIRO tem de ser o nome ──────────────────

/**
 * Sufixo de empresa no fim do nome não é sobrenome: pode estar de um lado e faltar do outro.
 * "SA" sozinho NÃO entra: é sobrenome (Sá). A sociedade anônima só vale escrita S/A ou S.A.,
 * que viram as duas palavras S, A (ver `semSufixoPJ`).
 */
const SUFIXOS_PJ = new Set(['LTDA', 'EPP', 'EIRELI', 'MEI', 'ME']);

/** Sufixo de geração no fim: "JOSE CARLOS SANTOS JUNIOR" não é "JOSE CARLOS SANTOS", e o II não é o III. */
const SUFIXOS_GERACAO = new Set(['JUNIOR', 'JR', 'FILHO', 'NETO', 'SOBRINHO', 'II', 'III', 'IV', 'SEGUNDO', 'TERCEIRO']);

/** Grafias do mesmo sufixo de geração. */
const MESMA_GERACAO: Record<string, string> = { JR: 'JUNIOR', SEGUNDO: 'II', TERCEIRO: 'III' };
const geracao = (w: string): string => MESMA_GERACAO[w] ?? w;

/** Palavras que podem ficar entre dois nomes do titular sem trocar de pessoa. */
const CONECTORES = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

/** As palavras de um nome: sem acento, em caixa alta, letras e dígitos ("S/A" vira S, A; "2B" fica inteiro). */
const palavrasDe = (s: string): string[] =>
  semAcento(s).toUpperCase().split(/[^A-Z0-9]+/).filter(x => x.length > 0);

/** Tira do fim o sufixo de empresa (LTDA, ME, S/A, S.A.…), sempre deixando duas palavras. */
function semSufixoPJ(palavras: string[]): string[] {
  const p = [...palavras];
  for (;;) {
    if (p.length > 2 && SUFIXOS_PJ.has(p[p.length - 1])) p.pop();
    else if (p.length > 3 && p[p.length - 2] === 'S' && p[p.length - 1] === 'A') p.splice(-2);
    else return p;
  }
}

/** O titular do cadastro, pronto para comparar com um trecho. */
interface NomeDoTitular {
  /** as palavras, sem sufixo de empresa e sem o sufixo de geração */
  palavras: string[];
  /** a palavra que o trecho tem de trazer, exata e na posição dela */
  obrigatoria: boolean[];
  /** posição do primeiro e do último nome (palavra de 3+ letras, ou com dígito) */
  primeiro: number;
  ultimo: number;
  /** sufixo de geração do cadastro, na grafia canônica (JR → JUNIOR, SEGUNDO → II) */
  geracao?: string;
}

/** `null` quando o cadastro não tem dois nomes: nome de uma palavra só não identifica ninguém. */
function nomeDoTitular(titular: string): NomeDoTitular | null {
  const todas = semSufixoPJ(palavrasDe(titular));
  const antes = todas.slice(0, -1);
  // sufixo de geração: a última palavra, se a anterior não for conector e sobrarem 2 nomes antes dela
  // ("BAR DO NETO" e "ANTONIO NETO" são nome; "JOSE CARLOS SANTOS NETO" tem sufixo)
  const eGeracao = SUFIXOS_GERACAO.has(todas[todas.length - 1] ?? '')
    && !CONECTORES.has(antes[antes.length - 1] ?? '')
    && antes.filter(p => !CONECTORES.has(p)).length >= 2;
  const palavras = eGeracao ? antes : todas;
  const eNome = (p: string): boolean => p.length > 2 || /\d/.test(p);
  const nomes = palavras.flatMap((p, i) => (eNome(p) ? [i] : []));
  if (nomes.length < 2) return null;
  const primeiro = nomes[0];
  const ultimo = nomes[nomes.length - 1];
  return {
    palavras,
    // obrigatórias: do começo até o primeiro nome, do último nome até o fim, e todo token com dígito
    // (numeral nunca falta, e é token inteiro: "2B" não casa "2A", "1" não casa "17"); o resto do meio pode faltar
    obrigatoria: palavras.map((p, i) => i <= primeiro || i >= ultimo || /\d/.test(p)),
    primeiro,
    ultimo,
    geracao: eGeracao ? geracao(todas[todas.length - 1]) : undefined,
  };
}

/** "A" no lugar de APARECIDA: inicial de nome do meio alfabético que não é conector ("D" não é DE; "1" não é 17). */
const eInicialDe = (w: string, nome: string): boolean =>
  /^[A-Z]$/.test(w) && /^[A-Z]+$/.test(nome) && !CONECTORES.has(nome) && nome[0] === w;

/**
 * O trecho é o nome deste titular? O trecho INTEIRO: a primeira palavra é a primeira do
 * cadastro e a última é a última — nada livre antes nem depois. No caminho, na ordem do
 * cadastro, cada palavra do trecho é:
 *  - a palavra do cadastro, exata (inclusive as curtas, como LU, e os numerais);
 *  - a inicial de um nome do meio alfabético que não é conector (MARIA A. SILVA);
 *  - um conector solto (DA, DE, DO, DAS, DOS, E) entre dois nomes, um de cada vez.
 * Nome alfabético do meio pode faltar; numeral não. Sufixo de empresa pode faltar de um
 * lado. Sufixo de geração tem de ser o mesmo nos dois lados, ou faltar nos dois.
 * É a regra única do nome: o assunto passa cada trecho; o documento, o nome extraído inteiro.
 */
function trechoConforma(trecho: string, t: NomeDoTitular): boolean {
  let w = semSufixoPJ(palavrasDe(trecho));
  if (t.geracao !== undefined) {
    if (w.length === 0 || geracao(w[w.length - 1]) !== t.geracao) return false;
    w = w.slice(0, -1);
  }
  const n = t.palavras;
  const falhou = new Set<string>();
  // i: palavras do cadastro já usadas; j: palavras do trecho já lidas; solto: a anterior foi conector solto
  const alinha = (i: number, j: number, solto: boolean): boolean => {
    if (i === n.length) return j === w.length;
    const chave = `${i}:${j}:${solto}`;
    if (falhou.has(chave)) return false;
    const ok = (j < w.length && w[j] === n[i] && alinha(i + 1, j + 1, false))
      || (!t.obrigatoria[i] && j < w.length && eInicialDe(w[j], n[i]) && alinha(i + 1, j + 1, false))
      || (!t.obrigatoria[i] && alinha(i + 1, j, solto))
      || (!solto && i > t.primeiro && i <= t.ultimo && j < w.length && CONECTORES.has(w[j]) && alinha(i, j + 1, true));
    if (!ok) falhou.add(chave);
    return ok;
  };
  return alinha(0, 0, false);
}

/** Os trechos do assunto: o que fica entre " - " (hífen, meia-risca ou travessão, com espaços) e ":". */
const trechosDoAssunto = (assunto: string): string[] => ` ${assunto ?? ''} `.split(/\s[-–—]+\s|:/);

/**
 * O assunto cita o titular? Só se um TRECHO INTEIRO do assunto for o nome dele
 * (`trechoConforma`). Os assuntos da equipe isolam o nome: "TROCA DE RELÓGIO - <NOME> - NT …",
 * "RE: VISTORIA - <NOME> - NT …", "PROJETO GD - <NOME>"; prefixos (RE:, ENC:, Undeliverable:)
 * viram trechos próprios. Nome sem separador em volta ("PROJETO GD JOSE SANTOS 5KWP") não
 * identifica: fica com os números (protocolo, UC) ou levanta a mão — o lado seguro.
 */
export function titularNoAssunto(assunto: string, titular: string): boolean {
  const t = nomeDoTitular(titular);
  return t !== null && trechosDoAssunto(assunto).some(trecho => trechoConforma(trecho, t));
}

/**
 * O nome do documento (extraído pela IA) é o mesmo titular do cadastro? O nome extraído é
 * um trecho só, com a mesma regra do assunto (`trechoConforma`).
 * Não usa `casaTitular` (util.ts, da EDP): ele compara só primeiro e último nome, em
 * qualquer posição, e aceitava JOSE MARIA SANTOS como JOSE CARLOS SANTOS.
 */
export function mesmoTitular(doSistema: string, doDocumento: string): boolean {
  const t = nomeDoTitular(doSistema);
  return t !== null && trechoConforma(doDocumento, t);
}

/** As palavras que contam num nome de empresa: sem sufixo (LTDA, S/A…) e sem conector (DE, DA, E…). */
const palavrasSignificativas = (palavras: string[]): string[] =>
  semSufixoPJ(palavras).filter(p => !CONECTORES.has(p));

/** Quantas palavras significativas o começo comum precisa ter para ser a mesma empresa. */
export const MIN_PALAVRAS_DA_EMPRESA = 3;

/**
 * Um dos nomes é a razão social do outro, CORTADA no fim? ("Comercial Renova Recuperadora De
 * Pecas" × "COMERCIAL RENOVA RECUPERADORA DE PEÇAS , ACESSÓRIOS PARA VEÍCULOS E AUTOMOTORES LTDA".)
 * Só vale se TODAS as condições valem:
 *  1. pelo menos um dos nomes termina em sufixo de empresa (LTDA, EPP, EIRELI, ME, MEI, S/A) — pessoa
 *     física pai × filho ("JOSE CARLOS SANTOS" × "… FILHO") nunca entra aqui;
 *  2. sem acento, pontuação, sufixo e conectores, as palavras de um nome são o COMEÇO das do outro;
 *  3. esse começo tem `MIN_PALAVRAS_DA_EMPRESA` (3) ou mais palavras: duas palavras ("ALFA BETA") não
 *     identificam empresa nenhuma.
 * Quem chama decide se o contexto permite (o projeto foi achado por número): aqui é só o nome.
 */
export function mesmaEmpresaAbreviada(a: string, b: string): boolean {
  const pa = palavrasDe(a);
  const pb = palavrasDe(b);
  const ePJ = (p: string[]): boolean => semSufixoPJ(p).length !== p.length;
  if (!ePJ(pa) && !ePJ(pb)) return false;
  const sa = palavrasSignificativas(pa);
  const sb = palavrasSignificativas(pb);
  const [curto, longo] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return curto.length >= MIN_PALAVRAS_DA_EMPRESA && curto.every((p, i) => p === longo[i]);
}

function decidir(porProtocolo: ProjetoEnel[], porUc: ProjetoEnel[], porTitular: ProjetoEnel[]): Identificacao {
  const fortes = new Map<string, ProjetoEnel>();
  for (const p of [...porProtocolo, ...porUc]) fortes.set(p.project_id, p);

  if (fortes.size > 1) {
    const codigos = [...fortes.values()].map(p => p.codigo);
    return { tipo: 'conflito', motivo: `o e-mail traz números de mais de um projeto (${codigos.join(', ')})`, codigos };
  }
  if (fortes.size === 1) {
    const f = [...fortes.values()][0];
    if (porTitular.length > 0 && !porTitular.some(p => p.project_id === f.project_id)) {
      const outros = porTitular.map(p => p.codigo);
      return {
        tipo: 'conflito',
        motivo: `o número é do projeto ${f.codigo}, mas o nome é do titular de outro (${outros.join(', ')})`,
        codigos: [f.codigo, ...outros],
      };
    }
    const por: Sinal = porProtocolo.some(p => p.project_id === f.project_id) ? 'protocolo' : 'uc';
    return f.ativo ? { tipo: 'achado', projeto: f, por } : { tipo: 'inativo', projeto: f, por };
  }

  // Só o nome: decisão do usuário — identifica só se for ÚNICO entre os ATIVOS.
  const ativos = porTitular.filter(p => p.ativo);
  if (ativos.length === 1) return { tipo: 'achado', projeto: ativos[0], por: 'titular' };
  if (ativos.length > 1) {
    const codigos = ativos.map(p => p.codigo);
    return { tipo: 'conflito', motivo: `o nome casa com o titular de mais de um projeto (${codigos.join(', ')})`, codigos };
  }
  return { tipo: 'nenhum' };
}

/**
 * Pelo texto, sem IA. Números: assunto + corpo. Nome: SÓ o assunto — o corpo traz
 * a assinatura de funcionário da ENEL, e um cliente homônimo casaria com ela.
 */
export function identificarPorTexto(m: { assunto: string; corpo: string }, projetos: ProjetoEnel[]): Identificacao {
  const texto = `${m.assunto ?? ''}\n${m.corpo ?? ''}`;
  const nums = numerosDoTexto(texto);
  const numsUc = numerosDeUc(texto);
  const porProtocolo = projetos.filter(p => algumEm(numerosDoTexto(p.protocolo), nums));
  const porUc = projetos.filter(p => algumEm(numerosDeUc(p.uc), numsUc));
  const porTitular = projetos.filter(p => p.titular !== null && titularNoAssunto(m.assunto ?? '', p.titular));
  return decidir(porProtocolo, porUc, porTitular);
}

/**
 * Pelo que a IA extraiu do PDF. A IA às vezes troca NT e UC de campo: os dois
 * números do documento valem contra os dois identificadores do projeto.
 */
export function identificarPorDocumento(
  doc: { nt: string | null; uc: string | null; titular: string | null }, projetos: ProjetoEnel[],
): Identificacao {
  const nums = new Set([...numerosDoTexto(doc.nt), ...numerosDoTexto(doc.uc)]);
  const numsUc = new Set([...numerosDeUc(doc.nt), ...numerosDeUc(doc.uc)]);
  const porProtocolo = projetos.filter(p => algumEm(numerosDoTexto(p.protocolo), nums));
  const porUc = projetos.filter(p => algumEm(numerosDeUc(p.uc), numsUc));
  const titular = doc.titular;
  const porTitular = titular && comparavelTitular(titular)
    ? projetos.filter(p => p.titular !== null && comparavelTitular(p.titular) && mesmoTitular(p.titular, titular))
    : [];
  return decidir(porProtocolo, porUc, porTitular);
}

const FORCA: Record<Sinal, number> = { protocolo: 3, uc: 2, titular: 1 };

/** Texto e documento juntos: discordando, é conflito; concordando, fica o sinal mais forte. */
export function combinar(texto: Identificacao, documento: Identificacao): Identificacao {
  if (texto.tipo === 'conflito') return texto;
  if (documento.tipo === 'conflito') return documento;
  if (texto.tipo === 'nenhum') return documento;
  if (documento.tipo === 'nenhum') return texto;
  if (texto.projeto.project_id !== documento.projeto.project_id) {
    const codigos = [texto.projeto.codigo, documento.projeto.codigo];
    return {
      tipo: 'conflito',
      motivo: `o texto do e-mail aponta para o projeto ${codigos[0]} e o documento para o ${codigos[1]}`,
      codigos,
    };
  }
  return FORCA[texto.por] >= FORCA[documento.por] ? texto : documento;
}

/**
 * O nome do arquivo traz o número (protocolo ou UC) de OUTRO projeto — ativo ou
 * não? Então não vai para este card. É o "procurar os nossos números" aplicado ao
 * nome do arquivo: número que não é de projeto nenhum (nota de serviço, protocolo
 * de contato) não barra. Protocolo com 9+ dígitos; UC com 7+ (a UC curta de outro projeto também barra).
 */
export function nomeTrazOutroProjeto(nome: string, projeto: ProjetoEnel, projetos: ProjetoEnel[]): boolean {
  const nums = numerosDoTexto(nome);
  const numsUc = numerosDeUc(nome); // contém `nums`: 7 < 9
  if (numsUc.size === 0) return false;
  return projetos.some(p => p.project_id !== projeto.project_id
    && (algumEm(numerosDoTexto(p.protocolo), nums) || algumEm(numerosDeUc(p.uc), numsUc)));
}

/**
 * Como o projeto aparece no cartão e na chave do anexo. Estável por projeto:
 * protocolo numérico; sem ele (14 dos 34 em 13/10), a UC; sem ela, o código.
 */
export function referenciaDoProjeto(p: ProjetoEnel): string {
  const prot = [...numerosDoTexto(p.protocolo)][0];
  if (prot) return prot;
  const uc = [...numerosDoTexto(p.uc)][0];
  if (uc) return `UC ${uc}`;
  return p.codigo;
}
