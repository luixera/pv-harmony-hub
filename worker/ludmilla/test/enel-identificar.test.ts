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
  assert.equal(titularNoAssunto('PROJETO GD - JOSE MARIA SANTOS E JOSE C. SANTOS', 'JOSE CARLOS SANTOS'), true);
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
  assert.equal(titularNoAssunto('PROJETO POSTO 7 DE SETEMBRO', 'POSTO 7 DE SETEMBRO LTDA'), true);
  assert.equal(titularNoAssunto('SUPERMERCADO 3 IRMAOS LTDA', 'SUPERMERCADO 3 IRMAOS LTDA'), true);
});

test('numeral no nome do titular: POSTO 8 não casa com POSTO 7 DE SETEMBRO', () => {
  assert.equal(titularNoAssunto('PROJETO POSTO 8 DE SETEMBRO', 'POSTO 7 DE SETEMBRO LTDA'), false);
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
