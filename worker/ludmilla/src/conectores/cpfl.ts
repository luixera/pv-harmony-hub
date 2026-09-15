import type { Page } from 'playwright';
import type { Conector, Descoberta, OpcoesVarredura, Protocolo, TelaDescoberta } from './index.js';
import {
  lerAnexosCpfl, lerArquivoCpfl, lerClienteCpfl, lerDetalhesCpfl, lerListaCpfl, lerPareceresCpfl, vistoriaAprovadaCpfl,
  urlAnexosCpfl, urlBaixarArquivoCpfl, urlClienteCpfl, urlDetalhesCpfl, urlListaCpfl, urlParecerCpfl,
} from './cpfl-api.js';
import type { Credenciais } from '../fila.js';
import { ErroLudmilla } from '../erros.js';
import { comPaciencia } from '../paciencia.js';
import { reconhecerPagina } from '../reconhecer.js';
import { semSegredos, vereditoDepoisDaSenha } from '../veredito.js';

/**
 * CPFL — "Projetos Particulares" (projetosparticulares.cpfl.com.br).
 *
 * O que já se sabe (reconhecimento e teste de acesso, 14/09/2026):
 * - login em Azure AD B2C (cpflb2cprd.b2clogin.com), campos `#signInName` e
 *   `#password`, botão `#next`; e-mail + senha bastam — não pediu segundo
 *   fator, apesar do "MFA" no nome da política;
 * - depois do login o B2C devolve para `cpfl.com.br/b2c-auth/receive-token`
 *   e o site cai numa tela "Selecionar perfil" (Projetos Particulares ×
 *   Baixa tensão);
 * - "Projetos Particulares" leva a "Meus projetos", com as abas ANÁLISE PRÉVIA
 *   e ORÇAMENTOS DE CONEXÃO; cada projeto é um cartão com Nome do projeto,
 *   Nota de serviço/Atividade, Serviço e um selo de status (Pendente, Em
 *   Andamento, Reprovado…).
 *
 * `varrer` vem depois da descoberta, escrito sobre o HTML real dessas telas.
 */

/** Spinner do app React do portal (lista e tela do projeto). */
const SELETOR_SPINNER = '[class*="loading-spinner"]';

/** Tela logada da CPFL: a área de projetos no site, ou o título. */
const SINAL_DE_ENTRADA = /cpfl\.com\.br\/(Internet\/Projeto|b2c-auth)|Selecionar perfil|Meus projetos/i;

/** Dias desde uma data dd/mm/aaaa; Infinity quando não há data. */
const diasDesde = (ddmmaaaa: string | undefined): number => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(ddmmaaaa ?? '');
  if (!m) return Infinity;
  return (Date.now() - Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) / 86_400_000;
};

/** Pausa com cara de gente entre um clique e outro. */
const respirar = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

async function entrar(page: Page, creds: Credenciais, loginUrl: string) {
  await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  const email = page.locator('#signInName');
  const senha = page.locator('#password');
  if (await email.count() === 0 || await senha.count() === 0) {
    throw new ErroLudmilla('pagina_mudou', 'A tela de login da CPFL não tem mais os campos #signInName/#password.');
  }
  await email.fill(creds.login);
  await senha.fill(creds.senha);
  await respirar(page, 800);
  await page.locator('#next, button[type="submit"]').first().click();

  // O B2C redireciona em cadeia (b2clogin → receive-token → site). Esperar
  // "networkidle" não basta: o teste de 14/09 tirou o print com o título
  // "Loading …". O sinal certo é a URL sair do b2clogin.
  await page.waitForURL(url => !/b2clogin\.com/i.test(url.href), { timeout: 60_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await respirar(page, 1_500);
}

/**
 * Banner de cookies do site da CPFL: cobre a parte de baixo da página e
 * intercepta cliques. Fecha com "Rejeitar todos" — a opção que menos coleta.
 */
async function fecharCookies(page: Page) {
  const rejeitar = page.getByText(/Rejeitar todos/i).first();
  if (await rejeitar.count() > 0 && await rejeitar.isVisible().catch(() => false)) {
    await rejeitar.click({ timeout: 5_000 }).catch(() => undefined);
    await respirar(page, 600);
  }
}

/** Clica num elemento pelo texto visível e espera a página assentar. */
async function clicarTexto(page: Page, texto: RegExp, oQue: string) {
  const alvo = page.getByText(texto).first();
  if (await alvo.count() === 0) {
    throw new ErroLudmilla('pagina_mudou', `Não achei "${oQue}" na tela (${semSegredos(page.url())}).`);
  }
  await alvo.click();
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await respirar(page);
}

/** HTML da página sem scripts nem estilos — o que interessa é a estrutura. */
async function htmlLimpo(page: Page): Promise<string> {
  const html = await page.content();
  return semSegredos(html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*>/gi, ''));
}

export const cpfl: Conector = {
  chave: 'cpfl',
  loginUrl: 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto',

  async reconhecer(page: Page) {
    const resposta = await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    return reconhecerPagina(page, resposta?.status() ?? 0);
  },

  async testarLogin(page: Page, creds: Credenciais) {
    await entrar(page, creds, this.loginUrl);
    return vereditoDepoisDaSenha(page, SINAL_DE_ENTRADA);
  },

  async descobrir(page: Page, creds: Credenciais, guardarTela): Promise<Descoberta> {
    await entrar(page, creds, this.loginUrl);
    const telas: Descoberta['telas'] = [];
    // rede: o que a tela pediu ao servidor desde a captura anterior — é como se
    // descobre por que uma tela fica no spinner (API recusando o robô?)
    let rede: NonNullable<TelaDescoberta['rede']> = [];
    // …e o CORPO das respostas da API interna do portal (ServerSide/getUserData):
    // é o mesmo JSON que a tela consome — o roteiro de leitura é escrito sobre ele.
    let api: { url: string; status: number; body: string }[] = [];
    page.on('response', async r => {
      const tipo = r.request().resourceType();
      if (tipo === 'xhr' || tipo === 'fetch' || tipo === 'document') rede.push({ url: semSegredos(r.url()), status: r.status(), tipo });
      if (r.url().includes('/gestao-projetos/api/')) {
        const body = await r.text().catch(() => '');
        // campos de token/segredo no corpo não vão para o bucket
        const limpo = body.replace(/"(token|access_token|id_token|refresh_token)"\s*:\s*"[^"]*"/gi, '"$1":"[removido]"');
        api.push({ url: semSegredos(decodeURIComponent(r.url())), status: r.status(), body: limpo.slice(0, 400_000) });
      }
    });
    // cada tela sobe NA HORA: uma falha no meio não perde o que já foi visto
    const guardar = async (nome: string) => {
      const tela: TelaDescoberta = {
        nome, url: semSegredos(page.url()), html: await htmlLimpo(page),
        png: await page.screenshot({ fullPage: true }).catch(() => undefined), rede,
        api: api.length > 0 ? api : undefined,
      };
      rede = []; api = [];
      telas.push(tela);
      await guardarTela(tela);
    };

    await fecharCookies(page);
    await guardar('01-depois-do-login');
    // tela "Selecionar perfil": o cartão "Projetos Particulares". O nome também
    // está no rodapé (Parceiros), então o alvo é o subtítulo, que só o cartão tem.
    if (await page.getByText(/Serviços para projetistas/i).first().count() > 0) {
      await clicarTexto(page, /Serviços para projetistas/i, 'cartão Projetos Particulares');
      await fecharCookies(page);
      await guardar('02-meus-projetos');
    }

    // ENDPOINTS do app de projetos: em vez de renderizar cada aba (o headless
    // shell trava no spinner da tela do projeto), lê o bundle JS na sessão
    // logada e lista todas as rotas /api/... que ele conhece — anexos,
    // vistoria, dados do cliente. É um mapa do que existe, sem clicar em nada.
    const scripts: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map(s => (s as HTMLScriptElement).src));
    const rotas = new Map<string, string>();   // rota → trecho do código em volta (para entender o uso)
    const RE_ROTA = /["'`](\/api\/(?:internal|external)\/[A-Za-z0-9_\/{}$.-]+)/g;
    for (const src of scripts.filter(u => u.includes('/react-app/build/static/js/'))) {
      const r = await page.request.get(src).catch(() => null);
      if (!r || !r.ok()) continue;
      const js = await r.text().catch(() => '');
      for (const m of js.matchAll(RE_ROTA)) {
        if (!rotas.has(m[1])) rotas.set(m[1], js.slice(Math.max(0, (m.index ?? 0) - 160), (m.index ?? 0) + 200));
      }
      // como o app baixa um anexo: o trecho em volta de cada uso de idArquivo/download
      for (const palavra of ['idArquivo', 'nomeArquivo', 'download', 'responseType', '/drupalApi/', 'octet-stream']) {
        let n = 0;
        for (const m of js.matchAll(new RegExp(palavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))) {
          if (n++ >= 6) break;
          rotas.set(`palavra:${palavra}#${n}`, js.slice(Math.max(0, (m.index ?? 0) - 300), (m.index ?? 0) + 300));
        }
      }
    }
    const mapa = { scripts, rotas: [...rotas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([rota, contexto]) => ({ rota, contexto })) };
    const telaRotas: TelaDescoberta = { nome: '00-endpoints', url: 'bundle', html: JSON.stringify(mapa, null, 1) };
    telas.push(telaRotas);
    await guardarTela(telaRotas);
    rede = []; api = [];

    // FORMATO das respostas de detalhe (anexos, cliente, UCs, parecer) para um
    // projeto aprovado e um pendente — lidas direto da API, sem renderizar.
    // É sobre isto que o casamento por titular/UC e o download dos anexos
    // (Relacionamento Operacional) serão escritos.
    const lista = await page.request.get(urlListaCpfl(creds.login, 1, 200)).catch(() => null);
    const itens = lista && lista.ok() ? lerListaCpfl(await lista.json().catch(() => null)).itens : [];
    const amostras = [
      itens.find(i => i.status === 'PROJETO ENCERRADO'),
      itens.find(i => i.status.includes('SOLICITAR VISTORIA')),
      itens.find(i => i.status.includes('INDEFERIDOS')),
    ].filter((i): i is NonNullable<typeof i> => !!i && !!i.raw.codigoProjeto);
    const detalhes: Record<string, unknown>[] = [];
    for (const item of amostras) {
      const cod = item.raw.codigoProjeto;
      const bloco: Record<string, unknown> = { protocolo: item.protocolo, status: item.status, codigoProjeto: cod };
      for (const rota of ['anexos', 'cliente', 'projetodetalhesucs', 'dadostecnicos', 'equipamentos']) {
        const url = `https://www.cpfl.com.br/gestao-projetos/api/drupalApi/ServerSide?${new URLSearchParams({
          httpType: 'GET', paramType: 'ROUTE', endpoint: `/api/internal/detalhesprojeto/${rota}/${cod}` })}`;
        const r = await page.request.get(url).catch(() => null);
        bloco[rota] = r ? { status: r.status(), body: (await r.text().catch(() => '')).slice(0, 60_000) } : 'sem resposta';
        await respirar(page, 300);
      }
      const parecer = await page.request.get(urlParecerCpfl(cod)).catch(() => null);
      bloco.parecer = parecer ? { status: parecer.status(), body: (await parecer.text().catch(() => '')).slice(0, 60_000) } : 'sem resposta';
      detalhes.push(bloco);
    }
    const telaDetalhes: TelaDescoberta = { nome: '00-detalhes-api', url: 'api', html: JSON.stringify(detalhes, null, 1) };
    telas.push(telaDetalhes);
    await guardarTela(telaDetalhes);
    rede = []; api = [];

    await clicarTexto(page, /OR[CÇ]AMENTOS DE CONEX[AÃ]O/i, 'aba Orçamentos de conexão');
    await esperarLista(page);
    await guardar('03-orcamentos-de-conexao');
    // e a outra aba, que também lista protocolos
    if (await page.getByText(/AN[AÁ]LISE PR[EÉ]VIA/i).first().count() > 0) {
      await clicarTexto(page, /AN[AÁ]LISE PR[EÉ]VIA/i, 'aba Análise prévia');
      await esperarLista(page);
      await guardar('04-analise-previa');
    }

    // A TELA DO PROJETO: na CPFL "Aprovado" não é concluído — concluído é
    // aprovado COM a vistoria concluída, e um aprovado pode estar em adequação
    // (inversão de fluxo). Isso só se lê dentro do projeto, na aba Vistoria.
    // Abre um aprovado e um pendente para conhecer as duas caras da tela.
    await page.getByRole('tab', { name: /OR[CÇ]AMENTOS DE CONEX[AÃ]O/i }).click();
    await esperarLista(page);
    await mostrarMaisPorPagina(page);   // os aprovados não estão na 1ª página de 10
    for (const [status, nome] of [['Aprovado', '05-projeto-aprovado'], ['Pendente', '07-projeto-pendente']] as const) {
      const link = await page.locator(`[data-accordion-component="AccordionItem"][data-status="${status}"] a[href*="/meus-projetos/"]`)
        .first().getAttribute('href').catch(() => null);
      if (!link) continue;
      await page.goto(new URL(link, page.url()).href, { waitUntil: 'networkidle', timeout: 60_000 });
      await esperarLista(page);
      await guardar(nome);
      // todas as abas do projeto, uma a uma — a de Vistoria é a que importa
      const abas = page.getByRole('tab');
      const n = await abas.count();
      for (let i = 0; i < n; i++) {
        const rotulo = ((await abas.nth(i).textContent()) ?? '').trim();
        if (!rotulo) continue;
        await abas.nth(i).click();
        await esperarLista(page);
        await guardar(`${nome}-aba-${i + 1}-${rotulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`);
      }
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => undefined);
      await esperarLista(page);
    }
    return { telas };
  },

  async varrer(page: Page, creds: Credenciais, opcoes?: OpcoesVarredura): Promise<Protocolo[]> {
    await entrar(page, creds, this.loginUrl);
    await fecharCookies(page);
    // entra em "Projetos Particulares": é o que cria a sessão do app de
    // projetos; a partir daqui a API interna responde para este navegador
    if (await page.getByText(/Serviços para projetistas/i).first().count() > 0) {
      await clicarTexto(page, /Serviços para projetistas/i, 'cartão Projetos Particulares');
    }
    if (!/gestao-projetos/.test(page.url())) {
      await page.goto('https://www.cpfl.com.br/gestao-projetos/meus-projetos', { waitUntil: 'networkidle', timeout: 60_000 });
    }
    // A aba "Orçamentos de conexão" é onde ficam os projetos que a Ludmilla
    // acompanha (regra do usuário, 14/09/2026): a tela abre nela — assim o
    // print mostra a lista certa — e a leitura vem da API DESSA aba.
    await esperarLista(page);
    const abaOrcamentos = page.getByRole('tab', { name: /OR[CÇ]AMENTOS DE CONEX[AÃ]O/i });
    if (await abaOrcamentos.count() > 0) {
      await abaOrcamentos.first().click({ timeout: 10_000 }).catch(() => undefined);
      await esperarLista(page);
    }

    // A LISTA vem da API (JSON), não da tela: sem spinner, sem paginação
    // clicada, e com o status DETALHADO que o cartão não mostra. Portal lento
    // (estourou 30 s em 15/09) não derruba o run: prazo maior e nova tentativa.
    const porProtocolo = new Map<string, Protocolo>();
    let pagina = 1;
    let total = Infinity;
    while (porProtocolo.size < total && pagina <= 20) {
      const resposta = await comPaciencia(`lista de orçamentos de conexão (página ${pagina})`,
        () => page.request.get(urlListaCpfl(creds.login, pagina, 200), { timeout: 90_000 }));
      if (resposta.status() === 401 || resposta.status() === 403) {
        throw new ErroLudmilla('sessao_expirada', `A API do portal recusou a sessão (HTTP ${resposta.status()}).`);
      }
      if (!resposta.ok()) throw new ErroLudmilla('pagina_mudou', `A API do portal respondeu HTTP ${resposta.status()} na lista.`);
      const lida = lerListaCpfl(await resposta.json().catch(() => null));
      if (pagina === 1 && lida.itens.length === 0 && lida.total > 0) {
        throw new ErroLudmilla('pagina_mudou', 'A lista da API veio vazia num formato que não reconheço.');
      }
      total = lida.total;
      for (const item of lida.itens) porProtocolo.set(item.protocolo, item);
      if (lida.itens.length === 0) break;
      pagina++;
      await respirar(page, 700);
    }

    // DETALHE (pareceres, titular, UCs, anexos) para o que interessa: o que
    // mexeu recentemente E os protocolos dos projetos que o banco acompanha
    // (o banco sabe quais são; o robô não) — o resto não muda há meses.
    const interesse = new Set(opcoes?.protocolosDeInteresse ?? []);
    const detalhar = [...porProtocolo.values()]
      .filter(p => p.raw.codigoProjeto && (interesse.has(p.protocolo) || diasDesde(p.raw['Última atualização']) <= 45))
      .slice(0, 80);
    for (const p of detalhar) {
      const cod = p.raw.codigoProjeto;
      // detalhe que não vem (portal lento duas vezes) fica de fora deste run — o
      // próximo lê de novo; nunca derruba a varredura inteira por um projeto
      const json = async (url: string) => {
        const r = await comPaciencia(`detalhe do projeto ${p.protocolo}`,
          () => page.request.get(url, { timeout: 60_000 }), { tentativas: 2, pausaMs: 3_000 }).catch(() => null);
        return r && r.ok() ? r.json().catch(() => null) : null;
      };
      // Pareceres: a linha do tempo das abas ORÇAMENTO/VISTORIA/CONEXÃO. Vão
      // para o card como comentários, e o último de vistoria decide se
      // "PROJETO ENCERRADO" é vistoria concluída ou encerramento manual.
      const pareceres = lerPareceresCpfl(await json(urlParecerCpfl(cod)));
      if (pareceres.length > 0) {
        const ultimo = pareceres[pareceres.length - 1];
        p.raw['Último parecer'] = `${ultimo.data} · ${ultimo.status}`;
        p.raw['Texto do parecer'] = ultimo.texto;
        p.raw.pareceres = JSON.stringify(pareceres.map(x => ({ chave: x.chave, data: x.data, analise: x.analise, status: x.status, tipo: x.tipo, texto: x.texto })));
      }
      p.raw.vistoriaAprovada = vistoriaAprovadaCpfl(pareceres);
      // Titular (CPF/CNPJ) e UCs: é com isso que o banco CONFERE que o protocolo
      // é mesmo do projeto do card antes de anexar qualquer coisa, e que casa um
      // reprovado reenviado sob protocolo novo (regras do usuário, 14/09/2026).
      const cliente = lerClienteCpfl(await json(urlClienteCpfl(cod)));
      if (cliente.documento) p.raw.documentoTitular = cliente.documento;
      if (cliente.nome) p.raw.nomeTitular = cliente.nome;
      const det = lerDetalhesCpfl(await json(urlDetalhesCpfl(p.protocolo)));
      if (det.ucs.length > 0) p.raw.ucs = det.ucs.join(',');
      // Anexos emitidos pela CPFL (Relacionamento Operacional, Orçamento
      // Simplificado): só a lista — o download acontece depois, e só para o
      // que o banco autorizar (projeto casado E titular/UC conferidos).
      const anexos = lerAnexosCpfl(await json(urlAnexosCpfl(cod)));
      if (anexos.length > 0) p.raw.anexosCpfl = JSON.stringify(anexos);
      await respirar(page, 400);
    }
    return [...porProtocolo.values()];
  },

  async baixarAnexo(page: Page, idArquivo: string): Promise<Buffer | null> {
    const r = await comPaciencia(`anexo ${idArquivo}`,
      () => page.request.get(urlBaixarArquivoCpfl(idArquivo), { timeout: 90_000 }), { tentativas: 2, pausaMs: 3_000 }).catch(() => null);
    if (!r || !r.ok()) return null;
    return lerArquivoCpfl(await r.json().catch(() => null));
  },
};

/**
 * Espera o spinner da lista APARECER e sumir. Só esperar sumir não basta: o
 * app renderiza, o networkidle passa, e só então dispara a busca dos dados —
 * a descoberta capturou a tela do projeto com o spinner girando por isso.
 */
async function esperarLista(page: Page) {
  await page.waitForSelector(SELETOR_SPINNER, { state: 'attached', timeout: 4_000 }).catch(() => undefined);
  await page.waitForSelector(SELETOR_SPINNER, { state: 'detached', timeout: 60_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await respirar(page, 800);
}

/** "Exibir linhas: 200" — menos páginas, menos cliques no portal. */
async function mostrarMaisPorPagina(page: Page) {
  const seletor = page.locator('#page-size');
  if (await seletor.count() === 0) return;
  await seletor.selectOption('200').catch(() => undefined);
  await esperarLista(page);
}
