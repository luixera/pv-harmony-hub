# Conjuntos de equipamento — mais de um modelo de inversor e de módulo no mesmo projeto

> Decidido com o usuário em 01/10/2026. Abordagem **A** (tabela de conjuntos +
> `project_equipment` como resumo mantido por gatilho), aprovada nas cinco
> partes: dados, telas, motor/unifilar, documentos e Bidu.

## Por que

Ampliação e retificação deixam o projeto com **dois modelos** de inversor e/ou
de módulo. Hoje `project_equipment` tem uma linha por projeto com um par fixo
(marca/modelo/potência/quantidade de inversor e de módulo), então o segundo
modelo não cabe: a equipe digita um deles e descreve o outro no memorial, e o
dimensionamento sai pela média.

O usuário pediu para **não** modelar o motivo (ampliação × retificação): o
projeto simplesmente tem N conjuntos.

## O que é um conjunto

Um conjunto é **um inversor com os módulos dele**:

```
Conjunto 1 — 1× Sungrow SG7.5RS-L (7,5 kW)  +  16× ERA ERA-RC66HD 610M (610 W)
Conjunto 2 — 1× Growatt NEO 2250M-X2 (2,25 kW) + 4× GOKIN GK-4-66HTBD-610M-F (610 W)
```

A amarração é explícita (decisão do usuário): o motor **não** adivinha qual
módulo vai em qual inversor — numa ampliação o arranjo antigo fica no inversor
antigo, e nenhuma heurística acerta isso sozinha.

## 1. Dados

### Tabela nova: `project_equipment_sets`

| Coluna | Papel |
|---|---|
| `id`, `project_id`, `tenant_id` | identidade e isolamento (RLS RESTRICTIVE por tenant, como o resto) |
| `ordem` (smallint) | 1, 2, 3… — ordem de exibição; único por projeto |
| `inverter_brand`, `inverter_model`, `inverter_power`, `inverter_quantity`, `inverter_catalog_id` | o inversor do conjunto |
| `module_brand`, `module_model`, `module_power`, `module_quantity`, `module_catalog_id` | os módulos **daquele** inversor |
| `created_at`, `updated_at` | padrão da casa |

`*_catalog_id` referencia `equipment_catalog(id) ON DELETE SET NULL` e segue a
regra de 25/09: **vínculo só vale enquanto o modelo bater** (`equipmentMatch.ts`).

### `project_equipment` vira RESUMO (derivado)

Continua existindo com as mesmas colunas — é o que 23 arquivos leem, incluindo
edge functions (`notify-dispatch`, `claudinho-verifica`, `bidu-chat`,
`ze-brain`) e o robô da Ludmilla. Passa a ser preenchido por **gatilho**
(`AFTER INSERT/UPDATE/DELETE` em `project_equipment_sets`):

- marca/modelo/potência unitária: do **conjunto principal** = maior
  `inverter_power × inverter_quantity`; empate pela `ordem`;
- `inverter_quantity` / `module_quantity`: **soma** de todos os conjuntos;
- `total_installed_power`: `min(Σ potência dos módulos, Σ potência dos inversores)`,
  a mesma regra de hoje, agora somando conjunto a conjunto;
- `*_catalog_id`: o do conjunto principal.

Ninguém escreve mais nas colunas de resumo: os três escritores de hoje
(`NewProject`, `PublicProjectForm`, `ProjectModal` via `useUpdateProjectData`)
passam a gravar conjuntos. O gatilho é a única fonte do resumo.

**Armadilha tratada:** hoje a potência total é calculada no front como
`potência × quantidade` (`inverterTotalPower` em `projectValues.ts`). Com
conjuntos isso dá número errado (7,5 × 2 = 15 kW onde o real é 9,75) — e é esse
número que a CEMIG confere. Os totais passam a vir da **soma dos conjuntos**.

### Migração

Um conjunto por projeto existente, copiado de `project_equipment` (`ordem = 1`),
inclusive os `catalog_id`. Projeto sem equipamento não ganha linha. Depois da
carga, o gatilho recalcula o resumo — que deve bater com o que já estava lá
(conferência: diferença esperada = zero linhas).

## 2. Telas

Componente único `ConjuntosEquipamento` (em `src/components/equipment/`), usado
nos três lugares — **novo projeto**, **modal do projeto** e **formulário
público** (decisão do usuário: a empresa cliente também pode enviar 2+ conjuntos).

- cada conjunto é um bloco com os campos de hoje, usando os comboboxes já
  existentes (`EquipmentBrandCombobox` + `EquipmentModelCombobox`, marca em
  lista e modelo condicional à marca);
- **"+ Adicionar conjunto"** abaixo do último; **remover** a partir do segundo;
- com **um** conjunto a tela fica idêntica à de hoje — quem faz projeto simples
  não sente diferença;
- rodapé com a soma: "9,75 kWp · 20 módulos";
- o modal mostra os conjuntos também em modo leitura (um bloco por conjunto).

## 3. Motor de Engenharia e unifilar

**Por conjunto, não pela média.** `engineeringTemplateValues` e o `rulesEngine`
passam a receber a lista de conjuntos:

- a janela de string (`minN`/`maxN`) é calculada com o datasheet **daquele**
  inversor e **daquele** módulo;
- `distributeAcrossInverters` continua valendo **dentro** do conjunto (quando
  `inverter_quantity > 1`), não entre conjuntos — a amarração é dada;
- os alertas passam a dizer de qual conjunto são ("Conjunto 2: não achei arranjo
  válido para 4 módulos neste inversor…");
- totais (corrente CA somada, disjuntor geral, cabo do tronco) somam os
  conjuntos.

**Unifilar:** um ramal por conjunto, cada um com o seu modelo na legenda, todos
no mesmo barramento (o editor já replica ramais — `multiplyInverterBranches`;
o que muda é cada ramal carregar a identidade do seu conjunto). O disjuntor
geral continua opcional e dimensionado pela soma das correntes.

## 4. Documentos

**CEMIG** (regra do usuário, 01/10/2026): nos campos únicos, os conjuntos
entram **unidos por " + "**, na mesma célula:

| Célula | Conteúdo com 2 conjuntos |
|---|---|
| `L108` / `AI108` modelo dos módulos / inversores | `ERA-RC66HD 610M + GK-4-66HTBD-610M-F` |
| `L110` / `AI110` fabricante | `ERA + GOKIN` |
| `L112` / `AI112` potência nominal | `610 + 610` |
| `L114` / `AI114` quantidade | `16 + 4` |
| `L116` / `AI116` potência total, `AT95` potência ativa, `L118` área | **número somado** — é o que a planilha confere |

**"Local e data"** passa a sair preenchido: `C234` (e os irmãos `C252` e `C294`,
das outras duas declarações) recebem `CIDADE-UF, <data de hoje por extenso>` —
ex.: `UBERABA-MG, 1 DE OUTUBRO DE 2026`, com a cidade do projeto, como o
usuário pediu. O rótulo fica em `B234`; a faixa
`C..T` é a caixa com borda.

**ENEL e memorial:** campo único leva o **conjunto principal** (decisão do
usuário); o memorial ganha a lista completa dos conjuntos. Fica num ponto só do
código (`MODO_MULTI_CONJUNTO`), para virar "+" em todos os formulários com uma
linha, se a devolutiva pedir.

> Ressalva registrada: a nota da própria planilha da CEMIG manda separar por
> barra ("/"). O usuário escolheu " + " — a mudança é de um caractere, no mesmo
> ponto do código.

## 5. Engenheiro Bidu

- o contexto do projeto no `bidu-chat` passa a listar os conjuntos (hoje manda
  um par só), com a soma;
- `proporRespostasCemig` usa a potência **somada** (já é o que a regra do FAST
  TRACK pede: ≤ 7,5 kW);
- a regra de preenchimento com " + " vira **habilidade** dele no banco
  (`bidu_skills`), para o usuário ajustar pelo chat sem mexer em código.

## Fora do escopo

Distinguir equipamento "existente" × "novo" (o usuário dispensou), campos de
"potência atual" da CEMIG para GD existente, e qualquer mudança no fluxo de
revisões além de aceitar conjuntos no diff.

## Como se prova

- banco: migração + gatilho testados por impersonação (`begin … rollback`),
  incluindo o resumo recalculado a cada inserção/remoção de conjunto e o
  isolamento por tenant;
- motor e documentos: testes vitest com dois conjuntos (janela de string por
  conjunto, soma dos totais, texto com " + ", "Local e data");
- regressão: projeto de um conjunto só continua produzindo exatamente o mesmo
  resumo, o mesmo unifilar e os mesmos formulários de hoje.
