const URL_PADRAO = 'https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ludmilla-status';
const estado = txt => { document.getElementById('estado').textContent = txt; };

async function carregar() {
  const { chave, url } = await chrome.storage.sync.get(['chave', 'url']);
  if (chave) document.getElementById('chave').value = chave;
  document.getElementById('url').value = url || URL_PADRAO;
}

async function salvar() {
  const chave = document.getElementById('chave').value.trim();
  const url = document.getElementById('url').value.trim() || URL_PADRAO;
  if (chave && !/^gdm_[0-9a-f]{40}$/i.test(chave)) {
    estado('A chave deve começar com "gdm_" e ter 40 caracteres hexadecimais.');
    return;
  }
  await chrome.storage.sync.set({ chave, url });
  estado(chave ? 'Salvo.' : 'Salvo (sem chave: a extensão não vai conseguir enviar).');
}

document.getElementById('salvar').addEventListener('click', salvar);
carregar();
