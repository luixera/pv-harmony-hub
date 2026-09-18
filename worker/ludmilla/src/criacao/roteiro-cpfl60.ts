import { ErroLudmilla } from '../erros.js';
import { decimalParaDms, parsearCoordenadas } from '../dms.js';
import type { Agente } from './agente.js';
import { AUTONOMIA_PADRAO, PERGUNTAS_CONDICIONAIS, type DadosCriacaoCpfl } from './tipos.js';
import {
  JS_ERROS_VISIVEIS, jsAbrirSanfona, jsFormData, jsMarcarRadio, jsPerguntaVisivel, jsSetValor, jsValor, jsVisivel,
} from './js.js';
import { areaArranjos, camposFaltando, dataMais, errosDoHtml, extrairNodeId, numero, pessoaFisica, simNao, valorFases } from './util.js';

/**
 * Roteiro "60 - Microgeração Distribuída BT · Orçamento de Conexão" — escrito
 * sobre a tela real (docs/superpowers/specs/2026-09-17-cpfl60-criacao-design.md).
 * Pressupõe sessão já logada no portal. Cada etapa: agir → conferir pelo
 * FormData/título → só então avançar. Para em "Envio de documentos".
 */

export type NomePasso = 'login' | 'introducao' | 'dados_uc' | 'dados_projeto' | 'dados_cliente' | 'revisao' | 'concluido' | 'simulado';
export type StatusPasso = 'rodando' | 'ok' | 'erro';

export interface ContextoRoteiro {
  agente: Agente;
  dados: DadosCriacaoCpfl;
  /** grava o passo (print, mapa em erro) — implementado pelo worker ou pela validação local */
  registrar: (passo: number, nome: NomePasso, status: StatusPasso, erro?: string) => Promise<void>;
  /** true = para antes do Salvar (validação sem criar projeto) */
  simular: boolean;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ResultadoRoteiro {
  nodeId: string | null;
  simulado: boolean;
  /** o que a UC e o CPF devolveram (auditoria; nunca sai do bucket/banco) */
  leituras: Record<string, string>;
}

const URL_CRIAR_PROJETO = 'https://www.cpfl.com.br/gestao-projetos/criar-projeto';
const GERACAO = '#edit-field-complementary-generation-0-subform-field-';

// ── primitivas do roteiro ────────────────────────────────────────────────────

async function esperarTitulo(ag: Agente, etapa: RegExp, oQue: string, tentativas = 10): Promise<string> {
  let titulo = '';
  for (let i = 0; i < tentativas; i++) {
    titulo = await ag.titulo();
    if (etapa.test(titulo)) return titulo;
    await ag.esperar(1_500);
  }
  throw new ErroLudmilla('pagina_mudou', `${oQue}: esperava a tela ${etapa.source}, a aba está em "${titulo}".`);
}

/** Define valor por JS (+ eventos) e confere que ficou. */
async function definir(ag: Agente, seletor: string, valor: string, oQue: string, o: { obrigatorio?: boolean } = {}): Promise<boolean> {
  const r = await ag.js<string | null | { erro: string; opcoes: string[] }>(jsSetValor(seletor, valor));
  if (r === null) {
    if (o.obrigatorio ?? true) throw new ErroLudmilla('pagina_mudou', `Campo "${oQue}" (${seletor}) não está na tela.`);
    return false;
  }
  if (typeof r === 'object' && r && 'erro' in r) {
    throw new ErroLudmilla('pagina_mudou', `Em "${oQue}" não existe a opção "${valor}". Opções: ${r.opcoes.join(' | ').slice(0, 300)}.`);
  }
  return true;
}

/** Marca o radio e confere o RÓTULO (Sim/Não trocam de código entre perguntas). */
async function marcar(ag: Agente, seletor: string, rotulo: RegExp, oQue: string): Promise<void> {
  const r = await ag.js<{ marcado: boolean; rotulo: string } | null>(jsMarcarRadio(seletor));
  if (!r) throw new ErroLudmilla('pagina_mudou', `A opção "${oQue}" (${seletor}) não está na tela — o portal mudou este bloco.`);
  if (!rotulo.test(r.rotulo)) {
    throw new ErroLudmilla('pagina_mudou', `Em "${oQue}", ${seletor} tem o rótulo "${r.rotulo}" e o roteiro esperava ${rotulo.source} — o portal trocou os códigos; roteiro precisa de ajuste.`);
  }
  if (!r.marcado) throw new ErroLudmilla('pagina_mudou', `Cliquei em "${oQue}" (${r.rotulo}) mas o radio não ficou marcado.`);
}

async function abrirSanfona(ag: Agente, texto: string): Promise<void> {
  const r = await ag.js<string>(jsAbrirSanfona(texto));
  if (r === 'abri') await ag.esperar(700);
}

async function valor(ag: Agente, seletor: string): Promise<string> {
  return String((await ag.js<string | null>(jsValor(seletor))) ?? '');
}

/** Espera um campo (cinza) ganhar valor — o que o Buscar/Consultar preenche. */
async function esperarValor(ag: Agente, seletor: string, segundos: number): Promise<string> {
  const ate = Date.now() + segundos * 1_000;
  while (Date.now() < ate) {
    const v = await valor(ag, seletor);
    if (v.trim()) return v;
    await ag.esperar(1_000);
  }
  return '';
}

/** Clica em Avançar e exige a próxima etapa; se não avançou, diz QUAL campo o servidor recusou. */
async function avancar(ag: Agente, proxima: RegExp, ctx: ContextoRoteiro): Promise<void> {
  await ag.limparRede();
  await ag.clicar('#edit-next');
  await ag.esperarCarga('load');
  await ag.esperar(3_000);
  try {
    await esperarTitulo(ag, proxima, 'Depois de Avançar', 6);
  } catch (e) {
    const visiveis = await ag.js<{ mensagens: string[]; campos: string[] }>(JS_ERROS_VISIVEIS).catch(() => ({ mensagens: [], campos: [] }));
    const html = await ag.ultimoPostHtml().catch(() => '');
    const doHtml = html ? errosDoHtml(html) : { campos: [], mensagens: [] };
    const campos = [...new Set([...visiveis.campos, ...doHtml.campos])];
    const mensagens = [...new Set([...visiveis.mensagens, ...doHtml.mensagens])];
    ctx.log('avançar recusado', { campos, mensagens });
    throw new ErroLudmilla('pagina_mudou',
      `${(e as Error).message} O portal recusou: ${campos.length ? 'campos ' + campos.join(', ') : 'sem campo apontado'}${mensagens.length ? ' — ' + mensagens.join(' | ') : ''}.`);
  }
  // o portal dispara um "Calcular" por AJAX ao carregar a etapa — deixa aquietar
  await ag.esperarCarga('networkidle');
  await ag.esperar(1_000);
}

async function passo(ctx: ContextoRoteiro, n: number, nome: NomePasso, corpo: () => Promise<void>): Promise<void> {
  await ctx.registrar(n, nome, 'rodando');
  try {
    await corpo();
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo ${n} (${nome}) falhou: ${(e as Error).message.split('\n')[0].slice(0, 300)}`;
    await ctx.registrar(n, nome, 'erro', msg).catch(() => undefined);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await ctx.registrar(n, nome, 'ok');
}

// ── o roteiro ────────────────────────────────────────────────────────────────

export async function roteiroCpfl60(ctx: ContextoRoteiro): Promise<ResultadoRoteiro> {
  const { agente: ag, dados } = ctx;
  const a = (k: string) => dados.autonomia[k] ?? AUTONOMIA_PADRAO[k] ?? '';
  const leituras: Record<string, string> = {};
  const dataPrevista = dataMais(Number(a('dias_para_ligacao')) || 30);
  const fases = valorFases(dados.padrao?.num_fases, dados.entry_phase);

  // ── 1. Introdução: formulário NOVO pelo menu, escolher "Conexão de microgeração"
  await passo(ctx, 1, 'introducao', async () => {
    // Nunca abrir node/add/project_60 direto: o Drupal retoma o formulário velho da sessão.
    await ag.abrir(URL_CRIAR_PROJETO);
    await ag.esperarCarga('load');
    await esperarTitulo(ag, /Criar Projeto/i, 'Ao abrir Criar projeto');
    await ag.clicar('a[href$="node/add/project_60"]');
    await ag.esperarCarga('load');
    await esperarTitulo(ag, /Introdu[cç][aã]o/i, 'Ao abrir o projeto 60');

    // #edit-next = "Ligação nova com microgeração"; #edit-next-new-connection = "Conexão de microgeração"
    const botaoConexao = (await ag.js<boolean>(jsVisivel('#edit-next-new-connection'))) ? '#edit-next-new-connection' : '#edit-next';
    await ag.clicar(botaoConexao);
    await ag.esperarCarga('load');
    await esperarTitulo(ag, /Dados da unidade consumidora/i, 'Depois de Iniciar');

    // prova de que foi o card certo: tipo de fluxo = conexão
    const fluxo = await ag.js<{ marcado: boolean; rotulo: string } | null>(jsMarcarRadio('#edit-field-flux-type-conexo'));
    if (!fluxo?.marcado) throw new ErroLudmilla('pagina_mudou', 'Depois de Iniciar, o tipo de fluxo não ficou em "conexão" — o card clicado foi o errado.');
  });

  // ── 2. Dados da unidade consumidora
  await passo(ctx, 2, 'dados_uc', async () => {
    const estimado = a('opcao_orcamento') === 'estimado';
    await marcar(ag, estimado ? '#edit-field-quotation-options-60-estimated' : '#edit-field-quotation-options-60-connection',
      estimado ? /^Orçamento Estimado/i : /^Orçamento de Conexão/i, 'opção de orçamento');

    await abrirSanfona(ag, 'Necessidades do projeto');
    // nesta etapa "-0" é Não — o rótulo confere
    await marcar(ag, `#edit-field-multiple-energy-meter-${a('mais_de_um_medidor') === 'sim' ? 1 : 0}`, simNao(a('mais_de_um_medidor')), 'mais de 1 medidor');
    await marcar(ag, `#edit-field-entrance-underground-${a('ramal_subterraneo') === 'sim' ? 1 : 0}`, simNao(a('ramal_subterraneo')), 'ramal subterrâneo');
    await marcar(ag, `#edit-field-measurement-fix-pole-${a('medicao_no_poste') === 'sim' ? 1 : 0}`, simNao(a('medicao_no_poste')), 'medição no poste');

    await abrirSanfona(ag, 'Insira os dados do local da unidade consumidora');
    await definir(ag, '#edit-field-consumer-unit-0-consumer-unit-code', dados.uc_number, 'Nº da UC');
    await ag.clicar('#edit-field-consumer-unit-0-send-uc-code');
    // depois do Buscar os ids ganham sufixo: só prefixo daqui em diante
    let nome = await esperarValor(ag, '[id^="edit-field-consumer-unit-0-customer-name"]', 12);
    if (!nome) {
      ctx.log('UC sem retorno no 1º Buscar — tentando de novo');
      await ag.clicar('[id^="edit-field-consumer-unit-0-send-uc-code"]');
      nome = await esperarValor(ag, '[id^="edit-field-consumer-unit-0-customer-name"]', 12);
    }
    if (!nome) throw new ErroLudmilla('falhou', `O portal não encontrou a UC ${dados.uc_number}. Confira o número no GD Manager e tente de novo.`);

    for (const [chave, id] of Object.entries({
      empresa: 'uc-company-name', classe: 'uc-class', faseamento: 'phasing', categoria_cadastrada: 'registered-category',
      tensao: 'uc-voltage', carga_atual: 'uc-charge', demanda_atual: 'uc-current-load-demand', possui_gd: 'distributed-generation',
    })) leituras[chave] = await valor(ag, `[id^="edit-field-consumer-unit-0-${id}"]`);
    ctx.log('UC encontrada', { ...leituras });
    if (leituras.empresa && !/cpfl/i.test(leituras.empresa)) {
      throw new ErroLudmilla('falhou', `A UC ${dados.uc_number} é de outra distribuidora ("${leituras.empresa}"), não da CPFL.`);
    }

    const coords = parsearCoordenadas(dados.coordinates);
    if (!coords) throw new ErroLudmilla('falhou', 'O projeto está sem coordenadas no GD Manager — o portal exige Latitude e Longitude.');
    await definir(ag, '[id^="edit-field-consumer-unit-0-latitude"]', decimalParaDms(coords.lat, 'lat'), 'Latitude');
    await definir(ag, '[id^="edit-field-consumer-unit-0-longitude"]', decimalParaDms(coords.lng, 'lng'), 'Longitude');

    // aqui "-1" é Não (invertido em relação às perguntas de cima) — o rótulo confere
    await marcar(ag, `#edit-field-have-position-change-${a('mudanca_ponto_entrega') === 'sim' ? 0 : 1}`, simNao(a('mudanca_ponto_entrega')), 'mudança no ponto de entrega');
    await marcar(ag, `#edit-field-necessitie-extension-fase-${a('extensao_fase') === 'sim' ? 0 : 1}`, simNao(a('extensao_fase')), 'extensão de fase');

    // perguntas que só aparecem às vezes: responde se a autonomia souber; senão para e pergunta
    if (await ag.js<boolean>(jsPerguntaVisivel('Já possui projeto aprovado'))) {
      const r = a('ja_possui_projeto_aprovado');
      if (!r) throw new ErroLudmilla('pagina_mudou', `O portal perguntou "${PERGUNTAS_CONDICIONAIS.ja_possui_projeto_aprovado}" e o roteiro não tem resposta. Informe autonomia.ja_possui_projeto_aprovado = sim | nao.`);
      await marcar(ag, `#edit-field-approved-project-${r === 'sim' ? 1 : 0}`, simNao(r), PERGUNTAS_CONDICIONAIS.ja_possui_projeto_aprovado);
    }
    if (await ag.js<boolean>(jsPerguntaVisivel('Medidor do Vizinho'))) {
      throw new ErroLudmilla('pagina_mudou', `O portal perguntou "${PERGUNTAS_CONDICIONAIS.uc_medidor_vizinho}" — isso não está no roteiro; precisa de uma pessoa.`);
    }

    const fd = await ag.js<Record<string, string | null>>(jsFormData([
      'field_quotation_options_60', 'field_multiple_energy_meter', 'field_entrance_underground', 'field_measurement_fix_pole',
      'field_consumer_unit[0][consumer_unit_code]', 'field_consumer_unit[0][customer_name]',
      'field_consumer_unit[0][latitude]', 'field_consumer_unit[0][longitude]',
      'field_have_position_change', 'field_necessitie_extension_fase',
    ]));
    const faltando = Object.entries(fd).filter(([, v]) => v === null || v === '').map(([k]) => k);
    if (faltando.length) throw new ErroLudmilla('pagina_mudou', `Antes de avançar, o formulário está sem: ${faltando.join(', ')}.`);
    await avancar(ag, /Dados do projeto/i, ctx);
  });

  // ── 3. Dados do projeto
  await passo(ctx, 3, 'dados_projeto', async () => {
    const titulo = dados.project_title || `UFV ${dados.customer_name}`;
    const p = dados.padrao;
    const m = dados.modulo;
    const inv = dados.inversor;
    if (!m?.quantidade || !m.potencia_wp) throw new ErroLudmilla('falhou', 'O projeto está sem módulos (quantidade e potência) no GD Manager — o portal exige.');
    if (!inv?.quantidade || !inv.potencia_kw) throw new ErroLudmilla('falhou', 'O projeto está sem inversores (quantidade e potência) no GD Manager — o portal exige.');

    await abrirSanfona(ag, 'Dados do projeto');
    await definir(ag, '#edit-title-0-value', titulo, 'Título do Projeto');
    await marcar(ag, `#edit-field-consume-alteration-${a('alteracao_carga') === 'sim' ? 1 : 0}`, simNao(a('alteracao_carga')), 'alteração de carga de consumo');
    await definir(ag, '#edit-field-generating-source', a('fonte_geradora'), 'Fonte geradora');
    await definir(ag, '#edit-field-line-connection-date-0-value-date', dataPrevista, 'Data prevista para ligação');
    await definir(ag, '#edit-field-compensation-system', a('sistema_compensacao'), 'Sistema de Compensação');

    await abrirSanfona(ag, 'Categorias do projeto');
    if (!p?.categoria) throw new ErroLudmilla('falhou', 'Não há categoria do padrão de entrada para este projeto (regras da CPFL no GD Manager).');
    await definir(ag, '#edit-field-exists-category', p.categoria, 'Categoria Existente');

    await abrirSanfona(ag, 'Dados complementares de geração');
    await definir(ag, '#edit-field-power-plant-name-0-value', titulo, 'Nome da usina');
    await marcar(ag, `#edit-field-grant-or-registration-${a('outorga_registro') === 'sim' ? 1 : 0}`, simNao(a('outorga_registro')), 'Outorga ou Registro');
    await definir(ag, '#edit-field-input-standard', a('padrao_entrada'), 'Padrão de entrada');
    await definir(ag, '#edit-field-service-type', a('tipo_atendimento'), 'Tipo de atendimento');
    await definir(ag, '#edit-field-phase-number', fases.select, 'Número de Fases da UC');
    // "Cabos" é a QUANTIDADE de fases (regra do usuário, 17/09/2026), não a bitola
    await definir(ag, '#edit-field-cabless-0-value', String(p.num_fases ?? (fases.select === '2756' ? 3 : fases.select === '2746' ? 1 : 2)), 'Cabos');
    if (p.caixa) await definir(ag, '#edit-field-cx-electrical-0-value', p.caixa, 'Caixa de medição');
    const carga = a('carga_instalada_kw') || p.demanda_kw || '';
    if (carga) await definir(ag, '#edit-field-load-installed-0-value', carga.replace(',', '.'), 'Carga instalada (kW)');
    const disjuntor = a('disjuntor_a') || (p.disjuntor ? String(p.disjuntor) : (dados.entry_breaker ?? '').replace(/\D/g, ''));
    if (disjuntor) await definir(ag, '#edit-field-circuit-breaker-a-0-value', disjuntor, 'Disjuntor (A)');

    // bloco de geração: a fonte revela os campos de módulos/inversores
    await definir(ag, `${GERACAO}generating-source`, a('fonte_geradora_geracao'), 'Fonte geradora (geração)');
    await ag.esperar(1_500);
    await definir(ag, `${GERACAO}generate-installation-date-0-value-date`, dataPrevista, 'Data prevista para entrada em operação');
    const preencherGeracao = async () => {
      await definir(ag, `${GERACAO}modules-0-modules-qt`, String(m.quantidade), 'Quantidade de módulos');
      await definir(ag, `${GERACAO}modules-0-module-manufacturer`, m.fabricante || '-', 'Fabricante dos módulos');
      await definir(ag, `${GERACAO}modules-0-module-model`, m.modelo || '-', 'Modelo dos módulos');
      await definir(ag, `${GERACAO}modules-0-modules-power-peak`, numero(m.potencia_wp / 1000), 'Potência de pico do módulo (kWp)');
      await definir(ag, `${GERACAO}generation-arr-occup-area-0-value`, a('area_arranjos_m2') || areaArranjos(m.quantidade, Number(a('m2_por_modulo')) || 3), 'Área ocupada pelos arranjos (m²)');
      await definir(ag, `${GERACAO}inverters-0-inverter-quantity`, String(inv.quantidade), 'Quantidade de inversores');
      await definir(ag, `${GERACAO}inverters-0-inverter-manufacturer`, inv.fabricante || '-', 'Fabricante dos inversores');
      await definir(ag, `${GERACAO}inverters-0-inverter-model`, inv.modelo || '-', 'Modelo dos inversores');
      await definir(ag, `${GERACAO}inverters-0-inverter-connection`, fases.texto, 'Conexão do Inversor');
      await definir(ag, `${GERACAO}inverters-0-inverter-rated-power`, numero(inv.potencia_kw), 'Potência nominal do inversor (kW)');
      await ag.esperar(1_000);
    };
    await preencherGeracao();

    // A tela mente, o POST não: os totais calculados têm de estar no FormData.
    const G = 'field_complementary_generation[0][subform]';
    const chaves = [
      `${G}[field_modules][0][modules_qt]`, `${G}[field_modules][0][modules_power_peak]`, `${G}[field_modules][0][modules_total_row]`,
      `${G}[field_generation_power_peak][0][value]`, `${G}[field_generation_arr_occup_area][0][value]`,
      `${G}[field_inverters][0][inverter_quantity]`, `${G}[field_inverters][0][inverter_rated_power]`, `${G}[field_inverters][0][inverter_total_row]`,
      `${G}[field_inverters_rated_power][0][value]`, `${G}[field_total_gene_nominal_power][0][value]`,
      'field_generator_installed_power[0][value]', 'field_line_connection_date[0][value][date]',
      `${G}[field_generate_installation_date][0][value][date]`, 'field_exists_category', 'title[0][value]',
    ];
    let fd = await ag.js<Record<string, string | null>>(jsFormData(chaves));
    let faltando = camposFaltando(fd, chaves);
    if (faltando.length) {
      ctx.log('totais vazios — repetindo o bloco de geração', { faltando });
      await preencherGeracao();
      fd = await ag.js<Record<string, string | null>>(jsFormData(chaves));
      faltando = camposFaltando(fd, chaves);
    }
    ctx.log('FormData da etapa 2', { totais: { modulos: fd[`${G}[field_modules][0][modules_total_row]`], inversores: fd[`${G}[field_inverters][0][inverter_total_row]`], instalada: fd['field_generator_installed_power[0][value]'] } });
    if (faltando.length) {
      throw new ErroLudmilla('pagina_mudou', `O formulário ficou com campos vazios que o portal exige: ${faltando.map(k => k.replace(/^field_complementary_generation\[0\]\[subform\]/, '…')).join(', ')}.`);
    }
    await avancar(ag, /Dados do cliente/i, ctx);
  });

  // ── 4. Dados do cliente
  await passo(ctx, 4, 'dados_cliente', async () => {
    if (!pessoaFisica(dados.customer_cpf)) {
      throw new ErroLudmilla('falhou', 'Titular Pessoa Jurídica (CNPJ): o bloco de PJ do portal ainda não está no roteiro — precisa de uma pessoa.');
    }
    await marcar(ag, '#edit-field-natural-juridical-person-fisica', /^Pessoa F[ií]sica/i, 'Tipo de pessoa');
    const cpfNaTela = (await valor(ag, '[id^="edit-field-physicalperson-0-cpf"]')).replace(/\D/g, '');
    if (!cpfNaTela) await definir(ag, '[id^="edit-field-physicalperson-0-cpf"]', dados.customer_cpf.replace(/\D/g, ''), 'CPF');

    await ag.clicar('[id^="edit-field-physicalperson-0-send-physical-person"]');
    const nome = await esperarValor(ag, '[id^="edit-field-physicalperson-0-name"]', 12);
    if (!nome) throw new ErroLudmilla('falhou', 'O Consultar do CPF não trouxe o titular. Confira o CPF no GD Manager.');
    leituras.cliente_nome = nome;
    leituras.cliente_nascimento = await valor(ag, '[id^="edit-field-physicalperson-0-birth-date"]');

    // contato vem do cadastro da CPFL: só completa o que faltar, nunca sobrescreve
    if (!(await valor(ag, '[id^="edit-field-physicalperson-0-cell"]')).trim()) {
      const cel = dados.customer_phone.replace(/\D/g, '');
      if (!cel) throw new ErroLudmilla('falhou', 'O portal exige o celular do cliente e o projeto está sem telefone no GD Manager.');
      await definir(ag, '[id^="edit-field-physicalperson-0-cell"]', cel, 'Celular');
    }
    if (!(await valor(ag, '[id^="edit-field-physicalperson-0-email"]')).trim()) {
      if (!dados.customer_email) throw new ErroLudmilla('falhou', 'O portal exige o e-mail do cliente e o projeto está sem e-mail no GD Manager.');
      await definir(ag, '[id^="edit-field-physicalperson-0-email"]', dados.customer_email, 'E-mail');
    }

    await marcar(ag, '[id^="edit-field-address-type-mesmo"]', /^Endereço da instala/i, 'Endereço para correspondências');
    await ag.esperar(800);
    await marcar(ag, '[id^="edit-field-customer-address-type-mesmo"]', /^Endereço de instala/i, 'Endereço do cliente');
    // nesta etapa "-1" é Sim — o rótulo confere
    await marcar(ag, `[id^="edit-field-authorize-pay-connec-costs-${a('autoriza_documentos') === 'nao' ? 0 : 1}"]`, simNao(a('autoriza_documentos')), 'autoriza entrega dos contratos com o orçamento');
    await marcar(ag, `[id^="edit-field-solicitacao-de-vistoria-${a('contagem_prazo_vistoria') === 'nao' ? 0 : 1}"]`, simNao(a('contagem_prazo_vistoria')), 'contagem do prazo da vistoria');

    await avancar(ag, /Revisão do projeto/i, ctx);
  });

  // ── 5. Revisão → Salvar (o print do "rodando" é a revisão inteira)
  let nodeId: string | null = null;
  await passo(ctx, 5, 'revisao', async () => {
    if (ctx.simular) { ctx.log('simulação: parando antes do Salvar'); return; }
    await ag.limparRede();
    await ag.clicar('#edit-next-save-draft');
    await ag.esperarCarga('load');
    const ate = Date.now() + 40_000;
    while (Date.now() < ate && !nodeId) {
      nodeId = extrairNodeId(await ag.url());
      if (!nodeId) await ag.esperar(1_500);
    }
    if (!nodeId) {
      const html = await ag.ultimoPostHtml().catch(() => '');
      const e = html ? errosDoHtml(html) : { campos: [], mensagens: [] };
      throw new ErroLudmilla('pagina_mudou', `Depois de Salvar a URL não trouxe o número do projeto (${await ag.url()}).${e.campos.length ? ' Campos recusados: ' + e.campos.join(', ') : ''}${e.mensagens.length ? ' — ' + e.mensagens.join(' | ') : ''}`);
    }
    ctx.log('projeto criado', { node: nodeId });
  });

  if (ctx.simular) {
    // passo final próprio: o painel sabe que acabou e que nada foi salvo
    await passo(ctx, 6, 'simulado', async () => { await ag.esperar(300); });
    return { nodeId: null, simulado: true, leituras };
  }

  // ── 6. Envio de documentos: a Ludmilla PARA aqui (decisão da pessoa)
  await passo(ctx, 6, 'concluido', async () => {
    await ag.esperarCarga('networkidle');
    await ag.esperar(1_500);
  });
  return { nodeId, simulado: false, leituras };
}
