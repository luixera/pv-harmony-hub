import { describe, expect, it } from 'vitest';
import { itensDaCaixa } from '@/lib/ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, AGORA, CONTAS_DE_EXEMPLO, UPDATES_DE_EXEMPLO, nomeDaContaDeExemplo, rotuloDeExemplo,
} from '@/lib/ludmillaCaixa.fixtures';
import { contarCarteira, donosPorProjetoDe, filtrarCarteira } from '@/lib/ludmillaCarteira';
import { F_COBRANCA } from '@/lib/ludmillaCobranca.fixtures';
import { SEM_DONO, TODOS, filaPorGrupo, resumoDaFila } from '@/lib/ludmillaFila';
import { CARTEIRA_DE_EXEMPLO, REGISTRO_DE_EXEMPLO, U_HOJE } from '@/lib/ludmillaPagina.fixtures';
import { diarioPorDia, fezSozinha, recadoDoDia } from '@/lib/ludmillaRecado';

// os mesmos cálculos e argumentos que o harness passa à casca
const DESDE = Date.parse('2026-10-21T21:00:00Z');
const itens = itensDaCaixa({
  updates: [...UPDATES_DE_EXEMPLO, U_HOJE], afazeres: [...AFAZERES_DE_EXEMPLO, F_COBRANCA],
  contas: CONTAS_DE_EXEMPLO, nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const donosPorProjeto = donosPorProjetoDe(CARTEIRA_DE_EXEMPLO);
const ocultos = new Set<string>();
const filaDe = (dono: string) => filaPorGrupo(itens, { ocultos, agora: AGORA, donosPorProjeto, dono });
const chaves = (l: { chave: string }[]) => l.map(i => i.chave);

describe('os números da página com os dados de exemplo (Task 13, Step 8)', () => {
  it('fila de todos: grupos e cartões de Agora', () => {
    const f = filaDe(TODOS);
    expect([f.agora.length, f.semana.length, f.depois.length]).toEqual([3, 4, 2]);
    expect(chaves(f.agora).sort()).toEqual(['f:f-cob', 'f:f-devolucao', 'u:u-hoje']);
  });

  it('carteira: contagens e ordem dos parados', () => {
    const n = contarCarteira(CARTEIRA_DE_EXEMPLO);
    expect([n.parados, n.nos, n.concessionaria, n.cliente, n.todos]).toEqual([4, 6, 2, 1, 9]);
    expect(filtrarCarteira(CARTEIRA_DE_EXEMPLO, 'parados').map(l => l.projectId)).toEqual(['p-12', 'p-9', 'p-7', 'p-1']);
  });

  it('fila sem dono e resumo', () => {
    const f = filaDe(SEM_DONO);
    // o Step 8 olhava a vista Agora (a aberta); os 5 sem dono estão espalhados pelos três grupos
    expect(chaves(f.agora).sort()).toEqual(['f:f-cob', 'f:f-devolucao']);
    expect(f.agora.length + f.semana.length + f.depois.length).toBe(5);
    expect(resumoDaFila(itens, { ocultos, agora: AGORA, donosPorProjeto }).semDono).toBe(5);
  });

  it('Fiz sozinha, recado e Diário', () => {
    const feitos = fezSozinha(REGISTRO_DE_EXEMPLO, DESDE);
    expect(feitos).toHaveLength(2);
    const resumo = resumoDaFila(itens, { ocultos, agora: AGORA, donosPorProjeto });
    const recado = recadoDoDia({
      agora: AGORA, desde: DESDE, fizSozinha: feitos.length, separei: resumo.total, paraAgora: resumo.agora, semDono: resumo.semDono,
      leituras: [
        { nome: 'ENEL SP', meio: 'email', emails: 12, protocolos: null },
        { nome: 'CPFL Paulista', meio: 'portal', emails: null, protocolos: 199 },
      ],
    });
    expect(recado.texto).toBe(
      'Bom dia. Desde ontem li 12 e-mails da ENEL SP e 199 protocolos da CPFL Paulista. Fiz 2 coisas sozinha. Separei 9 coisas para vocês; 5 estão sem dono.',
    );
    expect(diarioPorDia(REGISTRO_DE_EXEMPLO, AGORA).map(d => d.rotulo)).toEqual(['Hoje, quinta 22/10', 'Ontem, quarta 21/10', 'Terça, 20/10']);
  });
});
