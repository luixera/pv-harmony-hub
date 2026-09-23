# Módulo: Zé (José) — assistente pessoal no WhatsApp

## Objetivo
Funcionário de IA que conversa com o gestor do GD Manager pelo próprio
WhatsApp (chat "Você"): resume o dia, aponta cards parados e dados faltando,
revisa conversas sem resposta, avisa mudanças de etapa e executa pedidos
simples (tarefas, notas, mover etapa com confirmação). Aprende com o gestor
e entende áudio. **Nunca envia mensagem a terceiros.**

Spec: [`docs/superpowers/specs/2026-09-17-ze-whatsapp-design.md`](../../superpowers/specs/2026-09-17-ze-whatsapp-design.md).
Plano da fundação: [`docs/superpowers/plans/2026-09-17-ze-fundacao.md`](../../superpowers/plans/2026-09-17-ze-fundacao.md).

**Estado: Entrega 1 (fundação) NO AR e aceita em 23/09/2026** — Evolution
2.3.7 em `https://zap.homologamanager.com.br`, número conectado, espelho
funcionando nos dois sentidos e envio para o próprio número confirmado (o
plano B do grupo, previsto na spec §16, foi descartado). Entregas 2–6
(cérebro, escrita, aprendizado/áudio, rotinas/eventos, skill) pendentes.

## Regras duras (no código, não no prompt)
1. **Só envia ao próprio JID** (`ze_config.phone_jid`). A única ferramenta de
   envio recebe o número lido da config; não existe caminho para terceiros.
2. Nunca muda etapa sem **confirmação explícita** (pendência de 24 h) — Entrega 3.
3. `tenant_id` vem de `ze_config`, nunca do modelo.
4. Conversas de terceiros são **dados**, não instruções.
5. `wa_*` e `ze_messages`: **só o dono lê** (RLS `ze_dono_ok`). Retenção de
   30 dias para mensagens de terceiros (Entrega 5).
6. O que ele grava tem autor = gestor e `origin = 'ze'`.
7. **A lista oficial de tarefas (`tasks`) não recebe palpite de robô.** O que
   ele sugere por conta própria fica em `ze_tarefas_sugeridas` e só vira
   tarefa do sistema quando o gestor aceita (aba **Sugestões do Zé** em
   `/tasks`, bloco no `/ze`, ou "cria 1 e 3" pelo WhatsApp). Pedido direto do
   gestor no chat cria na hora. Em modo `rotina` as ferramentas que escrevem
   em `tasks` nem entram no array de tools — Entrega 3, spec §7.1.

## Infra
- **Evolution API v2** na VPS (`/opt/evolution`, Docker: api + postgres +
  redis; a API escuta só em `127.0.0.1:8080`). Nginx
  `zap.homologamanager.com.br` + certbot.
- Workflow manual [`evolution-vps.yml`](../../../.github/workflows/evolution-vps.yml)
  com `simular | instalar | atualizar | status`. O `.env` é **preservado**
  entre execuções — trocar a chave lá sem atualizar o secret da edge function
  quebraria tudo em silêncio.
- Instância `ze-<12 primeiros caracteres do tenant>`; webhook por instância
  apontando para `/functions/v1/ze-webhook` com header `x-ze-token`.
- Segredos: GitHub `EVOLUTION_API_KEY`, `EVOLUTION_DB_PASSWORD`,
  `CERTBOT_EMAIL` (opcional); edge functions `EVOLUTION_URL`,
  `EVOLUTION_API_KEY`, `ZE_WEBHOOK_TOKEN`.

## Banco (migração `20260922100000_ze_fundacao.sql`)
| Tabela | Para quê |
|---|---|
| `ze_config` | 1 linha por tenant: dono, instância, `phone_jid`, `situacao`, `qr_code` e preferências (modelo de IA, fuso, horas sem resposta, grupos, áudio). |
| `wa_chats` | Uma linha por conversa: nome, grupo, quando foi a última mensagem e de quem. |
| `wa_messages` | Espelho das mensagens (`UNIQUE tenant_id, wa_id`). Mídia entra como rótulo (`[imagem]`, `[documento x.pdf]`, `[áudio 12s]`). |
| `wa_contacts` | Quem é quem: papel, empresa, projetos, notas, `ignorar`. |
| `ze_messages` | O diálogo no chat "Você". O `wa_id` das mensagens que o Zé mandou é o que permite distinguir **eco** de **fala do gestor**. |

RPCs: `ze_admin_ok()` (admin de tenant `is_library`), `ze_dono_ok(tenant)`
(dono do WhatsApp), `ze_ativar()` (cria a config do tenant de quem chama).

## Edge functions
- **`ze-webhook`** (`--no-verify-jwt`, autentica por `x-ze-token`):
  `qrcode.updated` → QR na config; `connection.update` → situação e
  `phone_jid`; `messages.upsert` → espelho, e quando é o gestor falando no
  chat "Você" (e não eco do Zé) grava `ze_messages(papel='user')`.
  A gravação roda em segundo plano (`EdgeRuntime.waitUntil`).
- **`ze-admin`** (`--no-verify-jwt`, confere o Authorization e `ze_admin_ok`):
  `estado`, `conectar`, `teste_envio`, `desconectar`.
- Módulos **puros** em `supabase/functions/_shared/` (`evolution.ts`,
  `telefone.ts`), com 26 testes no vitest e fixtures em
  `_shared/fixtures/evolution/` — dá para testar tudo sem WhatsApp nenhum.

## Tela
`/ze` (admin + `is_library`): conexão (QR, estado, teste de envio,
desconectar) e preferências. Hook `src/hooks/useZe.ts`; item na sidebar com
`requiresZe`.

## Fluxo (Entrega 1)
```mermaid
flowchart LR
  W[WhatsApp do gestor] -->|QR| E[Evolution API na VPS]
  E -->|webhook x-ze-token| H[ze-webhook]
  H --> M[(wa_messages / wa_chats / wa_contacts)]
  H -->|chat Você, não é eco| Z[(ze_messages papel=user)]
  T[tela /ze] -->|JWT admin| A[ze-admin] --> E
```

## Armadilhas conhecidas
- **Corrida do eco**: o `sendText` devolve o `wa_id` e só depois a edge grava
  em `ze_messages`; o webhook do eco pode chegar antes. O `ze-webhook`
  recheca após 2 s antes de tratar como fala do gestor.
- **JIDs `@lid`** não são telefone (`telefoneDoJid` devolve null). O
  `jid_alt` fica guardado para o casamento futuro.
- **`.env` da Evolution é preservado** pelo workflow, de propósito.
- **O WhatsApp despeja o histórico do aparelho na Evolution ao conectar**
  (8.987 mensagens pessoais na primeira conexão, set/2026). Desligado com
  `acao=limpar_historico` no workflow (`DATABASE_SAVE_DATA_HISTORIC=false` +
  `DELETE FROM "Message"`). Mensagens **novas** continuam salvas lá de
  propósito: o download de áudio para transcrição depende delas. As tabelas
  `Chat` e `Contact` (metadados: número, nome, foto) ficam.
- Reiniciar o container da API **não** derruba a sessão do WhatsApp.
- O `vitest.config.ts` coleta `supabase/functions/_shared` — ao criar outro
  módulo puro lá, o teste roda junto com `npm test`.
