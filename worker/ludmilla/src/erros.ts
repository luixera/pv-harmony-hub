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
