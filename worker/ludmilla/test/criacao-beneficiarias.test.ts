import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { AgentePlaywright } from '../src/criacao/navegador.js';
import { JS_ABRIR_SANFONAS } from '../src/criacao/js.js';
import { avancar, definirCoordenada, passo, preencherBeneficiarias } from '../src/criacao/roteiro-cpfl60.js';

/**
 * O bloco "Unidades consumidoras beneficiárias" como o portal da CPFL se comporta (envio 1 do PRJ-15238,
 * 04/11/2026: mapa da tela + telas feitas à mão pelo usuário):
 *  - "Buscar" é AJAX do Drupal: escuta `mousedown` e cancela o `click` — el.click() do JS não faz nada;
 *  - marcar "Percentual" também é AJAX: a resposta redesenha o bloco e apaga o que foi digitado antes dela;
 *  - as linhas são uma TABELA com um cabeçalho só; os rótulos não ficam ao lado dos valores.
 */
const PORTAL = (o: { demoraRadio?: number; recusa?: string } = {}) => `<!doctype html><html><head><meta charset="utf-8"><title>Dados do cliente</title></head><body>
<form class="node-form">
  <section id="bloco">
    <button type="button" aria-expanded="true">Unidades consumidoras beneficiárias</button>
    <div id="corpo"></div>
  </section>
  <div id="mensagens"></div>
</form>
<script>
  const DEMORA_RADIO = ${o.demoraRadio ?? 1500};
  const RECUSA = ${JSON.stringify(o.recusa ?? '')};
  const CADASTRO = {
    '075504503612': ['BRASIL - CENTRO - ITUPEVA - SP - 13295152', 'ROMILDO MARTINS CARDOSO', '119.390.938-48'],
    '126028303650': ['NIASSA - RES DOS LAGOS - ITUPEVA - SP - 13296182', 'ROMILDO MARTINS CARDOSO', '119.390.938-48'],
  };
  window.jQuery = { active: 0 };
  let marcado = false; const linhas = [];
  const sufixo = () => '--' + Math.random().toString(36).slice(2, 12);
  const geradora = () => {
    const soma = linhas.reduce((t, l) => t + (parseFloat(String(l.pct).replace(',', '.')) || 0), 0);
    return (100 - soma).toFixed(4).replace('.', ',') + '%';
  };
  function desenhar() {
    const s = sufixo();
    document.getElementById('corpo').innerHTML =
      '<fieldset><legend>Como será feita a distribuição de energia?</legend>'
      + '<input type="radio" id="edit-field-uc-list-percent-0-electrical-distribution-percentual' + s + '" name="dist" value="percentual"' + (marcado ? ' checked' : '') + '>'
      + '<label for="edit-field-uc-list-percent-0-electrical-distribution-percentual' + s + '">Percentual</label></fieldset>'
      + '<p>Percentual da sua microgeradora: <button type="button" title="ajuda">?</button> <span id="ger">' + (linhas.length ? geradora() : '100,00%') + '</span></p>'
      + '<p>Prezado, o somatório dos percentuais deve ser 100%.</p>'
      + '<label for="edit-field-uc-list-percent-0-consumer-unit-code' + s + '">Nº da UC</label>'
      + '<input type="text" id="edit-field-uc-list-percent-0-consumer-unit-code' + s + '" name="uc">'
      + '<button type="submit" id="edit-field-uc-list-percent-0-send-uc-code' + s + '" name="send_uc_code">Buscar</button>'
      + '<table><thead><tr><th>Nº da UC:</th><th>Endereço:</th><th>Titular:</th><th>Documento:</th><th>Percentual:</th><th></th></tr></thead><tbody>'
      + linhas.map((l, i) => '<tr><td>' + l.uc + '</td><td>' + l.dados[0] + '</td><td>' + l.dados[1] + '</td><td>' + l.dados[2] + '</td>'
        + '<td><input type="text" class="pct" data-i="' + i + '" value="' + l.pct + '"></td><td><button type="button">x</button></td></tr>').join('')
      + '</tbody></table>';
    document.querySelector('input[name="dist"]').addEventListener('change', () => {
      window.jQuery.active++;
      setTimeout(() => { marcado = true; desenhar(); window.jQuery.active--; }, DEMORA_RADIO);
    });
    const buscar = document.querySelector('button[name="send_uc_code"]');
    buscar.addEventListener('click', e => e.preventDefault());
    buscar.addEventListener('mousedown', () => {
      const uc = document.querySelector('input[name="uc"]').value.replace(/\\D/g, '');
      window.jQuery.active++;
      setTimeout(() => {
        if (RECUSA) document.getElementById('mensagens').innerHTML = '<div class="messages--error">' + RECUSA + '</div>';
        else if (CADASTRO[uc]) linhas.push({ uc, dados: CADASTRO[uc], pct: '' });
        desenhar(); window.jQuery.active--;
      }, 300);
    });
    document.querySelectorAll('input.pct').forEach(c => c.addEventListener('change', () => {
      linhas[Number(c.dataset.i)].pct = c.value;
      document.getElementById('ger').textContent = geradora();
    }));
  }
  desenhar();
</script></body></html>`;

let navegador: Browser; let contexto: BrowserContext;
before(async () => { navegador = await chromium.launch(); contexto = await navegador.newContext(); });
after(async () => { await navegador?.close(); });

const log = () => undefined;
const BENEF = [{ uc: '075504503612', percentual: 70 }, { uc: '126028303650', percentual: 30 }];

async function abrir(html: string) {
  const ag = await AgentePlaywright.noContexto(contexto);
  await ag.page.setContent(html);
  return ag;
}

test('duas beneficiárias: marca Percentual, busca cada UC, preenche o % e confere a geradora', async () => {
  const ag = await abrir(PORTAL());
  const leituras: Record<string, string> = {};
  const r = await preencherBeneficiarias(ag, BENEF, leituras, log);
  assert.deepEqual(r, [
    { uc: '075504503612', titular: 'ROMILDO MARTINS CARDOSO', documento: '119.390.938-48', endereco: 'BRASIL - CENTRO - ITUPEVA - SP - 13295152' },
    { uc: '126028303650', titular: 'ROMILDO MARTINS CARDOSO', documento: '119.390.938-48', endereco: 'NIASSA - RES DOS LAGOS - ITUPEVA - SP - 13296182' },
  ]);
  const valores = await ag.page.$$eval('input.pct', els => els.map(e => (e as HTMLInputElement).value));
  assert.deepEqual(valores, ['70,0000', '30,0000']);
  assert.equal(leituras.percentual_geradora, '0,0000%');
  await ag.fechar();
});

test('o redesenho do Percentual chega atrasado (5 s) e não apaga a UC digitada', async () => {
  const ag = await abrir(PORTAL({ demoraRadio: 5000 }));
  const r = await preencherBeneficiarias(ag, [{ uc: '075504503612', percentual: 100 }], {}, log);
  assert.equal(r.length, 1);
  await ag.fechar();
});

test('a CPFL recusa a UC: o erro diz o motivo do portal', async () => {
  const ag = await abrir(PORTAL({ recusa: 'UC pertence a outro titular' }));
  await assert.rejects(() => preencherBeneficiarias(ag, BENEF, {}, log), /A CPFL recusou a UC 075504503612.*outro titular/);
  await ag.fechar();
});

test('sem beneficiária: nem abre o bloco', async () => {
  const ag = await abrir(PORTAL());
  await assert.rejects(() => preencherBeneficiarias(ag, [], {}, log), /sem beneficiária/);
  await ag.fechar();
});

// ── o print do passo é a etapa preenchida ────────────────────────────────────

/** Um navegador de mentira que anota a ordem das ações. */
function navegadorFalso(eventos: string[], titulos: string[] = ['Dados do projeto']) {
  return {
    abrir: async () => ({}), clicar: async (s: string) => { eventos.push(`clicar ${s}`); return {}; },
    js: async () => 0 as never, titulo: async () => titulos[0], url: async () => '', esperar: async () => ({}),
    esperarCarga: async () => ({}), screenshot: async () => ({}), limparRede: async () => ({}),
    ultimoPostHtml: async () => '', definirCabecalhos: async () => ({}), fechar: async () => ({}),
  };
}

function contextoFalso(eventos: string[], o: { foto?: () => Promise<string | undefined> } = {}) {
  const registros: { status: string; print?: string; erro?: string }[] = [];
  const ctx = {
    agente: navegadorFalso(eventos),
    dados: {} as never,
    simular: false,
    log: () => undefined,
    registrar: async (_p: number, _n: string, status: string, erro?: string, print?: string) => { registros.push({ status, print, erro }); },
    fotografar: async () => { eventos.push('foto'); return o.foto ? o.foto() : 'tenant/criacao/run/passo-2-preenchido.png'; },
  };
  return { ctx, registros };
}

test('print do passo: tirado ANTES do Avançar, e é ele que o passo guarda', async () => {
  const eventos: string[] = [];
  const { ctx, registros } = contextoFalso(eventos);
  await passo(ctx, 2, 'dados_uc', async (foto) => { await avancar(ctx.agente, /Dados do projeto/, ctx, foto); });
  assert.deepEqual(eventos, ['foto', 'clicar #edit-next']);
  assert.deepEqual(registros.map(r => r.status), ['rodando', 'ok']);
  assert.equal(registros[1].print, 'tenant/criacao/run/passo-2-preenchido.png');
});

test('print que falha não derruba o passo: fica o da tela, como antes', async () => {
  const eventos: string[] = [];
  const { ctx, registros } = contextoFalso(eventos, { foto: async () => { throw new Error('bucket fora'); } });
  await passo(ctx, 2, 'dados_uc', async (foto) => { await foto(); });
  assert.equal(registros[1].status, 'ok');
  assert.equal(registros[1].print, undefined);
});

test('passo com erro depois da foto: guarda a tela da falha, não a foto', async () => {
  const eventos: string[] = [];
  const { ctx, registros } = contextoFalso(eventos);
  await assert.rejects(() => passo(ctx, 2, 'dados_uc', async (foto) => { await foto(); throw new Error('quebrou'); }));
  assert.equal(registros[1].status, 'erro');
  assert.equal(registros[1].print, undefined);
  assert.match(String(registros[1].erro), /quebrou/);
});

test('sanfonas: abre só as que estão de fato fechadas; aberta que se declara fechada não é tocada', async () => {
  const ag = await AgentePlaywright.noContexto(contexto);
  const alterna = "const c = this.closest('.accordion-item').querySelector('.corpo'); c.style.display = c.style.display === 'none' ? 'block' : 'none'";
  const item = (id: string, aria: string, aberta: boolean, extra = '') =>
    `<div class="accordion-item"><h2><button type="button" id="${id}" aria-expanded="${aria}" ${extra} onclick="${alterna}">${id}</button></h2>
      <div class="corpo" style="display:${aberta ? 'block' : 'none'}"><input type="text"><div style="height:200px"></div></div></div>`;
  await ag.page.setContent(`<button type="button" id="fora" aria-expanded="false" onclick="window.foraClicado = true">Menu do site</button>
    <form class="node-form" onsubmit="window.enviou = true; return false">
      ${item('abertaQueDizFechada', 'false', true)}
      ${item('fechada', 'false', false)}
      ${item('aberta', 'true', true)}
      ${item('oculta', 'false', false, 'style="display:none"')}
      <button type="button" id="semItem" aria-expanded="false" onclick="window.semItemClicado = true">Sem container</button>
      <button type="submit" id="envia" aria-expanded="false">Não clicar</button>
    </form>`);
  const aberto = (id: string) => ag.page.$eval(`#${id}`, e => (e.closest('.accordion-item')!.querySelector('.corpo') as HTMLElement).style.display);
  assert.equal(await ag.js(JS_ABRIR_SANFONAS), 1);
  assert.equal(await aberto('abertaQueDizFechada'), 'block', 'a primeira sanfona do portal vem aberta com aria-expanded="false"');
  assert.equal(await aberto('fechada'), 'block');
  assert.equal(await aberto('aberta'), 'block');
  assert.equal(await aberto('oculta'), 'none');
  assert.deepEqual(await ag.page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return [w.enviou ?? null, w.foraClicado ?? null, w.semItemClicado ?? null];
  }), [null, null, null]);
  await ag.fechar();
});

// ── a coordenada que o portal guardou ────────────────────────────────────────

/** A máscara do portal: só olha os dígitos e os encaixa em GG° MM' SS.SS" S. */
const CAMPO_COM_MASCARA = `<input id="lat" oninput="const d = this.value.replace(/\\D/g, '').padEnd(8, '0'); this.value = d.slice(0,2) + '° ' + d.slice(2,4) + &quot;' &quot; + d.slice(4,6) + '.' + d.slice(6,8) + '&quot; S'">`;

test('coordenada com 2 dígitos em cada parte: a máscara guarda o mesmo valor', async () => {
  const ag = await abrir(CAMPO_COM_MASCARA);
  await definirCoordenada(ag, '#lat', "23° 06' 59.0\"", 'Latitude');
  assert.equal(await ag.page.inputValue('#lat'), "23° 06' 59.00\" S");
  await ag.fechar();
});

test('o portal guardou outra coordenada (o caso do 23° 65 90): para e diz o que aconteceu', async () => {
  const ag = await abrir(CAMPO_COM_MASCARA);
  await assert.rejects(() => definirCoordenada(ag, '#lat', "23° 6' 59.0\"", 'Latitude'),
    /Latitude.*23° 6' 59.0".*23° 65' 90.00" S/);
  await ag.fechar();
});
