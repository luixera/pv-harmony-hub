# CLAUDE.md — Índice da Base de Conhecimento

> **GD Manager Energy** (repositório `pv-harmony-hub`) — SaaS multi-tenant para
> homologação de projetos fotovoltaicos (geração distribuída) junto às
> concessionárias de energia.

Este arquivo é o **índice** da documentação. Ele não contém documentação
extensa — só o resumo e os links. Antes de qualquer tarefa: **leia este arquivo,
depois leia apenas a documentação do módulo que será alterado.**

---

## Resumo da arquitetura

SPA React (Vite + TypeScript) servida como estático na VPS (HostGator, Nginx),
com **Supabase** como back-end completo: Postgres + Auth + Storage + Edge
Functions (Deno). Não há back-end próprio — a lógica de servidor vive em
**RPCs SQL** (`SECURITY DEFINER`) e **Edge Functions**. O isolamento entre
clientes é feito por **Row Level Security (RLS) multi-tenant** no Postgres.

- **Multi-tenant**: cada empresa assinante é um `tenant`. Todo dado de negócio
  carrega `tenant_id` e é isolado por políticas RLS RESTRICTIVE. Há um papel
  **master** (GD Manager) que administra a plataforma via console `/painel`.
- **Papéis dentro do tenant**: `admin` (fundador/gestor), `staff` (projetista),
  `company` (empresa integradora que envia projetos).
- Deploy por **GitHub Actions** → build Vite + `rsync` para a VPS + deploy das
  Edge Functions. Cada publicação é registrada no painel de monitoramento.

Detalhes: [docs/project/architecture.md](docs/project/architecture.md).

## Stack

React 18 · TypeScript · Vite · TailwindCSS + shadcn/ui (Radix) · React Query ·
React Router · Supabase (Postgres/Auth/Storage/Edge Functions Deno) ·
jsPDF/html2pdf · docxtemplater + PizZip + mammoth (templates .docx) ·
Google Maps · Recharts · Resend (e-mail) · Turnstile (CAPTCHA).

Detalhes: [docs/project/tech-stack.md](docs/project/tech-stack.md).

## Estrutura dos módulos

| Módulo | Estado | Doc |
|---|---|---|
| Autenticação | ✅ Implementado | [modules/authentication](docs/modules/authentication/overview.md) |
| Empresas (integradoras) | ✅ | [modules/companies](docs/modules/companies/overview.md) |
| Titulares / Clientes | ✅ (dentro de projetos) | [modules/customers](docs/modules/customers/overview.md) |
| Projetos | ✅ (núcleo) | [modules/projects](docs/modules/projects/overview.md) |
| Homologação (Kanban/protocolos) | ✅ | [modules/homologation](docs/modules/homologation/overview.md) |
| OCR / Análise por IA (Claudinho) | ✅ | [modules/ocr](docs/modules/ocr/overview.md) |
| Financeiro | ✅ | [modules/financial](docs/modules/financial/overview.md) |
| Relatórios | ✅ | [modules/reports](docs/modules/reports/overview.md) |
| Notificações e automações | ✅ | [modules/notifications](docs/modules/notifications/overview.md) |
| Integrações | ✅ | [modules/integrations](docs/modules/integrations/overview.md) |
| Usuários | ✅ | [modules/users](docs/modules/users/overview.md) |
| Permissões (RLS) | ✅ | [modules/permissions](docs/modules/permissions/overview.md) |
| Geração compartilhada | 🟡 Parcial | [modules/shared-generation](docs/modules/shared-generation/overview.md) |
| Diagramas (unifilar) | 🟡 Alpha — só master/GD Manager | [modules/diagrams](docs/modules/diagrams/overview.md) |
| Motor de Engenharia (regras) | 🟡 Fase 1 — só GD Manager | [modules/engineering](docs/modules/engineering/overview.md) |
| Marketplace | ⛔ Planejado | [modules/marketplace](docs/modules/marketplace/overview.md) |
| BESS (armazenamento) | ⛔ Planejado | [modules/bess](docs/modules/bess/overview.md) |
| Mercado Livre de energia | ⛔ Planejado | [modules/market-free](docs/modules/market-free/overview.md) |

## Principais regras (resumo — detalhe em cada módulo)

- **Isolamento de tenant é inegociável.** Nenhuma query de negócio pode cruzar
  tenants. RLS é a última linha; edge functions verificam tenant do alvo.
- **Confiança vem de `app_metadata`**, nunca de `user_metadata` (o usuário
  controla o segundo). Papel e tenant do usuário são gravados em
  `raw_app_meta_data` na criação.
- **Etapas do projeto** (status): `pending → analysis → documentation →
  approval → approved`, com desvios `pendencia` e `vistoria_solicitada`, e
  `completed` ao final. Toda mudança é registrada em `project_history` com o
  autor. Ver [homologation/business-rules.md](docs/modules/homologation/business-rules.md).
- **CPF/CNPJ**: tipo de pessoa deduzido pela quantidade de dígitos (11=PF,
  14=PJ). PJ abre anexos da empresa. Ver [customers/business-rules.md](docs/modules/customers/business-rules.md).
- **Precificação por empresa**: `manual`, `fixed`, `per_kwp`, `tiered_kwp`,
  `tiered_flat`, `monthly` — calculada por trigger no banco. Ver
  [financial/business-rules.md](docs/modules/financial/business-rules.md).
- **supabase-js é lazy**: um query builder sem `await`/`.then()` nunca envia a
  requisição. Sempre aguarde inserts que precisam persistir.

## Regras de manutenção da documentação

Ao criar ou alterar uma funcionalidade, **atualize antes de finalizar**:
doc do módulo · banco · endpoints/RPCs · fluxos · regras de negócio ·
permissões · integrações · roadmap (quando aplicável). Decisão arquitetural
relevante → criar um ADR em [docs/adr](docs/adr/README.md).

## Ponto de restauração

Código: tag git `restauracao/2026-07-21` (commit `9c7afc4`). Esquema do banco:
versionado em `supabase/migrations/`. Dados: PITR do Supabase.

## Documentação de projeto (transversal)

- [architecture.md](docs/project/architecture.md) — arquitetura e padrões
- [tech-stack.md](docs/project/tech-stack.md) — tecnologias e versões
- [coding-standards.md](docs/project/coding-standards.md) — padrões de código
- [naming-conventions.md](docs/project/naming-conventions.md) — nomenclatura
- [business-rules.md](docs/project/business-rules.md) — regras globais
- [permissions.md](docs/project/permissions.md) — papéis e acessos
- [security.md](docs/project/security.md) — postura de segurança
- [integrations.md](docs/project/integrations.md) — serviços externos
- [roadmap.md](docs/project/roadmap.md) — pendências e futuro
- [glossary.md](docs/project/glossary.md) — glossário do domínio
- [ADRs](docs/adr/README.md) · [Decisões](docs/decisions/README.md)
