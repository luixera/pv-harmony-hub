import { describe, it, expect } from 'vitest';
import { telefoneDoJid, ehGrupo, mesmoNumero, jidDoTelefone } from './telefone.ts';

describe('telefoneDoJid', () => {
  it('extrai os dígitos de um JID individual', () => {
    expect(telefoneDoJid('5519999990000@s.whatsapp.net')).toBe('5519999990000');
  });
  it('devolve null para grupo, lid, broadcast e vazio', () => {
    expect(telefoneDoJid('120363012345@g.us')).toBeNull();
    expect(telefoneDoJid('98765432101234@lid')).toBeNull();
    expect(telefoneDoJid('status@broadcast')).toBeNull();
    expect(telefoneDoJid(null)).toBeNull();
    expect(telefoneDoJid(undefined)).toBeNull();
  });
});

describe('ehGrupo', () => {
  it('reconhece @g.us', () => {
    expect(ehGrupo('120363012345@g.us')).toBe(true);
    expect(ehGrupo('5519999990000@s.whatsapp.net')).toBe(false);
  });
});

describe('mesmoNumero', () => {
  it('iguala com e sem o nono dígito', () => {
    expect(mesmoNumero('5519999990000', '551999990000')).toBe(true);
  });
  it('iguala com e sem o DDI', () => {
    expect(mesmoNumero('5519999990000', '19999990000')).toBe(true);
  });
  it('não iguala DDDs diferentes', () => {
    expect(mesmoNumero('5519999990000', '5511999990000')).toBe(false);
  });
  it('null nunca iguala', () => {
    expect(mesmoNumero(null, '5519999990000')).toBe(false);
  });
});

describe('jidDoTelefone', () => {
  it('monta o JID individual', () => {
    expect(jidDoTelefone('5519999990000')).toBe('5519999990000@s.whatsapp.net');
  });
});
