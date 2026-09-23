/**
 * Telefone ↔ JID do WhatsApp. Módulo PURO (sem Deno, sem fetch) para ser
 * testado pelo vitest e usado pelas edge functions do Zé.
 *
 * JID individual: <ddi><ddd><numero>@s.whatsapp.net
 * Grupo: <id>@g.us
 * LID (identificador novo do WhatsApp): <id>@lid — NÃO é telefone.
 */

export function telefoneDoJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [usuario, servidor] = jid.split('@');
  if (servidor !== 's.whatsapp.net') return null;
  const digitos = usuario.replace(/\D/g, '');
  return digitos.length >= 10 ? digitos : null;
}

export function ehGrupo(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function jidDoTelefone(digitos: string): string {
  return `${digitos.replace(/\D/g, '')}@s.whatsapp.net`;
}

/**
 * Dois telefones brasileiros são "o mesmo" quando batem DDD + últimos 8
 * dígitos. Ignora DDI (55) e o nono dígito, que aparecem ou não conforme a
 * fonte (agenda, conta de luz, JID).
 */
export function mesmoNumero(a: string | null, b: string | null): boolean {
  const na = nucleo(a);
  const nb = nucleo(b);
  return na !== null && nb !== null && na === nb;
}

function nucleo(tel: string | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  const ultimos8 = d.slice(-8);
  return ddd + ultimos8;
}
