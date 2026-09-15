# Ludmilla — Elektro pela estação local — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O mesmo robô da Ludmilla rodando numa máquina Windows do coworking, com Chrome de verdade, lendo o Portal GD da Elektro depois que uma pessoa digita o CAPTCHA — e o agendamento 2×/dia para todas as contas.

**Architecture:** `worker/ludmilla` ganha `LUDMILLA_MODO=local` (usuário staff dedicado em vez de service role, Chrome com janela e perfil persistente, só contas `modo='local'`); RPCs "_local" no banco checam tenant + `operador_local`; conector Elektro com login assistido (robô preenche e-mail/senha, pessoa digita o CAPTCHA); descoberta guarda as telas JSF; `varrer` vem depois, escrito sobre elas.

**Tech Stack:** Node 22 + Playwright (channel chrome, headed), supabase-js com sessão persistida em arquivo, Postgres RPCs, pg_cron, PowerShell (instalador/aviso).

**Spec:** `docs/superpowers/specs/2026-09-15-ludmilla-elektro-local-design.md`

## Global Constraints

- Nunca resolver CAPTCHA; nunca chamar rota de escrita do portal.
- Service role NUNCA sai da VPS: a estação usa o usuário `ludmilla.coworking` (staff) e RPCs `_local` que exigem `operador_local = auth.uid()`.
- Mensagens e identificadores novos em português. Testes: `npm test` em `worker/ludmilla` (node:test, herméticos). Baseline do app: tsc = 65, build ok.

---

### Task 1: Banco — modo local, operador, RPCs `_local`, cron 2×/dia

**Files:** Create `supabase/migrations/20260915170000_ludmilla_estacao_local.sql`

- [ ] Colunas em `portal_accounts`: `modo`, `operador_local`, `estacao_vista_em`; usuário `ludmilla.coworking` (`00000000-10d1-4000-8000-000000000003`, staff, sem senha — a senha é definida pelo admin na tela de Usuários, como qualquer staff).
- [ ] `ludmilla_finalizar_run_impl(...)` (sem checagem de papel) + `ludmilla_finalizar_run` (service role) e `ludmilla_finalizar_run_local` (operador) delegando; idem `claim`, `credentials`, `anexos_pendentes`, `anexo_enviado`, `anexo_erro`, `protocolos_de_interesse`, `estacao_pulsa`.
- [ ] Sino para admins quando conta local fica `sessao_expirada`.
- [ ] `ludmilla_agendar_varreduras()` + `cron.schedule('ludmilla-08h', '0 11 * * *', …)` e `'ludmilla-17h', '0 20 * * *'`.
- [ ] Teste por impersonação: operador certo pega run; outro staff do tenant não; outro tenant não; cron insere sem duplicar.
- [ ] Commit.

### Task 2: Robô — modo local (auth por usuário, Chrome com janela, aviso)

**Files:** Modify `worker/ludmilla/src/fila.ts`, `src/index.ts`; Create `src/local.ts` (sessão em arquivo + aviso do Windows), `test/local.test.ts`

- [ ] `local.ts`: `carregarSessao()/guardarSessao()` em `%LOCALAPPDATA%\Ludmilla\sessao.json`; `avisar(titulo, texto)` via PowerShell (balão); `dirPerfilChrome()`.
- [ ] `fila.ts`: cliente supabase por modo (`anon key + sessão do usuário` no local); funções `pegarRun/finalizarRun/credenciais/...` chamam a RPC certa conforme `LUDMILLA_MODO`.
- [ ] `index.ts`: no local, `launchPersistentContext` (chrome, headed); fecha o contexto ao fim de cada run; heartbeat.
- [ ] Testes: escolha da RPC por modo; sessão gravada/lida; sem rede.
- [ ] Commit.

### Task 3: Conector Elektro — login assistido e descoberta

**Files:** Modify `worker/ludmilla/src/conectores/elektro.ts`; Create `test/elektro.test.ts` (HTML local do formulário JSF)

- [ ] `entrar`: detecta formulário (`input[id$=":captchaCode"]`), preenche e-mail/senha nos campos `j_idt14:j_idt16`/`j_idt14:j_idt18` (seletores por sufixo `[id$=...]`, o prefixo pode mudar), foca o CAPTCHA, avisa, `waitForFunction` até o formulário sumir (5 min) → senão `sessao_expirada`.
- [ ] `descobrir`: depois do login, guarda `01-inicio`, lista de solicitações (procurando por texto "Solicita" / tabela PrimeFaces), paginação, primeiro detalhe.
- [ ] `varrer`: lança `pagina_mudou` "roteiro da Elektro é escrito depois da descoberta".
- [ ] Commit.

### Task 4: Instalador Windows + deploy

**Files:** Create `worker/ludmilla/deploy/windows/instalar.ps1`, `atualizar.ps1`, `Ludmilla.cmd`; Modify `.github/workflows/ludmilla-worker.yml` (artefato zip do worker para a estação baixar)

- [ ] Workflow publica `ludmilla-local.zip` (dist + package.json + deploy/windows) como artefato/release.
- [ ] `instalar.ps1`: winget Node 22 se faltar; extrai em `%LOCALAPPDATA%\Ludmilla\app`; `npm ci --omit=dev`; pede e-mail/senha do usuário da estação (Read-Host, senha mascarada) e roda `node dist/index.js --login` para gravar a sessão; registra tarefa "Ludmilla" no logon (`schtasks`), inicia.
- [ ] Commit.

### Task 5: Página /ludmilla — estação e conta local

**Files:** Modify `src/pages/Ludmilla.tsx`, `src/hooks/useLudmilla.ts`, `src/components/concessionaires/PortalAcessoDialog.tsx`

- [ ] Conta mostra "estação local: online há X min / offline" (heartbeat) e "aguardando login" quando o último run fechou `sessao_expirada`.
- [ ] No diálogo de acesso: escolher `modo` (VPS / estação local) e o operador (lista de staff do tenant).
- [ ] Commit; tsc 65; build.

### Task 6: Aceite

- [ ] Na máquina do coworking: instalar, "Verificar agora" na Elektro, pessoa digita o CAPTCHA, descoberta em `ok` com telas no bucket. Só então: Task 7 (roteiro `varrer` da Elektro, plano próprio).
