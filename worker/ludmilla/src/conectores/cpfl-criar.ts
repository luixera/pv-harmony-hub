import type { Page } from 'playwright';
import { ErroLudmilla } from '../erros.js';
import { comPaciencia } from '../paciencia.js';
import { supabase } from '../fila.js';
import { decimalParaDms, parsearCoordenadas } from '../dms.js';

const URL_MEUS_PROJETOS = 'https://www.cpfl.com.br/gestao-projetos/meus-projetos';

export interface DadosCriacaoCpfl {
  project_id: string;
  tenant_id: string;
  run_id: string;
  uc_number: string;
  coordinates: string;
  customer_name: string;
  customer_cpf: string;
  project_title: string;
  modulos: { quantidade: number; potencia_wp: number }[];
  entry_phase: string | null;
  entry_breaker: string | null;
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

/** Pausa humanizada entre ações. */
const respirar = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

/**
 * Preenche o formulário multi-passo de criação de projeto na CPFL.
 * Lança ErroLudmilla em qualquer falha — o worker captura e finaliza o run.
 */
export async function criarProjeto(page: Page, dados: DadosCriacaoCpfl): Promise<void> {

  // ── Passo 1: Navegar até "Criar projeto" em Orçamentos de Conexão ──────────
  await registrarPasso(page, dados, 1, 'introducao', 'rodando');
  try {
    // Se a sessão expirou, o portal redireciona para fora do gestao-projetos
    if (!/gestao-projetos/.test(page.url())) {
      await page.goto(URL_MEUS_PROJETOS, { waitUntil: 'networkidle', timeout: 60_000 });
      await respirar(page, 1_500);
    }

    // Após navigate, checa de novo — sessão expirada redireciona para login/perfil
    if (!/gestao-projetos/.test(page.url())) {
      throw new ErroLudmilla('sessao_expirada',
        'Sessão no portal CPFL expirada. Faça uma varredura manual para renovar o login antes de criar o projeto.');
    }

    // Fecha banner de cookies se aparecer
    const rejeitar = page.getByText(/Rejeitar todos/i).first();
    if (await rejeitar.count() > 0 && await rejeitar.isVisible().catch(() => false)) {
      await rejeitar.click({ timeout: 5_000 }).catch(() => undefined);
      await respirar(page, 600);
    }

    // Clica na aba "Orçamentos de Conexão"
    const abaOrcamento = page.getByText(/OR[CÇ]AMENTOS DE CONEX[AÃ]O/i).first();
    if (await abaOrcamento.count() === 0) {
      throw new ErroLudmilla('pagina_mudou', 'Aba "Orçamentos de Conexão" não encontrada na tela Meus Projetos.');
    }
    await abaOrcamento.click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);

    // Clica em "Criar projeto"
    const btnCriar = page.getByRole('link', { name: /Criar projeto/i })
      .or(page.getByRole('button', { name: /Criar projeto/i }))
      .or(page.getByText(/Criar projeto/i));
    if (await btnCriar.first().count() === 0) {
      throw new ErroLudmilla('pagina_mudou', 'Botão "Criar projeto" não encontrado na aba Orçamentos de Conexão.');
    }
    await btnCriar.first().click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_500);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 1 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 1, 'introducao', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 1, 'introducao', 'ok');

  // ── Passo 2: Dados da UC ───────────────────────────────────────────────────
  await registrarPasso(page, dados, 2, 'dados_uc', 'rodando');
  let valorDisjuntorCpfl: string | null = null;
  let valorFaseCpfl: string | null = null;
  try {
    const campoUc = page.locator(
      'input[name*="uc"], input[placeholder*="UC"], input[id*="uc"], input[placeholder*="Nº"]'
    ).first();
    if (await campoUc.count() === 0) {
      throw new ErroLudmilla('pagina_mudou', 'Campo Nº da UC não encontrado no passo 2.');
    }
    await campoUc.fill(dados.uc_number);
    await respirar(page, 600);

    await page.getByRole('button', { name: /Buscar/i }).first().click({ timeout: 10_000 });

    // Aguarda auto-preenchimento: nome do titular aparece após o Buscar
    await comPaciencia('auto-preenchimento da UC pelo portal', async () => {
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
      await respirar(page, 1_500);
      const campoNome = page.locator(
        'input[name*="nome"], input[name*="name"], input[id*="nome"], input[id*="name"]'
      ).first();
      const val = await campoNome.inputValue().catch(() => '');
      if (!val.trim()) throw new Error('nome do cliente ainda vazio após Buscar');
    }, { tentativas: 2, pausaMs: 3_000 });

    // UC não encontrada = campo nome ainda vazio
    const campoNomeCheck = page.locator(
      'input[name*="nome"], input[name*="name"], input[id*="nome"], input[id*="name"]'
    ).first();
    const nomePreenchido = await campoNomeCheck.inputValue().catch(() => '');
    if (!nomePreenchido.trim()) {
      throw new ErroLudmilla('falhou',
        'UC não encontrada no portal CPFL. Verifique o número UC no GD Manager e tente novamente.');
    }

    // Lê disjuntor e fase retornados pela CPFL (fonte primária)
    const campoDisj = page.locator(
      'select[name*="disjuntor"], input[name*="disjuntor"], select[id*="disjuntor"]'
    ).first();
    if (await campoDisj.count() > 0) {
      valorDisjuntorCpfl = await campoDisj.inputValue().catch(() => null);
    }
    const campoFasePg = page.locator(
      'select[name*="fase"], select[id*="fase"], input[name*="fase"]'
    ).first();
    if (await campoFasePg.count() > 0) {
      valorFaseCpfl = await campoFasePg.inputValue().catch(() => null);
    }

    // Coordenadas em DMS
    const coords = parsearCoordenadas(dados.coordinates);
    if (coords) {
      const latDms = decimalParaDms(coords.lat, 'lat');
      const lngDms = decimalParaDms(coords.lng, 'lng');
      const campoLat = page.locator(
        'input[name*="lat"], input[id*="lat"], input[placeholder*="Latitude"]'
      ).first();
      const campoLng = page.locator(
        'input[name*="lon"], input[id*="lon"], input[id*="lng"], input[placeholder*="Longitude"]'
      ).first();
      if (await campoLat.count() > 0) { await campoLat.fill(latDms); await respirar(page, 400); }
      if (await campoLng.count() > 0) { await campoLng.fill(lngDms); await respirar(page, 400); }
    }

    await page.getByRole('button', { name: /Avançar/i }).first().click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 2 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 2, 'dados_uc', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 2, 'dados_uc', 'ok');

  // ── Passo 3: Dados do Projeto ──────────────────────────────────────────────
  await registrarPasso(page, dados, 3, 'dados_projeto', 'rodando');
  try {
    // Título
    const campoTitulo = page.locator(
      'input[name*="title"], input[name*="titulo"], input[id*="title"], input[id*="titulo"]'
    ).first();
    if (await campoTitulo.count() > 0) {
      await campoTitulo.fill(dados.project_title);
      await respirar(page, 400);
    }

    // Disjuntor: CPFL primeiro, fallback GD Manager
    const disjuntor = valorDisjuntorCpfl || dados.entry_breaker || '';
    if (disjuntor) {
      const campoD = page.locator(
        'select[name*="disjuntor"], input[name*="disjuntor"], select[id*="disjuntor"]'
      ).first();
      if (await campoD.count() > 0) {
        const tag = await campoD.evaluate((el: HTMLElement) => el.tagName.toLowerCase());
        if (tag === 'select') {
          await campoD.selectOption({ value: disjuntor }).catch(() => undefined);
        } else {
          await campoD.fill(disjuntor);
        }
        await respirar(page, 400);
      }
    }

    // Fase: CPFL primeiro, fallback GD Manager
    const fase = valorFaseCpfl || dados.entry_phase || '';
    if (fase) {
      const campoF = page.locator('select[name*="fase"], select[id*="fase"]').first();
      if (await campoF.count() > 0) {
        await campoF.selectOption({ value: fase }).catch(() => undefined);
        await respirar(page, 400);
      }
    }

    // Módulos (project_equipment tem 1 linha com qty + power)
    for (let i = 0; i < dados.modulos.length; i++) {
      const mod = dados.modulos[i];
      const campoQtd = page.locator(`input[name*="quantidade_${i}"], input[name*="qtd_${i}"]`).first();
      const campoPot = page.locator(`input[name*="potencia_${i}"], input[name*="pot_${i}"]`).first();
      if (await campoQtd.count() > 0) { await campoQtd.fill(String(mod.quantidade)); await respirar(page, 300); }
      if (await campoPot.count() > 0) { await campoPot.fill(String(mod.potencia_wp)); await respirar(page, 300); }
    }

    await page.getByRole('button', { name: /Avançar/i }).first().click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 3 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 3, 'dados_projeto', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 3, 'dados_projeto', 'ok');

  // ── Passo 4: Dados do Cliente ──────────────────────────────────────────────
  await registrarPasso(page, dados, 4, 'dados_cliente', 'rodando');
  try {
    const campoCpf = page.locator(
      'input[name*="cpf"], input[name*="documento"], input[id*="cpf"]'
    ).first();
    if (await campoCpf.count() > 0) {
      await campoCpf.fill(dados.customer_cpf);
      await respirar(page, 600);
    }

    const btnConsultar = page.getByRole('button', { name: /Consultar/i }).first();
    if (await btnConsultar.count() > 0) {
      await btnConsultar.click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 20_000 });
      await respirar(page, 1_000);
    }

    // Aceita termos
    const checkTermos = page.locator(
      'input[type="checkbox"][name*="termo"], input[type="checkbox"][id*="termo"]'
    ).first();
    if (await checkTermos.count() > 0 && !(await checkTermos.isChecked().catch(() => false))) {
      await checkTermos.check();
      await respirar(page, 400);
    }

    await page.getByRole('button', { name: /Avançar/i }).first().click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 4 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 4, 'dados_cliente', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 4, 'dados_cliente', 'ok');

  // ── Passo 5: Revisão — extrai node ID da URL ───────────────────────────────
  await registrarPasso(page, dados, 5, 'revisao', 'rodando');
  let nodeId: string;
  try {
    await page.getByRole('button', { name: /Avançar/i }).first().click({ timeout: 10_000 });

    // Aguarda URL com /node/{id}/edit — timeout total ~60 s via comPaciencia
    const regexNode = /\/node\/(\d+)\/edit/;
    await comPaciencia('aguardando node ID na URL após revisão', async () => {
      await page.waitForURL(url => regexNode.test(url.href), { timeout: 15_000 });
    }, { tentativas: 4, pausaMs: 2_000 });

    const match = regexNode.exec(page.url());
    if (!match) {
      throw new ErroLudmilla('pagina_mudou',
        `URL após revisão não contém node ID: ${page.url()}`);
    }
    nodeId = match[1];

    const { error } = await supabase().rpc('ludmilla_salvar_node_cpfl' as never, {
      p_project_id: dados.project_id,
      p_node_id:    nodeId,
    } as never);
    if (error) throw new Error(`ludmilla_salvar_node_cpfl: ${error.message}`);

    await respirar(page, 800);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 5 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 5, 'revisao', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 5, 'revisao', 'ok');

  // ── Passo 6: Concluído — clica "Enviar Depois" ────────────────────────────
  // Upload de documentos está fora do escopo desta fase; apenas fecha o formulário.
  await registrarPasso(page, dados, 6, 'concluido', 'rodando');
  try {
    const btnDepois = page.getByRole('button', { name: /Enviar Depois|Salvar|Later/i }).first();
    if (await btnDepois.count() > 0) {
      await btnDepois.click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    }
    await respirar(page, 1_000);
  } catch {
    // Passo de fechamento: falha não é bloqueante
  }
  await registrarPasso(page, dados, 6, 'concluido', 'ok');
}
