# 🛡️ Pacote de Correções da Auditoria

Pasta com os achados da auditoria de segurança/performance/qualidade do `pv-harmony-hub`, e patches prontos pra aplicar quando você quiser.

## 📁 Arquivos

| Arquivo | Pra que serve |
|---|---|
| [AUDITORIA.md](AUDITORIA.md) | Relatório consolidado completo. **Leia primeiro.** 6 agentes auditaram em paralelo. |
| [PRIORIDADES.md](PRIORIDADES.md) | Lista numerada do que aplicar e em que ordem. **Comece por aqui se quiser ir direto pra ação.** |
| [sql/001_security_critical.sql](sql/001_security_critical.sql) | **CRÍTICO** — Fechar buracos de escalação de privilégio e vazamento de dados. Aplicar primeiro. |
| [sql/002_security_high.sql](sql/002_security_high.sql) | Fechar buracos de severidade alta (revisions, comments, storage). |
| [sql/003_database_cleanup.sql](sql/003_database_cleanup.sql) | Unificar tabelas financeiras + criar tabelas que estão sendo referenciadas no código mas não existem. |
| [sql/004_performance_indexes.sql](sql/004_performance_indexes.sql) | Adicionar índices em FKs órfãs. Melhora performance de DELETE/UPDATE da tabela pai. |
| [supabase-config.md](supabase-config.md) | Configurações que precisam ser feitas no Dashboard Supabase (não SQL). |

## ⚠️ Antes de aplicar

1. **Backup completo** do banco. No Dashboard Supabase: Database → Backups → criar manualmente.
2. **Teste em projeto espelho** se possível (clone do Supabase). Senão, aplique 1 arquivo por vez e teste a aplicação entre cada um.
3. **Aplique em ordem numérica** (001 → 002 → 003 → 004). Os patches dependem uns dos outros.
4. **Não aplique tudo numa única transação** — alguns arquivos contêm `ALTER TYPE ADD VALUE` que precisa rodar autocommit.

## 🚀 Como aplicar cada SQL

**No Supabase Dashboard:**
1. Acessa: https://supabase.com/dashboard → projeto → menu lateral → **SQL Editor**
2. Clica em **New query**
3. Abre o arquivo `.sql` daqui no GitHub, copia o conteúdo
4. Cola no SQL Editor
5. Clica **Run**
6. Verifica o output (devem ser "Success. No rows returned" ou similar)
7. Testa a aplicação no homologamanager.com.br
8. Próximo arquivo

**Localmente via supabase CLI:** se você usa o CLI, pode rodar `supabase db push` apontando os arquivos pra `supabase/migrations/`. Mas o caminho via dashboard é o mais seguro.

## 🐛 Se algo quebrar

- Cada arquivo SQL é **idempotente** (pode rodar de novo sem dar erro).
- Cada `CREATE POLICY` é precedido por `DROP POLICY IF EXISTS` correspondente.
- Cada `ALTER FUNCTION` é `CREATE OR REPLACE FUNCTION` — sobrescreve com segurança.
- Em caso de problema, restaure o backup do passo 1 acima.

## 📋 Ordem recomendada de aplicação

1. **Hoje:** ler `AUDITORIA.md` (entender o que tem)
2. **Próxima sessão:** aplicar `sql/001_security_critical.sql` (fecha os 5 vetores de ataque mais graves)
3. **Quando der tempo:** `sql/002_security_high.sql` (revisions, comments, storage)
4. **Antes de mais usuários:** `sql/003_database_cleanup.sql` (unifica financials, cria tabelas faltantes)
5. **Pra escala:** `sql/004_performance_indexes.sql`

A auditoria também mapeou correções de frontend (forms sem validação Zod, lazy load, dark mode quebrado, etc.). Estão descritas em `AUDITORIA.md` mas não vêm com patch pronto — são mudanças que ficam mais sólidas se você (ou seu Claude/Cursor) fizer com contexto do código.
