import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const pasta = join('dist-test', 'test');
const arquivos = readdirSync(pasta).filter(f => f.endsWith('.test.js')).map(f => join(pasta, f));
if (arquivos.length === 0) { console.error('Nenhum teste compilado em ' + pasta); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(r.status ?? 1);
