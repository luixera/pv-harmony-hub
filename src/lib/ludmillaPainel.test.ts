import { describe, expect, it } from 'vitest';
import {
  acoesDoItem, alertasDasContas, chipsDaFaixa, haQuantoTempo, oQueChegou, ressalvaDoCartao, rotuloDaCriacao,
  saudeDaConta, situacaoDecidida, textoDaDecisao, ucDoProjeto,
} from './ludmillaPainel';
import { itensDaCaixa } from './ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, AGORA, CONTAS_DE_EXEMPLO, CONTA_CPFL, CONTA_EDP, CONTA_ELEKTRO, CONTA_ENEL, MENSAGEM_DA_TROCA,
  UPDATES_DE_EXEMPLO, U_CPFL, U_EDP, U_ENEL_BLOQUEADO, U_ENEL_TROCA, nomeDaContaDeExemplo, rotuloDeExemplo,
} from './ludmillaCaixa.fixtures';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const itens = itensDaCaixa({
  updates: UPDATES_DE_EXEMPLO, afazeres: AFAZERES_DE_EXEMPLO, contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (c: string) => itens.find(i => i.chave === c)!;

describe('haQuantoTempo', () => {
  it('minutos, horas e dias', () => {
    expect(haQuantoTempo(iso(AGORA - 30_000), AGORA)).toBe('agora há pouco');
    expect(haQuantoTempo(iso(AGORA - 5 * 60_000), AGORA)).toBe('há 5 min');
    expect(haQuantoTempo(iso(AGORA - 3 * H), AGORA)).toBe('há 3 h');
    expect(haQuantoTempo(iso(AGORA - 47 * H), AGORA)).toBe('há 47 h');
    expect(haQuantoTempo(iso(AGORA - 72 * H), AGORA)).toBe('há 3 dias');
  });
  it('sem data ou data inválida: nunca', () => {
    expect(haQuantoTempo(null, AGORA)).toBe('nunca');
    expect(haQuantoTempo('não é data', AGORA)).toBe('nunca');
  });
});

describe('saudeDaConta — o ponto do chip', () => {
  const base = { estacao: null, caixaPronta: true, agora: AGORA };
  it('em dia', () => expect(saudeDaConta(CONTA_CPFL, base)).toEqual({ tom: 'ok', texto: 'em dia' }));
  it('erro vence tudo', () => expect(saudeDaConta({ ...CONTA_CPFL, situacao: 'erro' }, base)).toEqual({ tom: 'erro', texto: 'com erro' }));
  it('sessão expirada', () => {
    expect(saudeDaConta(CONTA_ELEKTRO, { ...base, estacao: { online: true, texto: 'estação online' } }))
      .toEqual({ tom: 'atencao', texto: 'sessão expirada' });
  });
  it('estação offline', () => {
    expect(saudeDaConta({ ...CONTA_ELEKTRO, situacao: 'ok' }, { ...base, estacao: { online: false, texto: 'estação offline há 2 h' } }))
      .toEqual({ tom: 'atencao', texto: 'estação offline há 2 h' });
  });
  it('e-mail sem caixa configurada', () => {
    expect(saudeDaConta(CONTA_ENEL, { ...base, caixaPronta: false })).toEqual({ tom: 'parada', texto: 'caixa não configurada' });
  });
  it('nunca leu', () => expect(saudeDaConta(CONTA_EDP, base)).toEqual({ tom: 'parada', texto: 'ainda não leu a caixa' }));
  it('mais de 18 h sem ler é rodada perdida', () => {
    expect(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: iso(AGORA - 19 * H) }, base)).toEqual({ tom: 'atencao', texto: 'leitura atrasada' });
    expect(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: iso(AGORA - 17 * H) }, base).tom).toBe('ok');
  });
  it('desligada', () => expect(saudeDaConta({ ...CONTA_CPFL, enabled: false }, base)).toEqual({ tom: 'parada', texto: 'desligada' }));
});

describe('chipsDaFaixa', () => {
  const opcoes = {
    nomeDaConta: nomeDaContaDeExemplo, pendentesPorConta: { 'conta-enel': 4, 'conta-cpfl': 2 },
    estacaoDe: () => null, caixaPronta: true, agora: AGORA,
  };
  const chips = chipsDaFaixa(CONTAS_DE_EXEMPLO, opcoes);
  it('um chip por conta, em ordem de nome', () => {
    expect(chips.map(c => c.nome)).toEqual(['CPFL Paulista', 'EDP São Paulo', 'Elektro', 'ENEL SP']);
  });
  it('lida há / nunca lida, pendentes e o meio', () => {
    expect(chips.find(c => c.id === 'conta-enel')).toMatchObject({
      meio: 'email', lida: 'lida há 1 h', pendentes: 4, podeVerificar: true, tipoDoRun: 'varredura_email',
    });
    expect(chips.find(c => c.id === 'conta-edp')!.lida).toBe('nunca lida');
    expect(chips.find(c => c.id === 'conta-edp')!.pendentes).toBe(0);
    expect(chips.find(c => c.id === 'conta-elektro')!.meio).toBe('estacao');
  });
  it('"Verificar agora" como hoje: e-mail precisa da caixa, portal precisa do login', () => {
    const semCaixa = chipsDaFaixa(CONTAS_DE_EXEMPLO, { ...opcoes, caixaPronta: false });
    expect(semCaixa.find(c => c.id === 'conta-enel')!.podeVerificar).toBe(false);
    expect(semCaixa.find(c => c.id === 'conta-cpfl')).toMatchObject({ podeVerificar: true, tipoDoRun: 'varredura' });
    expect(chipsDaFaixa([{ ...CONTA_CPFL, login: null }], opcoes)[0].podeVerificar).toBe(false);
  });
});

describe('alertasDasContas', () => {
  it('erro e sessão expirada viram alerta; conta em dia não', () => {
    const a = alertasDasContas(
      [{ ...CONTA_CPFL, situacao: 'erro', ultimo_erro: 'Tempo esgotado ao abrir a lista' }, CONTA_ELEKTRO, CONTA_ENEL],
      nomeDaContaDeExemplo, true);
    expect(a).toEqual([
      { chave: 'erro:conta-cpfl', tom: 'erro', titulo: 'CPFL Paulista: a última leitura deu erro', detalhe: 'Tempo esgotado ao abrir a lista' },
      { chave: 'sessao:conta-elektro', tom: 'atencao', titulo: 'Elektro: sessão expirada', detalhe: 'A estação espera alguém entrar no portal e digitar o código da imagem.' },
    ]);
  });
  it('caixa de e-mail não configurada: um alerta só, com as concessionárias', () => {
    expect(alertasDasContas([CONTA_CPFL, CONTA_EDP, CONTA_ENEL], nomeDaContaDeExemplo, false)).toEqual([{
      chave: 'caixa', tom: 'atencao', titulo: 'A caixa de e-mail não está configurada',
      detalhe: 'Sem ela a Ludmilla não lê EDP São Paulo nem ENEL SP. Configure em Claudinho / Agente de e-mails.',
    }]);
  });
  it('conta desligada não alerta', () => {
    expect(alertasDasContas([{ ...CONTA_CPFL, enabled: false, situacao: 'erro' }], nomeDaContaDeExemplo, true)).toEqual([]);
  });
});

describe('oQueChegou e ressalvaDoCartao', () => {
  it('e-mail: a mensagem manda; o raw do cartão cobre o que faltar', () => {
    expect(oQueChegou(U_ENEL_TROCA, MENSAGEM_DA_TROCA, 'email')).toEqual({
      meio: 'email', assunto: 'Carta de aprovação do projeto', remetente: 'naoresponda@enel.exemplo.test',
      recebidoEm: '2026-10-21T08:55:00Z', lidoEm: '2026-10-21T09:00:00Z', resumo: 'A ENEL aprovou o projeto.',
      arquivoLido: 'carta-900000222.pdf', anexos: 1, veredito: 'favoravel', tipoDocumento: 'carta_projeto',
    });
    expect(oQueChegou(U_EDP, null, 'email')).toMatchObject({
      assunto: 'Parecer de acesso 045000000001', remetente: 'gd@edp.exemplo.test', anexos: 2, veredito: null, recebidoEm: null,
    });
  });
  it('portal: de → para e a data do portal', () => {
    expect(oQueChegou(U_CPFL, null, 'portal')).toEqual({ meio: 'portal', de: 'Em Andamento', para: 'Aprovado', atualizadoNoPortal: '19/10/2026' });
  });
  it('ressalva: a da mensagem, senão a do cartão; vazio é null', () => {
    expect(ressalvaDoCartao(U_ENEL_BLOQUEADO, null)).toBe('não anexei · o documento é de "Carlos Souza" e o projeto é de "Ana Paula Reis"');
    expect(ressalvaDoCartao(U_EDP, null)).toBeNull();
    expect(ressalvaDoCartao(U_EDP, { ...MENSAGEM_DA_TROCA, motivo: '  ' })).toBeNull();
  });
});

describe('acoesDoItem — os botões do detalhe', () => {
  it('troca de protocolo: com etapa "Aplicar etapa e protocolo", sem etapa "Atualizar protocolo"', () => {
    expect(acoesDoItem(item('u:u-enel-troca'), 'approved').principal)
      .toEqual({ acao: 'aplicar', rotulo: 'Aplicar etapa e protocolo', habilitada: true, porque: null });
    expect(acoesDoItem(item('u:u-enel-troca'), null).principal).toMatchObject({ rotulo: 'Atualizar protocolo', habilitada: true });
  });
  it('mudar etapa: "Aplicar" e "Ignorar"', () => {
    expect(acoesDoItem(item('u:u-cpfl'), 'approved')).toEqual({
      principal: { acao: 'aplicar', rotulo: 'Aplicar', habilitada: true, porque: null },
      secundaria: { acao: 'ignorar', rotulo: 'Ignorar' },
    });
  });
  it('sem etapa escolhida, o Aplicar espera e diz por quê', () => {
    expect(acoesDoItem(item('u:u-cpfl'), '').principal)
      .toEqual({ acao: 'aplicar', rotulo: 'Aplicar', habilitada: false, porque: 'Escolha a etapa para onde mover o card.' });
  });
  it('bloqueado: "Dispensar"', () => {
    expect(acoesDoItem(item('u:u-enel-bloq'), null).secundaria).toEqual({ acao: 'ignorar', rotulo: 'Dispensar' });
  });
  it('sem projeto casado: não há card para mover', () => {
    expect(acoesDoItem(item('u:u-cpfl-sem'), 'approved').principal)
      .toMatchObject({ habilitada: false, porque: 'Sem projeto casado: não há card para mover.' });
  });
  it('A fazer: só "Marcar como feito"', () => {
    expect(acoesDoItem(item('f:f-vistoria'), null)).toEqual({
      principal: { acao: 'feito', rotulo: 'Marcar como feito', habilitada: true, porque: null }, secundaria: null,
    });
  });
  it('já decidido: nenhum botão', () => {
    expect(acoesDoItem(item('u:u-aplicada'), 'approved')).toEqual({ principal: null, secundaria: null });
    expect(acoesDoItem(item('f:f-feito'), null)).toEqual({ principal: null, secundaria: null });
  });
});

describe('textoDaDecisao — o aviso com Desfazer diz o que vai acontecer', () => {
  it('cada caso', () => {
    expect(textoDaDecisao(item('u:u-cpfl'), 'aplicar', 'Aprovado')).toBe('PRJ-10001 vai para Aprovado');
    expect(textoDaDecisao(item('u:u-enel-troca'), 'aplicar', 'Aprovado')).toBe('PRJ-10002 vai para Aprovado e grava o protocolo 900000222');
    expect(textoDaDecisao(item('u:u-enel-troca'), 'aplicar', null)).toBe('PRJ-10002: o protocolo do cadastro vai virar 900000222');
    expect(textoDaDecisao(item('u:u-cpfl'), 'ignorar', null)).toBe('PRJ-10001: recomendação ignorada');
    expect(textoDaDecisao(item('u:u-enel-bloq'), 'ignorar', null)).toBe('PRJ-10003: documento bloqueado dispensado');
    expect(textoDaDecisao(item('f:f-devolucao'), 'feito', null)).toBe('ENEL SP: marcado como feito');
  });
});

describe('situacaoDecidida', () => {
  it('pendente: nada; aplicada/ignorada com a data; feito com quem', () => {
    expect(situacaoDecidida(item('u:u-cpfl'))).toBeNull();
    expect(situacaoDecidida(item('u:u-aplicada'))).toEqual({ rotulo: 'Aplicada', em: '2026-10-18T13:00:00Z', por: null });
    expect(situacaoDecidida(item('u:u-ignorada'))).toEqual({ rotulo: 'Ignorada', em: '2026-10-17T10:00:00Z', por: null });
    expect(situacaoDecidida(item('f:f-feito'))).toEqual({ rotulo: 'Feito', em: '2026-10-16T15:00:00Z', por: 'Bia Souza' });
  });
});

describe('ucDoProjeto', () => {
  it('objeto ou lista; vazio é null', () => {
    expect(ucDoProjeto({ project_general_data: { uc_number: ' 0123456789 ' } })).toBe('0123456789');
    expect(ucDoProjeto({ project_general_data: [{ uc_number: '111' }] })).toBe('111');
    expect(ucDoProjeto({ project_general_data: null })).toBeNull();
    expect(ucDoProjeto(null)).toBeNull();
  });
});

describe('rotuloDaCriacao — o cartão da criação na CPFL', () => {
  const projetos = { 'p-1': { id: 'p-1', code: 'PRJ-10001', cpfl_node_id: null }, 'p-9': { id: 'p-9', code: 'PRJ-10009', cpfl_node_id: '611111' } };
  const projetoDe = (id: string) => projetos[id as keyof typeof projetos] ?? null;
  it('código do projeto e número que a criação devolveu', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 'p-1' }, resultado: { node: '598536' } }, projetoDe)).toEqual({ titulo: 'PRJ-10001', numeroCpfl: '598536' });
  });
  it('sem número no run: o do cadastro', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 'p-9' }, resultado: null }, projetoDe)).toEqual({ titulo: 'PRJ-10009', numeroCpfl: '611111' });
  });
  it('projeto desconhecido ou ausente', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 'abcdef1234' }, resultado: null }, projetoDe)).toEqual({ titulo: 'Projeto abcdef12…', numeroCpfl: null });
    expect(rotuloDaCriacao({ dados: null, resultado: { node: 598536 } }, projetoDe)).toEqual({ titulo: 'Criar na CPFL', numeroCpfl: '598536' });
  });
});

// ── lacunas apontadas pelas mutações ─────────────────────────────────────────
// Cada teste abaixo mata um defeito que o primeiro conjunto deixava passar
// (rodada de mutações da Task 3: o defeito foi injetado numa cópia e o teste ficou vermelho).

describe('haQuantoTempo — as bordas', () => {
  it('60 s é "há 1 min"; 59 min ainda é minuto; 60 min é "há 1 h"', () => {
    expect(haQuantoTempo(iso(AGORA - 60_000), AGORA)).toBe('há 1 min');
    expect(haQuantoTempo(iso(AGORA - 59 * 60_000), AGORA)).toBe('há 59 min');
    expect(haQuantoTempo(iso(AGORA - 60 * 60_000), AGORA)).toBe('há 1 h');
  });
  it('relógio adiantado (data no futuro) não vira número negativo', () => {
    expect(haQuantoTempo(iso(AGORA + 5 * 60_000), AGORA)).toBe('agora há pouco');
  });
});

describe('saudeDaConta — a ordem das regras e as bordas', () => {
  const base = { estacao: null, caixaPronta: true, agora: AGORA };
  it('a caixa de e-mail só importa para quem lê e-mail', () => {
    expect(saudeDaConta(CONTA_CPFL, { ...base, caixaPronta: false })).toEqual({ tom: 'ok', texto: 'em dia' });
  });
  it('conta sem acesso configurado', () => {
    expect(saudeDaConta({ ...CONTA_CPFL, situacao: 'nao_configurado' }, base)).toEqual({ tom: 'parada', texto: 'sem acesso' });
  });
  it('conta de portal que nunca varreu', () => {
    expect(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: null }, base)).toEqual({ tom: 'parada', texto: 'ainda não varreu' });
  });
  it('18 h cravadas ainda é em dia; um minuto a mais é leitura atrasada', () => {
    expect(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: iso(AGORA - 18 * H) }, base)).toEqual({ tom: 'ok', texto: 'em dia' });
    expect(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: iso(AGORA - 18 * H - 60_000) }, base))
      .toEqual({ tom: 'atencao', texto: 'leitura atrasada' });
  });
  it('desligada vence o erro', () => {
    expect(saudeDaConta({ ...CONTA_CPFL, enabled: false, situacao: 'erro' }, base)).toEqual({ tom: 'parada', texto: 'desligada' });
  });
  it('o erro vence a caixa sem configurar', () => {
    expect(saudeDaConta({ ...CONTA_ENEL, situacao: 'erro' }, { ...base, caixaPronta: false })).toEqual({ tom: 'erro', texto: 'com erro' });
  });
  it('sessão expirada vence a estação offline', () => {
    expect(saudeDaConta(CONTA_ELEKTRO, { ...base, estacao: { online: false, texto: 'estação offline há 2 h' } }))
      .toEqual({ tom: 'atencao', texto: 'sessão expirada' });
  });
  it('estação offline vence "ainda não varreu" e "leitura atrasada"', () => {
    const offline = { online: false, texto: 'estação offline há 2 h' };
    expect(saudeDaConta({ ...CONTA_ELEKTRO, situacao: 'ok', ultima_varredura_em: null }, { ...base, estacao: offline }).texto)
      .toBe('estação offline há 2 h');
    expect(saudeDaConta({ ...CONTA_ELEKTRO, situacao: 'ok', ultima_varredura_em: iso(AGORA - 30 * H) }, { ...base, estacao: offline }).texto)
      .toBe('estação offline há 2 h');
  });
  it('estação online não atrapalha', () => {
    expect(saudeDaConta({ ...CONTA_ELEKTRO, situacao: 'ok', ultima_varredura_em: iso(AGORA - H) }, { ...base, estacao: { online: true, texto: 'estação online' } }))
      .toEqual({ tom: 'ok', texto: 'em dia' });
  });
});

describe('chipsDaFaixa — o ponto de saúde e o nome vêm de verdade', () => {
  const opcoes = {
    nomeDaConta: nomeDaContaDeExemplo, pendentesPorConta: {}, estacaoDe: () => null, caixaPronta: true, agora: AGORA,
  };
  it('o ponto usa a estação da conta', () => {
    const chips = chipsDaFaixa([{ ...CONTA_ELEKTRO, situacao: 'ok' }], {
      ...opcoes, estacaoDe: () => ({ online: false, texto: 'estação offline há 2 h' }),
    });
    expect(chips[0].saude).toEqual({ tom: 'atencao', texto: 'estação offline há 2 h' });
  });
  it('o ponto usa a caixa de e-mail', () => {
    expect(chipsDaFaixa([CONTA_ENEL], { ...opcoes, caixaPronta: false })[0].saude).toEqual({ tom: 'parada', texto: 'caixa não configurada' });
  });
  it('sem nome cadastrado, o chip usa o conector em maiúsculas', () => {
    expect(chipsDaFaixa([CONTA_CPFL], { ...opcoes, nomeDaConta: () => '' })[0].nome).toBe('CPFL');
  });
});

describe('alertasDasContas — os casos que faltavam', () => {
  it('sessão expirada de conta da VPS: ela tenta de novo sozinha', () => {
    expect(alertasDasContas([{ ...CONTA_CPFL, situacao: 'sessao_expirada' }], nomeDaContaDeExemplo, true)).toEqual([{
      chave: 'sessao:conta-cpfl', tom: 'atencao', titulo: 'CPFL Paulista: sessão expirada',
      detalhe: 'Ela tenta entrar de novo na próxima visita.',
    }]);
  });
  it('sessão expirada da Elektro (estação local) pede o código da imagem', () => {
    const [a] = alertasDasContas([CONTA_ELEKTRO], nomeDaContaDeExemplo, true);
    expect(a).toMatchObject({ tom: 'atencao', titulo: 'Elektro: sessão expirada' });
    expect(a.detalhe).toContain('código da imagem');
  });
  it('caixa sem configurar: conta de e-mail desligada não entra na frase', () => {
    expect(alertasDasContas([CONTA_ENEL, { ...CONTA_EDP, enabled: false }], nomeDaContaDeExemplo, false)).toEqual([{
      chave: 'caixa', tom: 'atencao', titulo: 'A caixa de e-mail não está configurada',
      detalhe: 'Sem ela a Ludmilla não lê ENEL SP. Configure em Claudinho / Agente de e-mails.',
    }]);
  });
  it('caixa sem configurar, mas nenhuma conta lê e-mail: sem alerta', () => {
    expect(alertasDasContas([CONTA_CPFL, { ...CONTA_EDP, enabled: false }], nomeDaContaDeExemplo, false)).toEqual([]);
  });
  it('erro sem texto de erro e sem nome cadastrado: usa o conector, detalhe nulo', () => {
    expect(alertasDasContas([{ ...CONTA_CPFL, situacao: 'erro', ultimo_erro: null }], () => '', true)).toEqual([{
      chave: 'erro:conta-cpfl', tom: 'erro', titulo: 'CPFL: a última leitura deu erro', detalhe: null,
    }]);
  });
  it('contas sem nenhum problema: lista vazia', () => {
    expect(alertasDasContas([CONTA_CPFL, CONTA_EDP, CONTA_ENEL], nomeDaContaDeExemplo, true)).toEqual([]);
  });
});

describe('oQueChegou — a mensagem manda; o cartão cobre o que falta', () => {
  const U = {
    ...U_EDP,
    raw: {
      assunto: 'assunto do cartão', remetente: 'cartao@edp.exemplo.test', resumo: 'resumo do cartão',
      arquivo_lido: 'cartao.pdf', recebido_em: '2026-10-20T10:00:00Z', anexos: 1, motivo: 'ressalva do cartão',
    } as never,
  };
  const M = {
    ...MENSAGEM_DA_TROCA, assunto: 'assunto da mensagem', remetente: 'msg@enel.exemplo.test', resumo: 'resumo da mensagem',
    arquivo_lido: 'mensagem.pdf', recebido_em: '2026-10-21T08:55:00Z', anexos: 0,
  };
  it('com mensagem: cada campo vem dela', () => {
    expect(oQueChegou(U, M, 'email')).toMatchObject({
      assunto: 'assunto da mensagem', remetente: 'msg@enel.exemplo.test', resumo: 'resumo da mensagem',
      arquivoLido: 'mensagem.pdf', recebidoEm: '2026-10-21T08:55:00Z', anexos: 1,
    });
  });
  it('sem mensagem: o cartão responde por tudo', () => {
    expect(oQueChegou(U, null, 'email')).toMatchObject({
      assunto: 'assunto do cartão', remetente: 'cartao@edp.exemplo.test', resumo: 'resumo do cartão',
      arquivoLido: 'cartao.pdf', recebidoEm: '2026-10-20T10:00:00Z', anexos: 1,
    });
  });
  it('data que não é data não vira a data do e-mail', () => {
    expect(oQueChegou(U, { ...M, recebido_em: 'ontem à noite' }, 'email')).toMatchObject({ recebidoEm: '2026-10-20T10:00:00Z' });
    const semData = { ...U, raw: { ...(U.raw as object), recebido_em: 'lixo' } as never };
    expect(oQueChegou(semData, null, 'email')).toMatchObject({ recebidoEm: null });
  });
  it('a ressalva da mensagem vem antes da do cartão', () => {
    expect(ressalvaDoCartao(U, { ...M, motivo: 'ressalva da mensagem' })).toBe('ressalva da mensagem');
    expect(ressalvaDoCartao(U, null)).toBe('ressalva do cartão');
  });
});

describe('acoesDoItem — casos de borda', () => {
  it('item sem recomendação nem A fazer (não deveria existir): nenhum botão, sem quebrar', () => {
    expect(acoesDoItem({ ...item('u:u-cpfl'), update: null, afazer: null }, 'approved')).toEqual({ principal: null, secundaria: null });
  });
  it('sem etapa (null), o Aplicar comum espera', () => {
    expect(acoesDoItem(item('u:u-cpfl'), null).principal).toMatchObject({ rotulo: 'Aplicar', habilitada: false });
  });
  it('todo tipo de A fazer pede só "Marcar como feito"', () => {
    for (const chave of ['f:f-vistoria', 'f:f-devolucao']) {
      expect(acoesDoItem(item(chave), null)).toEqual({
        principal: { acao: 'feito', rotulo: 'Marcar como feito', habilitada: true, porque: null }, secundaria: null,
      });
    }
  });
});

describe('textoDaDecisao — sem código nem concessionária', () => {
  it('cai em "Item"', () => {
    expect(textoDaDecisao({ ...item('f:f-devolucao'), codigo: null, concessionaria: '' }, 'feito', null)).toBe('Item: marcado como feito');
  });
});

describe('rotuloDaCriacao — o número do run e o do cadastro', () => {
  const projetoDe = (id: string) => (id === 'p-9' ? { id: 'p-9', code: 'PRJ-10009', cpfl_node_id: '611111' } : null);
  it('o número que a criação devolveu vale mais que o do cadastro', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 'p-9' }, resultado: { node: '598536' } }, projetoDe)).toEqual({ titulo: 'PRJ-10009', numeroCpfl: '598536' });
  });
  it('project_id que não é texto é ignorado', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 123 }, resultado: null }, projetoDe)).toEqual({ titulo: 'Criar na CPFL', numeroCpfl: null });
  });
});
