# AUDIT-FIXES — GD Manager Energy

Repositório de correções de segurança, performance e limpeza do banco resultantes da auditoria técnica de 2026-05-19.

## Estrutura

```
docs/AUDIT-FIXES/
├── README.md          ← este arquivo
├── PRIORIDADES.md     ← ~70 problemas priorizados por severidade
├── AUDITORIA.md       ← relatório consolidado dos 6 agentes
├── APLICADOS.md       ← checklist do que foi aplicado + quando
└── sql/
    ├── 001_security_critical.sql  ← ✅ APLICADO 2026-05-19
    ├── 002_security_high.sql      ← ✅ APLICADO 2026-05-19
    ├── 003_database_cleanup.sql   ← ✅ APLICADO 2026-05-19
    └── 004_performance_indexes.sql ← ✅ APLICADO 2026-05-19
```

## Como aplicar um SQL

1. Acesse [Supabase Dashboard](https://supabase.com/dashboard/project/yqsqrdndvsnhbsoaoilf)
2. Vá em **SQL Editor → New query**
3. Cole o conteúdo do arquivo desejado
4. Clique em **Run**
5. Teste a aplicação em produção
6. Marque como aplicado em `APLICADOS.md`

> ⚠️ Faça backup antes: **Database → Backups → Create backup now**

## Ordem de aplicação

Os scripts são idempotentes (seguros para re-executar), mas devem ser aplicados na ordem numérica pois 003 depende de 001 e 004 depende de 003.
