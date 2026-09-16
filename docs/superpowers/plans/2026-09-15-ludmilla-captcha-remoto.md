# Ludmilla — CAPTCHA remoto e sessão viva — Plano

**Spec:** `docs/superpowers/specs/2026-09-15-ludmilla-captcha-remoto-design.md`
**Restrições:** a Ludmilla nunca lê/resolve o código; nunca escreve no portal além do login; service role só na VPS.

### Task 1: Banco
**Files:** Create `supabase/migrations/20260915220000_ludmilla_captcha_remoto.sql`
- [ ] `portal_captchas` (tenant, account, run, imagem_path, situacao, resposta, respondido_por/em, tentativa, mensagem, expira_em) + RLS (equipe lê).
- [ ] `portal_accounts.sessao_viva_desde`; RPC `ludmilla_sessao_viva(p_account_id, p_viva)` (service role ou operador).
- [ ] RPCs `ludmilla_captcha_pedir` (cria linha + sino para a equipe), `ludmilla_captcha_ler`, `ludmilla_captcha_fechar` (service role ou operador); `ludmilla_captcha_responder` (equipe do tenant, só `aguardando` e dentro do prazo).
- [ ] Política DELETE em `ludmilla/{tenant}/captcha/` para o operador.
- [ ] Teste por impersonação (`begin … rollback`): operador pede/lê/fecha; staff responde; outro tenant não vê nem responde; expirado não aceita resposta.
- [ ] Commit.

### Task 2: Estação — canal do CAPTCHA remoto
**Files:** Modify `worker/ludmilla/src/fila.ts`, `src/conectores/index.ts`, `src/conectores/elektro.ts`, `src/index.ts`; Modify `test/elektro.test.ts`
- [ ] `fila.ts`: `pedirCaptcha(run, png, tentativa, mensagem)`, `lerCaptcha(id)`, `fecharCaptcha(id, situacao, mensagem)`, `sessaoViva(accountId, viva)`.
- [ ] `elektro.ts`: `fotoDoCaptcha(page)`; `entrarElektro` aceita `captchaRemoto` (pedir/esperar/fechar) e, no laço, alterna: pessoa local OU resposta remota → preenche e envia; recusa → nova foto (até 3); prazo → fecha `expirado`.
- [ ] Testes: resposta remota certa; remota errada + certa; local antes da remota; sem resposta → expirado.
- [ ] Commit.

### Task 3: Estação — sessão viva
**Files:** Modify `worker/ludmilla/src/index.ts`, `src/conectores/index.ts`, `src/conectores/elektro.ts`; test
- [ ] `Conector.manterViva?(page)`: Elektro abre a URL base (GET) e diz se continua logado.
- [ ] `index.ts` (modo local): contexto vivo por portal, reutilizado pelo próximo run; a cada 10 min `manterViva` → `sessaoViva(true/false)`; morreu → fecha, loga a duração.
- [ ] Testes: `manterVivaElektro` true/false com o portal de mentira.
- [ ] Commit; deploy (artefato novo da estação).

### Task 4: Página /ludmilla e sino
**Files:** Modify `src/hooks/useLudmilla.ts`, `src/pages/Ludmilla.tsx`, `src/components/layout/Topbar.tsx`
- [ ] `usePortalCaptchas()` (aguardando, refetch 5 s), `useResponderCaptcha()`.
- [ ] Cartão "Digite o código da imagem" (foto, campo, Enviar, prazo, tentativa/mensagem) no topo da página; "sessão viva desde" no cartão da conta.
- [ ] Sino: tipo `ludmilla` navega para `/ludmilla`, ícone 📡.
- [ ] tsc 65; build; commit; push.

### Task 5: Docs e memória
- [ ] `docs/modules/integrations/ludmilla.md`, `LEIA-ME.txt` da estação, memória `ludmilla.md`.
