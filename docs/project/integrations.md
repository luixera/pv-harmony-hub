# Integrações

## Edge Functions (Supabase, Deno)
`supabase/functions/`:

| Função | JWT | Papel | O que faz |
|---|---|---|---|
| `create-user` | verifica | admin | Cria usuário no tenant com `app_metadata` (role/tenant). |
| `update-user` | verifica | admin | Atualiza usuário; **checa tenant do alvo**. |
| `delete-user` | — | admin | Exclui usuário; checa tenant do alvo. |
| `signup-tenant` | — | público | Autocadastro: cria tenant + fundador (admin) + semeia biblioteca. |
| `scan-emails` | — | cron/admin | Varre Gmail por tenant, casa e-mails a protocolos (Claudinho). |
| `test-gmail` | — | admin | Testa credenciais Gmail do tenant. |
| `claudinho-verifica` | — | interno | Análise de e-mail/documento (sugere etapa/protocolo). |
| `diagram-recognize` | — | interno (GD Manager) | Reconhece componentes/ligações de um diagrama unifilar (PDF/imagem) via IA de visão (Opus + adaptive thinking) — mesmo padrão do `claudinho-verifica`. |
| `diagram-review` | — | interno (GD Manager) | "Engenheiro revisor": 2ª passada que compara o original com o redesenho (imagem + JSON) e devolve o diagrama corrigido + notas. |
| `notify-dispatch` | — | interno | Renderiza template e envia e-mail via Resend. |
| `log-session` | verifica | usuário | Registra sessão de acesso (IP + geo). |
| `log-event` | — (lista fechada) | qualquer | Recebe erros/segurança/deploy p/ `system_events`. |
| `sync-library` | — | interno | Copia biblioteca (concessionárias, regras, pacote, templates) p/ o tenant. |
| `verify-turnstile` | — | público | Valida CAPTCHA do formulário público. |

## Serviços externos

- **Google Maps** — mapa e geocoding no formulário e no mapa de projetos.
  Segredo `VITE_GOOGLE_MAPS_API_KEY`.
- **Gmail API** — leitura de e-mails das concessionárias (assistente Claudinho).
  Credenciais por tenant em `agent_config`. Setup em `docs/GMAIL_SETUP.md`.
- **Resend** — envio de e-mail das automações. Segredos `RESEND_API_KEY`,
  domínio verificado, `NOTIFY_FROM`. **Pendência**: configurar para as
  automações realmente enviarem.
- **Cloudflare Turnstile** — anti-bot no form público
  (`VITE_TURNSTILE_SITE_KEY`).
- **ip-api.com** — geolocalização por IP no login (best-effort).
- **Evolution API (WhatsApp)** — planejado: motor de regras evento→WhatsApp por
  tenant, rodando na VPS. Ver [roadmap.md](roadmap.md).

## Segredos (GitHub Actions / Supabase)
- GitHub: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_GOOGLE_MAPS_API_KEY`, `VITE_TURNSTILE_SITE_KEY`, `SUPABASE_ACCESS_TOKEN`,
  `DEPLOY_LOG_TOKEN`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PORT`.
- Supabase Edge Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DEPLOY_LOG_TOKEN`, `ANTHROPIC_API_KEY`
  (`claudinho-verifica`, `diagram-recognize` e `diagram-review`), credenciais Gmail/Resend.

## Deploy de funções
O job `deploy-functions` publica **uma a uma** (não todas da pasta). Ao criar
uma edge function nova, **adicione o passo de deploy** em
`.github/workflows/deploy.yml` — senão ela não sobe (foi o caso de
`log-event`). Exceção: `claudinho-verifica`, `diagram-recognize` e
`diagram-review` **não** estão no CI — publicadas manualmente via MCP
`deploy_edge_function` (`verify_jwt: false`, pois cada uma faz a própria
checagem de Authorization).
