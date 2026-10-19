# Eletropostos — monitor de carregadores de VE

> **Estado (16/10/2026):** 🟡 Entrega 1 pronta — banco, RPCs, seção no console
> e coletor da Tupi na VPS (agente próprio `gdm-eletropostos`). Entrega 2 (estação
> local com BlueStacks para os apps ATM EVs e Cury) **pronta em 16/10/2026**: a
> estação entra com a conta do gestor, lê 8 carregadores da Cury e 47 plugues da
> ATM a cada 8 min (Agendador do Windows; passo por fonte desde 16/10/2026) e grava por `eletropostos_gravar_local`;
> a primeira coleta agendada, às 08:56 de 16/10/2026, gravou 7 leituras da Cury e 25 da ATM. **Só GD Manager (master).**
> Spec: [2026-10-15-eletropostos-design.md](../../superpowers/specs/2026-10-15-eletropostos-design.md) ·
> Plano: [2026-10-15-eletropostos.md](../../superpowers/plans/2026-10-15-eletropostos.md)

## O que é

Acompanhamento da **disponibilidade dos carregadores de veículos elétricos** de
São José do Rio Preto, Mirassol e Bady Bassitt (72 locais levantados no
PlugShare em out/2026): a cada 5 minutos o status de cada conector é lido e
gravado; a partir disso o sistema mede **tempo de uso**, conta **recargas** e
estima **energia, receita e margem** — sempre como faixa, porque energia não é
medida, é inferida do tempo.

É um estudo de viabilidade de negócio (operar eletropostos), não parte do
fluxo de homologação. Por isso **não cruza com projetos, empresas nem
financeiro** do GD Manager e fica restrito ao console `/painel`.

Nasceu como sistema local (Python + SQLite + painel em `localhost:8765`, em
`C:\Users\luiza\Documents\monitor-eletropostos`) e foi portado para o Supabase
e para o console em 15–16/10/2026.

## Onde está

| Peça | Caminho |
|---|---|
| Tela | `/painel` → **Eletropostos** (`src/pages/painel/EletropostosSection.tsx` + `src/pages/painel/eletropostos/`) |
| Lógica pura da tela (testada) | `src/pages/painel/eletropostos/calculo.ts` (+ `calculo.test.ts`) |
| Banco | migração `20261015200000_eletropostos.sql` — tabelas `eletroposto_*`, RPCs `eletropostos_*` ([database.md](database.md)) |
| Validação das RPCs | `supabase/eletropostos-validacao.sql` (leituras sintéticas, 28 conferências, limpa no fim) |
| Coletor da Tupi (VPS) | `worker/eletropostos/` — **agente próprio** (serviço systemd `gdm-eletropostos`, workflow `eletropostos-worker.yml`), separado da Ludmilla por decisão do usuário em 16/10/2026 |
| Estação de telas (apps) | `worker/estacao/` — **na VPS** (serviço `gdm-estacao` + timer de 8 min, workflow `estacao-worker.yml`), falando adb com um celular na nuvem (VMOS Cloud); descoberta e ensaio pelo workflow `estacao-calibrar.yml`. Antes: PC do usuário com BlueStacks ([celular na nuvem](#estação-no-celular-na-nuvem-vmos)) |

## As cinco abas

- **Visão geral** — manchete ("em N dias os X conectores ficaram carregando Y%
  do tempo"), KPIs e as **fitas de ocupação por hora** (24 barras por local;
  altura e cor = fração do tempo carregando). Clique abre o detalhe.
- **Carregadores** — tabela dos 72 locais com busca, filtros (cidade,
  operadora, AC/DC, monitorados) e ordenação; "Adicionar local".
- **Mapa** — Google Maps (mesma biblioteca das outras telas): círculo grande =
  DC, pequeno = AC; dourado mais forte = mais ocupado; cinza = sem monitoramento.
- **Coleta** — saúde das fontes (última leitura ok, taxa de sucesso, "sem
  leitura recente" acima de 15 min), estações locais (batimento), **locais
  lidos sem vínculo** (select para vincular ao cadastro), o quadro **Estação ao vivo** (foto atual da tela do aparelho, atualizada a cada 4 s enquanto o ciclo roda, e a linha do tempo dos passos com a foto de cada falha), o quadro **Periodicidade e cidades** (intervalo de leitura por faixa de
  potência e cidades monitoradas; a estação e a Tupi obedecem), últimos erros e o
  quadro de **assertividade da leitura** (ciclos ok/parciais/falhos e taxa de
  leitura por fonte e por local, no período escolhido; faixa das últimas 24 h).
- **Premissas** — os 8 fatores da estimativa (DC/AC, preço e custo padrão).

**No celular** (abaixo de 640 px, 17/10/2026): o console troca o menu lateral por uma barra no topo com gaveta; o período vira uma linha (Hoje / 7 / 30 dias + botão de datas + CSV); as abas rolam de lado; em Carregadores os filtros recolhem num botão "Filtros", a ordenação vira um seletor e a tabela vira **cartões** (escuros, no visual do console — o `ListaEmCartoes` de `src/mobile` é claro e não serve aqui); a fita de uso por hora vai para baixo do nome; o painel lateral ocupa a tela com cabeçalho fixo, números em 2 colunas, gráficos em versão compacta e cadastro em 1 coluna; Fontes (aba Coleta) vira lista. Desktop sem mudança.

O **painel lateral** de um local traz KPIs, horas por dia, mapa de calor dia ×
hora, conectores com linha do tempo de 48 h e o cadastro editável.

## Fontes de status

| Fonte | Como | Onde roda | Estado |
|---|---|---|---|
| `tupi` | mapa público aberto num Chromium headless (Playwright); a API direta só como reserva — a API fechou para scripts em 16/10/2026 | VPS (serviço `gdm-eletropostos`, a cada 5 min alinhado ao relógio) | ✅ |
| apps ATM EVs e Cury | leitura da tela no BlueStacks via `adb`/`uiautomator` (uso normal do app) | PC do usuário (estação local) | ✅ (precisa do PC e do BlueStacks abertos) |
| `tupi_app` | leitura da tela do app da Tupi no VMOS (mesma estação da ATM e da Cury) | VPS + VMOS | 🟡 17/10/2026 |
| Spott, ChargeOn, EvoltBR, EZVolt | só app de celular / PlugShare | — | sem fonte |

Regras firmes do usuário: **nunca** digitar senha nem dado de login (a pessoa
faz o login nos apps); **só uso normal** dos apps (abrir, tocar, ler a tela) —
nada de descompilar, interceptar tráfego ou contornar proteção; **nenhum dado
de motorista** é gravado (a Tupi devolve `startedUserID`/`reservedUserID` e o
coletor os descarta antes de montar as linhas).

## Regras de cálculo

Ver [business-rules.md](business-rules.md). Em uma linha: janela de 5 min
"ocupado" = 5 min de uso; janela sem leitura e conector "fora" saem do
denominador; energia/receita em faixa min–max; período em horário de Brasília.
Casamento (17/10/2026): dois carros no mesmo carregador dividem a potência,
"em preparação" não leva energia, e um local lido por duas fontes conta só uma por dia.

## Permissões

Tabelas no **tenant biblioteca** (GD Manager) com `tenant_id`, RLS
RESTRICTIVE por tenant e SELECT só `is_master`. Nenhuma escrita direta:
`eletropostos_gravar` exige service role (VPS); `eletropostos_gravar_local`
exige o `operador` de uma `eletroposto_estacao` ativa; as RPCs de tela exigem
master. Liberar para admin/staff do tenant no futuro é trocar a condição das
políticas, não migrar tabela.

## Estação no celular na nuvem (VMOS)

Desde 16/10/2026 à noite a leitura da Cury e do ATM EVs saiu do PC do usuário e
roda **na VPS**, num **celular na nuvem VMOS Cloud** (aparelho `ACP25091462JLVCR`,
nó Brasil, Android 13, 720×1280, 320 dpi; Google, Cury e ATM EVs instalados e
logados pela pessoa). O código fica em `worker/estacao/` (fonte da verdade; a
pasta do PC é a versão antiga) e o deploy é o workflow `estacao-worker.yml`.

| Peça | O que faz |
|---|---|
| `vmos.py` | Open API do VMOS (assinatura V2: `X-Sign = sha256(SK + timestamp + caminho + corpo)`, cabeçalhos `X-Access-Key` e `X-Timestamp`). `/adb` devolve o comando do túnel SSH e a chave de conexão: o túnel abre a cada ciclo numa porta local livre (sem `-f`, autenticado por `SSH_ASKPASS`) e morre com o processo. `/gpsInjectInfo` fixa a posição em Rio Preto no começo de cada ciclo; `/restart` reinicia o aparelho; o estado vem de `/padDetails` (o singular dá 404). |
| `estacao.py` | Na VPS, **modo serviço**: com `SUPABASE_SERVICE_ROLE_KEY` grava por `eletropostos_gravar` e pulsa com `ESTACAO_ID` (estação "VPS + VMOS"); no PC, login de pessoa como antes. |
| `coletor_tela.py` | Independente da tela: rolagens proporcionais, X da ficha da ATM achado ao lado do selo de distância, seta de voltar achada no canto, toque só em item com 60 % ou mais visível, passos `limpar_campo` e `esconder_teclado`, conferência do título de cada ficha. `AndroidTravado` reinicia o aparelho pela API. |
| `espelho.py` | Quadro "Estação ao vivo": cada passo e a foto atual (no máximo a cada 20 s; sempre ao abrir app, em falha e no fim) no bucket `eletropostos-espelho`; foto de falha guardada 3 dias. Só no modo serviço; nunca derruba o ciclo. |
| `calibrar.py` | Descoberta e ensaio na VPS (workflow `estacao-calibrar.yml`, manual): partes `atm`, `cury`, `atm_busca` e `ensaio` (ciclo sem gravar, com a tela de cada falha). Pausa o timer; nome fixo `gdm-estacao-calibrar` e encerra sobras antes de começar. |

**Armadilhas desta migração (16/10/2026):**
- O teclado do Google fica aberto na metade de baixo depois de digitar, e a rolagem
  em cima dele vira **digitação por deslize** (apareceu "FR" na busca da ATM). Por
  isso há `esconder_teclado` depois de `digitar`.
- Os cartões da Cury carregam depois de "Escolha um carregador": o roteiro espera o
  código do 1º carregador.
- O item cortado no pé da lista fazia abrir o vizinho.
- Cancelar um run do GitHub **não** para o processo na VPS, e o fim de uma unidade
  systemd derruba o servidor do adb da outra.
- No Linux a memória "comprometível" negativa é normal; o aviso só olha a RAM
  disponível.

Ensaio limpo às 21:48: Cury 8/8, ATM 18 leituras, ciclo de ~6 min.

### Foco nos grandes (17/10/2026)

Pedido do usuário: ler os carregadores de 40 kW para cima o mais perto possível
de 8 min e monitorar os de 7 kW só parcialmente. Ciclo antes: ~12 min (Cury
~3 min, ATM ~4 min, Tupi ~3,5 min, mais 1 min de pausa do timer). Mudanças:

- **Faixa até 22 kW = 60 min** no GD e **rodízio parcial** dos pequenos (ver
  [business-rules.md](business-rules.md#rodízio-parcial-dos-pequenos-17102026)).
- **Cury continua reabrindo o app a cada posto.** Testado em 17/10/2026: a
  "Lista" da Cury só mostra os postos perto de onde o mapa parou, então voltar
  da ficha só serve entre carregadores do mesmo posto (Ernani 80 → 60). O passo
  `voltar` ganhou `se_texto` (só volta se o texto estiver na tela) para usos
  futuros.
- **Tupi abre quente** (`abrir` com `quente: true`: traz o app para a frente
  sem matar o processo, então sem os avisos de abertura). `recuperar` continua
  frio.
- **Timer:** a pausa entre ciclos caiu de 1 min para 15 s.

Resultado medido (ciclos de 19:01 a 19:21): ciclo de ~10 min (Cury ~190 s,
ATM ~240 s com a fatia dos pequenos, Tupi ~150 s). Passo real dos grandes:
**10 min** na Cury e na ATM, 10–12 na Tupi (antes ~12). Pequenos da ATM: ~1×
por hora. Para chegar a 8 min nos grandes com um aparelho só não sobra folga;
o caminho seria um segundo aparelho VMOS lendo um dos apps em paralelo.

### Só rápidos e cidades novas (18/10/2026)

Decisão do usuário: o modelo de negócio é dos **rápidos (40 kW+)**. Os lentos
estão **pausados** (`rodizio_pequenos.pausado` no `telas.json`; locais mistos
7+40 seguem). A leitura foi ampliada para **Votuporanga, Fernandópolis e
Catanduva** (também na lista de cidades do GD).

Descoberta pela parte `cidade:<Nome>` do `estacao-calibrar`: o GPS do aparelho
vai para o centro da cidade, ATM e Cury listam por distância e a Tupi é buscada
pelo nome da cidade. A opção `so_tupi` pula ATM e Cury. A rodada inteira passa de
30 min (`RuntimeMaxSec`), então use no máximo duas cidades por vez. Rápidos
encontrados:

| Cidade | Local | App | Potência | Conector |
|---|---|---|---|---|
| Votuporanga | Posto Pratico eletroposto 40Kw | ATM | 40 kW CCS2 | 6003 |
| Votuporanga | AUTO POSTO CALIFÓRNIA | Tupi | 40 kW CCS2 | `AUTO_POSTO_CALIFORNIA_VOTUPORANGA - 1` |
| Fernandópolis | Bitcharge - Ramiru's Churrascaria | Tupi | 60 kW, 2 tomadas | `BITCHARGE_RAMIRUS_FERNANDOPOLIS - 1/2` |
| Catanduva | — | — | só lentos (Muffato na ATM, Uni2 na Cury) | — |

- A ATM lista por distância de Rio Preto, então o Posto Pratico é lido pela
  **busca do nome**, num roteiro com `ao_fim` (vai depois de todos, porque a
  busca troca a lista do app).
- Sem a API da Tupi não há `stationID`: os locais novos usam um código próprio,
  sem " - " (o agrupamento da `tupi_app` corta no primeiro " - ").
- Coordenadas do OpenStreetMap: Posto Pratico exata; Califórnia pelo trecho da
  avenida; Ramiru's só pelo centro do bairro CECAP (aproximada).
- Cadastro criado em 19/10/2026 (o usuário viu que não apareciam: leitura sem
  cadastro fica só na aba Coleta, como "sem vínculo"): "Posto Prático -
  Eletroposto 40kW" (ATM EVS, R$ 1,99/kWh), "Auto Posto Califórnia" (Tupi,
  R$ 2,39/kWh) e "Bitcharge - Ramiru's Churrascaria" (Bitcharge (Tupi),
  R$ 2,30/kWh), cada um vinculado à sua fonte. **Local novo = cadastro +
  vínculo**, senão não entra nas análises.
- Os três apps não cobrem todas as redes: Catanduva com certeza tem rápidos de
  outras operadoras. O PlugShare seria o caminho para achá-los.

### Tupi pelo app (`tupi_app`, 17/10/2026)

A API da Tupi passou a responder 403 do Cloudflare; não se contorna. O app da
Tupi (`com.tupinamba`) foi instalado no VMOS e é lido pela tela como as outras
fontes, no alvo `tupi_app` do `telas.json` (7 estações da região).

- **Abertura:** a cada abertura o app pede notificação (toca **Cancelar**) e
  mostra o convite "Cadastre-se para carregar" (toca **Agora não**). O convite
  **não** é login: o mapa e as fichas abrem sem conta. Se um dia aparecer tela de
  login de verdade, a estação para e a pessoa é avisada.
- **Sem lista fixa:** cada local é buscado pelo campo do topo, que muda de texto
  (mapa, resultados, ficha). Por isso o toque é por coordenada de referência
  (250, 220), e o item é tocado pela linha "Nome, status, endereço…". A busca é
  nacional: os termos são específicos e sem acento (o `input text` do adb não
  aceita acento).
- **Ficha:** "Tomada N" seguido do status. Nas estações de plugue único
  (Bitcharge) a ficha mostra "Plug:" seguido do status. O status vai cru em
  `status_bruto`.
- **Gravação:** `local_fonte` = `stationID` da API (o mesmo do cadastro já
  vinculado), conector `"<stationID> - <n>"`, lat/lng da API. DC 60 kW a cada
  8 min; Bitcharge (AC 7,4 kW) a cada 16 min.
- **Recuperação:** o alvo tem `recuperar` (reabre o app e passa os avisos) quando
  um local falha, porque a tela em que ele parou é imprevisível.
- **Ensaio só de uma fonte:** parte `ensaio:tupi_app` no `estacao-calibrar`.
- **Convite atrasado:** o "Cadastre-se para carregar" surge alguns segundos
  **depois** do mapa e cobre a busca (o texto digitado se perde). A abertura
  espera 4 s e olha de novo; cada busca começa com um `passar_avisos` de
  conferência (`folga: 0`, um único dump).
- **BYD Allma SJRP 02** é plugue único Tipo 2 de **7,4 kW** no app, embora o
  nome sugira irmã da 01 (DC 60 kW, duas tomadas).
- **Tempo:** ~4,5 min por ciclo com as 7 estações (a abertura com os avisos
  leva ~45 s). Com Cury + ATM + Tupi o ciclo passa de 10 min, então `limite_s`
  subiu para 780 s e o timeout do serviço para 20 min. O passo real dos DC fica
  perto de 12 min, não 8: um aparelho só não lê tudo em 8 min.

Ensaio de 17/10/2026 15:10: 9 de 10 leituras (a falha era a BYD 02, corrigida). Primeira gravação real às 15:25; ciclos completos às 15:37 e 15:50 com 9 leituras cada. Leitura vazia agora aparece como falha no quadro "Estação ao vivo", com foto e textos da tela.

## Estação local (PC com BlueStacks — substituída pela VMOS)

O PC do usuário com o **BlueStacks** (instância `Rvc64`, Android 11, porta ADB
5555) é a única fonte dos apps que exigem celular. Pasta
`C:\Users\luiza\Documents\monitor-eletropostos` (Python 3, só biblioteca
padrão, **fora do repositório**). Desde 16/10/2026 nada mais é gravado em
SQLite: tudo vai para o Supabase.

| Arquivo | Papel |
|---|---|
| `estacao.py` | sessão no GD Manager: `login` pede e-mail e senha **no terminal** (`getpass`), guarda só os tokens em `dados\sessao.json` e renova pelo refresh token quando o access token está a menos de 2 min de vencer; `testar` renova e chama `eletropostos_estacao_pulsa`; `rpc()` é a única porta para o PostgREST |
| `comum.py` | `linha()` monta a leitura no formato da RPC; `gravar(fonte, linhas, erro)` chama `eletropostos_gravar_local`; `normalizar()` com o mesmo `MAPA_STATUS` do worker |
| `coletor_tela.py` | `adb connect ADB_ALVO` + `adb -s`; roteiros de `config\telas.json`; modos `ver` (lista os textos da tela), `descobrir NOME` (salva xml/png/txt em `capturas\`) e `coletar` |
| `coletar.py` | o que o Agendador roda: batimento → telas; registro em `dados\coleta.log`; tranca `dados\coleta.lock` com o PID do dono (duas coletas nunca rodam juntas; a tranca só é tida como abandonada se o processo dono não existir ou após 45 min) |
| `coletor_tupi.py` | reserva **manual** (a VPS cobre a Tupi) |
| `instalar.ps1` | Python (via `py`, porque o `python` do PATH pode ser o atalho da Store), `platform-tools` oficial em `ferramentas\platform-tools` (dentro da pasta do monitor), pastas, tarefa `Eletropostos\Coleta a cada 8 min` (`pythonw coletar.py`); remove as tarefas antigas Painel/Celular virtual |
| `config\supabase.env` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` (públicos, os mesmos do site) e `ADB_ALVO` |
| `.bat` | `entrar_estacao` (login), `coletar_agora`, `capturar_tela`, `iniciar_celular` (abre o BlueStacks) |
| `_aposentado\` | `servidor.py`, `web\`, `relatorio.py`, `abrir_painel.bat` — o painel local morreu; a tela é o console |

Formato de `telas.json`: `{"orcamento_s": 270, "alvos": [{"fonte": "atm", "ordem": [...],
"passo_lista_px": 160, "roteiros": [{"passos": [...], "regras": [...], "depois": [...],
"opcional": true}]}]}`. Passos: `abrir` (pacote; com `activity` reinicia quente),
`toque` (x, y), `tocar_texto`, `tocar_texto_rolando` (rola a lista na direção certa
usando `ordem`), `esperar_texto` (até N s), `digitar`, `deslizar`, `voltar`; cada
passo aceita `espera` e `opcional`. Regra: `local_id`, `local_nome`, `conector`,
`potencia_kw`, `lat`, `lng` (vínculo automático) e `regex` cujo grupo 1 é o status
no texto da ficha. `depois` roda após a leitura (fechar a ficha).

**Calibração feita em 16/10/2026 (só pelo adb, sem controlar a tela do Windows):**

| App | Caminho até a ficha | O que se lê | Tempo |
|---|---|---|---|
| Cury Energia (`eco.spott.curyenergia`, rede Spott) | abrir → "Lista" → tocar o local → ficha "Escolha um carregador" | nó combinado por carregador: `91748 - 1 / Autocharge / Ultra Rápido / 80kW / Livre / Usado há 3 horas…` → status = linha após a de kW | 5 locais públicos, 8 carregadores DC, ~126 s — a lista "Locais de Recarga" segue o mapa (depois de uma ficha só mostra o que está no mapa), então cada local reabre o app; HM 60 kW aproveita a tela do HM 80 kW |
| ATM EVs (`br.com.atmoutsourcing.evscharger`, sem login) | abrir → "Pesquisar" + espaço (lista tudo por distância) → tocar o carregador → ficha → X (852,781) | nó combinado por plugue: `Tipo 2 - 32A, ID: 5838, DISPONÍVEL` | 30 carregadores públicos até 15 km / 47 plugues; os **13 do inventário são fixos** e os 16 restantes `opcional` em **rodízio** no tempo que sobra (`dados\rodizio.json`), ~147 s |

Status vistos: ATM `DISPONÍVEL`, `LIBERADO` (= livre) e `EM USO` (= ocupado); Cury `Livre`,
`Em preparação` (= ocupado, plugado) e `Falha` (= fora). O `MAPA_STATUS` já
cobre em uso/ocupado/indisponível/inativo/reservado; o que não casar vira `desconhecido`.
Enumerações que geraram os roteiros: `capturas\atm_carregadores.json`,
`capturas\cury_locais.json` (script `gera_telas.py` da sessão de calibração; o
`telas.json` pode ser editado à mão). Calibrar de novo: `coletor_tela.py ver` /
`ensaiar [fonte]` (não grava; `ELETROPOSTOS_DEPURAR=1` cronometra cada passo).

**Android travado.** Visto em 16/10/2026: o `HD-Player.exe` aberto, mas o Android
dentro dele parado (`adb devices` com o endereço "offline", shell em timeout,
conexão recusada); `adb disconnect/connect` não resolve. O coletor trata isso como
`AndroidTravado` (timeout de 30 s em qualquer `adb`, ou "device offline", "error:
closed", "cannot connect", "actively refused"…): **reinicia o BlueStacks sozinho**
(no máximo uma vez por ciclo, contando também o reinício por GPS), espera
`sys.boot_completed = 1`, grava na varredura da fonte afetada `ok = false` com
"BlueStacks reiniciado pela estação: …" e repete o alvo. A mensagem "ligue o
Android Debug Bridge" só aparece se o `bluestacks.conf` disser `enable_adb_access`
diferente de `"1"`.

**Limites do ciclo** (`telas.json`): nenhum carregador novo começa depois de
`limite_s` (420 s, porque a coleta roda a cada 8 min) e, com
`max_falhas_seguidas` (3) carregadores seguidos falhando, o app é deixado para o
próximo ciclo; os dois motivos vão no começo do erro da varredura. Antes disso, um
app com problema chegou a prender a coleta por 22 min, e a coleta seguinte começou
por cima dela (a tranca antiga "vencia" aos 10 min): as duas disputaram a tela e
fizeram o Android parecer travado. Apagar ou trocar a tarefa agendada também mata
a coleta em andamento (aconteceu na troca de 5 para 8 min).

**Bateria.** O PC é um notebook. O `schtasks /Create` cria a tarefa com o padrão do
Windows: **não inicia na bateria e mata a execução quando a tomada sai**. Em
16/10/2026 isso derrubou a coleta das 15:10 e pulou as três seguintes, sem nada no
log. A tarefa agora é liberada para a bateria, com uma execução por vez e teto de
30 min (`New-ScheduledTaskSettingsSet` no `instalar.ps1`). Para pausar a coleta fora
da tomada, desativar a tarefa no Agendador.

**Memória do PC.** Em 16/10/2026 à tarde o Android travou em quase todo ciclo, mesmo
depois do reinício automático: o PC estava com ~350 MB de RAM livre e 46 de 50 GB
de memória comprometida (Chrome, o app do Claude, BlueStacks, WSL/Docker, Steam).
Reiniciar o BlueStacks não adianta nesse caso. A varredura anexa
"[PC com pouca memória: X MB …]" ao erro quando a RAM livre cai abaixo de 1 GB ou a
comprometível abaixo de 4 GB, para a aba Coleta mostrar a causa real.
Correção aplicada no mesmo dia: a instância do BlueStacks reservava 4 GB e 4 núcleos
para dois apps simples. Passou a **2 GB e 2 núcleos** (`bst.instance.Rvc64.ram` e
`.cpus` no `bluestacks.conf`, editado com o BlueStacks fechado; backup em
`dadosackup-bluestacks.conf-20261016`). O BlueStacks caiu de 5,3 para 3,5 GB
reservados, o Android sobe em ~40 s e o ciclo voltou a ~4,5 min sem travar
(Cury 7–8 de 8, ATM 25 fixos + rodízio).

**Aviso de boas-vindas da Cury.** Logo depois de abrir, a Cury às vezes mostra
"Bem vindo ao novo app curyenergia" por cima do mapa, e o toque em "Lista" cai nele.
O passo `tocar_ate` (texto, `aparecer`, `fechar`, `tentativas`, `ate`) toca e confere:
fecha o aviso ("Encerrar") se ele estiver na tela e toca de novo até a lista abrir.

**Periodicidade por potência (16/10/2026).** Os carregadores AC de 7 kW da ATM (24, com
todos os plugues até 22 kW) são lidos a cada 16 min, em duas metades que se alternam a
cada ciclo de 8; DC e mistos (Cury e 5 da ATM) seguem a cada 8. Cada leitura AC vai
com `passo_min = 16`, e o banco pondera por ele (migração `..._passo_por_leitura`). No
`telas.json`: `ciclo_min`, `cadencia_ativa`, e por roteiro `intervalo_min` + `grupo`.
A estação já aceita a configuração vinda da página: a RPC `eletropostos_coleta_config()`
(faixas `ate_kw` → `intervalo_min`, cidades monitoradas e `fora` = locais de cidades
desmarcadas). Quando ela existe, sobrepõe o `telas.json` a cada ciclo; sem ela, vale o
arquivo. Tela e tabela dessa configuração: pendentes.

**Assertividade.** Cada gravação com leitura manda `p_falhas` (`[{nome, erro}]`,
com `nome` = `local_nome`) com os locais que falharam e os fixos não lidos por limite
do ciclo ou pelo disjuntor. Ciclo sem leitura nenhuma não manda (já conta como
falha da fonte), e status ilegível por conector fica de fora (já conta como
"ilegível" pela leitura `desconhecido`).

**GPS do BlueStacks.** Horas depois de aberto, o BlueStacks pode parar de entregar
posição; a lista da ATM vem com "0.00 km" e fora de ordem e os roteiros não acham
os carregadores. O passo `escolher` do primeiro roteiro da ATM detecta isso e a
estação **reinicia o BlueStacks sozinha** (uma vez por ciclo: `taskkill HD-Player`,
`HD-Player.exe --instance Rvc64`, espera o adb, +30 s) e repete o alvo; se ainda
assim não houver distância, cai em `roteiros_sem_gps` (busca cada carregador do
inventário pelo nome, ~18 s cada). Os logins dos apps ficam dentro do Android e
sobrevivem ao reinício. Uma falha num roteiro (ficha que não abriu) não derruba o
alvo: segue, grava o que leu e a varredura fica `ok = false` com os motivos.

Armadilhas: o `uiautomator dump` leva ~2,5 s (o coletor reaproveita o último dump até a
próxima ação e guarda a lista em cache); `input tap` não funciona enquanto o app está
"morto" depois de reiniciar o BlueStacks (relançar o app resolve); **não** zerar as
animações do Android (`settings put global *_animation_scale 0` derrubou o
`system_server` do BlueStacks). O interruptor de ADB da tela de configurações não
obedeceu aos cliques sintéticos: ficou ligado trocando `bst.enable_adb_access` para
`"1"` em `C:\ProgramData\BlueStacks_nxt\bluestacks.conf` com o BlueStacks fechado.
Toda chamada a programa de console (`adb`, `taskkill`) usa `creationflags=CREATE_NO_WINDOW`: a tarefa roda em `pythonw` (sem console) e, sem a flag, o Windows abria uma janela do Terminal para cada comando do `adb`, dezenas por ciclo (reclamação do usuário em 16/10/2026).
O `adb` precisa ficar **dentro da pasta do monitor** (`ferramentas\platform-tools`):
arquivos criados pelas ferramentas do Claude em `%LOCALAPPDATA%` ficaram só no
sandbox e a tarefa agendada não os via.

Por que a sessão guarda também o access token (e não só o refresh token da
spec): o Supabase **gira** o refresh token a cada uso e revoga a família
inteira se um token já usado volta depois de alguns segundos — exatamente o
que aconteceria quando a coleta agendada e `coletar_agora.bat` rodassem
juntas. Reaproveitando o access token por ~1 h, a renovação é rara.

O operador da estação registrado em `eletroposto_estacao` ("PC do gestor
(BlueStacks)", 16/10/2026) é a **conta do próprio gestor** — a mesma que opera a
estação da Ludmilla; a alternativa (staff dedicado criado pelo app) continua
válida, basta trocar o `operador` ([database.md](database.md#estação-local)). O
`HD-Adb.exe` do BlueStacks (1.0.36) **não** serve: dá `error: closed` com o
Android 11; por isso o `platform-tools` oficial.

## Pendências

- Vincular na aba Coleta (ou cadastrar) os carregadores da ATM lidos que não estão
  no inventário (hotéis, condomínios, lojas); os da Cury e os 13 da ATM do
  inventário já se vincularam sozinhos pelas coordenadas.
- Os 16 carregadores opcionais da ATM são lidos a cada ~5 ciclos (rodízio): o
  tempo de uso deles fica subestimado; se interessarem ao estudo, cortar a lista
  ou dividir a ATM em duas estações.
- Retenção das leituras (hoje nenhuma; ~2 M linhas/ano cabem).
- Deploy do coletor: Actions → "Eletropostos — deploy do coletor na VPS"
  (`eletropostos-worker.yml`, manual). Log na VPS: `journalctl -u gdm-eletropostos`.
- Estação de telas na VPS: deploy por `estacao-worker.yml` (com a opção do timer), log
  em `journalctl -u gdm-estacao`; descoberta e ensaio por `estacao-calibrar.yml`.
  Desligar a tarefa do PC ("Eletropostos\Coleta a cada 8 min") quando a VPS gravar
  ciclos limpos.
