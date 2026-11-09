# Ludmilla, entrega 1 (medir) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar cada troca de etapa dos projetos, medir o tempo normal de cada concessionária em cada etapa e entregar a carteira (projetos ativos com tempo na etapa, normal, atraso, com quem está, donos e histórico) por RPC — sem tela.

**Architecture:** Uma migração SQL cria `project_stage_log` (alimentada por gatilho em `projects.status` e por uma carga inicial a partir do texto de `project_history`), duas funções internas (`ludmilla_passagens`, `ludmilla_normais_do_tenant`) e duas RPCs da equipe (`ludmilla_normais`, `ludmilla_carteira`). A prova é um arquivo SQL que roda dentro de `BEGIN … ROLLBACK` depois da migração, com impersonação, e devolve uma linha por caso.

**Tech Stack:** Postgres 15 (Supabase), PL/pgSQL, Supabase CLI (`npx -y supabase db query --linked`).

**Spec:** `docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md` (seções 6.3, 6.4, 7 e 9.1).

**Fora desta entrega (vai para o plano da entrega 2):** a barra extra da troca do medidor (ENEL),
que vem dos dados da Ludmilla (`portal_pedidos_troca`, `portal_cobrancas`) e não das etapas; o
dono escolhido pelo "passar para"; qualquer tela. O plano da entrega 2 é escrito depois desta ir
ao ar, com os números reais de normais e de tempo da carteira.

## Global Constraints

- Só o tenant `is_library` (GD Manager) usa a Ludmilla; toda RPC começa por `IF (SELECT auth.uid()) IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'`.
- Tenant do chamador sempre de `public.get_user_tenant_id((SELECT auth.uid()))`, nunca de parâmetro.
- Funções `SECURITY DEFINER` com `SET search_path = ''` e nomes totalmente qualificados (`public.`).
- RLS RESTRICTIVE por tenant + política de leitura `ludmilla_equipe_ok()`; nenhuma política de escrita; `REVOKE` de `anon` e de escrita de `authenticated`.
- Funções internas (`ludmilla_passagens`, `ludmilla_normais_do_tenant`, `registrar_etapa_do_projeto`) sem `EXECUTE` para `PUBLIC`, `anon` e `authenticated`.
- O gatilho **nunca** pode bloquear a troca de etapa: qualquer erro vira `RAISE WARNING` e a troca segue.
- Histórico confiável só a partir de **2026-07-19** (primeira linha "Etapa alterada"); passagens que entraram antes disso não contam para o normal.
- Normal = mediana de 12 meses com **no mínimo 5 passagens** fechadas; abaixo disso, mediana da etapa em todas as concessionárias (`geral`); depois `kanban_columns.stale_days` do modelo ativo (`coluna`); sem nada, `NULL`. Nunca menor que 1 dia.
- Com quem está (spec 6.4, aprovada em 08/11): item aberto na fila → `nos`; `pendencia` e `aguardando_instalacao` → `cliente`; `analysis`, `approval`, `vistoria_solicitada` → `concessionaria`; o resto → `nos`.
- Nada de `supabase db push`. Aplicar = `npx -y supabase db query --linked --yes -f <migração>`. Todo `--yes` (inclusive prova com ROLLBACK) só com autorização do usuário no chat nesta rodada.
- Depois de cada uso do CLI: `git restore supabase/.temp/cli-latest`.
- Commits com caminhos explícitos: `git commit -F <arquivo> -- <caminhos>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

- Create: `supabase/migrations/20261108200000_ludmilla_medir.sql` — tabela, gatilho, carga inicial, funções e RPCs (uma seção por task).
- Create: `supabase/provas/ludmilla_medir.sql` — os casos da prova; roda depois da migração, dentro de `BEGIN … ROLLBACK`.
- Modify: `docs/modules/integrations/ludmilla.md` — seção nova "Medir: etapas, tempo normal e carteira".
- Modify: `docs/project/roadmap.md` — item da repaginação.

Rótulo do histórico → código de etapa (de `src/lib/statusMapping.ts`): Projetos Recebidos=`pending`, Em Análise=`analysis`, Documentação=`documentation`, Aguardando Aprovação=`approval`, Aprovado=`approved`, Pendência=`pendencia`, Vistoria Solicitada=`vistoria_solicitada`, Aguardando Instalação=`aguardando_instalacao`, Vistoria sem Protocolo=`vistoria_sem_protocolo`, Vistoria Reprovada=`vistoria_reprovada`, Concluído=`completed`.

Comando da prova (usado em todas as tasks; `$S` = pasta de rascunho da sessão):

```bash
{ echo 'BEGIN;'; cat supabase/migrations/20261108200000_ludmilla_medir.sql; cat supabase/migrations/20261108200000_ludmilla_medir.sql; cat supabase/provas/ludmilla_medir.sql; echo 'ROLLBACK;'; } > "$S/prova-medir.sql"
npx -y supabase db query --linked --yes -f "$S/prova-medir.sql"; git restore supabase/.temp/cli-latest
```

A migração entra **duas vezes** de propósito: prova que rodar de novo não duplica nada.

---

### Task 1: O registro das etapas (tabela, gatilho e carga inicial)

**Files:**
- Create: `supabase/provas/ludmilla_medir.sql`
- Create: `supabase/migrations/20261108200000_ludmilla_medir.sql`

**Interfaces:**
- Produces: tabela `public.project_stage_log (id, tenant_id, project_id, de, para, em, origem, history_id, criado_em)`, `origem ∈ {gatilho, historico, criacao, atual}`; função `public.registrar_etapa_do_projeto()`; gatilho `trg_registrar_etapa`.

- [ ] **Step 1: Escrever a prova do registro**

Criar `supabase/provas/ludmilla_medir.sql` com o cabeçalho, o bloco A e o rodapé (as tasks 2 e 3 inserem os blocos B e C antes do rodapé):

```sql
-- Prova da entrega 1 (medir). Roda DENTRO de BEGIN … ROLLBACK, depois da migração.
-- Devolve uma linha por caso: ok = true passou, false falhou, null não deu para testar.
CREATE TEMP TABLE r (caso text, ok boolean, detalhe text) ON COMMIT DROP;
GRANT INSERT, SELECT ON r TO authenticated;

-- ── A. O registro das etapas ───────────────────────────────────────────────
DO $$
DECLARE _t uuid; _n int; _txt text; _p uuid;
BEGIN
  SELECT id INTO _t FROM public.tenants WHERE is_library LIMIT 1;

  SELECT count(*) INTO _n FROM public.project_history h
   WHERE h.action = 'Etapa alterada'
     AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.history_id = h.id);
  SELECT string_agg(DISTINCT substring(h.description FROM 'para "([^"]+)"'), ', ') INTO _txt
    FROM public.project_history h
   WHERE h.action = 'Etapa alterada'
     AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.history_id = h.id);
  INSERT INTO r VALUES ('A1 todo "Etapa alterada" virou linha do registro', _n = 0,
                        _n || ' sem etapa reconhecida' || coalesce(': ' || _txt, ''));

  SELECT string_agg(origem || '=' || n, ', ') INTO _txt
    FROM (SELECT origem, count(*) AS n FROM public.project_stage_log GROUP BY 1 ORDER BY 1) x;
  SELECT count(*) INTO _n FROM public.project_stage_log WHERE origem = 'historico';
  INSERT INTO r VALUES ('A2 linhas por origem', _n >= 1000, _txt);

  SELECT count(*), string_agg(code, ', ') INTO _n, _txt FROM (
    SELECT p.code FROM public.projects p
      JOIN LATERAL (SELECT s.para FROM public.project_stage_log s WHERE s.project_id = p.id
                     ORDER BY s.em DESC, s.criado_em DESC LIMIT 1) u ON true
     WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed'
       AND u.para IS DISTINCT FROM p.status
     LIMIT 50) x;
  INSERT INTO r VALUES ('A3 a última etapa do registro é a do projeto', _n = 0,
                        _n || coalesce(' divergentes: ' || _txt, ''));

  SELECT count(*) INTO _n FROM public.projects p
   WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed'
     AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.project_id = p.id);
  INSERT INTO r VALUES ('A4 todo projeto ativo tem registro', _n = 0, _n || ' sem nenhuma linha');

  SELECT count(*) INTO _n FROM (
    SELECT s.project_id FROM public.project_stage_log s WHERE s.origem IN ('criacao', 'atual')
     GROUP BY s.project_id, s.origem HAVING count(*) > 1) x;
  INSERT INTO r VALUES ('A5 rodar a migração de novo não duplica', _n = 0, _n || ' projetos com linha repetida');

  SELECT p.id INTO _p FROM public.projects p
   WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.status = 'approved' ORDER BY p.created_at DESC LIMIT 1;
  UPDATE public.projects SET status = 'vistoria_solicitada' WHERE id = _p;
  SELECT count(*) INTO _n FROM public.project_stage_log s
   WHERE s.project_id = _p AND s.origem = 'gatilho' AND s.de = 'approved' AND s.para = 'vistoria_solicitada';
  INSERT INTO r VALUES ('A6 o gatilho registra a troca de etapa', _n = 1, _n || ' linha(s) de gatilho');
END $$;

-- ── (blocos B e C entram aqui) ─────────────────────────────────────────────

SELECT json_agg(json_build_object('caso', caso, 'ok', ok, 'detalhe', detalhe)
                ORDER BY ok NULLS FIRST, caso) AS x FROM r;
```

- [ ] **Step 2: Rodar a prova sem a migração e ver falhar**

Criar a migração vazia (só o cabeçalho de comentário) e rodar o comando da prova.
Expected: erro `relation "public.project_stage_log" does not exist`.

- [ ] **Step 3: Escrever a seção 1 da migração**

`supabase/migrations/20261108200000_ludmilla_medir.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Ludmilla, entrega 1 (MEDIR): registro das etapas, tempo normal e carteira.
-- Spec: docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md
--   (6.3 tempo na etapa e normal, 6.4 com quem está, 7 banco, 9.1 entrega).
-- Nada aqui muda projeto: o gatilho só registra a troca e as funções só leem.
-- Pode rodar de novo: tudo é IF NOT EXISTS, DROP … IF EXISTS ou ON CONFLICT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. O registro das etapas ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_stage_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  de          text,
  para        text NOT NULL,
  em          timestamptz NOT NULL,
  origem      text NOT NULL CHECK (origem IN ('gatilho', 'historico', 'criacao', 'atual')),
  history_id  uuid UNIQUE REFERENCES public.project_history(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.project_stage_log IS
  'Cada troca de etapa do projeto. gatilho = desde 08/11/2026; historico = lido do texto de project_history '
  '(confiável desde 19/07/2026); criacao = a entrada na primeira etapa; atual = a etapa atual quando o histórico não chega nela.';
CREATE INDEX IF NOT EXISTS idx_stage_log_projeto ON public.project_stage_log (project_id, em);
CREATE INDEX IF NOT EXISTS idx_stage_log_tenant  ON public.project_stage_log (tenant_id, para, em);

ALTER TABLE public.project_stage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.project_stage_log;
CREATE POLICY tenant_isolation ON public.project_stage_log
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((SELECT auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((SELECT auth.uid())));
DROP POLICY IF EXISTS equipe_le_etapas ON public.project_stage_log;
CREATE POLICY equipe_le_etapas ON public.project_stage_log
  FOR SELECT USING ((SELECT public.ludmilla_equipe_ok()));
REVOKE ALL ON public.project_stage_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_stage_log FROM authenticated;
GRANT SELECT ON public.project_stage_log TO authenticated;

-- ── 2. O gatilho: registra, nunca bloqueia ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_etapa_do_projeto()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.status IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
    VALUES (NEW.tenant_id, NEW.id, NULL, NEW.status, coalesce(NEW.created_at, now()), 'criacao');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
    VALUES (NEW.tenant_id, NEW.id, OLD.status, NEW.status, now(), 'gatilho');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'project_stage_log: não registrei a etapa do projeto % (%)', NEW.id, SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.registrar_etapa_do_projeto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_registrar_etapa ON public.projects;
CREATE TRIGGER trg_registrar_etapa
  AFTER INSERT OR UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.registrar_etapa_do_projeto();

-- ── 3. Carga inicial, a partir do texto do histórico ───────────────────────
-- 3a. Cada linha de histórico que diz a etapa nova.
WITH rotulos(rotulo, chave) AS (VALUES
  ('Projetos Recebidos', 'pending'), ('Em Análise', 'analysis'), ('Documentação', 'documentation'),
  ('Aguardando Aprovação', 'approval'), ('Aprovado', 'approved'), ('Pendência', 'pendencia'),
  ('Vistoria Solicitada', 'vistoria_solicitada'), ('Aguardando Instalação', 'aguardando_instalacao'),
  ('Vistoria sem Protocolo', 'vistoria_sem_protocolo'), ('Vistoria Reprovada', 'vistoria_reprovada'),
  ('Concluído', 'completed')
),
lidos AS (
  SELECT h.id, h.project_id, p.tenant_id, h.created_at, h.action,
         substring(h.description FROM 'de "([^"]+)" para') AS rot_de,
         substring(h.description FROM 'para "([^"]+)"')    AS rot_para,
         substring(h.description FROM 'moveu para ([a-z_]+)') AS chave_portal
    FROM public.project_history h
    JOIN public.projects p ON p.id = h.project_id
   WHERE h.action IN ('Etapa alterada', 'Status alterado', 'Status atualizado pelo portal')
     AND p.tenant_id IS NOT NULL
),
traduzidos AS (
  SELECT l.id, l.project_id, l.tenant_id, l.created_at,
         CASE WHEN l.action = 'Etapa alterada' THEN rd.chave END AS de,
         CASE l.action
           WHEN 'Etapa alterada' THEN rp.chave
           WHEN 'Status alterado' THEN rk.chave
           ELSE rq.chave
         END AS para
    FROM lidos l
    LEFT JOIN rotulos rd ON lower(rd.rotulo) = lower(l.rot_de)
    LEFT JOIN rotulos rp ON lower(rp.rotulo) = lower(l.rot_para)
    LEFT JOIN rotulos rk ON rk.chave = l.rot_para
    LEFT JOIN rotulos rq ON rq.chave = l.chave_portal
)
INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem, history_id)
SELECT t.tenant_id, t.project_id, t.de, t.para, t.created_at, 'historico', t.id
  FROM traduzidos t
 WHERE t.para IS NOT NULL
ON CONFLICT (history_id) DO NOTHING;

-- 3b. A entrada na primeira etapa (quando o projeto nasceu antes da primeira troca registrada).
INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
SELECT p.tenant_id, p.id, NULL, coalesce(pri.de, 'pending'), p.created_at, 'criacao'
  FROM public.projects p
  JOIN LATERAL (SELECT s.de, s.em FROM public.project_stage_log s
                 WHERE s.project_id = p.id ORDER BY s.em, s.criado_em LIMIT 1) pri ON true
 WHERE p.tenant_id IS NOT NULL AND p.created_at IS NOT NULL AND p.created_at < pri.em
   AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.project_id = p.id AND s.origem = 'criacao');

-- 3c. A etapa atual, quando o histórico não chega nela (last_status_change é mantido por gatilho desde mai/2026).
INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
SELECT p.tenant_id, p.id, ult.para, p.status, p.last_status_change, 'atual'
  FROM public.projects p
  LEFT JOIN LATERAL (SELECT s.para, s.em FROM public.project_stage_log s
                      WHERE s.project_id = p.id ORDER BY s.em DESC, s.criado_em DESC LIMIT 1) ult ON true
 WHERE p.tenant_id IS NOT NULL AND p.status IS NOT NULL AND p.last_status_change IS NOT NULL
   AND (ult.para IS NULL OR (ult.para IS DISTINCT FROM p.status AND p.last_status_change > ult.em))
   AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.project_id = p.id AND s.origem = 'atual');
```

- [ ] **Step 4: Rodar a prova e ver passar**

Rodar o comando da prova (pedir autorização do `--yes` antes, se ainda não houver nesta rodada).
Expected: `A1`…`A6` com `"ok": true`; `A2` com `historico=` acima de 1000.
Se `A1` falhar, o detalhe lista o rótulo que faltou: acrescentar em `rotulos` (nunca apagar a linha do histórico).
Se `A3` falhar, abrir o histórico dos projetos listados antes de mexer no SQL.

- [ ] **Step 5: Commit**

```bash
git add -- supabase/migrations/20261108200000_ludmilla_medir.sql supabase/provas/ludmilla_medir.sql
git commit -F "$S/msg-e1-t1.txt" -- supabase/migrations/20261108200000_ludmilla_medir.sql supabase/provas/ludmilla_medir.sql
```
Mensagem: `feat(ludmilla): registro das etapas dos projetos (entrega 1, medir)` + o que a prova mostrou + a linha `Co-Authored-By`.

---

### Task 2: As passagens e o tempo normal

**Files:**
- Modify: `supabase/provas/ludmilla_medir.sql` (inserir o bloco B antes do rodapé)
- Modify: `supabase/migrations/20261108200000_ludmilla_medir.sql` (acrescentar a seção 4)

**Interfaces:**
- Consumes: `public.project_stage_log` (Task 1).
- Produces:
  - `public.ludmilla_passagens(p_tenant uuid) RETURNS TABLE (project_id uuid, concessionaire_id uuid, etapa text, entrou_em timestamptz, saiu_em timestamptz, dias numeric, confiavel boolean)` — interna.
  - `public.ludmilla_normais_do_tenant(p_tenant uuid) RETURNS TABLE (concessionaire_id uuid, etapa text, normal_dias integer, amostra integer, fonte text)` — interna; `fonte ∈ {medido, geral, coluna, NULL}`.
  - `public.ludmilla_normais() RETURNS TABLE (concessionaire_id uuid, etapa text, normal_dias integer, amostra integer, fonte text)` — RPC da equipe.

- [ ] **Step 1: Escrever o bloco B da prova**

Inserir antes da linha `-- ── (blocos B e C entram aqui)`:

```sql
-- ── B. As passagens e o tempo normal ───────────────────────────────────────
DO $$
DECLARE _t uuid; _pessoa uuid; _n int; _txt text; _enel text; _erro text;
BEGIN
  SELECT id INTO _t FROM public.tenants WHERE is_library LIMIT 1;
  SELECT p.id INTO _pessoa FROM public.profiles p
   WHERE p.tenant_id = _t AND p.active AND p.role IN ('admin', 'staff')
     AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p.id)
   ORDER BY (p.role = 'admin') DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', _pessoa)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO _n FROM public.ludmilla_normais() WHERE normal_dias < 1;
  SELECT string_agg(f || '=' || c, ', ') INTO _txt
    FROM (SELECT coalesce(fonte, 'sem normal') AS f, count(*) AS c FROM public.ludmilla_normais() GROUP BY 1 ORDER BY 1) x;
  SELECT string_agg(n.etapa || ' ' || coalesce(n.normal_dias::text, '?') || 'd (' || coalesce(n.fonte, 'sem') || ', ' || n.amostra || ')', '; ')
    INTO _enel
    FROM public.ludmilla_normais() n
    JOIN public.energy_concessionaires ec ON ec.id = n.concessionaire_id
   WHERE ec.name ILIKE '%ENEL%';
  BEGIN
    PERFORM count(*) FROM public.ludmilla_passagens(_t);
    _erro := 'chamou';
  EXCEPTION WHEN insufficient_privilege THEN _erro := 'negado';
  END;

  PERFORM set_config('role', 'none', true);
  INSERT INTO r VALUES
    ('B1 nenhum normal abaixo de 1 dia', _n = 0, _n || ' abaixo de 1'),
    ('B2 de onde vem cada normal', true, _txt),
    ('B3 normais da ENEL (para conferir a olho)', true, left(coalesce(_enel, 'nenhum'), 900)),
    ('B4 passagens fechadas para a equipe', _erro = 'negado', _erro);
END $$;
```

- [ ] **Step 2: Rodar a prova e ver falhar**

Expected: erro `function public.ludmilla_normais() does not exist`.

- [ ] **Step 3: Escrever a seção 4 da migração**

Acrescentar ao fim da migração:

```sql
-- ── 4. Passagens e o tempo normal ──────────────────────────────────────────
-- Uma passagem = uma estada numa etapa: da entrada até a próxima troca (ou até agora).
-- Linhas seguidas com a mesma etapa (o mesmo movimento escrito duas vezes) contam uma vez.
CREATE OR REPLACE FUNCTION public.ludmilla_passagens(p_tenant uuid)
RETURNS TABLE (project_id uuid, concessionaire_id uuid, etapa text, entrou_em timestamptz,
               saiu_em timestamptz, dias numeric, confiavel boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH l AS (
    SELECT s.project_id, s.para, s.em,
           lag(s.para) OVER (PARTITION BY s.project_id ORDER BY s.em, s.criado_em) AS para_antes
      FROM public.project_stage_log s
     WHERE s.tenant_id = p_tenant
  ), entradas AS (
    SELECT l.project_id, l.para, l.em FROM l WHERE l.para_antes IS DISTINCT FROM l.para
  ), seq AS (
    SELECT e.project_id, e.para AS etapa, e.em AS entrou_em,
           lead(e.em) OVER (PARTITION BY e.project_id ORDER BY e.em) AS saiu_em
      FROM entradas e
  )
  SELECT q.project_id, p.concessionaire_id, q.etapa, q.entrou_em, q.saiu_em,
         round((extract(epoch FROM (coalesce(q.saiu_em, now()) - q.entrou_em)) / 86400.0)::numeric, 1),
         q.entrou_em >= timestamptz '2026-07-19 00:00:00-03'
    FROM seq q
    JOIN public.projects p ON p.id = q.project_id
   WHERE p.is_deleted IS NOT TRUE
$$;
REVOKE ALL ON FUNCTION public.ludmilla_passagens(uuid) FROM PUBLIC, anon, authenticated;

-- O normal de cada concessionária × etapa: mediana de 12 meses com no mínimo 5 passagens fechadas;
-- senão a mediana da etapa em todas as concessionárias ("geral"); senão o stale_days da coluna do
-- Kanban ativo ("coluna"); senão NULL. Nunca menos de 1 dia.
CREATE OR REPLACE FUNCTION public.ludmilla_normais_do_tenant(p_tenant uuid)
RETURNS TABLE (concessionaire_id uuid, etapa text, normal_dias integer, amostra integer, fonte text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH pass AS (
    SELECT x.concessionaire_id, x.etapa, x.dias
      FROM public.ludmilla_passagens(p_tenant) x
     WHERE x.saiu_em IS NOT NULL AND x.confiavel AND x.etapa <> 'completed'
       AND x.entrou_em >= now() - interval '12 months'
  ), por_conc AS (
    SELECT pass.concessionaire_id, pass.etapa, count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pass.dias::float8) AS med
      FROM pass WHERE pass.concessionaire_id IS NOT NULL
     GROUP BY 1, 2
  ), geral AS (
    SELECT pass.etapa, count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pass.dias::float8) AS med
      FROM pass GROUP BY 1
  ), coluna AS (
    SELECT kc.status_key AS etapa, min(kc.stale_days) AS stale
      FROM public.kanban_columns kc
      JOIN public.kanban_models m ON m.id = kc.kanban_model_id
     WHERE m.tenant_id = p_tenant AND m.is_active AND kc.stale_days IS NOT NULL
     GROUP BY 1
  ), combos AS (
    SELECT DISTINCT p.concessionaire_id, e.etapa
      FROM public.projects p
     CROSS JOIN (VALUES ('pending'), ('analysis'), ('documentation'), ('approval'), ('approved'),
                        ('pendencia'), ('vistoria_solicitada'), ('aguardando_instalacao'),
                        ('vistoria_sem_protocolo'), ('vistoria_reprovada')) e(etapa)
     WHERE p.tenant_id = p_tenant AND p.is_deleted IS NOT TRUE
  )
  SELECT c.concessionaire_id, c.etapa,
         CASE WHEN pc.n >= 5 THEN greatest(1, ceil(pc.med))::int
              WHEN g.n  >= 5 THEN greatest(1, ceil(g.med))::int
              WHEN col.stale IS NOT NULL THEN greatest(1, col.stale)
              ELSE NULL END,  -- greatest(1, NULL) daria 1: sem medição o normal fica vazio
         CASE WHEN pc.n >= 5 THEN pc.n WHEN g.n >= 5 THEN g.n ELSE 0 END,
         CASE WHEN pc.n >= 5 THEN 'medido' WHEN g.n >= 5 THEN 'geral'
              WHEN col.stale IS NOT NULL THEN 'coluna' ELSE NULL END
    FROM combos c
    LEFT JOIN por_conc pc ON pc.concessionaire_id IS NOT DISTINCT FROM c.concessionaire_id AND pc.etapa = c.etapa
    LEFT JOIN geral g     ON g.etapa = c.etapa
    LEFT JOIN coluna col  ON col.etapa = c.etapa
$$;
REVOKE ALL ON FUNCTION public.ludmilla_normais_do_tenant(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ludmilla_normais()
RETURNS TABLE (concessionaire_id uuid, etapa text, normal_dias integer, amostra integer, fonte text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  RETURN QUERY SELECT * FROM public.ludmilla_normais_do_tenant(public.get_user_tenant_id((SELECT auth.uid())));
END $$;
REVOKE ALL ON FUNCTION public.ludmilla_normais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_normais() TO authenticated;
```

- [ ] **Step 4: Rodar a prova e ver passar**

Expected: `A1`…`A6` e `B1`…`B4` com `"ok": true`. Ler `B2` e `B3` e anotar quantos normais saíram `medido`, `geral` e `sem normal` (isso vai para a doc e para o plano da entrega 2).

- [ ] **Step 5: Commit**

```bash
git commit -F "$S/msg-e1-t2.txt" -- supabase/migrations/20261108200000_ludmilla_medir.sql supabase/provas/ludmilla_medir.sql
```
Mensagem: `feat(ludmilla): tempo normal por concessionária e etapa (entrega 1, medir)` + os números de `B2` + `Co-Authored-By`.

---

### Task 3: A carteira

**Files:**
- Modify: `supabase/provas/ludmilla_medir.sql` (inserir o bloco C antes do rodapé)
- Modify: `supabase/migrations/20261108200000_ludmilla_medir.sql` (acrescentar a seção 5)

**Interfaces:**
- Consumes: `ludmilla_passagens`, `ludmilla_normais_do_tenant` (Task 2).
- Produces: `public.ludmilla_carteira() RETURNS TABLE (project_id uuid, code text, titular text, empresa text, company_id uuid, concessionaria text, concessionaire_id uuid, status text, na_etapa_desde timestamptz, dias_na_etapa numeric, normal_dias integer, normal_fonte text, atraso_dias numeric, com_quem text, donos jsonb, historico jsonb, na_fila boolean)`.
  - `com_quem ∈ {nos, concessionaria, cliente}`.
  - `donos` = `[{"id": uuid, "nome": text}]` (projetistas ativos ligados à empresa).
  - `historico` = `[{"etapa": text, "dias": numeric, "atual": boolean}]` em ordem.
  - Ordem: `atraso_dias` decrescente (nulos no fim), depois `dias_na_etapa` decrescente. A entrega 2 lê esta RPC.

- [ ] **Step 1: Escrever o bloco C da prova**

Inserir antes da linha `-- ── (blocos B e C entram aqui)`:

```sql
-- ── C. A carteira ──────────────────────────────────────────────────────────
DO $$
DECLARE _t uuid; _pessoa uuid; _outro uuid; _n int; _ativos int; _fora int; _desordem int;
        _txt text; _ini timestamptz; _ms numeric; _erro text; _linhas_outro int; _sem_hist int;
BEGIN
  SELECT id INTO _t FROM public.tenants WHERE is_library LIMIT 1;
  SELECT p.id INTO _pessoa FROM public.profiles p
   WHERE p.tenant_id = _t AND p.active AND p.role IN ('admin', 'staff')
     AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p.id)
   ORDER BY (p.role = 'admin') DESC LIMIT 1;
  SELECT p.id INTO _outro FROM public.profiles p
    JOIN public.tenants t ON t.id = p.tenant_id AND NOT t.is_library
   WHERE p.active AND p.role = 'admin' AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p.id)
   LIMIT 1;
  SELECT count(*) INTO _ativos FROM public.projects p
   WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed';

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', _pessoa)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  _ini := clock_timestamp();
  SELECT count(*),
         count(*) FILTER (WHERE c.com_quem NOT IN ('nos', 'concessionaria', 'cliente')),
         count(*) FILTER (WHERE jsonb_array_length(c.historico) = 0),
         string_agg(c.code || ' ' || c.atraso_dias || 'd além de ' || c.normal_dias || ' (' || c.status || ', ' || c.com_quem || ')', '; ')
           FILTER (WHERE c.atraso_dias > 0)
    INTO _n, _fora, _sem_hist, _txt
    FROM public.ludmilla_carteira() c;
  _ms := extract(epoch FROM clock_timestamp() - _ini) * 1000;
  SELECT count(*) INTO _desordem FROM (
    SELECT c.atraso_dias, lag(c.atraso_dias) OVER (ORDER BY c.ordinality) AS antes
      FROM public.ludmilla_carteira() WITH ORDINALITY c) x
   WHERE x.antes IS NOT NULL AND x.atraso_dias IS NOT NULL AND x.atraso_dias > x.antes;
  PERFORM set_config('role', 'none', true);

  IF _outro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', _outro)::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      PERFORM count(*) FROM public.ludmilla_carteira();
      _erro := 'entrou';
    EXCEPTION WHEN OTHERS THEN _erro := SQLERRM;
    END;
    SELECT count(*) INTO _linhas_outro FROM public.project_stage_log;
    PERFORM set_config('role', 'none', true);
  END IF;

  INSERT INTO r VALUES
    ('C1 uma linha por projeto ativo', _n = _ativos, _n || ' na carteira, ' || _ativos || ' ativos'),
    ('C2 com quem está sempre válido', _fora = 0, _fora || ' fora do padrão'),
    ('C3 mais atrasado primeiro', _desordem = 0, _desordem || ' fora de ordem'),
    ('C4 todo projeto tem histórico', _sem_hist = 0, _sem_hist || ' sem histórico'),
    ('C5 a carteira responde em menos de 2 s', _ms < 2000, round(_ms) || ' ms'),
    ('C6 outro tenant não abre a carteira',
       CASE WHEN _outro IS NULL THEN NULL ELSE _erro = 'Sem acesso à Ludmilla.' END,
       coalesce(_erro, 'sem outro tenant para testar')),
    ('C7 outro tenant não lê o registro',
       CASE WHEN _outro IS NULL THEN NULL ELSE _linhas_outro = 0 END,
       coalesce(_linhas_outro::text, '—')),
    ('C8 atrasados (para conferir a olho)', true, left(coalesce(_txt, 'nenhum'), 900));
END $$;
```

- [ ] **Step 2: Rodar a prova e ver falhar**

Expected: erro `function public.ludmilla_carteira() does not exist`.

- [ ] **Step 3: Escrever a seção 5 da migração**

Acrescentar ao fim da migração:

```sql
-- ── 5. A carteira ──────────────────────────────────────────────────────────
-- Projetos ativos do tenant (não excluídos, não arquivados, não concluídos) com o tempo na etapa,
-- o normal, o atraso, com quem está (spec 6.4), os projetistas ligados à empresa e o histórico.
CREATE OR REPLACE FUNCTION public.ludmilla_carteira()
RETURNS TABLE (project_id uuid, code text, titular text, empresa text, company_id uuid,
               concessionaria text, concessionaire_id uuid, status text, na_etapa_desde timestamptz,
               dias_na_etapa numeric, normal_dias integer, normal_fonte text, atraso_dias numeric,
               com_quem text, donos jsonb, historico jsonb, na_fila boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _tenant uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  _tenant := public.get_user_tenant_id((SELECT auth.uid()));

  RETURN QUERY
  WITH ativos AS (
    SELECT p.id, p.code, p.title, p.company_id, p.concessionaire_id, p.status, p.last_status_change
      FROM public.projects p
     WHERE p.tenant_id = _tenant AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed'
  ), normais AS (
    SELECT * FROM public.ludmilla_normais_do_tenant(_tenant)
  ), pass AS (
    SELECT * FROM public.ludmilla_passagens(_tenant)
  ), fila AS (
    SELECT u.project_id AS pid FROM public.portal_updates u
     WHERE u.tenant_id = _tenant AND u.situacao = 'pendente' AND u.project_id IS NOT NULL
    UNION
    SELECT f.project_id FROM public.portal_afazeres f
     WHERE f.tenant_id = _tenant AND f.feito_em IS NULL AND f.project_id IS NOT NULL
  ), base AS (
    SELECT a.*,
           round((extract(epoch FROM (now() - a.last_status_change)) / 86400.0)::numeric, 1) AS dias,
           EXISTS (SELECT 1 FROM fila WHERE fila.pid = a.id) AS na_fila
      FROM ativos a
  )
  SELECT b.id, b.code::text, b.title::text, co.name::text, b.company_id, ec.name::text, b.concessionaire_id,
         b.status::text, b.last_status_change, b.dias, n.normal_dias, n.fonte,
         CASE WHEN n.normal_dias IS NULL THEN NULL ELSE b.dias - n.normal_dias END,
         CASE
           WHEN b.na_fila THEN 'nos'
           WHEN b.status IN ('pendencia', 'aguardando_instalacao') THEN 'cliente'
           WHEN b.status IN ('analysis', 'approval', 'vistoria_solicitada') THEN 'concessionaria'
           ELSE 'nos'
         END,
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'nome', pr.name) ORDER BY pr.name)
                     FROM public.staff_companies sc
                     JOIN public.profiles pr ON pr.id = sc.staff_user_id
                    WHERE sc.company_id = b.company_id AND sc.tenant_id = _tenant AND pr.active), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(jsonb_build_object('etapa', ps.etapa, 'dias', ps.dias, 'atual', ps.saiu_em IS NULL)
                                    ORDER BY ps.entrou_em)
                     FROM pass ps WHERE ps.project_id = b.id), '[]'::jsonb),
         b.na_fila
    FROM base b
    LEFT JOIN public.companies co ON co.id = b.company_id
    LEFT JOIN public.energy_concessionaires ec ON ec.id = b.concessionaire_id
    LEFT JOIN normais n ON n.concessionaire_id IS NOT DISTINCT FROM b.concessionaire_id AND n.etapa = b.status
   ORDER BY 13 DESC NULLS LAST, 10 DESC;
END $$;
REVOKE ALL ON FUNCTION public.ludmilla_carteira() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_carteira() TO authenticated;
```

- [ ] **Step 4: Rodar a prova e ver passar**

Expected: todos os casos `A`, `B` e `C` com `"ok": true` (ou `null` em `C6`/`C7` só se não houver outro tenant com admin ativo — anotar). Ler `C8` com o usuário de olho: os atrasados fazem sentido?
Se `C5` passar de 2 s, medir com `EXPLAIN ANALYZE` antes de mudar o SQL.

- [ ] **Step 5: Commit**

```bash
git commit -F "$S/msg-e1-t3.txt" -- supabase/migrations/20261108200000_ludmilla_medir.sql supabase/provas/ludmilla_medir.sql
```
Mensagem: `feat(ludmilla): carteira com tempo na etapa, normal e com quem está (entrega 1, medir)` + `C1`, `C5` e `C8` resumidos + `Co-Authored-By`.

---

### Task 4: Aplicar em produção e conferir

**Files:**
- (nenhum arquivo novo; só execução)

- [ ] **Step 1: Pedir a autorização de aplicar**

No chat, dizer o que vai acontecer: cria `project_stage_log`, o gatilho em `projects`, as quatro funções; a carga inicial grava ~1.100 linhas a partir do histórico; nada muda em projeto. Esperar o "pode aplicar".

- [ ] **Step 2: Aplicar**

```bash
npx -y supabase db query --linked --yes -f supabase/migrations/20261108200000_ludmilla_medir.sql; git restore supabase/.temp/cli-latest
```
Expected: sem erro.

- [ ] **Step 3: Rodar a prova contra o banco aplicado**

```bash
{ echo 'BEGIN;'; cat supabase/provas/ludmilla_medir.sql; echo 'ROLLBACK;'; } > "$S/prova-medir-aplicada.sql"
npx -y supabase db query --linked --yes -f "$S/prova-medir-aplicada.sql"; git restore supabase/.temp/cli-latest
```
Expected: os mesmos resultados da Task 3, agora sem a migração no arquivo.

- [ ] **Step 4: Conferir que o gatilho de verdade está gravando**

Depois da próxima troca de etapa feita pela equipe (ou na próxima rodada), só leitura:

```sql
SELECT origem, count(*), max(em) FROM public.project_stage_log GROUP BY 1 ORDER BY 1;
```
Expected: aparece `gatilho` com `max(em)` depois da aplicação. Se não houver troca até o fim da rodada, registrar como "não exercido" na doc.

---

### Task 5: Documentação, memória e entrega

**Files:**
- Modify: `docs/modules/integrations/ludmilla.md` (seção nova no fim)
- Modify: `docs/project/roadmap.md` (item da repaginação)

- [ ] **Step 1: Seção nova na doc do módulo**

Acrescentar ao fim de `docs/modules/integrations/ludmilla.md`, preenchendo os números com o que a prova mostrou:

```markdown
## Medir: etapas, tempo normal e carteira (entrega 1 da repaginação, nov/2026)

Spec: `docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md`. Migração
`20261108200000_ludmilla_medir.sql`; prova `supabase/provas/ludmilla_medir.sql` (roda dentro
de `BEGIN … ROLLBACK`).

- **`project_stage_log`**: cada troca de etapa. `gatilho` em `projects.status` desde a
  aplicação (nunca bloqueia a troca: erro vira aviso no log do banco); `historico` lido do
  texto de `project_history` ("Etapa alterada de X para Y", "Status alterado para …",
  "… moveu para …"); `criacao` e `atual` completam o começo e o fim. Confiável a partir de
  19/07/2026.
- **`ludmilla_passagens(tenant)`** (interna): uma estada por etapa, com dias e se é confiável.
- **`ludmilla_normais()`**: o normal de cada concessionária × etapa = mediana de 12 meses com
  no mínimo 5 passagens; senão `geral` (todas as concessionárias), `coluna` (`stale_days`) ou
  nenhum. Na aplicação: <medido=N, geral=N, sem normal=N>.
- **`ludmilla_carteira()`**: os projetos ativos com tempo na etapa, normal, atraso, com quem
  está (`nos`, `concessionaria`, `cliente`; regra da spec 6.4), projetistas ligados e o
  histórico. <N projetos, X ms; N atrasados>.

O que NÃO está provado: <o gatilho com troca real, se ainda não houve>.
```

- [ ] **Step 2: Roadmap**

Em `docs/project/roadmap.md`, no item "Ludmilla, a melhor funcionária", trocar "spec escrita, falta o plano" por "entrega 1 (medir) no ar em <data>; falta o plano da entrega 2 (página nova)".

- [ ] **Step 3: Memória**

Atualizar `memory/ludmilla.md` (linha da repaginação): entrega 1 aplicada, os números de `B2`, `C1`, `C5`, o que ficou sem exercer.

- [ ] **Step 4: Commit e push**

```bash
git commit -F "$S/msg-e1-docs.txt" -- docs/modules/integrations/ludmilla.md docs/project/roadmap.md
git fetch -q origin && git rebase origin/main && git push -q origin HEAD:main
```
Expected: `origin/main` no commit novo. Nenhum arquivo de front mudou, então `tsc` e `build` não mudam; não precisam rodar.

---

## Execução (08–09/11/2026) — o que mudou em relação a este plano

O código que vale é o da migração e o da prova no repositório; os blocos acima ficaram como
escritos antes da execução. Desvios:

1. **`projects.status` é o enum `project_status`.** Comparar e gravar com `::text` (gatilho,
   carga 3c, carteira e prova A3). O banco recusou `text = project_status` na primeira rodada.
2. **Carga 3b só olha linhas `historico`.** Aplicada uma vez, a migração gravou 276 criações;
   rodada duas vezes (a prova), dava 308, porque a segunda rodada usava a linha `atual` da
   primeira como troca e inventava "pending" em 32 projetos sem histórico. Caso novo **A7**
   ("nenhuma entrada inventada pela carga"). Produção não mudou (rodou uma vez).
3. **Resultado:** 19 de 19 casos verdes com a migração dobrada e contra o banco aplicado.
   Aplicada em 09/11/2026. O gatilho com troca real ainda não foi exercido.
