import { describe, expect, it } from 'vitest';
import {
  identidadeDoCartao, referenciaDaMensagem, rotuloCasamento, textoAplicado, textoDaTrocaDeProtocolo,
} from './ludmillaCartao';

// Todos os nomes abaixo são inventados.

describe('identidadeDoCartao — titular e empresa de todo cartão', () => {
  it('cartão novo de e-mail: o titular do portal é o do cadastro e aparece uma vez só', () => {
    const r = identidadeDoCartao({
      titular_portal: 'Marta Ribeiro Campos',
      project: { title: 'Marta Ribeiro Campos', companies: { name: 'Solar Alfa' }, project_general_data: { holder_name: 'Marta Ribeiro Campos' } },
    });
    expect(r).toEqual({ titular: 'Marta Ribeiro Campos', noPortal: null, empresa: 'Solar Alfa' });
  });

  it('cartão antigo de e-mail (titular_portal NULL): vem do cadastro do projeto', () => {
    const r = identidadeDoCartao({
      titular_portal: null,
      project: { title: 'Titulo do projeto', companies: { name: 'Solar Alfa' }, project_general_data: { holder_name: 'Marta Ribeiro Campos' } },
    });
    expect(r.titular).toBe('Marta Ribeiro Campos');
    expect(r.noPortal).toBeNull();
  });

  it('sem os dados gerais (staff restrito não os lê): cai para o título do projeto', () => {
    const r = identidadeDoCartao({
      titular_portal: null,
      project: { title: 'Marta Ribeiro Campos', companies: { name: 'Solar Alfa' }, project_general_data: null },
    });
    expect(r.titular).toBe('Marta Ribeiro Campos');
  });

  it('o embed pode voltar como lista de uma linha: funciona igual', () => {
    const r = identidadeDoCartao({
      titular_portal: null,
      project: { title: null, companies: { name: 'Solar Alfa' }, project_general_data: [{ holder_name: 'Marta Ribeiro Campos' }] },
    });
    expect(r.titular).toBe('Marta Ribeiro Campos');
  });

  it('portal (CPFL): mostra o do cadastro e, quando difere, o nome como o portal escreve', () => {
    const r = identidadeDoCartao({
      titular_portal: 'UFV JOSE FRANCISCO',
      project: { title: 'x', companies: { name: 'Solar Alfa' }, project_general_data: { holder_name: 'José Francisco de Souza' } },
    });
    expect(r).toEqual({ titular: 'José Francisco de Souza', noPortal: 'UFV JOSE FRANCISCO', empresa: 'Solar Alfa' });
  });

  it('o mesmo nome em caixa alta e sem acento não vira segundo nome', () => {
    const r = identidadeDoCartao({
      titular_portal: 'JOSE FRANCISCO DE SOUZA',
      project: { title: 'x', companies: { name: 'Solar Alfa' }, project_general_data: { holder_name: 'José  Francisco de Souza' } },
    });
    expect(r.noPortal).toBeNull();
  });

  it('sem projeto casado: o único nome é o do portal, e não há empresa', () => {
    const r = identidadeDoCartao({ titular_portal: 'UFV JOSE FRANCISCO', project: null });
    expect(r).toEqual({ titular: 'UFV JOSE FRANCISCO', noPortal: null, empresa: null });
  });

  it('sem nada: tudo nulo, nunca a palavra undefined', () => {
    const r = identidadeDoCartao({ titular_portal: null });
    expect(r).toEqual({ titular: null, noPortal: null, empresa: null });
    expect(JSON.stringify(r)).not.toContain('undefined');
  });

  it('empresa vazia ou só com espaços conta como sem empresa', () => {
    expect(identidadeDoCartao({ titular_portal: 'A', project: { title: 'A', companies: { name: '   ' } } }).empresa).toBeNull();
    expect(identidadeDoCartao({ titular_portal: 'A', project: { title: 'A', companies: null } }).empresa).toBeNull();
    expect(identidadeDoCartao({ titular_portal: 'A', project: { title: 'A' } }).empresa).toBeNull();
  });

  it('titular só com espaços conta como vazio e cai para o seguinte', () => {
    const r = identidadeDoCartao({
      titular_portal: '  ', project: { title: 'Marta', project_general_data: { holder_name: '   ' } },
    });
    expect(r.titular).toBe('Marta');
  });
});

describe('rotuloCasamento', () => {
  it('traz os quatro rótulos certos', () => {
    expect(rotuloCasamento('protocolo')).toBe('protocolo');
    expect(rotuloCasamento('cpf')).toBe('CPF/CNPJ');
    expect(rotuloCasamento('uc')).toBe('UC');
    expect(rotuloCasamento('titular')).toBe('nome do titular');
  });
  it('valor desconhecido ou ausente não vira "título": não afirma nada', () => {
    expect(rotuloCasamento(null)).toBeNull();
    expect(rotuloCasamento(undefined)).toBeNull();
    expect(rotuloCasamento('titulo')).toBeNull();
  });
});

describe('textoDaTrocaDeProtocolo — o selo violeta', () => {
  it('ENEL casada pela UC, cadastro com protocolo velho', () => {
    expect(textoDaTrocaDeProtocolo('uc', '900000111')).toBe('protocolo novo — casado por UC; no cadastro está 900000111');
  });
  it('ENEL casada pelo nome, cadastro com o texto "Sem protocolo"', () => {
    expect(textoDaTrocaDeProtocolo('titular', 'Sem protocolo'))
      .toBe('protocolo novo — casado por nome do titular; no cadastro está "Sem protocolo"');
  });
  it('cadastro vazio mantém o texto de sempre', () => {
    expect(textoDaTrocaDeProtocolo('cpf', null)).toBe('protocolo novo — casado por CPF/CNPJ; no cadastro está (vazio)');
    expect(textoDaTrocaDeProtocolo('cpf', '  ')).toBe('protocolo novo — casado por CPF/CNPJ; no cadastro está (vazio)');
  });
  it('casamento ausente: o selo não inventa o critério', () => {
    expect(textoDaTrocaDeProtocolo(null, '123')).toBe('protocolo novo — no cadastro está 123');
  });
});

describe('textoAplicado — o aviso depois de "Aplicar"', () => {
  it('sem etapa, só o protocolo mudou', () => {
    expect(textoAplicado(undefined)).toBe('Protocolo do cadastro atualizado. Ficou no histórico com você como autor e a Ludmilla como origem.');
    expect(textoAplicado(null)).toContain('Protocolo do cadastro atualizado');
    expect(textoAplicado('')).toContain('Protocolo do cadastro atualizado');
  });
  it('com etapa, o card foi movido', () => {
    expect(textoAplicado('approved')).toBe('Card movido. Ficou no histórico com você como autor e a Ludmilla como origem.');
  });
});

describe('referenciaDaMensagem — a linha do histórico nunca fica com o protocolo vazio', () => {
  it('com protocolo, mostra o protocolo', () => {
    expect(referenciaDaMensagem('900000111', 'PRJ-1')).toBe('protocolo 900000111');
  });
  it('chave vazia da ENEL com projeto: o código já está na linha, nada a repetir', () => {
    expect(referenciaDaMensagem('', 'PRJ-1')).toBeNull();
  });
  it('chave vazia da ENEL sem projeto: traço', () => {
    expect(referenciaDaMensagem('', null)).toBe('—');
    expect(referenciaDaMensagem('', undefined)).toBe('—');
  });
});
