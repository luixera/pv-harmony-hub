import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerListaCpfl, normalizarStatusCpfl, urlListaCpfl, urlParecerCpfl } from '../src/conectores/cpfl-api.js';

/**
 * A API interna do portal da CPFL (descoberta de 14/09/2026): a lista
 * `getprojetosorcamentoconexao` vem paginada, cada item com o selo genérico
 * (nmStatusTipo) e o status DETALHADO (status, separado por "|"). O detalhado
 * é o que diz em que ponto do ciclo o projeto está — inclusive a vistoria.
 */

// Formato real da resposta (sem dados pessoais além de nomes de UFV fictícios).
const RESPOSTA = {
  data: {
    quantidadeItem: 3,
    projetoOrcamentoConexao: {
      $values: [
        { codigoProjeto: 10087062, titulo: 'UFV JOSÉ', numeroAtividade: '2219727202', numeroNotaServico: '880947585',
          nomeMunicipio: 'SAO JOSE DO RIO PRETO', dataCadastro: '2026-09-11T09:23:03.8', dataAtualizacao: '09/14/2026 10:25:40',
          status: 'SOLICITAR VISTORIA|DOCUMENTOS APROVADOS', codigoStatus: '123|1361', nmStatusTipo: 'Pendente', nmSubStatus: null },
        { codigoProjeto: 10083970, titulo: 'UFV HELOISA', numeroAtividade: '2208680475', numeroNotaServico: '880382903',
          nomeMunicipio: 'ITU', dataCadastro: '2026-09-02T13:09:44', dataAtualizacao: null,
          status: 'PROJETO ENCERRADO', codigoStatus: '700', nmStatusTipo: 'Aprovado', nmSubStatus: null },
        { codigoProjeto: 10088069, titulo: 'UFV SEM NUMERO', numeroAtividade: null, numeroNotaServico: null,
          nomeMunicipio: 'SALTO', dataCadastro: '2026-09-14T18:17:13', dataAtualizacao: null,
          status: null, codigoStatus: null, nmStatusTipo: 'Incompleto', nmSubStatus: 'Incompleto' },
      ],
    },
  },
};

test('normaliza o status detalhado: partes separadas por "|", sem repetição, em ordem, maiúsculas', () => {
  assert.equal(normalizarStatusCpfl('SOLICITAR VISTORIA|DOCUMENTOS APROVADOS'), 'DOCUMENTOS APROVADOS | SOLICITAR VISTORIA');
  assert.equal(normalizarStatusCpfl('DOCUMENTOS APROVADOS|SOLICITAR VISTORIA'), 'DOCUMENTOS APROVADOS | SOLICITAR VISTORIA');
  // as duas ordens do portal viram a MESMA chave de tradução
  assert.equal(normalizarStatusCpfl('DOCUMENTOS INDEFERIDOS|DOCUMENTOS INDEFERIDOS'), 'DOCUMENTOS INDEFERIDOS');
  assert.equal(normalizarStatusCpfl('Solicitação de Conexão em Análise|Solicitação de Conexão em Análise'), 'SOLICITAÇÃO DE CONEXÃO EM ANÁLISE');
  assert.equal(normalizarStatusCpfl(null), '');
});

test('lê a lista: protocolo = atividade, status = detalhado normalizado, selo e datas no raw', () => {
  const { itens, total } = lerListaCpfl(RESPOSTA);
  assert.equal(total, 3);
  assert.equal(itens.length, 2, 'item sem atividade fica de fora');
  const [a, b] = itens;
  assert.equal(a.protocolo, '2219727202');
  assert.equal(a.titular, 'UFV JOSÉ');
  assert.equal(a.status, 'DOCUMENTOS APROVADOS | SOLICITAR VISTORIA');
  assert.equal(a.raw.selo, 'Pendente');
  assert.equal(a.raw.codigoStatus, '123|1361');
  assert.equal(a.raw.codigoProjeto, '10087062');
  assert.equal(a.raw['Última atualização'], '14/09/2026');   // convertido do formato americano
  assert.equal(b.status, 'PROJETO ENCERRADO');
  assert.equal(b.raw.selo, 'Aprovado');
});

test('monta as URLs da API como o site monta', () => {
  const u = urlListaCpfl('a@b.com', 2, 200);
  assert.match(u, /^https:\/\/www\.cpfl\.com\.br\/gestao-projetos\/api\/drupalApi\/ServerSide\?/);
  assert.match(u, /params%5BemailProfissionalResponsavel%5D=a%40b\.com/);
  assert.match(u, /params%5BnumeroDaPagina%5D=2/);
  assert.match(u, /params%5BquantidadeItensPorPagina%5D=200/);
  assert.match(u, /endpoint=%2Fapi%2Fexternal%2Fgetprojetosorcamentoconexao/);
  assert.match(urlParecerCpfl(10083970), /endpoint=%2Fapi%2Finternal%2Fgetdetalhesparecer%2F10083970/);
});
