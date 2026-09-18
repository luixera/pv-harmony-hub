import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PizZip from 'pizzip';
import { gerarFormularioCemig } from './gerarFormularioCemig';
import { valoresFormularioCemig, type RespostasCemig } from './cemigForm';

/**
 * Contra o MODELO REAL da CEMIG (docs/modelos-cemig): as caixas 8.5.1 (Grid
 * Zero) e 8.5.3 (FAST TRACK) são fórmulas do formulário e precisam sair
 * marcadas quando a resposta é "Sim" — foi o que o usuário viu faltando
 * (17/09/2026). E AT95 (potência ativa) mantém a fórmula da CEMIG.
 */

const MODELO = readFileSync(resolve(__dirname, '../../../docs/modelos-cemig/FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx'));

const PROJETO: Record<string, string> = {
  codigo_projeto: 'PRJ-TESTE', nome_titular: 'FULANO DE TAL', cpf_cnpj: '123.456.789-00', numero_uc: '3005478195',
  endereco_rua: 'RUA A', endereco_numero: '10', endereco_bairro: 'CENTRO', endereco_cidade: 'UBERABA', endereco_estado: 'MG',
  endereco_cep: '38000-000', telefone_titular: '(34) 99999-0000', email_titular: 'a@b.c',
  utm_fuso: '23K', utm_longitude: '812186,00', utm_latitude: '7796195,00', fase: 'bifasico', disjuntor: '63A',
  potencia_modulo: '620', potencia_inversor: '5', potencia_total: '7,44 kW', potencia_inversores: '5 kW', area_ocupada: '36 m²',
  module_model: 'RM-620', inverter_model: 'X', module_brand: 'RONMA', inverter_brand: 'GROWATT', module_quantity: '12', inverter_quantity: '1',
};

const celula = (bytes: Uint8Array, ref: string) => {
  const xml = new PizZip(bytes).file('xl/worksheets/sheet1.xml')!.asText();
  return new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? '';
};

const gerar = (r: Partial<RespostasCemig>) => gerarFormularioCemig(MODELO.buffer.slice(MODELO.byteOffset, MODELO.byteOffset + MODELO.byteLength), PROJETO, {
  fastTrack: 'Não', gridZero: 'Não', tipoSolicitacao: 'Conexão de GD em Unidade Consumidora Existente SEM Alteração de Potência Disponibilizada', ...r,
});

describe('formulário da CEMIG — caixas 8.5.x', () => {
  it('FAST TRACK = Sim marca a 8.5.3 (C211) mantendo a fórmula da CEMIG', () => {
    const g = gerar({ fastTrack: 'Sim' });
    expect(celula(g.bytes, 'AL12')).toContain('>Sim<');
    expect(celula(g.bytes, 'C211')).toContain('<f>IF(AL12=Dados!V5,"X","")</f><v>X</v>');
    expect(celula(g.bytes, 'C206')).toContain('<v/>'); // Grid Zero Não: 8.5.1 fica como no modelo
  });

  it('Grid Zero = Sim marca a 8.5.1 (C206)', () => {
    const g = gerar({ gridZero: 'Sim' });
    expect(celula(g.bytes, 'O14')).toContain('>Sim<');
    expect(celula(g.bytes, 'C206')).toContain('<f>IF(O14=Dados!V5,"X","")</f><v>X</v>');
    expect(celula(g.bytes, 'C211')).toContain('<v/>');
  });

  it('FAST TRACK = Não deixa a 8.5.3 vazia (fórmula intacta) e o arquivo pede recálculo ao abrir', () => {
    const g = gerar({});
    expect(celula(g.bytes, 'C211')).toContain('<f>IF(AL12=Dados!V5,"X","")</f><v/>');
    expect(new PizZip(g.bytes).file('xl/workbook.xml')!.asText()).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });

  it('AT95 (potência ativa) mantém a fórmula MIN(L116,AI116) da CEMIG com o nosso valor em cache', () => {
    const g = gerar({});
    expect(celula(g.bytes, 'AT95')).toMatch(/<f>IF\(TipoFonte="Solar",MIN\(L116,AI116\),AI108\)<\/f><v>5<\/v>/);
  });

  it('valoresFormularioCemig traduz as respostas nas marcas das caixas', () => {
    const v = valoresFormularioCemig(PROJETO, { fastTrack: 'Sim', gridZero: 'Não', tipoSolicitacao: 'x' });
    expect(v.cemig_x_fast_track).toBe('X');
    expect(v.cemig_x_grid_zero).toBe('');
  });
});
