# Permissões e Papéis

Detalhe técnico (políticas RLS, RPCs) em
[modules/permissions/overview.md](../modules/permissions/overview.md).

## Papéis

| Papel | Origem | Escopo | Acessa |
|---|---|---|---|
| `master` | `profiles.is_master = true` | Plataforma | Console `/painel`, RPCs master-only |
| `admin` | `role='admin'` | Seu tenant | Empresas, usuários, financeiro, concessionárias, automações, config |
| `staff` | `role='staff'` | Seu tenant | Kanban, tarefas, e-mails, mapa; projetos conforme `staff_access_mode` |
| `company` | `role='company'` | Sua empresa | Abre e acompanha os próprios projetos e financeiro |

## Modo de acesso do staff
`profiles.staff_access_mode`:
- `global` — vê todos os projetos do tenant.
- `assigned_only` — só projetos atribuídos a ele (`project_assignments`). Ao
  tentar abrir um projeto não atribuído (ex.: via tela de e-mails), o modal
  mostra "Projeto não atribuído a você" e registra `forbidden_access`.

## Matriz resumida (telas)

| Rota | admin | staff | company | master |
|---|---|---|---|---|
| `/projects` (Kanban) | ✅ | ✅ | — | — |
| `/company/projects` | — | — | ✅ | — |
| `/new-project` | ✅ | ✅ | ✅ | — |
| `/admin/*` | ✅ | — | — | — |
| `/company/financial` | — | — | ✅ | — |
| `/admin/financial` | ✅ | — | — | — |
| `/tasks`, `/email-updates`, `/projects-map` | ✅ | ✅ | — | — |
| `/painel` (console) | — | — | — | ✅ |
| `/public-form/:token` | público (anônimo, via token da empresa) | | | |

## Regras-chave
- O **master não vê dados de tenants no painel comum** — só via RPCs do console
  `/painel`, todas `is_master`-gated. As políticas de isolamento não têm bypass
  de master (decisão de segurança).
- Cada tenant cria seus próprios usuários (`company` e `staff`) sem interferir
  em outros tenants. Edge functions `create-user`/`update-user`/`delete-user`
  verificam o tenant do alvo.
- O formulário público é **anônimo**, autorizado só pelo token da empresa
  (`public_form_token`); RPCs específicas expõem apenas o necessário
  (concessionárias do tenant, logo do tenant) validando o token.
