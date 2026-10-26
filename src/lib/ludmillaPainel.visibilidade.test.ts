import { describe, expect, it } from 'vitest';
import { itensDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { comoFoiAchado, visibilidadeDoDetalhe } from '@/lib/ludmillaPainel';
import {
  AFAZERES_DE_EXEMPLO, CONTAS_DE_EXEMPLO, UPDATES_DE_EXEMPLO, nomeDaContaDeExemplo, rotuloDeExemplo,
} from '@/lib/ludmillaCaixa.fixtures';

const ITENS = itensDaCaixa({
  updates: UPDATES_DE_EXEMPLO, afazeres: AFAZERES_DE_EXEMPLO, contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (chave: string): ItemDaCaixa => {
  const i = ITENS.find(x => x.chave === chave);
  if (!i) throw new Error(`sem ${chave} nas fixtures`);
  return i;
};

describe('visibilidadeDoDetalhe — o que o painel de detalhe mostra', () => {
  it('recomendação pendente com projeto: seletor de etapa, sugestão e linha do tempo', () => {
    const v = visibilidadeDoDetalhe(item('u:u-cpfl'));
    expect(v.sugestao).toBe(true);
    expect(v.seletor).toBe(true);
    expect(v.avisoDeBloqueio).toBe(false);
    expect(v.trocaDeProtocolo).toBe(false);
    expect(v.ressalvaNaSugestao).toBe(true);
    expect(v.linhaDoTempo).toBe(true);
  });

  it('bloqueado (documento de outra pessoa): SEM seletor, sem troca de protocolo, ressalva no aviso vermelho', () => {
    const v = visibilidadeDoDetalhe(item('u:u-enel-bloq'));
    expect(v.seletor).toBe(false);
    expect(v.avisoDeBloqueio).toBe(true);
    expect(v.trocaDeProtocolo).toBe(false);
    expect(v.ressalvaNaSugestao).toBe(false);
    expect(v.sugestao).toBe(true);
  });

  it('bloqueado com troca de protocolo marcada: a troca não é explicada (o Aplicar não existe)', () => {
    const base = item('u:u-enel-bloq');
    const v = visibilidadeDoDetalhe({ ...base, update: { ...base.update!, atualizar_protocolo: true } });
    expect(v.trocaDeProtocolo).toBe(false);
    expect(v.seletor).toBe(false);
  });

  it('sem projeto casado: SEM seletor (não há card para mover) e sem linha do tempo', () => {
    const v = visibilidadeDoDetalhe(item('u:u-cpfl-sem'));
    expect(v.seletor).toBe(false);
    expect(v.linhaDoTempo).toBe(false);
    expect(v.sugestao).toBe(true);
  });

  it('A fazer: SEM seletor, sem sugestão e sem protocolo do cartão', () => {
    const v = visibilidadeDoDetalhe(item('f:f-vistoria'));
    expect(v.seletor).toBe(false);
    expect(v.sugestao).toBe(false);
    expect(v.trocaDeProtocolo).toBe(false);
    expect(v.avisoDeBloqueio).toBe(false);
    expect(v.rotuloDoProtocolo).toBeNull();
    expect(v.linhaDoTempo).toBe(true);
  });

  it('A fazer sem projeto: sem linha do tempo', () => {
    expect(visibilidadeDoDetalhe(item('f:f-devolucao')).linhaDoTempo).toBe(false);
  });

  it('troca de protocolo pendente e não bloqueada: explicada', () => {
    const v = visibilidadeDoDetalhe(item('u:u-enel-troca'));
    expect(v.trocaDeProtocolo).toBe(true);
    expect(v.seletor).toBe(true);
  });

  it('decidida (aplicada ou ignorada): sem seletor e sem a explicação do que o Aplicar faria', () => {
    for (const chave of ['u:u-aplicada', 'u:u-ignorada']) {
      const v = visibilidadeDoDetalhe(item(chave));
      expect(v.seletor).toBe(false);
      expect(v.trocaDeProtocolo).toBe(false);
    }
    const troca = item('u:u-enel-troca');
    const aplicada = visibilidadeDoDetalhe({ ...troca, situacao: 'aplicada', update: { ...troca.update!, situacao: 'aplicada' } });
    expect(aplicada.trocaDeProtocolo).toBe(false);
  });

  it('o protocolo do cartão tem o rótulo do meio: e-mail para EDP/ENEL, portal para CPFL e estação', () => {
    expect(visibilidadeDoDetalhe(item('u:u-edp')).rotuloDoProtocolo).toBe('Protocolo no e-mail');
    expect(visibilidadeDoDetalhe(item('u:u-enel-troca')).rotuloDoProtocolo).toBe('Protocolo no e-mail');
    expect(visibilidadeDoDetalhe(item('u:u-cpfl')).rotuloDoProtocolo).toBe('Protocolo no portal');
    expect(visibilidadeDoDetalhe(item('u:u-cpfl-sem')).rotuloDoProtocolo).toBe('Protocolo no portal');
    expect(visibilidadeDoDetalhe({ ...item('u:u-cpfl'), meio: 'estacao' }).rotuloDoProtocolo).toBe('Protocolo no portal');
  });
});

/**
 * Da rodada da ENEL (5d78b6e): o cartão de E-MAIL diz SEMPRE como o projeto foi achado —
 * "achado pelo nome do titular" pede mais cuidado de quem confere que "achado pelo protocolo".
 * O cartão do portal (CPFL) fica como era no detalhe: só diz quando NÃO foi pelo protocolo.
 */
describe('comoFoiAchado — o "Quem" do detalhe', () => {
  it('e-mail (EDP, ENEL): sempre, inclusive pelo protocolo', () => {
    expect(comoFoiAchado(item('u:u-edp'))).toBe('achado pelo protocolo');
    expect(comoFoiAchado(item('u:u-enel-troca'))).toBe('achado pela UC');
    expect(comoFoiAchado(item('u:u-enel-bloq'))).toBe('achado pelo nome do titular');
  });

  it('portal (CPFL): só quando não foi pelo protocolo', () => {
    expect(comoFoiAchado(item('u:u-cpfl'))).toBeNull();
    const base = item('u:u-cpfl');
    expect(comoFoiAchado({ ...base, update: { ...base.update!, casamento: 'cpf' } })).toBe('casado por CPF/CNPJ');
  });

  it('sem como dizer: casamento vazio ou A fazer', () => {
    const edp = item('u:u-edp');
    expect(comoFoiAchado({ ...edp, update: { ...edp.update!, casamento: null } })).toBeNull();
    expect(comoFoiAchado(item('f:f-vistoria'))).toBeNull();
  });
});
