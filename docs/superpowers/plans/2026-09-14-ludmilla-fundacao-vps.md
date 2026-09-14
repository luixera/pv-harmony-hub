# Ludmilla — sub-projeto 1: fundação + robô na VPS — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar a Ludmilla existindo (usuária), com credenciais cifradas, fila de trabalhos, um robô Node+Playwright rodando na VPS e o **reconhecimento** dos portais CPFL e Elektro (tela de login: CAPTCHA? campos? WAF?) gravado no banco com print.

**Architecture:** Tabelas + RPCs no Supabase (RLS por tenant, credencial no Vault, leitura só por service role); worker em `worker/ludmilla/` que consome a fila por polling e roda conectores; deploy por workflow manual do GitHub Actions para a VPS (systemd).

**Tech Stack:** Postgres/Supabase (Vault, Storage, RLS), Node 20 + TypeScript, Playwright (Chromium), node:test, GitHub Actions, systemd.

**Spec:** `docs/superpowers/specs/2026-09-14-ludmilla-design.md`

## Global Constraints

- Só tenant `is_library` (GD Manager). Isolamento de tenant por política RESTRICTIVE `tenant_id = get_user_tenant_id(auth.uid())`.
- Senha só no Vault; a única leitura é `ludmilla_portal_credentials`, só `service_role`.
- Worker nunca escreve no portal; nunca tenta resolver CAPTCHA.
- Mensagens de erro e identificadores novos em português (padrão do módulo Bidu).
- Verificação da casa: `npx tsc --noEmit -p tsconfig.app.json` = 65 erros; `npm run build` ok; testes do worker verdes; migração aplicada com `supabase db push` (ou `db query -f`).
- Segredo `SUPABASE_SERVICE_ROLE_KEY` no GitHub é cadastrado pelo usuário — nunca passa pela conversa.

---

### Task 1: Migração — Ludmilla, tabelas, Vault, fila, RLS

**Files:**
- Create: `supabase/migrations/20260914120000_ludmilla.sql`
- Test: `scratchpad/test_ludmilla_rls.sql` (rodado com `db query`, dentro de `begin … rollback`)

**Interfaces:**
- Produces: tabelas `portal_accounts`, `portal_sync_runs`, `portal_updates`, `portal_status_map`; bucket `ludmilla`; RPCs `set_portal_credentials(p_concessionaire_id uuid, p_login text, p_senha text) → uuid`, `ludmilla_portal_credentials(p_account_id uuid) → table(login text, senha text, connector text)`, `ludmilla_claim_run() → setof portal_sync_runs`, `ludmilla_finalizar_run(p_run_id uuid, p_situacao text, p_erro text, p_resultado jsonb, p_print_path text, p_protocolos int, p_mudancas int) → void`, `ludmilla_pedir_run(p_account_id uuid, p_tipo text) → uuid`.

- [ ] **Step 1: Escrever a migração** (conteúdo integral no arquivo; usuária com id fixo `00000000-10d1-4000-8000-000000000002`, e-mail `ludmilla@gdmanager.local`, sem senha, `raw_app_meta_data.role='staff'`, mesmo molde do Bidu).
- [ ] **Step 2: Aplicar** — `npx -y supabase db query --linked -f supabase/migrations/20260914120000_ludmilla.sql`.
- [ ] **Step 3: Teste de RLS** — impersonar admin de OUTRO tenant: `select count(*) from portal_accounts` = 0; impersonar `authenticated` do GD Manager e chamar `ludmilla_portal_credentials` → erro "permission denied"; dois `claim_run` seguidos com um run na fila → o segundo devolve 0 linhas. Tudo dentro de `begin; … rollback;`.
- [ ] **Step 4: Commit** — `feat(ludmilla): usuaria, tabelas, credenciais no Vault e fila`.

### Task 2: Worker — esqueleto, fila e classificador de erros

**Files:**
- Create: `worker/ludmilla/package.json`, `worker/ludmilla/tsconfig.json`, `worker/ludmilla/src/index.ts`, `worker/ludmilla/src/fila.ts`, `worker/ludmilla/src/erros.ts`, `worker/ludmilla/src/conectores/index.ts`
- Test: `worker/ludmilla/test/erros.test.ts`

**Interfaces:**
- Produces: `classificarErro(e: unknown) → { classe: 'login_recusado'|'sessao_expirada'|'captcha_exigido'|'pagina_mudou'|'bloqueado_por_waf'|'falhou'; mensagem: string; situacaoConta: 'ok'|'sessao_expirada'|'erro' }`; `ErroLudmilla` (Error com `classe`); `pegarRun()`, `finalizarRun(...)`, `credenciais(accountId)`; registro `CONECTORES: Record<string, Conector>` com `interface Conector { chave: string; loginUrl: string; reconhecer(page): Promise<Reconhecimento>; varrer(page, creds): Promise<Protocolo[]> }`.

- [ ] **Step 1: Teste vermelho** `erros.test.ts`: `classificarErro(new ErroLudmilla('captcha_exigido','…'))` → `situacaoConta='erro'` e mensagem contém "CAPTCHA"; erro genérico `new Error('x')` → `classe='falhou'`; `ErroLudmilla('sessao_expirada')` → `situacaoConta='sessao_expirada'`.
- [ ] **Step 2: Rodar** `npm test` em `worker/ludmilla` → falha (módulo não existe).
- [ ] **Step 3: Implementar** `erros.ts`, `fila.ts` (supabase-js com service role; `pegarRun` chama `ludmilla_claim_run`), `index.ts` (laço: pegar → executar → finalizar; sem run dorme `LUDMILLA_POLL_SECONDS`).
- [ ] **Step 4: Rodar** `npm test` → verde; `npm run build` (tsc) → ok.
- [ ] **Step 5: Commit** — `feat(ludmilla): worker com fila e classificacao de erros`.

### Task 3: Reconhecimento da tela de login (CPFL e Elektro)

**Files:**
- Create: `worker/ludmilla/src/reconhecer.ts`, `worker/ludmilla/src/conectores/cpfl.ts`, `worker/ludmilla/src/conectores/elektro.ts`, `worker/ludmilla/src/print.ts`
- Test: `worker/ludmilla/test/reconhecer.test.ts` (Playwright abrindo HTML local com um iframe `https://www.google.com/recaptcha/…` falso e dois inputs)

**Interfaces:**
- Produces: `reconhecerPagina(page) → Reconhecimento` com `{ url_final, titulo, captcha, campos, bloqueado_por_waf }`; `salvarPrint(page, tenantId, runId) → string` (path no bucket `ludmilla`).

- [ ] **Step 1: Teste vermelho** — HTML fixo com `<iframe src="https://www.google.com/recaptcha/api2/anchor">`, `<input name="usuario">`, `<input type="password" name="senha">` → `captcha='recaptcha'`, `campos.length=2`; HTML com título "Access Denied" e status 403 → `bloqueado_por_waf=true`.
- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar** `reconhecerPagina` (iframes/scripts de recaptcha, hcaptcha, turnstile; inputs visíveis; título/status para WAF), conectores com `loginUrl` (CPFL: `https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto`; Elektro: `https://gdneoenergiaelektro.neoenergia.com/`), `varrer` lança `ErroLudmilla('pagina_mudou', 'Conector ainda não configurado — falta a descoberta logada.')`.
- [ ] **Step 4: Rodar** → verde.
- [ ] **Step 5: Ligar no laço**: `tipo='reconhecimento'` → abre `loginUrl`, `reconhecerPagina`, print, `finalizarRun('ok', resultado)`.
- [ ] **Step 6: Commit** — `feat(ludmilla): reconhecimento da tela de login com print`.

### Task 4: Deploy na VPS (workflow manual + systemd)

**Files:**
- Create: `.github/workflows/ludmilla-worker.yml`, `worker/ludmilla/deploy/ludmilla-worker.service`, `worker/ludmilla/deploy/instalar.sh`

- [ ] **Step 1: Unit** systemd: `WorkingDirectory=/opt/ludmilla`, `EnvironmentFile=/etc/ludmilla/env`, `ExecStart=/usr/bin/node dist/index.js`, `Restart=always`, `User=ludmilla`.
- [ ] **Step 2: `instalar.sh`** (idempotente, `bash -s`, SEM `-e` nas partes de diagnóstico): Node 20 via NodeSource se `node -v` ≠ 20; usuário `ludmilla`; `npm ci --omit=dev` em `/opt/ludmilla`; `npx playwright install --with-deps chromium`; env a partir de variáveis; unit → `daemon-reload` → `enable --now`; `systemctl status --no-pager`.
- [ ] **Step 3: Workflow** `workflow_dispatch` com entrada `simular`; rsync de `worker/ludmilla/` (com `dist/` compilado no CI) para `/opt/ludmilla`; roda `instalar.sh` por SSH passando `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` dos segredos.
- [ ] **Step 4: Commit** — `ci(ludmilla): deploy do worker na VPS`.
- [ ] **Step 5: Usuário** cadastra `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_URL` nos segredos e roda o workflow. Aceite: `systemctl status` ativo no log do workflow.

### Task 5: Aceite ponta a ponta + docs

- [ ] **Step 1:** inserir dois runs `reconhecimento` (CPFL e Elektro) com `ludmilla_pedir_run`; aguardar; `select situacao, resultado, print_path from portal_sync_runs` → `ok` nos dois (ou `erro` classificado, que também é informação).
- [ ] **Step 2:** baixar os prints e mostrar ao usuário.
- [ ] **Step 3:** doc `docs/modules/integrations/ludmilla.md` + memória `ludmilla.md` + linha no `CLAUDE.md` (módulo). Commit `docs(ludmilla): …`.
