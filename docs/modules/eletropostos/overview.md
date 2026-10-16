# Eletropostos — monitor de carregadores de VE

> **Estado (16/10/2026):** 🟡 Entrega 1 pronta — banco, RPCs, seção no console
> e coletor da Tupi na VPS (agente próprio `gdm-eletropostos`). Entrega 2 (estação
> local com BlueStacks para os apps ATM EVs e Cury) **em andamento**: scripts
> Python reescritos para o Supabase, instalador rodado e coleta agendada a cada
> 5 min; falta ligar o ADB no BlueStacks, criar o usuário da estação e calibrar
> as telas (`telas.json`). **Só GD Manager (master).**
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
| Estação local (apps) | `C:\Users\luiza\Documents\monitor-eletropostos` (Python stdlib, fora do repositório; ver [Estação local](#estação-local)) |

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
  lidos sem vínculo** (select para vincular ao cadastro) e últimos erros.
- **Premissas** — os 8 fatores da estimativa (DC/AC, preço e custo padrão).

O **painel lateral** de um local traz KPIs, horas por dia, mapa de calor dia ×
hora, conectores com linha do tempo de 48 h e o cadastro editável.

## Fontes de status

| Fonte | Como | Onde roda | Estado |
|---|---|---|---|
| `tupi` | API pública do mapa (`stationsShortVersion`), por conector | VPS (serviço `gdm-eletropostos`, a cada 5 min alinhado ao relógio) | ✅ |
| apps ATM EVs e Cury | leitura da tela no BlueStacks via `adb`/`uiautomator` (uso normal do app) | PC do usuário (estação local) | 🟡 estação pronta, calibração pendente |
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

## Permissões

Tabelas no **tenant biblioteca** (GD Manager) com `tenant_id`, RLS
RESTRICTIVE por tenant e SELECT só `is_master`. Nenhuma escrita direta:
`eletropostos_gravar` exige service role (VPS); `eletropostos_gravar_local`
exige o `operador` de uma `eletroposto_estacao` ativa; as RPCs de tela exigem
master. Liberar para admin/staff do tenant no futuro é trocar a condição das
políticas, não migrar tabela.

## Estação local

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
| `coletar.py` | o que o Agendador roda: batimento → telas; registro em `dados\coleta.log` |
| `coletor_tupi.py` | reserva **manual** (a VPS cobre a Tupi) |
| `instalar.ps1` | Python (via `py`, porque o `python` do PATH pode ser o atalho da Store), `platform-tools` oficial em `%LOCALAPPDATA%\Android\Sdk`, pastas, tarefa `Eletropostos\Coleta a cada 5 min` (`pythonw coletar.py`); remove as tarefas antigas Painel/Celular virtual |
| `config\supabase.env` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` (públicos, os mesmos do site) e `ADB_ALVO` |
| `.bat` | `entrar_estacao` (login), `coletar_agora`, `capturar_tela`, `iniciar_celular` (abre o BlueStacks) |
| `_aposentado\` | `servidor.py`, `web\`, `relatorio.py`, `abrir_painel.bat` — o painel local morreu; a tela é o console |

Formato de `telas.json`: `{"alvos": [{"fonte": "atm", "roteiros": [{"passos": [...],
"regras": [...]}]}]}`. Passos: `abrir` (pacote), `toque` (x, y), `tocar_texto`,
`esperar_texto` (até N s), `deslizar`, `voltar`; cada passo aceita `espera`.
Regra: `local_id`, `local_nome`, `conector`, `potencia_kw`, `lat`, `lng` (para o
vínculo automático), `ancora` (regex do nome na tela) e `regex` do status.

Por que a sessão guarda também o access token (e não só o refresh token da
spec): o Supabase **gira** o refresh token a cada uso e revoga a família
inteira se um token já usado volta depois de alguns segundos — exatamente o
que aconteceria quando a coleta agendada e `coletar_agora.bat` rodassem
juntas. Reaproveitando o access token por ~1 h, a renovação é rara.

O usuário da estação é um **staff do tenant GD Manager** criado pelo app
(Usuários), com a senha definida pela pessoa; o master registra o `id` em
`eletroposto_estacao` ([database.md](database.md#estação-local)). O
`HD-Adb.exe` do BlueStacks (1.0.36) **não** serve: dá `error: closed` com o
Android 11; por isso o `platform-tools` oficial.

## Pendências

- **Entrega 2 — para fechar**: ligar "Android Debug Bridge" em Configurações ›
  Avançado do BlueStacks (hoje `bst.enable_adb_access=0`: o shell do adb
  responde `error: closed`); criar o usuário da estação e registrá-lo em
  `eletroposto_estacao`; `entrar_estacao.bat`; calibrar ATM EVs e Cury
  (ambos mostram a disponibilidade ao tocar no ícone do carregador no mapa) e
  escrever `telas.json`; primeira coleta visível na aba Coleta.
- Retenção das leituras (hoje nenhuma; ~2 M linhas/ano cabem).
- Deploy do coletor: Actions → "Eletropostos — deploy do coletor na VPS"
  (`eletropostos-worker.yml`, manual). Log na VPS: `journalctl -u gdm-eletropostos`.
