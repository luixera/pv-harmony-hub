import { describe, expect, it } from 'vitest';
import {
  diaDaSemana, diaEMes, diaEmBrasilia, diasEntre, horaEMinuto, inicioDoDia, maiuscula, quandoCurto, saudacaoDaHora,
} from './ludmillaTempo';

/** Segunda, 9/11/2026, 08:15 de Brasília. */
const SEG = Date.parse('2026-11-09T11:15:00Z');

describe('o dia em Brasília', () => {
  it('vira à meia-noite de Brasília, não à de Greenwich', () => {
    expect(diaEmBrasilia(Date.parse('2026-11-10T02:59:00Z'))).toBe(diaEmBrasilia(SEG));
    expect(diaEmBrasilia(Date.parse('2026-11-10T03:00:00Z'))).toBe(diaEmBrasilia(SEG) + 1);
  });

  it('conta dias de calendário', () => {
    expect(diasEntre('2026-11-09T10:00:00Z', SEG)).toBe(0);
    expect(diasEntre('2026-11-09T02:00:00Z', SEG)).toBe(1); // 23:00 de domingo
    expect(diasEntre('2026-11-06T20:00:00Z', SEG)).toBe(3);
    expect(diasEntre('lixo', SEG)).toBe(0);
    expect(diasEntre(null, SEG)).toBe(0);
  });

  it('começa às 00:00 de Brasília', () => {
    expect(inicioDoDia(SEG)).toBe(Date.parse('2026-11-09T03:00:00Z'));
  });
});

describe('como a fatura escreve', () => {
  it('hora, data, dia da semana', () => {
    expect(horaEMinuto(SEG)).toBe('08:15');
    expect(diaEMes(SEG)).toBe('9/11');
    expect(diaDaSemana(SEG)).toBe('segunda');
    expect(diaDaSemana(Date.parse('2026-11-06T20:00:00Z'))).toBe('sexta');
    expect(maiuscula('segunda')).toBe('Segunda');
    expect(maiuscula('')).toBe('');
  });

  it('quandoCurto: só a hora se foi hoje', () => {
    expect(quandoCurto(Date.parse('2026-11-09T11:02:00Z'), SEG)).toBe('08:02');
    expect(quandoCurto(Date.parse('2026-11-06T20:40:00Z'), SEG)).toBe('6/11 17:40');
  });

  it('a saudação pela hora de Brasília', () => {
    expect(saudacaoDaHora(Date.parse('2026-11-09T14:59:00Z'))).toBe('Bom dia');
    expect(saudacaoDaHora(Date.parse('2026-11-09T15:00:00Z'))).toBe('Boa tarde');
    expect(saudacaoDaHora(Date.parse('2026-11-09T21:00:00Z'))).toBe('Boa noite');
    expect(saudacaoDaHora(Date.parse('2026-11-09T02:00:00Z'))).toBe('Boa noite');
  });
});
