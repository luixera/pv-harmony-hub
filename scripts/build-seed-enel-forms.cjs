/**
 * Injeta os quatro modelos da ENEL (docs/modelos-enel/) em base64 na edge
 * function seed-enel-forms. Rode depois de alterar qualquer modelo e publique
 * a função de novo — ela é quem coloca os documentos nas concessionárias.
 *
 *   node scripts/build-seed-enel-forms.cjs
 *
 * Os marcadores (__ANEXO1__ etc.) só existem no arquivo recém-criado; depois
 * da primeira injeção o script substitui o base64 anterior, então pode rodar
 * quantas vezes quiser.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fnPath = path.join(root, 'supabase/functions/seed-enel-forms/index.ts');
const b64 = (f) => fs.readFileSync(path.join(root, 'docs/modelos-enel', f)).toString('base64');

const ARQUIVOS = [
  ['ANEXO1_B64', 'ANEXO_1_SOLICITACAO_ACESSO.pdf'],
  ['ANEXO4_B64', 'ANEXO_4_DADOS_UNIDADE_ACESSANTE.pdf'],
  ['MEMORIAL_B64', 'MEMORIAL_DESCRITIVO_ENEL_v2.docx'],
  ['PLANILHA_B64', 'FORMULARIO_REGISTRO_CENTRAL_GERADORA.xlsx'],
];

let src = fs.readFileSync(fnPath, 'utf8');
let total = 0;
for (const [constante, arquivo] of ARQUIVOS) {
  const dados = b64(arquivo);
  const re = new RegExp(`const ${constante} = '[^']*';`);
  if (!re.test(src)) throw new Error(`marcador de ${constante} não encontrado em ${fnPath}`);
  src = src.replace(re, `const ${constante} = '${dados}';`);
  total += dados.length;
  console.log(`  ${arquivo}: ${(dados.length / 1024).toFixed(0)} KB em base64`);
}
fs.writeFileSync(fnPath, src);
console.log(`ok — ${ARQUIVOS.length} modelos (${(total / 1024 / 1024).toFixed(2)} MB de base64) injetados em ${path.relative(root, fnPath)}`);
