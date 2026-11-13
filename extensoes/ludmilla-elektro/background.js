/**
 * Serviço de fundo — a única parte que fala com a internet.
 *
 * O popup manda o envelope já montado; aqui se pega a chave guardada e se faz
 * o POST para a API `ludmilla-status`. A chave `gdm_` vai no cabeçalho, nunca
 * na página do portal. Daí em diante é o trilho de sempre da Ludmilla:
 * casamento com o projeto e cartão para confirmar.
 */

const URL_PADRAO = 'https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ludmilla-status';

chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (!msg || msg.tipo !== 'enviar') return;
  enviar(msg.envio)
    .then(responder)
    .catch(e => responder({ ok: false, erro: String((e && e.message) || e) }));
  return true;
});

async function enviar(envio) {
  const { chave, url } = await chrome.storage.sync.get(['chave', 'url']);
  if (!chave) {
    return { ok: false, erro: 'sem_chave', detalhe: 'Cole a chave gdm_ nas opções da extensão.' };
  }
  let resp;
  try {
    resp = await fetch(url || URL_PADRAO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
      body: JSON.stringify(envio),
    });
  } catch (e) {
    return { ok: false, erro: 'rede', detalhe: 'Não consegui falar com o servidor: ' + String((e && e.message) || e) };
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || !dados.ok) {
    return { ok: false, erro: dados.erro || 'http_' + resp.status, detalhe: dados.detalhe || null };
  }
  return { ok: true, protocolos: dados.protocolos ?? 0, recomendacoes: dados.recomendacoes ?? 0 };
}
