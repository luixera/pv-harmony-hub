# Capacidade de rede — mapa v3 (WebGL, amostragem adaptativa, auditoria) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Acabar com o travamento do mapa de capacidade de rede (medido: 40–120 mil `<path>` SVG e até 8,4 MB por vista), deixar explícito que a análise é da **baixa tensão** (trafo MT/BT), dar o "Pesquisar nesta área" e abrir a auditoria dos dados em duas camadas: ficha da fonte e conta aberta.

**Architecture:** O servidor decide a amostra **pela contagem da caixa**, não pelo zoom (`rede_no_mapa_v3`): pontos até 4.000, senão o passo de célula mais fino que caiba em 3.000 células (nível 5 novo, 0,0025°). Propriedades mínimas no mapa; detalhe no clique (`rede_trafo_detalhe`). A tela desenha tudo em **WebGL** com `deck.gl` (`GoogleMapsOverlay` sobre o mapa raster do Google, `GeoJsonLayer` para células e linhas, atlas de ícones em canvas para os pontos). A auditoria entra em `rede_importacao` (hash, versão, regras, mudanças) e numa tabela de histórico por importação (`rede_transformador_hist`), exposta por `rede_fontes()`.

**Tech Stack:** Postgres/PostGIS (Supabase) · deck.gl 9.4 (`@deck.gl/core`, `layers`, `google-maps`) com `import()` dinâmico · React 18 + React Query · `@react-google-maps/api` 2.20 (só o mapa e o loader) · vitest · node:test (worker) · `node:crypto` (SHA-256 em streaming).

**Spec:** `docs/superpowers/specs/2026-10-10-capacidade-rede-design.md`, §12.

## Global Constraints

- Tudo master-only: gate `is_master(auth.uid())` nas entradas; `REVOKE ALL … FROM PUBLIC, anon, authenticated` em todo objeto novo; `GRANT EXECUTE … TO authenticated` só em `rede_no_mapa_v3`, `rede_trafo_detalhe`, `rede_fontes` (e as já existentes). Views: `security_invoker = true`. Nenhum DROP/DELETE na migração (portão do MCP).
- `tsc` em 65 erros, `npm run build` limpo, vitest verde; worker: só as falhas por falta do Chromium.
- Cores e formas da v2 não mudam. Identificadores em português.
- deck.gl só nesta tela, carregado por `import()`: o resto do SPA não paga.
- Reingestão das duas CPFL depois do deploy do worker, para UCs/unidades de GD/hash chegarem (as colunas são nulas até lá e a tela mostra "—").

---

### Tarefa 1 — Migração `rede_mapa_v3`
- [x] `CHECK (nivel BETWEEN 1 AND 5)`; `rede_celula_calculada` ganha `(5, 0.0025)`.
- [x] Views enxutas `rede_ponto_no_mapa` (id, codigo, risco, ocupacao_pct) e `rede_celula_no_mapa` (id, nivel, risco, trafos, trafos_risco) — recriadas com as mesmas colunas de saída.
- [x] `rede_amostra(cx, so_risco)` → `(camada, nivel, contagem)`: conta com `LIMIT 4001`; passo mais fino com `(w/passo)·(h/passo) ≤ 3000`.
- [x] `rede_no_mapa_v3(oeste, sul, leste, norte, zoom, so_risco, camadas)`; alimentadores no 11–12 com `geom_z1`.
- [x] `rede_transformador` e staging ganham `unidades_consumidoras`, `gd_unidades`; `rede_promover_trafo` copia.
- [x] `rede_importacao`: `hash_sha256`, `tamanho_bytes`, `versao_bdgd`, `baixado_em`, `regras`, `mudancas`.
- [x] `rede_transformador_hist` (PK importacao_id+transformador_id, RLS sem política); `rede_concluir_carga` grava hist, regras e mudanças; backfill do hist para as importações 9 e 10.
- [x] `rede_trafo_detalhe(p_id)`, `rede_fontes()`; varredura de privilégios.
- [x] Aplicar via MCP; medir zooms 11–16 sobre Campinas (contagem, bytes).

### Tarefa 2 — Worker
- [x] `versaoDe(titulo)` e `baixarEExtrair` devolvendo `{gdb, sha256, bytes, baixadoEm}` (hash em streaming).
- [x] `montarTrafos` carrega `ucs` e `unidades`; `index.ts` grava os campos novos na importação.
- [x] Testes: `catalogo.test.ts`, `carregar.test.ts`.

### Tarefa 3 — Front: camadas WebGL
- [x] `rede/atlas.ts`: `mapeamentoAtlas()` puro (testado) + `desenharAtlas(satelite)` em canvas.
- [x] `rede/camadas.ts`: `montarCamadas(resposta, opções)` → descrições das layers (puro onde dá, testado: quais camadas saem, cores, larguras).
- [x] `rede/useDeck.ts`: overlay único, `import()` dinâmico, `setProps({layers})`.
- [x] `consultas.ts`: `rede_no_mapa_v3`, `rede_trafo_detalhe`, `rede_fontes`; `tipos.ts`.

### Tarefa 4 — Front: tela
- [x] "Pesquisar nesta área" + "atualizar ao mover"; alimentadores desligados por padrão; rótulos BT.
- [x] `PainelLateral` em `memo`, lista paginada (40), `DetalheTrafo` com conta aberta, campos brutos, base anterior; `FichaDaFonte`.
- [x] `Legenda`: termos BT/MT.

### Tarefa 5 — Verificação, docs, ADR, PR
- [x] tsc/build/vitest/worker; medição da RPC; `overview.md` "Mapa v3"; `CLAUDE.md`; ADR 0010 (WebGL no mapa); commit e push.

## Decisões medidas

- **Amostra por contagem** (Campinas, 1920×1080, caixa com 20% de folga): zoom 11 → nível 2, 431 células, 210 KB (v2: 8,4 MB); 12 → nível 3, 2.071 células, 1,0 MB; 13 → nível 3, 748, 364 KB; 14 → nível 4, 991, 483 KB; 15 → nível 5, 1.012, 494 KB; 16 → 3.033 pontos, 778 KB (257 B/ponto). Células por nível depois do recálculo: 292 · 3.542 · 32.348 · 83.945 · 147.284.
- **Cor da célula por 1 em 5**: no nível 2, 2.449 células com folga, 800 em risco, 265 em atenção, 28 sem dado (antes, "pior estado" pintava quase tudo de vermelho).
- **Alimentadores** (nível 1 do traçado até o zoom 12): 2,3 MB/600 linhas/22 mil partes no 11; 1,6 MB no 12; 2,2 MB no 13 (nível 2); 962 KB no 14; 862 KB no 15; 404 KB no 16. No zoom 9 ainda são 2,9 MB (299 linhas, 31 mil partes): a camada fica opcional, desligada por padrão e em consulta separada.
- **Histórico**: 295.197 linhas gravadas no backfill (cargas 9 e 10); `mudancas.anterior = null` nas duas (primeira carga com histórico).
- **Front**: `tsc` 65 erros (baseline), eslint limpo, vitest 196 testes (26 novos no módulo `rede`), build ok; deck.gl em chunk próprio por `import()`.
- **Worker**: 344 testes, 320 passam; os 24 que falham são os de navegador (sem Chromium no container), como antes.
- **Correções do primeiro uso em produção (15/10/2026, São José do Rio Preto, zoom 16)**: o traçado no nível 3 aparecia "cortado" (ramos < 33 m somem, emendas da grade de 11 m visíveis) → geometria cheia a partir do zoom 15, como na v2 (`20261015170000`); os ícones dos trafos saíam com 7 px porque a forma ocupava um terço da célula do atlas → raio 19/21 de 32; a altura da tela passou a ser medida (`getBoundingClientRect`), não chutada, para a legenda e a faixa de status não ficarem abaixo da janela.
