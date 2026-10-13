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
| < 9 | células nível 1 (0,2°) | só risco/atenção, tolerância 0,004° | pontos |
| 9–10 | células nível 2 (0,05°) | tolerância 0,001° | pontos |
| 11–12 | células nível 3 (0,0125°) | tolerância 0,0003° | pontos |
| 13 | células nível 4 (0,005°) | tolerância 0,0003° | pontos |
| ≥ 14 | pontos, teto 4.000 | resolução guardada (0,00005°) | pontos |

Alimentadores vêm **recortados** à caixa de consulta e **simplificados** no
servidor por zoom; teto de 600 por vista, os mais ocupados primeiro. Sobre
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
