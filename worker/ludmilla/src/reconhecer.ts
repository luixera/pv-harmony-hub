import type { Page } from 'playwright';

/**
 * RECONHECIMENTO da tela de login — o que a Ludmilla vê antes de ter senha.
 *
 * Responde às perguntas que a investigação de fora não conseguiu: há CAPTCHA?
 * de qual tipo? quais campos o formulário tem? o portal bloqueia robô antes
 * de mostrar a tela? Cada resposta muda o plano (CAPTCHA em todo login =
 * contingência de sessão importada; WAF = reavaliar a abordagem).
 */

export type TipoCaptcha = 'recaptcha' | 'hcaptcha' | 'turnstile' | 'nenhum' | 'desconhecido';

export interface CampoLogin {
  tipo: string;
  name: string;
  id: string;
  placeholder: string;
}

export interface Reconhecimento {
  url_final: string;
  titulo: string;
  status_http: number;
  captcha: TipoCaptcha;
  campos: CampoLogin[];
  bloqueado_por_waf: boolean;
}

/** Assinaturas dos serviços de CAPTCHA, procuradas em iframes e scripts. */
const ASSINATURAS: [TipoCaptcha, RegExp][] = [
  ['recaptcha', /google\.com\/recaptcha|recaptcha\.net|grecaptcha/i],
  ['hcaptcha', /hcaptcha\.com/i],
  ['turnstile', /challenges\.cloudflare\.com\/turnstile/i],
];

/** Páginas de bloqueio de WAF (Akamai, Cloudflare, Imperva) e o que escrevem. */
const CARA_DE_WAF = /access denied|attention required|request blocked|reference #\d|incapsula|just a moment/i;

export async function reconhecerPagina(page: Page, statusHttp: number): Promise<Reconhecimento> {
  const titulo = (await page.title()).trim();
  const url_final = page.url();

  // O que a página carrega de fora: iframes e scripts. É onde os CAPTCHAs moram.
  const origens: string[] = await page.evaluate(() => {
    const srcs: string[] = [];
    document.querySelectorAll('iframe[src], script[src]').forEach(el => {
      srcs.push((el as HTMLIFrameElement | HTMLScriptElement).src);
    });
    // scripts embutidos que chamam o widget também contam
    document.querySelectorAll('script:not([src])').forEach(el => {
      const t = el.textContent ?? '';
      if (/grecaptcha|hcaptcha|turnstile/i.test(t)) srcs.push('inline:' + t.slice(0, 200));
    });
    return srcs;
  });

  const bloqueado_por_waf = statusHttp === 403 || statusHttp === 429 || CARA_DE_WAF.test(titulo)
    || (statusHttp >= 400 && CARA_DE_WAF.test(await page.content()));

  let captcha: TipoCaptcha = 'nenhum';
  for (const [tipo, re] of ASSINATURAS) {
    if (origens.some(o => re.test(o))) { captcha = tipo; break; }
  }
  // bloqueado antes da tela: não dá para afirmar nada sobre CAPTCHA
  if (bloqueado_por_waf && captcha === 'nenhum') captcha = 'desconhecido';

  // Só campos VISÍVEIS: hidden e submit não são o que a pessoa preenche.
  const campos: CampoLogin[] = bloqueado_por_waf ? [] : await page.evaluate(() => {
    const lista: { tipo: string; name: string; id: string; placeholder: string }[] = [];
    document.querySelectorAll('input').forEach(input => {
      const tipo = (input.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(tipo)) return;
      const r = input.getBoundingClientRect();
      const visivel = r.width > 0 && r.height > 0 && getComputedStyle(input).visibility !== 'hidden';
      if (!visivel) return;
      lista.push({ tipo, name: input.name ?? '', id: input.id ?? '', placeholder: input.placeholder ?? '' });
    });
    return lista;
  });

  return { url_final, titulo, status_http: statusHttp, captcha, campos, bloqueado_por_waf };
}
