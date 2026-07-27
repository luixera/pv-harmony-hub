import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Semeia os MODELOS OFICIAIS de memorial descritivo nas concessionárias —
 * bucket `concessionaire-templates`, a mesma pasta onde vivem os Anexos E/F,
 * pra todos os tenants que tenham a concessionária (incluindo a biblioteca
 * da GD Manager).
 *
 * Idempotente: se a concessionária já tiver um arquivo com o mesmo nome-base,
 * pula. Depois de atualizar um modelo, chame com `{"overwrite": true}` pra
 * substituir o que já está lá.
 *
 * Os .docx de origem ficam versionados em `docs/modelos-memoriais/`; aqui vão
 * embutidos em base64 (~3KB cada) pra função não depender de rede.
 * Regerar: `node scripts/build-seed-memorial-templates.cjs`.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'concessionaire-templates';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ENEL_B64 = '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';
const EDP_B64 = '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';

const TEMPLATES: { match: RegExp; fileName: string; base64: string }[] = [
  { match: /enel/i, fileName: 'MEMORIAL_DESCRITIVO_ENEL.docx', base64: ENEL_B64 },
  { match: /edp/i, fileName: 'MEMORIAL_DESCRITIVO_EDP.docx', base64: EDP_B64 },
];

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const overwrite = body?.overwrite === true;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: concessionaires, error } = await supabase
      .from('energy_concessionaires')
      .select('id, name, tenant_id');
    if (error) throw error;

    const results: unknown[] = [];
    for (const c of concessionaires ?? []) {
      const tpl = TEMPLATES.find((t) => t.match.test(c.name ?? ''));
      if (!tpl) continue;

      const { data: existing } = await supabase.storage.from(BUCKET).list(c.id, { search: tpl.fileName });
      const already = (existing ?? []).find((f: { name: string }) => f.name.endsWith(tpl.fileName));
      if (already && !overwrite) {
        results.push({ concessionaire: c.name, id: c.id, status: 'ja_existia', file: already.name });
        continue;
      }

      const fileName = already && overwrite ? already.name : `${Date.now()}_${tpl.fileName}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(`${c.id}/${fileName}`, bytesFromBase64(tpl.base64), { contentType: DOCX_MIME, upsert: true });

      results.push(upErr
        ? { concessionaire: c.name, id: c.id, status: 'erro', error: upErr.message }
        : { concessionaire: c.name, id: c.id, status: 'enviado', file: fileName });
    }

    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
