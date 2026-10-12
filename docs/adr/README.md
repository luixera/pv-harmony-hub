# ADR — Architecture Decision Records

Registro de decisões arquiteturais relevantes. Uma decisão nova e importante →
um arquivo `NNNN-titulo.md`. Formato: Contexto · Decisão · Consequências.

| # | Decisão | Status |
|---|---|---|
| [0001](0001-multi-tenant-rls.md) | Isolamento multi-tenant via RLS RESTRICTIVE | Aceito |
| [0002](0002-serverless-supabase.md) | Back-end serverless no Supabase (sem servidor próprio) | Aceito |
| [0003](0003-app-metadata-trust.md) | Confiança de papel/tenant só em `app_metadata` | Aceito |
| [0004](0004-templates-docx.md) | Templates de documento apenas em `.docx` | Aceito |
| [0005](0005-master-sem-bypass.md) | Master sem bypass de RLS no painel comum | Aceito |
| [0006](0006-cad-engine-alpha.md) | CAD Engine: fatia vertical dentro do app, antes do motor completo | Aceito |
| [0007](0007-engineering-rules-engine.md) | Motor de Engenharia: regras como dados, nunca no código | Aceito |
| [0008](0008-assinatura-append-sobre-bytes-aprovados.md) | Assinatura digital: a estampa vem antes, a assinatura é *append* sobre os bytes aprovados | Aceito |
