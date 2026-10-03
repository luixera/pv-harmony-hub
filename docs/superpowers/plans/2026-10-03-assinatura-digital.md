# Assinatura digital no GD Manager — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** permitir que staff e admin assinem documentos de projeto com o
certificado A1 do engenheiro responsável, de dentro do GD Manager, com registro
completo e sem que documento fora de projeto chegue ao certificado.

**Architecture:** catálogo de tipos assináveis no banco é a tranca
determinística; a triagem do Claudinho é a segunda camada; um worker Node na
VPS prepara (converte + estampa) e, depois do "está certo" da pessoa, **anexa**
a assinatura PAdES sobre os bytes aprovados; o Zé avisa toda assinatura e
autoriza as exceções pelo WhatsApp.

**Tech Stack:** Postgres/Supabase (RLS RESTRICTIVE, Vault, pg_cron), Node 22 +
TypeScript (`@signpdf/signpdf` 3.3.0, `@signpdf/placeholder-plain`,
`@signpdf/signer-p12`, `node-forge` 1.4.0, `pdf-lib`), LibreOffice headless,
Deno (edge functions), React 18 + React Query.

**Spec:** [docs/superpowers/specs/2026-10-02-assinatura-digital-design.md](../specs/2026-10-02-assinatura-digital-design.md)

## Global Constraints

- Verificação antes de concluir: `npx tsc --noEmit -p tsconfig.app.json`
  contra o baseline de **65 erros** (queda grande = falha de parse) e
  `npm run build`. Só então commit + push em `main`.
- Banco: aplicar com `npx -y supabase db query --linked -f arquivo.sql`; só o
  último SELECT com linhas volta; RLS testada por impersonação dentro de
  `begin; … rollback;` com `set_config('request.jwt.claims', …)` +
  `set local role authenticated`.
- Toda RPC: `SECURITY DEFINER SET search_path = ''`, `REVOKE ALL … FROM PUBLIC,
  anon` e `GRANT EXECUTE` explícito. Confiança vem de `app_metadata`.
- Isolamento de tenant RESTRICTIVE em toda tabela nova.
- **A senha do `.pfx` nunca é digitada nem manipulada pelo assistente**: vai da
  tela para o Vault por RPC. `SUPABASE_SERVICE_ROLE_KEY` só em segredo do
  GitHub e em `/etc/gdm-assinador/env`.
- Liberado só para o tenant `is_library` (GD Manager), papéis `admin` e
  `staff`, como Bidu/Ludmilla/Zé.
- Identificadores em português (padrão do módulo); comunicação em português.
- Nada de `node -e` com backticks ou `${}` em Bash (corrompe o código): usar a
  ferramenta Edit/Write.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261003100000_assinatura_fundacao.sql` | tabelas, RLS, bucket, catálogo semeado, RPCs de catálogo e certificado |
| `supabase/migrations/20261003110000_assinatura_fluxo.sql` | RPCs do fluxo: pedir, aprovar, claim, finalizar, liberar, recusar |
| `supabase/migrations/20261003120000_assinatura_ze_e_vencimento.sql` | `liberar_assinatura` no Zé, aviso de vencimento, pg_cron |
| `worker/assinador/src/assinar.ts` | **puro**: estampa (pdf-lib) + assinatura (signpdf) |
| `worker/assinador/src/certificado.ts` | **puro**: lê metadados do `.pfx` (node-forge) |
| `worker/assinador/src/preparar.ts` | conversão para PDF (soffice) |
| `worker/assinador/src/fila.ts` | única porta para o banco (RPCs, storage) |
| `worker/assinador/src/index.ts` | o laço |
| `worker/assinador/test/*.test.ts` | `node:test` |
| `worker/assinador/deploy/` | `gdm-assinador.service`, `instalar.sh` |
| `.github/workflows/assinador-worker.yml` | deploy na VPS |
| `supabase/functions/assinatura-triagem/index.ts` | peneira do Claudinho |
| `supabase/functions/_shared/triagemAssinatura.ts` | **puro**: interpreta o veredito (testável no vitest) |
| `src/hooks/useAssinaturas.ts` | hooks da tela |
| `src/components/projects/TabAssinaturas.tsx` | aba no modal do projeto |
| `src/pages/Assinaturas.tsx` | página `/assinaturas` (certificado + extrato + conferir) |

---

### Task 1: Banco — fundação (tabelas, RLS, catálogo, certificado)

**Files:**
- Create: `supabase/migrations/20261003100000_assinatura_fundacao.sql`
- Create: `scratchpad/t1-rls.sql` (conferência, não vai para o repo)

**Interfaces:**
- Consumes: `public.get_user_tenant_id(uuid)`, `public.tenants.is_library`,
  `public.documents`, `public.concessionaire_templates`, `vault.create_secret`
- Produces: tabelas `documentos_assinaveis`, `certificados_digitais`,
  `assinaturas`; colunas `documents.assinavel_id`,
  `concessionaire_templates.assinavel_id`; função
  `public.assinatura_equipe_ok() → boolean`; RPCs
  `catalogo_assinavel_salvar(p_codigo text, p_nome text, p_origem text, p_exige_triagem boolean, p_ativo boolean) → uuid`,
  `certificado_cadastrar(p_path text, p_senha text, p_titular_nome text, p_titular_cpf text) → uuid`,
  `certificado_do_robo(p_id uuid) → table(arquivo_path text, senha text, titular_cpf text)`,
  `certificado_conferido(p_id uuid, p_situacao text, p_emissor text, p_serial text, p_inicio date, p_fim date) → boolean`

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20261003100000_assinatura_fundacao.sql`:

```sql
-- ============================================================================
-- ASSINATURA DIGITAL — fundação (03/10/2026)
--
-- Certificado A1 guardado no sistema, catálogo de documentos assináveis e a
-- tabela que é fila e histórico ao mesmo tempo.
--
-- A TRANCA: só é assinável o documento que entrou pelo fluxo de assinatura,
-- com um tipo do catálogo (documents.assinavel_id). Contrato social, procuração
-- avulsa e qualquer anexo solto ficam com assinavel_id NULL — não aparece botão
-- e a RPC recusa.
--
-- Spec: docs/superpowers/specs/2026-10-02-assinatura-digital-design.md
-- ============================================================================

-- ── Quem pode usar: admin/staff do tenant GD Manager (is_library) ───────────
CREATE OR REPLACE FUNCTION public.assinatura_equipe_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid()) AND p.role IN ('admin', 'staff') AND t.is_library
  );
$$;

CREATE OR REPLACE FUNCTION public.assinatura_admin_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid()) AND p.role = 'admin' AND t.is_library
  );
$$;

-- ── Catálogo: o que pode ser assinado ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documentos_assinaveis (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  codigo         TEXT NOT NULL,
  nome           TEXT NOT NULL,
  origem         TEXT NOT NULL DEFAULT 'ambos' CHECK (origem IN ('gerado', 'enviado', 'ambos')),
  exige_triagem  BOOLEAN NOT NULL DEFAULT TRUE,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

-- ── Certificado A1 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.certificados_digitais (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  titular_nome    TEXT NOT NULL,
  titular_cpf     TEXT NOT NULL,
  emissor         TEXT,
  serial          TEXT,
  validade_inicio DATE,
  validade_fim    DATE,
  arquivo_path    TEXT NOT NULL,
  secret_id       UUID,
  situacao        TEXT NOT NULL DEFAULT 'conferindo'
                  CHECK (situacao IN ('conferindo', 'ok', 'invalido', 'vencido')),
  erro            TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- um certificado ATIVO por tenant
CREATE UNIQUE INDEX IF NOT EXISTS certificado_ativo_unico
  ON public.certificados_digitais (tenant_id) WHERE ativo;

-- ── A marca nos documentos: é esta coluna que autoriza assinar ──────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS assinavel_id UUID
  REFERENCES public.documentos_assinaveis(id) ON DELETE SET NULL;

ALTER TABLE public.concessionaire_templates
  ADD COLUMN IF NOT EXISTS assinavel_id UUID
  REFERENCES public.documentos_assinaveis(id) ON DELETE SET NULL;

-- ── Fila e histórico ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id              UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id             UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  assinavel_id            UUID REFERENCES public.documentos_assinaveis(id) ON DELETE SET NULL,
  certificado_id          UUID REFERENCES public.certificados_digitais(id) ON DELETE SET NULL,
  -- cópia do certificado no momento da assinatura: o histórico não muda se o
  -- certificado for trocado depois
  titular_nome            TEXT,
  titular_cpf             TEXT,
  serial                  TEXT,
  pedida_por              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pedida_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  liberada_por            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  liberada_em             TIMESTAMPTZ,
  aprovada_por            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  aprovada_em             TIMESTAMPTZ,
  situacao                TEXT NOT NULL DEFAULT 'preparando'
                          CHECK (situacao IN ('preparando', 'conferir', 'triagem',
                                              'aguardando_ze', 'pendente', 'assinando',
                                              'assinado', 'recusado', 'erro')),
  motivo                  TEXT,
  recusa                  TEXT,
  documento_aprovado_path TEXT,
  documento_assinado_id   UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  hash_original           TEXT,
  hash_aprovado           TEXT,
  hash_assinado           TEXT,
  codigo_verificacao      TEXT NOT NULL DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 5)),
  erro                    TEXT,
  tentativas              SMALLINT NOT NULL DEFAULT 0,
  claim_em                TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo_verificacao)
);
CREATE INDEX IF NOT EXISTS assinaturas_tenant_idx ON public.assinaturas (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assinaturas_projeto_idx ON public.assinaturas (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assinaturas_fila_idx ON public.assinaturas (created_at)
  WHERE situacao IN ('preparando', 'triagem', 'pendente');

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.documentos_assinaveis  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificados_digitais  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas            ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['documentos_assinaveis', 'certificados_digitais', 'assinaturas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL
        USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
        WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())))
    $p$, t);
    EXECUTE format('DROP POLICY IF EXISTS equipe_le ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY equipe_le ON public.%I FOR SELECT
        USING ((select public.assinatura_equipe_ok()))
    $p$, t);
  END LOOP;
END $$;
-- escrita é só pelas RPCs (SECURITY DEFINER): nenhuma policy de INSERT/UPDATE.

-- ── Bucket do certificado: SEM policy nenhuma ───────────────────────────────
-- Nem o admin baixa o .pfx depois de subir. Só o service role alcança.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificados', 'certificados', false, 5242880,
        ARRAY['application/x-pkcs12', 'application/pkcs12', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

-- Subir o .pfx: o admin precisa de UM insert na pasta do próprio tenant.
DROP POLICY IF EXISTS certificado_admin_sobe ON storage.objects;
CREATE POLICY certificado_admin_sobe ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'certificados'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::text
    AND (select public.assinatura_admin_ok())
  );
-- Nenhuma policy de SELECT/UPDATE/DELETE: ninguém lê de volta pela API.

-- ── Catálogo: salvar (só admin) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.catalogo_assinavel_salvar(
  p_codigo TEXT, p_nome TEXT, p_origem TEXT DEFAULT 'ambos',
  p_exige_triagem BOOLEAN DEFAULT TRUE, p_ativo BOOLEAN DEFAULT TRUE)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID; _id UUID;
BEGIN
  IF NOT public.assinatura_admin_ok() THEN
    RAISE EXCEPTION 'Só o admin mexe no catálogo de documentos assináveis.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id((select auth.uid()));
  INSERT INTO public.documentos_assinaveis (tenant_id, codigo, nome, origem, exige_triagem, ativo)
  VALUES (_tenant, lower(trim(p_codigo)), trim(p_nome), p_origem, p_exige_triagem, p_ativo)
  ON CONFLICT (tenant_id, codigo) DO UPDATE
    SET nome = EXCLUDED.nome, origem = EXCLUDED.origem,
        exige_triagem = EXCLUDED.exige_triagem, ativo = EXCLUDED.ativo, updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_assinavel_salvar(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalogo_assinavel_salvar(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- ── Certificado: cadastrar (só admin; a senha vai para o Vault) ─────────────
CREATE OR REPLACE FUNCTION public.certificado_cadastrar(
  p_path TEXT, p_senha TEXT, p_titular_nome TEXT, p_titular_cpf TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID; _uid UUID := (select auth.uid()); _id UUID; _cpf TEXT; _segredo UUID;
BEGIN
  IF NOT public.assinatura_admin_ok() THEN
    RAISE EXCEPTION 'Só o admin cadastra o certificado.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  _cpf := regexp_replace(coalesce(p_titular_cpf, ''), '[^0-9]', '', 'g');
  IF length(_cpf) <> 11 THEN RAISE EXCEPTION 'CPF do titular inválido.'; END IF;
  IF coalesce(trim(p_senha), '') = '' THEN RAISE EXCEPTION 'Sem a senha do certificado não dá para usá-lo.'; END IF;
  IF (storage.foldername(p_path))[1] IS DISTINCT FROM _tenant::text THEN
    RAISE EXCEPTION 'O arquivo não está na pasta deste tenant.' USING ERRCODE = '42501';
  END IF;

  -- o anterior sai de cena (o índice único só aceita um ativo)
  UPDATE public.certificados_digitais SET ativo = FALSE, updated_at = now()
   WHERE tenant_id = _tenant AND ativo;

  _segredo := vault.create_secret(p_senha, 'certificado:' || _tenant || ':' || _cpf || ':' || extract(epoch from now())::bigint,
                                  'Senha do certificado A1 de ' || trim(p_titular_nome));
  INSERT INTO public.certificados_digitais
    (tenant_id, titular_nome, titular_cpf, arquivo_path, secret_id, situacao, ativo, created_by)
  VALUES (_tenant, trim(p_titular_nome), _cpf, p_path, _segredo, 'conferindo', TRUE, _uid)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.certificado_cadastrar(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certificado_cadastrar(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── Certificado: ler a senha — SÓ o robô ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.certificado_do_robo(p_id UUID)
RETURNS TABLE (arquivo_path TEXT, senha TEXT, titular_cpf TEXT, titular_nome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô lê a senha do certificado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.arquivo_path, s.decrypted_secret, c.titular_cpf, c.titular_nome
      FROM public.certificados_digitais c
      JOIN vault.decrypted_secrets s ON s.id = c.secret_id
     WHERE c.id = p_id AND c.ativo;
END;
$$;
REVOKE ALL ON FUNCTION public.certificado_do_robo(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.certificado_do_robo(UUID) TO service_role;

-- ── Certificado: o robô devolve o resultado da conferência ──────────────────
CREATE OR REPLACE FUNCTION public.certificado_conferido(
  p_id UUID, p_situacao TEXT, p_emissor TEXT DEFAULT NULL, p_serial TEXT DEFAULT NULL,
  p_inicio DATE DEFAULT NULL, p_fim DATE DEFAULT NULL, p_erro TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.certificados_digitais
     SET situacao = p_situacao, emissor = coalesce(p_emissor, emissor),
         serial = coalesce(p_serial, serial), validade_inicio = coalesce(p_inicio, validade_inicio),
         validade_fim = coalesce(p_fim, validade_fim), erro = p_erro, updated_at = now()
   WHERE id = p_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.certificado_conferido(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.certificado_conferido(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT) TO service_role;

-- ── Catálogo semeado para o tenant GD Manager ───────────────────────────────
INSERT INTO public.documentos_assinaveis (tenant_id, codigo, nome, origem, exige_triagem)
SELECT t.id, v.codigo, v.nome, v.origem, v.exige_triagem
  FROM public.tenants t
 CROSS JOIN (VALUES
   ('memorial_descritivo',       'Memorial descritivo',              'ambos',  TRUE),
   ('formulario_concessionaria', 'Formulário da concessionária',     'ambos',  FALSE),
   ('art',                       'ART / TRT do CREA',                'enviado', TRUE),
   ('diagrama_unifilar',         'Diagrama unifilar',                'ambos',  TRUE),
   ('declaracao_conformidade',   'Declaração de conformidade',       'ambos',  TRUE),
   ('procuracao_concessionaria', 'Procuração para a concessionária', 'enviado', TRUE)
 ) AS v(codigo, nome, origem, exige_triagem)
 WHERE t.is_library
ON CONFLICT (tenant_id, codigo) DO NOTHING;

SELECT 'fundação da assinatura aplicada' AS resultado,
       (SELECT count(*) FROM public.documentos_assinaveis) AS tipos_no_catalogo;
```

- [ ] **Step 2: Aplicar a migração**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261003100000_assinatura_fundacao.sql`
Expected: `resultado = fundação da assinatura aplicada`, `tipos_no_catalogo = 6`.

- [ ] **Step 3: Escrever a conferência de RLS e segredo**

Criar `scratchpad/t1-rls.sql` (fora do repo — usar a pasta de scratchpad da sessão):

```sql
-- Prova 1: authenticated NÃO lê a senha do certificado.
-- Prova 2: staff do tenant A não vê assinatura do tenant B.
-- Prova 3: staff não cadastra certificado (só admin).
begin;

create temp table achados (prova text, resultado text) on commit drop;
grant all on achados to authenticated, service_role;

-- quem é quem (o tenant GD Manager e um staff dele)
create temp table quem as
  select (select id from public.tenants where is_library limit 1) as tenant_lib,
         (select p.id from public.profiles p join public.tenants t on t.id = p.tenant_id
           where t.is_library and p.role = 'staff' limit 1) as staff_id;
grant all on quem to authenticated, service_role;

-- vira o staff
select set_config('request.jwt.claims',
  json_build_object('sub', (select staff_id::text from quem), 'role', 'authenticated')::text, true);
set local role authenticated;

-- Prova 1
do $$
begin
  perform public.certificado_do_robo(gen_random_uuid());
  insert into achados values ('senha do certificado', 'FALHOU: authenticated conseguiu chamar');
exception when others then
  insert into achados values ('senha do certificado', 'ok: ' || SQLERRM);
end $$;

-- Prova 3
do $$
begin
  perform public.certificado_cadastrar('x/y.pfx', 'segredo', 'Alguem', '12345678901');
  insert into achados values ('staff cadastra certificado', 'FALHOU: staff conseguiu');
exception when others then
  insert into achados values ('staff cadastra certificado', 'ok: ' || SQLERRM);
end $$;

-- Prova 2: linha de outro tenant é invisível
reset role;
insert into public.assinaturas (tenant_id, project_id, situacao)
select t.id, p.id, 'pendente'
  from public.tenants t
  join public.projects p on p.tenant_id = t.id
 where not t.is_library limit 1;

select set_config('request.jwt.claims',
  json_build_object('sub', (select staff_id::text from quem), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into achados
select 'assinatura de outro tenant',
       case when count(*) = 0 then 'ok: invisível' else 'FALHOU: viu ' || count(*) end
  from public.assinaturas a join public.tenants t on t.id = a.tenant_id where not t.is_library;

reset role;
select * from achados;
rollback;
```

- [ ] **Step 4: Rodar a conferência**

Run: `npx -y supabase db query --linked -f <scratchpad>/t1-rls.sql`
Expected: três linhas, todas começando com `ok:`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261003100000_assinatura_fundacao.sql
git commit -m "feat(assinatura): fundacao no banco -- catalogo, certificado e fila"
```

---

### Task 2: Banco — RPCs do fluxo

**Files:**
- Create: `supabase/migrations/20261003110000_assinatura_fluxo.sql`
- Create: `scratchpad/t2-fluxo.sql`

**Interfaces:**
- Consumes: Task 1 (tabelas, `assinatura_equipe_ok`, `certificados_digitais`)
- Produces: RPCs
  `assinatura_pedir(p_project_id uuid, p_document_id uuid, p_assinavel_id uuid, p_motivo text) → uuid`,
  `assinatura_aprovar(p_id uuid) → text` (devolve a próxima situação),
  `assinatura_recusar(p_id uuid, p_motivo text) → boolean`,
  `assinatura_claim() → table(...)` (service_role),
  `assinatura_passo(p_id uuid, p_situacao text, p_campos jsonb) → boolean` (service_role),
  `assinatura_liberar(p_id uuid, p_autor uuid) → boolean`,
  `assinatura_registro(p_limite int) → table(...)`

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20261003110000_assinatura_fluxo.sql`:

```sql
-- ============================================================================
-- ASSINATURA DIGITAL — o fluxo (03/10/2026)
--
-- pedir → preparando → conferir → (triagem) → pendente → assinando → assinado
--                                      ↘ aguardando_ze ↗  ou  recusado
--
-- A tranca mora em assinatura_pedir: documento sem assinavel_id, de projeto
-- apagado, de outro tenant ou sem certificado válido não entra.
-- ============================================================================

-- ── Pedir ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_pedir(
  p_project_id UUID, p_document_id UUID, p_assinavel_id UUID, p_motivo TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (select auth.uid()); _tenant UUID; _id UUID;
  _cert public.certificados_digitais; _tipo public.documentos_assinaveis;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  -- 1. o projeto é deste tenant e está vivo
  IF NOT EXISTS (SELECT 1 FROM public.projects pr
                  WHERE pr.id = p_project_id AND pr.tenant_id = _tenant AND NOT pr.is_deleted) THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;

  -- 2. o tipo está no catálogo e está ativo
  SELECT * INTO _tipo FROM public.documentos_assinaveis
   WHERE id = p_assinavel_id AND tenant_id = _tenant AND ativo;
  IF _tipo.id IS NULL THEN
    RAISE EXCEPTION 'Este tipo de documento não está liberado para assinatura.';
  END IF;

  -- 3. o documento é do projeto e carrega a marca do MESMO tipo
  --    (é esta linha que impede contrato social, procuração avulsa e anexo solto)
  IF NOT EXISTS (SELECT 1 FROM public.documents d
                  WHERE d.id = p_document_id AND d.project_id = p_project_id
                    AND d.assinavel_id = p_assinavel_id) THEN
    RAISE EXCEPTION 'Este documento não entrou pelo fluxo de assinatura — não é assinável.';
  END IF;

  -- 4. há certificado conferido e dentro da validade
  SELECT * INTO _cert FROM public.certificados_digitais
   WHERE tenant_id = _tenant AND ativo;
  IF _cert.id IS NULL THEN RAISE EXCEPTION 'Nenhum certificado cadastrado.'; END IF;
  IF _cert.situacao <> 'ok' THEN
    RAISE EXCEPTION 'O certificado está em "%" — não dá para assinar.', _cert.situacao;
  END IF;
  IF _cert.validade_fim IS NOT NULL AND _cert.validade_fim < current_date THEN
    RAISE EXCEPTION 'O certificado venceu em %.', to_char(_cert.validade_fim, 'DD/MM/YYYY');
  END IF;

  -- 5. nada de pedido duplicado em andamento para o mesmo documento
  IF EXISTS (SELECT 1 FROM public.assinaturas a
              WHERE a.document_id = p_document_id
                AND a.situacao IN ('preparando', 'conferir', 'triagem', 'aguardando_ze', 'pendente', 'assinando')) THEN
    RAISE EXCEPTION 'Já existe um pedido de assinatura em andamento para este documento.';
  END IF;

  INSERT INTO public.assinaturas
    (tenant_id, project_id, document_id, assinavel_id, certificado_id,
     titular_nome, titular_cpf, serial, pedida_por, motivo, situacao)
  VALUES (_tenant, p_project_id, p_document_id, p_assinavel_id, _cert.id,
          _cert.titular_nome, _cert.titular_cpf, _cert.serial, _uid,
          left(coalesce(p_motivo, ''), 500), 'preparando')
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pedir(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_pedir(UUID, UUID, UUID, TEXT) TO authenticated;

-- ── "Está certo": a pessoa conferiu o PDF preparado ─────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_aprovar(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _a public.assinaturas; _proxima TEXT; _exige BOOLEAN;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.assinaturas
   WHERE id = p_id AND tenant_id = public.get_user_tenant_id(_uid);
  IF _a.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF _a.situacao <> 'conferir' THEN
    RAISE EXCEPTION 'Este pedido está em "%" — não é hora de aprovar.', _a.situacao;
  END IF;

  SELECT exige_triagem INTO _exige FROM public.documentos_assinaveis WHERE id = _a.assinavel_id;
  _proxima := CASE WHEN coalesce(_exige, TRUE) THEN 'triagem' ELSE 'pendente' END;

  UPDATE public.assinaturas
     SET situacao = _proxima, aprovada_por = _uid, aprovada_em = now(), claim_em = NULL, updated_at = now()
   WHERE id = p_id;
  RETURN _proxima;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_aprovar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_aprovar(UUID) TO authenticated;

-- ── Desistir / recusar (a pessoa, na tela) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_recusar(p_id UUID, p_motivo TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _n INT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.assinaturas
     SET situacao = 'recusado', recusa = left(coalesce(p_motivo, 'Recusado na tela.'), 500),
         claim_em = NULL, updated_at = now()
   WHERE id = p_id AND tenant_id = public.get_user_tenant_id(_uid)
     AND situacao IN ('conferir', 'triagem', 'aguardando_ze', 'pendente', 'erro');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_recusar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_recusar(UUID, TEXT) TO authenticated;

-- ── O robô pega trabalho ────────────────────────────────────────────────────
-- Três etapas no mesmo claim: preparar, triar e assinar. `claim_em` evita que
-- dois laços peguem a mesma linha e devolve o trabalho se o robô cair.
CREATE OR REPLACE FUNCTION public.assinatura_claim()
RETURNS TABLE (
  id UUID, tenant_id UUID, project_id UUID, document_id UUID, assinavel_id UUID,
  certificado_id UUID, situacao TEXT, titular_nome TEXT, titular_cpf TEXT,
  codigo_verificacao TEXT, documento_aprovado_path TEXT, hash_aprovado TEXT,
  file_url TEXT, file_name TEXT, file_type TEXT, cidade TEXT, tentativas SMALLINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT a.id INTO _id FROM public.assinaturas a
   WHERE a.situacao IN ('preparando', 'triagem', 'pendente')
     AND a.tentativas < 3
     AND (a.claim_em IS NULL OR a.claim_em < now() - interval '10 minutes')
   ORDER BY a.created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF _id IS NULL THEN RETURN; END IF;

  UPDATE public.assinaturas a
     SET claim_em = now(), tentativas = a.tentativas + 1, updated_at = now()
   WHERE a.id = _id;

  RETURN QUERY
    SELECT a.id, a.tenant_id, a.project_id, a.document_id, a.assinavel_id,
           a.certificado_id, a.situacao, a.titular_nome, a.titular_cpf,
           a.codigo_verificacao, a.documento_aprovado_path, a.hash_aprovado,
           d.file_url, d.file_name, d.file_type,
           coalesce(g.city, '') AS cidade, a.tentativas
      FROM public.assinaturas a
      LEFT JOIN public.documents d ON d.id = a.document_id
      LEFT JOIN public.project_general_data g ON g.project_id = a.project_id
     WHERE a.id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_claim() TO service_role;

-- ── O robô devolve o passo ──────────────────────────────────────────────────
-- `p_campos` leva o que aquele passo produziu. Ao chegar em 'assinado',
-- registra o documento novo, comenta no card e escreve no histórico.
CREATE OR REPLACE FUNCTION public.assinatura_passo(
  p_id UUID, p_situacao TEXT, p_campos JSONB DEFAULT '{}'::jsonb)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _a public.assinaturas; _doc UUID; _codigo TEXT; _nome TEXT;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.assinaturas WHERE id = p_id;
  IF _a.id IS NULL THEN RETURN FALSE; END IF;

  IF p_situacao = 'assinado' THEN
    -- o assinado é documento NOVO; o original fica onde está
    INSERT INTO public.documents
      (project_id, document_type, file_name, file_url, file_type, assinavel_id)
    VALUES (_a.project_id, 'extra_attachment',
            left(p_campos->>'file_name', 200), p_campos->>'file_url',
            'application/pdf', _a.assinavel_id)
    RETURNING id INTO _doc;

    SELECT pr.code INTO _codigo FROM public.projects pr WHERE pr.id = _a.project_id;
    SELECT da.nome INTO _nome FROM public.documentos_assinaveis da WHERE da.id = _a.assinavel_id;

    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_a.project_id, _a.pedida_por,
            '✍️ ' || coalesce(_nome, 'Documento') || ' assinado digitalmente com o e-CPF de '
              || coalesce(_a.titular_nome, '—') || '. Código ' || _a.codigo_verificacao
              || E'\n📎 ' || left(coalesce(p_campos->>'file_name', ''), 200), 'comment');

    INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
    VALUES (_a.project_id, 'Documento assinado',
            coalesce(_nome, 'Documento') || ' assinado com o certificado de '
              || coalesce(_a.titular_nome, '—') || ' (código ' || _a.codigo_verificacao || ')',
            _a.pedida_por,
            coalesce((SELECT p.name FROM public.profiles p WHERE p.id = _a.pedida_por), 'equipe'));
  END IF;

  IF p_situacao = 'recusado' THEN
    SELECT da.nome INTO _nome FROM public.documentos_assinaveis da WHERE da.id = _a.assinavel_id;
    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_a.project_id, _a.pedida_por,
            '🚫 Assinatura recusada — ' || coalesce(p_campos->>'recusa', 'sem cunho de projeto')
              || ' (' || coalesce(_nome, 'documento') || ').', 'comment');
  END IF;

  UPDATE public.assinaturas
     SET situacao = p_situacao,
         documento_aprovado_path = coalesce(p_campos->>'documento_aprovado_path', documento_aprovado_path),
         hash_original = coalesce(p_campos->>'hash_original', hash_original),
         hash_aprovado = coalesce(p_campos->>'hash_aprovado', hash_aprovado),
         hash_assinado = coalesce(p_campos->>'hash_assinado', hash_assinado),
         documento_assinado_id = coalesce(_doc, documento_assinado_id),
         recusa = coalesce(p_campos->>'recusa', recusa),
         erro = p_campos->>'erro',
         claim_em = NULL, updated_at = now()
   WHERE id = p_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_passo(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_passo(UUID, TEXT, JSONB) TO service_role;

-- ── Liberar exceção (o "pode" do gestor, pelo Zé ou pela tela) ──────────────
CREATE OR REPLACE FUNCTION public.assinatura_liberar(p_id UUID, p_autor UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _autor UUID := coalesce((select auth.uid()), p_autor); _n INT;
BEGIN
  -- pela tela: só admin libera. Pelo Zé: chega como service_role com p_autor.
  IF (select auth.uid()) IS NOT NULL AND NOT public.assinatura_admin_ok() THEN
    RAISE EXCEPTION 'Só o admin libera assinatura fora do catálogo.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.assinaturas
     SET situacao = 'pendente', liberada_por = _autor, liberada_em = now(),
         claim_em = NULL, tentativas = 0, updated_at = now()
   WHERE id = p_id AND situacao = 'aguardando_ze';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_liberar(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_liberar(UUID, UUID) TO authenticated, service_role;

-- ── Extrato para a tela ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_registro(p_limite INT DEFAULT 100)
RETURNS TABLE (
  id UUID, project_id UUID, codigo_projeto TEXT, titular_projeto TEXT,
  tipo TEXT, situacao TEXT, titular_nome TEXT, serial TEXT,
  pedida_por_nome TEXT, pedida_em TIMESTAMPTZ, liberada_por_nome TEXT,
  codigo_verificacao TEXT, recusa TEXT, erro TEXT,
  documento_aprovado_path TEXT, assinado_path TEXT, assinado_nome TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.id, a.project_id, pr.code, coalesce(g.holder_name, ''),
         coalesce(da.nome, '—'), a.situacao, a.titular_nome, a.serial,
         coalesce(qp.name, '—'), a.pedida_em, ql.name,
         a.codigo_verificacao, a.recusa, a.erro,
         a.documento_aprovado_path, ds.file_url, ds.file_name
    FROM public.assinaturas a
    JOIN public.projects pr ON pr.id = a.project_id
    LEFT JOIN public.project_general_data g ON g.project_id = a.project_id
    LEFT JOIN public.documentos_assinaveis da ON da.id = a.assinavel_id
    LEFT JOIN public.profiles qp ON qp.id = a.pedida_por
    LEFT JOIN public.profiles ql ON ql.id = a.liberada_por
    LEFT JOIN public.documents ds ON ds.id = a.documento_assinado_id
   WHERE a.tenant_id = public.get_user_tenant_id((select auth.uid()))
     AND public.assinatura_equipe_ok()
   ORDER BY a.created_at DESC
   LIMIT greatest(1, least(coalesce(p_limite, 100), 500));
$$;
REVOKE ALL ON FUNCTION public.assinatura_registro(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_registro(INT) TO authenticated;

SELECT 'fluxo da assinatura aplicado' AS resultado;
```

- [ ] **Step 2: Aplicar**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261003110000_assinatura_fluxo.sql`
Expected: `resultado = fluxo da assinatura aplicado`.

- [ ] **Step 3: Escrever a prova da tranca**

Criar `scratchpad/t2-fluxo.sql`:

```sql
-- A TRANCA: documento sem a marca não é assinável, mesmo chamando a RPC na mão.
begin;
create temp table achados (prova text, resultado text) on commit drop;
grant all on achados to authenticated, service_role;

create temp table cena as
  select t.id as tenant, p.id as projeto,
         (select pf.id from public.profiles pf where pf.tenant_id = t.id and pf.role in ('admin','staff') limit 1) as pessoa,
         (select d.id from public.documents d where d.project_id = p.id limit 1) as doc_solto,
         (select da.id from public.documentos_assinaveis da where da.tenant_id = t.id and da.codigo = 'memorial_descritivo') as tipo
    from public.tenants t
    join public.projects p on p.tenant_id = t.id and not p.is_deleted
   where t.is_library limit 1;
grant all on cena to authenticated, service_role;

-- certificado fictício "ok" só para esta transação
insert into public.certificados_digitais (tenant_id, titular_nome, titular_cpf, arquivo_path, situacao, ativo, validade_fim)
select tenant, 'ENGENHEIRO DE TESTE', '12345678901', tenant::text || '/teste.pfx', 'ok', true, current_date + 60
  from cena
on conflict do nothing;

select set_config('request.jwt.claims',
  json_build_object('sub', (select pessoa::text from cena), 'role', 'authenticated')::text, true);
set local role authenticated;

-- Prova A: anexo comum (assinavel_id NULL) é recusado
do $$
begin
  perform public.assinatura_pedir((select projeto from cena), (select doc_solto from cena), (select tipo from cena), 'teste');
  insert into achados values ('anexo sem a marca', 'FALHOU: aceitou assinar anexo solto');
exception when others then
  insert into achados values ('anexo sem a marca', 'ok: ' || SQLERRM);
end $$;

-- Prova B: com a marca, é aceito
reset role;
update public.documents set assinavel_id = (select tipo from cena) where id = (select doc_solto from cena);
select set_config('request.jwt.claims',
  json_build_object('sub', (select pessoa::text from cena), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare _id uuid;
begin
  _id := public.assinatura_pedir((select projeto from cena), (select doc_solto from cena), (select tipo from cena), 'teste');
  insert into achados values ('com a marca', case when _id is null then 'FALHOU: sem id' else 'ok: pedido criado' end);
exception when others then
  insert into achados values ('com a marca', 'FALHOU: ' || SQLERRM);
end $$;

-- Prova C: pedido duplicado é barrado
do $$
begin
  perform public.assinatura_pedir((select projeto from cena), (select doc_solto from cena), (select tipo from cena), 'de novo');
  insert into achados values ('pedido duplicado', 'FALHOU: aceitou dois');
exception when others then
  insert into achados values ('pedido duplicado', 'ok: ' || SQLERRM);
end $$;

-- Prova D: aprovar antes de 'conferir' é barrado
do $$
declare _a uuid;
begin
  select id into _a from public.assinaturas where document_id = (select doc_solto from cena) limit 1;
  perform public.assinatura_aprovar(_a);
  insert into achados values ('aprovar em preparando', 'FALHOU: aprovou fora de hora');
exception when others then
  insert into achados values ('aprovar em preparando', 'ok: ' || SQLERRM);
end $$;

-- Prova E: authenticated não chama o claim do robô
do $$
begin
  perform public.assinatura_claim();
  insert into achados values ('claim por authenticated', 'FALHOU: chamou');
exception when others then
  insert into achados values ('claim por authenticated', 'ok: ' || SQLERRM);
end $$;

reset role;
select * from achados;
rollback;
```

- [ ] **Step 4: Rodar**

Run: `npx -y supabase db query --linked -f <scratchpad>/t2-fluxo.sql`
Expected: cinco linhas, todas `ok:` (a prova B diz "pedido criado").

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261003110000_assinatura_fluxo.sql
git commit -m "feat(assinatura): RPCs do fluxo com a tranca do catalogo"
```

---

### Task 3: Worker — estampa e assinatura (o coração, puro)

**Files:**
- Create: `worker/assinador/package.json`
- Create: `worker/assinador/tsconfig.json`
- Create: `worker/assinador/tsconfig.test.json`
- Create: `worker/assinador/scripts/testes.mjs`
- Create: `worker/assinador/src/certificado.ts`
- Create: `worker/assinador/src/assinar.ts`
- Create: `worker/assinador/test/assinar.test.ts`

**Interfaces:**
- Consumes: nada do projeto (módulos puros)
- Produces:
  `lerCertificado(pfx: Buffer, senha: string) → { titularNome: string; cpf: string; emissor: string; serial: string; inicio: Date; fim: Date }`;
  `estampar(pdf: Buffer, e: Estampa) → Promise<Buffer>` com
  `interface Estampa { titularNome: string; cpf: string; codigo: string; cidade: string; quando: Date }`;
  `assinar(pdfAprovado: Buffer, pfx: Buffer, senha: string, info: { nome: string; cidade: string }) → Promise<Buffer>`;
  `conferirAssinado(aprovado: Buffer, assinado: Buffer) → { prefixoOk: boolean; temByteRange: boolean }`

> **Armadilha já confirmada (03/10/2026):** `plainAddPlaceholder` **não lê PDF
> com xref stream** — falha com `Expected xref at NaN but found other content`.
> O `pdf-lib` grava xref stream por padrão. Por isso `estampar` **sempre** salva
> com `useObjectStreams: false`, e é o resultado da estampa que vai para a
> assinatura.

- [ ] **Step 1: Criar o pacote**

`worker/assinador/package.json`:

```json
{
  "name": "gdm-assinador",
  "version": "0.1.0",
  "private": true,
  "description": "Assinador — prepara (converte + estampa) e assina documentos de projeto com o certificado A1 do responsável técnico.",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.test.json && node scripts/testes.mjs",
    "start": "node dist/index.js"
  },
  "engines": { "node": ">=22" },
  "dependencies": {
    "@signpdf/placeholder-plain": "^3.3.0",
    "@signpdf/signer-p12": "^3.3.0",
    "@signpdf/signpdf": "^3.3.0",
    "@supabase/supabase-js": "^2.45.0",
    "node-forge": "^1.4.0",
    "pdf-lib": "^1.17.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/node-forge": "^1.3.11",
    "typescript": "^5.5.0"
  }
}
```

`worker/assinador/tsconfig.json` (idêntico ao da Ludmilla):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`worker/assinador/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "outDir": "dist-test", "rootDir": "." },
  "include": ["src", "test"]
}
```

`worker/assinador/scripts/testes.mjs` (mesma razão do da Ludmilla: lista
explícita, porque o glob no argumento só existe a partir do Node 21):

```javascript
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const pasta = join('dist-test', 'test');
const arquivos = readdirSync(pasta).filter(f => f.endsWith('.test.js')).map(f => join(pasta, f));
if (arquivos.length === 0) { console.error('Nenhum teste compilado em ' + pasta); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(r.status ?? 1);
```

Run: `cd worker/assinador && npm install`
Expected: instala sem erro; `node_modules` criado.

- [ ] **Step 2: Escrever o teste que falha**

`worker/assinador/test/assinar.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { lerCertificado } from '../src/certificado.js';
import { assinar, conferirAssinado, estampar } from '../src/assinar.js';

/** Um .pfx de teste, criado aqui: nenhum certificado real entra no repositório. */
function pfxDeTeste(cn = 'JOAO DA SILVA:12345678901', senha = 'senha-de-teste'): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '0A1B2C';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'countryName', value: 'BR' },
    { name: 'organizationName', value: 'ICP-Brasil' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

async function pdfDeTeste(paginas = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i++) {
    doc.addPage([595, 842]).drawText(`Pagina ${i} - memorial descritivo`, { x: 50, y: 780, size: 13, font: fonte });
  }
  return Buffer.from(await doc.save()); // xref STREAM — o caso que quebra o placeholder
}

test('lerCertificado tira titular, CPF, serial e validade do .pfx', () => {
  const c = lerCertificado(pfxDeTeste(), 'senha-de-teste');
  assert.equal(c.titularNome, 'JOAO DA SILVA');
  assert.equal(c.cpf, '12345678901');
  assert.equal(c.serial.toLowerCase(), '0a1b2c');
  assert.equal(c.fim.toISOString().slice(0, 10), '2027-01-01');
});

test('lerCertificado recusa senha errada', () => {
  assert.throws(() => lerCertificado(pfxDeTeste(), 'errada'), /senha/i);
});

test('estampar mantém as páginas e grava com xref clássica', async () => {
  const original = await pdfDeTeste(3);
  const preparado = await estampar(original, {
    titularNome: 'JOAO DA SILVA', cpf: '12345678901',
    codigo: 'AX7F2', cidade: 'UBERABA-MG', quando: new Date('2026-10-03T14:32:00-03:00'),
  });
  assert.equal((await PDFDocument.load(preparado)).getPageCount(), 3);
  // xref clássica: o arquivo termina com a tabela, não com um objeto de stream
  assert.ok(preparado.includes(Buffer.from('xref')), 'esperava tabela xref clássica');
  assert.ok(preparado.length > original.length, 'a estampa deveria acrescentar bytes');
});

test('assinar ANEXA: os bytes aprovados são prefixo exato do assinado', async () => {
  const pfx = pfxDeTeste();
  const aprovado = await estampar(await pdfDeTeste(2), {
    titularNome: 'JOAO DA SILVA', cpf: '12345678901',
    codigo: 'BB123', cidade: 'UBERABA-MG', quando: new Date(),
  });
  const assinado = await assinar(aprovado, pfx, 'senha-de-teste', { nome: 'JOAO DA SILVA', cidade: 'UBERABA-MG' });

  const v = conferirAssinado(aprovado, assinado);
  assert.equal(v.prefixoOk, true, 'o PDF aprovado deve ser prefixo do assinado');
  assert.equal(v.temByteRange, true, 'o assinado deve ter /ByteRange');
  assert.equal((await PDFDocument.load(assinado)).getPageCount(), 2);
});

test('assinar recusa senha errada do certificado', async () => {
  const aprovado = await estampar(await pdfDeTeste(1), {
    titularNome: 'X', cpf: '12345678901', codigo: 'CC123', cidade: 'SP', quando: new Date(),
  });
  await assert.rejects(() => assinar(aprovado, pfxDeTeste(), 'errada', { nome: 'X', cidade: 'SP' }));
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd worker/assinador && npm test`
Expected: FAIL na compilação — `Cannot find module '../src/certificado.js'`.

- [ ] **Step 4: Escrever `certificado.ts`**

`worker/assinador/src/certificado.ts`:

```typescript
import forge from 'node-forge';

/**
 * Lê os metadados do certificado A1 (.pfx / PKCS#12). Nada sai daqui para
 * disco: o buffer e a senha vivem só na memória do processo.
 *
 * No padrão ICP-Brasil o CN do e-CPF é "NOME DA PESSOA:CPF" — daí a separação.
 */
export interface DadosCertificado {
  titularNome: string;
  cpf: string;
  emissor: string;
  serial: string;
  inicio: Date;
  fim: Date;
}

export function lerCertificado(pfx: Buffer, senha: string): DadosCertificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch (e) {
    throw new Error(`Não consegui abrir o certificado — senha errada ou arquivo corrompido (${(e as Error).message}).`);
  }
  const sacos = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  const cert = sacos?.[0]?.cert;
  if (!cert) throw new Error('O arquivo não traz certificado dentro.');

  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const [nome, cpfBruto] = cn.split(':');
  const cpf = (cpfBruto ?? '').replace(/\D/g, '');
  const emissorCn = String(cert.issuer.getField('CN')?.value ?? '');
  const emissorO = String(cert.issuer.getField('O')?.value ?? '');

  return {
    titularNome: (nome ?? cn).trim(),
    cpf,
    emissor: [emissorCn, emissorO].filter(Boolean).join(' · ') || 'desconhecido',
    serial: cert.serialNumber,
    inicio: cert.validity.notBefore,
    fim: cert.validity.notAfter,
  };
}

/** `***.***.789-01` — o CPF aparece mascarado na estampa e nas telas. */
export function cpfMascarado(cpf: string): string {
  const d = cpf.replace(/\D/g, '').padStart(11, '0');
  return `***.***.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}
```

- [ ] **Step 5: Escrever `assinar.ts`**

`worker/assinador/src/assinar.ts`:

```typescript
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { P12Signer } from '@signpdf/signer-p12';
import signpdfModule from '@signpdf/signpdf';
import { cpfMascarado } from './certificado.js';

const signpdf = (signpdfModule as unknown as { default?: typeof signpdfModule }).default ?? signpdfModule;

export interface Estampa {
  titularNome: string;
  cpf: string;
  codigo: string;
  cidade: string;
  quando: Date;
}

/**
 * Desenha a estampa visível da assinatura na ÚLTIMA página e devolve o PDF
 * com tabela xref CLÁSSICA (`useObjectStreams: false`).
 *
 * Duas razões para a estampa vir antes da assinatura:
 *  1. é este arquivo que a pessoa confere — a conferência cobre a estampa;
 *  2. `plainAddPlaceholder` não lê PDF com xref stream (o padrão do pdf-lib):
 *     falha com "Expected xref at NaN". Gravando sem object streams, a
 *     assinatura seguinte é um append puro.
 */
export async function estampar(pdf: Buffer, e: Estampa): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const paginas = doc.getPages();
  const ultima = paginas[paginas.length - 1];
  const { width } = ultima.getSize();

  const larg = 290;
  const alt = 62;
  const x = Math.max(36, width - larg - 36);
  const y = 40;

  ultima.drawRectangle({
    x, y, width: larg, height: alt,
    color: rgb(0.965, 0.973, 1), borderColor: rgb(0.11, 0.33, 0.6), borderWidth: 1,
  });
  ultima.drawText('ASSINADO DIGITALMENTE', { x: x + 8, y: y + alt - 14, size: 7, font: negrito, color: rgb(0.11, 0.33, 0.6) });
  ultima.drawText(e.titularNome, { x: x + 8, y: y + alt - 28, size: 10, font: negrito, color: rgb(0.1, 0.1, 0.1) });
  ultima.drawText(`CPF ${cpfMascarado(e.cpf)}`, { x: x + 8, y: y + alt - 40, size: 8, font: fonte, color: rgb(0.25, 0.25, 0.25) });
  ultima.drawText(
    `${e.cidade || '—'} · ${e.quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    { x: x + 8, y: y + alt - 51, size: 7, font: fonte, color: rgb(0.35, 0.35, 0.35) },
  );
  ultima.drawText(`Código ${e.codigo} · confira no GD Manager`, { x: x + 8, y: y + 6, size: 6.5, font: fonte, color: rgb(0.45, 0.45, 0.45) });

  // xref CLÁSSICA — exigência do plainAddPlaceholder
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/**
 * Anexa a assinatura PAdES ao PDF **já aprovado**. Nenhum byte do que a pessoa
 * conferiu é reescrito: o resultado tem o aprovado como prefixo exato.
 */
export async function assinar(
  pdfAprovado: Buffer, pfx: Buffer, senha: string, info: { nome: string; cidade: string },
): Promise<Buffer> {
  const comPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdfAprovado,
    reason: 'Assinatura do responsável técnico',
    contactInfo: 'GD Manager',
    name: info.nome,
    location: info.cidade || 'Brasil',
  });
  return Buffer.from(await signpdf.sign(comPlaceholder, new P12Signer(pfx, { passphrase: senha })));
}

/** Conferência final: o aprovado é prefixo do assinado e há /ByteRange. */
export function conferirAssinado(aprovado: Buffer, assinado: Buffer): { prefixoOk: boolean; temByteRange: boolean } {
  return {
    prefixoOk: assinado.length > aprovado.length && assinado.subarray(0, aprovado.length).equals(aprovado),
    temByteRange: assinado.includes(Buffer.from('ByteRange')),
  };
}
```

- [ ] **Step 6: Rodar os testes até passarem**

Run: `cd worker/assinador && npm test`
Expected: PASS nos 5 testes (`assinar.test.js`).

- [ ] **Step 7: Commit**

```bash
git add worker/assinador/package.json worker/assinador/package-lock.json \
        worker/assinador/tsconfig.json worker/assinador/tsconfig.test.json \
        worker/assinador/scripts/testes.mjs \
        worker/assinador/src/certificado.ts worker/assinador/src/assinar.ts \
        worker/assinador/test/assinar.test.ts
git commit -m "feat(assinatura): estampa e assinatura PAdES com append sobre os bytes aprovados"
```

---

### Task 4: Worker — preparo (conversão para PDF)

**Files:**
- Create: `worker/assinador/src/preparar.ts`
- Create: `worker/assinador/test/preparar.test.ts`

**Interfaces:**
- Consumes: `estampar` (Task 3)
- Produces:
  `precisaConverter(nome: string, mime: string | null) → boolean`;
  `converterParaPdf(bytes: Buffer, nomeOriginal: string) → Promise<Buffer>`;
  `temSoffice() → boolean`

- [ ] **Step 1: Escrever o teste que falha**

`worker/assinador/test/preparar.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { converterParaPdf, precisaConverter, temSoffice } from '../src/preparar.js';

test('precisaConverter reconhece o que não é PDF', () => {
  assert.equal(precisaConverter('memorial.pdf', 'application/pdf'), false);
  assert.equal(precisaConverter('MEMORIAL.PDF', null), false);
  assert.equal(precisaConverter('formulario-cemig.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true);
  assert.equal(precisaConverter('memorial.docx', null), true);
});

test('converterParaPdf recusa extensão que não sabe converter', async () => {
  await assert.rejects(() => converterParaPdf(Buffer.from('x'), 'foto.png'), /não sei converter/i);
});

// A conversão real precisa do LibreOffice. Na máquina sem soffice o teste
// avisa e passa — o CI instala libreoffice e cobre o caminho de verdade.
test('converterParaPdf entrega um PDF legível a partir de .docx', { skip: !temSoffice() && 'soffice ausente nesta máquina' }, async () => {
  // Memorial de verdade, já versionado no repositório (confirmado 03/10/2026
  // com `git ls-files '*.docx'`). Da pasta do worker são quatro níveis acima.
  const { readFileSync } = await import('node:fs');
  const docx = readFileSync(new URL('../../../docs/modelos-memoriais/MEMORIAL_DESCRITIVO_ENEL.docx', import.meta.url));
  const pdf = await converterParaPdf(docx, 'MEMORIAL_DESCRITIVO_ENEL.docx');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
});

test('converterParaPdf dá conta de planilha (o caminho da CEMIG)', { skip: !temSoffice() && 'soffice ausente nesta máquina' }, async () => {
  const { readFileSync } = await import('node:fs');
  const xlsx = readFileSync(new URL('../../../docs/modelos-cemig/FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx', import.meta.url));
  const pdf = await converterParaPdf(xlsx, 'FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
```

> O caminho relativo sai de `dist-test/test/` (onde o teste compilado roda),
> então são quatro níveis acima até a raiz: `../../../docs/...` a partir de
> `worker/assinador/dist-test/test/`. Se o `import.meta.url` resolver errado,
> trocar por `resolve(process.cwd(), '../../docs/...')` — o `npm test` roda com
> `cwd = worker/assinador`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd worker/assinador && npm test`
Expected: FAIL — `Cannot find module '../src/preparar.js'`.

- [ ] **Step 3: Escrever `preparar.ts`**

`worker/assinador/src/preparar.ts`:

```typescript
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { promisify } from 'node:util';

const executar = promisify(execFile);

/** O que o LibreOffice headless dá conta de virar PDF neste fluxo. */
const CONVERSIVEIS = new Set(['.xlsx', '.xls', '.docx', '.doc', '.odt', '.ods', '.csv']);

export function precisaConverter(nome: string, mime: string | null): boolean {
  if ((mime ?? '').toLowerCase() === 'application/pdf') return false;
  return parse(nome.toLowerCase()).ext !== '.pdf';
}

export function temSoffice(): boolean {
  const caminhos = ['/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice'];
  return caminhos.some(c => existsSync(c));
}

/**
 * Converte para PDF com o LibreOffice headless. Roda numa pasta temporária
 * própria (`-env:UserInstallation`), senão duas conversões simultâneas brigam
 * pelo mesmo perfil e uma delas devolve PDF vazio.
 */
export async function converterParaPdf(bytes: Buffer, nomeOriginal: string): Promise<Buffer> {
  const { ext, name } = parse(nomeOriginal.toLowerCase());
  if (!CONVERSIVEIS.has(ext)) {
    throw new Error(`Não sei converter "${ext || 'sem extensão'}" para PDF. Suba o documento já em PDF.`);
  }
  const pasta = await mkdtemp(join(tmpdir(), 'gdm-assinador-'));
  try {
    const entrada = join(pasta, `entrada${ext}`);
    await writeFile(entrada, bytes);
    await executar('soffice', [
      `-env:UserInstallation=file://${join(pasta, 'perfil')}`,
      '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', pasta, entrada,
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

    const saida = join(pasta, 'entrada.pdf');
    if (!existsSync(saida)) throw new Error('O LibreOffice não produziu o PDF.');
    const pdf = await readFile(saida);
    if (pdf.length < 1000 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      throw new Error(`A conversão de "${name}${ext}" saiu vazia ou ilegível.`);
    }
    return pdf;
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd worker/assinador && npm test`
Expected: PASS. O terceiro teste de `preparar` pode aparecer como `skipped`
numa máquina sem LibreOffice — é o esperado em Windows.

- [ ] **Step 5: Commit**

```bash
git add worker/assinador/src/preparar.ts worker/assinador/test/preparar.test.ts
git commit -m "feat(assinatura): conversao para PDF com LibreOffice headless"
```

---

### Task 5: Worker — fila e laço

**Files:**
- Create: `worker/assinador/src/fila.ts`
- Create: `worker/assinador/src/index.ts`
- Create: `worker/assinador/test/fila.test.ts`

**Interfaces:**
- Consumes: Task 1 (`certificado_do_robo`, `certificado_conferido`), Task 2
  (`assinatura_claim`, `assinatura_passo`), Task 3 (`lerCertificado`,
  `estampar`, `assinar`, `conferirAssinado`), Task 4 (`precisaConverter`,
  `converterParaPdf`)
- Produces:
  `supabase() → SupabaseClient`; `pegarTrabalho() → Promise<Trabalho | null>`;
  `passo(id: string, situacao: string, campos: Record<string, unknown>) → Promise<void>`;
  `certificadosParaConferir() → Promise<{ id: string }[]>`;
  `dadosDoCertificado(id: string) → Promise<{ arquivo_path: string; senha: string; titular_cpf: string; titular_nome: string }>`;
  `baixar(bucket: string, path: string) → Promise<Buffer>`;
  `subir(bucket: string, path: string, bytes: Buffer, mime: string) → Promise<string>`;
  `sha256(b: Buffer) → string`; `caminhoAprovado(t: Trabalho) → string`;
  `nomeAssinado(nome: string) → string`

- [ ] **Step 1: Escrever o teste que falha**

`worker/assinador/test/fila.test.ts` (só as partes puras; o acesso ao banco é
coberto pelas provas SQL das Tasks 1-2 e pelo aceite na VPS):

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeAssinado, sha256 } from '../src/fila.js';

test('sha256 é estável e tem 64 hex', () => {
  const h = sha256(Buffer.from('memorial'));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha256(Buffer.from('memorial')));
  assert.notEqual(h, sha256(Buffer.from('memorial ')));
});

test('nomeAssinado troca a extensão e marca o arquivo', () => {
  assert.equal(nomeAssinado('memorial.pdf'), 'memorial_assinado.pdf');
  assert.equal(nomeAssinado('FORMULARIO_CEMIG.xlsx'), 'FORMULARIO_CEMIG_assinado.pdf');
  assert.equal(nomeAssinado('sem-extensao'), 'sem-extensao_assinado.pdf');
  // não duplica o sufixo se já vier assinado
  assert.equal(nomeAssinado('memorial_assinado.pdf'), 'memorial_assinado.pdf');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd worker/assinador && npm test`
Expected: FAIL — `Cannot find module '../src/fila.js'`.

- [ ] **Step 3: Escrever `fila.ts`**

`worker/assinador/src/fila.ts`:

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { parse } from 'node:path';

/**
 * A fila do assinador vive no banco (`public.assinaturas`), e este módulo é a
 * única porta do robô para ela. Tudo por RPC, com service role — que só existe
 * na VPS, em /etc/gdm-assinador/env.
 *
 * O robô não tem SELECT direto em tabela nenhuma além do que as funções expõem.
 */

export interface Trabalho {
  id: string;
  tenant_id: string;
  project_id: string;
  document_id: string | null;
  assinavel_id: string | null;
  certificado_id: string | null;
  situacao: 'preparando' | 'triagem' | 'pendente';
  titular_nome: string | null;
  titular_cpf: string | null;
  codigo_verificacao: string;
  documento_aprovado_path: string | null;
  hash_aprovado: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  cidade: string;
  tentativas: number;
}

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Falta SUPABASE_URL no ambiente.');
  if (!chave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** `memorial.xlsx` → `memorial_assinado.pdf`; já assinado continua igual. */
export function nomeAssinado(nome: string): string {
  const { name } = parse(nome);
  const base = name.endsWith('_assinado') ? name : `${name}_assinado`;
  return `${base}.pdf`;
}

/** Onde o PDF preparado fica à espera do "está certo". */
export const caminhoAprovado = (t: Trabalho): string =>
  `${t.tenant_id}/${t.project_id}/assinatura/${t.id}_para_assinar.pdf`;

export async function pegarTrabalho(): Promise<Trabalho | null> {
  const { data, error } = await supabase().rpc('assinatura_claim');
  if (error) throw new Error(`Não consegui consultar a fila: ${error.message}`);
  return ((data ?? []) as Trabalho[])[0] ?? null;
}

export async function passo(id: string, situacao: string, campos: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase().rpc('assinatura_passo', {
    p_id: id, p_situacao: situacao, p_campos: campos,
  });
  if (error) throw new Error(`Não consegui gravar o passo ${situacao}: ${error.message}`);
}

export async function certificadosParaConferir(): Promise<{ id: string }[]> {
  const { data, error } = await supabase()
    .from('certificados_digitais')
    .select('id')
    .eq('situacao', 'conferindo')
    .eq('ativo', true)
    .limit(3);
  if (error) throw new Error(`Não consegui listar certificados: ${error.message}`);
  return (data ?? []) as { id: string }[];
}

export async function dadosDoCertificado(id: string) {
  const { data, error } = await supabase().rpc('certificado_do_robo', { p_id: id });
  if (error) throw new Error(`Não consegui ler o certificado: ${error.message}`);
  const linha = ((data ?? []) as { arquivo_path: string; senha: string; titular_cpf: string; titular_nome: string }[])[0];
  if (!linha) throw new Error('Certificado não encontrado ou desativado.');
  return linha;
}

export async function certificadoConferido(
  id: string, situacao: 'ok' | 'invalido' | 'vencido',
  dados?: { emissor?: string; serial?: string; inicio?: string; fim?: string; erro?: string },
): Promise<void> {
  const { error } = await supabase().rpc('certificado_conferido', {
    p_id: id, p_situacao: situacao,
    p_emissor: dados?.emissor ?? null, p_serial: dados?.serial ?? null,
    p_inicio: dados?.inicio ?? null, p_fim: dados?.fim ?? null, p_erro: dados?.erro ?? null,
  });
  if (error) throw new Error(`Não consegui fechar a conferência: ${error.message}`);
}

export async function baixar(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Não consegui baixar ${path}: ${error?.message ?? 'sem conteúdo'}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function subir(bucket: string, path: string, bytes: Buffer, mime: string): Promise<string> {
  const { error } = await supabase().storage.from(bucket)
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`Não consegui subir ${path}: ${error.message}`);
  return path;
}

/** Pede ao Claudinho a peneira de conteúdo (edge function). */
export async function triar(pdf: Buffer, tenantId: string): Promise<{ veredito: string; motivo: string }> {
  const { data, error } = await supabase().functions.invoke('assinatura-triagem', {
    body: { tenant_id: tenantId, base64: pdf.toString('base64') },
  });
  if (error) throw new Error(`A triagem não respondeu: ${error.message}`);
  const r = data as { ok?: boolean; veredito?: string; motivo?: string };
  if (!r?.ok || !r.veredito) throw new Error('A triagem respondeu sem veredito.');
  return { veredito: r.veredito, motivo: r.motivo ?? '' };
}

/** Recado do Zé (texto pronto, sem IA). Falha aqui nunca derruba a assinatura. */
export async function recadoDoZe(tenantId: string, texto: string): Promise<void> {
  await supabase().functions
    .invoke('ze-brain', { body: { modo: 'recado', tenant_id: tenantId, texto } })
    .then(() => undefined, () => undefined);
}
```

- [ ] **Step 4: Rodar os testes de `fila`**

Run: `cd worker/assinador && npm test`
Expected: PASS nos dois testes de `fila.test.js`.

- [ ] **Step 5: Escrever o laço**

`worker/assinador/src/index.ts`:

```typescript
import { assinar, conferirAssinado, estampar } from './assinar.js';
import { cpfMascarado, lerCertificado } from './certificado.js';
import { converterParaPdf, precisaConverter, temSoffice } from './preparar.js';
import {
  Trabalho, baixar, caminhoAprovado, certificadoConferido, certificadosParaConferir,
  dadosDoCertificado, nomeAssinado, passo, pegarTrabalho, recadoDoZe, sha256, subir, triar,
} from './fila.js';

/**
 * ASSINADOR — o laço.
 *
 * Três etapas, a mesma fila:
 *  - preparando → converte (se preciso) + estampa → `conferir` (espera a pessoa)
 *  - triagem    → peneira do Claudinho → `pendente` | `recusado` | `aguardando_ze`
 *  - pendente   → anexa a assinatura PAdES → `assinado`
 *
 * O original nunca é tocado. Depois do "está certo" nenhum byte é reescrito:
 * a assinatura é append sobre os bytes aprovados.
 */

const POLL_SEGUNDOS = Number(process.env.ASSINADOR_POLL_SECONDS ?? 15);
const DOCS = 'project-documents';
const CERTS = 'certificados';

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Confere um certificado recém-cadastrado: abre o .pfx e grava os metadados. */
async function conferirCertificado(id: string): Promise<void> {
  try {
    const c = await dadosDoCertificado(id);
    const pfx = await baixar(CERTS, c.arquivo_path);
    const d = lerCertificado(pfx, c.senha);

    if (d.cpf !== c.titular_cpf) {
      await certificadoConferido(id, 'invalido', {
        erro: `O CPF do certificado (${cpfMascarado(d.cpf)}) não é o que foi informado no cadastro.`,
      });
      log('certificado com CPF divergente', { certificado: id });
      return;
    }
    const venceu = d.fim.getTime() < Date.now();
    await certificadoConferido(id, venceu ? 'vencido' : 'ok', {
      emissor: d.emissor, serial: d.serial,
      inicio: d.inicio.toISOString().slice(0, 10),
      fim: d.fim.toISOString().slice(0, 10),
      erro: venceu ? `O certificado venceu em ${d.fim.toLocaleDateString('pt-BR')}.` : undefined,
    });
    log('certificado conferido', { certificado: id, titular: d.titularNome, vence: d.fim.toISOString().slice(0, 10), venceu });
  } catch (e) {
    await certificadoConferido(id, 'invalido', { erro: (e as Error).message }).catch(() => undefined);
    log('certificado recusado', { certificado: id, erro: (e as Error).message });
  }
}

/** preparando → conferir */
async function preparar(t: Trabalho): Promise<void> {
  if (!t.file_url || !t.file_name) throw new Error('O pedido não aponta para nenhum arquivo.');
  const original = await baixar(DOCS, t.file_url);
  const base = precisaConverter(t.file_name, t.file_type)
    ? await converterParaPdf(original, t.file_name)
    : original;

  const aprovado = await estampar(base, {
    titularNome: t.titular_nome ?? '—',
    cpf: t.titular_cpf ?? '',
    codigo: t.codigo_verificacao,
    cidade: t.cidade,
    quando: new Date(),
  });
  const path = await subir(DOCS, caminhoAprovado(t), aprovado, 'application/pdf');

  await passo(t.id, 'conferir', {
    documento_aprovado_path: path,
    hash_original: sha256(original),
    hash_aprovado: sha256(aprovado),
  });
  log('preparado para conferência', { assinatura: t.id, convertido: precisaConverter(t.file_name, t.file_type) });
}

/** triagem → pendente | recusado | aguardando_ze */
async function peneirar(t: Trabalho): Promise<void> {
  if (!t.documento_aprovado_path) throw new Error('Sem PDF aprovado para triar.');
  const pdf = await baixar(DOCS, t.documento_aprovado_path);

  // Acima de 10 MB não vai para a IA: decide o gestor.
  if (pdf.length > 10 * 1024 * 1024) {
    await passo(t.id, 'aguardando_ze', { recusa: 'Arquivo grande demais para a triagem automática.' });
    log('triagem pulada pelo tamanho', { assinatura: t.id, bytes: pdf.length });
    return;
  }

  let veredito = 'duvida';
  let motivo = 'A triagem não respondeu.';
  try {
    const r = await triar(pdf, t.tenant_id);
    veredito = r.veredito;
    motivo = r.motivo;
  } catch (e) {
    // FALHA FECHADA: sem resposta da IA, não vira 'pendente' sozinho.
    motivo = `Triagem indisponível: ${(e as Error).message}`;
  }

  if (veredito === 'projeto') {
    await passo(t.id, 'pendente', {});
    log('triagem ok', { assinatura: t.id });
  } else if (veredito === 'nao_projeto') {
    await passo(t.id, 'recusado', { recusa: motivo || 'Não tem cunho de projeto.' });
    log('triagem barrou', { assinatura: t.id, motivo });
  } else {
    await passo(t.id, 'aguardando_ze', { recusa: motivo });
    log('triagem em dúvida — foi para o gestor', { assinatura: t.id, motivo });
  }
}

/** pendente → assinado */
async function assinarTrabalho(t: Trabalho): Promise<void> {
  if (!t.documento_aprovado_path || !t.hash_aprovado) throw new Error('Sem PDF aprovado para assinar.');
  if (!t.certificado_id) throw new Error('O pedido não aponta para nenhum certificado.');

  const aprovado = await baixar(DOCS, t.documento_aprovado_path);
  // o que foi aprovado tem de ser exatamente o que será assinado
  if (sha256(aprovado) !== t.hash_aprovado) {
    throw new Error('O PDF mudou depois do "está certo" — não assino.');
  }

  const c = await dadosDoCertificado(t.certificado_id);
  const pfx = await baixar(CERTS, c.arquivo_path);
  const d = lerCertificado(pfx, c.senha);
  if (d.fim.getTime() < Date.now()) throw new Error(`O certificado venceu em ${d.fim.toLocaleDateString('pt-BR')}.`);
  if (d.cpf !== c.titular_cpf) throw new Error('O CPF do certificado não bate com o cadastro.');

  const assinado = await assinar(aprovado, pfx, c.senha, { nome: d.titularNome, cidade: t.cidade });
  const v = conferirAssinado(aprovado, assinado);
  if (!v.prefixoOk) throw new Error('A assinatura reescreveu o PDF aprovado — abortado.');
  if (!v.temByteRange) throw new Error('O PDF assinado saiu sem /ByteRange.');

  const nome = nomeAssinado(t.file_name ?? 'documento.pdf');
  const path = `${t.tenant_id}/${t.project_id}/assinatura/${t.id}_${nome}`;
  await subir(DOCS, path, assinado, 'application/pdf');

  await passo(t.id, 'assinado', {
    file_url: path, file_name: nome, hash_assinado: sha256(assinado),
  });
  log('assinado', { assinatura: t.id, codigo: t.codigo_verificacao, bytes: assinado.length });

  await recadoDoZe(t.tenant_id,
    `Assinei ${nome} com o e-CPF de ${d.titularNome}, ` +
    `${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}. ` +
    `Código ${t.codigo_verificacao}.`);
}

async function executar(t: Trabalho): Promise<void> {
  try {
    if (t.situacao === 'preparando') return await preparar(t);
    if (t.situacao === 'triagem') return await peneirar(t);
    if (t.situacao === 'pendente') return await assinarTrabalho(t);
    log('situação inesperada na fila', { assinatura: t.id, situacao: t.situacao });
  } catch (e) {
    const erro = (e as Error).message;
    // 3ª tentativa: para de insistir e deixa o erro visível na tela
    const final = t.tentativas >= 3;
    await passo(t.id, final ? 'erro' : t.situacao, { erro }).catch(() => undefined);
    log('trabalho com erro', { assinatura: t.id, etapa: t.situacao, tentativa: t.tentativas, final, erro });
  }
}

async function principal() {
  log('assinador no ar', { poll: POLL_SEGUNDOS, soffice: temSoffice() });
  if (!temSoffice()) log('aviso: LibreOffice ausente — planilha e .docx não serão convertidos');

  let parar = false;
  const encerrar = () => { parar = true; log('encerrando'); };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);

  while (!parar) {
    try {
      for (const c of await certificadosParaConferir()) await conferirCertificado(c.id);
      const t = await pegarTrabalho();
      if (!t) { await dormir(POLL_SEGUNDOS * 1_000); continue; }
      await executar(t);
      await dormir(1_000);
    } catch (e) {
      log('laço tropeçou', { erro: (e as Error).message });
      await dormir(POLL_SEGUNDOS * 1_000);
    }
  }
}

principal().catch(e => { log('caiu', { erro: (e as Error).message }); process.exit(1); });
```

- [ ] **Step 6: Compilar**

Run: `cd worker/assinador && npm run build && npm test`
Expected: compila sem erro e os 9 testes passam (os de conversão podem
aparecer como `skipped` em Windows).

- [ ] **Step 7: Commit**

```bash
git add worker/assinador/src/fila.ts worker/assinador/src/index.ts worker/assinador/test/fila.test.ts
git commit -m "feat(assinatura): fila e laco do assinador (preparar, triar, assinar)"
```

---

### Task 6: Worker — deploy na VPS

**Files:**
- Create: `worker/assinador/deploy/gdm-assinador.service`
- Create: `worker/assinador/deploy/instalar.sh`
- Create: `.github/workflows/assinador-worker.yml`

**Interfaces:**
- Consumes: Task 5 (`dist/index.js`)
- Produces: serviço systemd `gdm-assinador`, ambiente em
  `/etc/gdm-assinador/env`, código em `/opt/gdm-assinador`

- [ ] **Step 1: A unit do systemd**

`worker/assinador/deploy/gdm-assinador.service`:

```ini
[Unit]
Description=Assinador — prepara e assina documentos de projeto (GD Manager)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gdmassinador
Group=gdmassinador
WorkingDirectory=/opt/gdm-assinador
EnvironmentFile=/etc/gdm-assinador/env
Environment=HOME=/home/gdmassinador
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gdm-assinador

# endurecimento: o assinador não precisa de mais nada da máquina.
# PrivateTmp é essencial — o LibreOffice e o .pfx passam pelo /tmp.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/opt/gdm-assinador /home/gdmassinador

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: O instalador**

`worker/assinador/deploy/instalar.sh`:

```bash
#!/usr/bin/env bash
# Instalação/atualização do assinador na VPS. Idempotente. Chamado pelo
# workflow assinador-worker.yml por SSH, com o código já em /opt/gdm-assinador
# e SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SIMULAR exportados.
#
# Sem `set -e` no diagnóstico (lição do deploy do Nginx: errexit mata o script
# antes de ele dizer o que aconteceu).

APP=/opt/gdm-assinador
ENV_DIR=/etc/gdm-assinador
UNIT=/etc/systemd/system/gdm-assinador.service
USUARIO=gdmassinador

falhar() { echo "ERRO: $*" >&2; exit 1; }
passo()  { echo; echo "── $*"; }

passo "diagnóstico"
echo "host: $(hostname)"
echo "node: $(node -v 2>/dev/null || echo 'ausente')"
echo "soffice: $(soffice --version 2>/dev/null | head -1 || echo 'ausente')"
echo "unit: $([ -f "$UNIT" ] && echo 'existe' || echo 'não existe')"
echo "serviço: $(systemctl is-active gdm-assinador 2>/dev/null || echo 'inativo')"
echo "últimas linhas do log:"; journalctl -u gdm-assinador -n 12 --no-pager 2>/dev/null

if [ "${SIMULAR:-false}" = "true" ]; then
  echo; echo "SIMULAÇÃO — nada foi alterado."; exit 0
fi

[ -n "$SUPABASE_URL" ] || falhar "SUPABASE_URL vazio"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || falhar "SUPABASE_SERVICE_ROLE_KEY vazio"
[ -f "$APP/package.json" ] || falhar "código não está em $APP (o rsync rodou?)"

passo "Node 22"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || falhar "não consegui preparar o repositório do Node"
  apt-get install -y nodejs || falhar "não consegui instalar o Node"
fi
echo "node agora: $(node -v)"

passo "LibreOffice (conversão de planilha e .docx para PDF)"
# só os filtros de escritório, sem a interface gráfica inteira
apt-get install -y --no-install-recommends libreoffice-calc libreoffice-writer \
  || falhar "não consegui instalar o LibreOffice"
echo "soffice: $(soffice --version 2>/dev/null | head -1)"

passo "usuário $USUARIO"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USUARIO" \
  || falhar "não consegui criar o usuário"

passo "dependências"
cd "$APP" || falhar "sem $APP"
npm ci --omit=dev --no-audit --no-fund || falhar "npm ci falhou"
chown -R "$USUARIO:$USUARIO" "$APP"

passo "ambiente em $ENV_DIR/env (só root lê)"
mkdir -p "$ENV_DIR"
cat > "$ENV_DIR/env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ASSINADOR_POLL_SECONDS=15
EOF
chmod 600 "$ENV_DIR/env"

passo "fumaça: o LibreOffice converte?"
sudo -u "$USUARIO" -H bash -c 'cd /tmp && printf "a;b\n1;2\n" > fumaca.csv &&
  soffice -env:UserInstallation=file:///tmp/perfil-fumaca --headless --norestore \
    --convert-to pdf --outdir /tmp /tmp/fumaca.csv >/dev/null 2>&1 &&
  head -c 5 /tmp/fumaca.pdf' | grep -q '%PDF-' \
  && echo "conversão ok" \
  || echo "aviso: a conversão de fumaça falhou — PDF já pronto continua assinável"

passo "serviço systemd"
cp "$APP/deploy/gdm-assinador.service" "$UNIT" || falhar "não consegui copiar a unit"
systemctl daemon-reload
systemctl enable gdm-assinador >/dev/null 2>&1
systemctl restart gdm-assinador || falhar "o serviço não subiu"
sleep 3
systemctl status gdm-assinador --no-pager -l | head -20
echo
echo "últimas linhas do log:"
journalctl -u gdm-assinador -n 10 --no-pager
```

- [ ] **Step 3: O workflow**

`.github/workflows/assinador-worker.yml`:

```yaml
name: Assinador — deploy do robô na VPS

# Execução MANUAL (aba Actions → este workflow → "Run workflow").
#
# Segredos necessários: VPS_HOST, VPS_USER, VPS_SSH_PORT, VPS_SSH_KEY,
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — os mesmos da Ludmilla.
#
# A service role decifra a senha do certificado (via RPC): existe só no segredo
# do GitHub e em /etc/gdm-assinador/env (600, root) na VPS.

on:
  workflow_dispatch:
    inputs:
      simular:
        description: 'Só diagnosticar na VPS, sem instalar nada'
        type: boolean
        default: false

concurrency:
  group: assinador-worker
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: worker/assinador/package-lock.json

      # O LibreOffice entra aqui para o teste de conversão rodar de verdade no
      # CI (na máquina de quem desenvolve ele é `skipped`).
      - name: LibreOffice
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends libreoffice-calc libreoffice-writer

      - name: Testes do assinador
        working-directory: worker/assinador
        run: |
          npm ci
          npm test

      - name: Compilar
        working-directory: worker/assinador
        run: npm run build

      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "${{ secrets.VPS_SSH_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -p ${{ secrets.VPS_SSH_PORT }} -H "${{ secrets.VPS_HOST }}" >> ~/.ssh/known_hosts 2>/dev/null || true

      - name: Sincronizar código
        if: ${{ !inputs.simular }}
        run: |
          SSH="ssh -i ~/.ssh/deploy_key -p ${{ secrets.VPS_SSH_PORT }} -o StrictHostKeyChecking=no"
          $SSH ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} 'mkdir -p /opt/gdm-assinador'
          rsync -avz --delete -e "$SSH" \
            --exclude='node_modules' --exclude='dist-test' --exclude='test' --exclude='src' \
            --exclude='_*' --exclude='*.pfx' --exclude='*.pdf' \
            worker/assinador/ ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:/opt/gdm-assinador/

      - name: Instalar / reiniciar
        env:
          SIMULAR: ${{ inputs.simular }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          ssh -i ~/.ssh/deploy_key -p ${{ secrets.VPS_SSH_PORT }} -o StrictHostKeyChecking=no \
            ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} \
            "SIMULAR='$SIMULAR' SUPABASE_URL='$SUPABASE_URL' SUPABASE_SERVICE_ROLE_KEY='$SUPABASE_SERVICE_ROLE_KEY' bash -s" \
            < worker/assinador/deploy/instalar.sh
```

- [ ] **Step 4: Conferir a sintaxe do YAML e do shell**

Run: `node -e "console.log(require('fs').readFileSync('.github/workflows/assinador-worker.yml','utf8').length)"` e
`bash -n worker/assinador/deploy/instalar.sh`
Expected: o primeiro imprime um número; o segundo não imprime nada (sintaxe ok).

- [ ] **Step 5: Commit**

```bash
git add worker/assinador/deploy .github/workflows/assinador-worker.yml
git commit -m "feat(assinatura): deploy do assinador na VPS (systemd + Actions)"
```

> O `Run workflow` em si fica para o aceite (Task 10): o serviço só tem o que
> fazer depois do certificado cadastrado pela tela.

---

### Task 7: A peneira do Claudinho

**Files:**
- Create: `supabase/functions/_shared/triagemAssinatura.ts`
- Create: `supabase/functions/_shared/triagemAssinatura.test.ts`
- Create: `supabase/functions/assinatura-triagem/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `consume_ai_quota_servidor(_tenant, _kind, _user)`,
  `update_ai_usage_tokens_servidor(_log_id, _tenant, _model, _input_tokens, _output_tokens)`
- Produces: `lerVeredito(texto: string) → { veredito: 'projeto' | 'nao_projeto' | 'duvida'; motivo: string }`;
  endpoint `POST /assinatura-triagem` com corpo
  `{ tenant_id, base64 }` → `{ ok, veredito, motivo }`

> O módulo do parser fica em `_shared` porque o `vitest.config.ts` já inclui
> `supabase/functions/_shared/**/*.test.ts` — assim a parte delicada roda no
> `npm test` sem precisar do Deno instalado.

- [ ] **Step 1: Escrever o teste que falha**

`supabase/functions/_shared/triagemAssinatura.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { lerVeredito } from './triagemAssinatura';

describe('lerVeredito', () => {
  it('lê o JSON limpo', () => {
    const r = lerVeredito('{"veredito":"projeto","motivo":"Memorial descritivo de GD."}');
    expect(r.veredito).toBe('projeto');
    expect(r.motivo).toBe('Memorial descritivo de GD.');
  });

  it('acha o JSON no meio de texto solto', () => {
    const r = lerVeredito('Analisei o documento.\n```json\n{"veredito":"nao_projeto","motivo":"É um contrato de prestação de serviços."}\n```');
    expect(r.veredito).toBe('nao_projeto');
    expect(r.motivo).toMatch(/contrato/);
  });

  // FALHA FECHADA: o que não dá para ler NUNCA vira 'projeto'
  it('resposta cortada vira dúvida', () => {
    expect(lerVeredito('{"veredito":"proje').veredito).toBe('duvida');
  });

  it('texto sem JSON vira dúvida', () => {
    expect(lerVeredito('não consegui abrir o arquivo').veredito).toBe('duvida');
  });

  it('veredito desconhecido vira dúvida', () => {
    expect(lerVeredito('{"veredito":"talvez","motivo":"x"}').veredito).toBe('duvida');
  });

  it('string vazia vira dúvida', () => {
    expect(lerVeredito('').veredito).toBe('duvida');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- triagemAssinatura`
Expected: FAIL — `Failed to resolve import "./triagemAssinatura"`.

- [ ] **Step 3: Escrever o parser**

`supabase/functions/_shared/triagemAssinatura.ts`:

```typescript
/**
 * Interpreta a resposta da triagem de assinatura.
 *
 * REGRA DURA: tudo o que não for um veredito legível vira `duvida` — e dúvida
 * vai para o gestor, não para a fila. A IA aqui é a SEGUNDA camada; a tranca é
 * o catálogo (documents.assinavel_id). Então falhar fechado não custa
 * segurança nenhuma: custa uma pergunta no WhatsApp.
 */
export type Veredito = 'projeto' | 'nao_projeto' | 'duvida';

export interface Triagem {
  veredito: Veredito;
  motivo: string;
}

const VALIDOS: Veredito[] = ['projeto', 'nao_projeto', 'duvida'];

export function lerVeredito(texto: string): Triagem {
  const bruto = (texto ?? '').trim();
  if (!bruto) return { veredito: 'duvida', motivo: 'A triagem não devolveu nada.' };

  // o primeiro objeto JSON do texto (o modelo às vezes embrulha em ```json)
  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) {
    return { veredito: 'duvida', motivo: `Não achei JSON na resposta: ${bruto.slice(0, 200)}` };
  }
  let obj: { veredito?: unknown; motivo?: unknown };
  try {
    obj = JSON.parse(bruto.slice(inicio, fim + 1));
  } catch {
    return { veredito: 'duvida', motivo: 'A resposta da triagem veio cortada ou inválida.' };
  }
  const v = String(obj.veredito ?? '').trim().toLowerCase() as Veredito;
  if (!VALIDOS.includes(v)) {
    return { veredito: 'duvida', motivo: `Veredito desconhecido: "${String(obj.veredito ?? '')}".` };
  }
  return { veredito: v, motivo: String(obj.motivo ?? '').slice(0, 500) };
}
```

- [ ] **Step 4: Rodar até passar**

Run: `npm test -- triagemAssinatura`
Expected: PASS nos 6 casos.

- [ ] **Step 5: Escrever a edge function**

`supabase/functions/assinatura-triagem/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { lerVeredito } from '../_shared/triagemAssinatura.ts'

/**
 * TRIAGEM DE ASSINATURA — a segunda camada.
 *
 * A primeira (e a que vale) é o catálogo: só documento com `assinavel_id`
 * chega aqui. Esta função existe para o caso de alguém cadastrar um contrato
 * escolhendo o tipo "memorial": o Claudinho lê o conteúdo e barra.
 *
 * Quem chama é o ROBÔ (service role) — não a tela. Por isso a conferência do
 * portador: só o assinador na VPS tem essa chave.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODELO_IA = 'claude-opus-4-8'

const PROMPT = `Você analisa um documento que alguém pediu para ASSINAR digitalmente
com o certificado (e-CPF) de um engenheiro responsável por projetos
fotovoltaicos de geração distribuída.

Sua única pergunta: este documento é PEÇA DE UM PROJETO DE ENGENHARIA?

É de projeto (veredito "projeto"):
- memorial descritivo, diagrama unifilar, ART/TRT do CREA;
- formulário ou requerimento de concessionária (CEMIG, ENEL, CPFL, EDP…);
- declaração técnica, laudo, planilha de dimensionamento;
- procuração ESPECÍFICA para representar o cliente junto à concessionária.

NÃO é de projeto (veredito "nao_projeto"):
- contrato comercial, de prestação de serviço, de locação, trabalhista;
- proposta comercial, orçamento, nota fiscal, recibo, boleto;
- documento pessoal (RG, CPF, CNH), contrato social, cartão CNPJ;
- distrato, termo de confidencialidade, acordo entre sócios;
- qualquer coisa cujo efeito seja obrigação financeira ou societária.

Na dúvida honesta, responda "duvida" — uma pessoa decide. Não adivinhe.

Responda SÓ com JSON, sem mais nada:
{"veredito":"projeto"|"nao_projeto"|"duvida","motivo":"uma frase curta em português"}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }, 500)

  // Só o robô: a tela não triagem nada.
  const portador = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!servico || portador !== servico) return json({ ok: false, error: 'só o assinador chama esta função' }, 403)

  try {
    const body = await req.json() as { tenant_id?: string; base64?: string }
    if (!body?.tenant_id) return json({ ok: false, error: 'tenant_id obrigatório' }, 400)
    if (!body?.base64) return json({ ok: false, error: 'nenhum documento enviado' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, servico, { auth: { persistSession: false } })

    const { data: quota } = await admin.rpc('consume_ai_quota_servidor', {
      _tenant: body.tenant_id, _kind: 'assinatura_triagem', _user: null,
    })
    const q = quota as Record<string, unknown> | null
    if (q?.allowed === false) {
      // sem cota não se declara "projeto": devolve dúvida e o gestor decide
      return json({ ok: true, veredito: 'duvida', motivo: 'Sem cota de IA para a triagem este mês.' })
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO_IA,
        // o raciocínio adaptativo CONTA dentro de max_tokens (lição de 16/09/2026)
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.base64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })
    if (!resp.ok) {
      console.error('Claude API error:', await resp.text())
      return json({ ok: true, veredito: 'duvida', motivo: `A IA respondeu ${resp.status}.` })
    }
    const dados = await resp.json()

    if (q?.log_id && dados?.usage) {
      const { error: errTok } = await admin.rpc('update_ai_usage_tokens_servidor', {
        _log_id: q.log_id, _tenant: body.tenant_id, _model: MODELO_IA,
        _input_tokens: dados.usage.input_tokens ?? 0, _output_tokens: dados.usage.output_tokens ?? 0,
      })
      if (errTok) console.error('tokens não lançados no extrato', errTok)
    }
    if (dados.stop_reason === 'max_tokens') {
      console.error('Resposta cortada por max_tokens', dados.usage)
      return json({ ok: true, veredito: 'duvida', motivo: 'A resposta da triagem foi cortada.' })
    }

    const texto = (dados.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('\n')
    const r = lerVeredito(texto)
    return json({ ok: true, veredito: r.veredito, motivo: r.motivo })
  } catch (e) {
    console.error('[assinatura-triagem]', e)
    return json({ ok: true, veredito: 'duvida', motivo: `Triagem falhou: ${e instanceof Error ? e.message : 'erro'}` })
  }
})
```

- [ ] **Step 6: Declarar no config.toml**

Acrescentar ao final de `supabase/config.toml`:

```toml
# Triagem de assinatura — quem chama é o assinador na VPS, com service role.
# A função confere o portador por conta própria (só o robô passa).
[functions.assinatura-triagem]
verify_jwt = false
```

- [ ] **Step 7: Rodar a bateria do front**

Run: `npm test`
Expected: PASS, incluindo os 6 novos casos.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/triagemAssinatura.ts \
        supabase/functions/_shared/triagemAssinatura.test.ts \
        supabase/functions/assinatura-triagem/index.ts supabase/config.toml
git commit -m "feat(assinatura): triagem do Claudinho com falha fechada"
```

---

### Task 8: O Zé — recado e liberação da exceção

**Files:**
- Create: `supabase/migrations/20261003120000_assinatura_ze_e_vencimento.sql`
- Modify: `supabase/functions/ze-brain/index.ts` (o `Deno.serve` final, ~linha 288)
- Create: `scratchpad/t8-ze.sql`

**Interfaces:**
- Consumes: Task 2 (`assinatura_liberar`), `ze_pending_actions`,
  `ze_resolver_pendencia`, `responder(cfg, texto)` do `ze-brain`
- Produces: tipo `liberar_assinatura` em `ze_pending_actions`;
  `assinatura_pedir_ao_ze(p_id uuid) → uuid` (service_role);
  `certificados_avisar_vencimento() → integer`;
  `modo: 'recado'` no `ze-brain`

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/20261003120000_assinatura_ze_e_vencimento.sql`:

```sql
-- ============================================================================
-- ASSINATURA — o Zé e o vencimento do certificado (03/10/2026)
--
-- O Zé avisa toda assinatura (recado) e autoriza a exceção: documento fora do
-- catálogo ou com "dúvida" na triagem só assina com o "pode" do gestor.
-- ============================================================================

-- ── O CHECK de ze_pending_actions passa a aceitar a liberação ───────────────
ALTER TABLE public.ze_pending_actions DROP CONSTRAINT IF EXISTS ze_pending_actions_tipo_check;
ALTER TABLE public.ze_pending_actions
  ADD CONSTRAINT ze_pending_actions_tipo_check
  CHECK (tipo IN ('mover_etapa', 'liberar_assinatura'));

-- ── O robô abre a pendência para o gestor ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_pedir_ao_ze(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _a public.assinaturas; _pend UUID; _codigo TEXT; _nome TEXT; _arquivo TEXT; _quem TEXT;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.assinaturas WHERE id = p_id AND situacao = 'aguardando_ze';
  IF _a.id IS NULL THEN RETURN NULL; END IF;

  -- não empilha: uma pendência por assinatura
  SELECT id INTO _pend FROM public.ze_pending_actions
   WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
     AND (payload->>'assinatura_id')::uuid = p_id;
  IF _pend IS NOT NULL THEN RETURN _pend; END IF;

  SELECT pr.code INTO _codigo FROM public.projects pr WHERE pr.id = _a.project_id;
  SELECT da.nome INTO _nome FROM public.documentos_assinaveis da WHERE da.id = _a.assinavel_id;
  SELECT d.file_name INTO _arquivo FROM public.documents d WHERE d.id = _a.document_id;
  SELECT p.name INTO _quem FROM public.profiles p WHERE p.id = _a.pedida_por;

  INSERT INTO public.ze_pending_actions (tenant_id, tipo, payload, resumo)
  VALUES (_a.tenant_id, 'liberar_assinatura',
          jsonb_build_object('assinatura_id', p_id, 'project_id', _a.project_id),
          coalesce(_quem, 'Alguém') || ' quer assinar "' || coalesce(_arquivo, 'documento')
            || '" no ' || coalesce(_codigo, 'projeto') || ' como ' || coalesce(_nome, 'documento')
            || '. ' || coalesce(_a.recusa, 'A triagem ficou em dúvida.') || ' Libero?')
  RETURNING id INTO _pend;
  RETURN _pend;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pedir_ao_ze(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_pedir_ao_ze(UUID) TO service_role;

-- ── O "pode" do gestor cai aqui (o mesmo caminho do mover_etapa) ───────────
CREATE OR REPLACE FUNCTION public.ze_resolver_pendencia(
  _id UUID, _confirmar BOOLEAN, _como_usuario UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _p public.ze_pending_actions; _autor UUID; _feito BOOLEAN;
BEGIN
  _autor := coalesce((select auth.uid()), _como_usuario);
  SELECT * INTO _p FROM public.ze_pending_actions WHERE id = _id;
  IF _p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'não encontrada'); END IF;
  IF _p.situacao <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'já estava ' || _p.situacao);
  END IF;
  IF _p.expira_em < now() THEN
    UPDATE public.ze_pending_actions SET situacao = 'expirada', resolvida_em = now() WHERE id = _id;
    -- expirado = recusado: a assinatura não fica pendurada
    IF _p.tipo = 'liberar_assinatura' THEN
      UPDATE public.assinaturas
         SET situacao = 'recusado', recusa = 'O pedido de liberação expirou sem resposta.', updated_at = now()
       WHERE id = (_p.payload->>'assinatura_id')::uuid AND situacao = 'aguardando_ze';
    END IF;
    RETURN jsonb_build_object('ok', false, 'motivo', 'expirou');
  END IF;
  IF (select auth.uid()) IS NOT NULL
     AND public.get_user_tenant_id((select auth.uid())) <> _p.tenant_id THEN
    RAISE EXCEPTION 'pendência de outro tenant' USING ERRCODE = '42501';
  END IF;

  IF NOT _confirmar THEN
    UPDATE public.ze_pending_actions
       SET situacao = 'cancelada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
    IF _p.tipo = 'liberar_assinatura' THEN
      UPDATE public.assinaturas
         SET situacao = 'recusado', recusa = 'O gestor não liberou a assinatura.',
             liberada_por = _autor, updated_at = now()
       WHERE id = (_p.payload->>'assinatura_id')::uuid AND situacao = 'aguardando_ze';
    END IF;
    RETURN jsonb_build_object('ok', true, 'acao', 'cancelada');
  END IF;

  IF _p.tipo = 'mover_etapa' THEN
    _feito := public.ze_mover_etapa(
      _p.tenant_id, (_p.payload->>'project_id')::uuid, _p.payload->>'to_status',
      _autor, _p.payload->>'motivo');
  ELSIF _p.tipo = 'liberar_assinatura' THEN
    _feito := public.assinatura_liberar((_p.payload->>'assinatura_id')::uuid, _autor);
  END IF;

  UPDATE public.ze_pending_actions
     SET situacao = 'confirmada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
  RETURN jsonb_build_object('ok', coalesce(_feito, false), 'acao', 'confirmada');
END;
$$;
GRANT EXECUTE ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;

-- ── Vencimento do certificado: 30, 15, 7 e 1 dia antes ─────────────────────
CREATE OR REPLACE FUNCTION public.certificados_avisar_vencimento()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _c RECORD; _dias INTEGER; _titulo TEXT; _msg TEXT;
BEGIN
  FOR _c IN
    SELECT c.*, (c.validade_fim - current_date) AS faltam
      FROM public.certificados_digitais c
     WHERE c.ativo AND c.validade_fim IS NOT NULL
       AND (c.validade_fim - current_date) IN (30, 15, 7, 1, 0)
  LOOP
    _dias := _c.faltam;
    _titulo := CASE WHEN _dias = 0 THEN 'Certificado digital vence HOJE'
                    ELSE 'Certificado digital vence em ' || _dias || ' dia' || CASE WHEN _dias > 1 THEN 's' ELSE '' END END;
    _msg := 'O certificado de ' || _c.titular_nome || ' vence em '
            || to_char(_c.validade_fim, 'DD/MM/YYYY') || '. Sem ele não dá para assinar documento nenhum.';

    INSERT INTO public.notifications (user_id, title, message, type)
    SELECT p.id, _titulo, _msg, 'warning'
      FROM public.profiles p
     WHERE p.tenant_id = _c.tenant_id AND p.role = 'admin';

    -- e um recado do Zé (texto pronto, sem IA)
    INSERT INTO public.ze_messages (tenant_id, papel, texto, rotina)
    VALUES (_c.tenant_id, 'sistema', _titulo || ' — ' || _msg, 'certificado_vencimento');

    _n := _n + 1;
  END LOOP;

  -- quem passou da validade sai de 'ok' na hora
  UPDATE public.certificados_digitais
     SET situacao = 'vencido', erro = 'Venceu em ' || to_char(validade_fim, 'DD/MM/YYYY') || '.', updated_at = now()
   WHERE ativo AND situacao = 'ok' AND validade_fim IS NOT NULL AND validade_fim < current_date;

  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.certificados_avisar_vencimento() FROM PUBLIC, anon, authenticated;

-- 07:00 em Brasília (10:00 UTC)
SELECT cron.unschedule('certificado-vencimento')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'certificado-vencimento');
SELECT cron.schedule('certificado-vencimento', '0 10 * * *',
  $cron$ SELECT public.certificados_avisar_vencimento(); $cron$);

SELECT 'Zé e vencimento aplicados' AS resultado,
       (SELECT count(*) FROM cron.job WHERE jobname = 'certificado-vencimento') AS job;
```

- [ ] **Step 2: Aplicar**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261003120000_assinatura_ze_e_vencimento.sql`
Expected: `resultado = Zé e vencimento aplicados`, `job = 1`.

- [ ] **Step 3: Acrescentar o `modo: 'recado'` no ze-brain**

Em `supabase/functions/ze-brain/index.ts`, trocar o começo do `Deno.serve`
(hoje: `if (corpo.modo !== 'mensagem') return json({ error: 'modo não suportado nesta entrega' }, 400)`) por:

```typescript
  let corpo: { modo?: string; tenant_id?: string; aguardar?: boolean; texto?: string }
  try { corpo = await req.json() } catch { return json({ error: 'json inválido' }, 400) }
  if (corpo.modo !== 'mensagem' && corpo.modo !== 'recado') {
    return json({ error: 'modo não suportado' }, 400)
  }
  if (!corpo.tenant_id) return json({ error: 'tenant_id obrigatório' }, 400)

  const { data: cfgRaw } = await admin.from('ze_config').select('*').eq('tenant_id', corpo.tenant_id).maybeSingle()
  const cfg = cfgRaw as Config | null
  if (!cfg) return json({ error: 'tenant sem Zé' }, 404)
  if (!cfg.enabled || cfg.situacao !== 'conectado') return json({ ok: true, pulou: 'Zé desligado ou desconectado' })

  // RECADO: texto pronto, direto para o chat "Você". Sem modelo, sem cota, sem
  // trava — é o assinador contando o que fez. Só o robô (service role) pode:
  // um recado é o Zé falando em nome do sistema, não uma mensagem de usuário.
  if (corpo.modo === 'recado') {
    const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const portador = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!servico || portador !== servico) return json({ error: 'recado é só do robô' }, 403)
    const texto = String(corpo.texto ?? '').trim()
    if (!texto) return json({ error: 'texto obrigatório' }, 400)
    try {
      await responder(cfg, texto.slice(0, 1200))
      return json({ ok: true, recado: true })
    } catch (e) {
      console.error('[ze-brain] recado', e)
      return json({ ok: false, error: e instanceof Error ? e.message : 'falhou' }, 502)
    }
  }
```

…mantendo daí em diante o que já existe (a trava `ze_lock` e o `trabalhar(cfg)`).
**Atenção:** a leitura da `cfg` sai do bloco antigo e sobe para antes do
recado — conferir que não ficou duplicada.

- [ ] **Step 4: Ligar o worker à pendência do Zé**

Sem isto a assinatura cai em `aguardando_ze` e ninguém é avisado.

Em `worker/assinador/src/fila.ts`, acrescentar:

```typescript
/** Abre a pendência no WhatsApp do gestor ("libero?"). */
export async function pedirAoZe(id: string): Promise<void> {
  const { error } = await supabase().rpc('assinatura_pedir_ao_ze', { p_id: id });
  if (error) throw new Error(`Não consegui pedir a liberação ao Zé: ${error.message}`);
}
```

Em `worker/assinador/src/index.ts`, no import de `./fila.js`, incluir
`pedirAoZe`, e na função `peneirar` trocar os dois pontos que gravam
`aguardando_ze` para pedir a liberação em seguida:

```typescript
  // Acima de 10 MB não vai para a IA: decide o gestor.
  if (pdf.length > 10 * 1024 * 1024) {
    await passo(t.id, 'aguardando_ze', { recusa: 'Arquivo grande demais para a triagem automática.' });
    await pedirAoZe(t.id);
    log('triagem pulada pelo tamanho', { assinatura: t.id, bytes: pdf.length });
    return;
  }
```

```typescript
  } else {
    await passo(t.id, 'aguardando_ze', { recusa: motivo });
    await pedirAoZe(t.id);
    log('triagem em dúvida — foi para o gestor', { assinatura: t.id, motivo });
  }
```

E, no fim do mesmo bloco, o recado que conta o barrado — o gestor fica sabendo
do que foi recusado sem precisar abrir a tela:

```typescript
  } else if (veredito === 'nao_projeto') {
    await passo(t.id, 'recusado', { recusa: motivo || 'Não tem cunho de projeto.' });
    await recadoDoZe(t.tenant_id, `Barrei uma assinatura: ${motivo || 'o documento não tem cunho de projeto'}.`);
    log('triagem barrou', { assinatura: t.id, motivo });
  }
```

Run: `cd worker/assinador && npm run build && npm test`
Expected: compila e os testes continuam passando.

- [ ] **Step 5: Escrever a prova do caminho do Zé**

`scratchpad/t8-ze.sql`:

```sql
begin;
create temp table achados (prova text, resultado text) on commit drop;

-- cena: uma assinatura em aguardando_ze
create temp table cena as
  select t.id as tenant, p.id as projeto,
         (select pf.id from public.profiles pf where pf.tenant_id = t.id and pf.role = 'admin' limit 1) as admin_id
    from public.tenants t join public.projects p on p.tenant_id = t.id and not p.is_deleted
   where t.is_library limit 1;

insert into public.assinaturas (tenant_id, project_id, situacao, recusa, pedida_por)
select tenant, projeto, 'aguardando_ze', 'A triagem ficou em dúvida.', admin_id from cena;

-- o robô abre a pendência
set local role service_role;
do $$
declare _a uuid; _p uuid;
begin
  select id into _a from public.assinaturas where situacao = 'aguardando_ze' order by created_at desc limit 1;
  _p := public.assinatura_pedir_ao_ze(_a);
  insert into achados values ('pendência aberta', case when _p is null then 'FALHOU' else 'ok' end);
  -- não empilha
  insert into achados select 'não empilha',
    case when public.assinatura_pedir_ao_ze(_a) = _p then 'ok: devolveu a mesma' else 'FALHOU: criou outra' end;
end $$;
reset role;

-- o "pode" do gestor
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id::text from cena), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare _p uuid; _r jsonb;
begin
  select id into _p from public.ze_pending_actions where tipo = 'liberar_assinatura' and situacao = 'pendente' limit 1;
  _r := public.ze_resolver_pendencia(_p, true);
  insert into achados values ('pode → libera', case when (_r->>'ok')::boolean then 'ok' else 'FALHOU: ' || _r::text end);
end $$;
reset role;
insert into achados select 'assinatura virou pendente',
  case when situacao = 'pendente' and liberada_por is not null then 'ok' else 'FALHOU: ' || situacao end
  from public.assinaturas order by created_at desc limit 1;

select * from achados;
rollback;
```

- [ ] **Step 6: Rodar**

Run: `npx -y supabase db query --linked -f <scratchpad>/t8-ze.sql`
Expected: quatro linhas `ok`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261003120000_assinatura_ze_e_vencimento.sql supabase/functions/ze-brain/index.ts
git commit -m "feat(assinatura): Ze avisa e autoriza excecao; aviso de vencimento do certificado"
```

---

### Task 9: A porta da assinatura — RPC, coluna protegida e a aba no modal

**Files:**
- Create: `supabase/migrations/20261003130000_documento_para_assinar.sql`
- Create: `src/hooks/useAssinaturas.ts`
- Create: `src/components/projects/TabAssinaturas.tsx`
- Modify: `src/components/projects/ProjectModal.tsx` (import, `TABS` ~2192, render da aba)
- Create: `scratchpad/t9-coluna.sql`

**Interfaces:**
- Consumes: Tasks 1-2 (catálogo, `assinatura_pedir`, `assinatura_aprovar`,
  `assinatura_recusar`, `assinatura_registro`), `useAuth`, `useTenant`
- Produces: RPC
  `documento_para_assinar(p_project_id uuid, p_assinavel_id uuid, p_path text, p_name text, p_type text) → uuid`;
  hooks `useAssinaturaDisponivel()`, `useCatalogoAssinavel()`,
  `useAssinaturasDoProjeto(projectId)`, `usePedirAssinatura()`,
  `useAprovarAssinatura()`, `useRecusarAssinatura()`, `useRegistroAssinaturas()`,
  `useCertificadoAtivo()`, `useUrlDoArquivo(path)`;
  componente `TabAssinaturas`

> **O furo que esta task fecha.** `assinatura_pedir` confia em
> `documents.assinavel_id`. Se a tela pudesse gravar essa coluna num insert
> comum, qualquer anexo — contrato social inclusive — ganharia a marca e a
> tranca não valeria nada. Privilégio por coluna resolve: `authenticated`
> passa a ter INSERT/UPDATE em todas as colunas de `documents` **menos**
> `assinavel_id`, que só a RPC escreve.

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/20261003130000_documento_para_assinar.sql`:

```sql
-- ============================================================================
-- ASSINATURA — a porta de entrada do documento assinável (03/10/2026)
--
-- `documents.assinavel_id` é a tranca. Para ela valer, a tela NÃO pode
-- escrevê-la: privilégio por coluna tira essa possibilidade e deixa só a RPC
-- `documento_para_assinar`, que confere equipe, tenant, projeto e catálogo.
-- ============================================================================

-- Privilégio por coluna: tudo menos assinavel_id.
-- (as colunas de `documents` em 03/10/2026: id, project_id, document_type,
--  file_name, file_url, file_type, uploaded_by, created_at, assinavel_id)
REVOKE INSERT, UPDATE ON public.documents FROM authenticated, anon;
GRANT INSERT (id, project_id, document_type, file_name, file_url, file_type, uploaded_by, created_at)
  ON public.documents TO authenticated;
GRANT UPDATE (document_type, file_name, file_url, file_type)
  ON public.documents TO authenticated;
-- o formulário público (anon) insere anexo do projeto; segue sem assinavel_id
GRANT INSERT (id, project_id, document_type, file_name, file_url, file_type, created_at)
  ON public.documents TO anon;

/**
 * Registra um documento que entrou PELO FLUXO DE ASSINATURA. O arquivo já está
 * no bucket `project-documents` (subido pela sessão da pessoa); aqui a linha
 * nasce com a marca do tipo do catálogo.
 */
CREATE OR REPLACE FUNCTION public.documento_para_assinar(
  p_project_id UUID, p_assinavel_id UUID, p_path TEXT, p_name TEXT, p_type TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _tenant UUID; _doc UUID; _origem TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  IF NOT EXISTS (SELECT 1 FROM public.projects pr
                  WHERE pr.id = p_project_id AND pr.tenant_id = _tenant AND NOT pr.is_deleted) THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;

  SELECT origem INTO _origem FROM public.documentos_assinaveis
   WHERE id = p_assinavel_id AND tenant_id = _tenant AND ativo;
  IF _origem IS NULL THEN RAISE EXCEPTION 'Tipo de documento não liberado para assinatura.'; END IF;
  IF _origem = 'gerado' THEN
    RAISE EXCEPTION 'Este tipo só aceita documento gerado pelo sistema — não dá para enviar arquivo.';
  END IF;
  IF coalesce(trim(p_path), '') = '' OR coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Arquivo sem caminho ou sem nome.';
  END IF;

  INSERT INTO public.documents
    (project_id, document_type, file_name, file_url, file_type, uploaded_by, assinavel_id)
  VALUES (p_project_id, 'extra_attachment', left(trim(p_name), 200), p_path, p_type, _uid, p_assinavel_id)
  RETURNING id INTO _doc;
  RETURN _doc;
END;
$$;
REVOKE ALL ON FUNCTION public.documento_para_assinar(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documento_para_assinar(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

/**
 * Marca um documento JÁ EXISTENTE como assinável — o caminho do que o Bidu
 * gerou (formulário da CEMIG, memorial). Só vale para documento do projeto e
 * tipo cuja origem aceita 'gerado'.
 */
CREATE OR REPLACE FUNCTION public.documento_marcar_assinavel(p_document_id UUID, p_assinavel_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _tenant UUID; _origem TEXT; _n INT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  SELECT origem INTO _origem FROM public.documentos_assinaveis
   WHERE id = p_assinavel_id AND tenant_id = _tenant AND ativo;
  IF _origem IS NULL THEN RAISE EXCEPTION 'Tipo de documento não liberado para assinatura.'; END IF;
  IF _origem = 'enviado' THEN
    RAISE EXCEPTION 'Este tipo só aceita arquivo enviado pelo fluxo de assinatura.';
  END IF;

  UPDATE public.documents d
     SET assinavel_id = p_assinavel_id
   WHERE d.id = p_document_id
     AND EXISTS (SELECT 1 FROM public.projects pr
                  WHERE pr.id = d.project_id AND pr.tenant_id = _tenant AND NOT pr.is_deleted);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.documento_marcar_assinavel(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documento_marcar_assinavel(UUID, UUID) TO authenticated;

SELECT 'porta da assinatura aplicada' AS resultado;
```

- [ ] **Step 2: Aplicar e provar que a coluna está trancada**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261003130000_documento_para_assinar.sql`
Expected: `resultado = porta da assinatura aplicada`.

`scratchpad/t9-coluna.sql`:

```sql
begin;
create temp table achados (prova text, resultado text) on commit drop;
grant all on achados to authenticated;

create temp table cena as
  select t.id as tenant, p.id as projeto,
         (select pf.id from public.profiles pf where pf.tenant_id = t.id and pf.role in ('admin','staff') limit 1) as pessoa,
         (select d.id from public.documents d where d.project_id = p.id limit 1) as doc,
         (select da.id from public.documentos_assinaveis da where da.tenant_id = t.id and da.codigo = 'memorial_descritivo') as tipo
    from public.tenants t join public.projects p on p.tenant_id = t.id and not p.is_deleted
   where t.is_library limit 1;
grant all on cena to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', (select pessoa::text from cena), 'role', 'authenticated')::text, true);
set local role authenticated;

-- A pessoa NÃO escreve assinavel_id na mão
do $$
begin
  update public.documents set assinavel_id = (select tipo from cena) where id = (select doc from cena);
  insert into achados values ('update direto em assinavel_id', 'FALHOU: a tela conseguiu marcar');
exception when insufficient_privilege then
  insert into achados values ('update direto em assinavel_id', 'ok: privilégio negado');
end $$;

-- …nem num insert
do $$
begin
  insert into public.documents (project_id, document_type, file_name, file_url, assinavel_id)
  values ((select projeto from cena), 'extra_attachment', 'x.pdf', 'x/x.pdf', (select tipo from cena));
  insert into achados values ('insert com assinavel_id', 'FALHOU: a tela conseguiu');
exception when insufficient_privilege then
  insert into achados values ('insert com assinavel_id', 'ok: privilégio negado');
end $$;

-- mas o anexo comum continua funcionando (não quebrei o fluxo de hoje)
do $$
begin
  insert into public.documents (project_id, document_type, file_name, file_url)
  values ((select projeto from cena), 'other_photos', 'foto.jpg', 'x/foto.jpg');
  insert into achados values ('anexo comum', 'ok: continua entrando');
exception when others then
  insert into achados values ('anexo comum', 'FALHOU: ' || SQLERRM);
end $$;

reset role;
select * from achados;
rollback;
```

Run: `npx -y supabase db query --linked -f <scratchpad>/t9-coluna.sql`
Expected: três linhas `ok`.

- [ ] **Step 3: Escrever os hooks**

`src/hooks/useAssinaturas.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import { toast } from 'sonner';
import { sanitizeFileName, validateFile } from '@/lib/utils';

/**
 * ASSINATURA DIGITAL — o que a tela precisa.
 *
 * A senha do certificado nunca passa por aqui de volta: vai por RPC para o
 * Vault e só o robô, na VPS, consegue lê-la. E `assinavel_id` só é gravado por
 * RPC — a tela não tem privilégio nessa coluna (é a tranca).
 *
 * Restrito ao tenant GD Manager (`is_library`), como o Bidu e a Ludmilla.
 */

export type SituacaoAssinatura =
  | 'preparando' | 'conferir' | 'triagem' | 'aguardando_ze'
  | 'pendente' | 'assinando' | 'assinado' | 'recusado' | 'erro';

export interface TipoAssinavel {
  id: string;
  codigo: string;
  nome: string;
  origem: 'gerado' | 'enviado' | 'ambos';
  exige_triagem: boolean;
  ativo: boolean;
}

export interface Assinatura {
  id: string;
  project_id: string;
  document_id: string | null;
  assinavel_id: string | null;
  situacao: SituacaoAssinatura;
  titular_nome: string | null;
  motivo: string | null;
  recusa: string | null;
  erro: string | null;
  codigo_verificacao: string;
  documento_aprovado_path: string | null;
  documento_assinado_id: string | null;
  pedida_em: string;
  created_at: string;
}

export interface Certificado {
  id: string;
  titular_nome: string;
  titular_cpf: string;
  emissor: string | null;
  serial: string | null;
  validade_inicio: string | null;
  validade_fim: string | null;
  situacao: 'conferindo' | 'ok' | 'invalido' | 'vencido';
  erro: string | null;
  ativo: boolean;
}

export interface LinhaRegistro {
  id: string;
  project_id: string;
  codigo_projeto: string;
  titular_projeto: string;
  tipo: string;
  situacao: SituacaoAssinatura;
  titular_nome: string | null;
  serial: string | null;
  pedida_por_nome: string;
  pedida_em: string;
  liberada_por_nome: string | null;
  codigo_verificacao: string;
  recusa: string | null;
  erro: string | null;
  documento_aprovado_path: string | null;
  assinado_path: string | null;
  assinado_nome: string | null;
}

/** Mesmo recorte do Bidu: admin/staff do tenant biblioteca. */
export function useAssinaturaDisponivel(): boolean {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  if (!user) return false;
  return (user.role === 'admin' || user.role === 'staff') && !!tenant?.is_library;
}

export function useCatalogoAssinavel() {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['catalogo-assinavel'],
    queryFn: async (): Promise<TipoAssinavel[]> => {
      const { data, error } = await supabase
        .from('documentos_assinaveis' as never)
        .select('*')
        .eq('ativo', true)
        .order('nome');
      if (error) throw error;
      return (data ?? []) as TipoAssinavel[];
    },
    enabled: disponivel,
  });
}

export function useCertificadoAtivo() {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['certificado-ativo'],
    queryFn: async (): Promise<Certificado | null> => {
      const { data, error } = await supabase
        .from('certificados_digitais' as never)
        .select('*')
        .eq('ativo', true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Certificado | null;
    },
    enabled: disponivel,
    // enquanto está "conferindo", o worker ainda vai responder
    refetchInterval: q => ((q.state.data as Certificado | null)?.situacao === 'conferindo' ? 4_000 : false),
  });
}

export function useAssinaturasDoProjeto(projectId: string | undefined) {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['assinaturas', projectId],
    queryFn: async (): Promise<Assinatura[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('assinaturas' as never)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Assinatura[];
    },
    enabled: disponivel && !!projectId,
    // o worker trabalha em segundo plano: a tela acompanha
    refetchInterval: q =>
      ((q.state.data as Assinatura[] | undefined) ?? []).some(a =>
        ['preparando', 'triagem', 'pendente', 'assinando'].includes(a.situacao))
        ? 4_000 : false,
  });
}

export function useRegistroAssinaturas(limite = 100) {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['registro-assinaturas', limite],
    queryFn: async (): Promise<LinhaRegistro[]> => {
      const { data, error } = await supabase.rpc('assinatura_registro' as never, { p_limite: limite });
      if (error) throw error;
      return (data ?? []) as LinhaRegistro[];
    },
    enabled: disponivel,
    refetchInterval: 15_000,
  });
}

/** URL assinada de 5 min para abrir o PDF (preparado ou assinado). */
export async function urlDoArquivo(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(path, 300);
  if (error) return null;
  return data.signedUrl;
}

/**
 * Pedir assinatura. Dois caminhos:
 *  - `file`: sobe o arquivo e registra com a marca (RPC documento_para_assinar);
 *  - `documentId`: documento já no projeto (gerado) — marca e pede.
 */
export function usePedirAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      projectId: string; assinavelId: string; motivo?: string;
      file?: File; documentId?: string;
    }) => {
      let documentId = p.documentId;

      if (p.file) {
        const erro = validateFile(p.file);
        if (erro) throw new Error(erro);
        const nome = sanitizeFileName(p.file.name);
        const path = `${p.projectId}/assinatura/${Date.now()}_${nome}`;
        const { error: errUp } = await supabase.storage
          .from('project-documents').upload(path, p.file);
        if (errUp) throw errUp;

        const { data, error } = await supabase.rpc('documento_para_assinar' as never, {
          p_project_id: p.projectId, p_assinavel_id: p.assinavelId,
          p_path: path, p_name: nome, p_type: p.file.type || 'application/octet-stream',
        });
        if (error) throw error;
        documentId = data as unknown as string;
      } else if (documentId) {
        const { error } = await supabase.rpc('documento_marcar_assinavel' as never, {
          p_document_id: documentId, p_assinavel_id: p.assinavelId,
        });
        if (error) throw error;
      } else {
        throw new Error('Escolha um arquivo ou um documento do projeto.');
      }

      const { data, error } = await supabase.rpc('assinatura_pedir' as never, {
        p_project_id: p.projectId, p_document_id: documentId,
        p_assinavel_id: p.assinavelId, p_motivo: p.motivo ?? null,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (_, p) => {
      qc.invalidateQueries({ queryKey: ['assinaturas', p.projectId] });
      qc.invalidateQueries({ queryKey: ['documents', p.projectId] });
      qc.invalidateQueries({ queryKey: ['registro-assinaturas'] });
      toast.success('Pedido enviado — vou preparar o PDF para você conferir.');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui pedir a assinatura'),
  });
}

export function useAprovarAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; projectId?: string }) => {
      const { data, error } = await supabase.rpc('assinatura_aprovar' as never, { p_id: id });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (proxima, p) => {
      qc.invalidateQueries({ queryKey: ['assinaturas', p.projectId] });
      qc.invalidateQueries({ queryKey: ['registro-assinaturas'] });
      toast.success(proxima === 'triagem'
        ? 'Conferido. O Claudinho vai dar uma olhada antes de assinar.'
        : 'Conferido. Assinando…');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui aprovar'),
  });
}

export function useRecusarAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo?: string; projectId?: string }) => {
      const { error } = await supabase.rpc('assinatura_recusar' as never, { p_id: id, p_motivo: motivo ?? null });
      if (error) throw error;
    },
    onSuccess: (_, p) => {
      qc.invalidateQueries({ queryKey: ['assinaturas', p.projectId] });
      qc.invalidateQueries({ queryKey: ['registro-assinaturas'] });
      toast.success('Pedido cancelado');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui cancelar'),
  });
}
```

- [ ] **Step 4: Conferir os tipos**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -5`
Expected: continua em **65** erros (os de sempre). Se subiu, corrigir antes de
seguir; se despencou, é falha de parse.

- [ ] **Step 5: Escrever a aba**

`src/components/projects/TabAssinaturas.tsx`:

```tsx
import { useRef, useState } from 'react';
import { FileSignature, Loader2, ShieldCheck, ShieldAlert, Clock, Eye, Check, X, Upload } from 'lucide-react';
import { format } from 'date-fns';
import {
  Assinatura, SituacaoAssinatura, useAprovarAssinatura, useAssinaturasDoProjeto,
  useCatalogoAssinavel, useCertificadoAtivo, usePedirAssinatura, useRecusarAssinatura, urlDoArquivo,
} from '@/hooks/useAssinaturas';

/**
 * ASSINATURAS DO PROJETO.
 *
 * O botão só aparece com certificado conferido. O arquivo escolhido aqui entra
 * com a marca do tipo (RPC): é isto, e só isto, que torna um documento
 * assinável — anexo da aba de Documentos não ganha botão.
 */

const ROTULO: Record<SituacaoAssinatura, { texto: string; cor: string; fundo: string }> = {
  preparando:    { texto: 'Preparando o PDF…',        cor: '#8A5300', fundo: '#FEF3D0' },
  conferir:      { texto: 'Confira antes de assinar', cor: '#185FA5', fundo: '#E3F0FB' },
  triagem:       { texto: 'Em triagem',               cor: '#8A5300', fundo: '#FEF3D0' },
  aguardando_ze: { texto: 'Esperando liberação',      cor: '#7C3AED', fundo: '#F3E8FF' },
  pendente:      { texto: 'Na fila para assinar',     cor: '#8A5300', fundo: '#FEF3D0' },
  assinando:     { texto: 'Assinando…',               cor: '#8A5300', fundo: '#FEF3D0' },
  assinado:      { texto: 'Assinado',                 cor: '#1B7F4C', fundo: '#E6F6EC' },
  recusado:      { texto: 'Recusado',                 cor: '#B3261E', fundo: '#FDECEA' },
  erro:          { texto: 'Deu erro',                 cor: '#B3261E', fundo: '#FDECEA' },
};

async function abrir(path: string | null) {
  if (!path) return;
  const url = await urlDoArquivo(path);
  if (url) window.open(url, '_blank', 'noopener');
}

function Linha({ a, projectId }: { a: Assinatura; projectId: string }) {
  const aprovar = useAprovarAssinatura();
  const recusar = useRecusarAssinatura();
  const r = ROTULO[a.situacao];

  return (
    <div style={{ border: '1px solid #F0F0F0', borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: r.cor, background: r.fundo }}>
          {r.texto}
        </span>
        <span style={{ fontSize: 11, color: '#999', fontFamily: 'ui-monospace, monospace' }}>
          {a.codigo_verificacao}
        </span>
        <span style={{ fontSize: 11, color: '#999', marginLeft: 'auto' }}>
          {format(new Date(a.pedida_em), 'dd/MM/yyyy HH:mm')}
        </span>
      </div>

      {a.titular_nome && (
        <p style={{ fontSize: 12, color: '#666', marginTop: 6 }}>e-CPF de {a.titular_nome}</p>
      )}
      {a.motivo && <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{a.motivo}</p>}
      {a.recusa && <p style={{ fontSize: 12, color: '#B3261E', marginTop: 4 }}>{a.recusa}</p>}
      {a.erro && <p style={{ fontSize: 12, color: '#B3261E', marginTop: 4 }}>{a.erro}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {a.documento_aprovado_path && (
          <button onClick={() => abrir(a.documento_aprovado_path)} style={botaoClaro}>
            <Eye size={13} /> Ver o PDF
          </button>
        )}
        {a.situacao === 'conferir' && (
          <>
            <button
              onClick={() => aprovar.mutate({ id: a.id, projectId })}
              disabled={aprovar.isPending}
              style={botaoForte}
            >
              {aprovar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Está certo, assine
            </button>
            <button onClick={() => recusar.mutate({ id: a.id, projectId })} disabled={recusar.isPending} style={botaoClaro}>
              <X size={13} /> Cancelar
            </button>
          </>
        )}
        {['triagem', 'pendente', 'aguardando_ze', 'erro'].includes(a.situacao) && (
          <button onClick={() => recusar.mutate({ id: a.id, projectId })} disabled={recusar.isPending} style={botaoClaro}>
            <X size={13} /> Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

const botaoClaro: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 7,
  border: '1px solid #E0E0E0', background: '#fff', color: '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const botaoForte: React.CSSProperties = {
  ...botaoClaro, border: 'none', background: '#F5A800', color: '#1A1A1A',
};

export function TabAssinaturas({ projectId }: { projectId: string }) {
  const { data: assinaturas = [], isLoading } = useAssinaturasDoProjeto(projectId);
  const { data: catalogo = [] } = useCatalogoAssinavel();
  const { data: certificado } = useCertificadoAtivo();
  const pedir = usePedirAssinatura();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState('');
  const [motivo, setMotivo] = useState('');

  const podeAssinar = certificado?.situacao === 'ok';
  const tiposQueAceitamArquivo = catalogo.filter(t => t.origem !== 'gerado');

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tipo) return;
    await pedir.mutateAsync({ projectId, assinavelId: tipo, motivo: motivo.trim() || undefined, file });
    e.target.value = '';
    setMotivo('');
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {/* estado do certificado */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 9, marginBottom: 14,
        background: podeAssinar ? '#E6F6EC' : '#FDECEA',
      }}>
        {podeAssinar ? <ShieldCheck size={16} color="#1B7F4C" /> : <ShieldAlert size={16} color="#B3261E" />}
        <span style={{ fontSize: 12, color: podeAssinar ? '#1B7F4C' : '#B3261E' }}>
          {!certificado
            ? 'Nenhum certificado cadastrado — o admin cadastra em Assinaturas.'
            : certificado.situacao === 'conferindo'
              ? 'Conferindo o certificado…'
              : podeAssinar
                ? `Certificado de ${certificado.titular_nome}${certificado.validade_fim ? ` · vence em ${format(new Date(certificado.validade_fim), 'dd/MM/yyyy')}` : ''}`
                : `Certificado ${certificado.situacao}${certificado.erro ? ` — ${certificado.erro}` : ''}`}
        </span>
      </div>

      {/* pedir */}
      {podeAssinar && (
        <div style={{ border: '1px dashed #E0E0E0', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>Assinar documento</p>
          <select
            value={tipo} onChange={e => setTipo(e.target.value)}
            style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 12, marginBottom: 8 }}
          >
            <option value="">Que documento é este?</option>
            {tiposQueAceitamArquivo.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          <input
            value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Para que é a assinatura? (opcional)"
            style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 12, marginBottom: 8 }}
          />
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.docx,.doc" style={{ display: 'none' }} onChange={escolher} />
          <button onClick={() => fileRef.current?.click()} disabled={!tipo || pedir.isPending} style={{ ...botaoForte, opacity: tipo ? 1 : 0.5 }}>
            {pedir.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Escolher o arquivo
          </button>
          <p style={{ fontSize: 10.5, color: '#999', marginTop: 8 }}>
            Só documento de projeto. Contrato, proposta e documento pessoal não entram aqui.
          </p>
        </div>
      )}

      {/* o que já houve */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Loader2 size={18} className="animate-spin" color="#F5A800" /></div>
      ) : assinaturas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
          <FileSignature size={32} color="#E0E0E0" />
          <p style={{ fontSize: 12, marginTop: 8 }}>Nenhuma assinatura neste projeto</p>
        </div>
      ) : (
        assinaturas.map(a => <Linha key={a.id} a={a} projectId={projectId} />)
      )}
    </div>
  );
}
```

- [ ] **Step 6: Ligar a aba no modal**

Em `src/components/projects/ProjectModal.tsx`:

1. no bloco de imports, acrescentar:

```tsx
import { TabAssinaturas } from './TabAssinaturas';
import { useAssinaturaDisponivel } from '@/hooks/useAssinaturas';
```

2. junto de `const temBidu = useBiduDisponivel();` (~linha 2098):

```tsx
  // Assinatura digital: mesmo recorte do Bidu (admin/staff do tenant biblioteca)
  const temAssinatura = useAssinaturaDisponivel() && !viewAsCompany;
```

3. no array `TABS` (~linha 2213), depois da entrada do Bidu:

```tsx
    ...(temAssinatura ? [{ id: 'assinaturas', label: isMobile ? 'Assin.' : 'Assinaturas', icon: <FileSignature size={13} style={{ marginRight: 5 }} /> }] : []),
```

4. no `import` de `lucide-react` do arquivo, incluir `FileSignature`.

5. onde as abas são renderizadas (o mesmo lugar em que aparece
   `activeTab === 'bidu'`), acrescentar:

```tsx
          {activeTab === 'assinaturas' && temAssinatura && project && (
            <TabAssinaturas projectId={project.id} />
          )}
```

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -3 && npm run build 2>&1 | tail -5`
Expected: 65 erros (o baseline) e build concluído.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261003130000_documento_para_assinar.sql \
        src/hooks/useAssinaturas.ts src/components/projects/TabAssinaturas.tsx \
        src/components/projects/ProjectModal.tsx
git commit -m "feat(assinatura): porta de entrada trancada por privilegio de coluna e aba no modal"
```

---

### Task 10: A página `/assinaturas`

**Files:**
- Modify: `src/hooks/useAssinaturas.ts` (acrescentar `useCadastrarCertificado`)
- Create: `src/pages/Assinaturas.tsx`
- Modify: `src/App.tsx` (import + rota)
- Modify: `src/components/layout/MainLayout.tsx` ou o arquivo do menu lateral
  (acrescentar o item, no mesmo recorte de `/ludmilla`)

**Interfaces:**
- Consumes: Task 9 (hooks), Task 1 (`certificado_cadastrar`), Task 2
  (`assinatura_registro`, `assinatura_liberar`)
- Produces: `useCadastrarCertificado()`, `useLiberarAssinatura()`;
  rota `/assinaturas` para `admin` + `staff`

- [ ] **Step 1: Acrescentar os dois hooks que faltam**

No fim de `src/hooks/useAssinaturas.ts`:

```typescript
/**
 * Cadastra o certificado A1. A senha vai do campo direto para a RPC, que a
 * grava no Vault — não fica em estado global, não vai para log nenhum, e
 * nenhuma RPC a devolve para o navegador.
 */
export function useCadastrarCertificado() {
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  return useMutation({
    mutationFn: async (p: { file: File; senha: string; titularNome: string; titularCpf: string }) => {
      if (!tenant?.id) throw new Error('Sem tenant.');
      if (!/\.(pfx|p12)$/i.test(p.file.name)) throw new Error('O certificado A1 é um arquivo .pfx ou .p12.');
      if (p.file.size > 5 * 1024 * 1024) throw new Error('Arquivo grande demais para ser um certificado.');
      if (!p.senha) throw new Error('Sem a senha do certificado não dá para usá-lo.');

      const path = `${tenant.id}/${Date.now()}_certificado.pfx`;
      const { error: errUp } = await supabase.storage
        .from('certificados')
        .upload(path, p.file, { contentType: 'application/x-pkcs12' });
      if (errUp) throw errUp;

      const { data, error } = await supabase.rpc('certificado_cadastrar' as never, {
        p_path: path, p_senha: p.senha,
        p_titular_nome: p.titularNome, p_titular_cpf: p.titularCpf,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certificado-ativo'] });
      toast.success('Certificado guardado. Estou conferindo o arquivo…');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui cadastrar o certificado'),
  });
}

/** O "pode" do gestor pela tela (o mesmo que ele responde no WhatsApp). */
export function useLiberarAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('assinatura_liberar' as never, { p_id: id, p_autor: null });
      if (error) throw error;
      return data as unknown as boolean;
    },
    onSuccess: ok => {
      qc.invalidateQueries({ queryKey: ['registro-assinaturas'] });
      toast[ok ? 'success' : 'error'](ok ? 'Liberado — vou assinar.' : 'O pedido já não estava esperando.');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui liberar'),
  });
}
```

- [ ] **Step 2: Escrever a página**

`src/pages/Assinaturas.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import {
  FileSignature, ShieldCheck, ShieldAlert, Loader2, Upload, ExternalLink, Eye, Check, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  LinhaRegistro, SituacaoAssinatura, urlDoArquivo, useAprovarAssinatura, useCadastrarCertificado,
  useCertificadoAtivo, useAssinaturaDisponivel, useLiberarAssinatura, useRecusarAssinatura,
  useRegistroAssinaturas,
} from '@/hooks/useAssinaturas';

/**
 * ASSINATURAS — o certificado e o extrato.
 *
 * Mora aqui, e não em /painel: o /painel é o console do MASTER da plataforma,
 * e quem cadastra o certificado é o admin do tenant. Mesmo recorte de
 * /ludmilla (admin + staff); o cartão do certificado só o admin vê.
 */

const ROTULO: Record<SituacaoAssinatura, { texto: string; cor: string; fundo: string }> = {
  preparando:    { texto: 'Preparando',        cor: '#8A5300', fundo: '#FEF3D0' },
  conferir:      { texto: 'Esperando conferência', cor: '#185FA5', fundo: '#E3F0FB' },
  triagem:       { texto: 'Em triagem',        cor: '#8A5300', fundo: '#FEF3D0' },
  aguardando_ze: { texto: 'Esperando você',    cor: '#7C3AED', fundo: '#F3E8FF' },
  pendente:      { texto: 'Na fila',           cor: '#8A5300', fundo: '#FEF3D0' },
  assinando:     { texto: 'Assinando',         cor: '#8A5300', fundo: '#FEF3D0' },
  assinado:      { texto: 'Assinado',          cor: '#1B7F4C', fundo: '#E6F6EC' },
  recusado:      { texto: 'Recusado',          cor: '#B3261E', fundo: '#FDECEA' },
  erro:          { texto: 'Erro',              cor: '#B3261E', fundo: '#FDECEA' },
};

const abrir = async (path: string | null) => {
  if (!path) return;
  const url = await urlDoArquivo(path);
  if (url) window.open(url, '_blank', 'noopener');
};

/** Cadastro e estado do certificado — só o admin. */
function CartaoCertificado() {
  const { data: c } = useCertificadoAtivo();
  const cadastrar = useCadastrarCertificado();
  const fileRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [abrindo, setAbrindo] = useState(false);

  const enviar = async () => {
    if (!arquivo) return;
    await cadastrar.mutateAsync({ file: arquivo, senha, titularNome: nome, titularCpf: cpf });
    // a senha não fica em memória um segundo além do necessário
    setSenha(''); setArquivo(null); setNome(''); setCpf(''); setAbrindo(false);
  };

  const dias = c?.validade_fim
    ? Math.ceil((new Date(c.validade_fim).getTime() - Date.now()) / 864e5)
    : null;

  return (
    <div className="rounded-xl border bg-card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        {c?.situacao === 'ok' ? <ShieldCheck className="w-5 h-5 text-emerald-600" /> : <ShieldAlert className="w-5 h-5 text-amber-600" />}
        <span className="font-semibold">Certificado digital (A1)</span>
        {dias !== null && c?.situacao === 'ok' && (
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${dias <= 30 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
            {dias <= 0 ? 'vencido' : `vence em ${dias} dia${dias > 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {c ? (
        <div className="text-sm space-y-1">
          <p><span className="text-muted-foreground">Titular:</span> {c.titular_nome}</p>
          <p><span className="text-muted-foreground">CPF:</span> ***.***.{c.titular_cpf.slice(6, 9)}-{c.titular_cpf.slice(9, 11)}</p>
          {c.emissor && <p><span className="text-muted-foreground">Emissor:</span> {c.emissor}</p>}
          {c.serial && <p className="font-mono text-xs"><span className="text-muted-foreground font-sans">Série:</span> {c.serial}</p>}
          {c.validade_fim && <p><span className="text-muted-foreground">Validade:</span> {format(new Date(c.validade_fim), 'dd/MM/yyyy')}</p>}
          <p>
            <span className="text-muted-foreground">Situação:</span>{' '}
            {c.situacao === 'conferindo' ? 'conferindo o arquivo…' : c.situacao}
            {c.erro && <span className="text-red-600"> — {c.erro}</span>}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum certificado cadastrado. Sem ele, ninguém assina.</p>
      )}

      {!abrindo ? (
        <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setAbrindo(true)}>
          <Upload className="w-4 h-4" /> {c ? 'Trocar certificado' : 'Cadastrar certificado'}
        </Button>
      ) : (
        <div className="mt-4 space-y-2 border-t pt-4">
          <input
            ref={fileRef} type="file" accept=".pfx,.p12" className="hidden"
            onChange={e => setArquivo(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> {arquivo ? arquivo.name : 'Escolher o .pfx'}
          </Button>
          <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do engenheiro responsável" />
          <Input value={cpf} onChange={e => setCpf(e.target.value)} placeholder="CPF do titular (só números)" inputMode="numeric" />
          <Input
            type="password" value={senha} onChange={e => setSenha(e.target.value)}
            placeholder="Senha do certificado" autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            A senha vai direto para o cofre do banco. Ninguém — nem você, depois — consegue
            lê-la de volta pela tela; só o assinador na VPS a usa, na hora de assinar.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={enviar} disabled={!arquivo || !senha || !nome || !cpf || cadastrar.isPending} className="gap-2">
              {cadastrar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAbrindo(false); setSenha(''); }}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Linha({ l }: { l: LinhaRegistro }) {
  const navigate = useNavigate();
  const liberar = useLiberarAssinatura();
  const aprovar = useAprovarAssinatura();
  const recusar = useRecusarAssinatura();
  const r = ROTULO[l.situacao];

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="font-semibold hover:underline inline-flex items-center gap-1" onClick={() => navigate(`/project/${l.project_id}`)}>
          {l.codigo_projeto} <ExternalLink size={12} />
        </button>
        <span className="text-sm text-muted-foreground truncate">{l.titular_projeto}</span>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ color: r.cor, background: r.fundo }}>{r.texto}</span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">{l.codigo_verificacao}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {l.tipo} · pedido por {l.pedida_por_nome} em {format(new Date(l.pedida_em), 'dd/MM/yyyy HH:mm')}
        {l.titular_nome ? ` · e-CPF de ${l.titular_nome}` : ''}
        {l.liberada_por_nome ? ` · liberado por ${l.liberada_por_nome}` : ''}
      </p>
      {l.recusa && <p className="text-xs text-red-700 mt-1">{l.recusa}</p>}
      {l.erro && <p className="text-xs text-red-700 mt-1">{l.erro}</p>}

      <div className="flex flex-wrap gap-2 mt-3">
        {l.assinado_path && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => abrir(l.assinado_path)}>
            <Eye className="w-3.5 h-3.5" /> Abrir assinado
          </Button>
        )}
        {l.documento_aprovado_path && l.situacao !== 'assinado' && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => abrir(l.documento_aprovado_path)}>
            <Eye className="w-3.5 h-3.5" /> Ver o PDF
          </Button>
        )}
        {l.situacao === 'conferir' && (
          <Button size="sm" className="gap-1.5" onClick={() => aprovar.mutate({ id: l.id })} disabled={aprovar.isPending}>
            <Check className="w-3.5 h-3.5" /> Está certo, assine
          </Button>
        )}
        {l.situacao === 'aguardando_ze' && (
          <>
            <Button size="sm" className="gap-1.5" onClick={() => liberar.mutate(l.id)} disabled={liberar.isPending}>
              <Check className="w-3.5 h-3.5" /> Liberar
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => recusar.mutate({ id: l.id, motivo: 'Não liberado.' })}>
              <X className="w-3.5 h-3.5" /> Não assinar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Assinaturas() {
  const { user } = useAuth();
  const disponivel = useAssinaturaDisponivel();
  const { data: registro = [], isLoading } = useRegistroAssinaturas();

  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-center text-muted-foreground">
          <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">A assinatura digital ainda não está liberada para esta conta.</p>
        </div>
      </MainLayout>
    );
  }

  const esperando = registro.filter(l => l.situacao === 'conferir' || l.situacao === 'aguardando_ze');
  const resto = registro.filter(l => !esperando.includes(l));

  return (
    <MainLayout>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <FileSignature className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Assinaturas</h1>
        </div>

        {user?.role === 'admin' && <CartaoCertificado />}

        {esperando.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">Esperando você</h2>
            <div className="space-y-2 mb-6">{esperando.map(l => <Linha key={l.id} l={l} />)}</div>
          </>
        )}

        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Tudo o que foi assinado</h2>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : resto.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nada por aqui ainda.</p>
        ) : (
          <div className="space-y-2">{resto.map(l => <Linha key={l.id} l={l} />)}</div>
        )}
      </div>
    </MainLayout>
  );
}
```

- [ ] **Step 3: A rota**

Em `src/App.tsx`, ao lado do import do `Ludmilla` (~linha 42):

```tsx
import Assinaturas from "./pages/Assinaturas";
```

e, ao lado da rota do `/ludmilla` (~linha 105):

```tsx
      <Route path="/assinaturas" element={<ProtectedRoute allowedRoles={['admin', 'staff']}><Assinaturas /></ProtectedRoute>} />
```

- [ ] **Step 4: O item no menu**

Em `src/components/layout/Sidebar.tsx`, o menu é uma lista com uma marca de
disponibilidade por item (a da Ludmilla está na linha 60). Três mudanças:

1. no import de `lucide-react`, incluir `FileSignature`;
2. no import dos hooks, acrescentar
   `import { useAssinaturaDisponivel } from '@/hooks/useAssinaturas';`
3. na lista de itens, logo depois da linha da Ludmilla:

```tsx
  { icon: FileSignature, label: 'Assinaturas', path: '/assinaturas', roles: ['admin', 'staff'], requiresAssinatura: true },
```

4. junto de `const ludmillaDisponivel = useLudmillaDisponivel();` (~linha 98):

```tsx
  const assinaturaDisponivel = useAssinaturaDisponivel();
```

5. no filtro dos itens (~linha 114), acrescentar a cláusula no mesmo encadeamento:

```tsx
    && (!item.requiresAssinatura || assinaturaDisponivel)
```

6. acrescentar `requiresAssinatura?: boolean` ao tipo do item (onde
   `requiresLudmilla` está declarado).

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -3 && npm run build 2>&1 | tail -5`
Expected: 65 erros (baseline) e build concluído.

- [ ] **Step 6: Olhar a tela de verdade**

Run: `preview_start {name: "dev"}` (criar a entrada em `.claude/launch.json` se
não existir: `npm run dev`, porta 8080) e navegar até `/assinaturas`.
Expected: a página abre; sem certificado cadastrado aparece "Nenhum certificado
cadastrado. Sem ele, ninguém assina."; o console do navegador sem erro.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Assinaturas.tsx src/hooks/useAssinaturas.ts src/App.tsx src/components/layout
git commit -m "feat(assinatura): pagina /assinaturas com certificado e extrato"
```

---

### Task 11: Documentação, memória e aceite

**Files:**
- Create: `docs/modules/signatures/overview.md`
- Create: `docs/modules/signatures/database.md`
- Create: `docs/modules/signatures/business-rules.md`
- Modify: `CLAUDE.md` (tabela de módulos)
- Modify: `docs/project/security.md`, `docs/project/roadmap.md`
- Modify: `docs/modules/ze/overview.md` (a liberação de assinatura)
- Create: `.claude/.../memory/assinatura-digital.md` + linha em `MEMORY.md`
- Create: `docs/adr/2026-10-03-assinatura-append-sobre-bytes-aprovados.md`

**Interfaces:**
- Consumes: todas as tasks anteriores
- Produces: documentação do módulo e o aceite ponta a ponta

- [ ] **Step 1: Escrever a doc do módulo**

Três arquivos em `docs/modules/signatures/`, no formato dos outros módulos
(ver `docs/modules/ludmilla` como molde):

- `overview.md`: para que serve, quem usa (staff + admin do tenant
  biblioteca), o fluxo em seis passos, onde ficam as telas, e a tranca do
  catálogo explicada como regra, não como implementação;
- `database.md`: as quatro tabelas, as duas colunas novas, as RPCs com
  assinatura e quem tem `GRANT`, o privilégio por coluna em `documents`, o
  bucket `certificados` sem policy, e o job `certificado-vencimento`;
- `business-rules.md`: (1) só assina documento que entrou pela porta da
  assinatura; (2) a triagem falha fechada; (3) a estampa vem antes da
  assinatura e a assinatura é append; (4) o original nunca é tocado;
  (5) exceção só com o "pode" do gestor, expirado = recusado;
  (6) certificado vencido = recusa, nunca assinatura inválida;
  (7) staff assina com o e-CPF do engenheiro — decisão consciente, o controle
  é o rastro.

- [ ] **Step 2: Apontar no índice e nos transversais**

Em `CLAUDE.md`, na tabela de módulos, depois de "Usuários":

```markdown
| Assinatura digital | 🟡 Fase 1 — só GD Manager | [modules/signatures](docs/modules/signatures/overview.md) |
```

Em `docs/project/security.md`, acrescentar a seção "Certificado digital":
bucket sem policy, senha no Vault, leitura só por `service_role`, privilégio
por coluna em `documents.assinavel_id`, e o registro de quem pediu/liberou.

Em `docs/project/roadmap.md`, registrar o que ficou de fora (Gov.br, A3,
cosign, carimbo do tempo de ACT).

Em `docs/modules/ze/overview.md`, acrescentar `liberar_assinatura` à lista de
pendências que ele pergunta.

- [ ] **Step 3: O ADR**

`docs/adr/2026-10-03-assinatura-append-sobre-bytes-aprovados.md`: por que a
estampa vem antes e a assinatura é append (a conferência humana cobre tudo o
que será assinado; depois do "está certo" nenhum byte é reescrito), por que o
`pdf-lib` grava com `useObjectStreams: false` (o `plainAddPlaceholder` não lê
xref stream), e a alternativa descartada (estampar e assinar num salto, que
exigiria confiar na conversão sem conferência).

- [ ] **Step 4: A memória**

Criar o arquivo de memória `assinatura-digital.md` com: onde mora a tranca
(catálogo + privilégio de coluna), que `/painel` é do master e a página é
`/assinaturas`, a armadilha do xref stream, que a assinatura é append sobre os
bytes aprovados, e que a senha do certificado nunca é manipulada pelo
assistente. Acrescentar a linha no `MEMORY.md`.

- [ ] **Step 5: Verificação final**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -3
npm run build 2>&1 | tail -5
npm test
cd worker/assinador && npm test && cd ../..
```
Expected: 65 erros (baseline), build ok, vitest verde, 9+ testes do worker
verdes (os de conversão `skipped` em Windows).

- [ ] **Step 6: Aceite ponta a ponta (com o usuário)**

Nesta ordem, porque cada passo depende do anterior:

1. rodar o workflow **Assinador — deploy do robô na VPS** (`simular: true`
   primeiro, para ler o diagnóstico; depois de verdade);
2. conferir o serviço: `systemctl is-active gdm-assinador` e
   `journalctl -u gdm-assinador -n 20` — deve dizer "assinador no ar" com
   `soffice: true`;
3. **o usuário** cadastra o certificado A1 em `/assinaturas` (ele digita a
   senha; o assistente não toca nela). Em segundos a situação deve virar
   `ok` com emissor, série e validade preenchidos;
4. num projeto de teste, pedir assinatura de um **memorial em .docx** →
   conferir o PDF preparado (a estampa aparece na última página, com a cidade
   do projeto) → "Está certo, assine" → o documento `..._assinado.pdf`
   aparece no projeto, o comentário entra no card, e o recado chega no
   WhatsApp do gestor;
5. **a prova da tranca**: tentar assinar um contrato qualquer escolhendo o
   tipo "Memorial descritivo" → a triagem deve barrar, ou cair em
   `aguardando_ze` e o Zé perguntar no WhatsApp. Responder "não" → fica
   `recusado` com o motivo no card;
6. abrir o PDF assinado num leitor que valide assinatura (Adobe Reader ou
   validar.iti.gov.br) e confirmar que a assinatura é reconhecida.

- [ ] **Step 7: Commit e push**

```bash
git add docs CLAUDE.md
git commit -m "docs(assinatura): doc do modulo, ADR e regras de negocio"
git push origin main
```

---

## Autorrevisão deste plano

**Cobertura da spec** — cada seção tem dono:

| Seção da spec | Task |
|---|---|
| §1 A tranca (catálogo) | 1 (catálogo + coluna), 2 (`assinatura_pedir`), 9 (privilégio de coluna + RPC da porta) |
| §2 Dados | 1 |
| §3 Certificado (Vault, bucket, conferência, vencimento) | 1 (cadastro/leitura), 5 (conferência no worker), 8 (vencimento + cron) |
| §4 Fluxo (6 passos) | 2 (RPCs), 5 (laço), 9 (aba), 10 (página) |
| §5 Worker (preparo + append) | 3, 4, 5, 6 |
| §6 Triagem (falha fechada) | 7 |
| §7 Zé (recado + exceção) | 8 |
| §8 Telas | 9 (aba no modal), 10 (página `/assinaturas`) |
| §9 Segurança | 1, 9 (privilégio de coluna), 11 (doc) |
| Como se prova | provas SQL em 1, 2, 8, 9; `node:test` em 3, 4, 5; vitest em 7; aceite em 11 |

**Furos que a revisão pegou e que já estão corrigidos no plano:**

1. `peneirar` marcava `aguardando_ze` sem abrir a pendência — ninguém seria
   avisado. Corrigido no Step 4 da Task 8 (`pedirAoZe`).
2. A tela podia gravar `assinavel_id` num insert comum, o que **anularia a
   tranca inteira**. Corrigido na Task 9 com privilégio por coluna e as duas
   RPCs (`documento_para_assinar`, `documento_marcar_assinavel`), com prova SQL
   de que o insert e o update diretos passam a ser negados — e de que o anexo
   comum continua entrando.
3. A triagem seria chamada pela tela (que não tem o arquivo preparado nem
   service role). Passou para o worker (Task 5, `triar`).
4. O `ze-brain` não tinha guarda no modo novo: um recado é o Zé falando em nome
   do sistema. Corrigido com a conferência do portador (Task 8, Step 3).

**Nomes conferidos entre tasks:** `assinatura_claim` / `assinatura_passo` /
`assinatura_pedir` / `assinatura_aprovar` / `assinatura_recusar` /
`assinatura_liberar` / `assinatura_pedir_ao_ze` / `assinatura_registro` /
`certificado_cadastrar` / `certificado_do_robo` / `certificado_conferido` /
`documento_para_assinar` / `documento_marcar_assinavel` — grafados igual na
migração que os cria, no worker que os chama e nos hooks.
`estampar` / `assinar` / `conferirAssinado` / `lerCertificado` /
`cpfMascarado` / `precisaConverter` / `converterParaPdf` / `temSoffice` /
`pegarTrabalho` / `passo` / `pedirAoZe` / `recadoDoZe` / `triar` / `sha256` /
`nomeAssinado` / `caminhoAprovado` — idem entre Tasks 3, 4, 5 e 8.
As colunas de `assinaturas` usadas no `assinatura_claim`, no worker e no
`assinatura_registro` são as mesmas declaradas na Task 1.

**Dependência entre tasks:** 1 → 2 → (3 → 4 → 5 → 6) e (7, 8) → 9 → 10 → 11.
As Tasks 3 e 4 são puras e podem ir em paralelo com 7; as demais seguem a
ordem.

