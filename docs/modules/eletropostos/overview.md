# Eletropostos — monitor de carregadores de VE

> **Estado (16/10/2026):** 🟡 Entrega 1 pronta — banco, RPCs, seção no console
> e coletor da Tupi na VPS (agente próprio `gdm-eletropostos`). Entrega 2 (estação local com BlueStacks para os
> apps ATM EVs e Cury) pendente. **Só GD Manager (master).**
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
| Estação local (apps) | `C:\Users\luiza\Documents\monitor-eletropostos` (Python; entrega 2) |

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
| apps ATM EVs e Cury | leitura da tela no BlueStacks via `adb`/`uiautomator` (uso normal do app) | PC do usuário (estação local) | ⛔ entrega 2 |
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

## Pendências

- **Entrega 2 — estação local**: `comum.py` para o Supabase (RPC `_local`),
  `estacao.py` (login no terminal, refresh token em arquivo), `instalar.ps1`
  enxuto (Python + `adb`), `adb connect` no BlueStacks, calibração de ATM EVs e
  Cury (`telas.json`), usuário staff da estação em `eletroposto_estacao`.
- Retenção das leituras (hoje nenhuma; ~2 M linhas/ano cabem).
- Deploy do coletor: Actions → "Eletropostos — deploy do coletor na VPS"
  (`eletropostos-worker.yml`, manual). Log na VPS: `journalctl -u gdm-eletropostos`.
