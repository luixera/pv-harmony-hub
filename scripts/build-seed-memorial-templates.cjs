/**
 * Injeta os .docx de docs/modelos-memoriais/ (base64) na edge function
 * seed-memorial-templates. Rode depois de alterar um modelo e publique a
 * função de novo — ela é quem coloca os memoriais nas concessionárias.
 *
 *   node scripts/build-seed-memorial-templates.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fnPath = path.join(root, 'supabase/functions/seed-memorial-templates/index.ts');
const b64 = (f) => fs.readFileSync(path.join(root, 'docs/modelos-memoriais', f)).toString('base64');

const src = fs.readFileSync(fnPath, 'utf8')
  .replace(/const ENEL_B64 = '[^']*';/, `const ENEL_B64 = '${b64('MEMORIAL_DESCRITIVO_ENEL.docx')}';`)
  .replace(/const EDP_B64 = '[^']*';/, `const EDP_B64 = '${b64('MEMORIAL_DESCRITIVO_EDP.docx')}';`);

fs.writeFileSync(fnPath, src);
console.log('ok — base64 dos memoriais injetado em', path.relative(root, fnPath));
