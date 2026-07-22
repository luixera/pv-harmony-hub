# Módulos — Índice

Cada módulo tem, no mínimo, `overview.md`. Os módulos **centrais** têm o conjunto
completo (`overview`, `business-rules`, `database`, `api`, `frontend`, `flow`).
Os demais têm um `overview.md` rico; os arquivos restantes são criados **quando o
módulo for alterado** (a documentação cresce junto com o código, ver
[CLAUDE.md](../../CLAUDE.md)).

## Estado por módulo

| Módulo | Estado | Docs |
|---|---|---|
| authentication | ✅ Completo (6) | overview, business-rules, database, api, frontend, flow |
| companies | ✅ Completo (6) | idem |
| projects | ✅ Completo (6) | idem |
| homologation | ✅ Completo (6) | idem |
| financial | ✅ Completo (6) | idem |
| users | ✅ Overview | overview |
| permissions | ✅ Overview | overview |
| notifications | ✅ Overview | overview |
| reports | ✅ Overview | overview |
| integrations | ✅ Overview | overview |
| ocr (Claudinho) | ✅ Overview | overview |
| customers (titulares) | ✅ Overview | overview |
| shared-generation | 🟡 Parcial | overview |
| diagrams | 🟡 A definir | overview |
| marketplace | ⛔ Planejado | overview |
| bess | ⛔ Planejado | overview |
| market-free | ⛔ Planejado | overview |

## Convenção
- **Antes de alterar um módulo**: leia o `CLAUDE.md` e só a doc deste módulo.
- **Ao alterar**: atualize `business-rules`, `database`, `api`, `flow` conforme o
  impacto, e crie os arquivos que faltarem para o módulo tocado.
- Módulos ⛔ **não recebem regras inventadas** — só passam a ter conteúdo quando
  forem realmente construídos.
