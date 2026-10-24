# Plano — beneficiárias estruturadas e criação na CPFL em autoconsumo remoto

Spec: [2026-10-22-beneficiarias-autoconsumo-remoto-design.md](../specs/2026-10-22-beneficiarias-autoconsumo-remoto-design.md).
Execução autônoma (usuário: "adiante tudo em segundo plano… exceto decisões
mais chatas", 22/10/2026). Cada tarefa termina com a prova que a sustenta.

| # | Tarefa | Prova |
|---|---|---|
| 1 | Migração `20261022100000_beneficiarias.sql`: tabela `project_beneficiaries`, gatilhos (tenant, soma ≤ 100, `has_beneficiaries` derivado, `updated_at`), RLS (§3 da spec, inclusive anon no envio público), `ludmilla_dados_criacao_cpfl` v3 (`sistema_compensacao` + `beneficiarias` + recusa por `holder_mismatch`/soma), `ludmilla_beneficiarias_confirmar` (write-back, só service_role) | prova SQL em `begin/rollback` com impersonação de admin, staff, empresa e anon |
| 2 | `src/lib/beneficiarias.ts`: normalizar UC, validar por concessionária, percentual à brasileira, soma/resto | vitest |
| 3 | `src/hooks/useBeneficiarias.ts`: listar, gravar, remover, ler conta pelo Claudinho | tsc |
| 4 | `BeneficiariasForm` (envio) e `BeneficiariasBloco` (modal) | tsc + tela |
| 5 | Integrar `NewProject`, `PublicProjectForm` (sai o upload múltiplo), `ProjectModal` (abaixo da UC da geradora), `CriarNaCpflPanel` (aviso de pré-checagem) | tsc, build, tela |
| 6 | Worker: `tipos.ts` (beneficiárias, compensação derivada), `fila.ts` (mapeamento), `roteiro-cpfl60.ts` passo 3 pelo rótulo e passo 4 com o laço UC → Buscar → % + conferência do resto + write-back; `util.ts` helpers | `npm test` do worker (node:test) |
| 7 | Docs (shared-generation, ludmilla, projects), memória | — |
| 8 | Verificação: tsc baseline 65, build, 170+ testes, worker build+test; commit + push | saída dos comandos |

**O que fica para o usuário:** (a) disparar o deploy do worker na VPS — o
workflow `ludmilla-worker.yml` é **manual** (`workflow_dispatch`) e reinicia o
serviço que também faz a varredura 2×/dia; (b) rodar a **simulação** num
projeto CPFL com beneficiárias — é na conta dele no portal; o primeiro run
devolve o mapa de controles do bloco (o registrador já grava `JS_MAPA` em
erro), e com o mapa eu fecho os seletores.

**Seletores do bloco de beneficiárias:** desconhecidos. O passo 4 procura os
controles **pelo texto** (rádio "Percentual", campo "Nº da UC", botão
"Buscar", a linha pela UC) e, se não achar, falha com `pagina_mudou` dizendo
o que faltou — nunca clica em palpite.
