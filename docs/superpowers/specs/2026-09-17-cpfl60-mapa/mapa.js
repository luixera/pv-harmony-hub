// Mapa dos controles do formulário CPFL "60 - Microgeração Distribuída BT".
// Uso: cat mapa.js | agent-browser --session <s> eval --stdin
// Não exporta VALORES de texto (dados do cliente ficam no portal): só a
// estrutura — id, name, rótulo, pergunta (legend), tipo, somente-leitura,
// visível, opções de select e, para radios/checkbox, o value e se está marcado.
(() => {
  const limpo = s => (s || '').replace(/\s+/g, ' ').trim();
  const pergunta = el => { const fs = el.closest('fieldset'); const lg = fs && fs.querySelector('legend'); return lg ? limpo(lg.textContent).slice(0, 120) : null; };
  const rotulo = el => { const l = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); return limpo(l ? l.textContent : (el.closest('label') || {}).textContent).slice(0, 80) || null; };
  const visivel = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const sanfona = el => { const d = el.closest('details, .accordion-item, .card, .panel'); const t = d && d.querySelector('summary, .accordion-button, .card-header, button'); return t ? limpo(t.textContent).slice(0, 60) : null; };
  return {
    titulo: document.title,
    url: location.href,
    erros: Array.from(document.querySelectorAll('.messages--error, .alert-danger, .form-item--error-message, .invalid-feedback')).filter(visivel).map(e => limpo(e.textContent).slice(0, 200)),
    controles: Array.from(document.querySelectorAll('form input, form select, form textarea, form button'))
      .filter(e => e.type !== 'hidden')
      .map(e => {
        const escolha = e.type === 'radio' || e.type === 'checkbox';
        return {
          t: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''),
          id: e.id || null, name: e.name || null,
          rotulo: rotulo(e), pergunta: escolha ? pergunta(e) : null, sanfona: sanfona(e),
          valor: escolha ? e.value : undefined, marcado: escolha ? e.checked : undefined,
          preenchido: !escolha && e.tagName !== 'BUTTON' ? !!limpo(e.value) : undefined,
          ro: (e.readOnly || e.disabled) || undefined, req: e.required || undefined,
          vis: visivel(e),
          opcoes: e.tagName === 'SELECT' ? Array.from(e.options).slice(0, 60).map(o => o.value + '=' + limpo(o.text)) : undefined,
          txt: e.tagName === 'BUTTON' ? limpo(e.textContent).slice(0, 50) : undefined,
        };
      }),
  };
})()
