# Mapa de capacidade de rede e risco de inversão de fluxo

> Decidido com o usuário em 09–10/10/2026. Fonte do dado é a **BDGD da ANEEL**
> (não ONS nem EPE), granularidade **transformador e alimentador**, começando
> pela **CPFL** (Paulista + Piratininga) em **SP**. Mapa **exploratório
> navegável** no console `/painel`, acesso **só GD Manager (master)**.
> Abordagem **B**: o pesado é processado fora do banco, na VPS, e para o
> Supabase sobe só o indicador agregado. A defasagem do dado **não é
> descontada** (opção B da §6) — é rotulada. O mapa **não cruza com os
> projetos do GD Manager**: é um visualizador puro da base pública, sempre na
> última versão importada.

## Por que

A inversão de fluxo de potência é hoje uma das principais causas de reprovação
e de orçamento caro em conexão de MMGD. Quem vende o sistema descobre o
problema no parecer de acesso, depois de prometer prazo ao cliente. A pergunta
do usuário era se existe dado público que permita antecipar isso.

Existe, com ressalvas — e a primeira descoberta redireciona a pergunta.

## 1. O que a norma mede, e por que ONS e EPE não servem

O art. 73 da **REN ANEEL nº 1.000/2021** avalia a inversão de fluxo em dois
pontos: o **posto de transformação da distribuidora** (o trafo) e o
**disjuntor do alimentador**. A análise inclui a máxima capacidade de conexão
e escoamento sem inversão de fluxo.

Isso fixa a granularidade útil: **trafo de distribuição e alimentador de MT**.
Por isso:

- **ONS** cobre a Rede Básica (≥ 230 kV) e carga por subsistema/área — duas
  ordens de grandeza acima do ponto onde a conexão é reprovada.
- **EPE** publica projeção e estudo setorial (PDE, Anuário) — tendência, não
  capacidade pontual.
- **BDGD/ANEEL** é a única fonte pública com a granularidade certa.

A **REN nº 1.098/2024** acrescentou as dispensas da análise (MMGD que não
injeta; microgeração na gratuidade com potência compatível com o consumo no
período de geração; autoconsumo local ≤ 7,5 kW) e uma ordem de preferência das
mitigações (redução de potência → restrição horária → alteração do ponto de
conexão → diferimento com cronograma vinculante). Nesta entrega as dispensas
entram como **nota informativa na tela**, não como cálculo — porque dispensa se
avalia por projeto, e projeto está fora do escopo (§2).

Em **SP** não há mapa público de capacidade por alimentador nas quatro
distribuidoras (CPFL Paulista/Piratininga, Neoenergia Elektro, Enel SP,
EDP SP). A CPFL divulga capacidade do sistema de **subtransmissão** em
horizonte decenal; o "Mapa de Disponibilidade" que circula é de **Minas
Gerais**. Há legislação estadual nesse sentido em **Mato Grosso** e projeto
semelhante em Roraima — tendência, não vigente em SP. Existem produtos
comerciais vendendo mapa de calor de alimentadores, o que confirma que o dado
pronto não é público aqui.

## 2. Escopo — o que é e o que não é

**É** um visualizador da base pública de capacidade de rede, na última versão
importada, para a equipe da GD Manager consultar.

**Não é**, por decisão do usuário em 10/10/2026:

- não cruza com `projects`, `project_general_data` nem qualquer dado de tenant;
- não emite veredito sobre um projeto específico;
- não calcula dispensa de análise por projeto;
- não soma ao estoque de GD as solicitações internas do GD Manager.

Consequência positiva: como nada no sistema passa a opinar sobre um projeto do
cliente, o risco de passivo cai. A ferramenta é consulta de referência sobre
dado aberto.

Consequência a aceitar: `gd_conectada_kw` vem **só** da BDGD, então o indicador
é **otimista por construção** — não vê a geração que entrou depois da data-base.
Ver §6.

## 3. Dados

Schema `public`, prefixo `rede_`, pertencentes ao **tenant biblioteca**
(`tenants.is_library`), **sem `tenant_id`** — dado público idêntico para todos.
A exceção à regra de isolamento está registrada no **ADR 0009**.

| Tabela | Conteúdo | Volume esperado |
|---|---|---|
| `rede_distribuidora` | CPFL Paulista, CPFL Piratininga; código ANEEL, UF, data-base | unidades |
| `rede_subestacao` | ponto, nome, tensão, potência nominal | centenas |
| `rede_alimentador` | linha simplificada, tensão, GD conectada, semáforo | milhares |
| `rede_transformador` | ponto, kVA nominal, fases, carga mínima, GD, semáforo | centenas de milhares |
| `rede_celula_agregada` | célula por faixa de zoom, com risco predominante | milhares |
| `rede_importacao` | auditoria: data-base, arquivo, linhas por camada, status | dezenas |

Duas tabelas merecem justificativa:

**`rede_celula_agregada`** existe por causa do zoom. Num mapa exploratório,
zoom estadual não pode varrer centenas de milhares de pontos. Zoom distante lê
milhares de polígonos; zoom próximo lê feições reais no bounding box.

> **Refinamento na execução da Fase A (12/10/2026).** Esta spec previa a célula
> pré-calculada *na ingestão*. Ela passou a ser derivada **no banco**, por
> `rede_celula_recalcular()`: a célula é `floor(coordenada / passo)`, aritmética
> pura sobre `rede_transformador`. Com isso a ingestão fica só com insumos e o
> agregado volta a ser recalculável sem reimportar nada — a mesma separação
> insumo/veredito da §6, aplicada também ao zoom.

**`rede_importacao`** não é só auditoria: é ela que alimenta o rótulo de
data-base e de idade do dado na tela. Com a opção B da §6, esse rótulo é a
principal proteção da ferramenta.

### Tipos, índices e chaves

```sql
-- geometry/4326 (não geography): casa direto com lat/lng do Google Maps.
-- Distância em metros, quando precisar, por cast: geom::geography
geom geometry(Point, 4326) not null
create index rede_transformador_geom_idx on rede_transformador using gist (geom);

-- bigint identity nas tabelas grandes (não uuid): menos índice, join mais
-- rápido, e o argumento contra — enumeração — não se aplica a dado público.
id bigint generated always as identity primary key

unique (distribuidora_id, codigo)   -- upsert idempotente na reingestão
create index rede_transformador_alimentador_idx on rede_transformador (alimentador_id);
create index rede_transformador_risco_idx on rede_transformador (distribuidora_id)
  where risco <> 'folga';           -- parcial: a tela quase sempre quer o resto
```

GiST para geometria e índice em FK saem da skill
`supabase-postgres-best-practices`. **Particionamento fica fora**: a skill só o
recomenda acima de ~100M linhas, e estamos uma ordem de grandeza abaixo. Se a
base crescer para o Brasil, particionar por distribuidora (list) é a porta.

### Dimensionamento

O banco de produção hoje tem **58 MB, 133 tabelas, ~33.577 linhas** (medido em
08/10/2026). A base de rede, limitada às camadas acima, deve somar **150–300 MB**
— o banco vai para a faixa de 300–400 MB e continua pequeno. É essa conta que
sustenta a abordagem B: o que define o tamanho é a escolha de camadas, não o
tamanho do `.gdb` de origem.

**PostGIS 3.3.7 está disponível no projeto e não instalado** (`installed_version`
nulo) — basta habilitar. `pgrouting` 3.4.1 também está disponível.

## 4. Ingestão — na VPS

Alternativas consideradas e rejeitadas:

- **A — tudo no Supabase de produção**, com geometria completa: infla o banco
  para vários GB, com impacto em backup, PITR, custo de plano, e risco de uma
  varredura espacial competir com o app transacional. Rejeitada.
- **C — banco separado só para a rede**: isolamento total, mas custo de um
  segundo banco e federação de consulta. Caro demais para uma Fase 1 restrita
  à CPFL e a uma equipe. Fica como porta de saída se a base crescer além de SP.

**B — escolhida.** Pré-processamento fora do banco; para o Supabase sobe só o
indicador agregado.

### O passo que faz a abordagem valer

A BDGD traz a carga nas **unidades consumidoras**, não no transformador. Se a
agregação UC → trafo fosse feita no banco, seria preciso subir milhões de
linhas de UC para depois descartá-las. **A agregação acontece fora do banco**, e
sobe só o total por trafo. Os segmentos de BT não sobem.

### Pipeline

1. **Baixar** o `.gdb` (Geodatabase Esri, zipado) do portal de dados abertos.
2. **Extrair** as camadas com `ogr2ogr` (GDAL). **Não roda em Edge Function**:
   Deno não tem GDAL e o arquivo é grande.
3. **Transformar e agregar**: filtrar camadas, agregar UC e geração por trafo e
   por alimentador, simplificar traçado. Saída: um CSV por tabela de destino.
   As células de zoom **não** entram aqui — são derivadas no banco (ver §3).
4. **Carregar** com `COPY` (a skill de Postgres é explícita: 10–50× mais rápido
   que INSERT em lote) para tabelas de *staging*, e só então upsert para as
   definitivas **dentro de uma transação** — para o mapa nunca ficar
   meio-carregado.
5. **Registrar** em `rede_importacao`.

Idempotente por `unique (distribuidora_id, codigo)`. O que desapareceu da
origem é marcado, não apagado em silêncio.

**Cadência anual** (BDGD tem data-base 31/12). Não é job de `pg_cron` — é
comando repetível, rodado sob demanda uma ou duas vezes por ano.

### O guard-rail, que importa mais que o painel

Painel mostra que o disco encheu; não impede. Então o script **checa o espaço
livre antes de baixar** e aborta com mensagem clara se não couber o `.gdb` + o
descompactado + os CSVs — em vez de descobrir no meio e deixar sem espaço a VPS
que serve o app em produção pelo Nginx. A ingestão trabalha em diretório
próprio e limpa os intermediários ao terminar, com sucesso ou falha.

Credenciais (service role, acesso à origem) em env/secret do deploy. Nunca em
`src/`, nunca em migração, nunca em `.env` commitado.

## 5. Painel de armazenamento da VPS

Pedido pelo usuário junto com a escolha da VPS, e **entregável antes do mapa**:
é pequeno, de risco baixo, e dá a leitura de disco que se quer ter *antes* da
primeira ingestão de gigabytes. Vale por si para qualquer coisa que rode na VPS.

A SPA é estática e não vê o disco. Quem já está lá e já fala com o Supabase é o
worker da Ludmilla (Node 22 + TypeScript + supabase-js).

1. **`vps_armazenamento`** — host, partição, total/usado/livre em bytes, medido
   em, origem. Pequena, com retenção curta.
2. **O worker reporta** no loop que já tem, por heartbeat periódico. Já existe
   precedente no projeto (`portal_accounts.estacao_vista_em`).
3. **A ingestão também reporta**, ligada a `rede_importacao`: etapa atual e
   espaço ocupado. Travamento por disco aparece com causa, não como "parou".
4. **RPC `console_vps_armazenamento`** — última medição + série curta, no padrão
   das RPCs `console_*` que `MonitoringSection.tsx` já consome.
5. **Card na aba Monitoramento** de `/painel`, reaproveitando o `ChartBox` que a
   seção já tem. Limiar do alerta em configuração, não fixo no código.
6. **Retenção** por `pg_cron` (já instalado, 1.6.4).

RLS: métrica de infraestrutura é dado de plataforma — leitura só master,
escrita só service role.

## 6. O cálculo do risco

### Separar insumo de veredito

A ingestão grava **insumos** (potência nominal, carga mínima diurna estimada, GD
conectada). O semáforo é **derivado** por aritmética, numa coluna recalculável.

Isso importa porque os limiares vão mudar. Se o veredito fosse calculado na
ingestão, alterar "60%" na tela de Regras de Engenharia exigiria reimportar
gigabytes. Com a separação, uma RPC `grid_capacity_recalcular()` refaz os
semáforos **em segundos, sem tocar na BDGD**. A ingestão anual traz o fato; a
regra editável produz o juízo.

### De onde sai a "carga mínima diurna" — e a honestidade sobre isso

**A BDGD não tem esse campo.** Ela traz energia mensal por UC e uma tipologia de
curva de carga. O número sai de quatro passos, cada um com perda de precisão:

1. energia mensal da UC → curva horária, pela tipologia;
2. soma das curvas das UCs do trafo → curva agregada;
3. mínimo dessa curva dentro da janela de geração solar;
4. fator de segurança.

O resultado é **estimativa de engenharia, não medição**. Boa para ordenar
trafos por risco; péssima para afirmar um número a cliente. Por isso a tela
escreve "estimada" ao lado do valor e "indicativo, não é parecer" no rodapé —
não é disclaimer defensivo, é a descrição correta do dado.

### Fórmula

```
margem_kw   = carga_min_diurna_kw × fator_seguranca − gd_conectada_kw
ocupacao    = gd_conectada_kw / (carga_min_diurna_kw × fator_seguranca)

ocupacao < limiar_atencao          → folga
limiar_atencao ≤ ocupacao < 100%   → atenção
ocupacao ≥ 100%                    → risco
sem carga ou sem geração na base   → sem dado   (NUNCA "folga")
```

O último caso é deliberado: **ausência de dado não é ausência de risco**. Pintar
de verde um trafo sem informação é o jeito mais rápido de transformar esta
ferramenta em passivo.

### Grupo 13 — `grid_capacity` em `engineering_rules`

Nada fixo no código, pelo princípio do Motor de Engenharia (ADR 0007). O banco
tem hoje 12 grupos e 54 regras; `group_key` em inglês, label e descrição em
português. As seis regras novas:

| `rule_key` | Padrão | Unidade | `source` |
|---|---|---|---|
| `generation_window_start` | 9 | h | Regra interna |
| `generation_window_end` | 15 | h | Regra interna |
| `safety_factor` | 0,80 | × | Regra interna |
| `attention_threshold` | 60 | % | Regra interna |
| `risk_threshold` | 100 | % | REN 1.000/2021 (art. 73) |
| `power_factor` | 0,92 | × | Regra interna |

Histórico automático pelo trigger `log_engineering_rule_change` que já existe.
Regra desabilitada ou ausente → fallback neutro, como no resto do motor.

### A defasagem: opção B, escolhida pelo usuário

A BDGD é de 31/12 e a GD cresce rápido. Entre a data-base e hoje entrou geração
que a base não vê. Duas opções foram postas:

- **A** — descontar a margem proporcionalmente à idade do dado, com o percentual
  como regra editável. Semáforo conservador, envelhece junto com o dado.
- **B** — não descontar; mostrar o número cru e deixar a idade do dado visível.

**O usuário escolheu B** em 09/10/2026. Então `staleness_discount_per_year` não
existe, e o peso cai sobre a tela: a **idade do dado** é exibida com destaque no
cabeçalho e no detalhe, e o estado verde se chama **"sem risco aparente"** —
nunca "aprovado" ou "liberado". É essa palavra que o projetista vai repetir ao
cliente, e ela é a proteção que sobra.

### Construção

Lógica pura sobre números: caso de `test-driven-development`, exigido pela regra
da casa. Teste vermelho antes do código, cobrindo margem negativa, trafo sem UC
(deve dar "sem dado", não "folga"), limiar na fronteira exata, e regra
desabilitada caindo no fallback.

## 7. UI e estados

Rota nova no console **`/painel`** (não `/admin`): o console já tem acesso
restrito próprio, que é exatamente o público escolhido. O painel de
armazenamento fica na aba Monitoramento do mesmo console.

Mockup do design: `https://claude.ai/artifact/7rjbfTtf6NJVdpMow1V8Lc` (privado).

> **Revisado em 13/10/2026 — ver §11.** A primeira entrega travava e ficou
> aquém do mockup (sem busca, sem camadas, sem traçado de alimentador). O §11
> registra o diagnóstico medido e o desenho novo; o que está abaixo neste §7
> continua válido como princípio (lista acessível, cor nunca sozinha, estados).

### Consulta

Uma RPC `rede_no_mapa(bbox, zoom)` que decide a camada pelo zoom: distante lê
`rede_celula_agregada`; próximo lê trafos no bounding box, com teto de features;
geometria de alimentador simplificada por nível de zoom. No front, React Query
com **debounce de ~300ms** no pan/zoom e `keepPreviousData` — sem isso cada
arrasto dispara consulta e o mapa pisca. Cache por bbox arredondado.

### Estados

| Estado | O que a tela faz |
|---|---|
| Carregando | Skeleton nos cards; marcadores anteriores permanecem |
| Base nunca importada | Estado vazio dizendo o que falta e levando à importação |
| Idade do dado | Faixa permanente: "base de 31/12/2025 · 9 meses atrás" |
| Bbox com features demais | "Aproxime para ver pontos individuais", em vez de travar |
| Fora da área de concessão | Mensagem clara, não "sem risco" |
| Erro da RPC | Mensagem com nova tentativa, sem tela branca |

### Acessibilidade

Um mapa com mais de mil marcadores não é navegável por teclado. Então **o painel
lateral em lista é o equivalente acessível**, não enfeite: ordenável por
ocupação, navegável por teclado, com os mesmos dados do mapa. O mapa é o atalho
visual; a lista é a interface completa — e é o que serve em tela pequena.

**Cor nunca sozinha.** O semáforo verde/âmbar/vermelho é o pior caso para
daltonismo, e o validador da skill `dataviz` reprovou a primeira paleta:
`#3FB950` × `#F5A800` dava **ΔE 3,5 em protanopia** — indistinguíveis. A paleta
final é `#1F7A3D` / `#F5A800` / `#F0523F` / `#8A8A96`, com **ΔE 12,6**, acima do
alvo de 8. Além da cor, **cada estado tem forma própria**: círculo cheio (folga),
anel vazado (atenção), triângulo (risco), contorno tracejado (sem dado), e traço
distinto nos alimentadores. O mapa é legível em preto e branco.

Dois avisos do validador foram mantidos de propósito: o âmbar sai da banda de
luminosidade (é a cor da marca, e brand ganha da paleta padrão) e o cinza "lê
como cinza" (é o que "sem dado" deve parecer).

## 8. Permissões

RLS nas sete tabelas (seis de rede + `vps_armazenamento`):

- Leitura restrita a master pela função que já existe,
  **`public.is_master(auth.uid())`** (`STABLE SECURITY DEFINER`, lê
  `profiles.is_master`, protegida pelo trigger `fn_protect_master_flag`),
  envolvida em `(select …)` na política para rodar uma vez e não por linha.
  É o padrão das RPCs `console_*` e `master_*` do projeto.
  `app_metadata` (ADR 0003) é a confiança de **papel e tenant dentro do
  tenant** — admin/staff/company —, não o gate de master; quando a leitura for
  aberta a papéis do tenant, é dali que o papel vem, nunca de `user_metadata`.
- **Escrita: nenhuma política para `authenticated`.** Só service role grava, do
  servidor. Não há caminho pela API para alterar a base de rede.
- As três RPCs (`rede_no_mapa`, `grid_capacity_recalcular`,
  `console_vps_armazenamento`) como `security definer` com checagem de papel no
  corpo, no padrão das funções `_local` da Ludmilla.

A tarefa toca RLS, política, RPC nova e segredo — gatilho do `security-review`
pelo §2 do `desenvolveLuiz`. O checklist entra antes do
`verification-before-completion`.

### Duas brechas encontradas depois (13/10/2026)

O `security-review` acima **não bastou**. Quem achou foi o linter de segurança
do Supabase, rodado sobre o schema já aplicado. Vale registrar as duas, porque
nenhuma era erro de desenho — eram erros de aplicação:

1. **View sem `security_invoker` ignora a RLS.** As quatro views `rede_*`
   rodavam com os direitos do owner das tabelas, que não passa pela RLS.
   Qualquer um, inclusive anônimo, lia a base inteira por
   `rede_ponto_no_mapa` na API REST — a RLS "só master" ficava decorativa.
   Reproduzido antes de corrigir (`set local role anon` → 12 linhas) e
   corrigido com `security_invoker = true` mais `REVOKE` nas quatro.
2. **Os `REVOKE` do cálculo nunca rodaram.** O bloco final de
   `20261012120000_rede_calculo.sql` ficou para trás quando as funções foram
   aplicadas em pedaços durante a instabilidade do servidor MCP. `anon` podia
   chamar `rede_celula_limpar()` (DELETE sem gate) e `rede_aplicar_trafos()`
   (UPDATE sem gate). Nota: revogar do `PUBLIC` não resolve — o Supabase
   concede EXECUTE a `anon`/`authenticated` **nominalmente**, por
   `ALTER DEFAULT PRIVILEGES`; tem de revogar dos papéis pelo nome.

Lição de método, mais útil que as duas correções: **verificar permissão por
varredura, não por memória.** Eu confirmei os GRANTs só das funções que
lembrava ter revogado. A regra passa a ser consultar `has_function_privilege`
e `has_table_privilege` para **todo** objeto novo do schema, e rodar o linter
antes de dar a fase por pronta. Correção em
`supabase/migrations/20261013093000_rede_fechamento_views.sql`.

## 9. Verificação das pendências — resolvidas em 13/10/2026

Esta seção listava três pendências porque a política de rede do ambiente negava
todos os hosts das fontes. A rede foi liberada e as três foram **medidas** na
BDGD real da CPFL Piratininga (`CPFL_Piratininga_2937_2025-12-31_V11`). O que
está abaixo é dado observado, não mais conhecimento prévio.

### 9.1 Camadas e campos (pendência 1)

A BDGD tem **43 camadas**. As que o módulo usa, com o papel de cada uma:

| Camada | Feições (Piratininga) | Papel | Campos que importam |
|---|---|---|---|
| `UNTRMT` | 52.976 (Point) | → `rede_transformador` | `COD_ID`, `POT_NOM`, `CTMT`, `SUB`, `FAS_CON_P/S/T`, `TEN_LIN_SE`, `SIT_ATIV`, `DIST` |
| `CTMT` | 553 (sem geom) | → `rede_alimentador` | `COD_ID`, `NOME`, `SUB`, `TEN_NOM`, `ENE_01..12`, `PNTMT_01..12` |
| `SUB` | 139 (**MultiPolygon**) | → `rede_subestacao` | `COD_ID`, `NOME` |
| `SSDMT` | 396.983 (MultiLineString) | → `rede_alimentador.geom` (agregada por `CTMT` no `ogr2ogr`, §11) | `CTMT`, `Shape` |
| `UCBT_tab` / `UCMT_tab` | 2.037.215 / 7.581 | consumo → carga mínima | `UNI_TR_MT`, `TIP_CC`, `ENE_01..12` |
| `UGBT_tab` / `UGMT_tab` | 49.771 / 569 | GD já conectada | `UNI_TR_MT`, `POT_INST`, `CEG_GD`, `DAT_CON` |
| `CRVCRG` | 204 | curvas de carga | `COD_ID`, `TIP_DIA`, `POT_01..POT_96` |

Três achados que mudam a implementação:

- **`UGBT_tab.UNI_TR_MT` aponta direto para `UNTRMT.COD_ID`.** A GD por
  transformador é `sum(POT_INST) group by UNI_TR_MT` — não precisa de
  cruzamento espacial, que era o risco do desenho original.
- **`CRVCRG` tem 96 valores de quarto de hora por tipologia e tipo de dia**
  (`DU`/`SA`/`DO`, 68 tipologias). A junção `UCBT_tab.TIP_CC` →
  `CRVCRG.COD_ID` fechou **51 de 51** valores na amostra, com zero UCs sem
  `UNI_TR_MT`. Ou seja: a carga mínima **diurna** é calculável de verdade,
  não estimada por média.
- **`SUB` vem como MultiPolygon**, e `rede_subestacao.geom` é
  `geometry(Point,4326)`. A ingestão tem de aplicar `ST_PointOnSurface` (ou
  mudar a coluna). Decidido: centroide na ingestão, porque a tela só usa o
  ponto.

### 9.2 Volume (pendência 2)

| | zip | extraído | razão |
|---|---|---|---|
| CPFL Piratininga | 0,41 GB | **2,2 GB** | 5,3× |
| CPFL Paulista | 1,22 GB | ~6,5 GB (estimado pela razão) | — |

O guard-rail de disco da VPS precisa de folga para zip + extraído ao mesmo
tempo: **~8 GB** para a Paulista. Dá para derrubar o zip após extrair.

### 9.3 Consulta própria das distribuidoras (pendência 3)

Não verificada — não era necessária para a Fase A e não bloqueia o Plano 3. Se
alguma distribuidora de SP publicar consulta de capacidade por ponto, ela é
complemento, não substituto: a BDGD é a única fonte uniforme para as quatro.

### 9.4 A fórmula rodada sobre dado real

A cadeia da §6 foi executada uma vez sobre a Piratininga inteira para validar a
fórmula antes de escrever a ingestão. Normalização usada: a **forma** da curva
(mínimo diurno ÷ média diária), que torna o resultado independente de como a
ANEEL normaliza `POT_xx`.

Entrada: 2.044.796 UCs, 49.770 unidades geradoras, **267,9 MW** de GD já
conectada, 52.976 transformadores. Saída com os defaults do grupo 13 (fator
0,80 · atenção 60% · risco 100%):

| estado | trafos | % |
|---|---|---|
| risco | 6.183 | 11,7% |
| atenção | 2.406 | 4,5% |
| folga | 40.586 | 76,6% |
| sem dado | 3.801 | 7,2% |

**Isto é resultado de um script de validação, não da ferramenta** — serve para
mostrar que a cadeia fecha e que a ordem de grandeza é plausível, não como
número de produto.

Uma checagem que valeu: duas das 68 tipologias têm mínimo diurno **zero** —
`IP-Tipo1` (iluminação pública) e `SP-Tipo10`. Zero ao meio-dia em iluminação
pública é **fisicamente correto**, não defeito de dado, e as duas somam 0,14%
das UCs e 0,29% da energia; não distorcem o resultado. Melhor ainda: um trafo
que só alimente iluminação pública cai em `carga <= 0` e a regra já o manda
para `sem_dado`, nunca para `folga`.

## 10. Fora desta entrega

- **Bloco de risco dentro da tela do projeto**, que sairia quase de graça da
  mesma RPC. Fora por decisão de escopo de 10/10/2026.
- **Elektro, Enel SP e EDP SP** — a estrutura é a mesma, só muda a origem.
- **Histórico entre data-bases** (comparar a GD conectada de uma base para a
  seguinte, mostrando tendência de saturação). Exige guardar mais de uma versão.
- **Solicitar à distribuidora** a capacidade de barra e a corrente de
  curto-circuito presumida, que a REN 1.000/2021 obriga a informar **quando
  solicitada** — caminho para dado atual, por ponto, que a Ludmilla já poderia
  pedir no portal CPFL que ela automatiza.

## 11. Revisão de UX e desempenho (13/10/2026)

Depois da carga real das duas CPFL, o usuário relatou: mapa travando, sem
busca de cidade ou região, sem escolha de camadas, e sem a capacidade da
linha de distribuição que o mockup mostrava. Pediu que a apresentação fosse
feita "com extremos aspectos de UX". Esta seção é o resultado do diagnóstico
e o desenho da segunda entrega. Plano:
`docs/superpowers/plans/2026-10-13-capacidade-rede-mapa-v2.md`.

### 11.1 Diagnóstico, medido

| Sintoma | Causa, com a evidência | Decisão |
|---|---|---|
| Trava ao arrastar | Cada trafo era um `<Marker>` React. A biblioteca compara `icon`/`position` por **identidade** e a tela criava objetos novos a cada render; todo `onIdle` disparava `setIcon`+`setPosition`+`setTitle` em até 1.500 marcadores legados (`@react-google-maps/api/dist/esm.js:2141-2184`). | **Uma camada vetorial** (`google.maps.Data`) por tipo de feição: um `addGeoJson` por resposta, um `setStyle` por mudança de estilo, zero recriação ao arrastar. Mesma biblioteca, sem dependência nova. |
| "Aproxime para ver cada um" na cidade inteira | As células agregadas paravam no zoom 11 (nível 2 = 0,05° ≈ 5,5 km). No zoom 12 Campinas tem **12.274** trafos; a RPC devolvia os 1.500 piores por ocupação em **624 ms / 432 KB** — recorte enviesado e lento. Zoom 13: 4.672; zoom 14 (centro): 2.183. | Dois níveis novos de célula: **3 = 0,0125°** (≈1,4 km, zooms 11–12) e **4 = 0,005°** (≈550 m, zoom 13). Pontos só do **zoom 14** em diante, teto **4.000** (a camada vetorial aguenta). |
| Cache enganoso | A chave da consulta arredondava a caixa a 2 casas: arrastar 500 m reaproveitava dado que **não cobria** a área nova. | Caixa de consulta **20% maior** que a vista e chave com 3 casas (≈55 m no zoom 14). |
| Mapa pequeno | 460 px de altura numa coluna de 1.180 px. O mockup era tela cheia. | Seção ocupa a altura do console; legenda e busca flutuam sobre o mapa; gaveta de detalhe à direita. |
| Sem traçado de alimentador | `rede_alimentador.geom` já era `geometry(MultiLineString,4326)`, mas a `SSDMT` nunca foi extraída. O risco por alimentador **existe** (600 risco · 466 atenção · 992 folga · 272 sem dado) e não aparecia. | Extrair a `SSDMT` **agregada por `CTMT` no `ogr2ogr`**. Medido na Piratininga: `ST_SimplifyPreserveTopology(ST_LineMerge(ST_Collect(SHAPE)), 0.00005)` → **3,3 s, 5,4 MB, 550 linhas** (máx. 69 KB, mediana 6,4 KB). `ST_LineMerge` antes é obrigatório: sem ele o simplify não remove nada (cada trecho tem 2 pontos: 8.582 → 8.582; com merge, → 2.210). Exige **reingestão** das duas CPFL (`--forcar`). |

Dois achados de passagem: a seção não passava `libraries: ['places']` ao
loader enquanto outras telas passavam, o que a biblioteca rejeita quando as
duas são abertas na mesma sessão; e `pg_trgm` não estava instalado (a busca
precisa dele).

### 11.2 O desenho

**Camadas** (ligáveis em conjunto): Transformadores · Alimentadores ·
Subestações, mais o filtro "só o que não está com folga". O servidor decide o
que devolver pelo zoom:

| Zoom | Trafos | Alimentadores (se ligados) | Subestações (se ligadas) |
|---|---|---|---|
| < 9 | células nível 1 (0,2°) | **não vêm** (1 px por linha; a célula já diz o risco) | pontos |
| 9–10 | células nível 2 (0,05°) | só risco/atenção, nível 1 (0,003°), teto 300 | pontos |
| 11–12 | células nível 3 (0,0125°) | nível 2 (0,001°), teto 600 | pontos |
| 13 | células nível 4 (0,005°) | nível 3 (0,0003°) | pontos |
| 14 | pontos, teto 4.000 | nível 3 | pontos |
| ≥ 15 | pontos, teto 4.000 | resolução guardada (0,00005°) | pontos |

Os níveis dos alimentadores são **pré-calculados na promoção**
(`rede_alimentador_simplificar`), não na hora: `ST_SnapToGrid` +
`ST_UnaryUnion` costuram os trechos (que a ANEEL entrega sem nó comum exato),
`ST_LineMerge` devolve ramos longos, `ST_Simplify` reduz e ramos menores que a
tolerância somem. Sem a costura, 73% dos alimentadores sumiam no zoom baixo
(um de 30 km chegava em 383 partes de ≤ 500 m). O recorte à caixa é
`ST_ClipByBox2D`, não `ST_Intersection` (overlay GEOS que custava 1,6 s), e o
filtro espacial é `&&` (índice), porque o `ST_Intersects` exato sobre mil
árvores de 600 pontos custava 0,7 s sozinho. Medido ao final: zoom 12 em
Campinas 219 linhas em ~210 ms; os números por faixa estão no plano. Sobre
satélite, a linha ganha um **contorno escuro** (segunda camada vetorial com as
mesmas feições, traço largo escuro por baixo), pelo mesmo motivo dos marcadores.
Traço distinto por estado: risco contínuo e grosso, atenção médio, folga fino e
mais transparente, sem dado cinza fino — além da cor.

**Busca**: um campo só, no topo do mapa. O texto vai em paralelo ao Places do
Google (município, bairro, endereço; país BR, viés para a vista atual) e à RPC
`rede_buscar` (código de trafo, de alimentador, nome ou código de subestação).
Uma lista só, navegável por teclado (`combobox`/`listbox`). Escolher um lugar
enquadra a vista; escolher um item da rede enquadra **e** abre o detalhe.

**Painel lateral** (continua o equivalente acessível do mapa):

- **Resumo da área visível**: quatro tiles (folga, atenção, risco, sem dado)
  com percentual e contagem, sempre sobre o total da área e não sobre o teto.
- **Lista contextual**: em zoom de pontos, "Transformadores nesta vista" por
  ocupação; com alimentadores ligados, "Alimentadores mais saturados na vista".
- **Detalhe do trafo**: veredito em texto, números, **barra de ocupação com a
  marca dos 100%**, contexto do alimentador ("212 trafos · 37 em risco", via
  `rede_alimentador_detalhe`), procedência (fonte, data-base, importada em,
  idade).
- **Detalhe do alimentador**: números, trafos por estado, subestação, botão
  "enquadrar este alimentador".

**Micro-interações**: faixa de carregamento fina sobre o mapa (nada pisca; o
dado anterior fica até o novo chegar); passar o mouse mostra código e estado
numa faixa fixa no canto do mapa (sem balão flutuante que esconde o ponto);
clicar destaca com halo via `overrideStyle`; a vista (centro, zoom, camadas,
satélite) fica em `sessionStorage` para voltar onde parou. Legenda com os
limiares reais lidos de `rede_regras()` ("Atenção — entre 60% e 100% da margem").

### 11.3 Contratos

`rede_no_mapa_v2(p_oeste, p_sul, p_leste, p_norte, p_zoom, p_so_risco,
p_camadas text[])` → jsonb:

```json
{ "base": {…}, "regras": { "fator": 0.8, "atencao": 60, "risco": 100 },
  "zoom": 13, "camada": "celula", "nivel": 4,
  "resumo": { "total": 1234, "risco": 100, "atencao": 50, "folga": 1000, "sem_dado": 84 },
  "pontos": null, "celulas": { "type": "FeatureCollection", "features": [...] },
  "alimentadores": {…} | null, "subestacoes": {…} | null,
  "teto": 4000, "excedeu": false }
```

Toda feição é GeoJSON com `id` no topo (a camada vetorial usa para
`overrideStyle`) e as propriedades que a tela precisa, já calculadas no
servidor. `rede_buscar(p_texto, p_limite)` → lista de
`{tipo, id, codigo, nome, risco, lng, lat, oeste, sul, leste, norte}`.
`rede_alimentador_detalhe(p_id)` → números, contagens de trafos por estado,
subestação e caixa envolvente. As três são `SECURITY DEFINER` com portão
`is_master`, e a varredura de privilégios cobre **todo** objeto novo (§8).

`rede_alimentador` ganha as contagens de trafos por estado, recalculadas junto
com o semáforo (`rede_contar_trafos_alimentador()`), e `rede_stg_alimentador`
ganha `geom_wkt`. A RPC v1 (`rede_no_mapa`) fica no banco sem chamador; o
`DROP` depende do portão do MCP e vai numa limpeza posterior.

### 11.4 O que continua fora

Agrupamento de pontos no cliente (`supercluster`), `deck.gl` ou MapLibre:
descartados porque a camada vetorial nativa resolve o volume medido (≤ 4.000
pontos, ≤ 600 linhas) sem dependência nova. Se uma distribuidora futura
estourar isso, o caminho é mais um nível de célula, não outra biblioteca.

## 12. Revisão de desempenho e auditoria (15/10/2026) — mapa v3

Depois da v2 publicada (PR #4), o usuário relatou: "ficou bem melhor, porém
está travando bastante". Pediu também um "pesquise aqui" com amostragem pelo
zoom, perguntou se "alimentador" é o termo certo, e como auditar os dados
mesmo com a fonte desatualizada. E corrigiu o foco: **o que interessa é a rede
de BT** — a MT não é o gargalo; a maioria dos sistemas conecta em baixa tensão.

### 12.1 Diagnóstico medido

Vista de 1920×1080 sobre Campinas, caixa já com a folga de 20%, as duas CPFL
carregadas (295.197 trafos). `pg_column_size` do JSONB devolvido:

| Zoom | Células / pontos | Alimentadores | Partes de linha | Vértices | Total |
|---|---|---|---|---|---|
| 11 | 4.000 células (teto — **cortadas**) · 2,5 MB | 600 · 5,8 MB | 59.877 | 125.934 | 8,4 MB |
| 12 | 2.071 células · 1,3 MB | 600 · 4,3 MB | 43.543 | 90.776 | 5,6 MB |
| 13 | 3.038 células · 1,9 MB | 398 · 4,3 MB | 43.276 | 94.410 | 6,3 MB |
| 14 | 4.000 pontos (de 12.508) · 2,2 MB | 226 · 2,0 MB | 20.060 | 43.165 | 4,2 MB |
| 15 | 4.000 pontos (de 6.252) · 2,2 MB | 114 · 1,4 MB | 13.477 | 32.051 | 3,6 MB |
| 16 | 3.031 pontos · 1,6 MB | 72 · 0,7 MB | 6.869 | 15.627 | 2,3 MB |

Causas, por peso:

1. **A `google.maps.Data` desenha em SVG, um `<path>` por parte.** A rede de
   MT é uma árvore e o `ST_LineMerge` não une em nó de grau 3: 2,1 vértices por
   parte em média, 100 partes por alimentador. No satélite a camada de
   contorno dobra. São 40 a 120 mil elementos SVG reposicionados a cada
   arrasto — e a camada vinha **ligada por padrão**.
2. **Tabela de níveis calibrada numa tela pequena e só com a Piratininga.**
   Com a Paulista e uma tela grande, o zoom 11 passa de 11 mil células e o
   teto de 4.000 deixa região em branco; o zoom 14 em Campinas tem 12.508
   trafos — 4.000 marcadores sobrepostos não informam nada.
3. **O painel lateral lista os 4.000 trafos** e a seção inteira re-renderiza a
   cada `mouseover` (estado `sobre`), sem `memo`.
4. **540 bytes por ponto**: as propriedades que só o detalhe usa viajam com
   todos os pontos.

### 12.2 Decisões

- **BT é a unidade de análise, e a tela diz isso.** O trafo MT/BT (camada
  `UNTRMT`) é onde a GD em baixa tensão se conecta; carga vem de `UCBT`, GD de
  `UGBT`. Era assim desde a Fase A, mas a tela não explicava. Rótulos:
  "Transformador MT/BT — ponto de conexão em baixa tensão"; "Alimentador MT —
  contexto". `Alimentadores` passa a vir **desligado por padrão**.
  "Alimentador" é o termo correto: `CTMT` da BDGD, o circuito de média tensão
  que sai da subestação, o mesmo nome do parecer de acesso. "Linha de
  distribuição", no PRODIST, é a de 69–138 kV (`SSDAT`), que não carregamos.
- **Amostragem adaptativa no servidor, por contagem e não por zoom.** A RPC
  conta os trafos da caixa (com `LIMIT teto+1`, para parar cedo). Até 4.000:
  pontos. Acima: o passo de célula mais fino que caiba em 3.000 células na
  caixa. Entra o **nível 5 (0,0025°, ~275 m)**: no zoom 15 em Campinas são
  6.252 trafos, e o nível 4 daria 276 blocos de 120 px. Zona rural vê pontos
  no zoom 12; o centro de Campinas vê células até o 15. Nunca corta.
- **WebGL (deck.gl 9.4, `GoogleMapsOverlay`) em vez de SVG** para pontos,
  células e linhas. Ícones por risco num atlas desenhado em canvas (as mesmas
  formas da v2), células em `GeoJsonLayer`, linhas em `GeoJsonLayer` com
  contorno sobre satélite. Carregado por `import()` só nesta tela. Procurado
  no registro de skills (`npx skills find deck.gl`): nada; a biblioteca é a
  referência da área.
- **"Pesquisar nesta área"**: quando a vista sai da caixa carregada, aparece o
  botão; "atualizar ao mover o mapa" (ligado por padrão) mantém o comportamento
  atual. Não resolve o travamento (que é de renderização), mas corta consultas
  enquanto a pessoa só navega e protege a instância pequena.
- **Payload enxuto**: ponto = `{id, codigo, risco, ocupacao_pct}`; célula =
  `{id, nivel, risco, trafos, trafos_risco}`; o resto vem no clique
  (`rede_trafo_detalhe`). Alimentadores no zoom 11–12 usam o nível 1 do
  traçado (ramos < 330 m somem; 1 px = 76 m no 11).
- **Painel**: `React.memo`, lista de 40 com "mostrar mais", callbacks
  estáveis.

### 12.2.1 Medido depois da migração (15/10/2026, mesma vista)

| Zoom | Amostra | Células/pontos | Bytes | Alimentadores (opcional) |
|---|---|---|---|---|
| 9 | nível 1 | 208 células | 100 KB | 299 · 2,9 MB |
| 11 | nível 2 | 431 células | 210 KB | 600 · 2,3 MB |
| 12 | nível 3 | 2.071 células | 1,0 MB | 600 · 1,6 MB |
| 13 | nível 3 | 748 células | 364 KB | 391 · 2,2 MB |
| 14 | nível 4 | 991 células | 483 KB | 220 · 962 KB |
| 15 | nível 5 | 1.012 células | 494 KB | 114 · 862 KB |
| 16 | pontos | 3.033 pontos | 778 KB | 72 · 404 KB |

A camada principal caiu de 2–8 MB para 0,2–1 MB por vista e nunca corta. Os
alimentadores continuam pesados em rede (a árvore tem ~40 partes por linha
mesmo no nível 1) — por isso opcionais, desligados por padrão e em consulta
separada; em WebGL o desenho deles não custa.

### 12.3 Auditoria dos dados (duas camadas nesta rodada)

1. **Ficha da fonte**, por distribuidora e por importação: arquivo da ANEEL,
   versão da BDGD (`V11`), data-base, **SHA-256 do zip** e tamanho, quando foi
   baixado, contagens por camada, **regras vigentes na carga** (fator,
   limiares, janela) e **mudanças em relação à carga anterior** (novos,
   inativados, matriz de risco antes→depois). Tabela nova
   `rede_transformador_hist` guarda risco/ocupação/insumos por importação.
2. **Conta aberta** no detalhe do trafo: a fórmula com os números
   (`carga mínima diurna × fator − GD conectada = margem`; `GD ÷ (carga ×
   fator) = ocupação`), os campos brutos da BDGD (`COD_ID`, `POT_NOM`,
   `CTMT`, `SUB`, fases, tensão), **UCs atendidas e unidades de GD** no trafo
   (novas colunas; vêm na próxima reingestão) e o estado na carga anterior.

Fora desta rodada (próxima spec, decisão do usuário): o **confronto com a
realidade** — registrar o parecer de acesso real por trafo/alimentador e
medir a taxa de acerto por distribuidora; e a **rede BT propriamente**
(`SSDBT`, `RAMLIG`): traçado do circuito de BT de cada trafo, comprimento,
condutor, UCs por fase — os critérios de elevação de tensão que o parecer
de BT também olha.

## 13. Confronto com a distribuidora (15–16/10/2026)

### 13.1 O que aconteceu

O usuário trouxe um orçamento de conexão real da CPFL Paulista (estudo
OC00693/10-2026, pedido 2248586925, São José do Rio Preto) e não achou na
busca o "posto de transformação 189049" que o documento cita. Dois fatos:

1. **O número do posto não existe na BDGD.** A camada `UNTRMT` identifica o
   trafo só pelo `COD_ID` do GIS da distribuidora (`33820988`); `DESCR` é
   "AEREO", `PAC_1/2` são nós, `UNI_TR_AT` é o trafo da SE. O número
   operacional vive no GISD da CPFL e não é publicado. O trafo foi achado
   pelas coordenadas da UC (a 57–72 m): 45 kVA, mesmo alimentador AMC08,
   48 UCs (CPFL: 45), 5 unidades de GD (CPFL: 5).
2. **A GD estava 3,5× subestimada.** CPFL: 18,85 kW; nós: 5,42 kW. Conferido
   no cadastro aberto da ANEEL (`empreendimento-geracao-distribuida.parquet`,
   4,67 milhões de linhas): a potência instalada da ANEEL é igual ao
   `DEM_CONT` da BDGD em 8 de 8 unidades testadas; `POT_INST` é a potência
   média gerada (frações de 1/60, 1/90 — energia ÷ horas de sol). Piratininga:
   `DEM_CONT` 369,6 MW, `POT_INST` 164,4 MW, ANEEL 523 MW. Corrigido em
   `GD_KW` (PR #7); reingestão da Piratininga: 13.210 trafos em risco (eram
   6.176), 10.216 mudaram de estado (5.083 folga→risco, 2.408 folga→atenção,
   2.311 atenção→risco). A carga mínima bateu: 11,0 kW nossa, 11–13 kW na
   curva da CPFL entre 9h e 14h.

### 13.2 Decisões

- **Busca por coordenada** (`coordenadaDe` em `busca.ts`): decimal ou DMS
  como vem no orçamento; vai ao ponto e abre o trafo mais próximo
  (`rede_trafo_mais_proximo`, KNN pelo GiST, raio de 300 m). Um inteiro
  solto (código de trafo, número do posto) nunca é coordenada.
- **Registro do parecer no trafo** (`rede_parecer`, só master; escrita por
  `rede_parecer_registrar`, anulação por UPDATE, nunca DELETE): tipo
  (orçamento de conexão / parecer de acesso / outro), número do posto da
  distribuidora, nº do estudo e do pedido, data, potência solicitada,
  **resultado** (já inverte sem o novo · inverte só com o novo · sem
  inversão · aprovado · aprovado com obra · reprovado), potência injetável,
  os números que a distribuidora declarou (UCs, unidades e kW de GD, carga
  mínima), PDF no bucket privado `rede-pareceres` com SHA-256, e **o que o
  modelo dizia na hora** (risco, ocupação, GD, carga, importação) —
  congelado, porque a base muda.
- **Acerto** (`rede_parecer_acerto`, espelhado em `confronto.ts`): "já
  inverte" ou "reprovado" só é acerto se o modelo dizia risco; os outros
  resultados são acerto se dizia atenção ou folga; sem dado não conta. A
  ficha da fonte mostra registrados, acertos, erros e taxa por distribuidora.
- **O número do posto vira pesquisável**: `rede_buscar` procura em
  `rede_parecer.codigo_distribuidora` (trgm) e devolve o trafo.

Fica para depois: ler o PDF da CPFL automaticamente (os campos têm posição
fixa no modelo deles) e a rede de BT propriamente (`SSDBT`, `RAMLIG`).

## Fontes

Normativas: [REN 1.000/2021](https://www2.aneel.gov.br/cedoc/ren20211000.html) ·
[REN 1.098/2024](https://www2.aneel.gov.br/cedoc/ren20241098.html) ·
[Estudos de inversão de fluxo, art. 73 §1º](https://www2.aneel.gov.br/cedoc/adsp20242216_2.pdf)

Dado: [BDGD no Portal de Dados Abertos da ANEEL](https://www.gov.br/aneel/pt-br/assuntos/noticias/2023/conjuntos-de-dados-do-bdgd-siget-e-samp-estao-disponiveis-no-portal-de-dados-abertos-da-aneel) ·
[ArcGIS Hub da ANEEL](https://dadosabertos-aneel.opendata.arcgis.com/) ·
[SIGEL/ANEEL](https://open-geodata.readthedocs.io/pt-br/latest/pages/dados/br/aneel_arcgis/)

Distribuidora: [GED-15.303 — Conexão de MMGD CPFL](https://www2.cpfl.com.br/sites/cpfl/files/2021-12/GED-15303.pdf) ·
[GED-4313 — Subtransmissão CPFL](https://www.cpfl.com.br/sites/cpfl/files/2025-02/GED-4313%20-%20Conex%C3%A3o%20aos%20Sistemas%20El%C3%A9tricos%20de%20Subtransmiss%C3%A3o%20da%20CPFL%20(vers%C3%A3o%2019)_1.pdf)

Precedentes em outros estados: [Mapa de disponibilidade (MG)](https://www.mg.gov.br/node/20698) ·
[Lei MT 13.034/2025](https://www.legisweb.com.br/legislacao/?id=483502)
