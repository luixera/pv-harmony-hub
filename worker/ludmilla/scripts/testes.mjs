// Roda os testes compilados com o runner nativo, passando os arquivos UM A UM.
//
// Por que não `node --test "glob"`: o glob no argumento só existe a partir do
// Node 21 — no Node 20 ele quebrou ("Could not find …"). E a
// descoberta padrão (`node --test` sem argumentos) no Node 22+ também pega os
// `.ts` da pasta test/ e tenta executá-los. A lista explícita serve a todos.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const pasta = join('dist-test', 'test');
const arquivos = readdirSync(pasta).filter(f => f.endsWith('.test.js')).map(f => join(pasta, f));
if (arquivos.length === 0) { console.error('Nenhum teste compilado em ' + pasta); process.exit(1); }

const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(r.status ?? 1);
