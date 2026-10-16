# Eletropostos — banco

Migração: `supabase/migrations/20261015200000_eletropostos.sql`. Todas as
tabelas têm `tenant_id` (padrão `eletropostos_tenant()` = tenant
`is_library`), RLS habilitada com `tenant_isolation` RESTRICTIVE e
`<tabela>_master_le` (SELECT só `is_master`). Sem política de escrita para
`authenticated`.

## Tabelas

| Tabela | Chave | Conteúdo |
|---|---|---|
| `eletroposto_local` | `id uuid` | cadastro (nome, operadora, cidade, endereço, lat/lng, tipo DC/AC, potência por conector, nº de conectores, preço e custo R$/kWh, fonte de status, observações, ativo). Seed: 72 locais do `inventario.csv`. |
| `eletroposto_fonte_local` | `(fonte, local_fonte)` | como cada fonte chama um local; `local_id` = vínculo com o cadastro (nulo = sem vínculo); `visto_em` |
| `eletroposto_leitura` | `id bigint`; `UNIQUE (slot, fonte, local_fonte, conector)` | leituras cruas: `ts_utc`, `slot` (janela de 5 min UTC), `conector` (`'*'` = só o local), `potencia_kw`, `status_bruto`, `status`, `upstream_ts`. Índices em `(slot)` e `(fonte, local_fonte, slot)`. |
| `eletroposto_varredura` | `id` | uma linha por coleta: fonte, `ok`, `n` linhas, `erro` |
| `eletroposto_premissas` | `tenant_id` | `valores jsonb` (só o que difere do padrão; `eletropostos_premissas()` devolve padrão ∪ valores) |
| `eletroposto_estacao` | `id` | estação local: `nome`, `operador` (auth.users do staff da estação), `vista_em`, `ativa` |

## Funções auxiliares

| Função | Para quê |
|---|---|
| `eletropostos_tenant()` | id do tenant biblioteca |
| `eletropostos_premissas_padrao()` / `eletropostos_premissas()` | premissas |
| `eletropostos_distancia_m(lat1, lng1, lat2, lng2)` | haversine, para o vínculo automático (< 150 m) |
| `eletropostos_energia(horas, kw, tipo, premissas) → numeric[2]` | [kWh min, kWh max] |
| `eletropostos_periodo(de, ate) → (a, b, esperadas, dias)` | dias civis de Brasília → `[a, b)` UTC, janelas esperadas e dias efetivos |
| `eletropostos_conectores(a, b, local?) → SETOF eletroposto_conector_agg` | contagens por status, sessões (`lag`), último status/potência por conector |
| `eletropostos_metricas(conector_agg, esperadas) → jsonb` | o dicionário de métricas do conector |
| `eletropostos_montar_local(local, conectores jsonb, premissas, dias) → jsonb` | local + agregados + energia/receita/margem |
| `eletropostos_estacao_ok()` | `auth.uid()` é operador de estação ativa do seu tenant |

## RPCs

### Escrita (coletores)

| RPC | Guarda | Faz |
|---|---|---|
| `eletropostos_gravar(p_fonte, p_linhas jsonb, p_erro)` → int | `auth.role() = 'service_role'` | upsert de `fonte_local` (vínculo automático só no 1º avistamento), `INSERT … ON CONFLICT DO UPDATE` em `leitura` na janela atual, linha em `varredura` |
| `eletropostos_gravar_local(...)` → int | `eletropostos_estacao_ok()` | idem + `vista_em` da estação |
| `eletropostos_estacao_pulsa()` | `eletropostos_estacao_ok()` | batimento |

`p_linhas`: `[{local_fonte, local_nome, lat, lng, conector, potencia_kw, status_bruto, status, upstream_ts}]`.

### Leitura e edição (console, só master)

| RPC | Devolve |
|---|---|
| `eletropostos_resumo(p_de date, p_ate date)` | `{periodo, kpis, locais[], nao_vinculados[], premissas}` |
| `eletropostos_detalhe(p_local uuid, p_de, p_ate)` | `{periodo, local, conectores[], diario[], perfil[7][24], linha_do_tempo{nome: [[ts, status]]}, vinculos[]}` — `linha_do_tempo` só das últimas 48 h por conector |
| `eletropostos_coleta()` | `{fontes[], erros[≤15], por_dia[≤60], inicio, total_leituras, estacoes[], agora}` |
| `eletropostos_local_salvar(p_local jsonb)` → uuid | cria (sem `id`) ou atualiza **as chaves presentes** (chave com `null` limpa o campo) |
| `eletropostos_vincular(p_fonte, p_local_fonte, p_local uuid)` | vínculo manual |
| `eletropostos_premissas_salvar(p_valores jsonb)` → jsonb | só chaves conhecidas, convertidas para número; devolve as premissas efetivas |

Tipos TypeScript espelhando o JSON: `src/pages/painel/eletropostos/tipos.ts`.

## Como validar

```bash
npx -y supabase db query --linked -f supabase/eletropostos-validacao.sql
```

Grava um cenário sintético (fontes `teste`/`teste2`, 01/10/2026), confere 28
valores (horas, ocupação, sessões, kWh, perfil, vínculo a 30 m, premissas) e
apaga tudo no fim. RLS foi provada por impersonação em 16/10/2026: master lê
72 locais; admin de outro tenant e staff não master leem 0; ninguém insere
direto; `gravar` recusa sem service role; `gravar_local` recusa sem estação.

## Estação local

Uma linha em `eletroposto_estacao` por PC que coleta. `operador` é o `auth.users.id`
do staff da estação (criado pelo app, senha da pessoa); `eletropostos_estacao_ok()`
exige estação `ativa` **e** do tenant do usuário. Registro (como master, pelo
`db query --linked`):

```sql
INSERT INTO public.eletroposto_estacao (nome, operador)
SELECT 'PC do Luiz (BlueStacks)', id FROM auth.users WHERE email = '<e-mail da estação>';
```

`vista_em` é atualizado por `eletropostos_estacao_pulsa` (início de cada corrida)
e por `eletropostos_gravar_local`; a aba Coleta mostra "parada" acima de 15 min.
Para desligar uma estação: `ativa = false` (as RPCs passam a recusar).

## Volume

~20 conectores × 288 janelas/dia ≈ 6 mil leituras/dia (2 M/ano). Sem
retenção por enquanto.
