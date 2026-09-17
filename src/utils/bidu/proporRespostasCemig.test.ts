import { describe, expect, it } from 'vitest';
import { proporRespostasCemig, type ContextoProjetoCemig } from './proporRespostasCemig';
import { TIPOS_SOLICITACAO_CEMIG } from '@/utils/formFill/cemigForm';

/**
 * O Bidu PROPÕE as três respostas do formulário da CEMIG e a pessoa confirma.
 * Ordem de prioridade: o que a pessoa disse na conversa > habilidades
 * ensinadas > cadastro do projeto > padrão. Cada resposta vem com motivo e
 * confiança — o diálogo mostra os dois.
 */

const [COM_ALTERACAO, SEM_ALTERACAO, GD_EXISTENTE, NOVA_UC] = TIPOS_SOLICITACAO_CEMIG;

const base: ContextoProjetoCemig = {
  potenciaKw: 5,
  categoriaEscolhidaManual: false,
  textoLivre: 'Sistema fotovoltaico residencial',
};

describe('proporRespostasCemig — padrões sem habilidade', () => {
  it('sem nada ensinado: SEM alteração (média), Grid Zero Não (média), FAST TRACK Não (baixa, pede ensino)', () => {
    const p = proporRespostasCemig(base, []);
    expect(p.tipoSolicitacao.valor).toBe(SEM_ALTERACAO);
    expect(p.tipoSolicitacao.confianca).toBe('media');
    expect(p.gridZero.valor).toBe('Não');
    expect(p.fastTrack.valor).toBe('Não');
    expect(p.fastTrack.confianca).toBe('baixa');
    expect(p.fastTrack.motivo).toMatch(/ensine/i);
  });

  it('categoria do padrão escolhida à mão = provável aumento de carga → COM alteração', () => {
    const p = proporRespostasCemig({ ...base, categoriaEscolhidaManual: true }, []);
    expect(p.tipoSolicitacao.valor).toBe(COM_ALTERACAO);
    expect(p.tipoSolicitacao.motivo).toMatch(/aumento de carga/i);
  });

  it('texto do projeto fala em UC nova → Ligação de nova UC (alta)', () => {
    const p = proporRespostasCemig({ ...base, textoLivre: 'Ligação nova — UC nova em construção' }, []);
    expect(p.tipoSolicitacao.valor).toBe(NOVA_UC);
    expect(p.tipoSolicitacao.confianca).toBe('alta');
  });

  it('texto do projeto fala em ampliação / GD existente → 3ª opção', () => {
    expect(proporRespostasCemig({ ...base, textoLivre: 'Ampliação do sistema existente' }, []).tipoSolicitacao.valor).toBe(GD_EXISTENTE);
    expect(proporRespostasCemig({ ...base, textoLivre: 'GD existente, acréscimo de 4 módulos' }, []).tipoSolicitacao.valor).toBe(GD_EXISTENTE);
  });
});

describe('proporRespostasCemig — habilidades ensinadas', () => {
  it('"FAST TRACK = Sim até 10 kW": Sim abaixo do limite, Não acima, sempre com confiança alta', () => {
    const habilidades = [{ titulo: 'FAST TRACK na CEMIG', instrucao: 'Na CEMIG, o FAST TRACK é Sim para sistemas até 10 kW.' }];
    expect(proporRespostasCemig({ ...base, potenciaKw: 7.5 }, habilidades).fastTrack).toMatchObject({ valor: 'Sim', confianca: 'alta' });
    expect(proporRespostasCemig({ ...base, potenciaKw: 12 }, habilidades).fastTrack).toMatchObject({ valor: 'Não', confianca: 'alta' });
    expect(proporRespostasCemig({ ...base, potenciaKw: 10 }, habilidades).fastTrack.valor).toBe('Sim');
  });

  it('"FAST TRACK sempre Não" vale mesmo com potência pequena', () => {
    const p = proporRespostasCemig({ ...base, potenciaKw: 3 }, [{ titulo: 'x', instrucao: 'fast track: nunca marcar, sempre Não' }]);
    expect(p.fastTrack.valor).toBe('Não');
    expect(p.fastTrack.confianca).toBe('alta');
  });

  it('habilidade de Grid Zero e de tipo de solicitação', () => {
    const habilidades = [
      { titulo: 'Grid zero', instrucao: 'Grid Zero: sim quando o cliente pedir; por padrão marque sim nos projetos da fazenda' },
      { titulo: 'Tipo', instrucao: 'Na CEMIG o tipo de solicitação padrão é "Conexão de GD em UC existente COM alteração de potência disponibilizada"' },
    ];
    const p = proporRespostasCemig(base, habilidades);
    expect(p.gridZero.valor).toBe('Sim');
    expect(p.gridZero.motivo).toMatch(/Grid zero/);
    expect(p.tipoSolicitacao.valor).toBe(COM_ALTERACAO);
    expect(p.tipoSolicitacao.confianca).toBe('alta');
  });

  it('habilidade que não fala do assunto não interfere', () => {
    const p = proporRespostasCemig(base, [{ titulo: 'Cabos', instrucao: 'Na CEMIG use cabo de 6 mm² no CA' }]);
    expect(p.fastTrack.confianca).toBe('baixa');
    expect(p.tipoSolicitacao.valor).toBe(SEM_ALTERACAO);
  });
});

describe('proporRespostasCemig — o que a pessoa disse na conversa vence tudo', () => {
  it('parâmetros informados sobrepõem habilidade e cadastro, com motivo "você informou"', () => {
    const habilidades = [{ titulo: 'x', instrucao: 'fast track sempre Não' }];
    const p = proporRespostasCemig({ ...base, categoriaEscolhidaManual: true }, habilidades, { fastTrack: 'Sim', tipoSolicitacao: 4 });
    expect(p.fastTrack).toMatchObject({ valor: 'Sim', confianca: 'alta' });
    expect(p.fastTrack.motivo).toMatch(/informou/i);
    expect(p.tipoSolicitacao.valor).toBe(NOVA_UC);
    expect(p.gridZero.valor).toBe('Não');
  });

  it('tipo de solicitação informado por texto (parte do nome) também é aceito', () => {
    const p = proporRespostasCemig(base, [], { tipoSolicitacao: 'GD existente com alteração' });
    expect(p.tipoSolicitacao.valor).toBe(GD_EXISTENTE);
  });
});
