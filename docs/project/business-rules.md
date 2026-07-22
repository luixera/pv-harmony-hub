# Regras de Negócio Globais

> Regras específicas ficam no `business-rules.md` de cada módulo. Aqui estão as
> transversais, que valem para o sistema inteiro.

## RN-G01 — Isolamento de tenant
Nenhum dado de negócio pode cruzar tenants. Todo acesso é filtrado por
`tenant_id` via RLS RESTRICTIVE. Edge functions que agem com `service_role`
**devem** verificar que o alvo pertence ao mesmo tenant do solicitante.

## RN-G02 — Confiança só em `app_metadata`
Papel (`role`) e `tenant_id` do usuário são lidos de `raw_app_meta_data`
(gravado pelo servidor na criação). `user_metadata` é controlado pelo próprio
usuário e **nunca** decide autorização.

## RN-G03 — Papéis
- `admin` — fundador/gestor do tenant. Gerencia empresas, usuários,
  concessionárias, automações, financeiro.
- `staff` — projetista. Toca os projetos no Kanban. Pode ter acesso
  `global` ou `assigned_only` (só projetos atribuídos).
- `company` — empresa integradora. Abre e acompanha os próprios projetos.
- `master` (flag `profiles.is_master`) — GD Manager, administra a plataforma.

## RN-G04 — Máquina de estados do projeto
Status: `pending → analysis → documentation → approval → approved`, com desvios
`pendencia` e `vistoria_solicitada`, encerrando em `completed`. Toda mudança
grava em `project_history` com `user_id`/`user_name`. Detalhe em
[homologation/business-rules.md](../modules/homologation/business-rules.md).

## RN-G05 — Tipo de pessoa (CPF/CNPJ)
Deduzido pela quantidade de dígitos: 11 = pessoa física, 14 = pessoa jurídica.
O envio exige o número completo (11 ou 14 dígitos, nada no meio). PJ abre anexos
da empresa (cartão CNPJ, contrato social, documento do responsável, procuração).
Lib: `src/lib/cpfCnpj.ts`.

## RN-G06 — Precificação por empresa
O valor do projeto é calculado por trigger (`compute_project_value`) conforme a
`pricing_type` da empresa: `manual`, `fixed`, `per_kwp`, `tiered_kwp`,
`tiered_flat`, `monthly`. Detalhe em
[financial/business-rules.md](../modules/financial/business-rules.md).

## RN-G07 — Auditoria obrigatória
Criação/alteração/exclusão em tabelas sensíveis (`profiles`, `companies`,
`energy_concessionaires`, `tenants`, `notification_rules`,
`concessionaire_entry_rules`, `form_configs`) é registrada em `system_events`
por trigger, com autor e campos alterados. Não depende do caminho da alteração.

## RN-G08 — Limites por plano
O tenant tem um `plan` com limites (`max_projects_per_month`, `max_users`,
`ai_analyses_per_month`). Triggers (`fn_enforce_project_limit`,
`fn_enforce_user_limit`) barram excessos. Status do tenant (`trial`, `active`,
`suspended`, `canceled`) e vencimento controlam o acesso.

## RN-G09 — Persistência confiável
Toda escrita que precisa valer deve ser aguardada (`await`). O supabase-js é
lazy: builder sem `await` não envia a requisição.
