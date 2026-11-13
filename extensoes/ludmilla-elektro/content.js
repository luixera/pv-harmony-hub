/**
 * Script de conteúdo — roda só na página do Portal GD da Elektro.
 *
 * Não faz NADA sozinho: fica calado até o popup pedir "coletar". Aí lê a tabela
 * que está na tela (via leitura.js, carregado sob demanda) e devolve as linhas.
 * Nunca clica, nunca navega, nunca envia — quem envia é o fundo, depois do seu
 * clique no popup.
 */

let lerTabela = null;

async function garantirLeitor() {
  if (!lerTabela) {
    const mod = await import(chrome.runtime.getURL('leitura.js'));
    lerTabela = mod.lerTabela;
  }
  return lerTabela;
}

chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (!msg || msg.tipo !== 'coletar') return;
  garantirLeitor()
    .then(ler => {
      const { linhas } = ler(document);
      responder({ ok: true, linhas });
    })
    .catch(e => responder({ ok: false, erro: String((e && e.message) || e) }));
  return true; // a resposta vem depois do import — mantém o canal aberto
});
