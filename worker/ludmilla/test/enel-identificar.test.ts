// worker/ludmilla/test/enel-identificar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combinar, identificarPorDocumento, identificarPorTexto, nomeTrazOutroProjeto, numerosDoTexto,
  referenciaDoProjeto, titularNoAssunto, mesmoTitular, type ProjetoEnel,
} from '../src/email/enel/identificar.js';

const P = (o: Partial<ProjetoEnel>): ProjetoEnel => ({
  project_id: 'x', company_id: 'c', codigo: 'PRJ-X', protocolo: null, uc: null, titular: null,
  status: 'analysis', ativo: true, ...o,
});
const A = P({ project_id: 'a', codigo: 'PRJ-A', protocolo: '123456789', uc: '1111111111', titular: 'MARIA APARECIDA SILVA' });
const B = P({ project_id: 'b', codigo: 'PRJ-B', protocolo: '987654321', uc: '2222222222', titular: 'JOSE CARLOS SANTOS' });
const C = P({ project_id: 'c', codigo: 'PRJ-C', protocolo: 'aguardando protocolo', uc: '3333333333',
              titular: 'OSSEL LOCACAO DE SALAS PARA VELORIOS LTDA' });
const VELHO = P({ project_id: 'v', codigo: 'PRJ-V', protocolo: '555555555', uc: '4444444444',
                  titular: 'MARIA APARECIDA SILVA', status: 'completed', ativo: false });
const TODOS = [A, B, C, VELHO];
const txt = (assunto: string, corpo = '') => ({ assunto, corpo });

test('numerosDoTexto: só sequências de 9+ dígitos, sem zero à esquerda', () => {
  assert.deepEqual([...numerosDoTexto('NT 0123456789 em 13/10/2026, CEP 01310100')], ['123456789']);
  assert.deepEqual([...numerosDoTexto('data 20261013')], []); // 8 dígitos não identificam
  assert.deepEqual([...numerosDoTexto(null)], []);
});

test('NT no assunto identifica pelo protocolo', () => {
  const id = identificarPorTexto(txt('VISTORIA GD 123456789 - resultado'), TODOS);
  assert.equal(id.tipo, 'achado');
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-A');
  assert.equal(id.tipo === 'achado' && id.por, 'protocolo');
});

test('instalação no corpo identifica pela UC', () => {
  const id = identificarPorTexto(txt('RE: TROCA DE RELÓGIO', 'referente a instalação 2222222222 , para a troca'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'uc');
});

test('protocolo de contato da ENEL (10 dígitos, de ninguém) NÃO identifica', () => {
  const id = identificarPorTexto(txt('RE: atendimento', 'Protocolo: 9876543210. Atenciosamente'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('números de dois projetos é conflito', () => {
  const id = identificarPorTexto(txt('NT 123456789 e NT 987654321'), TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('número de um projeto e nome do titular de outro é conflito', () => {
  const id = identificarPorTexto(txt('TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 123456789'), TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('número e nome do MESMO projeto identificam pelo protocolo', () => {
  const id = identificarPorTexto(txt('TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 987654321'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'protocolo');
});

test('só o nome no assunto, único entre os ATIVOS, identifica pelo titular', () => {
  // MARIA APARECIDA SILVA também é titular do VELHO, que está concluído: não conta
  const id = identificarPorTexto(txt('PROJETO GD - MARIA A. SILVA'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-A');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('nome que casa com dois projetos ativos é conflito', () => {
  const GEMEO = P({ project_id: 'g', codigo: 'PRJ-G', titular: 'MARIA APARECIDA SILVA' });
  const id = identificarPorTexto(txt('PROJETO GD - MARIA APARECIDA SILVA'), [...TODOS, GEMEO]);
  assert.equal(id.tipo, 'conflito');
});

test('nome no CORPO não identifica (assinatura de funcionário da ENEL)', () => {
  const id = identificarPorTexto(txt('RE: sua solicitação', 'Atenciosamente, Jose Carlos Santos — Serviço da Enel'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('empresa com palavras curtas no meio casa pelo nome completo', () => {
  assert.equal(titularNoAssunto('PROJETO GD - OSSEL LOCACAO DE SALAS PARA VELORIOS LTDA', C.titular!), true);
  assert.equal(titularNoAssunto('PROJETO GD - OSSEL', C.titular!), false);
});

test('titular de uma palavra só nunca identifica', () => {
  assert.equal(titularNoAssunto('PROJETO GD - IVANILDO', 'IVANILDO'), false);
});

test('número de projeto concluído dá "inativo", não achado', () => {
  const id = identificarPorTexto(txt('VISTORIA GD 555555555'), TODOS);
  assert.equal(id.tipo, 'inativo');
});

test('protocolo só com texto não identifica por número', () => {
  const id = identificarPorTexto(txt('aguardando protocolo'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('documento: NT e UC trocados de campo pela IA ainda identificam', () => {
  const id = identificarPorDocumento({ nt: '2222222222', uc: '987654321', titular: null }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
});

test('documento: titular extraído identifica quando é único', () => {
  const id = identificarPorDocumento({ nt: null, uc: null, titular: 'José Carlos dos Santos' }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('combinar: texto e documento apontando projetos diferentes é conflito', () => {
  const t = identificarPorTexto(txt('NT 123456789'), TODOS);
  const d = identificarPorDocumento({ nt: '987654321', uc: null, titular: null }, TODOS);
  assert.equal(combinar(t, d).tipo, 'conflito');
});

test('combinar: texto vazio fica com o documento; mesmo projeto fica com o sinal mais forte', () => {
  const nada = identificarPorTexto(txt('Carta'), TODOS);
  const d = identificarPorDocumento({ nt: '123456789', uc: null, titular: null }, TODOS);
  assert.equal(combinar(nada, d).tipo === 'achado' && (combinar(nada, d) as { projeto: ProjetoEnel }).projeto.codigo, 'PRJ-A');
  const t = identificarPorTexto(txt('', 'instalação 1111111111'), TODOS);
  const r = combinar(t, d);
  assert.equal(r.tipo === 'achado' && r.por, 'protocolo');
});

test('arquivo com o número de OUTRO projeto (ativo ou não) não vai para este card', () => {
  assert.equal(nomeTrazOutroProjeto('CARTA_987654321.pdf', A, TODOS), true);
  assert.equal(nomeTrazOutroProjeto('CARTA_555555555.pdf', A, TODOS), true); // concluído também barra
  assert.equal(nomeTrazOutroProjeto('CARTA_123456789.pdf', A, TODOS), false);
  assert.equal(nomeTrazOutroProjeto('parecer.pdf', A, TODOS), false);
  assert.equal(nomeTrazOutroProjeto('nota_de_servico_400012345678.pdf', A, TODOS), false); // número de ninguém
});

test('referência do projeto: protocolo numérico, senão UC, senão o código', () => {
  assert.equal(referenciaDoProjeto(A), '123456789');
  assert.equal(referenciaDoProjeto(C), 'UC 3333333333');
  assert.equal(referenciaDoProjeto(P({ codigo: 'PRJ-Z' })), 'PRJ-Z');
});

// ── Correção pré-revisão: nome do meio de OUTRA pessoa não casa (janela) ─────

test('janela: nome do meio de OUTRA pessoa não casa (JOSE MARIA não é JOSE CARLOS)', () => {
  assert.equal(titularNoAssunto('TROCA DE RELÓGIO - JOSE MARIA SANTOS', 'JOSE CARLOS SANTOS'), false);
});

test('janela: inicial que não é de nenhum nome do meio não casa (JOSE M. não é JOSE CARLOS)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE M. SANTOS', 'JOSE CARLOS SANTOS'), false);
});

test('janela: inicial de um nome do meio do titular casa (MARIA A. SILVA)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA A. SILVA', 'MARIA APARECIDA SILVA'), true);
});

test('janela: nome do meio omitido, com ou sem conector, casa', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA SILVA', 'MARIA APARECIDA SILVA'), true);
  assert.equal(titularNoAssunto('PROJETO GD - MARIA DA SILVA', 'MARIA APARECIDA SILVA'), true);
});

test('janela: mais de 24 caracteres entre o primeiro e o último nome não casa', () => {
  // sem APARECIDA no assunto, a forma completa não casa; a janela passa de 24 caracteres
  assert.equal(titularNoAssunto('PROJETO GD - MARIA DE DA DOS DAS DO DE DA DOS DAS SILVA', 'MARIA APARECIDA SILVA'), false);
});

test('janela: o defeito inteiro — JOSE MARIA inativo não puxa o JOSE CARLOS ativo', () => {
  const CARLOS = P({ project_id: 'jc', codigo: 'PRJ-JC', titular: 'JOSE CARLOS SANTOS' });
  const MARIA = P({ project_id: 'jm', codigo: 'PRJ-JM', titular: 'JOSE MARIA SANTOS', status: 'completed', ativo: false });
  const id = identificarPorTexto(txt('PROJETO GD - JOSE MARIA SANTOS'), [CARLOS, MARIA]);
  assert.equal(id.tipo, 'nenhum');
});

test('janela: o mesmo nome identifica o titular que TEM esse nome do meio', () => {
  const CARLOS = P({ project_id: 'jc', codigo: 'PRJ-JC', titular: 'JOSE CARLOS SANTOS' });
  const MARIA = P({ project_id: 'jm', codigo: 'PRJ-JM', titular: 'JOSE MARIA SANTOS' });
  const id = identificarPorTexto(txt('PROJETO GD - JOSE MARIA SANTOS'), [CARLOS, MARIA]);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-JM');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('janela: vale a ocorrência compatível mesmo que a primeira traga outro nome do meio', () => {
  // rodada 4: cada nome no seu trecho; vale o trecho compatível
  assert.equal(titularNoAssunto('PROJETO GD - JOSE MARIA SANTOS - JOSE C. SANTOS', 'JOSE CARLOS SANTOS'), true);
  // no mesmo trecho, "JOSE MARIA SANTOS E" fica antes do nome: não é o trecho do titular
  assert.equal(titularNoAssunto('PROJETO GD - JOSE MARIA SANTOS E JOSE C. SANTOS', 'JOSE CARLOS SANTOS'), false);
});

// ── Correção pré-revisão 2: o caminho do DOCUMENTO usa a mesma regra estrita ──

test('documento: titular JOSE MARIA SANTOS não é achado do JOSE CARLOS (nome do meio diferente)', () => {
  const CARLOS = P({ project_id: 'jc', codigo: 'PRJ-JC', titular: 'JOSE CARLOS SANTOS' });
  const MARIA = P({ project_id: 'jm', codigo: 'PRJ-JM', titular: 'JOSE MARIA SANTOS', status: 'completed', ativo: false });
  const id = identificarPorDocumento({ nt: null, uc: null, titular: 'JOSE MARIA SANTOS' }, [CARLOS, MARIA]);
  assert.equal(id.tipo, 'nenhum');
});

test('documento: inicial do nome do meio (JOSE C. SANTOS) identifica JOSE CARLOS SANTOS', () => {
  const id = identificarPorDocumento({ nt: null, uc: null, titular: 'JOSE C. SANTOS' }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('documento: nome do meio omitido (JOSE SANTOS) identifica JOSE CARLOS SANTOS', () => {
  const id = identificarPorDocumento({ nt: null, uc: null, titular: 'JOSE SANTOS' }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
});

// ── mesmoTitular(cadastro, documento): a regra estrita, direto ──

test('mesmoTitular: mesmo nome, sem acento e sem caixa', () => {
  assert.equal(mesmoTitular('JOSE CARLOS SANTOS', 'José Carlos Santos'), true);
});

test('mesmoTitular: inicial de nome do meio', () => {
  assert.equal(mesmoTitular('JOSE CARLOS SANTOS', 'JOSE C. SANTOS'), true);
});

test('mesmoTitular: nome do meio omitido', () => {
  assert.equal(mesmoTitular('JOSE CARLOS SANTOS', 'JOSE SANTOS'), true);
});

test('mesmoTitular: conector entre o primeiro e o último nome', () => {
  assert.equal(mesmoTitular('MARIA APARECIDA SILVA', 'MARIA DA SILVA'), true);
});

test('mesmoTitular: nome do meio diferente não é o mesmo titular', () => {
  assert.equal(mesmoTitular('JOSE CARLOS SANTOS', 'JOSE MARIA SANTOS'), false);
});

test('mesmoTitular: uma palavra só nunca é o mesmo titular', () => {
  assert.equal(mesmoTitular('IVANILDO', 'IVANILDO'), false);
  assert.equal(mesmoTitular('JOSE CARLOS SANTOS', 'IVANILDO'), false);
});

test('mesmoTitular: razão social com LTDA no cadastro casa com o nome sem LTDA no documento', () => {
  assert.equal(mesmoTitular('OSSEL LOCACAO DE SALAS PARA VELORIOS LTDA', 'OSSEL LOCACAO DE SALAS PARA VELORIOS'), true);
});

// ── Rodada de correção 1 ──

test('nome do meio curto de outra pessoa (M, MA, 12) não casa pelo nome completo', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE M. SANTOS', 'JOSE SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE MA SANTOS', 'JOSE SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE 12 SANTOS', 'JOSE SANTOS'), false);
});

test('nome completo: palavra curta de outra pessoa entre os nomes não casa (JOSE CARLOS M SANTOS)', () => {
  assert.equal(titularNoAssunto('JOSE CARLOS M SANTOS', 'JOSE CARLOS SANTOS'), false);
});

test('palavra curta do PRÓPRIO titular (LU) casa; outra palavra curta (LI) não', () => {
  assert.equal(titularNoAssunto('PROJETO GD - ANA LU SOUZA', 'ANA LU SOUZA'), true);
  assert.equal(titularNoAssunto('PROJETO GD - ANA LI SOUZA', 'ANA LU SOUZA'), false);
});

test('mesmoTitular: JOSE M. SANTOS não é JOSE SANTOS (inicial que não é de nome do meio)', () => {
  assert.equal(mesmoTitular('JOSE SANTOS', 'JOSE M. SANTOS'), false);
});

test('sufixo de geração depois do último nome não casa com o cadastro sem sufixo', () => {
  for (const sufixo of ['JUNIOR', 'JR', 'FILHO', 'NETO', 'SOBRINHO']) {
    assert.equal(titularNoAssunto(`PROJETO GD - JOSE CARLOS SANTOS ${sufixo}`, 'JOSE CARLOS SANTOS'), false, sufixo);
  }
});

test('pai ativo e filho concluído: o assunto do filho não vai para o card do pai', () => {
  const PAI = P({ project_id: 'pai', codigo: 'PRJ-PAI', titular: 'JOSE CARLOS SANTOS' });
  const FILHO = P({ project_id: 'filho', codigo: 'PRJ-FILHO', titular: 'JOSE CARLOS SANTOS FILHO', status: 'completed', ativo: false });
  const id = identificarPorTexto(txt('PROJETO GD - JOSE CARLOS SANTOS FILHO'), [PAI, FILHO]);
  assert.equal(id.tipo, 'nenhum');
});

test('sufixo no titular: "… SANTOS JUNIOR" exige JUNIOR no texto', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS JUNIOR', 'JOSE CARLOS SANTOS JUNIOR'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS', 'JOSE CARLOS SANTOS JUNIOR'), false);
});

test('nome do arquivo com a UC de OUTRO projeto (ativo) não vai para este card', () => {
  assert.equal(nomeTrazOutroProjeto('CARTA_2222222222.pdf', A, TODOS), true);
});

test('combinar: texto (protocolo) e documento (UC) do MESMO projeto ficam com o sinal do texto', () => {
  const t = identificarPorTexto(txt('NT 123456789'), TODOS);
  const d = identificarPorDocumento({ nt: null, uc: '1111111111', titular: null }, TODOS);
  const r = combinar(t, d);
  assert.equal(r.tipo === 'achado' && r.projeto.codigo, 'PRJ-A');
  assert.equal(r.tipo === 'achado' && r.por, 'protocolo');
});

test('número de projeto INATIVO no texto + nome do titular de um ATIVO diferente → conflito', () => {
  const id = identificarPorTexto(txt('VISTORIA GD 555555555 - JOSE CARLOS SANTOS'), TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('conflito no caminho do DOCUMENTO: NT de A e titular de B → conflito', () => {
  const id = identificarPorDocumento({ nt: '123456789', uc: null, titular: 'JOSE CARLOS SANTOS' }, TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('combinar: inativo de um lado e nenhum do outro → inativo, nos dois sentidos', () => {
  const inativo = identificarPorTexto(txt('VISTORIA GD 555555555'), TODOS);
  const nada = identificarPorDocumento({ nt: null, uc: null, titular: null }, TODOS);
  assert.equal(combinar(inativo, nada).tipo, 'inativo');
  assert.equal(combinar(nada, inativo).tipo, 'inativo');
});

test('combinar: inativo de um projeto e achado de OUTRO → conflito', () => {
  const inativo = identificarPorTexto(txt('VISTORIA GD 555555555'), TODOS);
  const achado = identificarPorDocumento({ nt: '987654321', uc: null, titular: null }, TODOS);
  assert.equal(combinar(inativo, achado).tipo, 'conflito');
});

// ── Rodada de correção 2 ──

test('numeral no nome do titular (POSTO 7, SUPERMERCADO 3) casa com o próprio cadastro', () => {
  // rodada 4: o nome isolado por " - " (sem o separador, "PROJETO" ficaria antes do nome)
  assert.equal(titularNoAssunto('PROJETO GD - POSTO 7 DE SETEMBRO', 'POSTO 7 DE SETEMBRO LTDA'), true);
  assert.equal(titularNoAssunto('SUPERMERCADO 3 IRMAOS LTDA', 'SUPERMERCADO 3 IRMAOS LTDA'), true);
});

test('numeral no nome do titular: POSTO 8 não casa com POSTO 7 DE SETEMBRO', () => {
  // rodada 4: com o separador, quem barra é o numeral, não a palavra "PROJETO" antes do nome
  assert.equal(titularNoAssunto('PROJETO GD - POSTO 8 DE SETEMBRO', 'POSTO 7 DE SETEMBRO LTDA'), false);
});

test('inicial D não é inicial de DE (conector): MARIA D SILVA não casa com MARIA DE FATIMA SILVA', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA D SILVA', 'MARIA DE FATIMA SILVA'), false);
});

test('inicial D não é inicial de DOS (conector): JOSE D SANTOS não casa com JOSE DOS SANTOS', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE D SANTOS', 'JOSE DOS SANTOS'), false);
});

test('inicial F de um nome do meio (FATIMA) continua casando', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA F SILVA', 'MARIA DE FATIMA SILVA'), true);
});

test('sufixo JR no cadastro é exigido no texto, e JR e JUNIOR são equivalentes', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS', 'JOSE CARLOS SANTOS JR'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS JUNIOR', 'JOSE CARLOS SANTOS JR'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS JR', 'JOSE CARLOS SANTOS JR'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS JR', 'JOSE CARLOS SANTOS JUNIOR'), true);
});

// ── Rodada de correção 3 ──

test('dígito não vira inicial: POSTO 1 DE SETEMBRO não casa com POSTO 17 DE SETEMBRO LTDA', () => {
  assert.equal(titularNoAssunto('PROJETO GD - POSTO 1 DE SETEMBRO', 'POSTO 17 DE SETEMBRO LTDA'), false);
});

test('dígito não vira inicial: POSTO 2 DE SETEMBRO não casa com POSTO 20 DE SETEMBRO LTDA', () => {
  assert.equal(titularNoAssunto('PROJETO GD - POSTO 2 DE SETEMBRO', 'POSTO 20 DE SETEMBRO LTDA'), false);
});

test('dígito de um numeral não vira inicial: o 1 de 17 não casa como inicial', () => {
  assert.equal(titularNoAssunto('PROJETO GD - POSTO 17 1 SETEMBRO', 'POSTO 17 DE SETEMBRO LTDA'), false);
});

test('numeral obrigatório: CONDOMINIO EDIFICIO ALFA 2 não casa com ALFA 3', () => {
  assert.equal(titularNoAssunto('PROJETO GD - CONDOMINIO EDIFICIO ALFA 2', 'CONDOMINIO EDIFICIO ALFA 3'), false);
});

test('numeral obrigatório: ALFA 3 casa com o próprio cadastro', () => {
  assert.equal(titularNoAssunto('PROJETO GD - CONDOMINIO EDIFICIO ALFA 3', 'CONDOMINIO EDIFICIO ALFA 3'), true);
});

test('numeral obrigatório: POSTO DE SETEMBRO não casa com POSTO 7 DE SETEMBRO LTDA', () => {
  assert.equal(titularNoAssunto('PROJETO GD - POSTO DE SETEMBRO', 'POSTO 7 DE SETEMBRO LTDA'), false);
});

test('numeral obrigatório: POSTO 17 DE SETEMBRO não casa com POSTO 1 DE SETEMBRO', () => {
  assert.equal(titularNoAssunto('PROJETO GD - POSTO 17 DE SETEMBRO', 'POSTO 1 DE SETEMBRO'), false);
});

test('numeral obrigatório: SUPERMERCADO 3 IRMAOS casa com o próprio cadastro (LTDA)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - SUPERMERCADO 3 IRMAOS', 'SUPERMERCADO 3 IRMAOS LTDA'), true);
});

test('numeral do meio não pode faltar na janela: FILIAL NORTE não casa com FILIAL CENTRO 3 NORTE', () => {
  assert.equal(titularNoAssunto('PROJETO GD - FILIAL NORTE', 'FILIAL CENTRO 3 NORTE'), false);
});

test('nome do meio alfabético pode faltar na janela: FILIAL 3 NORTE casa com FILIAL CENTRO 3 NORTE', () => {
  assert.equal(titularNoAssunto('PROJETO GD - FILIAL 3 NORTE', 'FILIAL CENTRO 3 NORTE'), true);
});

test('sufixo: AUTO PECAS DO NETO LTDA casa consigo (NETO depois de conector não é sufixo)', () => {
  assert.equal(titularNoAssunto('AUTO PECAS DO NETO LTDA', 'AUTO PECAS DO NETO LTDA'), true);
});

test('sufixo: MECANICA DO JUNIOR LTDA casa consigo (JUNIOR depois de conector não é sufixo)', () => {
  assert.equal(titularNoAssunto('MECANICA DO JUNIOR LTDA', 'MECANICA DO JUNIOR LTDA'), true);
});

test('sufixo: BAR DO NETO LTDA casa consigo', () => {
  assert.equal(titularNoAssunto('BAR DO NETO LTDA', 'BAR DO NETO LTDA'), true);
});

test('sufixo: ANTONIO NETO casa consigo (só um nome antes de NETO, não é sufixo)', () => {
  assert.equal(titularNoAssunto('ANTONIO NETO', 'ANTONIO NETO'), true);
});

test('sufixo: JOSE CARLOS SANTOS NETO continua exigindo NETO (pai × neto não casam)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS', 'JOSE CARLOS SANTOS NETO'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS NETO', 'JOSE CARLOS SANTOS NETO'), true);
});

// ── Rodada de correção 4: o nome ocupa um TRECHO INTEIRO do assunto ──
// Trecho = o que fica entre " - " (hífen, meia-risca ou travessão, com espaços) e ":".

// Fronteira: nada de palavra livre antes do primeiro nome nem depois do último
test('fronteira: palavra antes do primeiro nome não casa (MARIA JOSE SANTOS não é JOSE SANTOS)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA JOSE SANTOS', 'JOSE SANTOS'), false);
});

test('fronteira: palavra depois do último nome não casa (JOSE SANTOS PEREIRA não é JOSE SANTOS)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE SANTOS PEREIRA', 'JOSE SANTOS'), false);
});

test('fronteira: MEGA LOJA 2 não é LOJA 2; LOJA 2 casa consigo', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MEGA LOJA 2', 'LOJA 2'), false);
  assert.equal(titularNoAssunto('PROJETO GD - LOJA 2', 'LOJA 2'), true);
});

test('fronteira: MARIA JOSE SANTOS concluída não puxa o JOSE SANTOS ativo', () => {
  const JOSE = P({ project_id: 'js', codigo: 'PRJ-JS', titular: 'JOSE SANTOS' });
  const MARIA = P({ project_id: 'mjs', codigo: 'PRJ-MJS', titular: 'MARIA JOSE SANTOS', status: 'completed', ativo: false });
  assert.equal(identificarPorTexto(txt('VISTORIA - MARIA JOSE SANTOS - NT 1'), [JOSE, MARIA]).tipo, 'nenhum');
  assert.equal(identificarPorTexto(txt('VISTORIA - JOSE SANTOS PEREIRA - NT 1'), [JOSE]).tipo, 'nenhum');
});

test('fronteira no documento: o nome extraído é um trecho só', () => {
  assert.equal(mesmoTitular('JOSE SANTOS', 'MARIA JOSE SANTOS'), false);
  assert.equal(mesmoTitular('JOSE SANTOS', 'JOSE SANTOS PEREIRA'), false);
  assert.equal(mesmoTitular('LOJA 2', 'MEGA LOJA 2'), false);
});

test('fronteira: palavra curta do cadastro antes do primeiro nome ou depois do último não pode faltar', () => {
  assert.equal(titularNoAssunto('PROJETO GD - ANDRE LUIZ', 'ANDRE LUIZ DO O'), false);
  assert.equal(titularNoAssunto('PROJETO GD - ANDRE LUIZ DO O', 'ANDRE LUIZ DO O'), true);
});

test('fronteira: conector solto também não fica na borda do trecho', () => {
  assert.equal(titularNoAssunto('PROJETO GD - DE JOSE SANTOS', 'JOSE SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - DA MARIA SILVA', 'MARIA APARECIDA SILVA'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE SANTOS E', 'JOSE SANTOS'), false);
});

test('custo aceito: nome sem separador no assunto não identifica', () => {
  assert.equal(titularNoAssunto('PROJETO GD JOSE CARLOS SANTOS 5KWP', 'JOSE CARLOS SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD-JOSE CARLOS SANTOS', 'JOSE CARLOS SANTOS'), false); // hífen colado não separa
});

// G1: token com dígito (2B, 17A, LOJA2) é numeral e não pode faltar
test('G1: EDIFICIO SOLAR TORRE NORTE não casa com EDIFICIO SOLAR 2B TORRE NORTE', () => {
  assert.equal(titularNoAssunto('PROJETO GD - EDIFICIO SOLAR TORRE NORTE', 'EDIFICIO SOLAR 2B TORRE NORTE'), false);
});

test('G1: LOJA CENTRO não casa com LOJA 2A CENTRO', () => {
  assert.equal(titularNoAssunto('PROJETO GD - LOJA CENTRO', 'LOJA 2A CENTRO'), false);
});

test('G1: SUPER CENTRO não casa com SUPER LOJA2 CENTRO', () => {
  assert.equal(titularNoAssunto('PROJETO GD - SUPER CENTRO', 'SUPER LOJA2 CENTRO'), false);
});

test('G1: o alfanumérico é token inteiro (2B não casa 2A) e fica na posição dele', () => {
  assert.equal(titularNoAssunto('PROJETO GD - LOJA 2B CENTRO', 'LOJA 2A CENTRO'), false);
  assert.equal(titularNoAssunto('PROJETO GD - LOJA CENTRO 2A', 'LOJA 2A CENTRO'), false);
});

test('G1: o cadastro com alfanumérico casa consigo, e nome alfabético do meio ainda pode faltar', () => {
  assert.equal(titularNoAssunto('PROJETO GD - EDIFICIO SOLAR 2B TORRE NORTE', 'EDIFICIO SOLAR 2B TORRE NORTE'), true);
  assert.equal(titularNoAssunto('PROJETO GD - EDIFICIO SOLAR 2B NORTE', 'EDIFICIO SOLAR 2B TORRE NORTE'), true);
  assert.equal(titularNoAssunto('PROJETO GD - LOJA 2A CENTRO', 'LOJA 2A CENTRO'), true);
  assert.equal(titularNoAssunto('PROJETO GD - SUPER LOJA2 CENTRO', 'SUPER LOJA2 CENTRO'), true);
});

// G2: numeral a mais no assunto, que o cadastro não tem
test('G2: CONDOMINIO EDIFICIO ALFA 2 não casa com CONDOMINIO EDIFICIO ALFA', () => {
  assert.equal(titularNoAssunto('PROJETO GD - CONDOMINIO EDIFICIO ALFA 2', 'CONDOMINIO EDIFICIO ALFA'), false);
});

test('G2: ALFA ativo e ALFA 2 concluído — o e-mail do ALFA 2 não vai para o card do ALFA', () => {
  const ALFA = P({ project_id: 'alfa', codigo: 'PRJ-ALFA', titular: 'CONDOMINIO EDIFICIO ALFA' });
  const ALFA2 = P({ project_id: 'alfa2', codigo: 'PRJ-ALFA2', titular: 'CONDOMINIO EDIFICIO ALFA 2', status: 'completed', ativo: false });
  assert.equal(identificarPorTexto(txt('PROJETO GD - CONDOMINIO EDIFICIO ALFA 2'), [ALFA, ALFA2]).tipo, 'nenhum');
});

test('G2: numeral a mais no meio também não casa (LOJA 2 CENTRO não é LOJA CENTRO)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - LOJA 2 CENTRO', 'LOJA CENTRO'), false);
});

test('G2 no documento: numeral a mais não é o mesmo titular', () => {
  assert.equal(mesmoTitular('CONDOMINIO EDIFICIO ALFA', 'CONDOMINIO EDIFICIO ALFA 2'), false);
});

// G3: romano e ordinal são sufixo de geração
test('G3: SANTOS III não casa com SANTOS II', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS III', 'JOSE CARLOS SANTOS II'), false);
});

test('G3: sufixo romano presente de um lado só não casa', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS', 'JOSE CARLOS SANTOS II'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS II', 'JOSE CARLOS SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS IV', 'JOSE CARLOS SANTOS III'), false);
});

test('G3: SEGUNDO e TERCEIRO a mais não casam com o cadastro sem sufixo', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS SEGUNDO', 'JOSE CARLOS SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS TERCEIRO', 'JOSE CARLOS SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS TERCEIRO', 'JOSE CARLOS SANTOS II'), false);
});

test('G3: II é SEGUNDO e III é TERCEIRO', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS SEGUNDO', 'JOSE CARLOS SANTOS II'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS II', 'JOSE CARLOS SANTOS SEGUNDO'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS TERCEIRO', 'JOSE CARLOS SANTOS III'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS III', 'JOSE CARLOS SANTOS TERCEIRO'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SANTOS II', 'JOSE CARLOS SANTOS II'), true);
});

test('G3: o II ativo e o III concluído — o e-mail do III não vai para o card do II', () => {
  const II = P({ project_id: 'ii', codigo: 'PRJ-II', titular: 'JOSE CARLOS SANTOS II' });
  const III = P({ project_id: 'iii', codigo: 'PRJ-III', titular: 'JOSE CARLOS SANTOS III', status: 'completed', ativo: false });
  assert.equal(identificarPorTexto(txt('PROJETO GD - JOSE CARLOS SANTOS III'), [II, III]).tipo, 'nenhum');
});

// Sufixo de empresa: pode estar no cadastro e faltar no trecho, ou o contrário
test('sufixo de empresa (ME, S/A, S.A., EPP, EIRELI, LTDA) pode faltar de um lado', () => {
  assert.equal(titularNoAssunto('PROJETO GD - PADARIA PAO QUENTE', 'PADARIA PAO QUENTE ME'), true);
  assert.equal(titularNoAssunto('PROJETO GD - ALFA ENERGIA', 'ALFA ENERGIA S/A'), true);
  assert.equal(titularNoAssunto('PROJETO GD - ALFA ENERGIA S.A.', 'ALFA ENERGIA LTDA'), true);
  assert.equal(titularNoAssunto('PROJETO GD - PADARIA PAO QUENTE LTDA ME', 'PADARIA PAO QUENTE EIRELI EPP'), true);
  assert.equal(mesmoTitular('ALFA ENERGIA S/A', 'ALFA ENERGIA'), true);
});

test('SA sozinho é sobrenome (Sá), não sufixo de empresa; a sociedade anônima vem escrita S/A ou S.A.', () => {
  // Sá a mais depois do último nome é a classe que a fronteira fecha
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SA', 'JOSE CARLOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS', 'JOSE CARLOS SA'), false);
  assert.equal(mesmoTitular('JOSE CARLOS', 'JOSE CARLOS SA'), false);
  assert.equal(titularNoAssunto('PROJETO GD - ALFA ENERGIA SA', 'ALFA ENERGIA'), false);
  // Sá consigo
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS SA', 'JOSE CARLOS SA'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS DE SA', 'JOSE CARLOS DE SA'), true);
  // S/A e S.A. continuam sufixo, dos dois lados
  assert.equal(titularNoAssunto('PROJETO GD - CONSTRUTORA ALFA S/A', 'CONSTRUTORA ALFA'), true);
  assert.equal(titularNoAssunto('PROJETO GD - CONSTRUTORA ALFA S.A.', 'CONSTRUTORA ALFA'), true);
  assert.equal(titularNoAssunto('PROJETO GD - CONSTRUTORA ALFA', 'CONSTRUTORA ALFA S.A.'), true);
});

// Separadores: os prefixos do assunto viram trechos próprios
test('trecho: os formatos reais do assunto isolam o nome', () => {
  const t = 'JOSE CARLOS SANTOS';
  assert.equal(titularNoAssunto('TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 391901851', t), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - JOSE CARLOS SANTOS - NT 390698066', t), true);
  assert.equal(titularNoAssunto('Re: FW: ENC: PROJETO GD - José Carlos Santos', t), true);
  assert.equal(titularNoAssunto('Resposta Automática - VISTORIA - JOSE CARLOS SANTOS - NT 390698066', t), true);
  assert.equal(titularNoAssunto('Undeliverable: TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 391901851', t), true);
  assert.equal(titularNoAssunto('TROCA DE RELÓGIO – JOSE CARLOS SANTOS — NT 391901851', t), true); // meia-risca e travessão
  assert.equal(titularNoAssunto('PROJETO GD:JOSE CARLOS SANTOS', t), true);
});

// Positivos que não podem regredir, no formato real do assunto
test('positivos que não regridem: inicial, meio omitido, conector, empresa, numeral, pai × filho', () => {
  assert.equal(titularNoAssunto('RE: VISTORIA - MARIA A. SILVA - NT 1', 'MARIA APARECIDA SILVA'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - MARIA SILVA - NT 1', 'MARIA APARECIDA SILVA'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - MARIA DA SILVA - NT 1', 'MARIA APARECIDA SILVA'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - MARIA A. DA SILVA - NT 1', 'MARIA APARECIDA SILVA'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - POSTO 7 DE SETEMBRO LTDA - NT 1', 'POSTO 7 DE SETEMBRO LTDA'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - FILIAL 3 NORTE - NT 1', 'FILIAL CENTRO 3 NORTE'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - SUPERMERCADO 3 IRMAOS - NT 1', 'SUPERMERCADO 3 IRMAOS LTDA'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - BAR DO NETO LTDA - NT 1', 'BAR DO NETO LTDA'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - JOSE CARLOS SANTOS FILHO - NT 1', 'JOSE CARLOS SANTOS FILHO'), true);
  assert.equal(titularNoAssunto('RE: VISTORIA - JOSE CARLOS SANTOS FILHO - NT 1', 'JOSE CARLOS SANTOS'), false);
  assert.equal(titularNoAssunto('RE: VISTORIA - JOSE CARLOS SANTOS - NT 1', 'JOSE CARLOS SANTOS FILHO'), false);
});

test('nome do meio fora de ordem não casa (a ordem do cadastro vale)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE ANTONIO CARLOS SANTOS', 'JOSE CARLOS ANTONIO SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS ANTONIO SANTOS', 'JOSE CARLOS ANTONIO SANTOS'), true);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE C. A. SANTOS', 'JOSE CARLOS ANTONIO SANTOS'), true);
});

test('nome no CORPO não identifica nem quando está isolado por separador ("Atendente: <nome> - …")', () => {
  // com a regra de trecho, a assinatura comum ("Atenciosamente, <nome> — …") já não casaria por acaso;
  // este caso isola o nome no corpo e prova que o corpo não é lido para o nome
  const id = identificarPorTexto(txt('RE: sua solicitação', 'Atendente: Jose Carlos Santos - Serviço da Enel'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('inicial vale só para nome do meio: o primeiro e o último nome vêm inteiros', () => {
  assert.equal(titularNoAssunto('PROJETO GD - J CARLOS SANTOS', 'JOSE CARLOS SANTOS'), false);
  assert.equal(titularNoAssunto('PROJETO GD - JOSE CARLOS S', 'JOSE CARLOS SANTOS'), false);
  assert.equal(mesmoTitular('JOSE CARLOS SANTOS', 'J. C. SANTOS'), false);
});
