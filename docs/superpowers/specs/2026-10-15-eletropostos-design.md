# Eletropostos — monitor de carregadores dentro do GD Manager

**Data:** 15/10/2026 · **Estado:** proposta, aguardando aprovação do usuário
**Pedido:** "deixe dentro do GD Manager para o master admin" — levar para o
console `/painel` o sistema local de monitoramento de eletropostos de São José
do Rio Preto (`C:\Users\luiza\Documents\monitor-eletropostos`, Python +
SQLite + painel HTML em `localhost:8765`), mantendo tudo que ele mede e
calcula.

## 1. O que existe hoje (lido em 15/10/2026)

Sistema local, só biblioteca padrão do Python, sem dados coletados ainda
(`dados\` vazio; `config\telas.json` não existe; `capturas\` vazia).

| Peça | O que faz |
|---|---|
| `comum.py` | SQLite com 4 tabelas: `local` (cadastro, 72 locais do `inventario.csv`), `fonte_local` (como cada fonte chama um local + vínculo por proximidade ≤ 150 m), `leitura` (append-only, janela de 5 min, `UNIQUE(slot, fonte, local_id, conector)`), `varredura` (log por fonte). Normaliza status em `livre | ocupado | fora | desconhecido`. |
| `coletor_tupi.py` | Lê o mapa público da Tupi (`api.tupinambaenergia.com.br/stationsShortVersion`), filtra a caixa Rio Preto + Mirassol + Bady Bassitt, grava status **por conector**. Descarta campos de usuário. |
| `coletor_tela.py` | Lê apps Android (ATM EVs, Cury) num emulador via `adb` + `uiautomator`: roteiros em `telas.json` (`alvos > roteiros > passos + regras`), âncora + regex por local/conector. Modo `descobrir` salva xml/png/txt para calibrar. |
| `coletar.py` | Roda os dois a cada 5 min (Agendador do Windows), log em `dados\coleta.log`. |
| `servidor.py` + `web/index.html` | Painel com 5 abas: Visão geral (manchete, KPIs, fitas de ocupação por hora), Carregadores (tabela filtrável, cadastro), Mapa (Leaflet/OSM), Coleta (fontes, vínculos pendentes, erros), Premissas (fatores DC/AC, preço e custo padrão). Métricas: horas ocupado, ocupação, cobertura, sessões, energia/receita/margem **em faixa**. |

Regras de cálculo que **não podem mudar**: cada janela de 5 min "ocupado" =
5 min de uso; janela sem leitura e conector "fora" saem do denominador;
energia e receita são estimadas e sempre aparecem como faixa; nenhum dado de
motorista é gravado.

Fontes no inventário (72 locais): 11 ATM EVS (app com login), 4 Tupi (mapa
público, por conector), 4 Spott / 2 ChargeOn / 1 EvoltBR (só app), 1 EZVolt
(PlugShare), 4 sem rede, 44 sem fonte definida.

## 2. Classificação e escopo

**Arquitetural.** Módulo novo: tabelas, RPCs, coletor na VPS, seção no console
e uma estação local. Segue o rito da casa: spec → plano → execução.

**É:** o mesmo monitor, com os dados no Supabase e a tela no console
`/painel`, acesso **só master** (GD Manager), como Capacidade de rede.

**Não é** (decisões de escopo desta spec):
- Não cruza com projetos, empresas nem financeiro do GD Manager.
- Não entra para tenants (admin/staff/company). Liberar depois é política,
  não schema.
- Não guarda dado de motorista. O coletor da Tupi continua descartando
  `startedUserID`/`reservedUserID`; as leituras de tela guardam só o status.
- Não descompila, não intercepta tráfego, não contorna proteção de app; só
  usa os apps como uma pessoa usaria (regra do usuário, mantida).

## 3. Abordagens consideradas

| | A — tudo no GD Manager (recomendada) | B — tudo local em Python, só o painel no GD Manager | C — iframe do `localhost:8765` no console |
|---|---|---|---|
| Dados | Supabase (tabelas `eletroposto_*`) | SQLite no PC + cópia para o Supabase | SQLite no PC |
| Coletor Tupi | **VPS**, dentro do worker da Ludmilla (tique de 5 min) | PC (Agendador) | PC |
| Coletor de telas | PC com emulador, Python, grava via RPC `_local` | PC, grava no SQLite e sincroniza | PC |
| Tela | React no console, visual do console | React no console | HTML atual, só no PC do usuário |
| Depende do PC ligado | só as fontes por app | tudo | tudo |

**Escolha: A.** A Tupi é hoje a única fonte que funciona sem pessoa; na VPS
ela coleta mesmo com o PC desligado. C não é "dentro do GD Manager" de
verdade. B duplica banco e sincronização sem ganho.

Dentro da A, duas decisões de custo:
1. **O coletor da Tupi vai em TypeScript no `worker/ludmilla`** (pasta
   `src/eletropostos/`), como tique do laço já existente — sem unit systemd
   nova, sem workflow novo, com a service role que já está lá. Precedente: a
   ingestão da BDGD vive nesse pacote sem ser "portal".
2. **O coletor de telas continua em Python no PC.** O que muda é só o
   destino: `comum.py` troca o SQLite por chamadas REST ao Supabase (login da
   estação + RPCs `_local`). O emulador, o `adb`, o `telas.json`, o
   `instalar.ps1` e os `.bat` ficam como estão. Portar o `adb`/`uiautomator`
   para TS não traria nada.

## 4. Banco

Prefixo `eletroposto_`. Todas as tabelas levam `tenant_id` apontando para o
**tenant biblioteca** (`tenants.is_library`), como `engineering_rules` e
`portal_accounts` — o cadastro é editável pelo master, então não cabe no
critério estreito do ADR 0009 (dado imutável pelo app). RLS habilitada,
**RESTRICTIVE por tenant** + **SELECT só master** (`(select
public.is_master(auth.uid()))`). Nenhuma política de escrita para
`authenticated`: escrita só por RPC `SECURITY DEFINER`.

```
eletroposto_local            id uuid, tenant_id, nome, operadora, cidade, endereco,
                             lat, lng, tipo (DC|AC), potencia_kw, conectores int,
                             preco_kwh, custo_energia_kwh, fonte_status, observacoes,
                             ativo bool, criado_em, atualizado_em
eletroposto_fonte_local      (fonte text, local_fonte text) PK, tenant_id, nome, lat, lng,
                             local_id uuid null → eletroposto_local, visto_em
eletroposto_leitura          id bigint, tenant_id, ts_utc, slot timestamptz, fonte,
                             local_fonte text, local_nome, conector text ('*' = só o local),
                             potencia_kw, status_bruto, status (livre|ocupado|fora|desconhecido),
                             upstream_ts   UNIQUE(slot, fonte, local_fonte, conector)
                             índice (slot), índice (fonte, local_fonte, slot)
eletroposto_varredura        id, tenant_id, ts_utc, fonte, ok bool, n int, erro text
eletroposto_premissas        tenant_id PK, valores jsonb (dc_fator_min/max, ac_kw_min/max,
                             ac_fator_min/max, preco_kwh_padrao, custo_energia_kwh_padrao)
eletroposto_estacao          id, tenant_id, nome, operador uuid → auth.users (usuário staff
                             da estação), vista_em (batimento), ativa bool
```

Volume: ~20 conectores × 288 janelas/dia ≈ 6 mil linhas/dia, 2 milhões/ano.
Cabe; retenção não entra nesta fase. `slot` é `timestamptz` arredondado ao
múltiplo de 5 min, em UTC, igual ao Python.

**Seed:** migração insere os 72 locais do `config\inventario.csv` (nome,
cidade, lat/lng, tipo, conectores, operadora, fonte de status) e a linha de
premissas com os valores padrão do `servidor.py`. O `leituras.db` local está
vazio, então não há leitura a migrar.

### RPCs de escrita (coletores)

| RPC | Quem chama | Guarda |
|---|---|---|
| `eletropostos_gravar(p_fonte, p_linhas jsonb, p_erro text)` | worker na VPS | `auth.role() = 'service_role'` (padrão de `vps_armazenamento_registrar`) |
| `eletropostos_gravar_local(...)` mesma assinatura | estação (Python) | `auth.uid() = eletroposto_estacao.operador` de uma estação ativa (padrão `ludmilla_*_local`) |
| `eletropostos_estacao_pulsa()` | estação | idem; grava `vista_em` |

`eletropostos_gravar` faz, numa transação: upsert em `fonte_local` (com o
vínculo automático pelo local mais próximo a ≤ 150 m, só quando o par é
novo), `INSERT ... ON CONFLICT (slot, fonte, local_fonte, conector) DO UPDATE`
em `leitura`, e uma linha em `varredura`. Mesma semântica do `gravar()` +
`registrar_local_fonte()` do Python.

### RPCs de leitura/edição (console, só master)

| RPC | Devolve |
|---|---|
| `eletropostos_resumo(p_de date, p_ate date)` | `{periodo, kpis, locais[], nao_vinculados[], premissas}` — porta de `resumo()` do `servidor.py`: janelas esperadas, métricas por conector agregadas por local, energia/receita/margem em faixa, "agora" por status |
| `eletropostos_detalhe(p_local uuid, p_de, p_ate)` | `{local, conectores[], diario[], perfil[7][24], linha_do_tempo, vinculos[]}` — porta de `detalhe()` |
| `eletropostos_coleta()` | fontes com última leitura ok, taxa de sucesso, últimos 15 erros, leituras por dia, total |
| `eletropostos_local_salvar(p_local jsonb)` | cria ou atualiza cadastro (campos de `CAMPOS_LOCAL`) |
| `eletropostos_vincular(p_fonte, p_local_fonte, p_local uuid)` | grava o vínculo manual |
| `eletropostos_premissas_salvar(p_valores jsonb)` | só as chaves conhecidas, como `float` |

Todas: `SECURITY DEFINER`, `SET search_path = ''`, `IF NOT
public.is_master(auth.uid()) THEN RAISE`, `REVOKE ... FROM PUBLIC, anon`.
Período em horário de Brasília (`America/Sao_Paulo`), como o Python (`TZ -3`).

## 5. Coletor da Tupi na VPS

`worker/ludmilla/src/eletropostos/tupi.ts` + `tick.ts`. No laço da Ludmilla
(`index.ts`), a cada volta: se passaram ≥ 5 min da última coleta, chama
`coletarTupi()` em `try/catch` separado — erro na Tupi **nunca** derruba o
laço dos portais; vai para `eletroposto_varredura` com `ok=false`.

- Mesma URL, mesma caixa geográfica, mesmo `User-Agent` declarado, mesmo
  mapa de status (`MAPA_STATUS`) — portado para `status.ts` com teste vitest
  (função pura `normalizar`).
- Descarta qualquer campo de usuário antes de montar as linhas.
- Grava por `eletropostos_gravar` com a service role.
- Variável `ELETROPOSTOS_DESLIGADO=true` desliga o tique (para a estação local
  da Ludmilla e para teste).

## 6. Estação local (PC com o emulador)

Fica em `C:\Users\luiza\Documents\monitor-eletropostos`, Python, stdlib.
Mudanças:

- `comum.py`: `conectar()`/`gravar()`/`registrar_local_fonte()` passam a
  falar com o Supabase por `urllib` (PostgREST `/rest/v1/rpc/...`). O
  SQLite deixa de ser usado; `dados\leituras.db` **não é apagado** (regra
  do usuário) — fica como estava.
- `estacao.py` (novo): login na primeira execução — a pessoa digita e-mail e
  senha **no terminal**, nunca em arquivo nem argumento; guarda só o
  `refresh_token` em `dados\sessao.json`; renova a cada corrida; chama
  `eletropostos_estacao_pulsa()`. `SUPABASE_URL` e `SUPABASE_ANON_KEY`
  (públicos) em `config\supabase.env`.
- `coletor_tupi.py` deixa de ser agendado no PC (a VPS cobre); fica no repo
  como fallback manual.
- `servidor.py`, `web/`, `abrir_painel.bat`, `relatorio.py`: **aposentados**
  (movidos para `_aposentado\`), a tela passa a ser o console.
- `instalar.ps1`: só ajusta o agendamento (`coletar.py` continua a cada 5 min;
  o "Painel" sai). O resto (Python, Java, SDK, AVD `monitor`) permanece.
- O usuário da estação é um **staff do tenant GD Manager** criado para isso
  (`eletropostos@…`), registrado em `eletroposto_estacao.operador`.

A calibração dos apps (ATM EVs, Cury) **não muda**: `capturar_tela.bat` →
`capturas\*.txt/.xml` → `config\telas.json`. Continua sendo feita com a
pessoa logada nos apps; o GD Manager só recebe as leituras.

## 7. Tela no console

Nova entrada na NAV do `PainelConsole`: **Eletropostos** (ícone
`PlugZap`), entre "Capacidade de rede" e "Monitoramento".
`src/pages/painel/EletropostosSection.tsx` + `src/pages/painel/eletropostos/`:

| Arquivo | Conteúdo |
|---|---|
| `consultas.ts` | hooks React Query sobre as 6 RPCs; `staleTime` 60 s; refetch a cada 5 min quando a aba está visível |
| `calculo.ts` + `.test.ts` | funções puras portadas do JS: `faixa()`, `perfilMedio()` (24 valores a partir de `perfil[7][24]`), `relativo()` ("há 12 min"), `atrasada()` (> 15 min), chaves de ordenação da tabela |
| `VisaoGeral.tsx` | manchete + KPIs (`Kpi` do console) + **fitas de ocupação por hora** (SVG, 24 barras por local, assinatura visual do sistema) |
| `Carregadores.tsx` | tabela com filtros (busca, cidade, operadora, AC/DC, monitorados), ordenação por coluna, "Adicionar local" |
| `Mapa.tsx` | `GoogleMap` + `Marker` (mesma biblioteca de `ProjectsMap`/`NetworkSection`; **não** entra Leaflet): círculo grande = DC, pequeno = AC; opacidade = ocupação; cinza = sem monitoramento; clique abre o detalhe |
| `Coleta.tsx` | fontes (última leitura ok, taxa de sucesso, situação), **locais lidos sem vínculo** com select para vincular, últimos erros, batimento das estações |
| `Premissas.tsx` | formulário dos 8 fatores com os textos de ajuda atuais |
| `PainelLateral.tsx` | detalhe do local: KPIs, barras por dia, mapa de calor dia × hora, linha do tempo 48 h por conector, formulário de cadastro, "lido de" |
| `Exportar` | CSV gerado no cliente a partir de `eletropostos_resumo` (mesmas colunas do `exportar_csv`) |

Visual: o do console (`card`, `GOLD`, fundo `#0E0E14`), **não** a paleta
Archivo/cobalto do HTML — regra da casa de 14/10/2026 (tela interna segue o
que o GD Manager já tem). Cores de status: livre verde, ocupado dourado,
fora vermelho, sem leitura cinza.

## 8. Erros e limites

- Fonte sem leitura há > 15 min aparece em vermelho em Coleta (mesma regra).
- Tupi fora do ar: `varredura ok=false` com o erro truncado a 300 chars; o
  laço da Ludmilla segue.
- Estação sem bater há > 15 min: aviso em Coleta ("estação parada").
- Vínculo automático só no **primeiro** avistamento do par
  (fonte, local_fonte); depois, só manual — igual ao Python.
- RLS: teste com impersonação dentro de `begin … rollback` — master lê,
  admin de tenant não lê, `authenticated` não escreve, estação só grava pela
  `_local` e só se for a operadora de uma estação ativa.

## 9. Testes e verificação

- **SQL**: a porta de `metricas_conector`/`montar_local` é conferida com um
  conjunto fixo de leituras sintéticas (3 conectores, 2 dias) cujo resultado
  esperado é calculado antes à mão a partir das regras da §1.
- **vitest**: `status.test.ts` (worker), `calculo.test.ts` (console).
- **Tela**: navegador do Claude nas 5 abas, console sem erro, com o seed dos
  72 locais e leituras sintéticas da Tupi.
- Baseline da casa: `npx tsc --noEmit -p tsconfig.app.json` em **65** e
  `npm run build`; worker: `npm test` em `worker/ludmilla`.

## 10. Entregas

1. **Banco + console + Tupi na VPS** — fim a fim sem o emulador: migração,
   seed, 9 RPCs, seção com as 5 abas, tique da Tupi no worker, deploy. Já
   mostra dados reais dos 4 locais Tupi.
2. **Estação local** — `comum.py`/`estacao.py` para o Supabase, usuário da
   estação, `instalar.ps1` ajustado, emulador, calibração de ATM EVs e Cury
   com o usuário (ele faz os logins; o Claude só captura e escreve o
   `telas.json`).

Documentação a criar/atualizar na entrega 1: `docs/modules/eletropostos/`
(overview, database, business-rules, flows), linha na tabela do `CLAUDE.md`
(🟡 só GD Manager), `docs/project/roadmap.md`, memória `eletropostos.md`.

## 11. Perguntas abertas (assumido até o usuário dizer o contrário)

- **Usuário da estação**: será criado um staff dedicado no tenant GD
  Manager. Alternativa: usar o mesmo operador local da Ludmilla.
- **Nome na NAV**: "Eletropostos". Alternativa: "Carregadores".
- **Retenção das leituras**: nenhuma por enquanto (2 M linhas/ano cabem).
