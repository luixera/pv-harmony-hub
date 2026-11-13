/**
 * Leitor da lista de solicitações do Portal GD da Elektro.
 *
 * A Akamai do portal barra navegador automatizado antes do login, então a
 * Ludmilla não lê a Elektro sozinha. Esta extensão NÃO automatiza nada: quem
 * entra, digita o CAPTCHA e abre a lista é a pessoa, na sessão dela. Aqui só se
 * LÊ a tabela que já está na tela e se monta o que a API `ludmilla-status`
 * aceita — `{ concessionaria, protocolos: [{ protocolo, status, titular }] }`.
 *
 * As funções puras (normalizar, indicesDasColunas, solicitacaoDaLinha,
 * montarEnvio) são testadas pelo vitest (sem DOM). `lerTabela` é a casca que
 * anda no DOM da página — provada no portal real, com a pessoa.
 */

export const MAX_ITENS = 500;

/** Tira acento, caixa e espaço repetido — para casar cabeçalho sem tropeçar em "Análise" × "ANALISE". */
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Onde estão a coluna do protocolo e a do status, pelos títulos do cabeçalho.
 * Exige as DUAS: assim a tabela de filtros ("Tipo de Status", sem protocolo)
 * não é confundida com a lista. `null` quando alguma falta.
 */
export function indicesDasColunas(cabecalhos) {
  const norm = (cabecalhos ?? []).map(normalizar);
  const protocolo = norm.findIndex(h => h.includes('PROTOCOLO'));
  const status = norm.findIndex(h => h === 'STATUS');
  if (protocolo < 0 || status < 0) return null;
  return { protocolo, status };
}

/**
 * Uma linha da lista: o protocolo (o número) e o titular (o resto) saem da
 * mesma célula, venham em duas linhas ou na mesma. `null` se faltar o número
 * ou o status — sem eles a API recusaria.
 */
export function solicitacaoDaLinha(textoProtocolo, textoStatus) {
  const bruto = String(textoProtocolo ?? '');
  const m = bruto.match(/\d{8,14}/);
  const protocolo = m ? m[0] : '';
  const titular = bruto.replace(protocolo, ' ').replace(/\s+/g, ' ').trim();
  const status = String(textoStatus ?? '').replace(/\s+/g, ' ').trim();
  if (!protocolo || !status) return null;
  return { protocolo, status, titular };
}

/** O texto visível de uma célula (innerText no navegador; textContent fora dele). */
function textoDaCelula(td) {
  if (!td) return '';
  return String(td.innerText ?? td.textContent ?? '');
}

/**
 * Lê a tabela da lista no documento dado e devolve as solicitações da PÁGINA
 * atual. Percorre as tabelas até achar uma com as colunas de protocolo e
 * status e com linhas de verdade. Não clica, não navega: só lê.
 */
export function lerTabela(doc) {
  for (const tabela of doc.querySelectorAll('table')) {
    const ths = [...tabela.querySelectorAll('thead th, thead td')];
    if (ths.length === 0) continue;
    const col = indicesDasColunas(ths.map(th => textoDaCelula(th)));
    if (!col) continue;
    const linhas = [];
    for (const tr of tabela.querySelectorAll('tbody tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length <= Math.max(col.protocolo, col.status)) continue;
      const sol = solicitacaoDaLinha(textoDaCelula(tds[col.protocolo]), textoDaCelula(tds[col.status]));
      if (sol) linhas.push(sol);
    }
    if (linhas.length > 0) return { linhas, colunas: col };
  }
  return { linhas: [], colunas: null };
}

/**
 * Monta o corpo que a API aceita: só `protocolo`, `status`, `titular`; sem
 * linha capenga; protocolo repetido fica com a última leitura; teto de itens.
 */
export function montarEnvio(linhas) {
  const porProtocolo = new Map();
  for (const l of linhas ?? []) {
    if (!l || !l.protocolo || !l.status) continue;
    porProtocolo.set(l.protocolo, { protocolo: l.protocolo, status: l.status, titular: l.titular ?? '' });
  }
  return { concessionaria: 'ELEKTRO', protocolos: [...porProtocolo.values()].slice(0, MAX_ITENS) };
}
