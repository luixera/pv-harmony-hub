# Tech Stack

## Front-end
- **React 18** + **TypeScript** (SPA).
- **Vite** (build, dev server) com `@vitejs/plugin-react-swc`.
- **TailwindCSS** + **shadcn/ui** (componentes Radix UI) + `tailwindcss-animate`
  + `@tailwindcss/typography`.
- **React Router** (`react-router-dom`) — roteamento client-side.
- **TanStack React Query** — estado de servidor (cache, mutations, invalidação).
- **React Hook Form** + **Zod** — formulários e validação (parcial; formulários
  grandes usam estado manual).
- **Recharts** — gráficos (dashboards, console, monitoramento).
- **framer-motion** — animações. **lucide-react** — ícones. **sonner** — toasts.
- **@hello-pangea/dnd** — drag-and-drop do Kanban.
- **@react-google-maps/api** — mapa e geocodificação.
- **@marsidev/react-turnstile** — CAPTCHA no formulário público.

## Geração de documentos
- **jsPDF** + **html2pdf.js** + **html2canvas** — PDFs (cartilha RESUMO,
  relatórios).
- **docxtemplater** + **pizzip** — preenchimento de templates .docx.
- **mammoth** — conversão .docx → HTML (prévia de templates).

## Back-end (Supabase)
- **Postgres** gerenciado (projeto `yqsqrdndvsnhbsoaoilf`) com **RLS**.
- **Supabase Auth (GoTrue)** — autenticação por e-mail/senha.
- **Storage** — buckets: `avatars` (público), `tenant-logos` (público),
  `project-documents`, `concessionaire-documents`, `concessionaire-templates`,
  `equipment-documents` (privados).
- **Edge Functions (Deno)** — ver [integrations.md](integrations.md).
- Cliente: `@supabase/supabase-js` v2 (`src/integrations/supabase/client.ts`).

## Serviços externos
- **Google Maps** (`VITE_GOOGLE_MAPS_API_KEY`) — mapa + geocoding.
- **Gmail API** — leitura de e-mails das concessionárias (Claudinho).
- **Resend** — envio de e-mail das automações (`notify-dispatch`).
- **Cloudflare Turnstile** (`VITE_TURNSTILE_SITE_KEY`) — anti-bot no form público.
- **ip-api.com** — geolocalização aproximada por IP no login.

## Infraestrutura
- **VPS HostGator** `143.95.221.114`, SSH porta `22022`, Nginx servindo
  `/var/www/pv-harmony-hub/dist`. SSL via certbot. Domínio
  `homologamanager.com.br`.
- **GitHub Actions** — CI/CD (`.github/workflows/deploy.yml`): build + rsync +
  deploy de edge functions + smoke test + registro de deploy.

## Convenções de versão
- Os tipos do Supabase (`src/integrations/supabase/types.ts`) são **gerados** e
  podem ficar defasados de migrações recentes; ao adicionar coluna/enum, atualize
  o arquivo (manualmente ou via `supabase gen types`). Erros de tipo
  pré-existentes por defasagem são conhecidos — ver [coding-standards.md](coding-standards.md).
