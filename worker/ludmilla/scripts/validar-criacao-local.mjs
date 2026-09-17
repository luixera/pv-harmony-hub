// Validação LOCAL do roteiro de criação na CPFL, sem banco e sem criar projeto:
// roda o roteiro compilado (dist/) numa sessão do agent-browser já logada
// (janela visível), com os dados informados por variáveis de ambiente, e
// PARA antes do Salvar (simular). Prints e mapas vão para uma pasta local.
//
//   npm run build
//   LUDMILLA_AB_SESSAO=cpfl-mapa LUDMILLA_AB_PERFIL="C:/Users/x/.agent-browser/profiles/cpfl-ludmilla" \
//   node scripts/validar-criacao-local.mjs
//
// Sem LUDMILLA_VALIDAR_* os dados são os do projeto de teste PRJ-14848 (17/09/2026).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agente } from '../dist/criacao/agente.js';
import { roteiroCpfl60 } from '../dist/criacao/roteiro-cpfl60.js';
import { JS_MAPA } from '../dist/criacao/js.js';
import { AUTONOMIA_PADRAO } from '../dist/criacao/tipos.js';

const env = process.env;
const pasta = env.LUDMILLA_VALIDAR_PASTA || join(process.cwd(), '_validacao');
mkdirSync(pasta, { recursive: true });

const dados = {
  project_id: 'local', tenant_id: 'local', run_id: 'local-' + Date.now().toString(36),
  uc_number:      env.LUDMILLA_VALIDAR_UC      || '3.962.513.035-90',
  coordinates:    env.LUDMILLA_VALIDAR_COORDS  || '-20.879367246198328, -49.57452815906255',
  customer_name:  env.LUDMILLA_VALIDAR_NOME    || 'IRENE SOARES NAVA',
  customer_cpf:   env.LUDMILLA_VALIDAR_CPF     || '13351426810',
  customer_email: env.LUDMILLA_VALIDAR_EMAIL   || 'irene.nava736@gmail.com',
  customer_phone: env.LUDMILLA_VALIDAR_FONE    || '17991663616',
  project_title:  env.LUDMILLA_VALIDAR_TITULO  || 'IRENE SOARES NAVA',
  is_rural: false, concessionaire: 'CPFL', entry_phase: 'bifasico', entry_breaker: '50A',
  modulo:   { fabricante: 'TCL', modelo: 'HSM-ND66-GR620', quantidade: 8, potencia_wp: 620 },
  inversor: { fabricante: 'HOYMILES', modelo: 'HMS-2250DW-4T', quantidade: 2, potencia_kw: 2.25 },
  padrao:   { categoria: 'B1', num_fases: 2, bitola: '16', disjuntor: 63, caixa: 'TIPO II', demanda_kw: '14' },
  autonomia: { ...AUTONOMIA_PADRAO },
};

const agente = new Agente({
  sessao: env.LUDMILLA_AB_SESSAO || 'cpfl-mapa',
  headed: env.LUDMILLA_AB_HEADED !== '0',
  perfil: env.LUDMILLA_AB_PERFIL || undefined,
});

const log = (msg, extra = {}) => console.log(new Date().toISOString().slice(11, 19), msg, Object.keys(extra).length ? JSON.stringify(extra) : '');

const registrar = async (passo, nome, status, erro) => {
  log(`passo ${passo} ${nome}: ${status}${erro ? ' — ' + erro : ''}`);
  await agente.screenshot(join(pasta, `passo-${passo}-${status}.png`)).catch(() => undefined);
  if (status === 'erro') {
    const mapa = await agente.js(JS_MAPA).catch(() => null);
    if (mapa) writeFileSync(join(pasta, `passo-${passo}.campos.json`), JSON.stringify(mapa, null, 1));
  }
};

try {
  const r = await roteiroCpfl60({ agente, dados, registrar, simular: env.LUDMILLA_VALIDAR_SALVAR !== '1', log });
  log('RESULTADO', r);
} catch (e) {
  log('FALHOU: ' + (e.message || e));
  process.exitCode = 1;
}
