import type { Locator, Page } from 'playwright';
import { ErroLudmilla } from '../erros.js';
import { comPaciencia } from '../paciencia.js';
import { subirTexto, supabase, type Credenciais } from '../fila.js';
import { decimalParaDms, parsearCoordenadas } from '../dms.js';
import { semSegredos } from '../veredito.js';
import { logarNaCpfl } from './cpfl.js';

/**
 * CPFL — criar o projeto "60 - Microgeração Distribuída Baixa Tensão"
 * (Orçamento de Conexão) no portal Gestão de Projetos.
 *
 * Escrito sobre o "Roteiro CPFL: Orçamento de Conexão MMGD" (16/09/2026),
 * montado a partir de duas gravações reais no Chrome: seletores do Drupal,
 * 6 etapas, cada Avançar recarrega a página e a etapa aparece SÓ no título
 * da aba (a URL fica em node/add/project_60 até o Salvar).
 *
 * Regras do roteiro que valem aqui:
 *  - escolher cada opção pelo TEXTO da tela, nunca só pelo código (os
 *    Sim/Não têm código invertido entre perguntas);
 *  - campos cinza (vindos da UC ou calculados) não se digitam;
 *  - pergunta que não está no roteiro → parar e perguntar (vira erro do
 *    passo, com a pergunta, e a resposta entra em `autonomia`);
 *  - depois do Salvar, a Ludmilla PARA em "Envio de documentos": quem envia
 *    os arquivos ou clica "Enviar Depois" é a pessoa.
 */

const URL_NOVO_PROJETO_60 = 'https://www.cpfl.com.br/gestao-projetos/node/add/project_60';
const LOGIN_URL_CPFL = 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto';

export interface DadosCriacaoCpfl {
  project_id: string;
  tenant_id: string;
  run_id: string;
  uc_number: string;
  coordinates: string;
  customer_name: string;
  customer_cpf: string;
  customer_email: string;
  customer_phone: string;
  project_title: string;
  is_rural: boolean;
  concessionaire: string;
  entry_phase: string | null;
  entry_breaker: string | null;
  modulo: { fabricante: string; modelo: string; quantidade: number; potencia_wp: number } | null;
  inversor: { fabricante: string; modelo: string; quantidade: number; potencia_kw: number } | null;
  /** padrão de entrada resolvido como no front (regra escolhida à mão > automática) */
  padrao: { categoria: string; num_fases: number | null; bitola: string | null; disjuntor: number | null; caixa: string | null; demanda_kw: string | null } | null;
  /**
   * Respostas autônomas para as escolhas do formulário. Chave ausente = padrão
   * de GD (AUTONOMIA_PADRAO). O front pode sobrescrever em run.dados.autonomia.
   */
  autonomia: Record<string, string>;
}

/** O que a Ludmilla responde sozinha num projeto de GD comum. */
export const AUTONOMIA_PADRAO: Record<string, string> = {
  tipo_conexao:             'conexao',                // Introdução (se aparecer): Conexão de microgeração
  opcao_orcamento:          'conexao',                // Orçamento de Conexão (não o Estimado)
  mais_de_um_medidor:       'nao',
  ramal_subterraneo:        'nao',
  medicao_no_poste:         'nao',
  mudanca_ponto_entrega:    'nao',
  extensao_fase:            'nao',
  alteracao_carga:          'nao',
  sistema_compensacao:      'Geração Local',
  outorga_registro:         'nao',
  padrao_entrada:           'GED 13',
  tipo_atendimento:         'aéreo',
  fonte_geradora:           'ENERGIA SOLAR',
  endereco_correspondencia: 'Endereço da Instalação',
  endereco_cliente:         'Endereço da Instalação',
  autoriza_documentos:      'sim',
  contagem_prazo_vistoria:  'sim',
  dias_para_ligacao:        '30',                     // data prevista = hoje + N dias
  m2_por_modulo:            '3',                      // área dos arranjos = módulos × N m²
};

// ── utilitários ──────────────────────────────────────────────────────────────

const respirar = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 'sim' | 'nao' → regex do rótulo do radio. */
const simNao = (v: string | undefined) => /^s/i.test(v ?? '') ? /^Sim\b/i : /^N[aã]o\b/i;

/** Número com ponto decimal e sem zeros à direita (0.62, 2.25, 24). */
const numero = (n: number, casas = 3) => Number(n.toFixed(casas)).toString();

const dataIso = (d: Date) => d.toISOString().slice(0, 10);
const dataBr  = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/** Rótulo de fases como o portal escreve. */
const rotuloFases = (fases: number | null | undefined, tipo: string | null | undefined): RegExp => {
  const n = fases ?? (/tri/i.test(tipo ?? '') ? 3 : /bi/i.test(tipo ?? '') ? 2 : /mono/i.test(tipo ?? '') ? 1 : null);
  return n === 3 ? /trif[aá]sic/i : n === 1 ? /monof[aá]sic/i : /bif[aá]sic/i;
};

/**
 * Primeiro elemento VISÍVEL entre os que casam os seletores (na ordem dada).
 * O Drupal guarda cópias escondidas dos mesmos campos em blocos condicionais:
 * `.first()` pega a escondida e o fill estoura "not visible" com o campo na tela.
 */
async function primeiroVisivel(page: Page, seletores: string[]): Promise<Locator | null> {
  for (const seletor of seletores) {
    const todos = page.locator(seletor);
    const n = await todos.count();
    for (let i = 0; i < n; i++) {
      const el = todos.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

/** name/id dos controles visíveis — vai na mensagem de erro para a pessoa ver o que a Ludmilla viu. */
async function camposVisiveis(page: Page): Promise<string> {
  const nomes = await page.locator('input:visible, select:visible, textarea:visible')
    .evaluateAll(els => els.map(e => (e as HTMLInputElement).name || e.id).filter(Boolean).slice(0, 25))
    .catch(() => [] as string[]);
  return nomes.length ? nomes.join(', ') : 'nenhum';
}

/** Todos os controles do formulário, com rótulo e visibilidade — o mapa da tela. */
async function mapaDeCampos(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, textarea, button, a[role="button"], summary')).map(el => {
      const e = el as HTMLInputElement;
      const id = e.id;
      const rotulo = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent)
        || e.closest('label')?.textContent
        || e.getAttribute('aria-label') || '';
      return {
        tag: e.tagName.toLowerCase(), type: e.type || null, name: e.name || null, id: id || null,
        placeholder: e.placeholder || null, rotulo: rotulo.replace(/\s+/g, ' ').trim().slice(0, 80) || null,
        texto: ['BUTTON', 'A', 'SUMMARY'].includes(e.tagName) ? (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) : null,
        valor: e.type === 'radio' || e.type === 'checkbox' ? `${e.value}${e.checked ? ' ✓' : ''}` : (e.value || '').slice(0, 40) || null,
        visivel: e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden',
        opcoes: e.tagName === 'SELECT'
          ? Array.from((e as unknown as HTMLSelectElement).options).slice(0, 40).map(o => `${o.value}=${o.text.trim()}`)
          : undefined,
      };
    }));
}

/** Mensagens de erro que o portal mostra (vermelho) — para explicar um Avançar que não avançou. */
async function errosDaPagina(page: Page): Promise<string> {
  const textos = await page.locator('.messages--error, .alert-danger, .form-item--error-message, .invalid-feedback, [role="alert"]')
    .evaluateAll(els => els
      .filter(e => (e as HTMLElement).offsetParent !== null)
      .map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean))
    .catch(() => [] as string[]);
  return [...new Set(textos)].join(' | ').slice(0, 400);
}

/** Texto do <label> de um controle (for=id, label envolvente ou aria-label). */
async function rotuloDe(page: Page, el: Locator): Promise<string> {
  const id = await el.getAttribute('id');
  let texto = '';
  if (id) texto = (await page.locator(`label[for="${id}"]`).first().textContent().catch(() => '')) ?? '';
  if (!texto.trim()) texto = (await el.locator('xpath=ancestor::label[1]').first().textContent().catch(() => '')) ?? '';
  if (!texto.trim()) texto = (await el.getAttribute('aria-label')) ?? '';
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * Seletores para um campo do Drupal pelo nome-base, do mais exato ao mais
 * frouxo: name="X", name="…[X]", name="X[…]" e, por último, name contém X
 * (o roteiro truncou o prefixo dos campos de geração: "...[modules_qt]").
 */
const porNome = (nome: string, tags = 'input, select, textarea') =>
  tags.split(',').map(t => t.trim()).flatMap(t => [
    `${t}[name="${nome}"]`, `${t}[name$="[${nome}]"]`, `${t}[name^="${nome}["]`, `${t}[name*="${nome}"]`,
  ]);

/** Campos cinza (readonly/disabled) visíveis com valor — é o que o Buscar da UC preenche. */
async function camposCinzaPreenchidos(page: Page): Promise<number> {
  return page.locator('input:visible, select:visible, textarea:visible')
    .evaluateAll(els => els.filter(e => {
      const i = e as HTMLInputElement;
      return (i.readOnly || i.disabled) && !!(i.value ?? '').trim() && !/hidden|submit|button/.test(i.type);
    }).length)
    .catch(() => 0);
}

/**
 * Marca um radio pelo TEXTO do rótulo. O grupo vem do `nome` (name), do `id`
 * de referência do roteiro (mesmo name), ou do bloco que contém a `pergunta`.
 * Se o id do roteiro não tiver o rótulo esperado (código invertido), procura
 * o irmão que tem. Confere isChecked depois do clique.
 */
async function marcarRadio(
  page: Page,
  alvo: { id?: string; nome?: string; pergunta?: RegExp; rotulo: RegExp },
  oQue: string,
): Promise<void> {
  let nome = alvo.nome;
  if (!nome && alvo.id) {
    nome = (await page.locator(`#${alvo.id}`).first().getAttribute('name').catch(() => null)) ?? undefined;
    // id do roteiro sumiu: melhor parar do que marcar o "Não" de outra pergunta
    if (!nome) {
      throw new ErroLudmilla('pagina_mudou',
        `Não achei o campo "${oQue}" (#${alvo.id}) — o portal mudou este bloco. Campos visíveis: ${await camposVisiveis(page)}.`);
    }
  }

  let radios: Locator;
  if (nome) {
    radios = page.locator(porNome(nome, 'input[type="radio"]').join(', '));
  } else if (alvo.pergunta) {
    radios = page.locator('fieldset, .fieldset, .form-item, .js-form-item, .form-radios')
      .filter({ hasText: alvo.pergunta }).last().locator('input[type="radio"]');
  } else {
    radios = page.locator('input[type="radio"]');
  }

  const n = await radios.count();
  const vistos: string[] = [];
  let escolhido: Locator | null = null;
  for (let i = 0; i < n; i++) {
    const r = radios.nth(i);
    const texto = await rotuloDe(page, r);
    vistos.push(texto.slice(0, 40));
    if (alvo.rotulo.test(texto)) { escolhido = r; break; }
  }
  if (!escolhido && alvo.id && await page.locator(`#${alvo.id}`).count() > 0) escolhido = page.locator(`#${alvo.id}`).first();
  if (!escolhido) {
    throw new ErroLudmilla('pagina_mudou',
      `Não achei a opção ${alvo.rotulo.source} em "${oQue}". Opções na tela: ${vistos.filter(Boolean).join(' | ') || 'nenhuma'}.`);
  }
  if (await escolhido.isChecked().catch(() => false)) return;

  // radios do Drupal costumam ter o input escondido atrás do label estilizado
  await escolhido.check({ force: true, timeout: 10_000 }).catch(async () => {
    const id = await escolhido!.getAttribute('id');
    if (id) await page.locator(`label[for="${id}"]`).first().click({ force: true, timeout: 10_000 });
  });
  await respirar(page, 500);
  if (!(await escolhido.isChecked().catch(() => false))) {
    throw new ErroLudmilla('pagina_mudou', `Cliquei em ${alvo.rotulo.source} (${oQue}) mas o radio não ficou marcado.`);
  }
}

/**
 * Preenche um campo de texto/número. Devolve false quando o campo é cinza
 * (readonly/disabled — o portal calcula) ou, se não for obrigatório, quando
 * não está na tela. Campo com máscara que engole o fill recebe digitação.
 */
async function preencher(
  page: Page, seletores: string[], valor: string, oQue: string, o: { obrigatorio?: boolean } = {},
): Promise<boolean> {
  const el = await primeiroVisivel(page, seletores);
  if (!el) {
    if (o.obrigatorio ?? true) {
      throw new ErroLudmilla('pagina_mudou', `Não achei o campo "${oQue}". Campos visíveis: ${await camposVisiveis(page)}.`);
    }
    return false;
  }
  const cinza = await el.evaluate(e => (e as HTMLInputElement).readOnly || (e as HTMLInputElement).disabled).catch(() => false);
  if (cinza) return false;
  await el.fill(valor, { timeout: 10_000 });
  if (valor && !(await el.inputValue().catch(() => ''))) {
    await el.click();
    await el.pressSequentially(valor, { delay: 30 });
  }
  await respirar(page, 300);
  return true;
}

/** Campo de data: input type=date recebe ISO; texto com máscara recebe dd/mm/aaaa. */
async function preencherData(page: Page, seletores: string[], data: Date, oQue: string, o: { obrigatorio?: boolean } = {}): Promise<void> {
  const el = await primeiroVisivel(page, seletores);
  if (!el) {
    if (o.obrigatorio ?? true) throw new ErroLudmilla('pagina_mudou', `Não achei o campo de data "${oQue}". Campos visíveis: ${await camposVisiveis(page)}.`);
    return;
  }
  const tipo = (await el.getAttribute('type')) ?? 'text';
  await preencher(page, seletores, tipo === 'date' ? dataIso(data) : dataBr(data), oQue, o);
}

/**
 * Escolhe um valor num campo que pode ser <select> (opção pelo texto), grupo
 * de radios (rótulo) ou texto livre. `valor` é o texto esperado na tela.
 */
async function escolher(page: Page, nome: string, valor: RegExp, oQue: string, o: { obrigatorio?: boolean } = {}): Promise<void> {
  const select = await primeiroVisivel(page, porNome(nome, 'select'));
  if (select) {
    const opcoes: { value: string; text: string }[] = await select.evaluate(s =>
      Array.from((s as HTMLSelectElement).options).map(op => ({ value: op.value, text: op.text.trim() })));
    const op = opcoes.find(x => valor.test(x.text)) ?? opcoes.find(x => valor.test(x.value));
    if (!op) {
      throw new ErroLudmilla('pagina_mudou',
        `Em "${oQue}" não existe a opção ${valor.source}. Opções: ${opcoes.map(x => x.text).filter(Boolean).join(' | ').slice(0, 300)}.`);
    }
    await select.selectOption({ value: op.value }, { timeout: 10_000 });
    await respirar(page, 400);
    return;
  }
  if (await page.locator(porNome(nome, 'input[type="radio"]').join(', ')).count() > 0) {
    await marcarRadio(page, { nome, rotulo: valor }, oQue);
    return;
  }
  const texto = await primeiroVisivel(page, porNome(nome, 'input, textarea'));
  if (texto) {
    // texto livre: escreve a forma "humana" do regex (sem âncoras/escapes)
    await preencher(page, porNome(nome, 'input, textarea'), valor.source.replace(/\\(.)/g, '$1').replace(/[\^$]/g, ''), oQue, o);
    return;
  }
  if (o.obrigatorio ?? true) {
    throw new ErroLudmilla('pagina_mudou', `Não achei o campo "${oQue}" (${nome}). Campos visíveis: ${await camposVisiveis(page)}.`);
  }
}

/** Abre uma sanfona (details/summary ou accordion Bootstrap) se estiver fechada. */
async function abrirSanfona(page: Page, titulo: RegExp): Promise<void> {
  const cab = page.locator('summary, .accordion-button, button[aria-expanded], a[aria-expanded], [data-bs-toggle="collapse"], [data-toggle="collapse"]')
    .filter({ hasText: titulo }).first();
  if (await cab.count() === 0) return;
  const expandido = await cab.getAttribute('aria-expanded');
  const detalhes = cab.locator('xpath=ancestor-or-self::details[1]');
  const aberto = await detalhes.count() > 0 ? await detalhes.evaluate(d => (d as HTMLDetailsElement).open) : null;
  if (expandido === 'false' || aberto === false) {
    await cab.click({ timeout: 10_000 });
    await respirar(page, 700);
  }
}

/** Controle visível cujo <label> casa com o rótulo (para campos sem name conhecido). */
async function campoPorRotulo(page: Page, rotulo: RegExp): Promise<Locator | null> {
  const labels = page.locator('label');
  const n = await labels.count();
  for (let i = 0; i < n; i++) {
    const l = labels.nth(i);
    const texto = ((await l.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    if (!rotulo.test(texto)) continue;
    const alvoId = await l.getAttribute('for');
    const alvo = alvoId ? page.locator(`[id="${alvoId}"]`).first() : l.locator('input, select, textarea').first();
    if (await alvo.count() > 0 && await alvo.isVisible().catch(() => false)) return alvo;
  }
  return null;
}

/** Espera a etapa (pelo título da aba). Cada Avançar recarrega a página. */
async function esperarEtapa(page: Page, etapa: RegExp, oQue: string): Promise<void> {
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  let titulo = '';
  for (let i = 0; i < 8; i++) {
    titulo = await page.title().catch(() => '');
    if (etapa.test(titulo)) return;
    await respirar(page, 1_500);
  }
  const erros = await errosDaPagina(page);
  throw new ErroLudmilla('pagina_mudou',
    `${oQue}: esperava a tela "${etapa.source}" mas a aba é "${semSegredos(titulo)}".${erros ? ` O portal apontou: ${erros}` : ''}`);
}

/** Clica em Avançar (#edit-next) e espera a próxima etapa. */
async function avancar(page: Page, proximaEtapa: RegExp): Promise<void> {
  const btn = await primeiroVisivel(page, ['#edit-next', 'input[type="submit"][value*="Avançar"]', 'button:has-text("Avançar")']);
  if (!btn) throw new ErroLudmilla('pagina_mudou', `Botão Avançar não encontrado. Campos visíveis: ${await camposVisiveis(page)}.`);
  await btn.click({ timeout: 10_000 });
  await esperarEtapa(page, proximaEtapa, 'Depois de Avançar');
}

/** Pergunta que não está no roteiro: responde se `autonomia` souber; senão para e pergunta. */
async function perguntaForaDoRoteiro(page: Page, dados: DadosCriacaoCpfl, pergunta: RegExp, chave: string, oQue: string): Promise<void> {
  if (await page.getByText(pergunta).first().isVisible().catch(() => false)) {
    const resposta = dados.autonomia[chave];
    if (!resposta) {
      throw new ErroLudmilla('pagina_mudou',
        `O portal fez uma pergunta que não está no roteiro: "${oQue}". Responda em autonomia.${chave} = sim | nao e tente de novo.`);
    }
    await marcarRadio(page, { pergunta, rotulo: simNao(resposta) }, oQue);
  }
}

/** Captura screenshot, sobe no bucket e registra o passo no banco. */
async function registrarPasso(
  page: Page,
  dados: DadosCriacaoCpfl,
  passo: number,
  nome: string,
  status: 'rodando' | 'ok' | 'erro',
  erroMsg?: string,
): Promise<void> {
  let printPath: string | undefined;
  try {
    const buf = await page.screenshot({ fullPage: true });
    const path = `${dados.tenant_id}/criacao/${dados.run_id}/passo-${passo}.png`;
    const { error } = await supabase().storage
      .from('ludmilla')
      .upload(path, buf, { contentType: 'image/png', upsert: true });
    if (!error) printPath = path;
  } catch { /* screenshot falhou: registra sem print */ }

  // Em erro, guarda o que a Ludmilla VIU: HTML limpo e o mapa dos campos
  // (name/id/label/visível). É por isto que o roteiro é corrigido sem chute.
  if (status === 'erro') {
    try {
      const html = semSegredos((await page.content())
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, ''));
      await subirTexto(dados.tenant_id, dados.run_id, `criacao-passo-${passo}.html`, html);
      await subirTexto(dados.tenant_id, dados.run_id, `criacao-passo-${passo}.campos.json`,
        JSON.stringify(await mapaDeCampos(page), null, 1));
    } catch { /* diagnóstico é bônus, nunca derruba o registro do passo */ }
  }

  const { error } = await supabase().rpc('ludmilla_registrar_passo_criacao' as never, {
    p_run_id:     dados.run_id,
    p_passo:      passo,
    p_nome:       nome,
    p_status:     status,
    p_screenshot: printPath ?? null,
    p_erro:       erroMsg ?? null,
  } as never);
  if (error) throw new Error(`registrarPasso RPC: ${error.message}`);
}

/** Roda um passo: registra rodando → executa → ok; em falha registra erro e relança como ErroLudmilla. */
async function passo(page: Page, dados: DadosCriacaoCpfl, n: number, nome: string, corpo: () => Promise<void>): Promise<void> {
  await registrarPasso(page, dados, n, nome, 'rodando');
  try {
    await corpo();
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo ${n} falhou: ${(e as Error).message.split('\n')[0].slice(0, 300)}`;
    await registrarPasso(page, dados, n, nome, 'erro', msg).catch(() => undefined);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, n, nome, 'ok');
}

// ── o roteiro ────────────────────────────────────────────────────────────────

export async function criarProjeto(page: Page, dados: DadosCriacaoCpfl, creds: Credenciais): Promise<void> {
  const a = (chave: string) => dados.autonomia[chave] ?? AUTONOMIA_PADRAO[chave] ?? '';
  const diasLigacao = Number(a('dias_para_ligacao')) || 30;
  const dataLigacao = new Date(Date.now() + diasLigacao * 86_400_000);

  // ── 1. Introdução: login e abrir o formulário do projeto 60 ────────────────
  await passo(page, dados, 1, 'introducao', async () => {
    await logarNaCpfl(page, creds, LOGIN_URL_CPFL);
    await page.goto(URL_NOVO_PROJETO_60, { waitUntil: 'networkidle', timeout: 60_000 });
    await respirar(page, 1_500);

    // Rejeita cookies se o banner cobrir a tela
    const rejeitar = page.getByText(/Rejeitar todos/i).first();
    if (await rejeitar.isVisible().catch(() => false)) {
      await rejeitar.click({ timeout: 5_000 }).catch(() => undefined);
      await respirar(page, 500);
    }

    // Se o portal mostrou a Introdução (Ligação nova × Conexão) em vez de ir
    // direto à etapa 1, escolhe o card e clica Iniciar pelo índice:
    // [0] Ligação nova, [1] Conexão de microgeração.
    if (!/Dados da unidade consumidora/i.test(await page.title()) &&
        await page.getByText(/Conexão de microgeração/i).first().isVisible().catch(() => false)) {
      const botoes = page.getByRole('button', { name: /Iniciar/i }).or(page.getByRole('link', { name: /Iniciar/i }));
      const total = await botoes.count();
      const indice = a('tipo_conexao') === 'ligacao_nova' ? 0 : 1;
      if (total === 0) throw new ErroLudmilla('pagina_mudou', 'Tela de introdução sem botões "Iniciar".');
      await botoes.nth(Math.min(indice, total - 1)).click({ timeout: 10_000 });
    }
    await esperarEtapa(page, /Dados da unidade consumidora/i, 'Ao abrir o projeto 60');

    // Tipo de fluxo: conexão (já vem marcado; garante)
    if (await page.locator('#edit-field-flux-type-conexo').count() > 0) {
      await marcarRadio(page, { id: 'edit-field-flux-type-conexo', rotulo: /conex/i }, 'tipo de fluxo').catch(() => undefined);
    }
  });

  // ── 2. Dados da unidade consumidora ────────────────────────────────────────
  await passo(page, dados, 2, 'dados_uc', async () => {
    // Opção de orçamento: a descrição do "Estimado" cita "Orçamento de Conexão" —
    // por isso o match é pelo rótulo do radio, começando com o texto.
    const estimado = a('opcao_orcamento') === 'estimado';
    await marcarRadio(page, {
      id: estimado ? 'edit-field-quotation-options-60-estimated' : 'edit-field-quotation-options-60-connection',
      rotulo: estimado ? /^Orçamento Estimado/i : /^Orçamento de Conexão/i,
    }, 'opção de orçamento');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    // Necessidades do projeto (3 × Não, por padrão)
    await abrirSanfona(page, /Necessidades do projeto/i);
    await marcarRadio(page, { id: 'edit-field-multiple-energy-meter-0', rotulo: simNao(a('mais_de_um_medidor')) }, 'mais de 1 medidor');
    await marcarRadio(page, { id: 'edit-field-entrance-underground-0', rotulo: simNao(a('ramal_subterraneo')) }, 'ramal subterrâneo');
    await marcarRadio(page, { id: 'edit-field-measurement-fix-pole-0', rotulo: simNao(a('medicao_no_poste')) }, 'medição no poste');

    // UC: digitar, Buscar, esperar os campos cinza
    await abrirSanfona(page, /Insira os dados do local da unidade consumidora/i);
    const SEL_UC = ['#edit-field-consumer-unit-0-consumer-unit-code', '[id^="edit-field-consumer-unit-0-consumer-unit-code"]', 'input[name*="consumer_unit_code"]'];
    await preencher(page, SEL_UC, dados.uc_number, 'Nº da UC');
    const buscar = await primeiroVisivel(page, ['#edit-field-consumer-unit-0-send-uc-code', '[id^="edit-field-consumer-unit-0-send-uc-code"]', 'button:has-text("Buscar")', 'input[type="submit"][value*="Buscar"]']);
    if (!buscar) throw new ErroLudmilla('pagina_mudou', `Botão Buscar da UC não encontrado. Campos visíveis: ${await camposVisiveis(page)}.`);
    await buscar.click({ timeout: 10_000 });

    // Os campos cinza (Nome, CPF/CNPJ, CEP, endereço, Empresa…) aparecem em 3–6 s.
    const cinzaAntes = await camposCinzaPreenchidos(page);
    const preenchidos = async (): Promise<number> => {
      const doBloco: number = await page
        .locator('[id^="edit-field-consumer-unit-0-"]')
        .evaluateAll(els => els
          .filter(e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName))
          .filter(e => !/consumer-unit-code|send-uc-code|latitude|longitude/.test(e.id))
          .filter(e => !!(e as HTMLInputElement).value?.trim()).length)
        .catch(() => 0);
      const cinzaAgora = await camposCinzaPreenchidos(page);
      return doBloco + Math.max(0, cinzaAgora - cinzaAntes);
    };
    await comPaciencia('dados da UC depois do Buscar', async () => {
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await respirar(page, 3_000);
      if ((await preenchidos()) === 0) throw new Error('campos da UC ainda vazios');
    }, { tentativas: 3, pausaMs: 3_000 });
    if ((await preenchidos()) === 0) {
      throw new ErroLudmilla('falhou',
        `O portal não encontrou a UC ${dados.uc_number}. Confira o número no GD Manager e tente de novo.`);
    }

    // Distribuidora diferente: o campo "Empresa" tem que ser CPFL
    const empresa = await campoPorRotulo(page, /^Empresa\b/i);
    const nomeEmpresa = empresa ? await empresa.inputValue().catch(() => '') : '';
    if (nomeEmpresa && !/cpfl/i.test(nomeEmpresa)) {
      throw new ErroLudmilla('falhou', `A UC ${dados.uc_number} é de outra distribuidora ("${nomeEmpresa}"), não da CPFL.`);
    }

    // Latitude/Longitude ficam vazias mesmo com a UC encontrada: são obrigatórias, em DMS
    const coords = parsearCoordenadas(dados.coordinates);
    if (!coords) throw new ErroLudmilla('falhou', 'O projeto está sem coordenadas no GD Manager — o portal exige Latitude e Longitude.');
    await preencher(page, ['[id^="edit-field-consumer-unit-0-latitude"]', 'input[name*="latitude"]'], decimalParaDms(coords.lat, 'lat'), 'Latitude');
    await preencher(page, ['[id^="edit-field-consumer-unit-0-longitude"]', 'input[name*="longitude"]'], decimalParaDms(coords.lng, 'lng'), 'Longitude');

    // Perguntas finais (código invertido: aqui o "-1" é Não — por isso o match é pelo rótulo)
    await marcarRadio(page, { id: 'edit-field-have-position-change-1', rotulo: simNao(a('mudanca_ponto_entrega')) }, 'mudança no ponto de entrega');
    await marcarRadio(page, { id: 'edit-field-necessitie-extension-fase-1', rotulo: simNao(a('extensao_fase')) }, 'extensão de fase');

    // Perguntas que não apareceram na gravação: só responde se a autonomia souber
    await perguntaForaDoRoteiro(page, dados, /Já possui projeto aprovado/i, 'ja_possui_projeto_aprovado', 'Já possui projeto aprovado?');
    await perguntaForaDoRoteiro(page, dados, /Medidor do Vizinho/i, 'uc_medidor_vizinho', 'Unidade Consumidora ou Medidor do Vizinho?');

    await avancar(page, /Dados do projeto/i);
  });

  // ── 3. Dados do projeto ────────────────────────────────────────────────────
  await passo(page, dados, 3, 'dados_projeto', async () => {
    const p = dados.padrao;
    const titulo = dados.project_title || `UFV ${dados.customer_name}`;

    await abrirSanfona(page, /^Dados do projeto/i);
    await preencher(page, ['input[name="title[0][value]"]', ...porNome('title', 'input')], titulo, 'Título do Projeto');
    await escolher(page, 'field_consume_alteration', simNao(a('alteracao_carga')), 'alteração de carga de consumo');
    const dataLig = await campoPorRotulo(page, /Data prevista para liga/i);
    if (dataLig) {
      const tipo = (await dataLig.getAttribute('type')) ?? 'text';
      await dataLig.fill(tipo === 'date' ? dataIso(dataLigacao) : dataBr(dataLigacao), { timeout: 10_000 });
      await respirar(page, 300);
    } else {
      await preencherData(page, porNome('field_expected_connection_date', 'input'), dataLigacao, 'Data prevista para ligação', { obrigatorio: false });
    }
    await escolher(page, 'field_compensation_system', new RegExp(escapeRe(a('sistema_compensacao')), 'i'), 'Sistema de Compensação');

    await abrirSanfona(page, /Categorias do projeto/i);
    if (p?.categoria) {
      await escolher(page, 'field_exists_category', new RegExp(`^\\s*${escapeRe(p.categoria)}\\b`, 'i'), 'Categoria Existente');
    }

    await abrirSanfona(page, /Dados complementares/i);
    await preencher(page, porNome('field_power_plant_name', 'input'), titulo, 'Nome da usina', { obrigatorio: false });
    await escolher(page, 'field_grant_or_registration', simNao(a('outorga_registro')), 'Outorga ou Registro', { obrigatorio: false });
    await escolher(page, 'field_input_standard', new RegExp(escapeRe(a('padrao_entrada')), 'i'), 'Padrão de entrada', { obrigatorio: false });
    await escolher(page, 'field_service_type', new RegExp(escapeRe(a('tipo_atendimento')).replace(/[eé]/gi, '[eé]'), 'i'), 'Tipo de atendimento', { obrigatorio: false });
    await escolher(page, 'field_phase_number', rotuloFases(p?.num_fases, dados.entry_phase), 'Número de Fases da UC', { obrigatorio: false });
    if (p?.bitola) await escolher(page, 'field_cabless', new RegExp(`^\\s*${escapeRe(p.bitola)}(\\s|mm|$)`, 'i'), 'Cabos', { obrigatorio: false });
    if (p?.caixa)  await escolher(page, 'field_cx_electrical', new RegExp(`^\\s*${escapeRe(p.caixa)}\\b`, 'i'), 'Caixa de medição', { obrigatorio: false });
    const carga = a('carga_instalada_kw') || p?.demanda_kw || '';
    if (carga) await preencher(page, porNome('field_load_installed', 'input'), carga.replace(',', '.'), 'Carga instalada (kW)', { obrigatorio: false });
    const disjuntor = a('disjuntor_a') || (p?.disjuntor ? String(p.disjuntor) : (dados.entry_breaker ?? '').replace(/\D/g, ''));
    if (disjuntor) await preencher(page, porNome('field_circuit_breaker_a', 'input'), disjuntor, 'Disjuntor (A)', { obrigatorio: false });

    // Geração: fonte, data de operação, módulos, área, inversores
    await escolher(page, 'field_generating_source', new RegExp(escapeRe(a('fonte_geradora')), 'i'), 'Fonte geradora');
    await preencherData(page, porNome('field_generate_installation_date', 'input'), dataLigacao, 'Data prevista para entrada em operação');

    const m = dados.modulo;
    if (!m || !m.quantidade || !m.potencia_wp) {
      throw new ErroLudmilla('falhou', 'O projeto está sem módulos (quantidade e potência) no GD Manager — o portal exige.');
    }
    await preencher(page, porNome('modules_qt', 'input'), String(m.quantidade), 'Quantidade de módulos');
    await escolher(page, 'module_manufacturer', new RegExp(escapeRe(m.fabricante || 'TCL'), 'i'), 'Fabricante dos módulos');
    await escolher(page, 'module_model', new RegExp(escapeRe(m.modelo || ''), 'i'), 'Modelo dos módulos');
    await preencher(page, porNome('modules_power_peak', 'input'), numero(m.potencia_wp / 1000), 'Potência de pico do módulo (kWp)');
    const area = a('area_arranjos_m2') || String(Math.round(m.quantidade * (Number(a('m2_por_modulo')) || 3)));
    await preencher(page, porNome('field_generation_arr_occup_area', 'input'), area, 'Área ocupada pelos arranjos (m²)');

    const inv = dados.inversor;
    if (!inv || !inv.quantidade || !inv.potencia_kw) {
      throw new ErroLudmilla('falhou', 'O projeto está sem inversores (quantidade e potência) no GD Manager — o portal exige.');
    }
    await preencher(page, porNome('inverter_quantity', 'input'), String(inv.quantidade), 'Quantidade de inversores');
    await escolher(page, 'inverter_manufacturer', new RegExp(escapeRe(inv.fabricante || ''), 'i'), 'Fabricante dos inversores');
    await escolher(page, 'inverter_model', new RegExp(escapeRe(inv.modelo || ''), 'i'), 'Modelo dos inversores');
    await escolher(page, 'inverter_connection', rotuloFases(p?.num_fases, dados.entry_phase), 'Conexão do Inversor');
    await preencher(page, porNome('inverter_rated_power', 'input'), numero(inv.potencia_kw), 'Potência nominal do inversor (kW)');

    await avancar(page, /Dados do cliente/i);
  });

  // ── 4. Dados do cliente ────────────────────────────────────────────────────
  await passo(page, dados, 4, 'dados_cliente', async () => {
    // Pessoa Física já vem marcada e CPF/Nome/Sobrenome/Nascimento vêm da UC.
    // Se o CPF não veio, digita e consulta.
    const cpf = await campoPorRotulo(page, /^CPF\b/i);
    if (cpf && !(await cpf.inputValue().catch(() => ''))) {
      await cpf.fill(dados.customer_cpf.replace(/\D/g, ''), { timeout: 10_000 });
      const consultar = await primeiroVisivel(page, ['button:has-text("Consultar")', 'input[type="submit"][value*="Consultar"]']);
      if (consultar) {
        await consultar.click({ timeout: 10_000 });
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
        await respirar(page, 1_500);
      }
    }

    // Celular* e E-mail*: completa o que faltar
    const celular = await campoPorRotulo(page, /^Celular/i);
    if (celular && !(await celular.inputValue().catch(() => ''))) {
      const tel = dados.customer_phone.replace(/\D/g, '');
      if (!tel) throw new ErroLudmilla('falhou', 'O portal exige o celular do cliente e o projeto está sem telefone no GD Manager.');
      await celular.click(); await celular.pressSequentially(tel, { delay: 30 }); await respirar(page, 300);
    }
    const email = await campoPorRotulo(page, /^E-?mail/i);
    if (email && !(await email.inputValue().catch(() => ''))) {
      if (!dados.customer_email) throw new ErroLudmilla('falhou', 'O portal exige o e-mail do cliente e o projeto está sem e-mail no GD Manager.');
      await email.fill(dados.customer_email, { timeout: 10_000 }); await respirar(page, 300);
    }

    // Endereços: Endereço da Instalação (radios/select dentro de cada pergunta)
    await escolherNaPergunta(page, /Endereço para correspondência/i, new RegExp(escapeRe(a('endereco_correspondencia')), 'i'), 'Endereço para correspondência');
    await escolherNaPergunta(page, /Endereço do cliente/i, new RegExp(escapeRe(a('endereco_cliente')), 'i'), 'Endereço do cliente');

    // Autorizações
    await marcarRadio(page, { pergunta: /Autoriza a distribuidora a entregar/i, rotulo: simNao(a('autoriza_documentos')) }, 'autoriza entrega de contratos com o orçamento');
    await marcarRadio(page, { pergunta: /contagem de prazo para a vistoria/i, rotulo: simNao(a('contagem_prazo_vistoria')) }, 'contagem de prazo da vistoria (REN 1.000/2021)');

    await avancar(page, /Revisão do projeto/i);
  });

  // ── 5. Revisão → Salvar ────────────────────────────────────────────────────
  // O print do passo (registrado em "rodando") é a revisão inteira.
  let nodeId = '';
  await passo(page, dados, 5, 'revisao', async () => {
    const salvar = await primeiroVisivel(page, ['#edit-submit', 'input[type="submit"][value="Salvar"]', 'input[type="submit"][value*="Salvar"]', 'button:has-text("Salvar")']);
    if (!salvar) throw new ErroLudmilla('pagina_mudou', `Botão Salvar não encontrado na revisão. Campos visíveis: ${await camposVisiveis(page)}.`);
    await salvar.click({ timeout: 10_000 });

    const regexNode = /\/node\/(\d+)\/edit/;
    await comPaciencia('projeto salvo (URL com /node/<id>/edit)', async () => {
      await page.waitForURL(url => regexNode.test(url.href), { timeout: 20_000 });
    }, { tentativas: 3, pausaMs: 2_000 });
    const m = regexNode.exec(page.url());
    if (!m) {
      const erros = await errosDaPagina(page);
      throw new ErroLudmilla('pagina_mudou', `Depois de Salvar a URL não trouxe o número do projeto (${semSegredos(page.url())}).${erros ? ` O portal apontou: ${erros}` : ''}`);
    }
    nodeId = m[1];
    const { error } = await supabase().rpc('ludmilla_salvar_node_cpfl' as never, {
      p_project_id: dados.project_id,
      p_node_id:    nodeId,
    } as never);
    if (error) throw new Error(`ludmilla_salvar_node_cpfl: ${error.message}`);
  });

  // ── 6. Envio de documentos: a Ludmilla PARA aqui ───────────────────────────
  // O projeto já existe (node). Enviar arquivos ou "Enviar Depois" é decisão
  // da pessoa — o print mostra a lista de documentos pedidos.
  await passo(page, dados, 6, 'concluido', async () => {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await respirar(page, 1_500);
  });
}

/** Escolhe uma opção (radio ou select) dentro do bloco que contém a pergunta. */
async function escolherNaPergunta(page: Page, pergunta: RegExp, valor: RegExp, oQue: string): Promise<void> {
  const bloco = page.locator('fieldset, .fieldset, .form-item, .js-form-item, .form-wrapper').filter({ hasText: pergunta }).last();
  if (await bloco.count() === 0) {
    throw new ErroLudmilla('pagina_mudou', `Não achei a pergunta "${oQue}" na tela. Campos visíveis: ${await camposVisiveis(page)}.`);
  }
  const select = bloco.locator('select').first();
  if (await select.count() > 0 && await select.isVisible().catch(() => false)) {
    const opcoes: { value: string; text: string }[] = await select.evaluate(s =>
      Array.from((s as HTMLSelectElement).options).map(op => ({ value: op.value, text: op.text.trim() })));
    const op = opcoes.find(x => valor.test(x.text));
    if (!op) throw new ErroLudmilla('pagina_mudou', `Em "${oQue}" não existe a opção ${valor.source}. Opções: ${opcoes.map(x => x.text).join(' | ').slice(0, 300)}.`);
    await select.selectOption({ value: op.value }, { timeout: 10_000 });
    await respirar(page, 400);
    return;
  }
  await marcarRadio(page, { pergunta, rotulo: valor }, oQue);
}
