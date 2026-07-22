# ADR 0005 — Master sem bypass de RLS no painel comum

**Status:** Aceito · jul/2026

## Contexto
As 35 políticas RESTRICTIVE de isolamento tinham `is_master(auth.uid()) OR ...`.
Efeito colateral: quando o master usava o app normal, via concessionárias,
projetos e empresas de **todos** os tenants (apareciam "duplicados"). Além de
confuso, era exposição indevida.

## Decisão
Remover o bypass `is_master OR ...` de todas as políticas de isolamento. O master
acessa dados agregados **apenas** pelo console `/painel`, via RPCs
`SECURITY DEFINER` explicitamente `is_master`-gated.

## Consequências
- O master, logado no app comum, só vê o próprio tenant (GD Manager).
- Qualquer visão cross-tenant exige uma RPC dedicada e auditável.
- Reduz a superfície de vazamento acidental.
