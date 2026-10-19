// worker/ludmilla/test/parecer-enel.test.ts
// Task 4: a edge function `ludmilla-parecer` ganha o MODO ENEL (aditivo).
//
// Mesma técnica de `parecer-marcadores.test.ts`: o ARQUIVO REAL da função é
// transpilado e roda com um `Deno`, um `createClient` e um `fetch` de mentira. A
// IA "responde" o texto que o caso define; o que se afirma é (a) o texto que a
// função MANDA para a Anthropic (capturado no `fetch` falso) e (b) o JSON que ela
// devolve ao robô.
//
// Duas garantias convivem aqui:
//  · modo ENEL (`concessionaria: 'enel'`): prompt próprio da Nota Técnica e a
//    resposta ganha `tipo`, `nt` e `uc`, lidos do documento;
//  · modo EDP (sem `concessionaria`): a função está em PRODUÇÃO para a EDP e tem
//    de ficar EXATAMENTE como era — o mesmo prompt, as mesmas seis chaves na
//    resposta. Os testes "EDP:" travam isso com o texto de antes, por extenso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const FONTE = new URL('../../../../supabase/functions/ludmilla-parecer/index.ts', import.meta.url);
const TENANT = '44444444-4444-4444-8444-444444444444';
const PROTOCOLO = '45006443920';

type Handler = (req: Request) => Promise<Response>;
interface Resposta {
  ok: boolean; error?: string; veredito: string; resumo: string; pendencias: string[];
  titular: string | null; endereco: string | null;
  tipo?: string | null; nt?: string | null; uc?: string | null;
}
interface Cenario {
  /** o que a IA "escreve" (vira o texto do bloco de resposta) */
  textoDaIA?: string;
  /** status HTTP da Anthropic (padrão 200) */
  statusDaIA?: number;
  /** corpo CRU da Anthropic, no lugar do JSON padrão */
  corpoDaIA?: string;
  /** a cota do plano do tenant recusa a leitura */
  cotaNegada?: boolean;
  /** a rede cai: o `fetch` para a Anthropic lança */
  derruba?: boolean;
}
/** Uma coisa que a função fez fora dela: RPC, delete no extrato ou chamada à Anthropic. */
type Registro = Record<string, unknown>;

/**
 * Carrega a função real; devolve o handler, tudo que ela mandou à Anthropic e o
 * RASTRO, em ordem, do que fez fora dela (reservou a cota, chamou a IA, lançou os
 * tokens, desfez a reserva).
 */
function carregar(c: Cenario = {}): { handler: Handler; enviadosAIA: string[]; rastro: Registro[] } {
  const fonte = readFileSync(FONTE, 'utf8').replace(/^import .*createClient.*$/m, '');
  const js = ts.transpileModule(fonte, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;

  let handler: Handler | null = null;
  const enviadosAIA: string[] = [];
  const rastro: Registro[] = [];
  const env: Record<string, string> = {
    SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico', ANTHROPIC_API_KEY: 'chave-da-ia', SUPABASE_URL: 'http://localhost',
  };
  const Deno = { env: { get: (k: string) => env[k] }, serve: (h: Handler) => { handler = h; } };
  const createClient = () => ({
    rpc: async (nome: string, args: unknown) => {
      rastro.push({ tipo: 'rpc', nome, args });
      if (nome !== 'consume_ai_quota_servidor') return { data: true, error: null };
      return c.cotaNegada
        ? { data: { allowed: false, reason: 'sem_saldo' }, error: null }
        : { data: { allowed: true, log_id: 'linha-1' }, error: null };
    },
    // `desfazerReserva` (IA que falhou) apaga a reserva do extrato: delete().eq().eq().is()
    from: (tabela: string) => ({
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => ({
            is: async (c3: string, v3: unknown) => {
              rastro.push({ tipo: 'delete', tabela, filtros: [[c1, v1], [c2, v2], [c3, v3]] });
              return { error: null };
            },
          }),
        }),
      }),
    }),
  });
  const fetchFalso = async (url: string, init: { method?: string; headers?: unknown; body?: unknown }) => {
    enviadosAIA.push(String(init.body));
    rastro.push({ tipo: 'fetch', url, metodo: init.method, cabecalhos: init.headers, corpo: String(init.body) });
    if (c.derruba) throw new Error('rede caiu');
    const status = c.statusDaIA ?? 200;
    if (c.corpoDaIA !== undefined) return new Response(c.corpoDaIA, { status });
    return new Response(JSON.stringify({
      stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: 'text', text: c.textoDaIA ?? '{}' }],
    }), { status });
  };
  const consoleMudo = { ...console, error: () => undefined };

  new Function('Deno', 'createClient', 'fetch', 'console', js)(Deno, createClient, fetchFalso, consoleMudo);
  assert.ok(handler, 'a função deveria ter registrado o handler em Deno.serve');
  return { handler: handler as Handler, enviadosAIA, rastro };
}

/** Uma chamada ao handler com o corpo CRU (pode ser lixo). `credencial: null` = sem cabeçalho nenhum. */
async function chamarCru(c: Cenario, corpoCru: string, credencial: string | null = 'chave-de-servico') {
  const { handler, enviadosAIA, rastro } = carregar(c);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (credencial) headers.authorization = `Bearer ${credencial}`;
  const r = await handler(new Request('http://localhost/functions/v1/ludmilla-parecer', {
    method: 'POST', headers, body: corpoCru,
  }));
  return { r, enviadosAIA, rastro };
}

/** Uma chamada ao handler real, com o corpo de sempre + o que o caso acrescenta. */
const chamar = (c: Cenario, corpo: Record<string, unknown>, credencial: string | null = 'chave-de-servico') =>
  chamarCru(c, JSON.stringify({ pdf_base64: 'A'.repeat(400), protocolo: PROTOCOLO, tenant_id: TENANT, ...corpo }), credencial);

/**
 * O que a chamada GASTOU, sem o texto do prompt (que difere entre os modos de
 * propósito): a chamada à Anthropic (modelo, max_tokens, cabeçalhos, estrutura e
 * PDF) e todas as RPCs/deletes do extrato de IA, em ordem.
 */
function gastoDe(rastro: Registro[]): Registro[] {
  type Corpo = {
    model: string; max_tokens: number;
    messages: { role: string; content: { type: string; source?: unknown }[] }[];
  };
  return rastro.map((e) => {
    if (e.tipo !== 'fetch') return e;
    const corpo = JSON.parse(String(e.corpo)) as Corpo;
    return {
      tipo: 'fetch', url: e.url, metodo: e.metodo, cabecalhos: e.cabecalhos,
      model: corpo.model, max_tokens: corpo.max_tokens,
      mensagens: corpo.messages.map((m) => ({
        role: m.role, partes: m.content.map((p) => (p.type === 'text' ? { type: 'text' } : p)),
      })),
    };
  });
}

/** A IA devolve este JSON; o robô recebe o que a função faz dele. */
async function ler(daIA: Record<string, unknown>, corpo: Record<string, unknown> = {}): Promise<Resposta> {
  const textoDaIA = JSON.stringify({ veredito: 'favoravel', resumo: 'Carta de aprovação.', pendencias: [], ...daIA });
  const { r } = await chamar({ textoDaIA }, corpo);
  assert.equal(r.status, 200);
  return await r.json() as Resposta;
}
const lerEnel = (daIA: Record<string, unknown>) => ler(daIA, { concessionaria: 'enel' });

/** O texto do prompt que seguiu para a Anthropic. */
function promptEnviado(enviadosAIA: string[]): string {
  assert.equal(enviadosAIA.length, 1, 'uma única chamada à IA');
  const corpo = JSON.parse(enviadosAIA[0]) as { messages: { content: { type: string; text?: string }[] }[] };
  const bloco = corpo.messages[0].content.find((x) => x.type === 'text');
  assert.ok(bloco?.text, 'o prompt de texto deveria ter sido enviado');
  return bloco.text;
}
async function promptDo(corpo: Record<string, unknown>): Promise<string> {
  const { enviadosAIA } = await chamar({ textoDaIA: '{"veredito":"favoravel"}' }, corpo);
  return promptEnviado(enviadosAIA);
}

/** O prompt da EDP exatamente como estava ANTES do modo ENEL (protocolo do teste). */
const PROMPT_EDP_DE_ANTES = [
  'Você está lendo um PARECER DE ACESSO da distribuidora EDP para um projeto de geração distribuída.',
  `Protocolo/nota esperado: ${PROTOCOLO}.`,
  '',
  'Responda SOMENTE com um JSON, sem texto em volta, neste formato:',
  '{"veredito":"favoravel|pendencia|inconclusivo","resumo":"uma frase em português",',
  ' "pendencias":["..."],"titular":"nome do titular ou null","endereco":"logradouro e número ou null"}',
  '',
  '- "favoravel": o parecer aprova a conexão (ainda que com condições técnicas normais).',
  '- "pendencia": o parecer pede correção, complementação ou indefere.',
  '- "inconclusivo": não dá para afirmar pelo documento.',
].join('\n');

const SEIS_CHAVES = ['endereco', 'ok', 'pendencias', 'resumo', 'titular', 'veredito'];
const NOVE_CHAVES = [...SEIS_CHAVES, 'nt', 'tipo', 'uc'].sort();

// ── 1. o prompt de cada modo ─────────────────────────────────────────────────

test('ENEL: o texto enviado à Anthropic pede a Nota Técnica; o da EDP não', async () => {
  const enel = await promptDo({ concessionaria: 'enel' });
  assert.ok(enel.includes('Nota Técnica'), 'o prompt da ENEL deveria falar da Nota Técnica');
  assert.ok(!enel.includes('Protocolo/nota esperado'), 'o prompt da ENEL não é o da EDP');

  const edp = await promptDo({});
  assert.ok(!edp.includes('Nota Técnica'), 'o prompt da EDP não fala de Nota Técnica');
  assert.ok(edp.includes('Protocolo/nota esperado'), 'o trecho que o prompt da EDP já tem hoje');
});

test('EDP: o prompt é EXATAMENTE o de antes (por extenso), com ou sem `concessionaria` explícita', async () => {
  assert.equal(await promptDo({}), PROMPT_EDP_DE_ANTES);
  assert.equal(await promptDo({ concessionaria: 'edp' }), PROMPT_EDP_DE_ANTES, 'outra concessionária não liga o modo ENEL');
  assert.equal(await promptDo({ concessionaria: 'ENEL' }), PROMPT_EDP_DE_ANTES, 'só o valor exato "enel" liga o modo');
  assert.equal(await promptDo({ concessionaria: null }), PROMPT_EDP_DE_ANTES);
});

test('EDP: o resto da chamada à IA não mudou (PDF primeiro, prompt depois, 16000 tokens)', async () => {
  const { enviadosAIA } = await chamar({ textoDaIA: '{"veredito":"favoravel"}' }, {});
  const corpo = JSON.parse(enviadosAIA[0]) as {
    max_tokens: number; messages: { role: string; content: { type: string; source?: { data: string; media_type: string } }[] }[];
  };
  assert.equal(corpo.max_tokens, 16000);
  assert.equal(corpo.messages.length, 1);
  assert.equal(corpo.messages[0].role, 'user');
  assert.deepEqual(corpo.messages[0].content.map((x) => x.type), ['document', 'text']);
  assert.equal(corpo.messages[0].content[0].source?.media_type, 'application/pdf');
  assert.equal(corpo.messages[0].content[0].source?.data, 'A'.repeat(400));
});

test('ENEL: a regra do titular manda a ordem natural, sem vírgula (complemento 1)', async () => {
  const linhas = (await promptDo({ concessionaria: 'enel' })).split('\n');
  assert.ok(linhas.includes(
    '- "titular": o nome completo do titular na ordem natural (prenome primeiro, sobrenome no fim), sem vírgula. '
    + 'Se o documento trouxer "SOBRENOME, NOME", reescreva como "NOME SOBRENOME".',
  ), 'a frase do titular deveria estar no prompt, literalmente');
});

test('ENEL: "aprovado, porém solicitamos observar…" é favorável, com os itens em pendencias (complemento 5)', async () => {
  const linhas = (await promptDo({ concessionaria: 'enel' })).split('\n');
  assert.ok(linhas.includes(
    '- "favoravel": aprovado, inclusive "aprovado, porém solicitamos observar os itens abaixo" — nesse caso liste os itens '
    + 'em "pendencias". "pendencia": reprovado ou com exigência que precisa ser cumprida ANTES da aprovação. '
    + '"inconclusivo": não dá para dizer.',
  ), 'a frase do veredito deveria estar no prompt, literalmente');
  assert.ok(
    !linhas.includes('- "favoravel": aprovado. "pendencia": reprovado ou com exigência a cumprir. "inconclusivo": não dá para dizer.'),
    'a frase nova SUBSTITUI a linha antiga',
  );
});

// ── 2. o que sai no modo ENEL ────────────────────────────────────────────────

test('ENEL: a Carta de projeto sai com tipo, NT (só dígitos) e UC', async () => {
  const r = await lerEnel({
    tipo: 'carta_projeto', veredito: 'favoravel', nt: 'NT 123.456.789', uc: '1111111111',
    titular: 'Maria Aparecida Silva',
  });
  assert.equal(r.tipo, 'carta_projeto');
  assert.equal(r.nt, '123456789');
  assert.equal(r.uc, '1111111111');
  assert.equal(r.titular, 'Maria Aparecida Silva');
  assert.equal(r.veredito, 'favoravel');
  assert.equal(r.ok, true);
});

test('ENEL: a resposta tem as seis chaves de sempre + tipo, nt e uc', async () => {
  const r = await lerEnel({ tipo: 'outro' });
  assert.deepEqual(Object.keys(r).sort(), NOVE_CHAVES);
});

test('ENEL: eco do formato e NT curta viram null', async () => {
  assert.equal((await lerEnel({ nt: 'número da nota técnica ou null' })).nt, null, 'eco do prompt');
  assert.equal((await lerEnel({ nt: 'número da Nota Técnica ou null' })).nt, null, 'eco do prompt, como está escrito nele');
  assert.equal((await lerEnel({ nt: '12345' })).nt, null, 'curta');
  assert.equal((await lerEnel({ uc: 'número da instalação ou null' })).uc, null, 'eco do prompt (uc)');
  assert.equal((await lerEnel({ nt: null, uc: null })).nt, null);
  assert.equal((await lerEnel({ nt: 123456789 })).nt, null, 'só texto conta como dado lido');
  assert.equal((await lerEnel({})).nt, null, 'ausente');
});

test('ENEL: a NT exige 9 dígitos ou mais (a NT real tem 9)', async () => {
  assert.equal((await lerEnel({ nt: '391901851' })).nt, '391901851');
  assert.equal((await lerEnel({ nt: '390698066' })).nt, '390698066');
  assert.equal((await lerEnel({ nt: '12345678' })).nt, null, '8 dígitos não é NT');
  assert.equal((await lerEnel({ nt: '000012345678' })).nt, null, 'os zeros à esquerda não contam');
  assert.equal((await lerEnel({ nt: '0123456789' })).nt, '123456789', 'tira os zeros à esquerda');
});

test('ENEL: a UC aceita 7 dígitos ou mais, sem os zeros à esquerda (complemento 4)', async () => {
  assert.equal((await lerEnel({ uc: '88101266' })).uc, '88101266', 'a Carta do PRJ-67567 traz 8 dígitos');
  assert.equal((await lerEnel({ uc: '0088101266' })).uc, '88101266', 'o cadastro tem os zeros; o valor devolvido não');
  assert.equal((await lerEnel({ uc: 'Instalação: 88101266' })).uc, '88101266', 'só os dígitos');
  assert.equal((await lerEnel({ uc: '1234567' })).uc, '1234567', '7 dígitos é o mínimo');
  assert.equal((await lerEnel({ uc: '123456' })).uc, null, '6 dígitos não é UC');
  assert.equal((await lerEnel({ uc: '0000123456' })).uc, null, 'os zeros à esquerda não contam');
});

test('ENEL: tipo só vale se estiver na lista branca; o resto é "outro"', async () => {
  assert.equal((await lerEnel({ tipo: 'Carta Projeto' })).tipo, 'outro', 'fora da lista');
  assert.equal((await lerEnel({ tipo: 'parecer_de_acesso' })).tipo, 'outro');
  assert.equal((await lerEnel({ tipo: 'carta_projeto|resultado_vistoria|troca_relogio|outro' })).tipo, 'outro', 'eco do formato');
  assert.equal((await lerEnel({})).tipo, 'outro', 'a IA não disse');
  assert.equal((await lerEnel({ tipo: 7 })).tipo, 'outro');
  for (const t of ['carta_projeto', 'resultado_vistoria', 'troca_relogio', 'outro']) {
    assert.equal((await lerEnel({ tipo: t })).tipo, t, t);
  }
  assert.equal((await lerEnel({ tipo: ' Carta_Projeto ' })).tipo, 'carta_projeto', 'normaliza antes da lista');
  assert.equal((await lerEnel({ tipo: 'Troca_Relógio' })).tipo, 'troca_relogio', 'sem acento, como o veredito');
});

test('ENEL: os filtros de titular, endereço, resumo e veredito seguem valendo', async () => {
  const r = await lerEnel({ titular: 'Não consta.', endereco: 'Não informado no documento', resumo: 'uma frase em português' });
  assert.equal(r.titular, null);
  assert.equal(r.endereco, null);
  assert.equal(r.resumo, 'a IA não resumiu o parecer');
  assert.equal((await lerEnel({ titular: 'nome do titular ou null' })).titular, null, 'eco do prompt');
  assert.equal((await lerEnel({ veredito: 'Favorável ' })).veredito, 'favoravel');
  assert.equal((await lerEnel({ veredito: 'aprovado' })).veredito, 'inconclusivo', 'fora do vocabulário');
  assert.deepEqual((await lerEnel({ pendencias: ['a', 'b'] })).pendencias, ['a', 'b']);
});

test('ENEL: os caminhos de falha também trazem tipo, nt e uc (null: nada foi lido)', async () => {
  const nuncaLidos = { tipo: null, nt: null, uc: null };
  const enel = { concessionaria: 'enel' };

  // a IA respondeu algo sem JSON → inconclusivo
  let r = await (await chamar({ textoDaIA: 'não sei' }, enel)).r.json() as Resposta;
  assert.equal(r.ok, true);
  assert.equal(r.veredito, 'inconclusivo');
  assert.deepEqual({ tipo: r.tipo, nt: r.nt, uc: r.uc }, nuncaLidos);

  // JSON quebrado → inconclusivo (fora do formato)
  r = await (await chamar({ textoDaIA: '{"tipo": }' }, enel)).r.json() as Resposta;
  assert.equal(r.resumo, 'resposta da IA fora do formato');
  assert.deepEqual({ tipo: r.tipo, nt: r.nt, uc: r.uc }, nuncaLidos);

  // a IA caiu → ok:false
  r = await (await chamar({ statusDaIA: 500, corpoDaIA: 'erro' }, enel)).r.json() as Resposta;
  assert.equal(r.ok, false);
  assert.equal(r.error, 'IA respondeu 500');
  assert.deepEqual({ tipo: r.tipo, nt: r.nt, uc: r.uc }, nuncaLidos);

  // 200 que não é JSON → ok:false
  r = await (await chamar({ corpoDaIA: 'isto não é JSON' }, enel)).r.json() as Resposta;
  assert.equal(r.ok, false);
  assert.deepEqual({ tipo: r.tipo, nt: r.nt, uc: r.uc }, nuncaLidos);

  // a cota do plano recusou → ok:false
  r = await (await chamar({ cotaNegada: true }, enel)).r.json() as Resposta;
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /cota de IA indisponível/);
  assert.deepEqual({ tipo: r.tipo, nt: r.nt, uc: r.uc }, nuncaLidos);
});

// ── 3. o modo EDP não muda ───────────────────────────────────────────────────

test('EDP: sem `concessionaria`, a resposta tem as seis chaves de sempre — nada de tipo, nt, uc', async () => {
  const r = await ler({ titular: 'WERLHE DE ARAUJO LIMA', endereco: 'RUA DAS FLORES 120', pendencias: ['a'] });
  assert.deepEqual(Object.keys(r).sort(), SEIS_CHAVES);
  assert.equal(r.ok, true);
  assert.equal(r.veredito, 'favoravel');
  assert.equal(r.titular, 'WERLHE DE ARAUJO LIMA');
  assert.equal(r.endereco, 'RUA DAS FLORES 120');
  assert.deepEqual(r.pendencias, ['a']);
  assert.equal(r.tipo, undefined);
  assert.equal(r.nt, undefined);
  assert.equal(r.uc, undefined);
});

test('EDP: mesmo que a IA devolva tipo/nt/uc, a resposta da EDP não os carrega', async () => {
  // O desvio entre os modos é só a bandeira `concessionaria`: sem ela, o que a IA
  // disser a mais é descartado — a EDP continua recebendo o contrato de sempre.
  const r = await ler({ tipo: 'carta_projeto', nt: '123456789', uc: '1111111111', titular: 'Maria Silva' });
  assert.deepEqual(Object.keys(r).sort(), SEIS_CHAVES);
  assert.equal(r.titular, 'Maria Silva');
});

test('EDP: os caminhos de falha seguem com as chaves de antes', async () => {
  const chavesDeFalha = ['endereco', 'error', 'ok', 'pendencias', 'resumo', 'titular', 'veredito'];
  let r = await (await chamar({ textoDaIA: 'não sei' }, {})).r.json() as Resposta;
  assert.deepEqual(Object.keys(r).sort(), SEIS_CHAVES, 'inconclusivo');

  r = await (await chamar({ textoDaIA: '{"tipo": }' }, {})).r.json() as Resposta;
  assert.deepEqual(Object.keys(r).sort(), SEIS_CHAVES, 'fora do formato');

  r = await (await chamar({ statusDaIA: 500, corpoDaIA: 'erro' }, {})).r.json() as Resposta;
  assert.deepEqual(Object.keys(r).sort(), chavesDeFalha, 'IA caiu');

  r = await (await chamar({ corpoDaIA: 'isto não é JSON' }, {})).r.json() as Resposta;
  assert.deepEqual(Object.keys(r).sort(), chavesDeFalha, '200 ilegível');

  r = await (await chamar({ cotaNegada: true }, {})).r.json() as Resposta;
  assert.deepEqual(Object.keys(r).sort(), chavesDeFalha, 'cota recusada');
});

// ── 4. o portão não depende do modo ──────────────────────────────────────────

test('o portão: sem credencial (ou com a errada) é 401, em qualquer modo, e a IA nem é chamada', async () => {
  for (const corpo of [{}, { concessionaria: 'enel' }]) {
    for (const credencial of [null, 'chave-publicavel-do-front']) {
      const { r, enviadosAIA } = await chamar({ textoDaIA: '{}' }, corpo, credencial);
      assert.equal(r.status, 401, JSON.stringify({ corpo, credencial }));
      assert.equal(enviadosAIA.length, 0, 'sem credencial não se gasta IA');
    }
  }
});

test('o portão vem ANTES de ler o corpo: lixo sem credencial é 401 (nunca 400) e nada é gasto', async () => {
  // Se o corpo fosse lido antes do portão, quem não tem credencial aprenderia, pelo
  // 400, que a função existe e como ela valida. Com credencial, os mesmos lixos são 400
  // (a contraprova de que o 401 vem do portão, e não de o corpo ser aceito).
  const lixos = [
    '{nao e json', '', '[]',
    JSON.stringify({ pdf_base64: 12345 }),
    JSON.stringify({ pdf_base64: 'abc' }),
    JSON.stringify({ pdf_base64: 'A'.repeat(400), tenant_id: 'nao-e-uuid' }),
    JSON.stringify({ concessionaria: 'enel', pdf_base64: 12345 }),
    JSON.stringify({ concessionaria: 'enel', pdf_base64: 'abc' }),
  ];
  for (const lixo of lixos) {
    for (const credencial of [null, 'chave-publicavel-do-front']) {
      const { r, rastro } = await chamarCru({ textoDaIA: '{}' }, lixo, credencial);
      assert.equal(r.status, 401, `sem credencial válida: ${lixo.slice(0, 40)}`);
      assert.equal(rastro.length, 0, 'sem credencial não se reserva cota nem se chama a IA');
    }
    const { r } = await chamarCru({ textoDaIA: '{}' }, lixo);
    assert.equal(r.status, 400, `com credencial o lixo é recusado pelo corpo: ${lixo.slice(0, 40)}`);
  }
});

// ── 5. o gasto de IA é o mesmo nos dois modos ────────────────────────────────

const respostaPronta = JSON.stringify({ veredito: 'favoravel', resumo: 'Carta de aprovação.', pendencias: [] });

test('o gasto de IA: ENEL e EDP fazem a MESMA chamada (modelo, max_tokens, PDF) e a mesma reserva e lançamento', async () => {
  const edp = await chamar({ textoDaIA: respostaPronta }, {});
  const enel = await chamar({ textoDaIA: respostaPronta }, { concessionaria: 'enel' });
  assert.equal(edp.r.status, 200);
  assert.equal(enel.r.status, 200);
  assert.deepEqual(gastoDe(enel.rastro), gastoDe(edp.rastro), 'só o texto do prompt pode diferir entre os modos');

  // …e o que cada um faz, por extenso (a comparação acima não pega um defeito dos DOIS)
  for (const { nome, rastro } of [{ nome: 'ENEL', rastro: enel.rastro }, { nome: 'EDP', rastro: edp.rastro }]) {
    const g = gastoDe(rastro);
    assert.deepEqual(g.map((e) => e.tipo === 'rpc' ? e.nome : e.tipo),
      ['consume_ai_quota_servidor', 'fetch', 'update_ai_usage_tokens_servidor'],
      `${nome}: reserva a cota, chama a IA, lança os tokens (nessa ordem, sem apagar nada)`);
    const [reserva, chamada, lancamento] = g;
    assert.deepEqual(reserva.args, { _tenant: TENANT, _kind: 'ludmilla_parecer', _user: null }, `${nome}: a reserva`);
    assert.equal(chamada.max_tokens, 16000, `${nome}: max_tokens`);
    assert.equal(typeof chamada.model, 'string');
    assert.ok(String(chamada.model).length > 0, `${nome}: tem modelo`);
    assert.deepEqual(chamada.mensagens, [{
      role: 'user',
      partes: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'A'.repeat(400) } }, { type: 'text' }],
    }], `${nome}: PDF primeiro, prompt depois`);
    assert.deepEqual(lancamento.args, {
      _log_id: 'linha-1', _tenant: TENANT, _model: chamada.model, _input_tokens: 10, _output_tokens: 10,
    }, `${nome}: os tokens REAIS entram no extrato, com o modelo que foi usado`);
  }
});

test('o gasto de IA: a IA que não responde DESFAZ a reserva, nos dois modos', async () => {
  const desfeita = [{
    tipo: 'delete', tabela: 'ai_usage_log',
    filtros: [['id', 'linha-1'], ['tenant_id', TENANT], ['input_tokens', null]],
  }];
  for (const [nome, cenario] of [
    ['IA respondeu 500', { statusDaIA: 500, corpoDaIA: 'erro' }],
    ['rede caiu', { derruba: true }],
  ] as [string, Cenario][]) {
    const edp = await chamar(cenario, {});
    const enel = await chamar(cenario, { concessionaria: 'enel' });
    assert.deepEqual(gastoDe(enel.rastro), gastoDe(edp.rastro), `${nome}: ENEL = EDP`);
    for (const rastro of [enel.rastro, edp.rastro]) {
      const g = gastoDe(rastro);
      assert.deepEqual(g.map((e) => e.tipo === 'rpc' ? e.nome : e.tipo), ['consume_ai_quota_servidor', 'fetch', 'delete'], nome);
      assert.deepEqual(g[2], desfeita[0], `${nome}: apaga só a linha reservada, e só se ainda sem tokens`);
    }
  }
});

test('o gasto de IA: a IA que respondeu (mesmo ilegível) NÃO desfaz a reserva — o gasto existiu', async () => {
  for (const [nome, cenario, lancaTokens] of [
    ['200 que não é JSON', { corpoDaIA: 'isto não é JSON' }, false],
    ['texto sem JSON', { textoDaIA: 'não sei' }, true],
    ['JSON quebrado', { textoDaIA: '{"tipo": }' }, true],
  ] as [string, Cenario, boolean][]) {
    const edp = await chamar(cenario, {});
    const enel = await chamar(cenario, { concessionaria: 'enel' });
    assert.deepEqual(gastoDe(enel.rastro), gastoDe(edp.rastro), `${nome}: ENEL = EDP`);
    const passos = gastoDe(enel.rastro).map((e) => e.tipo === 'rpc' ? e.nome : e.tipo);
    assert.deepEqual(passos, lancaTokens
      ? ['consume_ai_quota_servidor', 'fetch', 'update_ai_usage_tokens_servidor']
      : ['consume_ai_quota_servidor', 'fetch'], nome);
  }
});

// ── 6. o `tipo` da IA só é lido no modo ENEL ─────────────────────────────────

test('EDP: um `tipo` esquisito da IA não muda NADA (o String() de um objeto lança, e a EDP não o lê)', async () => {
  // Antes do modo ENEL a função nem olhava para `tipo`. Normalizá-lo também na EDP
  // fazia `String({toString: 1})` lançar, cair no catch e responder 'inconclusivo'
  // onde a EDP respondia 'favoravel'.
  for (const tipo of [{ toString: 1 }, { toString: null }, { valueOf: 1, toString: 1 }, [{ toString: 1 }]]) {
    const r = await ler({ tipo, titular: 'WERLHE DE ARAUJO LIMA', endereco: 'RUA DAS FLORES 120' });
    assert.equal(r.ok, true, JSON.stringify(tipo));
    assert.equal(r.veredito, 'favoravel', 'a leitura NÃO é perdida');
    assert.equal(r.resumo, 'Carta de aprovação.');
    assert.equal(r.titular, 'WERLHE DE ARAUJO LIMA');
    assert.equal(r.endereco, 'RUA DAS FLORES 120');
    assert.deepEqual(Object.keys(r).sort(), SEIS_CHAVES);
  }
});

test('ENEL: um `tipo` esquisito vira "outro" e NÃO derruba o resto da leitura', async () => {
  for (const tipo of [{ toString: 1 }, { toString: null }, [{ toString: 1 }], 7, true, {}]) {
    const r = await lerEnel({ tipo, nt: '391901851', uc: '88101266', titular: 'Maria Aparecida Silva' });
    assert.equal(r.ok, true, JSON.stringify(tipo));
    assert.equal(r.veredito, 'favoravel');
    assert.equal(r.tipo, 'outro');
    assert.equal(r.nt, '391901851');
    assert.equal(r.uc, '88101266');
    assert.equal(r.titular, 'Maria Aparecida Silva');
  }
});

// ── 7. o exemplo do prompt não é titular ─────────────────────────────────────

test('ENEL: o exemplo do prompt ("NOME SOBRENOME", "SOBRENOME, NOME") copiado pela IA não é titular', async () => {
  // As frases novas da regra do titular trazem esses literais. Passando como titular
  // LIDO, o worker os compararia com o cadastro e BLOQUEARIA o anexo.
  for (const t of [
    'NOME SOBRENOME', 'Nome Sobrenome', 'nome sobrenome', '  NOME  SOBRENOME ', 'NOME SOBRENOME.',
    'SOBRENOME, NOME', 'Sobrenome, Nome', 'SOBRENOME NOME', 'Sobrenome,Nome',
    '"NOME SOBRENOME"', '"SOBRENOME, NOME"', "'Nome Sobrenome'",
  ]) {
    assert.equal((await lerEnel({ titular: t })).titular, null, JSON.stringify(t));
  }
});

test('ENEL: nome de verdade, mesmo parecido com o exemplo, passa intacto', async () => {
  for (const t of [
    'Maria Aparecida Silva', 'Nome Silva', 'Sobrenome Santos', 'NOME SOBRENOME SILVA', 'Sobrenome Nome Santos',
    'JOSE NOMEADO', 'WERLHE DE ARAUJO LIMA',
  ]) {
    assert.equal((await lerEnel({ titular: t })).titular, t, t);
  }
});

test('EDP: o filtro do exemplo NÃO vale na EDP (o prompt dela não tem esse exemplo)', async () => {
  // A EDP segue exatamente como era. Este teste existe para que ninguém "melhore" a EDP
  // sem decidir isso de propósito.
  assert.equal((await ler({ titular: 'NOME SOBRENOME' })).titular, 'NOME SOBRENOME');
  assert.equal((await ler({ titular: 'SOBRENOME, NOME' })).titular, 'SOBRENOME, NOME');
});
