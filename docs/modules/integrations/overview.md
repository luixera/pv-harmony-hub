# Módulo: Integrações

> Visão de módulo. O catálogo completo (edge functions, segredos, serviços) está
> em [../../project/integrations.md](../../project/integrations.md).

## Objetivo
Conectar o sistema a serviços externos e encapsular a comunicação com o
Supabase (Storage, Auth, Edge Functions).

## Integrações ativas
- **Supabase** — Postgres, Auth, Storage, Edge Functions (12 funções).
- **Google Maps** — mapa e geocoding no formulário e `/projects-map`.
- **Gmail API** — Claudinho lê e-mails das concessionárias (por tenant).
- **Resend** — envio de e-mail das automações (**pendente configurar**).
- **Cloudflare Turnstile** — anti-bot no formulário público.
- **ip-api.com** — geolocalização por IP no login.
- **GitHub Actions** — CI/CD (build + rsync VPS + deploy funções + log de deploy).

## Edge Functions
`create-user`, `update-user`, `delete-user`, `signup-tenant`, `scan-emails`,
`test-gmail`, `claudinho-verifica`, `notify-dispatch`, `log-session`,
`log-event`, `sync-library`, `verify-turnstile`.

## Regras
- **RN-INT-01** — Edge function nova precisa de passo de deploy próprio no
  workflow (deploy é lista manual).
- **RN-INT-02** — `log-event` aceita não-autenticado só para lista fechada de
  ações + limite por IP.
- **RN-INT-03** — Credenciais externas ficam em Edge Secrets do Supabase, nunca
  no código.

## Futuro
- **Evolution API (WhatsApp)** por tenant. Ver roadmap.
