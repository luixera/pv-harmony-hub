/**
 * Injeta o formulário da CEMIG (docs/modelos-cemig/) em base64 na edge
 * function seed-cemig-forms. Rode depois de trocar o modelo e publique a
 * função de novo.
 *
 *   node scripts/build-seed-cemig-forms.cjs
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const fnPath = path.join(root, 'supabase/functions/seed-cemig-forms/index.ts');
const b64 = fs.readFileSync(path.join(root, 'docs/modelos-cemig/FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx')).toString('base64');
const re = /const FORMULARIO_B64 = '[^']*';/;
const src = fs.readFileSync(fnPath, 'utf8');
if (!re.test(src)) throw new Error('marcador FORMULARIO_B64 não encontrado');
fs.writeFileSync(fnPath, src.replace(re, `const FORMULARIO_B64 = '${b64}';`));
console.log(`ok — ${(b64.length / 1024).toFixed(0)} KB de base64 injetados`);
