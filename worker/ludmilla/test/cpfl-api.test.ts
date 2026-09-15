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

// ── detalhe do projeto: anexos, cliente, UCs, arquivo ────────────────────────
import { lerAnexosCpfl, lerClienteCpfl, lerDetalhesCpfl, lerArquivoCpfl, urlBaixarArquivoCpfl } from '../src/conectores/cpfl-api.js';

test('anexos: só os emitidos pela CPFL (ANEXOS CPFL), não os que o projetista subiu', () => {
  const r = lerAnexosCpfl({ data: { $values: [
    { idArquivo: 'a.pdf', nomeArquivo: 'Relacionamento_Operacional_2199687070.pdf', descricao: '27-8-2026-Relacionamento_Operacional_2199687070.pdf', tipoProjeto: 'ANEXOS CPFL', tipoArquivo: 'CPFL', extensao: 'pdf', data: '27/8/2026' },
    { idArquivo: 'b.pdf', nomeArquivo: 'Orçamento_Conexão_Simplificado_2199687070.pdf', descricao: 'x', tipoProjeto: 'ANEXOS CPFL', tipoArquivo: 'CPFL', extensao: 'pdf', data: '27/8/2026' },
    { idArquivo: 'c.pdf', nomeArquivo: 'unifilar_PRJ-71443.pdf', descricao: 'x', tipoProjeto: 'ANÁLISE TÉCNICA', tipoArquivo: 'DIAGRAMA UNIFILAR', extensao: 'pdf', data: '25/8/2026' },
  ] } });
  assert.deepEqual(r.map(a => a.idArquivo), ['a.pdf', 'b.pdf']);
  assert.equal(r[0].nomeArquivo, 'Relacionamento_Operacional_2199687070.pdf');
  assert.equal(r[0].data, '27/08/2026');
});

test('cliente: CPF/CNPJ só dígitos e nome completo', () => {
  const c = lerClienteCpfl({ data: { nome: 'JOSÉ', sobrenome: 'DA SILVA', numeroDocumento: '123.456.789-09', descricaoTipoDocumento: 'CPF' } });
  assert.equal(c.documento, '12345678909');
  assert.equal(c.nome, 'JOSÉ DA SILVA');
  assert.equal(lerClienteCpfl(null).documento, '');
});

test('detalhes: as UCs do projeto (instalação atual e nova), só dígitos', () => {
  const d = lerDetalhesCpfl({ data: { numeroInstalacao: 20323603, numeroInstalacaoNova: 188568503505, titulo: 'UFV X' } });
  assert.deepEqual(d.ucs, ['20323603', '188568503505']);
  assert.deepEqual(lerDetalhesCpfl({ data: { numeroInstalacao: null, numeroInstalacaoNova: null } }).ucs, []);
});

test('arquivo: conteudoArquivo em base64 (com ou sem prefixo data:) vira bytes', () => {
  const b = lerArquivoCpfl({ data: { conteudoArquivo: 'data:application/pdf;base64,JVBERi0xLjQK' } });
  assert.equal(b?.toString('latin1').slice(0, 5), '%PDF-');
  assert.equal(lerArquivoCpfl({ data: { conteudoArquivo: 'JVBERi0xLjQK' } })?.length, 9);
  assert.equal(lerArquivoCpfl({ data: {} }), null);
  assert.match(urlBaixarArquivoCpfl('443a117c.pdf'), /endpoint=%2Fapi%2Farquivos%2Fbaixararquivo%2F443a117c\.pdf/);
});

// ── pareceres: a linha do tempo da tela do projeto ───────────────────────────
import { lerPareceresCpfl, vistoriaAprovadaCpfl } from '../src/conectores/cpfl-api.js';

// Formato real (14/09/2026): analises (etapas) + pareceres (o "Mostrar parecer")
const PARECERES = { data: { analisesPrincipais: {
  analises: { $values: [
    { tipoProjetoAnalise: 'ORÇAMENTO', codigoInboxGrupo: 1, dataEntrada: '07/24/2026 12:00:31', codigoStatus: 1357, nomeStatus: 'AGUARDANDO VALIDAÇÃO', tipoStatus: 'Em Andamento' },
    { tipoProjetoAnalise: 'VISTORIA', codigoInboxGrupo: 2, dataEntrada: '08/10/2026 09:00:00', codigoStatus: 400, nomeStatus: 'EM ANÁLISE DE VISTORIA', tipoStatus: 'Em Andamento' },
    { tipoProjetoAnalise: 'VISTORIA', codigoInboxGrupo: 3, dataEntrada: '08/25/2026 09:00:00', codigoStatus: 400, nomeStatus: 'EM ANÁLISE DE VISTORIA', tipoStatus: 'Em Andamento' },
  ] },
  pareceres: { $values: [
    { codigoInboxUsuario: 11, codigoInboxGrupo: 2, dataParecer: '08/18/2026 10:00:00', codigoStatus: 401, nomeStatus: 'VISTORIA REPROVADA - AGUARDANDO SOLICITAR VISTORIA E CONEXÃO', tipoStatus: 'Reprovado', responsavelParecer: 'X', respostaParecerExterno: 'Padrão de entrada fora da norma. Regularizar e solicitar nova vistoria.', respostaParecer: 'interno' },
    { codigoInboxUsuario: 12, codigoInboxGrupo: 3, dataParecer: '09/01/2026 08:30:00', codigoStatus: 405, nomeStatus: 'VISTORIA APROVADA', tipoStatus: 'Aprovado', responsavelParecer: 'Y', respostaParecerExterno: 'Vistoria aprovada.  Conexão liberada.', respostaParecer: 'interno' },
    { codigoInboxUsuario: 10, codigoInboxGrupo: 1, dataParecer: '07/25/2026 07:42:55', codigoStatus: 1361, nomeStatus: 'ANÁLISE COMERCIAL - DOCUMENTOS APROVADOS', tipoStatus: 'Aprovado', responsavelParecer: 'Z', respostaParecerExterno: 'Documentos deferidos.', respostaParecer: 'interno' },
  ] },
} } };

test('pareceres: em ordem de data, com a análise a que pertencem, chave estável e texto externo', () => {
  const p = lerPareceresCpfl(PARECERES);
  assert.deepEqual(p.map(x => x.chave), ['10', '11', '12']);            // ordenado por data, não pela ordem da API
  assert.equal(p[0].analise, 'ORÇAMENTO');
  assert.equal(p[1].analise, 'VISTORIA');
  assert.equal(p[1].data, '18/08/2026');
  assert.equal(p[2].status, 'VISTORIA APROVADA');
  assert.equal(p[2].texto, 'Vistoria aprovada. Conexão liberada.');    // texto EXTERNO (o que a tela mostra), espaços normalizados
  assert.deepEqual(lerPareceresCpfl(null), []);
});

test('vistoria aprovada = o último parecer de vistoria/ligação é aprovação', () => {
  assert.equal(vistoriaAprovadaCpfl(lerPareceresCpfl(PARECERES)), 'sim');
  // reprovada por último → não
  const reprovada = structuredClone(PARECERES);
  reprovada.data.analisesPrincipais.pareceres.$values[1].nomeStatus = 'LIGAÇÃO REPROVADA';
  reprovada.data.analisesPrincipais.pareceres.$values[1].tipoStatus = 'Reprovado';
  assert.equal(vistoriaAprovadaCpfl(lerPareceresCpfl(reprovada)), 'nao');
  // sem parecer de vistoria → desconhecido (vazio)
  assert.equal(vistoriaAprovadaCpfl(lerPareceresCpfl(PARECERES).filter(x => x.analise !== 'VISTORIA')), '');
});
