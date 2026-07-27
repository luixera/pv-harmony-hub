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
| 1 | `strings` | módulos/string (teto geral + teto de inversor pequeno), MPPTs, faixas de tensão, fator Voc a frio, equilíbrio | **1 ✅** |
| 2 | `inverter_distribution` | divisão módulos/potência entre inversores | **1 ✅** |
| 3 | `arrays` | topologias do arranjo | **1 ✅** (via orquestrador) |
| 4 | `microinverters` | limites por ramal/circuito | 3 (regras já semeadas) |
| 5 | `dcac` | relação DC/AC mín/ideal/máx | **1 ✅** |
| 6 | `voltage_drop` | queda CC/CA máxima + tensões da rede (220/380V) | **2 ✅** |
| 7 | `cables` | bitolas mínimas, resistividade, comprimentos padrão, fatores | **2 ✅** |
| 8 | `protections` | disjuntor (fator × corrente, ratings comerciais), DPS | **2 ✅** |
| 9 | `grounding` | condutor mínimo, cor, interligações | **2 ✅** |
| 10 | `norms` | referências normativas (justificam as regras) | **1 ✅** (informativo) |
| 11 | `alerts` | avisos — nunca bloqueiam (desligar silencia tudo) | **1 ✅** |
| 12 | `suggestions` | nº mínimo de alternativas apresentadas | **1 ✅** |

## Liga/desliga por FUNÇÃO e por regra (Fase 2)

Cada grupo tem a regra especial **`group_enabled`**, que a tela mostra como
**interruptor no cabeçalho do card** (ícone ⏻): desligado, o motor PULA a
função inteira daquele grupo (strings desligado = sem sugestões de arranjo;
cabos desligado = sem bitolas; alertas desligado = silencia tudo — a própria
regra avisa que não é recomendado). Cada regra individual também tem seu
próprio interruptor na linha. Semântica no motor: `isGroupEnabled(rules,
grupo)`; sem a regra, a função fica ligada por padrão.

## Dimensionamento elétrico simplificado (Fase 2)

`suggestElectricalSizing` (Grupos 6–9): corrente CC (Imp do módulo ou
fallback), corrente CA (P/(V×√3) trifásico ou P/V mono, tensões da rede
configuráveis), **bitola** = menor seção comercial que atende à queda
máxima E ao mínimo da regra (queda pela fórmula simplificada da NBR 5410:
ΔV% = k×ρ×L×I/(S×V)×100, k=2 mono/CC e √3 trifásico, ρ e comprimentos
padrão configuráveis), **disjuntor CA** = próximo rating comercial ≥
fator × corrente, DPS/aterramento pelas regras. Exibido no painel do
projeto (bloco "Dimensionamento elétrico"); alimentará os memoriais na
sequência. Seções e ratings comerciais são constantes de mercado no código
(não são regras técnicas); mínimos e fatores vêm das regras.

## Teto de módulos por string (correção jul/2026)

`strings.max_modules_per_string` vale **sempre** — antes só era aplicado
quando o equipamento não tinha datasheet no catálogo, então quem ajustava
a regra via ela ser ignorada e recebia strings longas demais. Além dele,
inversores pequenos têm teto próprio: `strings.small_inverter_kw_limit`
(padrão 10 kW) + `strings.max_modules_small_inverter` (padrão 11 módulos).
Quando um teto corta a janela, o motor explica no alerta
`string_cap_applied` qual regra mandou.

## Proteções do projeto: disjuntor de cada arranjo + geral

`suggestBreakerPlan` (jul/2026) dimensiona a proteção do projeto inteiro: o
disjuntor de CADA arranjo sai da **corrente CA de saída do inversor** —
`tech_specs.max_ac_current_a` do catálogo quando existe, senão estimada pela
potência (com aviso) — aplicando `protections.breaker_sizing_factor` e
arredondando pro próximo rating comercial. O **disjuntor geral** é
proporcional à **SOMA das correntes** dos inversores (não à soma dos
disjuntores, que superdimensionaria); quando o geral fica abaixo dessa soma,
a explicação diz por quê. O mesmo plano devolve as bitolas do trecho de cada
arranjo e do tronco, que o diagrama usa como **rótulo de cada ligação**
(bitola marcada em cada trecho: CC, CA por arranjo e tronco pós-junção). No
projeto, "Usar esta" pergunta se o disjuntor geral entra.

## Validador elétrico local (checklist em tempo real)

`src/utils/engineering/diagramValidator.ts` — o checklist do engenheiro SEM
IA e sem custo por uso, recalculado a cada edição do diagrama do projeto
(painel "Validação do diagrama" no UnifilarTab). Monta um grafo elétrico
simplificado da cena (derivação formal conta como encostar na linha-mãe) e
verifica: disjuntor CA no caminho de CADA inversor até o medidor (BFS que
não atravessa proteções), DPS conectado no lado CA, **DPS no padrão de
entrada**, medidor/rede presentes, placa de advertência, trechos
FV→inversor como condutor CC, ligações quebradas/ciclo, componentes soltos
e aterramento. Respeita os interruptores dos grupos (`protections`,
`grounding`; `alerts` desligado silencia tudo) e **nunca bloqueia** —
avisos âmbar com a sugestão de correção, em português simples.

## Memoriais descritivos por concessionária

Modelos recriados dos memoriais reais do usuário (ENEL e EDP), como
templates .docx com {tags} — versionados em
[docs/modelos-memoriais/](../../modelos-memoriais/) e **já publicados nas
concessionárias** (bucket `concessionaire-templates`, ao lado dos Anexos
E/F, em todos os tenants) pela edge function `seed-memorial-templates`.
Ela carrega os .docx embutidos em base64, é idempotente e aceita
`{"overwrite": true}` pra substituir depois de uma revisão do modelo;
regerar o base64 com `node scripts/build-seed-memorial-templates.cjs` e
publicar a função de novo. **Sem lista de materiais** — as concessionárias
não exigem, decisão do usuário. As tags de engenharia são
calculadas na geração por `engineeringTemplateValues`
(`src/utils/engineering/templateValues.ts`, ligada no
GenerateDocumentDialog): `{arranjo_strings}` (multilinha, por
inversor/MPPT — a MESMA melhor opção do "Usar esta"),
`{arranjo_strings_resumo}`, `{bitola_cc}`, `{bitola_ca}`,
`{queda_tensao_cc}`, `{queda_tensao_ca}`, `{disjuntor_ca}` (por inversor),
`{disjuntor_geral_ca}` (potência total) e `{bitola_aterramento}` —
registradas no catálogo de variáveis (categoria "Engenharia (Motor)").
Sem dados/regra, resolvem vazias (o documento sai mesmo assim).

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
  alertas; **"Usar esta"** gera o diagrama na topologia multi-arranjo
  (abaixo) com o arranjo escolhido nas legendas dos blocos FV.

## Topologia multi-arranjo (diagrama automático)

`buildMultiArrangementScene` (cadEngine/editableLayout.ts) desenha o
diagrama completo pedido pelo usuário para 1..N arranjos:

- **1 disjuntor CA por arranjo** ("Disjuntor Arranjo i") — obrigatório;
- os arranjos se **juntam num nó** (•, derivação formal no tronco — mover
  o tronco arrasta a junção junto);
- **disjuntor geral de seccionamento OPCIONAL** depois da junção — regra
  `protections.include_general_ac_breaker` (1 = desenha, 0 = não);
- **DPS em PARALELO depois da junção** (derivação do barramento pós-GB);
- **caminho de referência das cargas do local** (quadro de distribuição
  "Cargas do local (apenas referência)", derivado do mesmo barramento) —
  regra `arrays.include_loads_reference`;
- **bloco PADRÃO DE ENTRADA** (caixa de grupo tracejada, `moveContents`):
  **disjuntor do padrão ao lado do medidor** — a legenda (corrente/categoria/
  bitola/caixa de medição) vem das REGRAS DE PADRÃO DE ENTRADA cadastradas
  em Concessionárias (`matchEntryRule` com fase + disjuntor do projeto),
  **DPS do padrão em paralelo ao disjuntor do padrão** (exigência das
  concessionárias) e a **placa de advertência de geração própria** — a
  FOTO REAL da placa entra NATIVA no diagrama (`PlacedPhoto` com data URL
  embutido em `cadEngine/warningPlates.ts`, ~20KB JPEG cada): placa amarela
  "CUIDADO / RISCO DE CHOQUE ELÉTRICO / GERAÇÃO PRÓPRIA" (CPFL e demais) ou
  placa ENEL "AVISO / RETORNO GERADOR DE ENERGIA"; o gerador escolhe pela
  concessionária do projeto (nome contém "enel"). Também existem versões
  vetoriais na paleta (`warning-sign`/`warning-sign-enel`) — úteis no DXF,
  que não carrega raster;
- depois medidor bidirecional → rede; trechos FV→inversor em condutor CC.

**Auto-reorganização**: o espaçamento entre fileiras afrouxa até o conjunto
(fileiras + altura do último símbolo já escalado) caber na faixa útil da
folha; os símbolos do ramal reduzem de escala junto (até 0,6×) e o padrão de
entrada nunca reduz. Com **planta de localização** a faixa começa mais
abaixo (82mm) e o gap mínimo cai pra 13mm.

**Planta de localização** (`cadEngine/locationMap.ts`): recorte de satélite
do local (Maps Static API, `maptype=hybrid` + marcador, comprimido a ~820px
JPEG 0,72 e embutido como data URL) no canto superior esquerdo, dentro de
uma caixa "PLANTA DE LOCALIZAÇÃO" com as coordenadas embaixo. Entra
automaticamente no "Usar esta" e pelo botão **Planta de localização** no
painel do projeto (que insere/atualiza em qualquer diagrama). Sem
coordenadas, sem chave ou com a Static API desabilitada no Google Cloud, o
motor explica o motivo em vez de falhar em silêncio
(`LOCATION_MAP_MESSAGES`).

A cena sai com TODOS os ids `manual-` — o `reconcile()` do UnifilarTab a
trata como cena de modelo (passthrough) e **nada é recriado por cima**:
edição manual 100% livre na aba do projeto. Complementando, o editor agora
permite **remover qualquer componente** (inclusive os fixos do cadastro):
os removidos entram em `DiagramSceneState.suppressedIds` e o reconcile não
os semeia de novo ("Restaurar" limpa a lista).

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
