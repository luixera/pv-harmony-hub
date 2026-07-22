# Módulo: Empresas (Integradoras)

## Objetivo
Cadastrar e gerenciar as **empresas integradoras** (clientes do tenant) que
enviam projetos. Todo projeto pertence a uma empresa. Cada empresa tem um **link
público** de formulário e uma **regra de precificação**.

## Funcionalidades
- CRUD de empresas (admin) — `src/pages/admin/Companies.tsx`.
- Link público por empresa (`public_form_token`) → `/public-form/:token`.
- Precificação por empresa (ver [financial](../financial/overview.md)).
- **Logotipo da empresa** (upload no cadastro pelo admin; autoatendimento pela
  própria empresa no perfil).
- Contato (nome, e-mail, telefone) usado como padrão no formulário.

## Banco
`companies` (19 colunas) — ver [database.md](database.md).

## APIs / hooks
- `src/hooks/useCompanies.ts` — `useCompanies`, `useCompany`, `useCompanyByToken`,
  create/update.
- `src/hooks/useCompanyDisplay.ts` — exibição (esconder nome quando aplicável).

## Telas
- `/admin/companies` (gestão), `/admin/view-as-company` (admin navega como
  empresa), `/company/projects`, `/company/financial`.

## Permissões
- CRUD: **admin**. Empresa vê/edita só o próprio logo e seus projetos.

## Limitações / futuro
- Logo só pode ser enviado após salvar a empresa (precisa do id no caminho).
