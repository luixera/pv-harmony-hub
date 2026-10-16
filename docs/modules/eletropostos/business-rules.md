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

## Janelas

- O tempo é dividido em **janelas de 5 minutos** (UTC, arredondadas para
  baixo: `slot`). Uma leitura por (janela, fonte, local, conector); leitura
  repetida na mesma janela sobrescreve.
- **Cada janela "ocupado" vale 5 minutos de uso.** Não há interpolação.
- **Janelas esperadas** no período = da primeira leitura do sistema (ou do
  início do período, o que vier depois) até agora (ou o fim do período).

## Métricas por conector

| Métrica | Fórmula |
|---|---|
| horas_ocupado | ocupado × 5 / 60 |
| horas_observadas | (livre + ocupado) × 5 / 60 |
| horas_fora | fora × 5 / 60 |
| ocupacao | ocupado / (livre + ocupado) — **"fora" e "desconhecido" ficam fora do denominador** |
| cobertura | min(1, (livre + ocupado + fora) / janelas esperadas) |
| sessoes (recargas) | janelas "ocupado" cuja janela imediatamente anterior (≤ 5 min antes) **não** era "ocupado" — inclui a primeira leitura do período |
| duracao_media_min | ocupado × 5 / sessoes |

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

## O que não se faz

- Não gravar dado de motorista (campos de usuário são descartados na origem).
- Não descompilar, interceptar tráfego nem contornar proteção dos apps.
- Não digitar senha: login nos apps é da pessoa.
- Não apagar `dados\leituras.db` do sistema local.
