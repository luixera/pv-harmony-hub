// worker/ludmilla/src/email/enel/identificar.ts
import { casaTitular, comparavelTitular, semAcento } from '../util.js';

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

function nomesDe(titular: string): string[] {
  const p = semAcento(titular).toUpperCase().split(/[^A-Z]+/).filter(x => x.length > 2);
  while (p.length > 2 && SUFIXOS_PJ.has(p[p.length - 1])) p.pop();
  return p;
}

/** Palavras que podem ficar entre o primeiro e o último nome sem trocar de pessoa. */
const CONECTORES = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

/** Palavra entre o primeiro e o último nome: conector, nome do meio do titular, ou a inicial dele. */
const aceitaNoMeio = (w: string, meio: string[]): boolean =>
  CONECTORES.has(w) || meio.includes(w) || (w.length === 1 && meio.some(n => n[0] === w));

/**
 * Forma "janela": primeiro e último nome do titular a até 24 caracteres um do outro,
 * em QUALQUER ocorrência no assunto. Não basta o primeiro e o último: o que fica no
 * meio tem de ser aceito por `aceitaNoMeio`. Assim "JOSE MARIA SANTOS" não casa com
 * "JOSE CARLOS SANTOS" (outra pessoa), e "MARIA A. SILVA" casa com "MARIA APARECIDA SILVA".
 */
function janelaCompativel(assunto: string, nomes: string[]): boolean {
  const primeiro = nomes[0];
  const ultimo = nomes[nomes.length - 1];
  const meio = nomes.slice(1, -1);
  const palavras = assunto.trim().split(' ');
  for (let i = 0; i < palavras.length; i++) {
    if (palavras[i] !== primeiro) continue;
    for (let j = i + 1; j < palavras.length; j++) {
      if (palavras[j] !== ultimo) continue;
      const entre = palavras.slice(i + 1, j);
      // mesma conta da janela de sempre: um espaço de cada lado, ou um só sem palavra no meio
      const largura = entre.length === 0 ? 1 : entre.join(' ').length + 2;
      if (largura > 24) break; // cada j seguinte só alarga a janela
      if (entre.every(w => aceitaNoMeio(w, meio))) return true;
    }
  }
  return false;
}

/**
 * O assunto cita o titular? Duas formas, ambas estritas:
 *  - o nome inteiro, aceitando palavras curtas no meio ("OSSEL LOCACAO DE SALAS…");
 *  - primeiro e último nome a até 24 caracteres, com o meio compatível (ver `janelaCompativel`).
 * Nome de uma palavra só não identifica ninguém.
 */
export function titularNoAssunto(assunto: string, titular: string): boolean {
  const nomes = nomesDe(titular);
  if (nomes.length < 2) return false;
  const normal = semAcento(assunto).toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  const completo = new RegExp(`\\b${nomes.join('(?: [A-Z0-9]{1,2})* ')}\\b`);
  if (completo.test(` ${normal} `)) return true;
  return janelaCompativel(normal, nomes);
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
    ? projetos.filter(p => p.titular !== null && comparavelTitular(p.titular) && casaTitular(p.titular, titular))
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
