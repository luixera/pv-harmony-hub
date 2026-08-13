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
  `max_dc_voltage_v`, `max_mppt_current_a`, `max_ac_current_a`, `ac_phases`,
  `ac_voltage_v`, `power_kw`), módulo (`voc_v`, `vmp_v`, `isc_a`, `imp_a`,
  `power_w`). Sem datasheet, o motor usa as regras-fallback do Grupo Strings e
  avisa "sugestão aproximada".

### Como a aba Unifilar acha o datasheet

O datasheet quase nunca chega junto com o projeto — ele é preenchido depois, na
conferência, muitas vezes junto com a troca do equipamento que veio errado. Por
isso a busca tem três garantias (ago/2026):

1. **Relê o catálogo ao abrir a aba** (`refetchOnMount: 'always'` em
   `useEquipmentCatalog`): datasheet preenchido agora vale agora, sem recarregar
   a página.
2. **Casa pelo vínculo E pelo nome** (`acharNoCatalogo` no `UnifilarTab`):
   `inverter_catalog_id`/`module_catalog_id` só existem quando o equipamento foi
   escolhido no combobox. Sem vínculo — ou com vínculo órfão, de um equipamento
   trocado — cai em marca+modelo normalizados (e só no modelo como último
   recurso, porque a marca costuma variar de escrita).
3. **O MÓDULO também é lido do catálogo.** Antes só o inversor era: `moduleSpecs`
   recebia apenas a potência, então Voc/Vmp/Isc/Imp nunca vinham do datasheet, a
   janela de string saía sempre dos valores-padrão e o aviso "equipamento sem
   datasheet completo" não sumia por mais que o datasheet fosse preenchido.

O bloco **"Datasheets usados nas sugestões"** (`EquipmentDatasheetsPanel`) mostra
qual item do catálogo foi encontrado para o módulo e para o inversor, quantos
dados técnicos estão preenchidos, **quais faltam**, e dá acesso aos documentos
(datasheet/INMETRO/AFCI).

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
(bitola marcada em cada trecho: CC, CA por arranjo e tronco pós-junção).

> **A soma só existe DEPOIS do nó.** Cada ramal, do seu disjuntor até a
> junção, carrega apenas a corrente dele — todos com a mesma bitola. Só o
> tronco, do nó em diante, leva a soma. Por isso o caminho do 1º arranjo é
> desenhado como **duas ligações** (`manual-ramal1-arr` até o nó e
> `manual-trunk-arr` do nó em diante): quando era uma ligação só, ela levava o
> rótulo do tronco e o ramal 1 saía marcado 10 mm² enquanto o ramal 2, com a
> mesma corrente, saía 4 mm² (erro relatado em jul/2026, num projeto de
> microinversores).

No
projeto, "Usar esta" pergunta se o disjuntor geral entra.

### A fase é do INVERSOR, não do padrão de entrada da UC

`resolveInverterPhase` (jul/2026) decide como o inversor **entrega** energia —
o que não tem relação com quantas fases a unidade consumidora **recebe**. Um
inversor monofásico continua monofásico numa UC trifásica.

Ordem de decisão:

1. **`tech_specs.ac_phases`** (e `ac_voltage_v`) do catálogo — manda sempre.
2. Sem isso, deduz pela potência: até `protections.single_phase_max_kw`
   (padrão 6 kW) é monofásico 220 V; acima, trifásico 380 V. A dedução **avisa**
   e nunca passa do que o padrão de entrada comporta.
3. Se o **datasheet** disser trifásico numa UC monofásica, o motor mantém o
   datasheet e levanta um alerta de incompatibilidade — é problema de projeto,
   não de arredondamento.

O mesmo vale no caminho de microinversor: o micro entrega na tensão dele.

**Bug que originou a regra**: um SUNGROW SG3.0RS-L (3 kW monofásico 220 V) num
padrão de entrada trifásico teve a corrente calculada como 3000/(380·√3) =
**4,6 A** em vez dos **13,6 A** reais — o disjuntor sugerido saiu **10 A** onde
precisava de **20 A**, e o cabo CA saiu subdimensionado junto.

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

## Leitura automática do datasheet (ago/2026)

O motor avisava "0 de 4 dados técnicos" para um módulo cujo datasheet estava
anexado e completo: o dado existia, ninguém tinha digitado no catálogo.
Digitar 4 campos por módulo e 8 por inversor, para cada equipamento novo, não
escala — então a edge function **`datasheet-extract`** lê o PDF e devolve o
`tech_specs`.

**REGRA DE LEITURA — vale para todo módulo e todo inversor:**

1. **Datasheet é de FAMÍLIA, não de um modelo.** `RM-600-630W-182R/132TB`
   cobre 600, 605, 610, 615, 620, 625 e 630 Wp; `SG3.0/4.0/5.0/6.0RS-L` cobre
   quatro inversores. A tabela traz **uma coluna por modelo/potência**: a
   primeira coluna diz qual é a grandeza, as seguintes trazem o valor de cada
   modelo. Lê-se a **coluna do equipamento cadastrado** — escolhida pela
   `power` do item no catálogo (ou deduzida do nome, ex.: `RM-620W` → 620 Wp).
2. **Módulo: só a tabela STC** ("CARACTERÍSTICAS ELÉTRICAS (STC)", 1000 W/m²,
   25 °C, AM 1,5). **Nunca** NOCT/NMOT (800 W/m², valores menores) nem a
   tabela bifacial ("Especificações (BNPI)", "BPI", ganho bifacial — valores
   ~10% MAIORES, que furariam string e cabo).
3. **Não interpolar.** Se a coluna exata do alvo não existir, devolve vazio e
   diz quais colunas existem, em vez de aproximar pela vizinha.

**Conferências no servidor** (a leitura é palpite informado, não fonte da
verdade — o filtro fica no servidor porque é o único ponto por onde toda
leitura passa):

- faixa plausível por campo (ex.: `voc_v` 10–100 V) — fora disso, descarta;
- coerência física do módulo: `Voc > Vmp` e `Isc > Imp`;
- **`Vmp × Imp ≈ potência nominal` (tolerância 3%)** — é o que derruba a
  tabela bifacial (11% de erro) e a coluna 20 W distante (3,1%). Colunas
  **vizinhas** (passo de 5 Wp, 0,8%) não são separáveis por aritmética: por
  isso a tela mostra **de qual coluna** a IA leu, para conferência humana;
- inversor: faixa de MPPT não invertida e `V máx. MPPT ≤ V CC máx.`.
  As conferências de par olham o valor **cru**, antes do filtro de faixa —
  senão, numa faixa invertida (mín. 560 / máx. 40) o 40 cairia sozinho e o
  560 sobreviveria como "mínimo".

Campo descartado = campo ausente: o motor volta ao valor-padrão das Regras e
avisa. Nunca entra número duvidoso no cálculo.

**Onde fica o botão** — nos dois lugares: no cadastro do equipamento
(preenche os campos para conferência antes de salvar) e **na aba Unifilar**,
ao lado de "falta: Voc, Vmp…" (lê e grava, e as sugestões recalculam). O
segundo existe porque é ali que o projetista descobre o que falta; mandá-lo a
outra tela para digitar números que já estão no PDF é o atrito que o motor
deveria eliminar. A leitura só **completa**: valor digitado à mão prevalece.

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
- `supabase/functions/datasheet-extract/index.ts` — leitor de datasheet
  (regra de família + STC + conferências no servidor, acima). Deployada pelo
  CI, consome cota de IA como `datasheet_extract`.
- `src/hooks/useDatasheetExtract.ts` — chama a função com o arquivo escolhido
  ou com o datasheet já salvo no storage; nunca grava sozinho.
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

## Microinversores (grupo `microinverters`)

Microinversor **não tem janela de string** — cada módulo entra numa entrada CC
própria do micro. Tratar o micro como inversor de string era o que fazia o
motor responder "não achei arranjo válido pra 4 módulos (janela de 6 a 10 por
string)" num projeto de microinversores (caso real relatado pelo usuário).

O que manda no dimensionamento:

1. **Entradas CC do micro** = módulos por unidade (HMS-2000 **4T** → 4).
   Datasheet (`dc_inputs`) > regra `microinverters.default_modules_per_unit` (4).
2. **Micros por RAMAL CA** — os micros são encadeados no mesmo cabo tronco até
   o disjuntor do ramal. Datasheet (`micro_max_per_branch`) > regra
   `microinverters.default_max_per_branch` (**3**, decisão do usuário).
   A corrente do ramal **não reduz** esse número por conta própria: se
   `nº × corrente` passar de `microinverters.branch_max_current` (25A), o motor
   **avisa** e sugere as duas saídas (aumentar a corrente/bitola do ramal ou
   baixar o nº de micros). Motor sugere e explica, nunca decide sozinho.
3. **Disjuntor do ramal** = `protections.breaker_sizing_factor` × soma das
   correntes dos micros do ramal; **geral** = fator × soma dos ramais.

Detecção (`isMicroinverter`), nesta ordem: (1) `is_microinverter = 1` no
datasheet do catálogo; (2) o nome contém "microinversor"; (3) **família
conhecida no modelo E potência ≤ 3,5 kW** — HM/HMS/HMT (Hoymiles), HYX-M
(HYXipower), IQ5–IQ9 (Enphase), DS3/QS1/YC600/YC1000 (APsystems). A potência
sozinha NUNCA decide (existe inversor de string de 2 kW), e a família sozinha
também não (Huawei SUN2000 de 5 kW continua string). Quando nem assim o modelo
é reconhecido, a aba Unifilar mostra o botão **"É microinversor"**: ele passa o
projeto pro caminho do micro e grava a marcação no catálogo, pra o próximo
projeto com o mesmo modelo já nascer certo.

Funções: `microSpecsFromTechSpecs`
e `suggestMicroinverterPlan` → `MicroPlan` (micros, módulos por micro, ramais
equilibrados, correntes, disjuntores, bitolas, alertas explicados).

No **Catálogo de Equipamentos** o inversor ganhou a marcação "É um
microinversor", que troca os campos de janela de string pelos dois campos do
micro (entradas CC e máx. por ramal).

### As duas representações no diagrama

O usuário pediu as duas, escolhidas na hora de gerar (aba Unifilar do projeto):

- **Compacto** (padrão) — cada RAMAL vira uma fileira:
  bloco FV "3 × 4 = 12 módulos", bloco do micro "3× HMS-2000 4T · 2000W ·
  9,09A", disjuntor do ramal, junção, QGBT, padrão de entrada. É o mesmo
  `buildMultiArrangementScene`, com `inverterKind: 'microinverter'` e rótulos
  por fileira. Cabe em A4 com qualquer nº de ramais.
- **Esquemático** (`buildMicroSchematicScene`) — a seguimentação da prancha de
  referência: cada micro desenhado com os seus módulos em cima, todos
  encadeados no **barramento CA** do ramal até o disjuntor. Reaproveita o
  compacto inteiro e só reescreve o lado da geração. O **modelo dos
  equipamentos NÃO vai na célula** (ela tem ~20mm e o nome saía cortado): sai
  inteiro em duas linhas no topo do desenho — "Módulos: …" e
  "Microinversores: … · 2000W · 9,09A" — uma vez só, já que o modelo é o mesmo
  do projeto inteiro.

**Limite honesto de folha**: a seguimentação de **mais de um ramal** não cabe
em A4 junto do padrão de entrada — o 2º ramal desceria em cima do DPS do QGBT.
`microSchematicFit()` calcula isso (escala por largura de célula e por altura
de pilha) e devolve `fits`/`possible`/`reason`; a UI desabilita o botão do
esquemático e mostra o motivo. Nos projetos de referência a seguimentação vai
numa **prancha separada** — suportar isso é o próximo passo (o motor ainda não
tem conceito de múltiplas pranchas).

## Topologia multi-arranjo (diagrama automático)

`buildMultiArrangementScene` (cadEngine/editableLayout.ts) desenha o
diagrama completo pedido pelo usuário para 1..N arranjos:

- **modelo dos equipamentos na legenda dos blocos** (jul/2026): o bloco FV traz
  o arranjo + "MARCA MODELO · 610Wp" + tensão de operação, e o bloco do
  inversor traz "MARCA MODELO" + "kW · corrente CA". O analista lê o que está
  instalado direto no desenho. A base da última fileira (`BOTTOM`) passou a ser
  calculada pelo nº de linhas de rótulo — com o modelo o texto ficou mais alto
  e batia no carimbo;
- **1 disjuntor CA por arranjo** ("Disjuntor Arranjo i") — obrigatório. Com
  **um único inversor**, esse disjuntor JÁ É o geral: o motor desenha um só
  ("Disjuntor Geral CA", legenda "(arranjo + geral)") em vez de dois em
  série;
- **QGBT SOLAR**: caixa tracejada (mesma linguagem do padrão de entrada)
  envolvendo os disjuntores da geração, a junção, o disjuntor geral e o
  **DPS CA** — que fica logo após o disjuntor (1 inversor) ou **na junção
  dos arranjos** (2+), derivando do tronco no mesmo nó;
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

- **aterramento/equipotencialização**: os dois DPS levam a legenda
  "Conectado ao BEP" e o desenho traz a nota normativa "aterramento do padrão
  de entrada, neutro e malha de aterramento da edificação equipotencializados
  no BEP — NBR 5410" (é o que a concessionária procura ao conferir o
  aterramento; o validador aceita essa indicação como aterramento presente).

**Auto-reorganização**: o espaçamento entre fileiras afrouxa até o conjunto
(fileiras + altura do último símbolo já escalado) caber na faixa útil da
folha; os símbolos do ramal reduzem de escala junto (até 0,6×) e o padrão de
entrada nunca reduz. Com **planta de localização** a faixa começa mais
abaixo (82mm) e o gap mínimo cai pra 13mm.

**Folha que se adapta ao projeto** (jul/2026): o diagrama nasce em **A4** e só
sobe pra **A3** quando o desenho precisa — A3 em tudo deixava o unifilar
simples perdido numa folha enorme (relato do usuário). Quem decide é
`pickPaper({rows, unitsPerRow, schematic, hasMap})`: compacto vai pra A3 acima
de 4 fileiras (3 com planta de localização); o esquemático de microinversores,
acima de 1 ramal. A geometria de cada folha está em `SHEET_LAYOUT` (colunas,
eixo do tronco, faixa das células, planta, nota) — trocar de folha é trocar
uma linha, não reescrever o builder.

O tamanho escolhido viaja em `DiagramSceneState.sheet.paper` e vira
`Scene.paper`, então editor, SVG, PDF e DXF usam sempre a mesma folha.
**Armadilha já paga**: a mobília (moldura, carimbo, legenda) lia o `PAPER`
global enquanto a cena declarava outro tamanho — o resultado era um desenho
maior que a página, cortado na exportação. Hoje `drawFrameAndHeader`,
`drawTitleBlock` e `drawLegendTable` leem `scene.paper`.

**Geometria da prancha e dos nós** (jul/2026 — pedido do usuário "ajuste os
nós e pontos de ligação entre os componentes"):

- o **eixo do tronco CA desceu para y=118**, abaixo da tabela de legenda (que
  chega no pior caso a y≈114). Com a linha principal passando por baixo da
  legenda, a corrente de símbolos usa a largura inteira da folha e sobrou vão
  de verdade entre os blocos: **20mm entre o QGBT SOLAR e o PADRÃO DE
  ENTRADA** (com 1 inversor, 32mm) — antes eram 3mm;
- **base do último símbolo em y=158**: sobram ~10mm pro rótulo + legenda
  antes do carimbo (y=172), então nenhuma fileira escreve por cima dele;
- **derivação vertical nasce no eixo da porta**. O x do ponto de derivação e
  o x da porta do componente são derivados um do outro (`symUnderTap`); fora
  de eixo, o roteador ortogonal insere um degrau de 1–2mm logo acima do
  símbolo — era o "bug da ligação no DPS";
- **entrada de arranjo no nó do tronco em esquadro**: dobra explícita na
  coluna do nó, então o condutor corre na horizontal na altura da fileira e
  **sobe/desce reto pra dentro do nó** (sem a dobra o roteador automático
  abria um Z, entrando no nó na horizontal com dois tocos de 4mm);
- **montante das cargas em L**: sobe no x da derivação e vira em esquadro pro
  toco horizontal do quadro, no meio do vão entre os dois blocos (antes
  raspava no tracejado do padrão de entrada);
- **o condutor cobre o toco do símbolo** (`PORT_STUB` + `portConnectPoint`):
  o disjuntor desenha 6mm de traço entre a borda e o primeiro contato, e o
  condutor parava na borda — dava a impressão de linha solta antes do símbolo
  (relato do usuário no disjuntor do QGBT). Agora o fio entra por cima desse
  toco e a ligação vira um traço contínuo até o corpo. As alças e o snap
  continuam usando `portPagePosition`: quem se move é só o desenho do fio.

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
