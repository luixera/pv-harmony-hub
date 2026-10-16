import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atrasoAteProximaJanela, deveTentar, normalizar, dentroDaCaixa, linhasDaTupi, registrarResultado } from '../src/status.js';

/**
 * O coletor da Tupi é a parte pura do monitor de eletropostos: dado o JSON do
 * mapa público, quais linhas vão para o banco. Regras do sistema original
 * (coletor_tupi.py): só a caixa de Rio Preto + Mirassol + Bady Bassitt, uma
 * linha por conector, status normalizado e NENHUM campo de usuário.
 */

test('normaliza os status da Tupi e dos apps para o vocabulário do monitor', () => {
  assert.equal(normalizar('Available'), 'livre');
  assert.equal(normalizar('Charging'), 'ocupado');
  assert.equal(normalizar('SuspendedEV'), 'ocupado');
  assert.equal(normalizar('Faulted'), 'fora');
  assert.equal(normalizar(' Disponível '), 'livre');
  assert.equal(normalizar('Em carregamento'), 'ocupado');
  assert.equal(normalizar('manutenção'), 'fora');
  assert.equal(normalizar('xpto'), 'desconhecido');
  assert.equal(normalizar(null), 'desconhecido');
  assert.equal(normalizar(undefined), 'desconhecido');
});

test('caixa geográfica: Rio Preto dentro, Campinas fora', () => {
  assert.equal(dentroDaCaixa(-20.82, -49.38), true);
  assert.equal(dentroDaCaixa(-22.90, -47.06), false);
  assert.equal(dentroDaCaixa(null, -49.38), false);
});

const estacoes = [
  {
    stationID: 'abc', name: 'BYD Allma', lat: -20.821, lng: -49.399,
    connectedPlugs: [
      { connectorID: 1, power: 60, stateName: 'Charging', updatedAt: '2026-10-15T20:00:00Z', startedUserID: 'u-1', reservedUserID: null },
      { connectorID: 2, power: 60, stateName: 'Available', updatedAt: '2026-10-15T20:01:00Z', startedUserID: null },
    ],
  },
  { stationID: 'longe', name: 'Campinas', lat: -22.9, lng: -47.06, connectedPlugs: [{ connectorID: 1, power: 22, stateName: 'Available' }] },
  { stationID: 'semplug', name: 'Sem conectores', lat: -20.80, lng: -49.40, connectedPlugs: null },
  { stationID: 'semcoord', name: 'Sem coordenada', lat: null, lng: null, connectedPlugs: [{ connectorID: 1, stateName: 'Available' }] },
];

test('uma linha por conector, só dentro da caixa, com status normalizado', () => {
  const r = linhasDaTupi(estacoes);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas[0], {
    local_fonte: 'abc', local_nome: 'BYD Allma', lat: -20.821, lng: -49.399,
    conector: '1', potencia_kw: 60, status_bruto: 'Charging', status: 'ocupado', upstream_ts: '2026-10-15T20:00:00Z',
  });
  assert.equal(r.linhas[1].conector, '2');
  assert.equal(r.linhas[1].status, 'livre');
  assert.equal(r.estacoes, 2);   // 'abc' e 'semplug' estão na caixa; a sem conector conta como estação vista
});

test('nenhum campo de usuário escapa para o banco', () => {
  const texto = JSON.stringify(linhasDaTupi(estacoes));
  assert.equal(texto.includes('UserID'), false);
  assert.equal(texto.includes('u-1'), false);
});

test('entrada que não é lista vira zero linhas, sem explodir', () => {
  assert.deepEqual(linhasDaTupi(null as unknown as unknown[]), { linhas: [], estacoes: 0 });
  assert.deepEqual(linhasDaTupi({} as unknown as unknown[]), { linhas: [], estacoes: 0 });
});

test('o tique alinha à próxima virada de 5 min, com folga de 5 s', () => {
  const t = Date.UTC(2026, 9, 16, 12, 3, 20);          // 12:03:20 → próxima virada 12:05:00
  assert.equal(atrasoAteProximaJanela(t), 100_000 + 5_000);
  const naVirada = Date.UTC(2026, 9, 16, 12, 5, 0);    // exatamente na virada: espera o passo inteiro
  assert.equal(atrasoAteProximaJanela(naVirada), 300_000 + 5_000);
});

test('recuo: 3 recusas seguidas → uma tentativa por hora; sucesso zera; outro erro não conta', () => {
  let r = { recusasSeguidas: 0, ultimaTentativa: 0 };
  const t = Date.UTC(2026, 9, 16, 16, 0, 0);
  r = registrarResultado(r, false, t, 'Tupi respondeu HTTP 403');
  r = registrarResultado(r, false, t + 300_000, 'Tupi respondeu HTTP 403');
  assert.equal(deveTentar(r, t + 600_000), true);                  // 2 recusas: ainda tenta
  r = registrarResultado(r, false, t + 600_000, 'Tupi respondeu HTTP 403');
  assert.equal(deveTentar(r, t + 900_000), false);                 // 3 recusas: em recuo
  assert.equal(deveTentar(r, t + 600_000 + 60 * 60_000), true);    // 1 h depois: tenta de novo
  r = registrarResultado(r, false, t + 4_200_000, 'fetch failed'); // erro de rede não é recusa
  assert.equal(r.recusasSeguidas, 0);
  r = registrarResultado(r, true, t + 4_500_000);
  assert.equal(r.recusasSeguidas, 0);
});
