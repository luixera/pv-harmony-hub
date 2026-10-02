# Ludmilla — acompanhar a EDP pelos e-mails (parecer de acesso no card)

**Data:** 02/10/2026 · **Estado:** desenho aprovado em conversa, aguardando revisão do usuário.

A Ludmilla hoje só sabe olhar portal. Esta entrega dá a ela um segundo meio de
acompanhamento — **o e-mail** — e o estreia na **EDP**, onde o parecer de acesso
chega por e-mail com o número da nota no assunto. Ela acha o e-mail pelo
protocolo do projeto, baixa o parecer para o card, lê o PDF e **recomenda** a
etapa. Quem move o card continua sendo a pessoa.

## 1. Por que assim (decisões da conversa)

| Decisão | Por quê |
|---|---|
| A função é da **Ludmilla**, não do Claudinho | O Claudinho varre a caixa por remetente e classifica; o fluxo *anexo → card com conferência* é da Ludmilla e é o que esta entrega precisa. |
| Roda no **worker da VPS**, não em edge function | `imapflow`/`mailparser` são bibliotecas Node (o worker é Node; edge function é Deno). E a Ludmilla já tem lá fila de runs, anexo→card, erros em português e registro por passo. Pedido do usuário: ficar na VPS. |
| Busca **pelo protocolo do projeto**, não por remetente | É o que a pessoa faz à mão (print de 02/10): procurar `040008312722` acha `NOTA - 40008312722`. Acha e-mail de qualquer data, sem depender da janela de 3 dias do Claudinho. |
| **Lê o PDF** do parecer | O assunto diz que o parecer chegou, não se é favorável. Só o conteúdo distingue aprovado de pendência. |
| Ela **recomenda**, não aplica | Regra da casa (set/2026): ninguém move card sem confirmação. |

## 2. O que já existe e será reaproveitado

- `portal_accounts` — a conta por concessionária (a EDP vira uma, `connector='edp'`, sem login de portal).
- `portal_sync_runs` + `ludmilla_claim_run` — a fila; ganha o tipo `varredura_email`.
- `portal_anexos` → `subirDocumento` → bucket `project-documents` → `documents` — o caminho do anexo até o card, **com `conferido_por`**.
- `portal_updates` + a página `/ludmilla` — as recomendações que a pessoa aplica.
- `agent_config` (`config_key='email_agent'`, `gmail_email` + `gmail_app_password`, por tenant) — a credencial da caixa, hoje usada pelo `scan-emails`. O worker lê a mesma, por RPC com service role; nenhum segredo novo é criado nem passa pelo chat.
- Padrão `datasheet-extract` — mandar PDF em base64 para a IA numa edge function, com o custo caindo no extrato de IA.

## 3. O que a EDP manda (observado no banco, set–out/2026)

| Assunto | Remetente | O que é | Anexa? | Lê o PDF? |
|---|---|---|---|---|
| `ENVIO DE PARECER - NOTA 45006443920` | `relacionamento.edp@…` | Parecer de acesso | sim | **sim** |
| `EDP - CARTA DE OBRAS` | `edpdocumentoporemail@edpbr.com.br` | Carta de obras | sim | não |
| `NOTA - 40008312722` | Relacionamento com o Cliente | Nota de serviço | sim | não |
| `Protocolo de Atendimento EDP 0460917635` | `protocolodoatendimentosp@edp…` | Atendimento avulso | não | não |
| `RA HugMe - EDP São Paulo…` | `automatico@hugme…` | Reclamação — ruído | não | não |

O protocolo no sistema é a nota **com um zero à esquerda**: `045006443920` ↔
`NOTA 45006443920`. Toda comparação é feita **só com os dígitos**, sem zeros à
esquerda.

## 4. Modelo de dados (migração)

```sql
-- 1. Como a conta é acompanhada (ortogonal a `modo`, que diz ONDE roda)
ALTER TABLE public.portal_accounts
  ADD COLUMN acompanhamento TEXT NOT NULL DEFAULT 'portal'
    CHECK (acompanhamento IN ('portal', 'email'));
-- CPFL: portal+vps · EDP: email+vps · Elektro: portal+local

-- 2. O CHECK de connector passa a aceitar 'edp'
-- 3. portal_sync_runs.tipo passa a aceitar 'varredura_email'
-- 4. portal_anexos.conferido_por passa a aceitar 'protocolo' | 'titular' | 'endereco'
--    (além de 'cpf' | 'uc', usados pela CPFL)

-- 5. Regras de leitura por concessionária — editáveis na tela, nunca no código
CREATE TABLE public.portal_email_regras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  remetente      TEXT,          -- trecho do remetente; NULL = qualquer
  assunto        TEXT NOT NULL, -- trecho do assunto (ex.: 'ENVIO DE PARECER')
  tipo_documento TEXT NOT NULL, -- 'parecer' | 'carta_obras' | 'nota' | 'outro'
  anexar         BOOLEAN NOT NULL DEFAULT TRUE,
  ler_pdf        BOOLEAN NOT NULL DEFAULT FALSE,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. O que já foi lido — para nunca reprocessar o mesmo e-mail
CREATE TABLE public.portal_email_mensagens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  run_id        UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  message_id    TEXT NOT NULL,
  protocolo     TEXT NOT NULL,
  project_id    UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  assunto       TEXT,
  remetente     TEXT,
  recebido_em   TIMESTAMPTZ,
  tipo_documento TEXT,
  veredito      TEXT,   -- 'favoravel' | 'pendencia' | 'inconclusivo' | NULL
  anexos        INTEGER NOT NULL DEFAULT 0,
  motivo        TEXT,   -- por que foi ignorado, quando for o caso
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_email_mensagens_unica UNIQUE (account_id, message_id)
);
```

RLS RESTRICTIVE por `tenant_id` nas duas tabelas novas, como todo o resto.
Semente para a EDP: as quatro regras da tabela da §3 que têm `anexar=sim`.

## 5. O run `varredura_email`, passo a passo

1. **Fila** — `ludmilla_claim_run` devolve o run; a conta diz `acompanhamento='email'`.
2. **Credencial** — RPC lê `agent_config` do tenant (`email_agent`). Sem caixa configurada → erro claro: *"o acesso à caixa de e-mail não está configurado para este tenant"*.
3. **Protocolos de interesse** — RPC devolve os projetos da concessionária da conta, ativos (fora de `completed`), com `protocol_number`. Limite de 80 por run, os mais recentes primeiro.
4. **Busca** — conecta ao IMAP e, para cada protocolo, procura o número (só dígitos) no assunto **ou** no corpo. Mensagem já registrada em `portal_email_mensagens` → pula sem baixar.
5. **Regras** — aplica `portal_email_regras`: assunto (e remetente, quando a regra tiver) → `tipo_documento`, `anexar`, `ler_pdf`. Nenhuma regra casa → registra como ignorada, com motivo.
6. **Conferência** — §6. Reprovou → registra o motivo e **não anexa**.
7. **Anexos** — cada PDF vira linha em `portal_anexos` e sobe por `subirDocumento` para o card, com `conferido_por`.
8. **Leitura do parecer** — se `ler_pdf`, chama a edge function `ludmilla-parecer` com o PDF em base64; volta `{ veredito, resumo, pendencias[] }`.
9. **Recomendação** — RPC `ludmilla_registrar_email` (SECURITY DEFINER, espelhando `ludmilla_registrar_varredura`) grava em `portal_updates`: `favoravel` → recomenda a etapa de aprovado; `pendencia` → recomenda pendência; demais tipos → sem recomendação de etapa, só o aviso de que o documento chegou.
10. **Fecha** — `finalizarRun` com quantos e-mails lidos, anexados e ignorados.

## 6. A conferência (a trava)

**Obrigatório:** o protocolo (só dígitos, sem zeros à esquerda) casa com **um**
projeto, e esse projeto é da concessionária da conta. Dois projetos com o mesmo
protocolo → não anexa, registra a ambiguidade.

**Reforço, quando o dado aparecer** no corpo do e-mail ou no texto do PDF:

- **Titular** — primeiro + último nome, a mesma regra que o Claudinho já usa.
- **Endereço** — logradouro e número, normalizados (sem acento, caixa alta).

Se aparecer e **bater**, `conferido_por` registra `titular` ou `endereco` (mais
forte que `protocolo`). Se aparecer e **divergir**, ela **não anexa**: grava o
anexo como bloqueado com o motivo e levanta a mão na `/ludmilla`. Se não
aparecer nenhum dos dois, segue só pelo protocolo, que é único.

## 7. Leitura do parecer (edge function `ludmilla-parecer`)

Recebe `{ pdf_base64, nome_arquivo, protocolo }` e devolve
`{ veredito: 'favoravel' | 'pendencia' | 'inconclusivo', resumo, pendencias[], titular?, endereco? }`.
O titular e o endereço que ela extrai alimentam a conferência da §6. PDF
ilegível ou resposta fora do formato → `inconclusivo`: o documento é anexado do
mesmo jeito e a recomendação sai como "parecer chegou, não consegui ler".
Custo entra no extrato de IA como as demais funções.

## 8. A tela `/ludmilla`

Cada cartão de concessionária passa a dizer **como ela acompanha**:

- **CPFL** — Portal (VPS), como hoje.
- **EDP** — E-mail. Mostra a caixa em uso (do Claudinho), a última verificação, quantos pareceres anexou, e a lista editável de regras: remetente, assunto, tipo, anexa?, lê o PDF?
- **Elektro** — Portal (estação local), como hoje.

"Verificar agora" no cartão da EDP enfileira um `varredura_email`.

## 9. Testes

Em `worker/ludmilla/test/`, com `node:test`, sobre funções puras — sem IMAP:

- normalização e casamento de protocolo (`045006443920` ↔ `45006443920`; zeros à esquerda; não-dígitos).
- aplicação das regras: assunto/remetente → tipo, anexar, ler_pdf; nenhuma regra casa.
- conferência: titular (primeiro+último), endereço normalizado, divergência, dado ausente.
- mapeamento veredito → recomendação.

A busca IMAP e a edge function entram no teste de ponta a ponta manual, com a
caixa real, antes de ligar o cron.

## 10. Fora do escopo desta entrega

Portal da EDP (consulta direta), solicitação de vistoria, responder e-mail,
acompanhar outras concessionárias por e-mail (a estrutura serve, mas só a EDP
é semeada agora).

## 11. Riscos

- **Volume de buscas** — uma busca IMAP por protocolo ativo. Limite de 80 por run e rodízio pelos mais recentes; medir o tempo real no primeiro run.
- **Primeira varredura** — a busca por protocolo acha e-mail antigo, então o primeiro run pode trazer muita coisa de uma vez. Rodar manualmente, conferir o que foi anexado, e só então ligar o agendamento.
- **Caixa compartilhada com o Claudinho** — os dois leem a mesma caixa; a Ludmilla **nunca** marca como lido nem move mensagem, só lê.
- **Protocolo repetido entre tenants** — a busca já é feita dentro do tenant da conta; a RPC de casamento confere `tenant_id`.
