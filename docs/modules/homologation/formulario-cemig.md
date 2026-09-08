# Formulário MicroGD da CEMIG — mapa de células

> `Formulario-MicroGD_Rev_N4.xlsx` — Revisão N4, 03/12/2024, Gerência de
> Processos Especiais de Expansão de MT e BT.

Mapa levantado por comparação, do jeito que funcionou na ENEL: com um
formulário **preenchido à mão** de um projeto real e aceito, cada valor
conhecido do cadastro revela a sua célula. Referência usada: projeto do titular
MATHEUS VINICIUS ALVES FERREIRA BAROZA (PRJ-07728, GO POWER UBERABA),
conferido campo a campo contra `project_general_data` e `project_equipment`.

**Armadilha ao ler o .xlsx**: célula vazia vem auto-fechada
(`<c r="M16" s="20"/>`). Um regex `<c ...>(.*?)</c>` casa o fechamento da
célula SEGUINTE e desloca o mapa inteiro em uma coluna — foi o que quase
aconteceu aqui. O leitor precisa cortar cada pedaço no próximo `<c `.

Todas as células abaixo são da aba **`Formulário`**.

## 1 — Identificação da UC

| Célula | Campo | Origem no sistema |
|---|---|---|
| `J12` | Número da instalação | **não temos** — ver pendências |
| `AL12` | FAST TRACK (Sim/Não) | perguntado ao gerar |
| `O14` | Empreendimento "Grid Zero" (Sim/Não) | perguntado ao gerar |
| `N16` | Titular da UC | `holder_name` |
| `E18` | Grupo (A/B) | dedutível: B para baixa tensão |
| `AC18` | CPF/CNPJ | `holder_cpf_cnpj` (só dígitos) |
| `G20` | Logradouro | `address` |
| `AI20` | Número | `address_number` |
| `AR20` | Complemento | `address_complement` |
| `E22` | Bairro | `neighborhood` |
| `T22` | Município | `city` |
| `AN22` | Estado | `state` |
| `AS22` | CEP | `cep` (só dígitos) |
| `O24` | Celular | `holder_phone` (só dígitos) |
| `Y24` | E-mail | `holder_email` |

## 2 — Dados da UC

| Célula | Campo | Origem |
|---|---|---|
| `V29` | UTM — Fuso | `decimalToUTM(coordinates).fuso` |
| `AC29` | UTM — E (Abscissa) | idem, leste |
| `AL29` | UTM — N (Ordenada) | idem, norte |
| `AD33` | Motor gerador de emergência (Sim/Não) | fixo "Não" |
| `I41` | **Tipo de Solicitação** | perguntado ao gerar (lista abaixo) |
| `I43` | Tipo de edificação | lista abaixo (padrão "Edificação Individual") |
| `AB47` | Tipo de padrão de entrada — atual | de `phase_type` |
| `AH47` | Corrente do disjuntor — atual (A) | `circuit_breaker_current` |
| `AB49` | Tipo de padrão — proposto | ver pendências |
| `AH49` | Corrente do disjuntor — proposto (A) | ver pendências |
| `L55` | Tensão de atendimento | lista: `127/220` ou `120/240` |
| `R57` | Mudança de local do padrão (Sim/Não) | fixo "Não" |
| `AD59` | Padrão a menos de 30 m do poste (Sim/Não) | pergunta |
| `AF61` | Telhado arrendado (Sim/Não) | fixo "Não" |

## 4 — Dados da geração

| Célula | Campo | Origem |
|---|---|---|
| `L95` | Tipo de fonte primária | fixo "Solar" |
| `AT95` | Potência ativa instalada total (kW) | **menor** entre total de módulos e de inversores |
| `H98` | Tipo de geração | fixo "Empregando conversor eletrônico/inversor" |
| `L100` | Modalidade de compensação | lista abaixo |
| `AS100` | Qtde. de instalações a receber crédito | 1 por padrão |
| `L108` | Modelo dos módulos | `module_model` |
| `AI108` | Modelo dos inversores | `inverter_model` |
| `L110` | Fabricante dos módulos | `module_brand` |
| `AI110` | Fabricante dos inversores | `inverter_brand` |
| `L112` | Potência nominal do módulo (W) | `module_power` |
| `AI112` | Potência nominal do inversor (kW) | `inverter_power` |
| `L114` | Quantidade de módulos | `module_quantity` |
| `AI114` | Quantidade de inversores | `inverter_quantity` |
| `L116` | Potência total dos módulos (kW) | `module_power × qtd / 1000` |
| `AI116` | Potência total dos inversores (kW) | `inverter_power × qtd` |
| `L118` | Área dos arranjos (m²) | `qtd_modulos × 3` (regra do usuário) |
| `AI118` | Tensão de conexão do inversor (V) | fixo `220` — na rede 127/220 o inversor entra entre fases |

`R134` — possui armazenamento (Sim/Não), fixo "Não".

## Listas suspensas (aba `Dados`)

**Tipo de Solicitação** (`I41`):
1. Conexão de GD em UC Existente **COM** Alteração de Potência Disponibilizada
2. Conexão de GD em UC Existente **SEM** Alteração de Potência Disponibilizada
3. GD Existente COM Alteração de Potência Ativa Instalada Total
4. Ligação de Nova UC COM Geração Distribuída

**Tipo de edificação** (`I43`): Individual · Uso Coletivo (telhado coletivo ou
área comum) · Uso Coletivo (telhado independente e privativo) · Agrupamento.

**Tipo de disjuntor** (`AB47`/`AB49`): Monopolar · Bipolar · Tripolar ·
Sem Disj. Geral (na linha de cima) / Sem Alter. Carga (na de baixo).
Mapeamento a partir do `phase_type`: monofásico→Monopolar,
bifásico→Bipolar, trifásico→Tripolar.

**Modalidade de compensação** (`L100`): Autoconsumo local · Autoconsumo remoto ·
Geração compartilhada · Múltiplas Unidades Consumidoras.

**Tensão Grupo B** (`L55`): `127/220` · `120/240`.

## Validação de UTM por fuso — o formulário rejeita fora da faixa

| Fuso | E mínimo | E máximo | N mínimo | N máximo |
|---|---|---|---|---|
| 22 | 487.307 | 833.012 | 7.733.378 | 7.981.566 |
| 23 | 161.564 | 840.139 | 7.460.145 | 8.435.094 |
| 24 | 164.869 | 417.150 | 7.673.180 | 8.336.360 |

O preenchimento deve conferir a coordenada convertida contra a faixa do fuso e
**avisar** antes de gerar — coordenada fora da faixa volta reprovada.

A coordenada vai em **metros inteiros**. A conversão do catálogo devolve
centímetros (`447.878,02 m`), precisão que não existe num ponto de conexão; o
formulário aceito traz inteiros, e é assim que gravamos.

## Pendências (a confirmar com o usuário)

1. **`AH47`/`AH49`** — duas linhas de padrão de entrada (60 A e 63 A no
   exemplo de referência). Hoje escrevemos o mesmo disjuntor do cadastro nas
   duas. Confirmar qual é a existente e qual a proposta — importa nos casos de
   aumento de carga.
2. **`AD28` = 1620000** — célula preenchida sem rótulo capturado. Não
   escrevemos nela. Confirmar o que é (carga instalada?).

### Resolvidas

- **`J12` — "Número da instalação"**: é o número da UC (`uc_number`), conforme
  o usuário (set/2026). A dúvida veio de o projeto de referência ter no
  cadastro um número em formato antigo; nos projetos atuais o `uc_number` já
  vem com os 10 dígitos que o formulário espera (PRJ-21470: `3005478195`).
- **`L118` — "Área dos arranjos (m²)"**: `quantidade de módulos × 3`.

## Planta de situação (o outro entregável do Bidu)

O próprio formulário exige, no item **6.2**: *"Memorial descritivo contendo a
planta de situação com indicação do local do padrão de entrada, conforme
ND 5.1 e ND 5.2"*.

A planta aceita (mesmo projeto) é uma folha com três painéis de satélite
empilhados:

1. **Vista geral** do imóvel, sem marcação.
2. **Ponto de entrada**: bolinha amarela sobre o padrão, com linha tracejada
   até um rótulo contendo a UC e as coordenadas UTM (`22K`, `812186 E`,
   `7796195 N`).
3. **Localização dos painéis**: retângulos azuis desenhados sobre a água do
   telhado, na quantidade dos módulos — sem precisão métrica.

É o alvo do que o Bidu deve gerar. O sistema já tem a peça mais difícil: o
recorte de satélite embutido (`cadEngine/locationMap.ts`) e o editor de cena
com elementos arrastáveis.
