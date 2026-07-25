# Módulo: Motor de Engenharia (Engineering Rules Engine)

**Estado: 🟡 Fase 1** — restrito à GD Manager (mesmo acesso do motor de
diagramas: `useDiagramEngineAccess`). Centraliza TODAS as regras de
dimensionamento simplificado, montagem e construção usadas pelo GD Manager.

**Não substitui** PVsyst/Helioscope/Homer/AutoCAD Electrical — automatiza
projetos fotovoltaicos convencionais de baixa/média complexidade, reduzindo
tempo de elaboração e padronizando a documentação. Feito pra que alguém com
pouco conhecimento de engenharia consiga operar: sugestões prontas e
explicadas, escolha em 1 clique.

## Fluxo

```
Projeto → Motor de Engenharia (Rules Engine) → Validação → Sugestões
        → CAD Engine (desenho) → Documentação
```

O Rules Engine **nunca desenha** e **nunca bloqueia**: aplica regras, gera
sugestões (mínimo 2 quando há mais de uma opção válida) e emite alertas
âmbar com sugestão de correção.

## Princípio central: nada fixo em código

Os VALORES de todas as regras vivem no banco (`engineering_rules`) e são
editáveis pelo admin na tela **Regras de Engenharia** (aba do Motor de
Templates, `/admin/diagram-templates`). O código só conhece as CHAVES
(`grupo.chave`); se uma regra estiver desabilitada ou ausente, o motor usa
um fallback neutro. Toda alteração vira histórico automático
(`engineering_rule_history`, via trigger `log_engineering_rule_change`).

## Banco

- **`engineering_rules`** — tenant_id, group_key, rule_key (únicos por
  tenant), label/description em português simples, enabled, value_default/
  min/max, unit, priority, **source** (NBR 16690 / NBR 5410 / NBR 5419 /
  Manual do fabricante / Regra interna), notes, updated_by/at. RLS
  RESTRICTIVE por tenant + PERMISSIVE admin/staff. Seed inicial: 30 regras
  nos 12 grupos (tenant biblioteca).
- **`engineering_rule_history`** — old_values/new_values (jsonb), autor,
  data; preenchida por trigger no UPDATE (sem código no app).
- **`equipment_catalog.tech_specs`** (jsonb) — datasheet estruturado:
  inversor (`mppt_count`, `strings_per_mppt`, `mppt_vmin_v`, `mppt_vmax_v`,
  `max_dc_voltage_v`, `max_mppt_current_a`, `power_kw`), módulo (`voc_v`,
  `vmp_v`, `isc_a`, `imp_a`, `power_w`). Sem datasheet, o motor usa as
  regras-fallback do Grupo Strings e avisa "sugestão aproximada".

## Os 12 grupos

| # | group_key | O que controla | Fase |
|---|---|---|---|
| 1 | `strings` | módulos/string, MPPTs, faixas de tensão, fator Voc a frio, equilíbrio | **1 ✅** |
| 2 | `inverter_distribution` | divisão módulos/potência entre inversores | **1 ✅** |
| 3 | `arrays` | topologias do arranjo | **1 ✅** (via orquestrador) |
| 4 | `microinverters` | limites por ramal/circuito | 3 (regras já semeadas) |
| 5 | `dcac` | relação DC/AC mín/ideal/máx | **1 ✅** |
| 6 | `voltage_drop` | queda CC/CA máxima | 2 (memorial) |
| 7 | `cables` | bitolas mínimas, fatores de correção | 2 (memorial) |
| 8 | `protections` | critérios de disjuntor/DPS/DR/fusível | 2 |
| 9 | `grounding` | condutor mínimo, cor, interligações | 2 |
| 10 | `norms` | referências normativas (justificam as regras) | **1 ✅** (informativo) |
| 11 | `alerts` | avisos — nunca bloqueiam | **1 ✅** |
| 12 | `suggestions` | nº mínimo de alternativas apresentadas | **1 ✅** |

## Arquivos

- `src/utils/engineering/rulesEngine.ts` — o motor (funções PURAS,
  testadas headless): `suggestStringArrangements` (janela de tensão minN/
  maxN por Vmp/Voc×fator ou fallback; enumera arranjos uniformes e
  quase-uniformes dentro da tolerância; ranqueia por uniformidade, tensão
  no meio da janela, equilíbrio entre MPPTs), `distributeAcrossInverters`
  (proporcional à potência + variação B), `checkDcAcRatio`,
  `suggestProjectArrangement` (orquestrador: divide → strings por inversor
  → ≥2 opções completas + alertas), `buildRuleMap`/`ruleValue`,
  `inverterSpecsFromTechSpecs`/`moduleSpecsFromTechSpecs` (leitura
  tolerante do jsonb).
- `src/hooks/useEngineeringRules.ts` — fetch/update/histórico (casts
  `as never` — tabela fora dos types gerados, mesmo padrão do console).
- `src/pages/admin/EngineeringRules.tsx` — a tela: cards recolhíveis por
  grupo, busca, filtro por fonte, liga/desliga, edição inline
  (padrão/mín/máx/observações), badge de fonte colorida, dialog de
  histórico.
- `src/components/projects/UnifilarTab.tsx` — painel verde "Motor de
  engenharia" na aba Unifilar: botão "Ver sugestões" → opções explicadas +
  alertas; **"Usar esta"** gera o diagrama automático com o arranjo
  escolhido (multiplica ramais por inversor e grava o arranjo na legenda
  do bloco FV).

## Exemplos validados por teste

- 120 módulos, inversor 3 MPPTs×2, módulo 450W → **6×20 e 5×24** (o
  exemplo do briefing), com tensões dentro da janela.
- 240 módulos, 2×75kW → **120+120 e 118+122**.
- Sem datasheet → sugere pelos fallbacks + alerta pra completar o catálogo.
- Sem arranjo válido → 0 sugestões + alerta com correção (nunca trava).

## Integração (Fase 2+)

As mesmas regras alimentarão: lista de materiais, memorial descritivo,
memorial de cálculo, validador, checklist e assistente de projeto — nenhuma
regra duplicada, todos leem de `engineering_rules`. Grupo novo = linhas
novas no banco + uma função nova no motor, sem reestruturar.
