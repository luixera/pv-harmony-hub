import { describe, it, expect } from 'vitest';
import { acertoDoModelo, rotuloResultado, RESULTADOS, montarRegistro } from './confronto';

describe('confronto com a distribuidora', () => {
  it('a regra de acerto é a mesma do banco (rede_parecer_acerto)', () => {
    expect(acertoDoModelo('risco', 'inversao_sem_novo')).toBe(true);
    expect(acertoDoModelo('atencao', 'inversao_sem_novo')).toBe(false);
    expect(acertoDoModelo('folga', 'sem_inversao')).toBe(true);
    expect(acertoDoModelo('risco', 'inversao_com_novo')).toBe(false);
    expect(acertoDoModelo('atencao', 'aprovado_com_obra')).toBe(true);
    expect(acertoDoModelo('sem_dado', 'reprovado')).toBeNull();
  });
  it('todo resultado tem rótulo legível', () => {
    for (const r of RESULTADOS) expect(rotuloResultado(r).length).toBeGreaterThan(5);
  });
  it('o registro só leva números que foram preenchidos; vazio vira ausência, não zero', () => {
    const r = montarRegistro(685391, { tipo: 'orcamento_conexao', resultado: 'inversao_sem_novo', codigo_distribuidora: ' 189049 ',
      numero_estudo: 'OC00693/10-2026', numero_pedido: '', data_documento: '2026-10-12', potencia_solicitada_kw: '12',
      potencia_injetavel_kw: '4,00', ucs_distribuidora: '45', gd_unidades_distribuidora: '5', gd_kw_distribuidora: '18,85',
      carga_min_distribuidora_kw: '', observacoes: '' });
    expect(r).toMatchObject({ transformador_id: 685391, codigo_distribuidora: '189049', potencia_solicitada_kw: 12, potencia_injetavel_kw: 4, gd_kw_distribuidora: 18.85, ucs_distribuidora: 45 });
    expect(r.numero_pedido).toBeUndefined();
    expect(r.carga_min_distribuidora_kw).toBeUndefined();
  });
});
