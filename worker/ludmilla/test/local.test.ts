import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modoAtual, nomeRpc, carregarSessao, guardarSessao, caminhoSessao, carregarEnvDaEstacao, lerEnv } from '../src/local.js';

/**
 * Modo local: o mesmo robô numa máquina de pessoa (coworking), sem service
 * role. O que muda: as RPCs "_local" e a sessão do usuário guardada em
 * arquivo. Estes testes não tocam rede nem o Windows.
 */

test('modo: vps por padrão; local quando LUDMILLA_MODO=local', () => {
  delete process.env.LUDMILLA_MODO;
  assert.equal(modoAtual(), 'vps');
  process.env.LUDMILLA_MODO = 'local';
  assert.equal(modoAtual(), 'local');
  process.env.LUDMILLA_MODO = 'LOCAL ';
  assert.equal(modoAtual(), 'local');
  delete process.env.LUDMILLA_MODO;
});

test('nome da RPC: sufixo _local só no modo local', () => {
  delete process.env.LUDMILLA_MODO;
  assert.equal(nomeRpc('ludmilla_claim_run'), 'ludmilla_claim_run');
  process.env.LUDMILLA_MODO = 'local';
  assert.equal(nomeRpc('ludmilla_claim_run'), 'ludmilla_claim_run_local');
  assert.equal(nomeRpc('ludmilla_finalizar_run'), 'ludmilla_finalizar_run_local');
  delete process.env.LUDMILLA_MODO;
});

test('sessão: gravada e lida do arquivo da estação; ausente = null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ludmilla-'));
  process.env.LUDMILLA_DIR = dir;
  assert.equal(carregarSessao(), null);
  guardarSessao({ access_token: 'a', refresh_token: 'r', expires_at: 123 });
  assert.ok(existsSync(caminhoSessao()));
  assert.deepEqual(carregarSessao(), { access_token: 'a', refresh_token: 'r', expires_at: 123 });
  // o arquivo é JSON puro, sem nada além da sessão
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(caminhoSessao(), 'utf8'))).sort(), ['access_token', 'expires_at', 'refresh_token']);
  delete process.env.LUDMILLA_DIR;
});

test('env da estação: KEY=VALOR, ignora comentário e vazio, aceita aspas e "export"', () => {
  const env = lerEnv([
    '# configuração da estação',
    'SUPABASE_URL=https://x.supabase.co',
    'SUPABASE_ANON_KEY="ey.abc"',
    "export LUDMILLA_POLL_SECONDS='45'",
    '',
    'SEM_IGUAL',
    'COM_ESPACO = valor com espaço ',
  ].join('\n'));
  assert.deepEqual(env, {
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_ANON_KEY: 'ey.abc',
    LUDMILLA_POLL_SECONDS: '45',
    COM_ESPACO: 'valor com espaço',
  });
});

test('env da estação: lido da pasta da estação; não sobrescreve o que já veio do ambiente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ludmilla-'));
  process.env.LUDMILLA_DIR = dir;
  delete process.env.LUDMILLA_TESTE_A;
  process.env.LUDMILLA_TESTE_B = 'do-ambiente';
  // sem arquivo: nada acontece
  assert.equal(carregarEnvDaEstacao(), 0);
  writeFileSync(join(dir, 'env'), 'LUDMILLA_TESTE_A=do-arquivo\nLUDMILLA_TESTE_B=do-arquivo\n');
  assert.equal(carregarEnvDaEstacao(), 1);
  assert.equal(process.env.LUDMILLA_TESTE_A, 'do-arquivo');
  assert.equal(process.env.LUDMILLA_TESTE_B, 'do-ambiente');
  delete process.env.LUDMILLA_TESTE_A;
  delete process.env.LUDMILLA_TESTE_B;
  delete process.env.LUDMILLA_DIR;
});
