# Padrões de Código

## Idioma
- **Código, comentários e UI em português.** Nomes de variáveis e funções podem
  misturar PT/EN conforme o domínio (`ehPessoaJuridica`, `buildProjectValues`),
  mas mensagens ao usuário são sempre PT-BR.

## Organização
- `src/pages/` — telas (uma por rota). Subpastas por área: `admin/`, `company/`,
  `master/`, `painel/`.
- `src/components/` — componentes reutilizáveis, agrupados por domínio
  (`projects/`, `concessionaires/`, `equipment/`, `forms/`, `common/`, `ui/`).
- `src/hooks/` — um hook por entidade (`useProjects`, `useCompanies`, …).
  **Toda leitura/escrita no Supabase passa por um hook**, não direto na tela.
- `src/lib/` — utilitários puros (`cpfCnpj.ts`, `statusMapping.ts`, `utils.ts`,
  `systemLog.ts`, `tracking.ts`, `equipmentDocs.ts`).
- `src/utils/` — geradores pesados (`projectValues.ts`, `docxGenerator.ts`,
  `resumoPdf.ts`, `installerPackage.ts`).
- `src/integrations/supabase/` — client e tipos gerados.
- `src/contexts/` — contextos React (`AuthContext`).

## Regras práticas
- **supabase-js é lazy.** Um builder sem `await`/`.then()` **não envia** a
  requisição. Sempre aguarde inserts/updates que precisam persistir. (Foi a
  causa do bug do histórico de etapas.)
- **Nunca confie em `user_metadata`** para papel/tenant — só `app_metadata`
  (gravado no servidor). Ver [security.md](security.md).
- **Autorização é no banco (RLS/RPC).** O front esconde botões, mas a barreira
  real é a política. Não implemente checagem de segurança só no cliente.
- **Fonte única de dados de template**: use `buildProjectValues` de
  `src/utils/projectValues.ts`. Não duplicar o mapa de variáveis.
- **Logs sem quebrar a UI**: `logSystemEvent` e o tracking são "dispare e
  esqueça" — nunca lançam.

## Tipos do Supabase
- `src/integrations/supabase/types.ts` é gerado e às vezes fica atrás do banco.
  Ao adicionar coluna/enum novo, atualize esse arquivo. Onde o tipo ainda não
  reflete o schema, usa-se `as never` pontual (documentar no comentário o porquê).
- **Erros de tipo pré-existentes**: há ~65 erros conhecidos por defasagem de
  tipos gerados (tabelas `agent_config`, `agent_config_safe`, colunas recentes).
  Antes de commitar, rode `npx tsc --noEmit -p tsconfig.app.json` e compare com a
  linha de base — **não introduza novos**. O `tsconfig.json` da raiz tem
  `files: []` e não checa nada; use sempre `-p tsconfig.app.json`.

## Build e verificação
```bash
npx tsc --noEmit -p tsconfig.app.json   # checagem de tipos (use este, não a raiz)
npm run build                            # build de produção
```

## Estilo visual
- Cor de marca: `#F5A800` (dourado). Fundo escuro do console: `#111118`.
- Componentes usam shadcn/ui quando possível; telas legadas usam estilo inline.
