# ADR 0007 — Engineering Rules Engine (regras de engenharia centralizadas)

**Status**: aceito (Fase 1 implementada) · **Data**: jul/2026

## Contexto

O usuário pediu um módulo que centralize todas as regras de dimensionamento
simplificado do GD Manager, dentro do Motor de Templates, para orientar
automaticamente diagramas unifilares, listas de materiais e memoriais.
Requisitos explícitos: prático e sem complicação (operável por quem tem
pouco conhecimento de engenharia); NÃO substituir PVsyst/AutoCAD; nunca
deixar valores fixos no código; o motor nunca desenha e nunca bloqueia;
sempre ≥2 sugestões quando houver mais de uma opção válida.

## Decisões

1. **Regras como DADOS, não código.** Uma única tabela `engineering_rules`
   (grupo + chave + valor padrão/mín/máx + fonte + prioridade + notas)
   cobre os 12 grupos. O código conhece só as chaves e tem fallbacks
   neutros. Alternativa rejeitada: uma tabela por grupo (12 schemas) —
   burocracia sem ganho; o formato uniforme permite UMA tela genérica de
   edição e grupos novos sem migração.
2. **Histórico por trigger, não por código.** `engineering_rule_history` é
   preenchida por trigger BEFORE UPDATE — o app não tem como esquecer de
   registrar.
3. **Motor puro e separado do desenho.** `rulesEngine.ts` não importa nada
   do cadEngine: recebe números + regras, devolve `{opções, alertas}`. O
   CAD engine consome o RESULTADO (via "Usar esta" no UnifilarTab, que
   reaproveita `multiplyInverterBranches`). Mantém o princípio "o Rules
   Engine nunca desenha" e deixa o motor testável headless.
4. **Datasheet no catálogo como jsonb (`tech_specs`)**, não colunas: os
   campos variam por tipo de equipamento (inversor × módulo ×
   microinversor) e vão crescer; leitura tolerante
   (`inverterSpecsFromTechSpecs`) ignora lixo. Sem datasheet → fallbacks
   das regras + alerta "sugestão aproximada" (regra `alerts.
   warn_on_incomplete_datasheet`, desligável).
5. **Janela de tensão simplificada**: minN = ⌈Vmin_MPPT/Vmp⌉; maxN =
   min(⌊Vmax_MPPT/Vmp⌋, ⌊VmaxCC/(Voc×fator_frio)⌋) com `voc_temp_factor`
   configurável (padrão 1,13) em vez do cálculo exato por coeficiente
   térmico — coerente com o objetivo "dimensionamento simplificado";
   quem quiser rigor ajusta o fator ou usa software especializado.
6. **Ranking dos arranjos**: uniforme > quase-uniforme; tensão perto do
   meio da janela; MPPTs equilibrados; menos strings como desempate.
   Garante que "6×20" vença "5×24" quando ambos valem, sem esconder o
   segundo (mínimo de 2 sugestões, regra `suggestions.num_suggestions`).
7. **Alertas nunca bloqueiam** — severidade máxima é `warning` com campo
   `suggestion` (o que fazer). Sem exceção, por pedido explícito.

## Fase 1 entregue / próximas

- **Entregue**: tabelas + seed (30 regras/12 grupos), tela Regras de
  Engenharia (cards, busca, filtro por fonte, edição, histórico), motor
  dos Grupos 1/2/3/5/11/12, painel "Sugestões do Motor" no projeto com
  "Usar esta" gerando o diagrama. 24 testes headless (inclui os exemplos
  do briefing: 120→6×20/5×24; 240 em 2×75kW→120+120/118+122).
- **Fase 2 (entregue)**: liga/desliga por FUNÇÃO (regra `group_enabled`
  por grupo, interruptor no cabeçalho do card — pedido direto: "botão pra
  habilitar e desabilitar cada regra e função do motor"; decisão: a chave
  do interruptor é uma REGRA comum, então ganha histórico e RLS de graça)
  e por regra individual (Toggle no lugar do checkbox);
  `suggestElectricalSizing` (Grupos 6–9): queda de tensão simplificada
  (NBR 5410, k×ρ×L×I/(S×V)), bitola = menor seção comercial que atende
  queda máxima + mínimo da regra, disjuntor = próximo rating comercial ≥
  fator×I, aterramento/DPS pelas regras; bloco "Dimensionamento elétrico"
  no painel do projeto; formulário de datasheet estruturado (tech_specs)
  no cadastro de Equipamentos (campos por tipo, colapsável). Decisão:
  seções/ratings comerciais são CONSTANTES de mercado no código; mínimos,
  fatores, ρ, comprimentos padrão e tensões da rede são regras editáveis.
- **Topologia multi-arranjo (jul/2026)**: "Usar esta" passou a gerar a
  cena por `buildMultiArrangementScene` — 1 disjuntor CA por arranjo
  (obrigatório, pedido direto do usuário), junção em nó com derivação
  formal, disjuntor geral de seccionamento OPCIONAL (regra
  `protections.include_general_ac_breaker`), DPS em paralelo DEPOIS da
  junção e caminho de referência "Cargas do local" (regra
  `arrays.include_loads_reference`). Decisões: (a) a cena sai 100% com ids
  `manual-` — reaproveita a regra de passthrough das cenas de modelo, então
  o reconcile nunca recria nada e a edição no projeto é livre; (b) os
  liga/desliga da topologia são REGRAS comuns (ganham histórico, RLS e
  interruptor de graça); (c) junto veio `suppressedIds` no
  DiagramSceneState: remover um componente FIXO do cadastro passa a ser
  permitido e o reconcile respeita a remoção ("Restaurar" desfaz).
- **Padrão de entrada + auto-reorganização (jul/2026)**: o diagrama
  automático ganhou o bloco PADRÃO DE ENTRADA — disjuntor do padrão ao
  lado do medidor (legenda vinda das regras de padrão de entrada da
  concessionária, `matchEntryRule` — REUSO da tabela
  `concessionaire_entry_rules`, sem duplicar regra), DPS do padrão em
  paralelo ao disjuntor do padrão (exigência das concessionárias) e a
  placa de advertência de geração própria (símbolo novo `warning-sign`).
  Decisões: (a) o bloco é uma caixa de grupo com `moveContents` — o
  analista da concessionária enxerga o padrão como unidade e o projetista
  move tudo junto; (b) com >3 arranjos o layout SE REORGANIZA sozinho
  (espaçamento comprime e os símbolos do ramal reduzem de escala até
  0,6×) em vez de crescer a prancha — A4 é o formato aceito nas
  homologações; o padrão de entrada nunca reduz.
- **Fase 3**: microinversores completos (cadastro + ramais), memoriais/
  lista de materiais consumindo o sizing, checklist e assistente; fluxo
  Projeto→Motor→Validação→Sugestões→CAD→Documentação fechado.
