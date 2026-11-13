import { montarEnvio } from './leitura.js';

const estado = txt => { document.getElementById('estado').textContent = txt; };
const botao = () => document.getElementById('enviar');
let envio = null;

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

async function abaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

async function carregar() {
  botao().disabled = true;
  const aba = await abaAtiva();
  if (!aba || !aba.id) { estado('Não achei a aba ativa.'); return; }

  let r;
  try {
    r = await chrome.tabs.sendMessage(aba.id, { tipo: 'coletar' });
  } catch {
    estado('Abra a lista de solicitações do Portal GD da Elektro nesta aba e clique no ícone de novo.');
    return;
  }
  if (!r || !r.ok) { estado('Não consegui ler a página: ' + ((r && r.erro) || 'erro')); return; }

  envio = montarEnvio(r.linhas);
  const n = envio.protocolos.length;
  if (n === 0) {
    estado('Não achei solicitações nesta página. Abra a lista e, se precisar, aumente "solicitações por página".');
    return;
  }
  estado(`Li ${plural(n, 'solicitação', 'solicitações')} nesta página. Só enviar o status para a Ludmilla confirmar.`);
  botao().disabled = false;
}

async function enviar() {
  if (!envio) return;
  botao().disabled = true;
  estado('Enviando…');
  let r;
  try {
    r = await chrome.runtime.sendMessage({ tipo: 'enviar', envio });
  } catch (e) {
    estado('Falhou ao enviar: ' + String((e && e.message) || e));
    botao().disabled = false;
    return;
  }
  if (r && r.ok) {
    const cartoes = r.recomendacoes
      ? `Viraram ${plural(r.recomendacoes, 'cartão', 'cartões')} na Ludmilla.`
      : 'Nenhuma novidade desta vez (nada mudou desde a última leitura).';
    estado(`Enviei ${plural(r.protocolos, 'solicitação', 'solicitações')}. ${cartoes}`);
  } else {
    estado('Não deu: ' + ((r && (r.detalhe || r.erro)) || 'erro desconhecido') + '. A chave está nas opções?');
    botao().disabled = false;
  }
}

document.getElementById('enviar').addEventListener('click', enviar);
document.getElementById('abrirOpcoes').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

carregar();
