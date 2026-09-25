import { describe, expect, it } from 'vitest';
import { acharNoCatalogo, chaveEquip, vinculoAindaVale } from './equipmentMatch';

/**
 * O caso real que motivou: o projetista troca o equipamento no modal, o
 * vínculo com o catálogo continua no antigo e o PACOTE DO INSTALADOR sai com
 * o INMETRO/datasheet do equipamento que não é mais o do projeto.
 */
const CATALOGO = [
  { id: 'a', brand: 'HOYMILES', model: 'HMS-2250DW-4T' },
  { id: 'b', brand: 'Sungrow', model: 'SG7.5RS-L' },
  { id: 'c', brand: 'GROWATT NEW ENERGY', model: 'NEO 2250M-X2' },
  { id: 'd', brand: 'WEG', model: 'SIW200G M030 W1' },
];

describe('chaveEquip', () => {
  it('ignora caixa, espaço e pontuação', () => {
    expect(chaveEquip('HMS-1875DW-4T')).toBe(chaveEquip('hms 1875dw4t'));
    expect(chaveEquip('SOFAR 7,5KTLM')).toBe(chaveEquip('Sofar 7.5KTLM'));
    expect(chaveEquip(null)).toBe('');
  });
});

describe('vinculoAindaVale', () => {
  it('vale quando o modelo do vínculo é o do projeto (mesmo escrito diferente)', () => {
    expect(vinculoAindaVale(CATALOGO[0], 'hms2250dw4t')).toBe(true);
  });
  it('NÃO vale quando o projeto passou a ter outro equipamento', () => {
    expect(vinculoAindaVale(CATALOGO[0], 'SG7.5RS-L')).toBe(false);
  });
  it('sem modelo no projeto não há como desmentir o vínculo', () => {
    expect(vinculoAindaVale(CATALOGO[0], '')).toBe(true);
    expect(vinculoAindaVale(null, 'qualquer')).toBe(false);
  });
});

describe('acharNoCatalogo', () => {
  it('vínculo válido vence', () => {
    expect(acharNoCatalogo(CATALOGO, 'a', 'HOYMILES', 'HMS-2250DW-4T')?.id).toBe('a');
  });

  it('TROCA DE EQUIPAMENTO: vínculo velho é ignorado e casa pelo que está escrito', () => {
    // projeto agora é SUNGROW SG7.5RS-L, mas o vínculo ficou no HOYMILES
    expect(acharNoCatalogo(CATALOGO, 'a', 'SUNGROW', 'SG7.5RS-L')?.id).toBe('b');
  });

  it('modelo trocado dentro da mesma marca também é pego (WEG M030 → M060)', () => {
    expect(acharNoCatalogo(CATALOGO, 'd', 'WEG', 'SIW200G M060 W0')).toBeNull();
  });

  it('sem vínculo, casa por marca+modelo', () => {
    expect(acharNoCatalogo(CATALOGO, null, 'Sungrow', 'SG7.5RS-L')?.id).toBe('b');
  });

  it('marca escrita de outro jeito: cai para o modelo', () => {
    expect(acharNoCatalogo(CATALOGO, null, 'Growatt', 'NEO 2250M-X2')?.id).toBe('c');
  });

  it('equipamento fora do catálogo devolve null em vez de chutar', () => {
    expect(acharNoCatalogo(CATALOGO, null, 'AUXSOL', 'ASN6SL-G2')).toBeNull();
    expect(acharNoCatalogo(CATALOGO, 'a', 'AUXSOL', 'ASN6SL-G2')).toBeNull();
  });

  it('sem modelo no projeto e sem vínculo: não inventa', () => {
    expect(acharNoCatalogo(CATALOGO, null, 'Sungrow', '')).toBeNull();
  });
});
