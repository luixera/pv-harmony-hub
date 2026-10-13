import { describe, it, expect } from 'vitest';
import { conectorDe, validarCorpo } from './ludmillaStatus';

/**
 * A API de status existe porque a Ludmilla não consegue ler o Portal GD da
 * Elektro sozinha: a pessoa entra e entrega o que viu. Estes testes travam a
 * forma do que chega — a mesma que os conectores da varredura devolvem —
 * para que `ludmilla_registrar_varredura` faça o resto sem saber a origem.
 */

describe('conectorDe', () => {
  it('reconhece o nome da concessionária como aparece no cadastro', () => {
    expect(conectorDe('ELEKTRO')).toBe('elektro');
    expect(conectorDe('CPFL Paulista')).toBe('cpfl');
    expect(conectorDe(' edp ')).toBe('edp');
  });

  it('não chuta o que não conhece', () => {
    expect(conectorDe('CEMIG')).toBeNull();
    expect(conectorDe('')).toBeNull();
    expect(conectorDe(42)).toBeNull();
    expect(conectorDe('cpflx')).toBeNull();
  });
});

describe('validarCorpo', () => {
  const ok = {
    concessionaria: 'ELEKTRO',
    protocolos: [{ protocolo: ' 2026-000123 ', status: '  Em análise ', titular: 'FULANO' }],
  };

  it('aceita o corpo mínimo e normaliza espaços', () => {
    const r = validarCorpo(ok);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.connector).toBe('elektro');
    expect(r.protocolos).toEqual([
      { protocolo: '2026-000123', status: 'Em análise', titular: 'FULANO', raw: { origem: 'api' } },
    ]);
  });

  it('aceita "connector" no lugar de "concessionaria"', () => {
    const r = validarCorpo({ connector: 'cpfl', protocolos: ok.protocolos });
    expect(r.ok && r.connector).toBe('cpfl');
  });

  it('recusa concessionária desconhecida com a lista do que vale', () => {
    const r = validarCorpo({ concessionaria: 'CEMIG', protocolos: ok.protocolos });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe('concessionaria_invalida');
    expect(r.detalhe).toContain('elektro');
  });

  it('recusa lista ausente, vazia ou item sem protocolo/status, dizendo QUAL item', () => {
    expect(validarCorpo({ concessionaria: 'ELEKTRO' })).toMatchObject({ ok: false, erro: 'protocolos_invalidos' });
    expect(validarCorpo({ concessionaria: 'ELEKTRO', protocolos: [] })).toMatchObject({ ok: false, erro: 'protocolos_invalidos' });
    const r = validarCorpo({ concessionaria: 'ELEKTRO', protocolos: [ok.protocolos[0], { protocolo: '1' }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detalhe).toContain('Item 2');
  });

  it('o mesmo protocolo duas vezes: a última linha vence', () => {
    const r = validarCorpo({
      concessionaria: 'ELEKTRO',
      protocolos: [{ protocolo: '1', status: 'Em análise' }, { protocolo: '1', status: 'Aprovado' }],
    });
    expect(r.ok && r.protocolos).toEqual([{ protocolo: '1', status: 'Aprovado', titular: '', raw: { origem: 'api' } }]);
  });

  it('guarda a observação no raw e corta o excesso', () => {
    const r = validarCorpo({
      concessionaria: 'ELEKTRO',
      protocolos: [{ protocolo: '1', status: 'x', observacao: 'a'.repeat(600) }],
    });
    expect(r.ok && r.protocolos[0].raw.observacao?.length).toBe(500);
  });

  it('não aceita corpo que não é objeto', () => {
    expect(validarCorpo(null)).toMatchObject({ ok: false, erro: 'corpo_invalido' });
    expect(validarCorpo([])).toMatchObject({ ok: false, erro: 'corpo_invalido' });
    expect(validarCorpo('x')).toMatchObject({ ok: false, erro: 'corpo_invalido' });
  });
});
