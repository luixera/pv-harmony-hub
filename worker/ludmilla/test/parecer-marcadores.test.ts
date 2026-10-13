// worker/ludmilla/test/parecer-marcadores.test.ts
// E4: os marcadores de "não achei" da edge function `ludmilla-parecer`.
//
// A função é um script Deno (`Deno.serve` no topo, import por URL) e não tem
// infra de teste própria. Em vez de copiar a lógica para cá — o que testaria a
// cópia —, este teste carrega o ARQUIVO REAL, transpila, e o roda com um `Deno`,
// um `createClient` e um `fetch` de mentira. A IA "responde" o texto que o caso
// define, e o que se afirma é o JSON que a função devolve ao robô.
//
// Por que importa: o titular que a função devolve é comparado com o cadastro, e
// divergência é o ÚNICO bloqueio do fluxo. Um texto que não é nome ("Não
// consta.") que passasse como titular LIDO bloquearia o parecer certo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const FONTE = new URL('../../../../supabase/functions/ludmilla-parecer/index.ts', import.meta.url);

type Handler = (req: Request) => Promise<Response>;
interface Resposta {
  ok: boolean; veredito: string; resumo: string; pendencias: string[];
  titular: string | null; endereco: string | null;
}

/** Carrega a função real e devolve o handler que ela registra em `Deno.serve`. */
function carregar(textoDaIA: string): Handler {
  const fonte = readFileSync(FONTE, 'utf8').replace(/^import .*createClient.*$/m, '');
  const js = ts.transpileModule(fonte, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;

  let handler: Handler | null = null;
  const env: Record<string, string> = {
    SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico', ANTHROPIC_API_KEY: 'chave-da-ia', SUPABASE_URL: 'http://localhost',
  };
  const Deno = { env: { get: (k: string) => env[k] }, serve: (h: Handler) => { handler = h; } };
  const createClient = () => ({
    rpc: async (nome: string) => (nome === 'consume_ai_quota_servidor'
      ? { data: { allowed: true, log_id: 'linha-1' }, error: null }
      : { data: true, error: null }),
  });
  const fetchFalso = async () => new Response(JSON.stringify({
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: 'text', text: textoDaIA }],
  }), { status: 200 });
  const consoleMudo = { ...console, error: () => undefined };

  new Function('Deno', 'createClient', 'fetch', 'console', js)(Deno, createClient, fetchFalso, consoleMudo);
  assert.ok(handler, 'a função deveria ter registrado o handler em Deno.serve');
  return handler as Handler;
}

/** A IA devolve este JSON; o robô recebe o que a função faz dele. */
async function ler(daIA: Record<string, unknown>): Promise<Resposta> {
  const handler = carregar(JSON.stringify({ veredito: 'favoravel', resumo: 'Parecer favorável.', pendencias: [], ...daIA }));
  const r = await handler(new Request('http://localhost/functions/v1/ludmilla-parecer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer chave-de-servico' },
    body: JSON.stringify({
      pdf_base64: 'A'.repeat(400), protocolo: '45006443920', tenant_id: '44444444-4444-4444-8444-444444444444',
    }),
  }));
  assert.equal(r.status, 200);
  return await r.json() as Resposta;
}

test('o titular de verdade passa intacto', async () => {
  assert.equal((await ler({ titular: 'WERLHE DE ARAUJO LIMA' })).titular, 'WERLHE DE ARAUJO LIMA');
  assert.equal((await ler({ titular: 'Nonato Silva' })).titular, 'Nonato Silva', 'não é "none"');
  assert.equal((await ler({ titular: 'Maria Nunes Nulo' })).titular, 'Maria Nunes Nulo', 'não é "null"');
});

test('E4: "Não consta." (com ponto final) é "não achei", não um titular', async () => {
  // Igualdade exata deixava passar: duas palavras = "comparável", e o parecer
  // certo era BLOQUEADO por divergir de um "titular" que ninguém escreveu.
  assert.equal((await ler({ titular: 'Não consta.' })).titular, null);
  assert.equal((await ler({ titular: 'NÃO CONSTA' })).titular, null);
  assert.equal((await ler({ titular: '  não consta;  ' })).titular, null);
});

test('E4: "Não identificado no documento" e variações em frase são "não achei"', async () => {
  assert.equal((await ler({ titular: 'Não identificado no documento' })).titular, null);
  assert.equal((await ler({ titular: 'Não identificado no parecer.' })).titular, null);
  assert.equal((await ler({ titular: 'Não informado no PDF' })).titular, null);
  assert.equal((await ler({ titular: 'Não localizado no documento' })).titular, null);
  assert.equal((await ler({ titular: 'Ilegível no PDF' })).titular, null);
});

test('E4: o marcador no MEIO da frase também é "não achei"', async () => {
  assert.equal((await ler({ titular: 'Titular não identificado' })).titular, null);
  assert.equal((await ler({ titular: '(não consta)' })).titular, null);
  assert.equal((await ler({ titular: 'Titular: a definir' })).titular, null);
});

test('os marcadores antigos continuam valendo', async () => {
  for (const t of ['null', 'None', 'N/A', 'undefined', 'Desconhecido', 'não informado', 'nao consta', 'A definir', 'ilegível']) {
    assert.equal((await ler({ titular: t })).titular, null, t);
  }
  assert.equal((await ler({ titular: 'nome do titular ou null' })).titular, null, 'o eco do prompt também');
});

test('E4: o endereço usa a mesma lista', async () => {
  assert.equal((await ler({ endereco: 'Não informado no parecer' })).endereco, null);
  assert.equal((await ler({ endereco: 'Não consta.' })).endereco, null);
  assert.equal((await ler({ endereco: 'RUA DAS FLORES 120' })).endereco, 'RUA DAS FLORES 120');
});

test('o RESUMO não perde frase legítima que começa com "Não consta"', async () => {
  // O resumo vai para a tela do cartão. Casar por começo de frase aqui jogaria
  // fora um resumo bom ("Não consta restrição; conexão aprovada."). Para o
  // resumo a lista segue sendo de igualdade exata.
  const r = await ler({ resumo: 'Não consta restrição; conexão aprovada.' });
  assert.equal(r.resumo, 'Não consta restrição; conexão aprovada.');
  assert.equal((await ler({ resumo: 'não consta' })).resumo, 'a IA não resumiu o parecer');
});

test('o contrato da resposta não mudou: ok, veredito, resumo, pendencias, titular, endereco', async () => {
  const r = await ler({ titular: 'WERLHE DE ARAUJO LIMA', endereco: 'RUA DAS FLORES 120', pendencias: ['a', 'b'] });
  assert.deepEqual(Object.keys(r).sort(), ['endereco', 'ok', 'pendencias', 'resumo', 'titular', 'veredito']);
  assert.equal(r.ok, true);
  assert.equal(r.veredito, 'favoravel');
  assert.deepEqual(r.pendencias, ['a', 'b']);
});
