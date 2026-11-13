import { describe, it, expect } from 'vitest';
import { normalizar, indicesDasColunas, solicitacaoDaLinha, montarEnvio, MAX_ITENS } from './leitura.js';

// Cabeçalho real da lista do Portal GD da Elektro (imagem de 13/11/2026).
const CABECALHO = [
  'PROTOCOLO DA SOLICITAÇÃO', 'STATUS', 'CÓDIGO DE IDENTIFICAÇÃO DO CLIENTE',
  'TIPO DE IDENTIFICAÇÃO', 'ENDEREÇO', 'DATA DE INGRESSO', 'ACOMPANHAR',
];

describe('normalizar', () => {
  it('tira acento, caixa e espaço repetido', () => {
    expect(normalizar('  Em  Análise   Técnica ')).toBe('EM ANALISE TECNICA');
    expect(normalizar('Solicitação')).toBe('SOLICITACAO');
  });
  it('aguenta vazio e não-texto', () => {
    expect(normalizar('')).toBe('');
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});

describe('indicesDasColunas', () => {
  it('acha protocolo e status no cabeçalho real', () => {
    expect(indicesDasColunas(CABECALHO)).toEqual({ protocolo: 0, status: 1 });
  });
  it('acha mesmo com a ordem trocada', () => {
    expect(indicesDasColunas(['Status', 'Endereço', 'Protocolo da Solicitação']))
      .toEqual({ protocolo: 2, status: 0 });
  });
  it('não confunde a coluna STATUS com o filtro "TIPO DE STATUS"', () => {
    // numa tabela sem a coluna de protocolo não há o que ler
    expect(indicesDasColunas(['Número do Protocolo', 'Tipo de Status', 'Data'])).toBeNull();
  });
  it('devolve null quando falta protocolo ou status', () => {
    expect(indicesDasColunas(['Endereço', 'Data de Ingresso'])).toBeNull();
    expect(indicesDasColunas([])).toBeNull();
  });
});

describe('solicitacaoDaLinha', () => {
  it('separa o protocolo do titular quando vêm em duas linhas', () => {
    expect(solicitacaoDaLinha('2611064107\nWILLIAM RICARDO BALDESSIN TAIETE', 'Aguardando solicitação de vistoria e Conexão'))
      .toEqual({ protocolo: '2611064107', titular: 'WILLIAM RICARDO BALDESSIN TAIETE', status: 'Aguardando solicitação de vistoria e Conexão' });
  });
  it('separa mesmo quando vêm na mesma linha', () => {
    expect(solicitacaoDaLinha('2610272197 ELIANA DE FREITAS GONÇALVES SILVA', 'Solicitação Concluída'))
      .toEqual({ protocolo: '2610272197', titular: 'ELIANA DE FREITAS GONÇALVES SILVA', status: 'Solicitação Concluída' });
  });
  it('colapsa espaços e aguenta o titular ausente', () => {
    expect(solicitacaoDaLinha('  2611043694  ', '  Em Análise Técnica '))
      .toEqual({ protocolo: '2611043694', titular: '', status: 'Em Análise Técnica' });
  });
  it('devolve null sem protocolo ou sem status', () => {
    expect(solicitacaoDaLinha('WILLIAM RICARDO', 'Em Análise Técnica')).toBeNull();
    expect(solicitacaoDaLinha('2611064107\nFULANO', '')).toBeNull();
    expect(solicitacaoDaLinha('', '')).toBeNull();
  });
});

describe('montarEnvio', () => {
  const linha = (protocolo, status, titular = '') => ({ protocolo, status, titular });

  it('monta o envelope da ELEKTRO só com o que a API aceita', () => {
    const envio = montarEnvio([linha('2611064107', 'Em Análise Técnica', 'WILLIAM')]);
    expect(envio).toEqual({
      concessionaria: 'ELEKTRO',
      protocolos: [{ protocolo: '2611064107', status: 'Em Análise Técnica', titular: 'WILLIAM' }],
    });
  });
  it('tira linha sem protocolo ou sem status', () => {
    const envio = montarEnvio([linha('', 'X'), linha('2610272197', ''), linha('2611064107', 'Concluída')]);
    expect(envio.protocolos).toEqual([{ protocolo: '2611064107', status: 'Concluída', titular: '' }]);
  });
  it('mantém a última de um protocolo repetido', () => {
    const envio = montarEnvio([linha('2611064107', 'Em Análise Técnica'), linha('2611064107', 'Solicitação Concluída')]);
    expect(envio.protocolos).toEqual([{ protocolo: '2611064107', status: 'Solicitação Concluída', titular: '' }]);
  });
  it('não passa do teto de itens da API', () => {
    const muitas = Array.from({ length: MAX_ITENS + 20 }, (_, i) => linha(String(1000000000 + i), 'Em Análise Técnica'));
    expect(montarEnvio(muitas).protocolos.length).toBe(MAX_ITENS);
  });
});
