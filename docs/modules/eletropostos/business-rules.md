# Eletropostos — regras de negócio e de cálculo

Herdadas do sistema local (`servidor.py`, `comum.py`) e portadas para SQL na
migração `20261015200000_eletropostos.sql`. Conferidas por
`supabase/eletropostos-validacao.sql` (cenário sintético com resultado
calculado à mão).

## Vocabulário de status

Todo status bruto vira um de quatro: `livre`, `ocupado`, `fora`,
`desconhecido` (tabela `MAPA_STATUS`, igual em `worker/.../status.ts` e no
`comum.py`). `Available/Disponível → livre`; `Charging/Preparing/Finishing/
SuspendedEV/SuspendedEVSE/Occupied/Carregando/Em uso → ocupado`;
`Faulted/Unavailable/Indisponível/Manutenção/Offline/Falha → fora`; o resto
→ `desconhecido`.

## Janelas e passo por fonte

Cada fonte tem um **passo** de coleta (`eletroposto_fonte_config.passo_min`):
Tupi 5 min; Cury e ATM EVs **8 min** (pedido do usuário em 16/10/2026 — o ciclo
do ATM leva ~4,5 min). Fonte sem linha na tabela vale 5. Migração
`20261016150000_eletropostos_passo_por_fonte.sql`.

**Passo por leitura** (`eletroposto_leitura.passo_min`, migração
`20261016210000_eletropostos_passo_por_leitura.sql`): uma linha pode trazer o seu
próprio passo — é o caso dos carregadores **AC de 7 kW do ATM EVs, lidos a cada
16 min** (duas metades alternadas a cada ciclo de 8). A conta usa o passo da
leitura e, sem ele, o da fonte. Na assertividade, as tentativas esperadas de um
local = minutos em que a fonte leu ÷ passo do local (um AC lido em 1 de cada 2
ciclos não sai com 50 %).

- O tempo é dividido em **janelas de 5 minutos** (UTC, arredondadas para
  baixo: `slot`). Uma leitura por (janela, fonte, local, conector); leitura
  repetida na mesma janela sobrescreve.
- **Cada leitura "ocupado" vale o passo da sua fonte** (5 ou 8 min). Não há
  interpolação. Para fontes de 5 min é a regra original (janela = 5 min).
- **Janelas esperadas** no período = da primeira leitura do sistema (ou do
  início do período, o que vier depois) até agora (ou o fim do período).

## Métricas por conector

| Métrica | Fórmula |
|---|---|
| horas_ocupado | Σ passo das leituras "ocupado" / 60 |
| horas_observadas | Σ passo das leituras livre + ocupado / 60 |
| horas_fora | Σ passo das leituras "fora" / 60 |
| ocupacao | minutos ocupado / (minutos livre + ocupado) — **"fora" e "desconhecido" ficam fora do denominador** |
| cobertura | min(1, minutos lidos (livre + ocupado + fora) / minutos do período) |
| sessoes (recargas) | leituras "ocupado" cuja leitura anterior (≤ passo + 1 min antes) **não** era "ocupado" — inclui a primeira leitura do período |
| duracao_media_min | minutos ocupado / sessoes |

## Métricas por local

Soma dos conectores vinculados ao local no período. `ocupacao` do local =
Σ horas_ocupado / Σ horas_observadas. `cobertura` = média das coberturas dos
conectores. `agora` = contagem do último status de cada conector.
`potencia_kw` = a do cadastro ou, faltando, a primeira informada por um
conector.

## Energia, receita e margem (sempre em faixa)

Premissas (editáveis na aba Premissas; padrão do `servidor.py`):

| Chave | Padrão | Significado |
|---|---|---|
| dc_fator_min / max | 0,60 / 0,80 | potência média entregue ÷ nominal, em DC (a curva de carga cai após ~55 %) |
| ac_kw_min / max | 6,6 / 11,0 kW | teto do carregador de bordo (em AC quem limita é o carro) |
| ac_fator_min / max | 0,60 / 0,80 | fração do tempo plugado em que o carro consome |
| preco_kwh_padrao | R$ 2,12 | média da cidade (Carregados, out/2026), usada quando o local não tem preço |
| custo_energia_kwh_padrao | R$ 0,90 | custo da energia para o operador, quando o local não tem |

- DC: kWh = horas × kW × fator (min e max).
- AC: kWh = horas × min(kW, teto) × fator (min e max).
- receita = kWh × preço efetivo; custo = kWh × custo efetivo; margem = kWh ×
  (preço − custo). Preço/custo efetivos = do local ou o padrão
  (`preco_estimado`/`custo_estimado` marcam quando é o padrão).
- A tela **nunca** mostra energia ou receita como número único quando min ≠
  max arredondados.

## Casamento de carregadores (17/10/2026)

Um carregador pode aparecer duas vezes: com dois plugues no mesmo aparelho, ou
lido por duas fontes (o app da Tupi na VMOS e a API da Tupi, por exemplo).
Migração `20261017120000_eletropostos_casamento`.

- **Grupo = um carregador.** `eletroposto_fonte_config.agrupar` diz como os
  plugues de uma fonte se juntam: `prefixo` (cury, tupi_app: "91748 - 1" e
  "91748 - 2" são o carregador 91748), `estacao` (tupi pela API: todos os
  plugues da estação), `conector` (atm e qualquer fonte nova: cada plugue é
  um carregador).
- **Regra do usuário: dois carros no mesmo carregador dividem a potência —
  metade para cada.** Em cada leitura, a energia do plugue vale
  `passo × 1 / (plugues carregando no grupo naquela janela)`. Três carros, um
  terço cada.
- **Em preparação não leva energia.** Status bruto com `prepar`, `finish`,
  `finaliz` ou `suspend` conta como tempo ocupado (o carro está ligado), mas
  a parte de energia dele é zero (`eletropostos_carregando`).
- **Ocupação e recargas seguem por plugue.** Cada carro conta como recarga e
  como hora ocupada; só a energia (e com ela receita e margem) usa a potência
  dividida (`horas_energia` na métrica do conector).
- **Um local, uma fonte na conta, escolhida por dia.** Quando o mesmo cadastro
  está ligado a duas fontes (casadas pela localização, < 150 m), em cada dia de
  Brasília só uma entra nas contas: a escolhida no cadastro ("Fonte que entra na
  conta" → `eletroposto_local.fonte_principal`), se ela leu naquele dia; senão a
  que somou mais minutos válidos no dia (`eletropostos_fontes_por_dia`). A
  escolha é por dia porque, pelo período inteiro, a Tupi pela API (que parou)
  ainda ganhava do app da Tupi e as leituras novas ficavam fora (migração
  `20261017140000_eletropostos_casamento_por_dia`). As outras fontes continuam
  gravando e aparecem como "fora da conta".
- Efeito medido em 7 dias (17/10/2026): Cury −37% de horas de energia, Tupi
  −22%, ATM −1,5% (só os "em preparação").

## Vínculo fonte → cadastro

Cada fonte identifica um local do seu jeito (`eletroposto_fonte_local`). No
**primeiro** avistamento de um par (fonte, local_fonte) com coordenada, o
sistema vincula ao local do cadastro mais próximo a **menos de 150 m**. Sem
candidato, fica "sem vínculo" e aparece na aba Coleta para vínculo manual.
Depois do primeiro avistamento, só o manual muda o vínculo.

## Período e fuso

Datas da tela são **dias civis de Brasília** (`America/Sao_Paulo`); os perfis
dia × hora e a série diária também. "Hoje" na tela é a data de Brasília, não a
do navegador.

## Tupi pelo navegador (16/10/2026)

A API pública da Tupi passou a responder **403 do Cloudflare** a qualquer
cliente fora de um navegador (VPS e PC, com ou sem identificador). Com
autorização do usuário, o coletor abre o **mapa público**
(`eletropostos-tupi.web.app`, o mesmo que tupimob.com embute) num Chromium
headless (Playwright) e lê a resposta que a própria página recebe — uso normal
do site, sem chamada nossa à API, sem cabeçalho forjado. A API direta fica
como reserva, só se o navegador falhar. Se a página não carregar, a coleta
falha e fica registrada. Depois de 3 recusas seguidas (403/429) o coletor
tenta só uma vez por hora.

## Periodicidade e cidades (16/10/2026)

Pedido do usuário: controle de periodicidade na página, por faixa de
potência, e as cidades monitoradas. Tabela `eletroposto_coleta_config`
(tenant biblioteca; só master edita, via `eletropostos_coleta_config_salvar`):

- **faixas** `[{ate_kw, intervalo_min}]`, crescentes, com exatamente uma
  "acima de tudo" (`ate_kw` nulo). A estação escolhe a faixa pela **maior**
  potência do carregador (misto 7+40 cai na faixa do 40) e arredonda o
  intervalo a múltiplos do ciclo de 8 min; a Tupi (VPS, API) segue em 5 min.
  Padrão inicial: até 22 kW → 16 min; acima → 8 min. **Desde 17/10/2026: até
  22 kW → 60 min**, por decisão do usuário (o foco são os grandes, de 40 kW
  para cima).

### Rodízio parcial dos pequenos (17/10/2026)

Pedido do usuário: monitorar os de 7 kW **parcialmente**, sem atrapalhar a
rotina dos grandes. Bloco `rodizio_pequenos` do `telas.json` (`ate_kw` 22,
`segundos_por_ciclo` 60):

- Os grandes rodam **sempre e primeiro**, em todo ciclo.
- A cada ciclo, **um app só** (o que tem o pequeno vencido mais antigo) lê os
  seus pequenos depois dos grandes. Assim nenhum app precisa ser reaberto.
- Um pequeno está **vencido** quando passou o intervalo da faixa do GD (60 min)
  desde a última leitura dele. Os vencidos entram do mais antigo para o mais
  novo, enquanto a fatia de `segundos_por_ciclo` não acaba.
- Pequeno que ficou para depois **não é falha** (não entra em `falhas` nem na
  assertividade). O resumo do ciclo mostra "N pequenos esperando a vez".
- Cada leitura de pequeno vale o tempo real desde a anterior (teto 2× o
  intervalo). A conta de horas não fica viesada, mas tem mais variância, e
  recargas curtas (menos de ~1 h) podem não aparecer. Os números dos pequenos
  são **estimativas parciais**.
- **cidades**: só os locais de cidade marcada são lidos. A RPC
  `eletropostos_coleta_config()` (master, operador da estação ou service role)
  devolve também `fora`: os vínculos cujo cadastro é de cidade não monitorada —
  a estação nem abre esses locais e o coletor da Tupi não os grava. Local sem
  cadastro continua lido.

## Assertividade da leitura (16/10/2026)

Pedido do usuário: marcar as falhas de leitura para medir a assertividade.
Vocabulário de um **ciclo** (uma varredura de uma fonte): **ok** (gravou tudo),
**parcial** (`ok=false` com `n>0`: gravou, mas algum local falhou), **falha**
(`ok=false`, `n=0`). As falhas por local de um ciclo vão em
`eletroposto_varredura.falhas` (`[{nome, erro, conector?}]`, enviado pelos
coletores em `p_falhas`); enquanto a fonte não manda, são lidas do texto de
`erro` ("Nome: erro; Nome: erro"), que é truncado a 300 caracteres.

RPC `eletropostos_assertividade(p_de, p_ate)`:
- **por fonte**: ciclos, ok/parciais/falhas, taxa de ciclos ok, leituras lidas,
  **esperado por ciclo** (mediana dos ciclos com leitura) e **taxa de leitura**
  = lidas ÷ (ciclos × esperado), limitada a 100 %;
- **por local** (como a fonte chama, com o vínculo ao cadastro): conectores
  lidos, leituras, tentativas (ciclos da fonte com alguma leitura), **taxa** =
  leituras ÷ (tentativas × conectores), ilegíveis (status `desconhecido`),
  falhas atribuídas (nome casado em minúsculas) e último erro;
- **ciclos das últimas 24 h** para a faixa visual.
Locais em rodízio (ATM EVs fora do inventário) ficam com taxa baixa por desenho.

## Saúde da coleta

Fonte sem leitura ok há mais de **15 minutos** (3 janelas) = "sem leitura
recente". Estação local sem batimento há mais de 15 min = "parada". Erro de
coleta vira `eletroposto_varredura.ok = false` com o motivo (300 caracteres);
nunca derruba o laço do worker.

## Estação local

- A estação entra como um usuário comum (staff) com e-mail e senha digitados
  **no terminal** uma vez; em arquivo fica só a sessão (`dados\sessao.json`).
  Sessão inválida = a corrida grava "estação ERRO" no log e nada no banco.
- O batimento vem antes da leitura das telas: a estação aparece "Em dia" mesmo
  quando um app falha; a falha do app vai para `eletroposto_varredura` com
  `ok = false` (uma linha por fonte, nunca derruba as outras fontes).
- BlueStacks fechado ou ADB desligado = `ok = false` com o motivo para **todas**
  as fontes da estação.
- Leitura de tela é texto visível (uiautomator): um status por regra; texto que
  não casa vira `desconhecido`, que sai do denominador.
- Sem GPS no BlueStacks (lista da ATM com "0.00 km") a estação reinicia o BlueStacks
  uma vez e repete; persistindo, busca os carregadores do inventário pelo nome.
- Duas coletas nunca rodam juntas (`dados\coleta.lock`); a agendada pula quando a
  manual está rodando, e vice-versa.
- O ciclo tem **orçamento de 270 s** (`telas.json`): roteiros fixos (Cury e os
  carregadores da ATM que estão no inventário) sempre rodam; roteiros `opcional`
  rodam em rodízio no tempo que sobra, continuando de onde o ciclo anterior parou.
  Um carregador opcional lido a cada N ciclos tem o tempo de uso subestimado
  (cada leitura vale 5 min) — a cobertura mostra isso.

## O que não se faz

- Não gravar dado de motorista (campos de usuário são descartados na origem).
- Não descompilar, interceptar tráfego nem contornar proteção dos apps.
- Não digitar senha: login nos apps é da pessoa.
- Não apagar `dados\leituras.db` do sistema local.
