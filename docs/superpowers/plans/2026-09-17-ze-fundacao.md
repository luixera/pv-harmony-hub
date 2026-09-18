# Zé — Fundação (Entrega 1) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar a Evolution API na VPS, conectar o WhatsApp do gestor por QR
pela tela `/ze`, e espelhar cada mensagem (inclusive as do chat "Você") em
tabelas do Supabase — provando que o Zé consegue **ler** o WhatsApp e
**mandar mensagem para o próprio número**.

**Architecture:** Evolution API v2 em Docker atrás do Nginx
(`zap.homologamanager.com.br`), instalada por workflow manual do GitHub
Actions. Duas edge functions: `ze-webhook` (recebe eventos da Evolution e
grava em `wa_*`/`ze_messages`) e `ze-admin` (cria instância, configura
webhook, pede QR, testa envio, desconecta — só admin do tenant `is_library`).
Lógica pura (parse dos payloads, telefone/JID, detecção de self-chat) em
`supabase/functions/_shared/`, testada com vitest.

**Tech Stack:** Evolution API v2 (Docker, Postgres 16, Redis 7) · Nginx +
certbot · Supabase Edge Functions (Deno) · supabase-js · React + shadcn ·
vitest (Node 24 roda `.ts` nativo) · GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-ze-whatsapp-design.md` (§4, §5
parcial, §6, §12 parcial, §13, §15 entrega 1, §16).

## Global Constraints

- **Regra dura 1**: nenhum código envia mensagem a JID diferente de
  `ze_config.phone_jid`. Nesta entrega o único envio é `teste_envio`, e ele
  usa `telefoneDoJid(config.phone_jid)` — nunca um número vindo da requisição.
- **Regra dura 3**: `tenant_id` sempre vem de `ze_config` (pelo `instance`
  do payload ou pelo usuário autenticado), nunca do corpo da requisição.
- **Regra dura 5**: `wa_*` e `ze_messages` só são lidas pelo dono
  (`ze_config.owner_user_id`). Service role só nas edge functions.
- Identificadores novos em **português** (`ze_config`, `wa_messages`,
  `situacao`, `parseUpsert`…); tabelas com `tenant_id` + RLS RESTRICTIVE
  `tenant_isolation` (molde: migração da Ludmilla).
- Edge functions deployadas pelo **CI** (`deploy.yml`) com `--no-verify-jwt`;
  a função faz a própria checagem.
- Migração aplicada com `npx -y supabase db query --linked -f <arquivo>`
  (SQL idempotente: `IF NOT EXISTS`, `DROP POLICY IF EXISTS`). Só o último
  SELECT com linhas volta.
- Verificação antes de concluir: `npm test` (vitest, precisa terminar com
  `Tests … passed`), `npx tsc --noEmit -p tsconfig.app.json` com **65
  erros** (baseline; queda grande = falha de parse), `npm run build`.
  Commit + push em `main` ao fim de cada task.
- Segredos **nunca** no repositório: `EVOLUTION_API_KEY`, `ZE_WEBHOOK_TOKEN`
  vivem nos secrets do GitHub (workflow) e nos secrets das edge functions.
- Windows/Git Bash: para escrever arquivos usar a ferramenta Edit/Write
  (heredoc com aspas no conteúdo já quebrou nesta máquina); não há Python.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260918100000_ze_fundacao.sql` | `ze_config`, `wa_chats`, `wa_messages`, `wa_contacts`, `ze_messages`, RLS, `ze_admin_ok()`, `ze_dono_ok()`, `ze_ativar()` |
| `supabase/functions/_shared/telefone.ts` (+ `.test.ts`) | `telefoneDoJid`, `ehGrupo`, `mesmoNumero` — puro, sem Deno |
| `supabase/functions/_shared/evolution.ts` (+ `.test.ts`) | tipos dos payloads, `parseUpsert`, `parseConnectionUpdate`, `parseQrcode`, `ehSelfChat`, `EvolutionClient` (REST) |
| `supabase/functions/_shared/fixtures/evolution/*.json` | payloads reais/representativos da Evolution para testes e curl |
| `supabase/functions/ze-webhook/index.ts` | recebe eventos; grava espelho; detecta fala do gestor no chat "Você" |
| `supabase/functions/ze-admin/index.ts` | ações da tela: `estado`, `conectar`, `teste_envio`, `desconectar` |
| `src/hooks/useZe.ts` | `useZeDisponivel`, `useZeConfig`, `useZeAcao`, `useAtualizarZeConfig` |
| `src/pages/Ze.tsx` | tela `/ze` — cartão Conexão + preferências |
| `src/App.tsx`, `src/components/layout/Sidebar.tsx` | rota e item de menu (`requiresZe`) |
| `.github/workflows/evolution-vps.yml` | instala/atualiza Evolution + Nginx + SSL na VPS |
| `.github/workflows/deploy.yml`, `supabase/config.toml` | deploy de `ze-webhook` e `ze-admin` |
| `docs/modules/ze/overview.md`, `CLAUDE.md` | doc do módulo (parte da entrega 1) + linha na tabela de módulos |

---

### Task 1: Migração da fundação (tabelas, RLS, RPCs)

**Files:**
- Create: `supabase/migrations/20260918100000_ze_fundacao.sql`
- Test: `scratchpad/ze_rls_teste.sql` (arquivo temporário de teste, não commitado)

**Interfaces:**
- Produces: tabelas `public.ze_config`, `public.wa_chats`, `public.wa_messages`,
  `public.wa_contacts`, `public.ze_messages`; funções `public.ze_admin_ok() → boolean`,
  `public.ze_dono_ok(_tenant uuid) → boolean`, `public.ze_ativar() → public.ze_config`.

- [ ] **Step 1: Escrever a migração**

```sql
-- Zé (José) — fundação, Entrega 1 (spec docs/superpowers/specs/2026-09-17-ze-whatsapp-design.md)
-- Configuração por tenant, espelho do WhatsApp do gestor e o diálogo no chat "Você".
-- Só o dono (owner_user_id) lê o conteúdo do WhatsApp — regra dura 5.

-- ── ze_config: 1 linha por tenant ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ze_config (
  tenant_id            UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name        TEXT NOT NULL UNIQUE,
  phone_jid            TEXT,
  situacao             TEXT NOT NULL DEFAULT 'desconectado'
                       CHECK (situacao IN ('desconectado', 'aguardando_qr', 'conectado')),
  qr_code              TEXT,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  modelo_ia            TEXT NOT NULL DEFAULT 'claude-opus-5',
  esforco              TEXT NOT NULL DEFAULT 'medium' CHECK (esforco IN ('low', 'medium', 'high')),
  fuso                 TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  horas_sem_resposta   INTEGER NOT NULL DEFAULT 2 CHECK (horas_sem_resposta BETWEEN 1 AND 72),
  ignorar_grupos       BOOLEAN NOT NULL DEFAULT TRUE,
  dias_parado          INTEGER NOT NULL DEFAULT 7 CHECK (dias_parado BETWEEN 1 AND 90),
  transcrever_audios   TEXT NOT NULL DEFAULT 'todos' CHECK (transcrever_audios IN ('todos', 'so_meus', 'nenhum')),
  silencio_quando_vazio BOOLEAN NOT NULL DEFAULT TRUE,
  ocupado_ate          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── wa_chats: um por conversa (metadados, sem retenção) ────────────────────
CREATE TABLE IF NOT EXISTS public.wa_chats (
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  jid                 TEXT NOT NULL,
  nome                TEXT,
  is_group            BOOLEAN NOT NULL DEFAULT FALSE,
  ultima_msg_em       TIMESTAMPTZ,
  ultima_de_mim       BOOLEAN,
  ultima_recebida_em  TIMESTAMPTZ,
  ultima_enviada_em   TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, jid)
);

-- ── wa_messages: espelho (texto/legenda/transcrição; mídia só como rótulo) ─
CREATE TABLE IF NOT EXISTS public.wa_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  jid         TEXT NOT NULL,
  jid_alt     TEXT,
  wa_id       TEXT NOT NULL,
  from_me     BOOLEAN NOT NULL,
  remetente   TEXT,
  tipo        TEXT NOT NULL DEFAULT 'texto'
              CHECK (tipo IN ('texto', 'audio', 'imagem', 'documento', 'video', 'outro')),
  texto       TEXT,
  transcrito  BOOLEAN NOT NULL DEFAULT FALSE,
  ts          TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wa_id)
);
CREATE INDEX IF NOT EXISTS wa_messages_chat_idx ON public.wa_messages (tenant_id, jid, ts DESC);

-- ── wa_contacts: quem é quem (contexto aprendido; entrega 4 preenche mais) ─
CREATE TABLE IF NOT EXISTS public.wa_contacts (
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  jid           TEXT NOT NULL,
  nome_push     TEXT,
  nome          TEXT,
  papel         TEXT CHECK (papel IN ('cliente', 'integrador', 'eletricista', 'concessionaria', 'fornecedor', 'pessoal', 'outro')),
  company_id    UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  project_ids   UUID[] NOT NULL DEFAULT '{}',
  notas         TEXT,
  ignorar       BOOLEAN NOT NULL DEFAULT FALSE,
  telefone      TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, jid)
);

-- ── ze_messages: o diálogo no chat "Você" (memória de curto prazo) ─────────
CREATE TABLE IF NOT EXISTS public.ze_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  papel         TEXT NOT NULL CHECK (papel IN ('user', 'ze', 'sistema')),
  texto         TEXT NOT NULL,
  wa_id         TEXT,
  rotina        TEXT,
  run_id        UUID,
  processada_em TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ze_messages_tenant_idx ON public.ze_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ze_messages_wa_idx ON public.ze_messages (tenant_id, wa_id) WHERE wa_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.ze_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_chats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ze_messages  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ze_config', 'wa_chats', 'wa_messages', 'wa_contacts', 'ze_messages'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL
        USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
        WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())))
    $p$, t);
  END LOOP;
END $$;

-- Admin de tenant `is_library` (mesmo recorte do Bidu/Ludmilla, só admin).
CREATE OR REPLACE FUNCTION public.ze_admin_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid()) AND p.role = 'admin' AND t.is_library
  );
$$;

-- O dono do WhatsApp conectado (regra dura 5).
CREATE OR REPLACE FUNCTION public.ze_dono_ok(_tenant UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ze_config c
    WHERE c.tenant_id = _tenant AND c.owner_user_id = (select auth.uid())
  );
$$;

DROP POLICY IF EXISTS admin_le_config ON public.ze_config;
CREATE POLICY admin_le_config ON public.ze_config FOR SELECT
  USING ((select public.ze_admin_ok()));
DROP POLICY IF EXISTS admin_ajusta_config ON public.ze_config;
CREATE POLICY admin_ajusta_config ON public.ze_config FOR UPDATE
  USING      ((select public.ze_admin_ok()))
  WITH CHECK ((select public.ze_admin_ok()));
-- INSERT só pela RPC ze_ativar (SECURITY DEFINER).

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['wa_chats', 'wa_messages', 'wa_contacts', 'ze_messages'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS dono_le ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY dono_le ON public.%I FOR SELECT
        USING ((select public.ze_dono_ok(tenant_id)))
    $p$, t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS dono_edita_contatos ON public.wa_contacts;
CREATE POLICY dono_edita_contatos ON public.wa_contacts FOR UPDATE
  USING      ((select public.ze_dono_ok(tenant_id)))
  WITH CHECK ((select public.ze_dono_ok(tenant_id)));

-- ── ze_ativar: cria a configuração do tenant de quem chama (admin is_library) ─
CREATE OR REPLACE FUNCTION public.ze_ativar()
RETURNS public.ze_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := auth.uid(); _tenant UUID; _row public.ze_config;
BEGIN
  IF NOT public.ze_admin_ok() THEN
    RAISE EXCEPTION 'só o admin do GD Manager pode ativar o Zé' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  INSERT INTO public.ze_config (tenant_id, owner_user_id, instance_name)
  VALUES (_tenant, _uid, 'ze-' || left(replace(_tenant::text, '-', ''), 12))
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO _row FROM public.ze_config WHERE tenant_id = _tenant;
  RETURN _row;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_ativar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ze_ativar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ze_admin_ok() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ze_dono_ok(UUID) TO authenticated;

SELECT 'ze_fundacao aplicada' AS resultado;
```

- [ ] **Step 2: Aplicar no banco**

Run: `npx -y supabase db query --linked -f supabase/migrations/20260918100000_ze_fundacao.sql`
Expected: última linha com `"resultado":"ze_fundacao aplicada"` (sem `ERROR`).

- [ ] **Step 3: Escrever o teste de RLS (transação com rollback + impersonação)**

Arquivo temporário no scratchpad (`ze_rls_teste.sql`):

```sql
BEGIN;
-- Sujeitos: admin do GD Manager (dono), staff do mesmo tenant, admin de OUTRO tenant.
CREATE TEMP TABLE _s AS
  SELECT
    (SELECT p.id FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id WHERE t.is_library AND p.role = 'admin' ORDER BY p.created_at LIMIT 1) AS dono,
    (SELECT p.id FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id WHERE t.is_library AND p.role = 'staff' LIMIT 1) AS staff_mesmo,
    (SELECT p.id FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id WHERE NOT t.is_library AND p.role = 'admin' LIMIT 1) AS admin_outro,
    (SELECT id FROM public.tenants WHERE is_library LIMIT 1) AS tenant_gd;

INSERT INTO public.ze_config (tenant_id, owner_user_id, instance_name)
  SELECT tenant_gd, dono, 'ze-teste-rls' FROM _s;
INSERT INTO public.wa_messages (tenant_id, jid, wa_id, from_me, tipo, texto, ts)
  SELECT tenant_gd, '5511999990000@s.whatsapp.net', 'TESTE-RLS-1', false, 'texto', 'oi', now() FROM _s;

CREATE TEMP TABLE _r (quem TEXT, config INT, msgs INT);
GRANT ALL ON _r TO authenticated;
GRANT ALL ON _s TO authenticated;

-- dono
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT dono FROM _s), 'role', 'authenticated')::text, true);
SET ROLE authenticated;
INSERT INTO _r SELECT 'dono', (SELECT count(*) FROM public.ze_config WHERE instance_name = 'ze-teste-rls'), (SELECT count(*) FROM public.wa_messages WHERE wa_id = 'TESTE-RLS-1');
RESET ROLE;
-- staff do mesmo tenant: vê config? não (só admin). vê mensagens? não (só dono).
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT staff_mesmo FROM _s), 'role', 'authenticated')::text, true);
SET ROLE authenticated;
INSERT INTO _r SELECT 'staff_mesmo', (SELECT count(*) FROM public.ze_config WHERE instance_name = 'ze-teste-rls'), (SELECT count(*) FROM public.wa_messages WHERE wa_id = 'TESTE-RLS-1');
RESET ROLE;
-- admin de outro tenant: nada.
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT admin_outro FROM _s), 'role', 'authenticated')::text, true);
SET ROLE authenticated;
INSERT INTO _r SELECT 'admin_outro', (SELECT count(*) FROM public.ze_config WHERE instance_name = 'ze-teste-rls'), (SELECT count(*) FROM public.wa_messages WHERE wa_id = 'TESTE-RLS-1');
RESET ROLE;

SELECT string_agg(quem || ': config=' || config || ' msgs=' || msgs, ' | ' ORDER BY quem) AS resultado FROM _r;
ROLLBACK;
```

- [ ] **Step 4: Rodar o teste de RLS**

Run: `npx -y supabase db query --linked -f "<scratchpad>/ze_rls_teste.sql"`
Expected: `admin_outro: config=0 msgs=0 | dono: config=1 msgs=1 | staff_mesmo: config=0 msgs=0`.
Se `staff_mesmo` for nulo (não há staff no GD Manager), a linha vem `config=0 msgs=0` do mesmo jeito — aceitável.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918100000_ze_fundacao.sql
git commit -m "feat(ze): fundação — ze_config, espelho do WhatsApp (wa_*), ze_messages, RLS do dono"
git push origin main
```

---

### Task 2: Módulo puro `telefone.ts` (JID ↔ telefone)

**Files:**
- Create: `supabase/functions/_shared/telefone.ts`
- Test: `supabase/functions/_shared/telefone.test.ts`

**Interfaces:**
- Produces:
  - `telefoneDoJid(jid: string | null | undefined): string | null` — `'5519999990000@s.whatsapp.net' → '5519999990000'`; `@g.us`, `@lid`, `@broadcast` → `null`.
  - `ehGrupo(jid: string): boolean` — termina com `@g.us`.
  - `mesmoNumero(a: string | null, b: string | null): boolean` — compara os últimos 8 dígitos e o DDD (ignora o 9 extra de celular).
  - `jidDoTelefone(digitos: string): string` — `'5519999990000' → '5519999990000@s.whatsapp.net'`.

- [ ] **Step 1: Escrever o teste**

```ts
// supabase/functions/_shared/telefone.test.ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/telefone.test.ts`
Expected: FAIL — `Failed to resolve import "./telefone.ts"`.

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/telefone.ts
/**
 * Telefone ↔ JID do WhatsApp. Módulo PURO (sem Deno, sem fetch) para ser
 * testado pelo vitest e usado pelas edge functions do Zé.
 *
 * JID individual: <ddi><ddd><numero>@s.whatsapp.net
 * Grupo: <id>@g.us · LID (identificador novo do WhatsApp): <id>@lid — não é telefone.
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
  const na = nucleo(a), nb = nucleo(b);
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/telefone.test.ts`
Expected: `Tests  8 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/telefone.ts supabase/functions/_shared/telefone.test.ts
git commit -m "feat(ze): módulo puro telefone/JID com testes"
git push origin main
```

---

### Task 3: Módulo `evolution.ts` — parse dos payloads + cliente REST

**Files:**
- Create: `supabase/functions/_shared/evolution.ts`
- Create: `supabase/functions/_shared/fixtures/evolution/messages-upsert-texto.json`, `messages-upsert-extended.json`, `messages-upsert-imagem-legenda.json`, `messages-upsert-audio.json`, `messages-upsert-grupo.json`, `messages-upsert-self-chat.json`, `connection-update-open.json`, `connection-update-close.json`, `qrcode-updated.json`
- Test: `supabase/functions/_shared/evolution.test.ts`

**Interfaces:**
- Consumes: `telefoneDoJid`, `ehGrupo`, `mesmoNumero` (Task 2).
- Produces:
  ```ts
  export type TipoMensagem = 'texto' | 'audio' | 'imagem' | 'documento' | 'video' | 'outro';
  export interface MensagemNormalizada {
    jid: string; jid_alt: string | null; wa_id: string; from_me: boolean;
    remetente: string | null; tipo: TipoMensagem; texto: string | null;
    ts: string /* ISO */; is_group: boolean;
  }
  export interface EventoWebhook { event: string; instance: string; data: unknown }
  export function parseUpsert(data: unknown): MensagemNormalizada | null
  export function parseConnectionUpdate(data: unknown): { situacao: 'conectado' | 'desconectado' | 'aguardando_qr'; wuid: string | null }
  export function parseQrcode(data: unknown): string | null   // base64 (data URL) ou null
  export function ehSelfChat(m: MensagemNormalizada, phoneJid: string | null): boolean
  export class EvolutionClient {
    constructor(baseUrl: string, apiKey: string)
    criarInstancia(nome: string, webhook: { url: string; token: string }): Promise<{ qr_base64: string | null }>
    setWebhook(nome: string, webhook: { url: string; token: string }): Promise<void>
    conectar(nome: string): Promise<{ qr_base64: string | null; state: string | null }>
    estado(nome: string): Promise<'open' | 'connecting' | 'close' | 'inexistente'>
    fetchInstancia(nome: string): Promise<{ ownerJid: string | null; connectionStatus: string | null } | null>
    enviarTexto(nome: string, numero: string, texto: string): Promise<{ wa_id: string }>
    logout(nome: string): Promise<void>
  }
  ```

- [ ] **Step 1: Criar as fixtures** (formato do webhook da Evolution v2: `{event, instance, data, …}`)

`messages-upsert-texto.json`:
```json
{
  "event": "messages.upsert",
  "instance": "ze-teste",
  "data": {
    "key": { "remoteJid": "5511988887777@s.whatsapp.net", "fromMe": false, "id": "3EB0A1B2C3D4E5F60001" },
    "pushName": "João Titular",
    "message": { "conversation": "Bom dia, mandei a conta de luz" },
    "messageType": "conversation",
    "messageTimestamp": 1758100000,
    "instanceId": "abc",
    "source": "android"
  },
  "destination": "https://x/functions/v1/ze-webhook",
  "date_time": "2026-09-17T10:00:00.000Z",
  "sender": "5519999990000@s.whatsapp.net",
  "server_url": "https://zap.homologamanager.com.br",
  "apikey": "REDACTED"
}
```

`messages-upsert-extended.json` — igual, com `"message": { "extendedTextMessage": { "text": "Segue o link https://exemplo" } }`, `"messageType": "extendedTextMessage"`, `"id": "3EB0A1B2C3D4E5F60002"`.

`messages-upsert-imagem-legenda.json` — `"message": { "imageMessage": { "caption": "foto do padrão", "mimetype": "image/jpeg" } }`, `"messageType": "imageMessage"`, id `…0003`.

`messages-upsert-audio.json` — `"message": { "audioMessage": { "mimetype": "audio/ogg; codecs=opus", "seconds": 12, "ptt": true } }`, `"messageType": "audioMessage"`, id `…0004`.

`messages-upsert-grupo.json` — `"key": { "remoteJid": "120363012345678@g.us", "fromMe": false, "id": "…0005", "participant": "5511988887777@s.whatsapp.net" }`, `"message": { "conversation": "alguém tem o contato da CPFL?" }`.

`messages-upsert-self-chat.json` — `"key": { "remoteJid": "5519999990000@s.whatsapp.net", "fromMe": true, "id": "…0006" }`, `"pushName": "Luiz"`, `"message": { "conversation": "Zé, o que tenho pra hoje?" }`.

`connection-update-open.json`:
```json
{ "event": "connection.update", "instance": "ze-teste",
  "data": { "instance": "ze-teste", "wuid": "5519999990000@s.whatsapp.net", "profileName": "Luiz", "profilePictureUrl": null, "state": "open", "statusReason": 200 } }
```
`connection-update-close.json`: `"data": { "instance": "ze-teste", "state": "close", "statusReason": 401, "statusCode": 401 }`.

`qrcode-updated.json`: `"data": { "qrcode": { "instance": "ze-teste", "pairingCode": null, "code": "2@abc…", "base64": "data:image/png;base64,iVBORw0KGgo=" } }`.

- [ ] **Step 2: Escrever os testes**

```ts
// supabase/functions/_shared/evolution.test.ts
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
      jid: '5511988887777@s.whatsapp.net', wa_id: '3EB0A1B2C3D4E5F60001', from_me: false,
      remetente: 'João Titular', tipo: 'texto', texto: 'Bom dia, mandei a conta de luz', is_group: false,
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
    expect(parseConnectionUpdate(fixture('connection-update-open.json').data))
      .toEqual({ situacao: 'conectado', wuid: '5519999990000@s.whatsapp.net' });
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
      new Response(JSON.stringify({ key: { id: 'ABC123', remoteJid: '5519999990000@s.whatsapp.net', fromMe: true } }), { status: 201 }),
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
      enabled: true, url: 'https://x/functions/v1/ze-webhook', byEvents: false, base64: false,
      headers: { 'x-ze-token': 'T' }, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    });
  });

  it('erro HTTP vira exceção com status e trecho do corpo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"message":"Unauthorized"}', { status: 401 }));
    const c = new EvolutionClient('https://zap.exemplo', 'CHAVE');
    await expect(c.logout('ze-teste')).rejects.toThrow(/Evolution 401/);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/evolution.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar**

```ts
// supabase/functions/_shared/evolution.ts
/**
 * Evolution API v2 — o que o Zé precisa dela. Módulo puro (fetch padrão,
 * sem Deno.*), testado pelo vitest.
 *
 * Webhook (POST na nossa edge): { event: 'messages.upsert' | 'connection.update'
 * | 'qrcode.updated', instance, data, … }. REST: header `apikey`.
 */
import { ehGrupo, mesmoNumero, telefoneDoJid } from './telefone.ts';

export type TipoMensagem = 'texto' | 'audio' | 'imagem' | 'documento' | 'video' | 'outro';

export interface MensagemNormalizada {
  jid: string;
  jid_alt: string | null;
  wa_id: string;
  from_me: boolean;
  remetente: string | null;
  tipo: TipoMensagem;
  texto: string | null;
  ts: string;
  is_group: boolean;
}

export interface EventoWebhook {
  event: string;
  instance: string;
  data: unknown;
}

export const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function timestampIso(v: unknown): string {
  let segundos: number | null = null;
  if (typeof v === 'number') segundos = v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) segundos = Number(v);
  else if (obj(v) && typeof (v as Obj).low === 'number') segundos = (v as Obj).low as number;
  return new Date((segundos ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

/** Normaliza o `data` de um messages.upsert. Devolve null se não for mensagem. */
export function parseUpsert(data: unknown): MensagemNormalizada | null {
  const d = obj(data);
  const key = d ? obj(d.key) : null;
  const jid = key ? str(key.remoteJid) : null;
  const waId = key ? str(key.id) : null;
  if (!key || !jid || !waId) return null;

  const msg = obj(d!.message) ?? {};
  const isGroup = ehGrupo(jid);
  let tipo: TipoMensagem = 'outro';
  let texto: string | null = null;

  if (str(msg.conversation)) { tipo = 'texto'; texto = msg.conversation as string; }
  else if (obj(msg.extendedTextMessage)) { tipo = 'texto'; texto = str((msg.extendedTextMessage as Obj).text); }
  else if (obj(msg.imageMessage)) { tipo = 'imagem'; texto = str((msg.imageMessage as Obj).caption) ?? '[imagem]'; }
  else if (obj(msg.videoMessage)) { tipo = 'video'; texto = str((msg.videoMessage as Obj).caption) ?? '[vídeo]'; }
  else if (obj(msg.documentMessage)) {
    tipo = 'documento';
    const nome = str((msg.documentMessage as Obj).fileName) ?? str((msg.documentMessage as Obj).title);
    texto = nome ? `[documento ${nome}]` : '[documento]';
  }
  else if (obj(msg.audioMessage)) {
    tipo = 'audio';
    const s = (msg.audioMessage as Obj).seconds;
    texto = typeof s === 'number' ? `[áudio ${s}s]` : '[áudio]';
  }
  else if (obj(msg.stickerMessage)) { tipo = 'outro'; texto = '[figurinha]'; }
  else { tipo = 'outro'; texto = null; }

  return {
    jid,
    jid_alt: str(key.remoteJidAlt),
    wa_id: waId,
    from_me: key.fromMe === true,
    remetente: str(d!.pushName),
    tipo,
    texto,
    ts: timestampIso(d!.messageTimestamp),
    is_group: isGroup,
  };
}

/** A mensagem é do gestor para ele mesmo (chat "Você")? */
export function ehSelfChat(m: MensagemNormalizada, phoneJid: string | null): boolean {
  if (!phoneJid || !m.from_me || m.is_group) return false;
  if (m.jid === phoneJid || m.jid_alt === phoneJid) return true;
  return mesmoNumero(telefoneDoJid(m.jid), telefoneDoJid(phoneJid));
}

export function parseConnectionUpdate(data: unknown): { situacao: 'conectado' | 'desconectado' | 'aguardando_qr'; wuid: string | null } {
  const d = obj(data) ?? {};
  const state = str(d.state);
  const situacao = state === 'open' ? 'conectado' : state === 'connecting' ? 'aguardando_qr' : 'desconectado';
  return { situacao, wuid: str(d.wuid) };
}

export function parseQrcode(data: unknown): string | null {
  const d = obj(data);
  const q = d ? obj(d.qrcode) : null;
  return q ? str(q.base64) : null;
}

export class EvolutionClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: T | null }> {
    const resp = await fetch(`${this.baseUrl.replace(/\/$/, '')}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resp.text();
    let json: T | null = null;
    try { json = texto ? JSON.parse(texto) as T : null; } catch { json = null; }
    if (!resp.ok && resp.status !== 404) throw new Error(`Evolution ${resp.status} em ${metodo} ${caminho}: ${texto.slice(0, 200)}`);
    return { status: resp.status, json };
  }

  private webhookCorpo(w: { url: string; token: string }) {
    return { webhook: { enabled: true, url: w.url, byEvents: false, base64: false, headers: { 'x-ze-token': w.token }, events: [...EVENTOS_WEBHOOK] } };
  }

  async criarInstancia(nome: string, webhook: { url: string; token: string }): Promise<{ qr_base64: string | null }> {
    const { json } = await this.chamar<Obj>('POST', '/instance/create', {
      instanceName: nome, qrcode: true, integration: 'WHATSAPP-BAILEYS', ...this.webhookCorpo(webhook),
    });
    const qr = json ? obj(json.qrcode) : null;
    return { qr_base64: qr ? str(qr.base64) : null };
  }

  async setWebhook(nome: string, webhook: { url: string; token: string }): Promise<void> {
    await this.chamar('POST', `/webhook/set/${nome}`, this.webhookCorpo(webhook));
  }

  async conectar(nome: string): Promise<{ qr_base64: string | null; state: string | null }> {
    const { json } = await this.chamar<Obj>('GET', `/instance/connect/${nome}`);
    const inst = json ? obj(json.instance) : null;
    return { qr_base64: json ? str(json.base64) : null, state: inst ? str(inst.state) : null };
  }

  async estado(nome: string): Promise<'open' | 'connecting' | 'close' | 'inexistente'> {
    const { status, json } = await this.chamar<Obj>('GET', `/instance/connectionState/${nome}`);
    if (status === 404) return 'inexistente';
    const inst = json ? obj(json.instance) : null;
    const s = inst ? str(inst.state) : null;
    return s === 'open' || s === 'connecting' ? s : 'close';
  }

  async fetchInstancia(nome: string): Promise<{ ownerJid: string | null; connectionStatus: string | null } | null> {
    const { json } = await this.chamar<unknown[]>('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(nome)}`);
    const primeiro = Array.isArray(json) ? obj(json[0]) : null;
    if (!primeiro) return null;
    // v2 devolve a instância "achatada"; versões antigas embrulham em { instance: {...} }
    const inst = obj(primeiro.instance) ?? primeiro;
    return { ownerJid: str(inst.ownerJid) ?? str(inst.owner), connectionStatus: str(inst.connectionStatus) ?? str(inst.status) };
  }

  /** ÚNICO ponto de envio. Quem chama é responsável por passar SÓ o número do dono (regra dura 1). */
  async enviarTexto(nome: string, numero: string, texto: string): Promise<{ wa_id: string }> {
    const { json } = await this.chamar<Obj>('POST', `/message/sendText/${nome}`, { number: numero, text: texto });
    const key = json ? obj(json.key) : null;
    const id = key ? str(key.id) : null;
    if (!id) throw new Error('Evolution não devolveu key.id no sendText');
    return { wa_id: id };
  }

  async logout(nome: string): Promise<void> {
    await this.chamar('DELETE', `/instance/logout/${nome}`);
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/evolution.test.ts`
Expected: `Tests  18 passed`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/evolution.ts supabase/functions/_shared/evolution.test.ts supabase/functions/_shared/fixtures/evolution/
git commit -m "feat(ze): parse dos eventos da Evolution + cliente REST, com fixtures e testes"
git push origin main
```

---

### Task 4: Edge function `ze-webhook`

**Files:**
- Create: `supabase/functions/ze-webhook/index.ts`
- Modify: `supabase/config.toml` (adicionar `[functions.ze-webhook] verify_jwt = false`)
- Test: curl com fixtures contra a função deployada (Task 7) + SELECT no banco

**Interfaces:**
- Consumes: `parseUpsert`, `parseConnectionUpdate`, `parseQrcode`, `ehSelfChat`, `EventoWebhook` (Task 3); `telefoneDoJid` (Task 2); tabelas da Task 1.
- Produces: endpoint `POST /functions/v1/ze-webhook` (header `x-ze-token`). Grava `wa_messages`, `wa_chats`, `wa_contacts`, `ze_config.situacao/qr_code/phone_jid`, `ze_messages(papel='user')`. Resposta `{ ok: true, acao: 'espelhada' | 'fala_do_gestor' | 'eco_do_ze' | 'ignorado' | 'conexao' | 'qr' }`.

- [ ] **Step 1: Escrever a função**

```ts
// supabase/functions/ze-webhook/index.ts
/**
 * ZÉ — webhook da Evolution API.
 *
 * Recebe cada evento do WhatsApp do gestor e espelha no banco. Se a mensagem
 * é do gestor para ele mesmo (chat "Você") e NÃO foi o Zé quem mandou, é uma
 * fala do gestor: vira ze_messages(papel='user'); a partir da Entrega 2 o
 * cérebro (ze-brain) é acionado aqui.
 *
 * Autenticação: header `x-ze-token` igual ao secret ZE_WEBHOOK_TOKEN
 * (configurado no webhook da instância pela ze-admin). Deployada com
 * --no-verify-jwt — a Evolution não tem JWT do Supabase.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ZE_WEBHOOK_TOKEN
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseUpsert, parseConnectionUpdate, parseQrcode, ehSelfChat, type EventoWebhook } from '../_shared/evolution.ts'
import { telefoneDoJid } from '../_shared/telefone.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface Config { tenant_id: string; instance_name: string; phone_jid: string | null; situacao: string }

async function configDaInstancia(instance: string): Promise<Config | null> {
  const { data } = await admin.from('ze_config').select('tenant_id, instance_name, phone_jid, situacao').eq('instance_name', instance).maybeSingle()
  return (data as Config | null) ?? null
}

/** O gestor falou no chat "Você"? Ou é o eco de algo que o próprio Zé mandou? */
async function ecoDoZe(tenantId: string, waId: string): Promise<boolean> {
  const olhar = async () => {
    const { data } = await admin.from('ze_messages').select('id').eq('tenant_id', tenantId).eq('wa_id', waId).limit(1)
    return (data?.length ?? 0) > 0
  }
  if (await olhar()) return true
  // O sendText devolve o id e só DEPOIS a edge grava em ze_messages; o eco do
  // webhook pode chegar antes. Dois segundos cobrem a corrida.
  await new Promise(r => setTimeout(r, 2000))
  return olhar()
}

async function espelhar(cfg: Config, data: unknown): Promise<string> {
  const m = parseUpsert(data)
  if (!m) return 'ignorado'
  const tenantId = cfg.tenant_id

  const { error: errMsg } = await admin.from('wa_messages').upsert({
    tenant_id: tenantId, jid: m.jid, jid_alt: m.jid_alt, wa_id: m.wa_id, from_me: m.from_me,
    remetente: m.remetente, tipo: m.tipo, texto: m.texto, ts: m.ts,
  }, { onConflict: 'tenant_id,wa_id', ignoreDuplicates: true })
  if (errMsg) console.error('wa_messages', errMsg)

  await admin.from('wa_chats').upsert({
    tenant_id: tenantId, jid: m.jid, is_group: m.is_group,
    nome: m.is_group ? undefined : (m.from_me ? undefined : m.remetente),
    ultima_msg_em: m.ts, ultima_de_mim: m.from_me,
    ...(m.from_me ? { ultima_enviada_em: m.ts } : { ultima_recebida_em: m.ts }),
  }, { onConflict: 'tenant_id,jid' })

  if (!m.is_group && !m.from_me) {
    await admin.from('wa_contacts').upsert({
      tenant_id: tenantId, jid: m.jid, nome_push: m.remetente, telefone: telefoneDoJid(m.jid),
    }, { onConflict: 'tenant_id,jid', ignoreDuplicates: true })
  }

  if (!ehSelfChat(m, cfg.phone_jid)) return 'espelhada'
  if (await ecoDoZe(tenantId, m.wa_id)) return 'eco_do_ze'

  const texto = m.tipo === 'audio' ? `🎤 ${m.texto ?? '[áudio]'}` : (m.texto ?? `[${m.tipo}]`)
  await admin.from('ze_messages').insert({ tenant_id: tenantId, papel: 'user', texto, wa_id: m.wa_id })
  // Entrega 2: acionar ze-brain aqui ({ modo: 'mensagem', tenant_id }).
  return 'fala_do_gestor'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'método' }, 405)
  const esperado = Deno.env.get('ZE_WEBHOOK_TOKEN')
  if (!esperado || req.headers.get('x-ze-token') !== esperado) return json({ error: 'não autorizado' }, 401)

  let evento: EventoWebhook
  try { evento = await req.json() } catch { return json({ error: 'json inválido' }, 400) }
  if (!evento?.event || !evento?.instance) return json({ error: 'evento sem instance/event' }, 400)

  const cfg = await configDaInstancia(evento.instance)
  if (!cfg) return json({ ok: true, acao: 'ignorado', motivo: 'instância desconhecida' })

  try {
    switch (evento.event) {
      case 'qrcode.updated': {
        const qr = parseQrcode(evento.data)
        await admin.from('ze_config').update({ qr_code: qr, situacao: 'aguardando_qr', updated_at: new Date().toISOString() }).eq('tenant_id', cfg.tenant_id)
        return json({ ok: true, acao: 'qr' })
      }
      case 'connection.update': {
        const { situacao, wuid } = parseConnectionUpdate(evento.data)
        const patch: Record<string, unknown> = { situacao, updated_at: new Date().toISOString() }
        if (situacao === 'conectado') { patch.qr_code = null; if (wuid) patch.phone_jid = wuid }
        await admin.from('ze_config').update(patch).eq('tenant_id', cfg.tenant_id)
        return json({ ok: true, acao: 'conexao', situacao })
      }
      case 'messages.upsert': {
        // Responde já; a gravação (e a espera de 2 s do eco) segue em segundo plano.
        const trabalho = espelhar(cfg, evento.data).catch(e => console.error('espelhar', e))
        if (typeof EdgeRuntime !== 'undefined') { EdgeRuntime.waitUntil(trabalho); return json({ ok: true, acao: 'em_segundo_plano' }) }
        return json({ ok: true, acao: await trabalho })
      }
      default:
        return json({ ok: true, acao: 'ignorado', evento: evento.event })
    }
  } catch (e) {
    console.error('[ze-webhook]', e)
    return json({ error: 'erro interno' }, 500)
  }
})
```

- [ ] **Step 2: Registrar em `supabase/config.toml`**

Acrescentar ao fim:
```toml
[functions.ze-webhook]
verify_jwt = false

[functions.ze-admin]
verify_jwt = false
```

- [ ] **Step 3: Verificar tipos com o Deno do CLI (sem Deno instalado, o check acontece no deploy)**

Run: `npx vitest run supabase/functions/_shared` (garante que os módulos importados seguem íntegros).
Expected: todos passando.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ze-webhook/index.ts supabase/config.toml
git commit -m "feat(ze): webhook da Evolution — espelha mensagens e detecta a fala do gestor no chat Você"
git push origin main
```

---

### Task 5: Edge function `ze-admin`

**Files:**
- Create: `supabase/functions/ze-admin/index.ts`
- Test: curl autenticado (JWT de admin) contra a função deployada (Task 7); tela (Task 6).

**Interfaces:**
- Consumes: `EvolutionClient` (Task 3), `telefoneDoJid` (Task 2), RPCs `ze_ativar`, `ze_admin_ok` (Task 1).
- Produces: `POST /functions/v1/ze-admin` com `Authorization: Bearer <jwt>` e corpo `{ acao: 'estado' | 'conectar' | 'teste_envio' | 'desconectar' }` → `{ ok: true, config: ZeConfigResumo }` ou `{ ok: false, error }`.
  ```ts
  interface ZeConfigResumo { tenant_id: string; instance_name: string; phone_jid: string | null; situacao: string; qr_code: string | null }
  ```

- [ ] **Step 1: Escrever a função**

```ts
// supabase/functions/ze-admin/index.ts
/**
 * ZÉ — ações administrativas da tela /ze (só admin do tenant is_library).
 *
 *  estado      → consulta a Evolution e sincroniza situacao/phone_jid.
 *  conectar    → garante ze_config (RPC ze_ativar), cria a instância se não
 *                existir (com webhook), ou reconfigura o webhook e pede QR.
 *  teste_envio → manda "Zé aqui…" para o PRÓPRIO número (único destino
 *                permitido — regra dura 1) e registra em ze_messages.
 *  desconectar → logout da instância.
 *
 * Deployada com --no-verify-jwt: a checagem do Authorization é feita aqui.
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *          EVOLUTION_URL, EVOLUTION_API_KEY, ZE_WEBHOOK_TOKEN
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { EvolutionClient } from '../_shared/evolution.ts'
import { telefoneDoJid } from '../_shared/telefone.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type Acao = 'estado' | 'conectar' | 'teste_envio' | 'desconectar'
interface Config { tenant_id: string; owner_user_id: string; instance_name: string; phone_jid: string | null; situacao: string; qr_code: string | null }

const resumo = (c: Config) => ({ tenant_id: c.tenant_id, instance_name: c.instance_name, phone_jid: c.phone_jid, situacao: c.situacao, qr_code: c.qr_code })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ ok: false, error: 'sem autorização' }, 401)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'sessão inválida' }, 401)
    const { data: ehAdmin } = await userClient.rpc('ze_admin_ok')
    if (ehAdmin !== true) return json({ ok: false, error: 'só o admin do GD Manager' }, 403)

    const { acao } = await req.json() as { acao: Acao }
    const evoUrl = Deno.env.get('EVOLUTION_URL'); const evoKey = Deno.env.get('EVOLUTION_API_KEY'); const token = Deno.env.get('ZE_WEBHOOK_TOKEN')
    if (!evoUrl || !evoKey || !token) return json({ ok: false, error: 'EVOLUTION_URL/EVOLUTION_API_KEY/ZE_WEBHOOK_TOKEN não configurados' }, 500)
    const evo = new EvolutionClient(evoUrl, evoKey)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
    const webhook = { url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/ze-webhook`, token }

    // A config nasce (ou é lida) pela RPC — o tenant vem da sessão, não do corpo.
    const { data: cfgRaw, error: errCfg } = await userClient.rpc('ze_ativar')
    if (errCfg || !cfgRaw) return json({ ok: false, error: errCfg?.message ?? 'sem configuração' }, 500)
    const cfg = cfgRaw as Config
    const salvar = async (patch: Partial<Config>) => {
      await admin.from('ze_config').update({ ...patch, updated_at: new Date().toISOString() }).eq('tenant_id', cfg.tenant_id)
      Object.assign(cfg, patch)
    }

    switch (acao) {
      case 'estado': {
        const estado = await evo.estado(cfg.instance_name)
        const inst = estado === 'inexistente' ? null : await evo.fetchInstancia(cfg.instance_name)
        const situacao = estado === 'open' ? 'conectado' : estado === 'connecting' ? 'aguardando_qr' : 'desconectado'
        await salvar({ situacao, phone_jid: inst?.ownerJid ?? cfg.phone_jid, qr_code: situacao === 'conectado' ? null : cfg.qr_code })
        return json({ ok: true, config: resumo(cfg) })
      }
      case 'conectar': {
        const estado = await evo.estado(cfg.instance_name)
        if (estado === 'inexistente') {
          const { qr_base64 } = await evo.criarInstancia(cfg.instance_name, webhook)
          await salvar({ situacao: 'aguardando_qr', qr_code: qr_base64 })
        } else {
          await evo.setWebhook(cfg.instance_name, webhook)
          const { qr_base64, state } = await evo.conectar(cfg.instance_name)
          if (state === 'open') await salvar({ situacao: 'conectado', qr_code: null })
          else await salvar({ situacao: 'aguardando_qr', qr_code: qr_base64 ?? cfg.qr_code })
        }
        return json({ ok: true, config: resumo(cfg) })
      }
      case 'teste_envio': {
        if (cfg.situacao !== 'conectado' || !cfg.phone_jid) return json({ ok: false, error: 'conecte o WhatsApp primeiro' }, 409)
        const numero = telefoneDoJid(cfg.phone_jid)
        if (!numero) return json({ ok: false, error: `phone_jid sem telefone (${cfg.phone_jid})` }, 409)
        const texto = 'Zé aqui 👋 Teste de envio para mim mesmo. Se você está lendo isto no chat "Você", a fundação está de pé.'
        // REGRA DURA 1: o destino é sempre o número do dono, lido da config.
        const { wa_id } = await evo.enviarTexto(cfg.instance_name, numero, texto)
        await admin.from('ze_messages').insert({ tenant_id: cfg.tenant_id, papel: 'ze', texto, wa_id })
        return json({ ok: true, config: resumo(cfg), wa_id })
      }
      case 'desconectar': {
        await evo.logout(cfg.instance_name)
        await salvar({ situacao: 'desconectado', qr_code: null })
        return json({ ok: true, config: resumo(cfg) })
      }
      default:
        return json({ ok: false, error: `ação desconhecida: ${String(acao)}` }, 400)
    }
  } catch (e) {
    console.error('[ze-admin]', e)
    return json({ ok: false, error: e instanceof Error ? e.message : 'falha inesperada' }, 500)
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/ze-admin/index.ts
git commit -m "feat(ze): ze-admin — conectar por QR, estado, teste de envio ao próprio número, desconectar"
git push origin main
```

---

### Task 6: Tela `/ze` (Conexão) + hook + rota + menu

**Files:**
- Create: `src/hooks/useZe.ts`
- Create: `src/pages/Ze.tsx`
- Modify: `src/App.tsx` (import + rota ao lado de `/ludmilla`)
- Modify: `src/components/layout/Sidebar.tsx` (item `Zé` com `requiresZe`)
- Test: `npx tsc --noEmit -p tsconfig.app.json` (65 erros), `npm run build`, tela no navegador.

**Interfaces:**
- Consumes: tabela `ze_config` (Task 1), função `ze-admin` (Task 5).
- Produces: `useZeDisponivel(): boolean`, `useZeConfig()`, `useZeAcao()`, `useAtualizarZeConfig()`, página `Ze`.

- [ ] **Step 1: Hook `useZe.ts`**

```ts
// src/hooks/useZe.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import { toast } from 'sonner';

/**
 * ZÉ (José) — o assistente pessoal do gestor no WhatsApp.
 *
 * Aqui mora só o que a TELA precisa: a configuração da conexão e as ações
 * administrativas (conectar por QR, estado, teste de envio, desconectar),
 * que passam pela edge `ze-admin`. O conteúdo do WhatsApp (wa_*) só o dono
 * lê, e nesta entrega a tela nem mostra.
 *
 * Restrito ao ADMIN do tenant GD Manager (`is_library`).
 */

export type SituacaoZe = 'desconectado' | 'aguardando_qr' | 'conectado';

export interface ZeConfig {
  tenant_id: string;
  owner_user_id: string;
  instance_name: string;
  phone_jid: string | null;
  situacao: SituacaoZe;
  qr_code: string | null;
  enabled: boolean;
  horas_sem_resposta: number;
  ignorar_grupos: boolean;
  dias_parado: number;
  transcrever_audios: 'todos' | 'so_meus' | 'nenhum';
  silencio_quando_vazio: boolean;
  updated_at: string;
}

export type AcaoZe = 'estado' | 'conectar' | 'teste_envio' | 'desconectar';

export function useZeDisponivel(): boolean {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  if (!user) return false;
  return user.role === 'admin' && !!tenant?.is_library;
}

export function useZeConfig() {
  const disponivel = useZeDisponivel();
  return useQuery({
    queryKey: ['ze-config'],
    enabled: disponivel,
    queryFn: async (): Promise<ZeConfig | null> => {
      const { data, error } = await supabase.from('ze_config' as never).select('*').maybeSingle();
      if (error) throw error;
      return (data as ZeConfig | null) ?? null;
    },
    // Enquanto espera o QR ser lido, a tela acompanha de perto.
    refetchInterval: (q) => (q.state.data?.situacao === 'aguardando_qr' ? 4000 : 30000),
  });
}

export function useZeAcao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (acao: AcaoZe) => {
      const { data, error } = await supabase.functions.invoke('ze-admin', { body: { acao } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'o Zé não respondeu');
      return data as { ok: true; config: Partial<ZeConfig>; wa_id?: string };
    },
    onSuccess: (_d, acao) => {
      qc.invalidateQueries({ queryKey: ['ze-config'] });
      if (acao === 'teste_envio') toast.success('Mensagem enviada — olhe o chat "Você" no seu WhatsApp');
      if (acao === 'desconectar') toast.success('Zé desconectado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAtualizarZeConfig() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<ZeConfig, 'horas_sem_resposta' | 'ignorar_grupos' | 'dias_parado' | 'transcrever_audios' | 'silencio_quando_vazio' | 'enabled'>>) => {
      if (!user?.tenantId) throw new Error('sem tenant na sessão');
      // A RLS já limita ao tenant; o filtro explícito é o hábito da casa.
      const { error } = await supabase.from('ze_config' as never).update(patch as never).eq('tenant_id', user.tenantId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ze-config'] }),
    onError: (e: Error) => toast.error(e.message),
  });
}
```

- [ ] **Step 2: Página `Ze.tsx`**

```tsx
// src/pages/Ze.tsx
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle, QrCode, RefreshCw, Send, Unplug, Loader2 } from 'lucide-react';
import { useAtualizarZeConfig, useZeAcao, useZeConfig, useZeDisponivel, type ZeConfig } from '@/hooks/useZe';
import { cn } from '@/lib/utils';

/**
 * ZÉ — tela de administração. Entrega 1: só a conexão do WhatsApp e as
 * preferências básicas. Rotinas, conversa, aprendizados e execuções entram
 * nas entregas seguintes (spec §12).
 */

const SITUACAO: Record<ZeConfig['situacao'], { rotulo: string; cor: string }> = {
  desconectado: { rotulo: 'Desconectado', cor: 'bg-slate-100 text-slate-700' },
  aguardando_qr: { rotulo: 'Aguardando leitura do QR', cor: 'bg-amber-100 text-amber-800' },
  conectado: { rotulo: 'Conectado', cor: 'bg-emerald-100 text-emerald-800' },
};

const numeroBonito = (jid: string | null) => {
  const d = jid?.split('@')[0]?.replace(/\D/g, '') ?? '';
  return d ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : '—';
};

export default function Ze() {
  const disponivel = useZeDisponivel();
  const { data: cfg, isLoading } = useZeConfig();
  const acao = useZeAcao();
  const atualizar = useAtualizarZeConfig();

  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-muted-foreground">O Zé está disponível só para o administrador do GD Manager.</div>
      </MainLayout>
    );
  }

  const situacao = cfg?.situacao ?? 'desconectado';
  const ocupado = acao.isPending;

  return (
    <MainLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-7 h-7 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-semibold">Zé — assistente no WhatsApp</h1>
            <p className="text-sm text-muted-foreground">José conecta no SEU número e fala com você pelo chat "Você". Ele nunca manda mensagem para terceiros.</p>
          </div>
        </div>

        {/* ── Conexão ─────────────────────────────────────────────────── */}
        <section className="rounded-xl border p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">Conexão</h2>
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', SITUACAO[situacao].cor)}>
              {isLoading ? 'carregando…' : SITUACAO[situacao].rotulo}
            </span>
          </div>

          {cfg?.phone_jid && (
            <p className="text-sm">Número: <span className="font-mono">{numeroBonito(cfg.phone_jid)}</span></p>
          )}

          {situacao === 'aguardando_qr' && (
            <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4">
              {cfg?.qr_code
                ? <img src={cfg.qr_code} alt="QR Code do WhatsApp" className="h-64 w-64" />
                : <div className="flex h-64 w-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> gerando QR…</div>}
              <p className="text-xs text-muted-foreground text-center">
                No celular: WhatsApp → ⋮ → Dispositivos conectados → Conectar dispositivo. O QR troca a cada ~20 s; a tela acompanha sozinha.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {situacao !== 'conectado' && (
              <Button onClick={() => acao.mutate('conectar')} disabled={ocupado}>
                <QrCode className="mr-2 h-4 w-4" /> {situacao === 'aguardando_qr' ? 'Gerar QR de novo' : 'Conectar'}
              </Button>
            )}
            <Button variant="outline" onClick={() => acao.mutate('estado')} disabled={ocupado}>
              <RefreshCw className={cn('mr-2 h-4 w-4', ocupado && 'animate-spin')} /> Atualizar estado
            </Button>
            {situacao === 'conectado' && (
              <>
                <Button variant="secondary" onClick={() => acao.mutate('teste_envio')} disabled={ocupado}>
                  <Send className="mr-2 h-4 w-4" /> Testar envio para mim
                </Button>
                <Button variant="destructive" onClick={() => { if (confirm('Desconectar o Zé do seu WhatsApp?')) acao.mutate('desconectar'); }} disabled={ocupado}>
                  <Unplug className="mr-2 h-4 w-4" /> Desconectar
                </Button>
              </>
            )}
          </div>
        </section>

        {/* ── Preferências ────────────────────────────────────────────── */}
        {cfg && (
          <section className="rounded-xl border p-5 space-y-4">
            <h2 className="font-medium">Preferências</h2>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Ignorar grupos na revisão de conversas</span>
              <Switch checked={cfg.ignorar_grupos} onCheckedChange={(v) => atualizar.mutate({ ignorar_grupos: v })} />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Horas sem resposta para me avisar</span>
              <Input type="number" min={1} max={72} className="w-24" defaultValue={cfg.horas_sem_resposta}
                onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 72 && n !== cfg.horas_sem_resposta) atualizar.mutate({ horas_sem_resposta: n }); }} />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Transcrever áudios</span>
              <Select value={cfg.transcrever_audios} onValueChange={(v) => atualizar.mutate({ transcrever_audios: v as ZeConfig['transcrever_audios'] })}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos (conversas individuais)</SelectItem>
                  <SelectItem value="so_meus">Só os meus (chat "Você")</SelectItem>
                  <SelectItem value="nenhum">Nenhum</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <p className="text-xs text-muted-foreground">A transcrição entra na Entrega 4; a preferência já fica guardada.</p>
          </section>
        )}
      </div>
    </MainLayout>
  );
}
```

- [ ] **Step 3: Rota em `App.tsx`**

Ao lado de `import Ludmilla from "./pages/Ludmilla";` acrescentar `import Ze from "./pages/Ze";` e, logo após a rota `/ludmilla`:
```tsx
      <Route path="/ze" element={<ProtectedRoute allowedRoles={['admin']}><Ze /></ProtectedRoute>} />
```

- [ ] **Step 4: Item no `Sidebar.tsx`**

1. No import do `lucide-react`, acrescentar `MessageCircle`.
2. Na interface `SidebarItem`, após `requiresLudmilla?: boolean;`:
   ```ts
     /** Só para o admin do GD Manager (o Zé conecta o WhatsApp pessoal do gestor). */
     requiresZe?: boolean;
   ```
3. Na lista, logo após o item da Ludmilla:
   ```ts
     { icon: MessageCircle, label: 'Zé', path: '/ze', roles: ['admin'], requiresZe: true },
   ```
4. Importar `useZeDisponivel` de `@/hooks/useZe`; dentro do componente, após `const ludmillaDisponivel = useLudmillaDisponivel();`:
   ```ts
     const zeDisponivel = useZeDisponivel();
   ```
5. No filtro `filteredItems`, acrescentar a condição:
   ```ts
       && (!item.requiresZe || zeDisponivel)
   ```

- [ ] **Step 5: Verificar tipos e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: `65` (baseline). Número menor = falha de parse; maior = erro novo nosso.

Run: `npm run build`
Expected: `✓ built in …` sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useZe.ts src/pages/Ze.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(ze): tela /ze com conexão por QR, teste de envio e preferências; item no menu"
git push origin main
```

---

### Task 7: Deploy das edge functions pelo CI + secrets

**Files:**
- Modify: `.github/workflows/deploy.yml` (dois passos novos, molde do `claudinho-verifica`)
- Test: run do workflow verde; `curl` do webhook com fixture.

**Interfaces:**
- Produces: `https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ze-webhook` e `/ze-admin` no ar.

- [ ] **Step 1: Passos no `deploy.yml`** (após o passo `Deploy log-event`)

```yaml
      # Zé — webhook da Evolution (token próprio no header x-ze-token) e ações
      # da tela /ze (checa o Authorization por conta própria).
      - name: Deploy ze-webhook
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: |
          supabase functions deploy ze-webhook \
            --project-ref yqsqrdndvsnhbsoaoilf \
            --no-verify-jwt

      - name: Deploy ze-admin
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: |
          supabase functions deploy ze-admin \
            --project-ref yqsqrdndvsnhbsoaoilf \
            --no-verify-jwt
```

- [ ] **Step 2: Gerar os segredos e gravar nas edge functions** (o usuário roda; valores não entram no repositório)

Gerar (Git Bash): `openssl rand -hex 24` duas vezes → `EVOLUTION_API_KEY` e `ZE_WEBHOOK_TOKEN`.

```bash
npx -y supabase secrets set --project-ref yqsqrdndvsnhbsoaoilf \
  EVOLUTION_URL=https://zap.homologamanager.com.br \
  EVOLUTION_API_KEY=<hex1> \
  ZE_WEBHOOK_TOKEN=<hex2>
```
Guardar `<hex1>` também no GitHub como secret `EVOLUTION_API_KEY` (Task 8 usa) e `<senha do postgres>` (`openssl rand -hex 16`) como `EVOLUTION_DB_PASSWORD`.

- [ ] **Step 3: Commit e acompanhar o deploy**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(ze): deploy de ze-webhook e ze-admin"
git push origin main
gh run watch --exit-status
```
Expected: run verde.

- [ ] **Step 4: Teste de fumaça do webhook com fixture** (antes da Evolution existir)

Primeiro, uma config de teste: `npx -y supabase db query --linked -f <scratchpad>/ze_config_teste.sql` com
```sql
INSERT INTO public.ze_config (tenant_id, owner_user_id, instance_name, phone_jid, situacao)
SELECT t.id, p.id, 'ze-teste', '5519999990000@s.whatsapp.net', 'conectado'
FROM public.tenants t JOIN public.profiles p ON p.tenant_id = t.id AND p.role = 'admin'
WHERE t.is_library ORDER BY p.created_at LIMIT 1
ON CONFLICT (tenant_id) DO UPDATE SET instance_name = 'ze-teste', phone_jid = EXCLUDED.phone_jid, situacao = 'conectado';
SELECT instance_name, phone_jid FROM public.ze_config;
```

Depois:
```bash
curl -s -X POST https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ze-webhook \
  -H "Content-Type: application/json" -H "x-ze-token: <hex2>" \
  --data @supabase/functions/_shared/fixtures/evolution/messages-upsert-texto.json
```
Expected: `{"ok":true,"acao":"em_segundo_plano"}`; sem token → 401.

Self-chat: mesmo curl com `messages-upsert-self-chat.json` → depois de 3 s, SQL
`SELECT papel, texto FROM public.ze_messages ORDER BY created_at DESC LIMIT 1;` → `user | Zé, o que tenho pra hoje?`.
E `SELECT jid, tipo, texto FROM public.wa_messages ORDER BY created_at DESC LIMIT 3;` mostra as duas.

- [ ] **Step 5: Limpar o teste**

```sql
DELETE FROM public.wa_messages WHERE wa_id LIKE '3EB0A1B2C3D4E5F6000%';
DELETE FROM public.ze_messages WHERE wa_id LIKE '3EB0A1B2C3D4E5F6000%';
DELETE FROM public.wa_chats WHERE jid IN ('5511988887777@s.whatsapp.net', '5519999990000@s.whatsapp.net');
DELETE FROM public.wa_contacts WHERE jid = '5511988887777@s.whatsapp.net';
UPDATE public.ze_config SET instance_name = 'ze-' || left(replace(tenant_id::text, '-', ''), 12), phone_jid = NULL, situacao = 'desconectado';
SELECT count(*) AS restantes FROM public.wa_messages;
```

---

### Task 8: Workflow `evolution-vps.yml` — Evolution + Nginx + SSL na VPS

**Files:**
- Create: `.github/workflows/evolution-vps.yml`
- Test: run com `acao=simular`, depois `acao=instalar`; `curl https://zap.homologamanager.com.br/` responde JSON da Evolution.

**Pré-requisito do usuário:** registro DNS `A zap → 143.95.221.114` na Hostinger; secrets do GitHub `EVOLUTION_API_KEY`, `EVOLUTION_DB_PASSWORD` (Task 7) e, opcional, `CERTBOT_EMAIL`.

- [ ] **Step 1: Escrever o workflow**

```yaml
name: Evolution API (Zé) — VPS

# Execução MANUAL (Actions → este workflow → "Run workflow").
#
# Instala/atualiza a Evolution API v2 (WhatsApp do Zé) na VPS: Docker Compose
# em /opt/evolution (api + postgres + redis, só na rede interna; a API escuta
# apenas em 127.0.0.1:8080), server block do Nginx para
# zap.homologamanager.com.br e certificado do certbot. Idempotente.
#
# NOTA de shell: `bash -s` SEM `-e` — o diagnóstico precisa sobreviver a
# comandos que falham (lição do nginx-cache-headers.yml).

on:
  workflow_dispatch:
    inputs:
      acao:
        description: 'instalar | atualizar (pull da imagem + up) | simular | status'
        type: choice
        options: [instalar, atualizar, simular, status]
        default: simular
      imagem_tag:
        description: 'Tag da imagem evoapicloud/evolution-api (latest = mais nova; fixar depois que estabilizar)'
        type: string
        default: latest

jobs:
  vps:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "${{ secrets.VPS_SSH_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -p ${{ secrets.VPS_SSH_PORT }} -H "${{ secrets.VPS_HOST }}" >> ~/.ssh/known_hosts 2>/dev/null || true

      - name: Executar
        env:
          ACAO: ${{ inputs.acao }}
          IMAGEM_TAG: ${{ inputs.imagem_tag }}
          EVOLUTION_API_KEY: ${{ secrets.EVOLUTION_API_KEY }}
          EVOLUTION_DB_PASSWORD: ${{ secrets.EVOLUTION_DB_PASSWORD }}
          CERTBOT_EMAIL: ${{ secrets.CERTBOT_EMAIL }}
        run: |
          ssh -i ~/.ssh/deploy_key -p ${{ secrets.VPS_SSH_PORT }} -o StrictHostKeyChecking=no \
            ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} \
            "ACAO='$ACAO' IMAGEM_TAG='$IMAGEM_TAG' EVOLUTION_API_KEY='$EVOLUTION_API_KEY' EVOLUTION_DB_PASSWORD='$EVOLUTION_DB_PASSWORD' CERTBOT_EMAIL='$CERTBOT_EMAIL' bash -s" <<'REMOTO'
          set -uo pipefail
          DOMINIO="zap.homologamanager.com.br"
          DIR="/opt/evolution"
          if [ "$(id -u)" = "0" ]; then S=""; else S="sudo"; fi
          echo "usuário: $(whoami) | ação: $ACAO | tag: $IMAGEM_TAG"

          # ── status ──────────────────────────────────────────────────────────
          if [ "$ACAO" = "status" ]; then
            $S docker compose -f "$DIR/docker-compose.yml" ps 2>/dev/null || echo "(compose não instalado)"
            curl -s -m 5 http://127.0.0.1:8080/ | head -c 300; echo
            $S ls -1 /etc/nginx/sites-enabled/ | grep -i zap || echo "(sem site nginx)"
            exit 0
          fi

          if [ -z "${EVOLUTION_API_KEY:-}" ] || [ -z "${EVOLUTION_DB_PASSWORD:-}" ]; then
            echo "ERRO: secrets EVOLUTION_API_KEY / EVOLUTION_DB_PASSWORD não configurados no GitHub."; exit 1
          fi

          # ── 1. Docker ───────────────────────────────────────────────────────
          if ! command -v docker >/dev/null 2>&1; then
            echo "docker ausente — instalando (docker.io + compose v2)"
            [ "$ACAO" = "simular" ] || { $S apt-get update -qq && $S apt-get install -y -qq docker.io docker-compose-v2 && $S systemctl enable --now docker; }
          else
            echo "docker: $(docker --version)"
          fi

          # ── 2. Arquivos do compose ──────────────────────────────────────────
          echo "=== $DIR ==="
          if [ "$ACAO" = "simular" ]; then
            echo "SIMULAÇÃO: escreveria $DIR/docker-compose.yml e $DIR/.env (tag $IMAGEM_TAG), subiria os containers, configuraria nginx + certbot para $DOMINIO."
            [ -f "$DIR/.env" ] && echo "(.env já existe — seria preservado, só a tag mudaria)"
            exit 0
          fi
          $S mkdir -p "$DIR"
          if [ -f "$DIR/docker-compose.yml" ]; then $S cp "$DIR/docker-compose.yml" "$DIR/docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S)"; fi

          $S tee "$DIR/docker-compose.yml" >/dev/null <<COMPOSE
          services:
            api:
              image: evoapicloud/evolution-api:${IMAGEM_TAG}
              container_name: evolution_api
              restart: unless-stopped
              ports:
                - "127.0.0.1:8080:8080"
              env_file: .env
              volumes:
                - evolution_instances:/evolution/instances
              depends_on:
                - postgres
                - redis
              networks: [evolution-net]
            postgres:
              image: postgres:16
              container_name: evolution_postgres
              restart: unless-stopped
              command: ["postgres", "-c", "max_connections=300"]
              environment:
                POSTGRES_DB: evolution
                POSTGRES_USER: evolution
                POSTGRES_PASSWORD: ${EVOLUTION_DB_PASSWORD}
              volumes:
                - evolution_postgres:/var/lib/postgresql/data
              networks: [evolution-net]
            redis:
              image: redis:7-alpine
              container_name: evolution_redis
              restart: unless-stopped
              command: ["redis-server", "--appendonly", "yes"]
              volumes:
                - evolution_redis:/data
              networks: [evolution-net]
          volumes:
            evolution_instances:
            evolution_postgres:
            evolution_redis:
          networks:
            evolution-net:
              driver: bridge
          COMPOSE

          # .env: só escreve se não existir (preserva chave/senha já em uso).
          if [ ! -f "$DIR/.env" ]; then
            $S tee "$DIR/.env" >/dev/null <<ENV
          SERVER_URL=https://${DOMINIO}
          AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}
          LANGUAGE=pt-BR
          LOG_LEVEL=ERROR,WARN,INFO
          DEL_INSTANCE=false
          QRCODE_LIMIT=30
          CONFIG_SESSION_PHONE_CLIENT=GD Manager
          CONFIG_SESSION_PHONE_NAME=Chrome
          DATABASE_PROVIDER=postgresql
          DATABASE_CONNECTION_URI=postgresql://evolution:${EVOLUTION_DB_PASSWORD}@postgres:5432/evolution?schema=public
          DATABASE_CONNECTION_CLIENT_NAME=evolution
          DATABASE_SAVE_DATA_INSTANCE=true
          DATABASE_SAVE_DATA_NEW_MESSAGE=true
          DATABASE_SAVE_MESSAGE_UPDATE=true
          DATABASE_SAVE_DATA_CONTACTS=true
          DATABASE_SAVE_DATA_CHATS=true
          DATABASE_SAVE_DATA_LABELS=false
          DATABASE_SAVE_DATA_HISTORIC=true
          CACHE_REDIS_ENABLED=true
          CACHE_REDIS_URI=redis://redis:6379/1
          CACHE_REDIS_PREFIX_KEY=evolution
          CACHE_REDIS_SAVE_INSTANCES=false
          CACHE_LOCAL_ENABLED=false
          WEBHOOK_GLOBAL_ENABLED=false
          WEBHOOK_EVENTS_MESSAGES_UPSERT=true
          WEBHOOK_EVENTS_CONNECTION_UPDATE=true
          WEBHOOK_EVENTS_QRCODE_UPDATED=true
          ENV
            $S chmod 600 "$DIR/.env"
            echo ".env criado"
          else
            echo ".env preservado"
          fi

          # ── 3. Subir ────────────────────────────────────────────────────────
          cd "$DIR"
          if [ "$ACAO" = "atualizar" ]; then $S docker compose pull; fi
          $S docker compose up -d
          echo "aguardando a API…"
          for i in $(seq 1 30); do
            if curl -s -m 3 http://127.0.0.1:8080/ | grep -q '"version"'; then echo "API respondeu: $(curl -s -m 3 http://127.0.0.1:8080/ | head -c 200)"; break; fi
            sleep 3
            [ "$i" = "30" ] && { echo "ERRO: API não respondeu em 90 s"; $S docker compose logs --tail 60 api; exit 1; }
          done
          echo "imagem em uso: $($S docker inspect --format '{{index .RepoDigests 0}}' evolution_api 2>/dev/null)"

          # ── 4. Nginx ────────────────────────────────────────────────────────
          CONF="/etc/nginx/sites-available/${DOMINIO}"
          if [ ! -f "$CONF" ]; then
            $S tee "$CONF" >/dev/null <<NGINX
          # GD-MANAGER-ZE — proxy para a Evolution API (WhatsApp do Zé)
          server {
              listen 80;
              server_name ${DOMINIO};
              client_max_body_size 50m;
              location / {
                  proxy_pass http://127.0.0.1:8080;
                  proxy_http_version 1.1;
                  proxy_set_header Upgrade \$http_upgrade;
                  proxy_set_header Connection "upgrade";
                  proxy_set_header Host \$host;
                  proxy_set_header X-Real-IP \$remote_addr;
                  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
                  proxy_set_header X-Forwarded-Proto \$scheme;
                  proxy_read_timeout 300;
              }
          }
          NGINX
            $S ln -sf "$CONF" "/etc/nginx/sites-enabled/${DOMINIO}"
            if $S nginx -t; then $S systemctl reload nginx; echo "nginx: site criado"; else echo "ERRO nginx -t; removendo"; $S rm -f "/etc/nginx/sites-enabled/${DOMINIO}"; exit 1; fi
          else
            echo "nginx: site já existia"
          fi

          # ── 5. SSL ──────────────────────────────────────────────────────────
          if [ ! -d "/etc/letsencrypt/live/${DOMINIO}" ]; then
            if [ -n "${CERTBOT_EMAIL:-}" ]; then EM="--email ${CERTBOT_EMAIL}"; else EM="--register-unsafely-without-email"; fi
            $S certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos --no-eff-email $EM --redirect \
              && echo "certificado emitido" || { echo "AVISO: certbot falhou (DNS propagou? registro A zap → este IP?)"; }
          else
            echo "certificado já existe"
          fi

          echo "=== pronto: https://${DOMINIO} ==="
          curl -s -m 5 -k "https://${DOMINIO}/" | head -c 200; echo
          REMOTO
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/evolution-vps.yml
git commit -m "ci(ze): workflow manual que instala/atualiza a Evolution API + Nginx + SSL na VPS"
git push origin main
```

- [ ] **Step 3: Rodar `simular`, depois `instalar`**

```bash
gh workflow run evolution-vps.yml -f acao=simular && sleep 20 && gh run watch --exit-status
gh workflow run evolution-vps.yml -f acao=instalar && sleep 20 && gh run watch --exit-status
```
Expected: log termina com `=== pronto: https://zap.homologamanager.com.br ===` e um JSON com `"version"`.

Run: `curl -s https://zap.homologamanager.com.br/ | head -c 200`
Expected: `{"status":200,"message":"Welcome to the Evolution API…","version":"2.x"…}`.
Se o certbot falhar por DNS, esperar a propagação e rodar `instalar` de novo (é idempotente).

---

### Task 9: Aceite da Entrega 1 (com o usuário) + documentação

**Files:**
- Create: `docs/modules/ze/overview.md`
- Modify: `CLAUDE.md` (linha na tabela de módulos), `docs/project/integrations.md` (Evolution), `docs/project/security.md` (dados de WhatsApp de terceiros, 30 dias — política aplicada na entrega 5), memória `ze.md` + `MEMORY.md`.

- [ ] **Step 1: Roteiro de aceite** (usuário no celular + `/ze` no navegador)

1. Abrir `/ze` (item "Zé" no menu). Clicar **Conectar** → QR aparece. No celular: Dispositivos conectados → ler.
2. Tela muda para **Conectado** com o número. Se ficar em "Aguardando" após ler, clicar **Atualizar estado**.
   SQL de conferência: `SELECT situacao, phone_jid FROM public.ze_config;` → `conectado | 55…@s.whatsapp.net`.
3. De **outro** celular, mandar "teste zé 1" para o número do gestor.
   `SELECT jid, remetente, tipo, texto, ts FROM public.wa_messages ORDER BY created_at DESC LIMIT 3;` → a linha aparece em < 10 s.
4. No celular do gestor, chat **"Você"**: escrever "Zé, teste 2".
   `SELECT papel, texto FROM public.ze_messages ORDER BY created_at DESC LIMIT 2;` → `user | Zé, teste 2`.
5. Na tela, **Testar envio para mim** → a mensagem "Zé aqui 👋…" aparece no chat "Você" do celular.
   `SELECT papel, texto, wa_id FROM public.ze_messages ORDER BY created_at DESC LIMIT 2;` → `ze | Zé aqui…` e **nenhuma** linha `user` duplicada com o mesmo `wa_id` (eco reconhecido).
6. Mandar um **áudio** no chat "Você": `ze_messages` recebe `🎤 [áudio Ns]` (transcrição é entrega 4).
7. **Se o passo 5 falhar** (Baileys não entrega ao próprio número): registrar o erro, e aplicar o plano B da spec §16 — criar no celular um grupo só com o gestor chamado "Zé", pegar o JID do grupo em `wa_chats` (`is_group = true`, nome "Zé") e gravar em `ze_config.phone_jid`; `ehSelfChat` passa a comparar o JID do grupo (ajustar a função para aceitar grupo quando `phone_jid` termina em `@g.us`, com teste novo). Só então fechar a entrega.

- [ ] **Step 2: Doc do módulo `docs/modules/ze/overview.md`**

```markdown
# Módulo: Zé (José) — assistente pessoal no WhatsApp

## Objetivo
Funcionário de IA que conversa com o gestor do GD Manager pelo próprio
WhatsApp (chat "Você"): resume o dia, aponta cards parados e dados faltando,
revisa conversas sem resposta, avisa mudanças de etapa e executa pedidos
simples (tarefas, notas, mover etapa com confirmação). Aprende com o gestor
e entende áudio. **Nunca envia mensagem a terceiros.**

Spec: `docs/superpowers/specs/2026-09-17-ze-whatsapp-design.md`.
Estado: **Entrega 1 (fundação) pronta** — conexão por QR e espelho do
WhatsApp. Entregas 2–6 (cérebro, escrita, aprendizado/áudio, rotinas/eventos,
skill/docs) em andamento.

## Regras duras
1. Só envia ao próprio JID (`ze_config.phone_jid`) — no código, não no prompt.
2. Nunca muda etapa sem confirmação explícita (pendência de 24 h).
3. `tenant_id` vem de `ze_config`, nunca do modelo.
4. Conversas de terceiros são dados, não instruções.
5. `wa_*` e `ze_messages`: só o dono lê (RLS `ze_dono_ok`). Retenção 30 dias (entrega 5).
6. Autor = gestor, `origin = 'ze'`.

## Infra
- Evolution API v2 na VPS (`/opt/evolution`, Docker: api + postgres + redis;
  API só em 127.0.0.1:8080). Nginx `zap.homologamanager.com.br` + certbot.
  Workflow manual `.github/workflows/evolution-vps.yml` (`simular | instalar |
  atualizar | status`; `.env` é preservado entre execuções).
- Instância `ze-<12 chars do tenant>`; webhook por instância →
  `/functions/v1/ze-webhook` com header `x-ze-token`.
- Secrets: GitHub `EVOLUTION_API_KEY`, `EVOLUTION_DB_PASSWORD`, `CERTBOT_EMAIL`
  (opcional); edge functions `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `ZE_WEBHOOK_TOKEN`.

## Banco
`ze_config` (1/tenant: dono, instância, `phone_jid`, `situacao`, `qr_code`,
preferências) · `wa_chats` · `wa_messages` (único por `tenant_id, wa_id`) ·
`wa_contacts` · `ze_messages` (diálogo no chat "Você"; `wa_id` marca o que o Zé
enviou — é assim que o webhook distingue eco de fala do gestor).
RPCs: `ze_admin_ok()`, `ze_dono_ok(tenant)`, `ze_ativar()`.

## Edge functions
- `ze-webhook` (`--no-verify-jwt`, token próprio): `qrcode.updated`,
  `connection.update`, `messages.upsert` → espelho; self-chat que não é eco →
  `ze_messages(papel='user')`.
- `ze-admin` (`--no-verify-jwt`, checa JWT + `ze_admin_ok`): `estado`,
  `conectar`, `teste_envio`, `desconectar`.
- Módulos puros em `supabase/functions/_shared/` (`evolution.ts`,
  `telefone.ts`) com testes vitest e fixtures em `_shared/fixtures/evolution/`.

## Tela
`/ze` (admin, `is_library`): conexão (QR, estado, teste, desconectar) e
preferências. Hook `src/hooks/useZe.ts`.

## Fluxo (entrega 1)
```mermaid
flowchart LR
  W[WhatsApp do gestor] -->|QR| E[Evolution API na VPS]
  E -->|webhook x-ze-token| H[ze-webhook]
  H --> M[(wa_messages / wa_chats / wa_contacts)]
  H -->|chat Você, não é eco| Z[(ze_messages user)]
  T[/ze] -->|JWT admin| A[ze-admin] --> E
```

## Armadilhas conhecidas
- O eco do `sendText` pode chegar ao webhook antes de `ze_messages` receber o
  `wa_id`: o webhook recheca após 2 s.
- JIDs `@lid` não são telefone (`telefoneDoJid` devolve null); `jid_alt` é
  guardado para o casamento futuro.
- `.env` da Evolution é preservado — trocar a chave exige editar na VPS e
  atualizar o secret das edge functions.
```

- [ ] **Step 3: `CLAUDE.md`** — na tabela de módulos, após a linha da Ludmilla:

```markdown
| Zé (assistente no WhatsApp) | 🟡 Entrega 1 (conexão + espelho) — só GD Manager | [modules/ze](docs/modules/ze/overview.md) |
```

- [ ] **Step 4: `docs/project/integrations.md`** — seção nova "Evolution API (WhatsApp do Zé)": auto-hospedada na VPS, não-oficial (Baileys), só o número do gestor, webhook autenticado, chave no secret; link para o módulo.

- [ ] **Step 5: Memória** — criar `memory/ze.md` (type: project) com: decisões (só gestor, número próprio, chat "Você", nunca a terceiros, Opus 5 medium, Groq), o que a entrega 1 provou (self-chat funciona ou plano B adotado), armadilhas (eco/2 s, `@lid`, `.env` preservado, `bash -s`), próximas entregas; e a linha no `MEMORY.md`. Registrar também o Engenheiro Bidu no índice (agente `staff` fixo com habilidades no banco) — faltava.

- [ ] **Step 6: Verificação final e commit**

Run: `npm test` → todos passando; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`; `npm run build` → ok.

```bash
git add docs/modules/ze/overview.md CLAUDE.md docs/project/integrations.md
git commit -m "docs(ze): módulo Zé — entrega 1 (fundação) documentada"
git push origin main
```

---

## Auto-revisão do plano

**Cobertura da spec (entrega 1):** §4 infra → Task 8; §5 tabelas base + RLS + `ze_ativar` → Task 1 (`ze_routines`, `ze_pending_actions`, `ze_runs`, `ze_learnings`, `ze_suggestions`, `notification_rules`, RPCs de leitura e cron ficam para as entregas 2–5, como a spec §15 prevê); §6 webhook → Tasks 3–4 (áudio só como rótulo; transcrição é entrega 4; acionar `ze-brain` é entrega 2); §12 tela (só Conexão + preferências) → Task 6; §13 token no webhook, porta local, RLS do dono → Tasks 1, 4, 8; §15 aceite → Task 9; §16 plano B do self-chat → Task 9 passo 7.

**Placeholders:** nenhum "TBD/implementar depois"; os pontos deixados para outras entregas estão nomeados com a entrega.

**Consistência de nomes:** `telefoneDoJid`, `ehGrupo`, `mesmoNumero`, `jidDoTelefone` (Task 2) usados em Tasks 3–5; `parseUpsert`, `parseConnectionUpdate`, `parseQrcode`, `ehSelfChat`, `EvolutionClient.{criarInstancia,setWebhook,conectar,estado,fetchInstancia,enviarTexto,logout}` (Task 3) usados em Tasks 4–5; tabelas e colunas (`situacao`, `qr_code`, `phone_jid`, `instance_name`, `wa_id`, `papel`) iguais em SQL, edges e hook; ações `estado | conectar | teste_envio | desconectar` iguais em `ze-admin` e `useZe`.
