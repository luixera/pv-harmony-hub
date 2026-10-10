/**
 * Erros da Ludmilla — classificados, em português, com efeito na CONTA.
 *
 * Toda falha vira uma frase que a tela mostra e uma decisão sobre a conta do
 * portal: seguir `ok` (o problema é nosso, do roteiro), pedir reconexão
 * (`sessao_expirada`) ou parar (`erro`: credencial recusada, CAPTCHA). O
 * robô nunca grava stack trace no banco.
 */

export type ClasseErro =
  | 'login_recusado'
  | 'sessao_expirada'
  | 'captcha_exigido'
  | 'pagina_mudou'
  | 'bloqueado_por_waf'
  | 'falhou';

export type SituacaoConta = 'ok' | 'sessao_expirada' | 'erro';

export class ErroLudmilla extends Error {
  constructor(public readonly classe: ClasseErro, mensagem: string) {
    super(mensagem);
    this.name = 'ErroLudmilla';
  }
}

export interface ErroClassificado {
  classe: ClasseErro;
  mensagem: string;
  situacaoConta: SituacaoConta;
}

/** O que cada classe significa para a conta e como se explica para gente. */
const EFEITO: Record<ClasseErro, { conta: SituacaoConta; prefixo: string; sufixo?: string }> = {
  login_recusado: {
    conta: 'erro',
    prefixo: 'O portal recusou o login.',
    sufixo: 'Confira usuário e senha na aba Concessionárias.',
  },
  sessao_expirada: {
    conta: 'sessao_expirada',
    prefixo: 'A sessão no portal expirou.',
    sufixo: 'Reconecte na aba Concessionárias para a Ludmilla voltar a visitar.',
  },
  captcha_exigido: {
    conta: 'erro',
    prefixo: 'O portal exige CAPTCHA no login, e a Ludmilla não resolve CAPTCHA.',
    sufixo: 'Saída: colocar a conta no modo "estação local" — a Ludmilla preenche e-mail e senha e uma pessoa digita o código.',
  },
  pagina_mudou: {
    conta: 'ok',
    prefixo: 'A página do portal não está como o roteiro espera.',
    sufixo: 'Veja o print; se o portal mudou, o roteiro precisa ser atualizado.',
  },
  bloqueado_por_waf: {
    conta: 'ok',
    prefixo: 'O portal bloqueou o acesso antes da tela de login (proteção contra robô).',
  },
  falhou: {
    conta: 'ok',
    prefixo: 'A visita falhou por um motivo inesperado.',
  },
};

/** Primeira linha da mensagem técnica, sem caminho de arquivo — o detalhe ajuda, o stack não. */
const detalheCurto = (e: unknown): string => {
  const texto = e instanceof Error ? e.message : String(e);
  return texto.split('\n')[0].replace(/\s+at .*$/, '').slice(0, 300);
};

export function classificarErro(e: unknown): ErroClassificado {
  let classe: ClasseErro;
  if (e instanceof ErroLudmilla) {
    classe = e.classe;
  } else if (e instanceof Error && (e.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(e.message))) {
    // esperar um seletor que não veio é a assinatura de "a página mudou"
    classe = 'pagina_mudou';
  } else {
    classe = 'falhou';
  }
  const efeito = EFEITO[classe];
  const detalhe = detalheCurto(e);
  const mensagem = [efeito.prefixo, detalhe ? `Detalhe: ${detalhe}` : '', efeito.sufixo ?? '']
    .filter(Boolean).join(' ');
  return { classe, mensagem, situacaoConta: efeito.conta };
}

// ── O run de e-mail fala de caixa e de regras, não de portal ─────────────────
//
// `classificarErro`, acima, só tem palavras de portal: "sem regras cadastradas"
// saía como "A visita falhou por um motivo inesperado", e um tempo esgotado
// cairia em "A página do portal não está como o roteiro espera. Veja o print" —
// para uma conta da EDP, que não tem portal nem print. É o texto que o histórico
// mostra ao usuário.
//
// Isto aqui é ACRÉSCIMO: nada acima muda, porque o caminho de varredura de
// portal depende daquela função e o comportamento dele não pode mudar.

export type ClasseErroEmail =
  | 'sem_regras'
  | 'caixa_sem_configuracao'
  | 'caixa_recusou_acesso'
  | 'caixa_indisponivel'
  | 'falhou_email';

export interface ErroEmailClassificado {
  classe: ClasseErroEmail;
  mensagem: string;
  situacaoConta: SituacaoConta;
}

/** `detalhe: false` quando o prefixo já diz tudo — repetir a frase só confunde. */
const EFEITO_EMAIL: Record<ClasseErroEmail, { conta: SituacaoConta; prefixo: string; detalhe: boolean; sufixo?: string }> = {
  sem_regras: {
    conta: 'ok', detalhe: false,
    prefixo: 'Esta concessionária não tem nenhuma regra de leitura de e-mail cadastrada.',
    sufixo: 'Cadastre ao menos uma regra (remetente, assunto e tipo de documento) na aba Concessionárias para a Ludmilla saber o que procurar.',
  },
  caixa_sem_configuracao: {
    conta: 'erro', detalhe: false,
    prefixo: 'O acesso à caixa de e-mail não está configurado para este tenant.',
    sufixo: 'É a mesma caixa do Claudinho: configure o e-mail e a senha de aplicativo nas configurações do agente de e-mail.',
  },
  caixa_recusou_acesso: {
    conta: 'erro', detalhe: true,
    prefixo: 'A caixa de e-mail recusou o acesso.',
    sufixo: 'Confira o e-mail e a senha de aplicativo do agente de e-mail — senha de aplicativo revogada é a causa mais comum.',
  },
  caixa_indisponivel: {
    conta: 'ok', detalhe: true,
    prefixo: 'Não consegui falar com a caixa de e-mail: a conexão caiu ou demorou demais.',
    sufixo: 'Nada foi perdido — o que não deu tempo de tratar entra na próxima leitura.',
  },
  falhou_email: {
    conta: 'ok', detalhe: true,
    prefixo: 'A leitura dos e-mails falhou por um motivo inesperado.',
  },
};

/**
 * A primeira que casar manda; a ordem é do mais específico para o mais genérico.
 *
 * Cada sinal está ancorado na FRASE PRÓPRIA do `throw` do run (ou num código de
 * erro de rede, que é inequívoco), nunca em palavra solta: palavra solta casa
 * também com a mensagem de FALHA de banco e manda o usuário consertar o que não
 * está quebrado. Dois casos reais:
 *  · `/regras? de e-mail/` casava com `Não consegui listar as regras de e-mail:
 *    …` (a RPC falhando) e saía "Esta concessionária não tem nenhuma regra
 *    cadastrada. Cadastre ao menos uma" — para quem já tem três cadastradas;
 *  · `/timeout|socket/` transformava um *statement timeout* do Postgres em "Não
 *    consegui falar com a caixa de e-mail", apontando o dedo para o Gmail.
 *
 * Ao acrescentar sinal aqui, use a frase que o NOSSO código lança.
 */
const SINAIS_EMAIL: ReadonlyArray<readonly [ClasseErroEmail, RegExp]> = [
  ['sem_regras', /não tem regras de e-mail cadastradas/i],
  ['caixa_sem_configuracao', /caixa de e-mail não está configurado|agent_config|email_agent/i],
  ['caixa_recusou_acesso', /AUTHENTICATIONFAILED|Invalid credentials|authentication fail|LOGIN failed|Application-specific password/i],
  ['caixa_indisponivel', /conexão com a caixa de e-mail caiu|busca na caixa de e-mail falhou|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE/i],
];

/**
 * Classifica a falha do run `varredura_email`. Nunca fala de portal, de página
 * nem de print, porque a conta que acompanha por e-mail não tem nenhum dos três.
 */
export function classificarErroEmail(e: unknown): ErroEmailClassificado {
  const texto = e instanceof Error ? e.message : String(e);
  // Tempo esgotado da BIBLIOTECA de e-mail vem como erro com `name` próprio; é
  // sinal de tipo, não palavra no meio do texto, e não confunde com o timeout
  // de uma consulta ao Postgres.
  const porNome = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    ? 'caixa_indisponivel' as const : null;
  const classe = SINAIS_EMAIL.find(([, r]) => r.test(texto))?.[0] ?? porNome ?? 'falhou_email';
  const efeito = EFEITO_EMAIL[classe];
  const detalhe = efeito.detalhe ? detalheCurto(e) : '';
  const mensagem = [efeito.prefixo, detalhe ? `Detalhe: ${detalhe}` : '', efeito.sufixo ?? '']
    .filter(Boolean).join(' ');
  return { classe, mensagem, situacaoConta: efeito.conta };
}

/**
 * A RAZÃO CURTA de uma falha ao guardar o anexo — a que vai para o LOG.
 *
 * A mensagem crua do storage traz o CAMINHO, e o caminho traz o nome do
 * arquivo; nome de arquivo da EDP às vezes traz o titular. Logar
 * `(e as Error).message` punha isto no journald da VPS:
 *   `Não consegui guardar o anexo no projeto: Invalid key:
 *    2222…/1111…/other_photos/1760000000000_PARECER_<NOME DO TITULAR>.pdf`
 *
 * O texto completo continua indo para o BANCO (`portal_anexos.motivo`, por
 * `ludmilla_anexo_erro`), que é de onde a tela lê. No log vai só a classe, que
 * é o que ajuda a diagnosticar sem levar dado de cliente.
 */
export function razaoDeFalhaDeArquivo(e: unknown): string {
  const t = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (/invalid key/.test(t)) return 'o storage recusou o nome do arquivo';
  if (/already exists|duplicate/.test(t)) return 'já existe arquivo nesse caminho';
  if (/payload too large|maximum allowed size|entity too large/.test(t)) return 'arquivo maior que o limite do storage';
  if (/bucket not found/.test(t)) return 'o bucket dos documentos não foi encontrado';
  if (/row-level security|permission|denied|unauthorized|forbidden/.test(t)) return 'sem permissão para guardar no storage';
  if (/econnreset|econnrefused|etimedout|enotfound|eai_again|fetch failed|network/.test(t)) return 'a rede falhou no envio do arquivo';
  return 'motivo inesperado (o texto completo está na linha do anexo, no banco)';
}
