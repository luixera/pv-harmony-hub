import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseUpsert, parseConnectionUpdate, parseQrcode, ehSelfChat, EvolutionClient } from './evolution.ts';

// URL relativa ao próprio teste (ESM: sem __dirname).
const fixture = (nome: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/evolution/${nome}`, import.meta.url), 'utf8'));

describe('parseUpsert', () => {
  it('texto simples', () => {
    const m = parseUpsert(fixture('messages-upsert-texto.json').data)!;
    expect(m).toMatchObject({
      jid: '5511988887777@s.whatsapp.net',
      wa_id: '3EB0A1B2C3D4E5F60001',
      from_me: false,
      remetente: 'João Titular',
      tipo: 'texto',
      texto: 'Bom dia, mandei a conta de luz',
      is_group: false,
    });
    expect(m.ts).toBe(new Date(1758100000 * 1000).toISOString());
  });

  it('extendedTextMessage', () => {
    expect(parseUpsert(fixture('messages-upsert-extended.json').data)!.texto).toBe('Segue o link https://exemplo');
  });

  it('imagem com legenda vira tipo imagem e texto = legenda', () => {
    const m = parseUpsert(fixture('messages-upsert-imagem-legenda.json').data)!;
    expect(m.tipo).toBe('imagem');
    expect(m.texto).toBe('foto do padrão');
  });

  it('áudio sem texto vira rótulo', () => {
    const m = parseUpsert(fixture('messages-upsert-audio.json').data)!;
    expect(m.tipo).toBe('audio');
    expect(m.texto).toBe('[áudio 12s]');
  });

  it('grupo é marcado pelo sufixo @g.us', () => {
    const m = parseUpsert(fixture('messages-upsert-grupo.json').data)!;
    expect(m.is_group).toBe(true);
    expect(m.jid).toBe('120363012345678@g.us');
  });

  it('payload sem key devolve null', () => {
    expect(parseUpsert({ foo: 1 })).toBeNull();
    expect(parseUpsert(null)).toBeNull();
  });

  it('messageTimestamp como string e como Long', () => {
    const base = fixture('messages-upsert-texto.json').data;
    expect(parseUpsert({ ...base, messageTimestamp: '1758100000' })!.ts).toBe(new Date(1758100000000).toISOString());
    expect(parseUpsert({ ...base, messageTimestamp: { low: 1758100000, high: 0 } })!.ts).toBe(new Date(1758100000000).toISOString());
  });
});

describe('ehSelfChat', () => {
  const self = parseUpsert(fixture('messages-upsert-self-chat.json').data)!;

  it('mensagem minha para o meu próprio JID', () => {
    expect(ehSelfChat(self, '5519999990000@s.whatsapp.net')).toBe(true);
  });

  it('mesmo número com formatação diferente', () => {
    expect(ehSelfChat(self, '55199999-90000@s.whatsapp.net')).toBe(true);
  });

  it('não é self-chat quando é mensagem de terceiro ou phone_jid desconhecido', () => {
    const outro = parseUpsert(fixture('messages-upsert-texto.json').data)!;
    expect(ehSelfChat(outro, '5519999990000@s.whatsapp.net')).toBe(false);
    expect(ehSelfChat(self, null)).toBe(false);
  });
});

describe('parseConnectionUpdate / parseQrcode', () => {
  it('open → conectado com wuid', () => {
    expect(parseConnectionUpdate(fixture('connection-update-open.json').data)).toEqual({
      situacao: 'conectado',
      wuid: '5519999990000@s.whatsapp.net',
    });
  });

  it('close → desconectado', () => {
    expect(parseConnectionUpdate(fixture('connection-update-close.json').data).situacao).toBe('desconectado');
  });

  it('connecting → aguardando_qr', () => {
    expect(parseConnectionUpdate({ state: 'connecting' }).situacao).toBe('aguardando_qr');
  });

  it('qrcode.updated devolve o base64', () => {
    expect(parseQrcode(fixture('qrcode-updated.json').data)).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(parseQrcode({ message: 'QR code limit reached' })).toBeNull();
  });
});

describe('EvolutionClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enviarTexto manda apikey, number e text e devolve o id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ key: { id: 'ABC123', remoteJid: '5519999990000@s.whatsapp.net', fromMe: true } }),
        { status: 201 },
      ),
    );
    const c = new EvolutionClient('https://zap.exemplo', 'CHAVE');
    const r = await c.enviarTexto('ze-teste', '5519999990000', 'olá');
    expect(r.wa_id).toBe('ABC123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://zap.exemplo/message/sendText/ze-teste');
    expect((init!.headers as Record<string, string>).apikey).toBe('CHAVE');
    expect(JSON.parse(init!.body as string)).toEqual({ number: '5519999990000', text: 'olá' });
  });

  it('estado devolve inexistente em 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":404}', { status: 404 }));
    const c = new EvolutionClient('https://zap.exemplo', 'CHAVE');
    expect(await c.estado('ze-teste')).toBe('inexistente');
  });

  it('setWebhook envia o objeto webhook com header x-ze-token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 201 }));
    const c = new EvolutionClient('https://zap.exemplo', 'CHAVE');
    await c.setWebhook('ze-teste', { url: 'https://x/functions/v1/ze-webhook', token: 'T' });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.webhook).toMatchObject({
      enabled: true,
      url: 'https://x/functions/v1/ze-webhook',
      byEvents: false,
      base64: false,
      headers: { 'x-ze-token': 'T' },
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    });
  });

  it('erro HTTP vira exceção com status e trecho do corpo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"message":"Unauthorized"}', { status: 401 }));
    const c = new EvolutionClient('https://zap.exemplo', 'CHAVE');
    await expect(c.logout('ze-teste')).rejects.toThrow(/Evolution 401/);
  });
});
