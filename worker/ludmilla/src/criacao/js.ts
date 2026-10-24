/**
 * Trechos de JavaScript que rodam DENTRO da página do portal (via
 * `agent-browser eval --stdin`). Valores entram sempre por JSON.stringify —
 * nunca por concatenação de texto cru.
 */

const j = (v: unknown) => JSON.stringify(v);

/**
 * Init script (roda antes de qualquer script da página, em toda aba da
 * sessão): a mesma cara do contexto Playwright da varredura. Na VPS o Chrome
 * da CLI dizia "HeadlessChrome/153" e a Agência da CPFL não mostrava os
 * cartões de perfil (18/09/2026).
 */
export const jsInitNavegador = (userAgent: string) => `(() => {
  const ua = ${j(userAgent)};
  try { Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true }); } catch {}
  try { Object.defineProperty(navigator, 'appVersion', { get: () => ua.replace(/^Mozilla\\//, ''), configurable: true }); } catch {}
  try { Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true }); } catch {}
  try { Object.defineProperty(navigator, 'language', { get: () => 'pt-BR', configurable: true }); } catch {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'], configurable: true }); } catch {}
})();`;

/** Mapa dos controles do formulário (mesmo formato de docs/superpowers/specs/2026-09-17-cpfl60-mapa/mapa.js). */
export const JS_MAPA = `(() => {
  const limpo = s => (s || '').replace(/\\s+/g, ' ').trim();
  const pergunta = el => { const fs = el.closest('fieldset'); const lg = fs && fs.querySelector('legend'); return lg ? limpo(lg.textContent).slice(0, 120) : null; };
  const rotulo = el => { const l = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); return limpo(l ? l.textContent : (el.closest('label') || {}).textContent).slice(0, 80) || null; };
  const visivel = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  return {
    titulo: document.title, url: location.href,
    erros: Array.from(document.querySelectorAll('.messages--error, .alert-danger, .form-item--error-message, .invalid-feedback')).filter(visivel).map(e => limpo(e.textContent).slice(0, 200)),
    controles: Array.from(document.querySelectorAll('form input, form select, form textarea, form button')).filter(e => e.type !== 'hidden').map(e => {
      const escolha = e.type === 'radio' || e.type === 'checkbox';
      return { t: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), id: e.id || null, name: e.name || null,
        rotulo: rotulo(e), pergunta: escolha ? pergunta(e) : null,
        valor: escolha ? e.value : undefined, marcado: escolha ? e.checked : undefined,
        preenchido: !escolha && e.tagName !== 'BUTTON' ? !!limpo(e.value) : undefined,
        ro: (e.readOnly || e.disabled) || undefined, req: e.required || undefined, vis: visivel(e),
        opcoes: e.tagName === 'SELECT' ? Array.from(e.options).slice(0, 60).map(o => o.value + '=' + limpo(o.text)) : undefined,
        txt: e.tagName === 'BUTTON' ? limpo(e.textContent).slice(0, 50) : undefined };
    }),
  };
})()`;

/**
 * Define o valor de um campo (texto, número, data ou select) e dispara os
 * eventos que o JS do portal escuta (input, keyup, change). O `fill` da CLI
 * não basta: o total dos módulos aparecia na tela e ia vazio no POST.
 * Devolve o valor que ficou, ou null se o campo não existe.
 */
export const jsSetValor = (seletor: string, valor: string) => `(() => {
  const el = document.querySelector(${j(seletor)});
  if (!el) return null;
  el.focus();
  if (el.tagName === 'SELECT') {
    const op = Array.from(el.options).find(o => o.value === ${j(valor)}) || Array.from(el.options).find(o => o.text.trim().toLowerCase() === ${j(valor)}.toLowerCase());
    if (!op) return { erro: 'opcao', opcoes: Array.from(el.options).map(o => o.value + '=' + o.text.trim()).slice(0, 40) };
    el.value = op.value;
  } else {
    el.value = ${j(valor)};
  }
  for (const t of ['input', 'keyup', 'change']) el.dispatchEvent(new Event(t, { bubbles: true }));
  el.blur();
  return el.value;
})()`;

/** Marca um radio pelo seletor e devolve { marcado, rotulo } — o rótulo é a prova de que é a opção certa. */
export const jsMarcarRadio = (seletor: string) => `(() => {
  const el = document.querySelector(${j(seletor)});
  if (!el) return null;
  const lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
  if (!el.checked) { (lab || el).click(); }
  if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
  return { marcado: el.checked, rotulo: ((lab ? lab.textContent : '') || '').replace(/\\s+/g, ' ').trim().slice(0, 60) };
})()`;

/** Abre a sanfona cujo botão tem o texto; não fecha se já estiver aberta. */
export const jsAbrirSanfona = (texto: string) => `(() => {
  const alvo = ${j(texto)}.toLowerCase();
  const b = Array.from(document.querySelectorAll('button, summary, .accordion-button')).find(x => (x.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase().startsWith(alvo));
  if (!b) return 'nao-achei';
  const aberta = b.getAttribute('aria-expanded') === 'true' || (b.closest('details') && b.closest('details').open);
  if (!aberta) { b.click(); return 'abri'; }
  return 'ja-aberta';
})()`;

/** Valor atual de um campo pelo seletor (prefixo de id funciona: [id^="..."]). */
export const jsValor = (seletor: string) => `(() => { const el = document.querySelector(${j(seletor)}); return el ? el.value : null; })()`;

/** O campo existe e está visível? */
export const jsVisivel = (seletor: string) => `(() => { const el = document.querySelector(${j(seletor)}); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; })()`;

/** O que o formulário vai MANDAR (FormData) para as chaves pedidas — a tela mente, o POST não. */
export const jsFormData = (chaves: string[]) => `(() => {
  const form = document.querySelector('form.node-form') || document.querySelector('form');
  const fd = new FormData(form);
  const o = {};
  for (const k of ${j(chaves)}) o[k] = fd.get(k);
  return o;
})()`;

/** Mensagens de erro visíveis + campos com aria-invalid — depois de um Avançar que não avançou. */
export const JS_ERROS_VISIVEIS = `(() => {
  const vis = el => el.getClientRects().length > 0;
  const msgs = Array.from(document.querySelectorAll('.messages--error, .alert-danger, .form-item--error-message, .invalid-feedback')).filter(vis).map(e => (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200));
  const campos = Array.from(document.querySelectorAll('[aria-invalid="true"], .is-invalid, input.error, select.error')).map(e => e.name || e.id).filter(Boolean);
  return { mensagens: [...new Set(msgs)], campos: [...new Set(campos)] };
})()`;

/** Texto visível de um grupo de pergunta (fieldset) que contenha o trecho — para detectar perguntas condicionais. */
export const jsPerguntaVisivel = (trecho: string) => `(() => {
  const fs = Array.from(document.querySelectorAll('fieldset')).find(f => (f.querySelector('legend')?.textContent || '').includes(${j(trecho)}));
  return !!fs && fs.getClientRects().length > 0 && getComputedStyle(fs).display !== 'none';
})()`;

/**
 * Clica no elemento cujo texto começa com o trecho — para "Serviços para
 * projetistas", "Rejeitar todos". Procura a FOLHA visível com o texto (como o
 * getByText do Playwright) e clica no clicável mais próximo (a/button/role),
 * ou nela mesma; o evento sobe até o cartão.
 */
export const jsClicarTexto = (trecho: string, _tags = '') => `(() => {
  const alvo = ${j(trecho)}.toLowerCase();
  const vis = x => x.getClientRects().length > 0;
  const texto = x => (x.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const folhas = Array.from(document.querySelectorAll('body *')).filter(x => vis(x) && texto(x).startsWith(alvo) && !Array.from(x.children).some(c => texto(c).startsWith(alvo)));
  const el = folhas[0];
  if (!el) return false;
  const clicavel = el.closest('a, button, [role="button"], [onclick]') || el;
  clicavel.click();
  return true;
})()`;

// ── Bloco "Unidades consumidoras beneficiárias" (autoconsumo remoto) ────────
//
// Os ids desse bloco NÃO estão no mapa de 17/09 (só existe em autoconsumo
// remoto). Em vez de palpite de id, cada trecho acha o controle pelo TEXTO
// (rótulo "Percentual", campo "Nº da UC", botão "Buscar") dentro da seção
// cujo título é o do bloco, e devolve o que achou — o roteiro confere e,
// se faltar, falha dizendo o quê. Os ids reais entram no mapa que o
// registrador grava em erro (JS_MAPA) na primeira simulação.

/** A seção do bloco: o menor elemento visível cujo texto começa com o título e contém "Nº da UC". */
const JS_SECAO_BENEF = `
  const limpo = s => (s || '').replace(/\\s+/g, ' ').trim();
  const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const cands = Array.from(document.querySelectorAll('fieldset, details, section, div')).filter(el =>
    vis(el) && /unidades consumidoras benefici/i.test(limpo(el.textContent)) && /n[ºo°]?\\s*da uc/i.test(limpo(el.textContent)));
  // o menor (mais interno) que ainda contém tudo
  const sec = cands.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
`;

/** Diagnóstico do bloco: o que há nele (para o log e para fechar os seletores). */
export const JS_BENEF_MAPA = `(() => {${JS_SECAO_BENEF}
  if (!sec) return { achou: false };
  const rot = el => { const l = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); return limpo(l ? l.textContent : (el.closest('label') || {}).textContent).slice(0, 80) || null; };
  return {
    achou: true,
    texto: limpo(sec.textContent).slice(0, 600),
    controles: Array.from(sec.querySelectorAll('input, select, button, a')).filter(e => e.type !== 'hidden').map(e => ({
      t: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), id: e.id || null, name: e.name || null,
      rotulo: rot(e), txt: limpo(e.textContent).slice(0, 40) || null, valor: e.value, vis: vis(e), ro: (e.readOnly || e.disabled) || undefined,
    })),
  };
})()`;

/** Marca o rádio "Percentual" dentro do bloco; devolve { marcado, rotulo } ou null. */
export const JS_BENEF_MARCAR_PERCENTUAL = `(() => {${JS_SECAO_BENEF}
  if (!sec) return null;
  const radios = Array.from(sec.querySelectorAll('input[type="radio"]')).filter(vis);
  const rot = el => { const l = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); return limpo(l ? l.textContent : (el.closest('label') || {}).textContent); };
  const el = radios.find(r => /^percentual/i.test(rot(r)));
  if (!el) return null;
  const lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
  if (!el.checked) (lab || el).click();
  if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
  return { marcado: el.checked, rotulo: rot(el).slice(0, 60) };
})()`;

/** Digita a UC no campo "Nº da UC" do bloco (o campo de busca, não o de uma linha). */
export const jsBenefDigitarUc = (uc: string) => `(() => {${JS_SECAO_BENEF}
  if (!sec) return null;
  const rot = el => { const l = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); return limpo(l ? l.textContent : (el.closest('label') || {}).textContent); };
  const campos = Array.from(sec.querySelectorAll('input[type="text"], input:not([type])')).filter(e => vis(e) && !e.readOnly && !e.disabled);
  const el = campos.find(e => /n[ºo°]?\\s*da uc/i.test(rot(e)) || /n[ºo°]?\\s*da uc/i.test(e.placeholder || '')) || campos.find(e => !e.hasAttribute('data-ludmilla-uc'));
  if (!el) return null;
  el.focus(); el.value = ${j(uc)};
  for (const t of ['input', 'keyup', 'change']) el.dispatchEvent(new Event(t, { bubbles: true }));
  return { id: el.id || null, valor: el.value };
})()`;

/** Clica em "Buscar" dentro do bloco. */
export const JS_BENEF_BUSCAR = `(() => {${JS_SECAO_BENEF}
  if (!sec) return false;
  const b = Array.from(sec.querySelectorAll('button, input[type="submit"], input[type="button"], a')).filter(vis)
    .find(x => /^buscar/i.test(limpo(x.textContent || x.value)));
  if (!b) return false;
  b.click();
  return true;
})()`;

/**
 * As linhas que o portal montou: para cada uma, a UC (dígitos), endereço,
 * titular, documento e o campo de percentual — que recebe
 * data-ludmilla-uc="<uc>" para o roteiro preencher com jsSetValor.
 */
export const JS_BENEF_LINHAS = `(() => {${JS_SECAO_BENEF}
  if (!sec) return null;
  const saida = [];
  const vistos = new Set();
  // o campo de % de cada linha: input de texto editável que NÃO é o de busca
  const rot = el => { const l = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); return limpo(l ? l.textContent : (el.closest('label') || {}).textContent); };
  const campos = Array.from(sec.querySelectorAll('input[type="text"], input:not([type])')).filter(e => vis(e) && !/n[ºo°]?\\s*da uc/i.test(rot(e)));
  for (const campo of campos) {
    // sobe até o menor ancestral cujo texto tem uma UC (8–14 dígitos, com ou sem pontuação)
    let linha = campo.parentElement; let uc = '';
    for (let i = 0; i < 8 && linha && linha !== sec; i++) {
      const m = limpo(linha.textContent).match(/N[ºo°]?\\s*da UC:?\\s*([\\d.\\-\\s]{8,20})/i);
      if (m) { uc = m[1].replace(/\\D/g, ''); break; }
      linha = linha.parentElement;
    }
    if (!uc || vistos.has(uc)) continue;
    vistos.add(uc);
    campo.setAttribute('data-ludmilla-uc', uc);
    const t = limpo(linha.textContent);
    const pega = (re) => { const m = t.match(re); return m ? limpo(m[1]) : null; };
    saida.push({
      uc,
      endereco:  pega(/Endere[cç]o:?\\s*(.+?)\\s*Titular:/i),
      titular:   pega(/Titular:?\\s*(.+?)\\s*Documento:/i),
      documento: pega(/Documento:?\\s*([\\d.\\-\\/]+)/i),
      percentual: campo.value,
      id: campo.id || null,
    });
  }
  return saida;
})()`;

/** O texto de "Percentual da sua microgeradora: X%" dentro do bloco. */
export const JS_BENEF_PERCENTUAL_GERADORA = `(() => {${JS_SECAO_BENEF}
  if (!sec) return null;
  const m = limpo(sec.textContent).match(/Percentual da sua microgeradora:?\\s*\\S*\\s*([\\d.,]+\\s*%)/i);
  return m ? m[1] : null;
})()`;
