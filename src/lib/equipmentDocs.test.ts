import { describe, it, expect } from 'vitest';
import { buildEquipmentDocName, buildEquipmentDocPath, ehDocumentoCompartilhavel } from './equipmentDocs';

/**
 * O que estes testes travam (incidente de 12/10/2026):
 *
 * O certificado AFCI pode ser compartilhado — um inversor sem certificado
 * próprio herda o de outro modelo da mesma marca, e os dois apontam para o
 * MESMO arquivo. Ao salvar um equipamento sem anexo novo, o app renomeava
 * (move) o arquivo para a pasta dele; como o arquivo era compartilhado, cada
 * edição levava o certificado embora e quebrava o link de todos os irmãos.
 *
 * Resultado medido: 29 dos 44 certificados do catálogo apontavam para arquivo
 * inexistente, enquanto datasheet (126) e INMETRO (103) — documentos do modelo,
 * com arquivo exclusivo — estavam íntegros. Na tela o link aparecia normal
 * (ela só olha se a coluna tem texto) e só o pacote do instalador reclamava.
 */

describe('ehDocumentoCompartilhavel', () => {
  it('só o AFCI pode ser compartilhado entre modelos', () => {
    expect(ehDocumentoCompartilhavel('afci')).toBe(true);
    expect(ehDocumentoCompartilhavel('datasheet')).toBe(false);
    expect(ehDocumentoCompartilhavel('inmetro')).toBe(false);
  });
});

describe('buildEquipmentDocPath', () => {
  it('o arquivo mora na pasta do equipamento que o anexou', () => {
    expect(buildEquipmentDocPath('eq-1', 'datasheet', 'HOYMILES', 'HMS-2250DW-4T'))
      .toBe('eq-1/datasheet/DATASHEET_HOYMILES_HMS-2250DW-4T.pdf');
    expect(buildEquipmentDocPath('eq-1', 'afci', 'HOYMILES', 'HMS-2250DW-4T'))
      .toBe('eq-1/afci/AFCI_HOYMILES_HMS-2250DW-4T.pdf');
  });

  it('marca com barra não escapa da pasta', () => {
    const p = buildEquipmentDocPath('eq-1', 'afci', 'SUN/GROW', 'Z');
    expect(p.split('/')).toHaveLength(3);
    expect(p).not.toContain('SUN/GROW');
  });

  it('acento no nome vira ASCII seguro', () => {
    expect(buildEquipmentDocPath('eq-1', 'inmetro', 'SOLÁRIS', 'MOD-1'))
      .toBe('eq-1/inmetro/INMETRO_SOLARIS_MOD-1.pdf');
  });
});

describe('buildEquipmentDocName', () => {
  it('traz tipo, marca e modelo em caixa alta', () => {
    expect(buildEquipmentDocName('datasheet', 'hoymiles', 'hms-2250dw-4t'))
      .toBe('DATASHEET HOYMILES HMS-2250DW-4T.pdf');
    expect(buildEquipmentDocName('afci', 'HOYMILES', 'HMS-2250DW-4T'))
      .toBe('AFCI HOYMILES HMS-2250DW-4T.pdf');
  });

  it('espaço sobrando não vira nome torto', () => {
    expect(buildEquipmentDocName('inmetro', '  DEYE  ', ' SUN-7.5K-G '))
      .toBe('INMETRO DEYE SUN-7.5K-G.pdf');
  });
});
