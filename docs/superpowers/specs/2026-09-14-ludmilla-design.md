# Ludmilla — acompanhamento dos portais das concessionárias

**Data:** 2026-09-14 · **Estado:** aprovado em conversa (abordagem A e seção
de dados), gravado para referência · **Escopo desta spec:** sub-projeto 1
(fundação + robô na VPS + reconhecimento dos portais). Conectores por portal
e a página de relatório são sub-projetos seguintes, com spec própria.

## 1. O que é

Uma funcionária do GD Manager, como o Engenheiro Bidu: usuária `staff` de
verdade (assina no histórico, aparece na equipe), cuja rotina é **entrar nos
portais de projetos das concessionárias, ler o status de cada protocolo e
refletir no GD Manager** — como recomendação, nunca movendo card sozinha.

### Decisões do usuário (set/2026)

| Pergunta | Decisão |
|---|---|
| Sentido | **Só leitura**: portal → GD Manager. Nunca escreve no portal. |
| Ação ao detectar mudança | **Página de relatório com recomendação**; uma pessoa aplica ou ignora. |
| Alcance | **Só tenant GD Manager** (`tenants.is_library`), como o Bidu. Abrir depois é chave de plano. |
| Protocolo sem par | Tenta casar por **UC ou titular** e sugere gravar o protocolo (mesma lógica do Claudinho dos e-mails). |
| Frequência | **Agendado 2× ao dia** (08h/17h Brasília, configurável) **+ botão "Verificar agora"**. |
| Aviso | **Contador na barra lateral + notificação interna** (sino) para o projetista responsável. |
| Primeiros portais | **CPFL** (Projetos Particulares) e **Elektro** (Portal GD Neoenergia). |
| Onde roda | **Abordagem A**: serviço próprio na VPS, Node + Playwright, Chromium sem tela. |

### O que a investigação mostrou (13/09/2026)

Nenhum dos dois portais publica API, webhook ou exportação. CPFL usa um
autenticador central (`/cpfl-auth/redirect-arame` → `/Internet/Projeto`);
o Portal GD da Elektro devolve **403 a cliente que não é navegador** (WAF).
Se há CAPTCHA/2FA no login, só se descobre logado — por isso o sub-projeto 1
inclui um **reconhecimento** que abre a tela de login sem credencial, tira
print e procura widget de CAPTCHA e campos do formulário.

## 2. Limites (o que a Ludmilla NÃO faz)

- Não escreve, protocola nem anexa nada no portal.
- Não move card: grava recomendação; quem aplica é uma pessoa, e o histórico
  registra a pessoa como autora e a Ludmilla como origem.
- **Não resolve CAPTCHA**, nem por relé para humano. Se o login exigir CAPTCHA
  em toda visita, a contingência é **importar a sessão**: o admin loga no
  próprio navegador e cola os cookies na aba Concessionárias; a Ludmilla
  reusa até expirar e avisa quando expirar. Só entra no plano se o
  reconhecimento mostrar necessidade.
- Visita cada portal no máximo 2× ao dia + pedidos manuais, uma página por
  vez, com pausas humanas entre ações. Nunca em paralelo no mesmo portal.

## 3. Arquitetura

```
┌─ GD Manager (SPA) ─────────────┐        ┌─ Supabase ─────────────────────┐
│ Aba Concessionárias            │  RPC   │ portal_accounts  (login + Vault)│
│   "Acesso ao portal" (admin)   ├───────►│ portal_sync_runs (fila + log)  │
│ Página /ludmilla (relatório)   │◄───────┤ portal_updates   (relatório)   │
│ Sidebar: contador              │        │ portal_status_map (tradução)   │
└────────────────────────────────┘        │ storage: bucket `ludmilla`     │
                                          └───────────▲────────────────────┘
                                                      │ service role
                                          ┌───────────┴────────────────────┐
                                          │ VPS · ludmilla-worker (systemd)│
                                          │ Node 22 + Playwright/Chromium  │
                                          │ pega run da fila → conector →  │
                                          │ grava resultado + print        │
                                          └────────────────────────────────┘
                                                      │
                                     ┌────────────────┴───────────────┐
                                     │ Portais: CPFL · Elektro (Neo.) │
                                     └────────────────────────────────┘
```

### 3.1 Dados (Postgres, RLS por tenant)

- **`portal_accounts`** — uma por concessionária do tenant.
  `id, tenant_id, concessionaire_id, connector ('cpfl'|'elektro'), login,
  secret_id (uuid → vault.secrets), situacao ('nao_configurado'|'ok'|
  'sessao_expirada'|'erro'), ultimo_erro, ultima_varredura_em, enabled,
  created_by, created_at, updated_at`. Único por `(tenant_id, concessionaire_id)`.
  A senha **nunca** está aqui: entra por RPC e mora no Vault.
- **`portal_sync_runs`** — fila e histórico ao mesmo tempo.
  `id, tenant_id, account_id, tipo ('reconhecimento'|'varredura'),
  situacao ('na_fila'|'rodando'|'ok'|'erro'), pedido_por, pedido_em,
  iniciado_em, terminado_em, protocolos_lidos, mudancas, erro (português),
  print_path (storage), resultado jsonb`.
- **`portal_updates`** — a linha do relatório (sub-projeto 2 preenche; a
  tabela nasce agora). `id, tenant_id, run_id, account_id, protocolo,
  titular_portal, status_portal, status_anterior, project_id, casamento
  ('protocolo'|'uc'|'titular'|null), recomendacao (etapa do Kanban),
  situacao ('pendente'|'aplicada'|'ignorada'), aplicada_por, aplicada_em,
  detectado_em, raw jsonb`.
- **`portal_status_map`** — `tenant_id, connector, status_portal,
  project_status`, editável; semeada pelo que a descoberta encontrar.
- **Storage** — bucket privado `ludmilla` para prints (`{tenant}/{run}.png`).

### 3.2 Credenciais

- RPC `set_portal_credentials(concessionaire_id, login, senha)` —
  `SECURITY DEFINER`, só admin do tenant, só tenant `is_library`. Grava a
  senha com `vault.create_secret` (ou `vault.update_secret` se já existe) e
  o `secret_id` na conta. Nunca devolve a senha.
- RPC `ludmilla_portal_credentials(account_id)` — devolve `login, senha,
  connector, login_url`; **só `service_role`** (checa `auth.role()`), com
  `REVOKE` para `authenticated`/`anon`. É o único caminho de leitura.
- O front mostra "configurado ✓ · login" e um botão para trocar a senha.

### 3.3 Fila

- `ludmilla_claim_run()` — RPC service-role: pega o run mais antigo
  `na_fila` com `FOR UPDATE SKIP LOCKED`, marca `rodando` e devolve. Um
  worker só; a trava evita duplicar se um dia houver dois.
- "Verificar agora" = `INSERT` em `portal_sync_runs` com `tipo='varredura'`
  (RPC `ludmilla_pedir_varredura(account_id)`, admin/staff do tenant).
  Reconhecimento = mesmo INSERT com `tipo='reconhecimento'`.
- Agendamento 2× ao dia via `pg_cron` — entra no sub-projeto 2, quando
  houver conector para rodar.

### 3.4 Worker (VPS)

- Pasta `worker/ludmilla/` no repositório: Node 22, TypeScript, Playwright.
  Serviço `ludmilla-worker.service` (systemd), ambiente em
  `/etc/ludmilla/env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `LUDMILLA_POLL_SECONDS=30`).
- Laço: a cada N segundos chama `ludmilla_claim_run()`; sem run, dorme.
  Com run: carrega credenciais pela RPC (só na `varredura`), abre Chromium
  com **contexto novo por run** (locale pt-BR, viewport 1366×768, user agent
  de Chrome comum), executa o conector, grava resultado; em erro, print +
  mensagem em português + `situacao='erro'`, e a conta vai a
  `sessao_expirada` ou `erro` conforme a classe do erro.
- **Conector** = módulo com a interface
  `{ chave, loginUrl, reconhecer(page) → Reconhecimento, varrer(page, creds)
  → Protocolo[] }`. Sub-projeto 1 entrega `reconhecer` para CPFL e Elektro
  (sem credencial) e `varrer` lançando "conector ainda não configurado".
- `Reconhecimento` = `{ url_final, titulo, captcha: 'recaptcha'|'hcaptcha'|
  'turnstile'|'nenhum'|'desconhecido', campos: {tipo, name, id,
  placeholder}[], bloqueado_por_waf: boolean, print_path }`.
- Deploy por workflow **manual** `.github/workflows/ludmilla-worker.yml`:
  instala Node 20 e dependências do Chromium na VPS (idempotente), rsync da
  pasta, `npm ci`, `npx playwright install chromium`, escreve o env a
  partir dos segredos, instala/recarrega a unit, mostra `systemctl status`.
  Exige o segredo **`SUPABASE_SERVICE_ROLE_KEY`** no GitHub (o usuário
  cadastra; nunca passa pela conversa).

### 3.5 Erros

Toda falha vira frase em português em `portal_sync_runs.erro` e um print no
bucket. Classes: `login_recusado` (conta → `erro`), `sessao_expirada`
(conta → `sessao_expirada`), `captcha_exigido` (conta → `erro`, mensagem
explica a contingência), `pagina_mudou` (seletor não achado; conta segue
`ok`, run `erro`), `bloqueado_por_waf`, `falhou` (genérico). O worker nunca
grava recomendação quando não entendeu a página.

### 3.6 Testes

- Postgres: RLS por impersonação (`begin; set_config(...); rollback`) —
  admin de outro tenant não vê contas; `authenticated` não consegue chamar
  `ludmilla_portal_credentials`; `claim_run` não entrega o mesmo run duas
  vezes.
- Worker: testes unitários (node:test) para o classificador de erro e para
  o detector de CAPTCHA/campos sobre HTML fixo; teste de integração local
  do laço com a fila usando uma página HTML servida em `localhost`.
- Aceite do sub-projeto 1: workflow roda, unit ativa na VPS, um run de
  `reconhecimento` para CPFL e outro para Elektro terminam em `ok` com
  print no bucket e o JSON de reconhecimento preenchido.

## 4. Fora deste sub-projeto (próximos)

2. Conectores `varrer` de CPFL e Elektro (dependem da descoberta logada),
   tradução de status, casamento protocolo/UC/titular, `portal_updates`,
   pg_cron 2× ao dia.
3. Página `/ludmilla` (relatório + aplicar/ignorar), tela de credenciais na
   aba Concessionárias, contador na sidebar, notificação interna.
4. Contingência de sessão importada (só se o reconhecimento exigir).
