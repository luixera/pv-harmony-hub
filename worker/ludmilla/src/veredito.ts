import type { Page } from 'playwright';

/**
 * VEREDITO do teste de acesso — o que o portal mostrou depois da senha.
 *
 * É a resposta à pergunta que trava o desenho do roteiro: o login termina na
 * senha, ou o portal pede um segundo fator? E por onde (e-mail dá para
 * automatizar; SMS não)? O robô para aqui: não digita código, não clica em
 * mais nada. Só descreve e tira print.
 */

export type Veredito = 'entrou' | 'pediu_codigo_email' | 'pediu_codigo_sms' | 'senha_recusada' | 'desconhecido';

export interface VereditoLogin {
  veredito: Veredito;
  explicacao: string;
  url_final: string;
  titulo: string;
}

/** Texto visível de um elemento, ou '' se não existe/está escondido. */
async function textoVisivel(page: Page, seletor: string): Promise<string> {
  const el = page.locator(seletor).first();
  if (await el.count() === 0) return '';
  if (!(await el.isVisible())) return '';
  return (await el.innerText()).trim();
}

export async function vereditoDepoisDaSenha(page: Page, sinalDeEntrada: RegExp): Promise<VereditoLogin> {
  const titulo = (await page.title()).trim();
  const url_final = page.url();
  const corpo = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');

  // 1. senha recusada: o B2C escreve a mensagem numa div .error que fica no
  //    HTML mesmo quando não há erro — por isso só vale se estiver VISÍVEL
  const erro = await textoVisivel(page, '.error[role="alert"], .error.pageLevel, [role="alert"]');
  if (erro && /senha|password|incorret|inválid|invalid/i.test(erro)) {
    return { veredito: 'senha_recusada', explicacao: `O portal disse: "${erro}"`, url_final, titulo };
  }

  // 2. segundo fator: campo de código + texto dizendo por onde veio
  const temCampoCodigo = await page.locator(
    '#emailVerificationCode, #verificationCode, input[name*="erification" i], input[id*="otp" i], input[autocomplete="one-time-code"]',
  ).count() > 0;
  const falaDeCodigo = /c[oó]digo/i.test(corpo);
  if (temCampoCodigo || falaDeCodigo) {
    if (/sms|celular|telefone|phone/i.test(corpo)) {
      return { veredito: 'pediu_codigo_sms', explicacao: 'Depois da senha o portal pediu um código enviado por SMS — isso exige uma pessoa.', url_final, titulo };
    }
    return { veredito: 'pediu_codigo_email', explicacao: 'Depois da senha o portal pediu um código enviado por e-mail — dá para a Ludmilla ler o código na caixa de entrada.', url_final, titulo };
  }

  // 3. entrou: a URL ou o conteúdo já é a área logada
  if (sinalDeEntrada.test(url_final) || sinalDeEntrada.test(titulo) || sinalDeEntrada.test(corpo)) {
    return { veredito: 'entrou', explicacao: 'E-mail e senha bastaram: a Ludmilla chegou à lista de projetos.', url_final, titulo };
  }

  return { veredito: 'desconhecido', explicacao: `Não reconheci a tela depois da senha (título "${titulo}"). Veja o print.`, url_final, titulo };
}
