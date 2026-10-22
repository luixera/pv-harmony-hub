import { describe, expect, it } from 'vitest';
import {
  detalheDoCartaoDeEmail, identidadeDoCartao, mensagemDeErro, quadroDosAvisos, referenciaDaMensagem, rotuloCasamento,
  textoAplicado, textoDaTrocaDeProtocolo, textoDoAchado,
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

describe('mensagemDeErro — o texto do aviso quando uma consulta falha', () => {
  it('erro do PostgREST é um objeto simples (não é Error): lê a message dele', () => {
    expect(mensagemDeErro({ message: 'Could not find a relationship between projects and companies', code: 'PGRST200' }))
      .toBe('Could not find a relationship between projects and companies');
  });
  it('Error de verdade e texto solto também servem', () => {
    expect(mensagemDeErro(new Error('Failed to fetch'))).toBe('Failed to fetch');
    expect(mensagemDeErro('sem rede')).toBe('sem rede');
  });
  it('sem nada aproveitável: null, para a tela não escrever "undefined"', () => {
    expect(mensagemDeErro(undefined)).toBeNull();
    expect(mensagemDeErro(null)).toBeNull();
    expect(mensagemDeErro({})).toBeNull();
    expect(mensagemDeErro({ message: '   ' })).toBeNull();
    expect(mensagemDeErro(42)).toBeNull();
  });
});

describe('textoDoAchado — como o projeto foi achado, sempre dito no cartão de e-mail', () => {
  it('traz os quatro textos, cada um com a preposição certa', () => {
    expect(textoDoAchado('protocolo')).toBe('achado pelo protocolo');
    expect(textoDoAchado('uc')).toBe('achado pela UC');
    expect(textoDoAchado('titular')).toBe('achado pelo nome do titular');
    expect(textoDoAchado('cpf')).toBe('achado pelo CPF/CNPJ');
  });
  it('valor desconhecido ou ausente: null (não afirma nada)', () => {
    expect(textoDoAchado(null)).toBeNull();
    expect(textoDoAchado(undefined)).toBeNull();
    expect(textoDoAchado('titulo')).toBeNull();
  });
});

describe('detalheDoCartaoDeEmail — o que o cartão de e-mail diz além da recomendação', () => {
  // o que ludmilla_email_registrar grava em raw (assunto e remetente sempre, mesmo nulos)
  const rawEmail = (extra: Record<string, unknown> = {}) => ({
    assunto: 'Resposta da solicitação', remetente: 'atendimento@exemplo.test', resumo: null, anexos: 0,
    motivo: null, arquivo_lido: null, tentativa: 1, ...extra,
  });

  it('cartão da CPFL (raw do portal, sem assunto nem remetente): null, nada muda', () => {
    expect(detalheDoCartaoDeEmail({
      raw: { 'Última atualização': '12/10/2026', Status: 'Em Andamento' }, casamento: 'protocolo', detectado_em: '2026-10-13T10:00:00Z',
    })).toBeNull();
    expect(detalheDoCartaoDeEmail({ raw: null, casamento: 'protocolo', detectado_em: '2026-10-13T10:00:00Z' })).toBeNull();
    expect(detalheDoCartaoDeEmail({ raw: undefined })).toBeNull();
  });

  it('e-mail comum: diz como achou, a data do e-mail e o motivo (ressalva)', () => {
    const d = detalheDoCartaoDeEmail({
      raw: rawEmail({ motivo: 'a Carta traz a NT 900000222; o cadastro tem nenhum', recebido_em: '2026-10-13T14:32:00+00:00' }),
      casamento: 'titular', detectado_em: '2026-10-14T08:00:00Z',
    });
    expect(d).toEqual({
      achado: 'achado pelo nome do titular',
      motivo: 'a Carta traz a NT 900000222; o cadastro tem nenhum',
      data: { iso: '2026-10-13T14:32:00+00:00', rotulo: 'e-mail recebido em' },
      bloqueio: false,
    });
  });

  it('um cartão achado só pelo nome se distingue de um achado pela NT, mesmo sem troca de protocolo', () => {
    const a = detalheDoCartaoDeEmail({ raw: rawEmail(), casamento: 'protocolo', detectado_em: '2026-10-14T08:00:00Z' });
    const b = detalheDoCartaoDeEmail({ raw: rawEmail(), casamento: 'titular', detectado_em: '2026-10-14T08:00:00Z' });
    expect(a?.achado).toBe('achado pelo protocolo');
    expect(b?.achado).toBe('achado pelo nome do titular');
  });

  it('cartão antigo (sem recebido_em): a data é a da leitura, e o rótulo não finge que é a do e-mail', () => {
    const d = detalheDoCartaoDeEmail({ raw: rawEmail(), casamento: 'protocolo', detectado_em: '2026-10-14T08:00:00Z' });
    expect(d?.data).toEqual({ iso: '2026-10-14T08:00:00Z', rotulo: 'lido pela Ludmilla em' });
  });

  it('recebido_em ilegível ou vazio cai na leitura; sem nenhuma data válida: data null (nunca "Invalid Date")', () => {
    expect(detalheDoCartaoDeEmail({ raw: rawEmail({ recebido_em: 'ontem' }), detectado_em: '2026-10-14T08:00:00Z' })?.data?.rotulo)
      .toBe('lido pela Ludmilla em');
    expect(detalheDoCartaoDeEmail({ raw: rawEmail({ recebido_em: '  ' }), detectado_em: '2026-10-14T08:00:00Z' })?.data?.rotulo)
      .toBe('lido pela Ludmilla em');
    expect(detalheDoCartaoDeEmail({ raw: rawEmail({ recebido_em: null }), detectado_em: 'não é data' })?.data).toBeNull();
    expect(detalheDoCartaoDeEmail({ raw: rawEmail() })?.data).toBeNull();
  });

  it('motivo vazio, só com espaços ou que não é texto: null', () => {
    expect(detalheDoCartaoDeEmail({ raw: rawEmail({ motivo: '   ' }) })?.motivo).toBeNull();
    expect(detalheDoCartaoDeEmail({ raw: rawEmail({ motivo: null }) })?.motivo).toBeNull();
    expect(detalheDoCartaoDeEmail({ raw: rawEmail({ motivo: 7 }) })?.motivo).toBeNull();
  });

  describe('bloqueio — o documento não foi anexado', () => {
    it('ENEL: "não anexei · o documento é de …" é bloqueio, e o motivo vai inteiro', () => {
      const motivo = 'não anexei · o documento é de "Pedro Alves Nogueira" e o projeto é de "Marta Ribeiro Campos"';
      const d = detalheDoCartaoDeEmail({
        raw: rawEmail({ motivo, recebido_em: '2026-10-13T14:32:00Z' }), casamento: 'uc', detectado_em: '2026-10-14T08:00:00Z',
      });
      expect(d?.bloqueio).toBe(true);
      expect(d?.motivo).toBe(motivo);
      expect(d?.achado).toBe('achado pela UC');
    });
    it('EDP: o bloqueio de lá também começa por "não anexei"', () => {
      expect(detalheDoCartaoDeEmail({ raw: rawEmail({ motivo: 'não anexei · o titular do parecer diverge' }), casamento: 'protocolo' })?.bloqueio)
        .toBe(true);
    });
    it('sem acento e em caixa alta também é bloqueio; só "não anexei" (sem mais nada) também', () => {
      expect(detalheDoCartaoDeEmail({ raw: rawEmail({ motivo: 'NAO ANEXEI · titular diverge' }) })?.bloqueio).toBe(true);
      expect(detalheDoCartaoDeEmail({ raw: rawEmail({ motivo: 'Não anexei' }) })?.bloqueio).toBe(true);
    });
    it('"não anexei ainda: preciso ler o documento" é espera da IA, não bloqueio (a ENEL tenta de novo)', () => {
      expect(detalheDoCartaoDeEmail({
        raw: rawEmail({ motivo: 'não anexei ainda: preciso ler o documento para conferir o titular' }),
      })?.bloqueio).toBe(false);
    });
    it('ressalva comum (arquivo barrado, imagem) não é bloqueio, mesmo falando em "não anexado"', () => {
      expect(detalheDoCartaoDeEmail({
        raw: rawEmail({ motivo: '1 arquivo(s) não anexado(s): o nome traz o número de outro projeto' }),
      })?.bloqueio).toBe(false);
    });
    it('"não anexei" no meio do texto não conta: o bloqueio é o motivo que ABRE assim', () => {
      expect(detalheDoCartaoDeEmail({ raw: rawEmail({ motivo: 'a Carta traz a NT 900000222 · não anexei · x' }) })?.bloqueio).toBe(false);
    });
    it('sem motivo não há bloqueio', () => {
      expect(detalheDoCartaoDeEmail({ raw: rawEmail() })?.bloqueio).toBe(false);
    });
  });
});

describe('quadroDosAvisos — o quadro "avisos" da última leitura', () => {
  it('run novo traz avisos_mensagens: o quadro conta MENSAGENS', () => {
    expect(quadroDosAvisos({ avisos: 12, avisos_mensagens: 2 })).toEqual({ chave: 'avisos_mensagens', rotulo: 'avisos (mensagens)' });
  });
  it('avisos_mensagens = 0 também vale (zero mensagens geraram aviso), não cai para os sinos', () => {
    expect(quadroDosAvisos({ avisos: 0, avisos_mensagens: 0 })).toEqual({ chave: 'avisos_mensagens', rotulo: 'avisos (mensagens)' });
  });
  it('run antigo (sem a chave): o quadro conta SINOS tocados', () => {
    expect(quadroDosAvisos({ avisos: 12 })).toEqual({ chave: 'avisos', rotulo: 'sinos tocados' });
    expect(quadroDosAvisos(null)).toEqual({ chave: 'avisos', rotulo: 'sinos tocados' });
    expect(quadroDosAvisos(undefined)).toEqual({ chave: 'avisos', rotulo: 'sinos tocados' });
  });
  it('chave com valor que não é número é como se não existisse', () => {
    expect(quadroDosAvisos({ avisos: 3, avisos_mensagens: '2' })).toEqual({ chave: 'avisos', rotulo: 'sinos tocados' });
    expect(quadroDosAvisos({ avisos: 3, avisos_mensagens: null })).toEqual({ chave: 'avisos', rotulo: 'sinos tocados' });
  });
});
