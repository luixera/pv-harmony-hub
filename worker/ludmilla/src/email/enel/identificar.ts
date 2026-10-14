// worker/ludmilla/src/email/enel/identificar.ts
import { comparavelTitular, semAcento } from '../util.js';

/**
 * De qual projeto é este e-mail da ENEL?
 *
 * PRINCÍPIO (spec §6.1): a robô procura os NOSSOS números dentro do e-mail —
 * nunca trata um número qualquer do e-mail como protocolo. As respostas da ENEL
 * trazem NT (9 dígitos), instalação (10), nota de serviço (12), protocolo de
 * contato (10) e número SF; o protocolo de contato tem o MESMO tamanho da UC.
 * Só casa o número que for exatamente o de um projeto nosso, como número inteiro.
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

/** A NT tem 9 dígitos; nada menor é aceito como identificador (data tem 8, CEP tem 8). */
export const MIN_DIGITOS = 9;

/** As sequências de dígitos com 9+ dígitos, sem zero à esquerda. */
export function numerosDoTexto(texto: string | null | undefined): Set<string> {
  const s = new Set<string>();
  for (const bruto of (texto ?? '').match(/\d+/g) ?? []) {
    const n = bruto.replace(/^0+/, '');
    if (n.length >= MIN_DIGITOS) s.add(n);
  }
  return s;
}

const algumEm = (a: Set<string>, b: Set<string>): boolean => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

/** Sufixo de empresa no fim do nome não é sobrenome. */
const SUFIXOS_PJ = new Set(['LTDA', 'EPP', 'EIRELI', 'MEI']);

/** Todas as palavras do titular, sem sufixo de empresa no fim. Palavras curtas ficam (LU, DE). */
function palavrasDo(titular: string): string[] {
  const p = semAcento(titular).toUpperCase().split(/[^A-Z0-9]+/).filter(x => x.length > 0);
  while (p.length > 2 && SUFIXOS_PJ.has(p[p.length - 1])) p.pop();
  return p;
}

/** Sufixo de geração logo depois do último nome: "JOSE CARLOS SANTOS JUNIOR" não é "JOSE CARLOS SANTOS". */
const SUFIXOS_GERACAO = new Set(['JUNIOR', 'JR', 'FILHO', 'NETO', 'SOBRINHO']);

/** Palavras que podem ficar entre dois nomes do titular sem trocar de pessoa. */
const CONECTORES = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

/**
 * Os nomes aparecem no assunto, na ordem, com só palavras permitidas entre um e outro
 * (ver `titularNoAssunto`). `larguraMax` limita os caracteres de cada trecho entre dois
 * nomes. `aceitaDepoisDoUltimo` decide pela palavra logo depois do último nome.
 */
function casaSequencia(
  palavras: string[],
  sequencia: string[],
  permitida: (w: string) => boolean,
  larguraMax: number,
  aceitaDepoisDoUltimo: (proxima: string | undefined) => boolean,
): boolean {
  const busca = (k: number, inicio: number): boolean => {
    for (let p = inicio; p < palavras.length; p++) {
      const entre = palavras.slice(inicio, p);
      if (k > 0) {
        // um espaço de cada lado do trecho; sem palavra no meio, só o espaço
        const largura = entre.length === 0 ? 1 : entre.join(' ').length + 2;
        // o trecho só cresce com p: se já falhou aqui, falha para qualquer p seguinte
        if (!entre.every(permitida) || largura > larguraMax) break;
      }
      if (palavras[p] !== sequencia[k]) continue;
      if (k < sequencia.length - 1) {
        if (busca(k + 1, p + 1)) return true;
      } else if (aceitaDepoisDoUltimo(palavras[p + 1])) {
        return true;
      }
    }
    return false;
  };
  return busca(0, 0);
}

/**
 * O assunto cita o titular? Duas formas, com a MESMA regra entre os nomes:
 *  - o nome completo: todos os nomes do titular, em ordem, sem limite de caracteres;
 *  - primeiro e último nome, com até 24 caracteres entre eles (o nome do meio pode faltar).
 * Entre dois nomes só cabe: conector (DA, DE, DO, DAS, DOS, E), palavra do PRÓPRIO titular
 * (inclusive as curtas, como LU), ou a inicial de um nome do meio que não seja conector
 * ("D" não é inicial de DE). Sufixo de geração no fim do cadastro (JUNIOR, JR, FILHO…) tem de
 * vir logo depois do último nome, qualquer que seja o tamanho; JR e JUNIOR são o mesmo sufixo.
 * Cadastro sem sufixo não casa com texto que traga um.
 * Nome de uma palavra só não identifica ninguém.
 */
export function titularNoAssunto(assunto: string, titular: string): boolean {
  const todas = palavrasDo(titular);
  const canonico = (w: string): string => (w === 'JR' ? 'JUNIOR' : w);
  const ultima = todas[todas.length - 1];
  const sufixo = todas.length > 1 && SUFIXOS_GERACAO.has(ultima) ? canonico(ultima) : undefined;
  const sobrenome = sufixo ? todas.slice(0, -1) : todas;
  const nomes = sobrenome.filter(p => p.length > 2);
  if (nomes.length < 2) return false;
  const primeiro = nomes[0];
  const ultimo = nomes[nomes.length - 1];
  const meio = sobrenome.filter(p => p !== primeiro && p !== ultimo);
  const iniciais = meio.filter(n => !CONECTORES.has(n));
  const permitida = (w: string): boolean =>
    CONECTORES.has(w) || todas.includes(w) || (w.length === 1 && iniciais.some(n => n[0] === w));
  const aceitaDepoisDoUltimo = (proxima: string | undefined): boolean =>
    sufixo !== undefined
      ? proxima !== undefined && canonico(proxima) === sufixo
      : proxima === undefined || !SUFIXOS_GERACAO.has(proxima) || todas.includes(proxima);
  const palavras = semAcento(assunto).toUpperCase().split(/[^A-Z0-9]+/).filter(p => p.length > 0);
  return casaSequencia(palavras, nomes, permitida, Infinity, aceitaDepoisDoUltimo)
    || casaSequencia(palavras, [primeiro, ultimo], permitida, 24, aceitaDepoisDoUltimo);
}

/**
 * O nome do documento (extraído pela IA) é o mesmo titular do cadastro? A mesma regra
 * estrita do assunto: `titularNoAssunto` lê o documento como se fosse o assunto.
 * Não usa `casaTitular` (util.ts, da EDP): ele compara só primeiro e último nome, em
 * qualquer posição, e aceitava JOSE MARIA SANTOS como JOSE CARLOS SANTOS.
 */
export function mesmoTitular(doSistema: string, doDocumento: string): boolean {
  return titularNoAssunto(doDocumento, doSistema);
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
  const nums = numerosDoTexto(`${m.assunto ?? ''}\n${m.corpo ?? ''}`);
  const porProtocolo = projetos.filter(p => algumEm(numerosDoTexto(p.protocolo), nums));
  const porUc = projetos.filter(p => algumEm(numerosDoTexto(p.uc), nums));
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
  const porProtocolo = projetos.filter(p => algumEm(numerosDoTexto(p.protocolo), nums));
  const porUc = projetos.filter(p => algumEm(numerosDoTexto(p.uc), nums));
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
 * de contato) não barra.
 */
export function nomeTrazOutroProjeto(nome: string, projeto: ProjetoEnel, projetos: ProjetoEnel[]): boolean {
  const nums = numerosDoTexto(nome);
  if (nums.size === 0) return false;
  return projetos.some(p => p.project_id !== projeto.project_id
    && (algumEm(numerosDoTexto(p.protocolo), nums) || algumEm(numerosDoTexto(p.uc), nums)));
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
