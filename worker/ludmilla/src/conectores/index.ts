import type { Page } from 'playwright';
import type { Credenciais } from '../fila.js';
import type { Reconhecimento } from '../reconhecer.js';
import type { VereditoLogin } from '../veredito.js';
import { cpfl } from './cpfl.js';
import { elektro } from './elektro.js';

/**
 * Um CONECTOR é o roteiro de um portal: onde é o login, como reconhecer a
 * tela, como ler os protocolos. Concessionária nova = módulo novo aqui e uma
 * linha no CHECK de `portal_accounts.connector`; o resto do robô não muda.
 */

export interface Protocolo {
  protocolo: string;
  titular: string;
  status: string;
  /** o que mais o portal mostrou na linha — guardado cru para auditoria */
  raw: Record<string, string>;
}

/** O que a descoberta traz: as telas visitadas, com o HTML limpo de cada uma. */
export interface Descoberta {
  telas: TelaDescoberta[];
}

export interface TelaDescoberta {
  nome: string;
  url: string;
  html: string;
  /** print da tela no momento da captura */
  png?: Buffer;
  /** requisições XHR/fetch feitas desde a tela anterior: url → status */
  rede?: { url: string; status: number; tipo: string }[];
  /** corpos das respostas da API interna do portal, na ordem em que vieram */
  api?: { url: string; status: number; body: string }[];
}

export interface Conector {
  chave: string;
  /** Tela de login — é onde o reconhecimento começa. */
  loginUrl: string;
  reconhecer(page: Page): Promise<Reconhecimento>;
  /** Entra com a credencial, PARA depois da senha e conta o que viu. */
  testarLogin(page: Page, creds: Credenciais): Promise<VereditoLogin>;
  /** Entra, navega até a lista de projetos e guarda o HTML das telas. */
  descobrir(page: Page, creds: Credenciais, guardarTela: (t: TelaDescoberta) => Promise<void>): Promise<Descoberta>;
  /** Entra e lê a lista. Só existe depois da descoberta logada. */
  varrer(page: Page, creds: Credenciais): Promise<Protocolo[]>;
  /** Baixa um anexo do portal (na mesma sessão da varredura). Null = não veio. */
  baixarAnexo?(page: Page, idArquivo: string): Promise<Buffer | null>;
}

export const CONECTORES: Record<string, Conector> = {
  [cpfl.chave]: cpfl,
  [elektro.chave]: elektro,
};

export function conector(chave: string): Conector {
  const c = CONECTORES[chave];
  if (!c) throw new Error(`A Ludmilla não tem roteiro para o portal "${chave}".`);
  return c;
}
