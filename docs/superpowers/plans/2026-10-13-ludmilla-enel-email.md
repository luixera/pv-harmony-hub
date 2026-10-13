# Ludmilla — acompanhamento da ENEL por e-mail (fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Ludmilla lê os e-mails da ENEL pelos remetentes, descobre de qual projeto é cada um (protocolo, UC ou titular — no texto ou no PDF), anexa o documento no card, sugere a etapa e toca o sino nos momentos que pedem ação. Nunca move card, nunca envia nada.

**Architecture:** Um segundo modo do run `varredura_email`, escolhido pela conta (`portal_accounts.identificacao = 'remetente'`). O caminho da EDP (`executarVarreduraEmail` / `tratarMensagem`) **não é alterado**: um roteador novo escolhe entre ele e o da ENEL. Identificação e classificação do corpo são módulos puros e testados; a leitura do PDF reaproveita a `ludmilla-parecer` com um modo ENEL aditivo; a infraestrutura de retentativa, anexo e registro é a da EDP.

**Tech Stack:** Node 22 + TypeScript ESM (worker na VPS), `node:test`, imapflow/mailparser, Supabase (Postgres, RPCs SECURITY DEFINER, Edge Function Deno), React 18 + shadcn (tela).

**Spec:** `docs/superpowers/specs/2026-10-13-ludmilla-enel-email-design.md` — leia antes de qualquer task.

## Global Constraints

- **Nunca enviar e-mail, nunca mover card, nunca escrever na caixa** (a caixa abre em `readOnly`). Pedir troca do relógio é fase 2.
- **O Claudinho (`scan-emails`, `email_updates`, `/email-updates`) não é tocado.** Decisão do usuário: os dois rodam.
- **O caminho da EDP não regride:** `executarVarreduraEmail`, `tratarMensagem`, `triar` e os testes atuais (225 com build limpo) ficam **sem alteração** e passando.
- **O caminho de varredura de PORTAL não é tocado** (`executar()` em `src/index.ts`, `src/conectores/`, `src/criacao/`, RPCs de varredura, `ludmilla_agendar_varreduras`). Regra do usuário: "as funções de atualização de projetos não quero que mexe".
- **Princípio da identificação (spec §6.1):** procurar os NOSSOS números (protocolo, UC) dentro do e-mail, como número inteiro e exato; nunca tratar um número qualquer do e-mail como protocolo.
- **Nome sozinho só identifica se for único entre os projetos ATIVOS da ENEL do tenant** (decisão do usuário). Nome no **corpo** não conta — só no assunto (o corpo tem assinatura de funcionário da ENEL).
- **Primeira leitura: últimos 30 dias** (decisão do usuário). Janela nunca maior que 30 dias.
- **Nenhum dado de cliente no log** (nome, endereço, assunto, nome de arquivo, mensagem crua de erro de terceiro). Só código do projeto, contagens, selo.
- **Toda tentativa é contada ANTES de gastar IA** (`ludmilla_email_tentativa`); falha passageira deixa `concluida = false`; teto de 5.
- **Tenant por `get_user_tenant_id`**, nunca por claim do JWT. Funções do robô exigem `service_role`.
- **Migrações:** aplicar com `npx -y supabase db query --linked -f arquivo.sql` (só o último SELECT com linhas aparece); copiar funções INTEIRAS da definição mais recente (`CREATE OR REPLACE` troca o corpo todo); re-executáveis; provar comportamento EXECUTANDO dentro de `begin; … rollback;` (temp table sob impersonação precisa de `grant insert, select on <t> to authenticated`).
- **Testes:** TDD; testes que escolhem o próprio dado não provam privacidade — o dado de cliente tem de estar na entrada; **mutação** nos módulos puros (quebrar o código de propósito e mostrar quantos testes caem).
- **Verificação:** `cd worker/ludmilla && npx tsc --noEmit -p tsconfig.json && npm test` (`fail 0`); na raiz, `npx tsc --noEmit -p tsconfig.app.json` sem passar de **65** erros; `npm run build` quando tocar o front.
- **Commits:** em `main`, português, mensagem em ARQUIVO com `git commit -F arquivo` e linha em branco depois do título (o heredoc desta máquina come linhas vazias); trailer `Co-Authored-By:` com o modelo que de fato escreveu. **Commitar só os próprios caminhos** (outra sessão commita a árvore toda). **Nada de push, workflow ou run enfileirado.**

## O que este plano decide além da spec (ler antes de executar)

Cinco pontos saíram da investigação do código e dos dados ao escrever o plano. Todos vão na direção de **menos documento no lugar errado e menos ruído**:

1. **Nome do titular só conta no ASSUNTO** (a spec §6.3 dizia "assunto + corpo"). O corpo dos e-mails da ENEL traz a assinatura do funcionário que respondeu; um cliente homônimo casaria com ela. Os assuntos que vocês escrevem trazem o nome do cliente ("TROCA DE RELÓGIO - <NOME> - NT …"), então o sinal continua existindo onde é confiável.
2. **§6.5 implementado pelo princípio §6.1, não por faixa de dígitos.** Um arquivo não vai para o card quando o nome dele traz o protocolo ou a UC de **outro projeto nosso** (ativo ou concluído). Uma faixa de dígitos seria ambígua na ENEL: UC e protocolo de contato têm os dois 10 dígitos, e a nota de serviço tem 12.
3. **Número de projeto concluído é reconhecido** (`inativo`): o e-mail é registrado como "de um projeto já concluído" e nada vai para o card. Sem isso, um e-mail de projeto concluído que trouxesse só o nome cairia no projeto ativo de um homônimo.
4. **Não sugerir etapa para trás** (`recomendacaoCabe`). Dos 34 projetos ativos, 17 estão em Vistoria solicitada; a primeira leitura traz 30 dias de Cartas, e uma Carta de aprovação antiga não pode virar sugestão de voltar para Aprovado.
5. **Cartão só quando há sugestão de etapa** (`p_abrir_cartao`). Hoje toda mensagem ligada a projeto abre um cartão (que toca o sino); na ENEL são 99 respostas automáticas e as trocas agendadas. A mensagem segue registrada e visível no histórico; o documento chega ao card pelo comentário do anexo; os momentos que pedem ação têm o aviso próprio.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261013120000_ludmilla_enel_email.sql` (novo) | conta ENEL, modo da conta, tipos de regra, RPCs novas, registrar com referência/casamento/cartão, avisos, sementes |
| `worker/ludmilla/src/email/enel/identificar.ts` (novo) | puro: de qual projeto é o e-mail |
| `worker/ludmilla/src/email/enel/classificar.ts` (novo) | puro: o que o CORPO diz (vistoria, troca do relógio) |
| `worker/ludmilla/src/email/enel/decidir.ts` (novo) | puro: ler PDF?, que etapa sugerir, cabe sugerir?, que aviso, que janela, quais remetentes |
| `worker/ludmilla/src/email/enel/run.ts` (novo) | o tratamento de uma mensagem e o run da ENEL |
| `worker/ludmilla/src/email/rotear.ts` (novo) | escolhe entre o run da EDP e o da ENEL |
| `worker/ludmilla/src/email/caixa.ts` | + `procurarDe(remetente, desde)` |
| `worker/ludmilla/src/fila.ts` | + `contaDoEmail`, `projetosDoEmail`, `avisarEquipe`; `EmailLido` ganha campos opcionais |
| `worker/ludmilla/src/index.ts` | **uma** troca: chama o roteador em vez de `executarVarreduraEmail` |
| `supabase/functions/ludmilla-parecer/index.ts` | modo ENEL aditivo (`tipo`, `nt`, `uc`) |
| `src/hooks/useLudmilla.ts`, `src/components/ludmilla/RegrasEmail.tsx`, `src/components/ludmilla/MensagensEmail.tsx` | tipos novos, rótulos, contadores da ENEL |
| `docs/…`, memória | documentação, roteiro do primeiro run |

Testes novos: `worker/ludmilla/test/enel-identificar.test.ts`, `enel-classificar.test.ts`, `enel-decidir.test.ts`, `enel-run.test.ts`, `parecer-enel.test.ts`.

---

### Task 1: Banco — conta da ENEL, modo da conta, RPCs e sementes

**Files:**
- Create: `supabase/migrations/20261013120000_ludmilla_enel_email.sql`
- Read first: `supabase/migrations/20261012120000_ludmilla_email_rodada3.sql` (definição mais recente de `ludmilla_email_registrar`), `supabase/migrations/20261009120000_ludmilla_email_anexo_por_protocolo.sql`, `supabase/migrations/20261002120000_ludmilla_email_edp.sql` (semente da EDP, como modelo)

**Interfaces:**
- Produces (RPCs, todas `SECURITY DEFINER SET search_path = ''`, só `service_role`):
  - `ludmilla_email_conta(p_account_id uuid) → table(identificacao text, ultima_varredura_em timestamptz)`
  - `ludmilla_email_projetos(p_account_id uuid) → table(project_id uuid, company_id uuid, codigo text, protocolo text, uc text, titular text, status text, ativo boolean)`
  - `ludmilla_email_avisar(p_account_id uuid, p_message_id text, p_protocolo text, p_project_id uuid, p_titulo text, p_mensagem text) → integer`
  - `ludmilla_email_registrar(…16 parâmetros de hoje…, p_referencia text DEFAULT NULL, p_casamento text DEFAULT NULL, p_abrir_cartao boolean DEFAULT TRUE) → uuid`
- Produces (dados): `portal_accounts.identificacao`, `portal_email_mensagens.aviso_em`, conta `connector='enel'` do tenant de biblioteca, 8 regras.

- [ ] **Step 1: Escrever a parte estrutural da migração**

```sql
-- supabase/migrations/20261013120000_ludmilla_enel_email.sql
-- Ludmilla — acompanhamento da ENEL por e-mail (fase 1).
-- Spec: docs/superpowers/specs/2026-10-13-ludmilla-enel-email-design.md
--
-- A ENEL inverte a premissa da EDP: lá a robô parte do projeto e exige o
-- protocolo no assunto; aqui ela parte do e-mail, pelos remetentes, e descobre
-- de qual projeto ele é. A forma de identificar passa a ser propriedade da conta.

-- 1. a ENEL vira conector aceito
ALTER TABLE public.portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_connector_check;
ALTER TABLE public.portal_accounts ADD CONSTRAINT portal_accounts_connector_check
  CHECK (connector = ANY (ARRAY['cpfl'::text, 'elektro'::text, 'edp'::text, 'enel'::text]));

-- 2. como a conta descobre o projeto de um e-mail
ALTER TABLE public.portal_accounts
  ADD COLUMN IF NOT EXISTS identificacao TEXT NOT NULL DEFAULT 'protocolo_no_assunto';
ALTER TABLE public.portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_identificacao_check;
ALTER TABLE public.portal_accounts ADD CONSTRAINT portal_accounts_identificacao_check
  CHECK (identificacao = ANY (ARRAY['protocolo_no_assunto'::text, 'remetente'::text]));
COMMENT ON COLUMN public.portal_accounts.identificacao IS
  'Como o run varredura_email descobre o projeto: protocolo_no_assunto (EDP: parte do projeto e exige o protocolo no assunto) ou remetente (ENEL: parte do e-mail, pelos remetentes, e procura nossos números no texto e no PDF).';

-- 3. os tipos de documento da ENEL
ALTER TABLE public.portal_email_regras DROP CONSTRAINT IF EXISTS portal_email_regras_tipo_documento_check;
ALTER TABLE public.portal_email_regras ADD CONSTRAINT portal_email_regras_tipo_documento_check
  CHECK (tipo_documento = ANY (ARRAY[
    'parecer'::text, 'carta_obras'::text, 'nota'::text, 'outro'::text,
    'carta_projeto'::text, 'resultado_vistoria'::text, 'troca_relogio'::text,
    'resposta_automatica'::text, 'devolucao'::text, 'comunicado'::text]));

-- 4. o sino toca UMA vez por mensagem: a retentativa não pode avisar de novo
ALTER TABLE public.portal_email_mensagens ADD COLUMN IF NOT EXISTS aviso_em TIMESTAMPTZ;
```

- [ ] **Step 2: Escrever as três RPCs novas**

```sql
-- 5. modo e última verificação da conta
CREATE OR REPLACE FUNCTION public.ludmilla_email_conta(p_account_id UUID)
RETURNS TABLE (identificacao TEXT, ultima_varredura_em TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.identificacao, a.ultima_varredura_em
    FROM public.portal_accounts a
   WHERE a.id = p_account_id AND (SELECT auth.role()) = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_conta(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_conta(UUID) TO service_role;

-- 6. TODOS os projetos da concessionária da conta, com o que identifica cada um.
-- `ativo = false` (concluído/arquivado) ainda serve para RECONHECER um número
-- ("este e-mail é de um projeto já concluído") e para barrar arquivo de outro
-- projeto — mas nunca recebe documento nem sugestão.
CREATE OR REPLACE FUNCTION public.ludmilla_email_projetos(p_account_id UUID)
RETURNS TABLE (project_id UUID, company_id UUID, codigo TEXT, protocolo TEXT, uc TEXT,
               titular TEXT, status TEXT, ativo BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.company_id, p.code, p.protocol_number, g.uc_number, g.holder_name,
         p.status::text, (p.archived_at IS NULL AND p.status::text <> 'completed')
    FROM public.portal_accounts a
    JOIN public.projects p
      ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
    LEFT JOIN public.project_general_data g ON g.project_id = p.id
   WHERE a.id = p_account_id
     AND (SELECT auth.role()) = 'service_role'
     AND NOT p.is_deleted
   ORDER BY p.created_at DESC
   LIMIT 2000;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_projetos(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_projetos(UUID) TO service_role;

-- 7. aviso no sino para admin + staff do tenant, UMA vez por mensagem
CREATE OR REPLACE FUNCTION public.ludmilla_email_avisar(
  p_account_id UUID, p_message_id TEXT, p_protocolo TEXT, p_project_id UUID,
  p_titulo TEXT, p_mensagem TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _msg UUID; _n INTEGER := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô toca o sino da Ludmilla';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  IF _conta.id IS NULL THEN RAISE EXCEPTION 'conta % não existe', p_account_id; END IF;

  -- A linha da mensagem já existe (a tentativa a abriu). Marcar e avisar no mesmo
  -- passo: a retentativa encontra aviso_em preenchido e não toca o sino de novo.
  UPDATE public.portal_email_mensagens
     SET aviso_em = now()
   WHERE account_id = p_account_id AND message_id = p_message_id
     AND protocolo = p_protocolo AND aviso_em IS NULL
  RETURNING id INTO _msg;
  IF _msg IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
  SELECT _conta.tenant_id, pr.id, left(p_titulo, 200), left(p_mensagem, 1000), 'ludmilla',
         (SELECT x.id FROM public.projects x WHERE x.id = p_project_id AND x.tenant_id = _conta.tenant_id),
         FALSE
    FROM public.profiles pr
   WHERE pr.tenant_id = _conta.tenant_id AND pr.role IN ('admin', 'staff');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_avisar(UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_avisar(UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;
```

- [ ] **Step 3: Estender `ludmilla_email_registrar` sem mudar o comportamento da EDP**

Copie a função **INTEIRA** de `20261012120000_ludmilla_email_rodada3.sql` (o corpo e os REVOKE/GRANT) para a migração nova e aplique **só** estas mudanças:

1. Antes do `CREATE`, um `DROP FUNCTION IF EXISTS public.ludmilla_email_registrar(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT);` — a assinatura muda, então `CREATE OR REPLACE` sozinho criaria uma segunda função.
2. Acrescente **no fim** da lista de parâmetros: `p_referencia TEXT DEFAULT NULL, p_casamento TEXT DEFAULT NULL, p_abrir_cartao BOOLEAN DEFAULT TRUE`. Com `DEFAULT`, a chamada da EDP (16 parâmetros nomeados) resolve para a nova sem mudança.
3. No `DECLARE`: `_ref TEXT; _cas TEXT;` e, logo no começo do corpo:
   ```sql
   -- A EDP não manda os dois: tudo segue como sempre (protocolo da mensagem, casamento 'protocolo').
   -- A ENEL usa uma chave fixa de mensagem ('') e manda a referência do projeto identificado.
   _ref := coalesce(nullif(p_referencia, ''), p_protocolo);
   _cas := coalesce(p_casamento, 'protocolo');
   ```
4. Em **todo** `INSERT INTO public.portal_updates`, o valor de `protocolo` passa a ser `_ref` e o de `casamento` passa a ser `_cas`.
5. Em **toda** comparação contra `portal_updates.protocolo` (o `NOT EXISTS` da linha nova do D5), compare com `_ref` em vez de `p_protocolo`. Sem isso, na ENEL a guarda contra recomendação duplicada nunca casaria.
6. O bloco que abre/corrige a linha de `portal_updates` (o `IF _upd IS NULL THEN INSERT … ELSE UPDATE …`) fica inteiro dentro de `IF p_abrir_cartao THEN … END IF;`. A linha da MENSAGEM continua sendo gravada sempre.
7. A chave da linha da MENSAGEM (`ON CONFLICT (account_id, message_id, protocolo)`) continua usando `p_protocolo`. **Nada mais muda.**
8. Refaça o `REVOKE`/`GRANT` para a assinatura nova de 19 parâmetros.

Por que `p_abrir_cartao`: hoje toda mensagem ligada a projeto abre um cartão em `portal_updates` (e o cartão toca o sino). Na ENEL há 99 respostas automáticas e as trocas agendadas — um cartão para cada seria ruído. A robô passa `false` quando não há sugestão de etapa nem bloqueio; a mensagem segue registrada e visível no histórico.

- [ ] **Step 4: Escrever as sementes**

```sql
-- 8. a conta da ENEL do tenant de biblioteca. SEM login e SEM secret_id de
-- propósito: o agendador (`ludmilla_agendar_varreduras`) só enfileira contas com
-- os dois, e por isso a EDP nunca recebeu varredura de portal. A ENEL herda a
-- mesma proteção. (É uma proteção acidental — anotada na doc; não mexer no
-- agendador, que é do caminho de portal.)
INSERT INTO public.portal_accounts (tenant_id, concessionaire_id, connector, acompanhamento, identificacao, modo, situacao)
SELECT c.tenant_id, c.id, 'enel', 'email', 'remetente', 'vps', 'ok'
  FROM public.energy_concessionaires c
  JOIN public.tenants t ON t.id = c.tenant_id
 WHERE t.is_library AND c.name ILIKE '%enel%'
   AND NOT EXISTS (SELECT 1 FROM public.portal_accounts x
                    WHERE x.connector = 'enel' AND x.tenant_id = c.tenant_id);

-- 9. as regras iniciais (spec §9). Assunto '' = qualquer assunto daquele remetente.
INSERT INTO public.portal_email_regras (tenant_id, account_id, remetente, assunto, tipo_documento, anexar, ler_pdf, ativo, ordem)
SELECT a.tenant_id, a.id, r.remetente, '', r.tipo, r.anexar, r.ler_pdf, TRUE, r.ordem
  FROM public.portal_accounts a
 CROSS JOIN (VALUES
   ('nao.responda@enel.com',            'carta_projeto',       TRUE,  TRUE,  1),
   ('tecnico.abc@enel.com',             'resultado_vistoria',  TRUE,  TRUE,  2),
   ('tecnico.norte@enel.com',           'resultado_vistoria',  TRUE,  TRUE,  3),
   ('tecnico.oeste@enel.com',           'resultado_vistoria',  TRUE,  TRUE,  4),
   ('canalgd.sp@br.enel.com',           'troca_relogio',       TRUE,  TRUE,  5),
   ('no-reply@enel.com',                'resposta_automatica', FALSE, FALSE, 6),
   ('postmaster@enel.com',              'devolucao',           FALSE, FALSE, 7),
   ('atendimento.edsp@enel.com',        'comunicado',          FALSE, FALSE, 8)
 ) AS r(remetente, tipo, anexar, ler_pdf, ordem)
 WHERE a.connector = 'enel'
   AND NOT EXISTS (SELECT 1 FROM public.portal_email_regras x
                    WHERE x.account_id = a.id AND x.remetente = r.remetente);
```

Nota sobre `canalgd.sp` com tipo `troca_relogio`: o tipo da regra é só uma **dica**. O que o e-mail É sai do corpo (`classificar.ts`) e do PDF (`ludmilla-parecer`). Para o `canalgd`, o PDF só é lido quando o texto não bastou para identificar o projeto (`decidir.ts`).

- [ ] **Step 5: Aplicar e provar a estrutura**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261013120000_ludmilla_enel_email.sql`

Depois, um arquivo de conferência (só leitura) que prove: a conta `enel` existe com `acompanhamento='email'`, `identificacao='remetente'`, `login IS NULL`; as 8 regras existem; a conta da EDP tem `identificacao='protocolo_no_assunto'`; `pg_get_function_identity_arguments` de `ludmilla_email_registrar` termina em `p_referencia text, p_casamento text, p_abrir_cartao boolean` e só existe **uma** função com esse nome.

- [ ] **Step 6: Provar o comportamento, EXECUTANDO, dentro de `begin; … rollback;`**

Com `set_config('request.jwt.claims', '{"role":"service_role"}', true)` e `set local role service_role`, prove e mostre o resultado de cada um:

1. `ludmilla_email_projetos(<conta enel>)` devolve os projetos da ENEL do GD Manager; `count(*) FILTER (WHERE ativo)` = 34 (número de 13/10).
2. **Chamada no formato da EDP** (16 parâmetros nomeados, sem os três novos) grava `portal_updates.protocolo = p_protocolo` e `casamento = 'protocolo'` — exatamente como antes.
3. Chamada com `p_protocolo => ''`, `p_referencia => '123456789'`, `p_casamento => 'uc'` grava a mensagem com `protocolo = ''` e o cartão com `protocolo = '123456789'`, `casamento = 'uc'`.
4. Repetir a chamada 3 com a mesma recomendação **não** abre segundo cartão.
5. `p_abrir_cartao => false` grava a mensagem e **não** cria linha em `portal_updates`.
6. `ludmilla_email_avisar` duas vezes para a mesma mensagem: a primeira devolve > 0, a segunda devolve 0.
7. `md5(prosrc)` das funções do caminho de portal (`ludmilla_registrar_varredura`, `ludmilla_anexo_enviado`, `ludmilla_anexo_enviado_local`, `ludmilla_anexos_pendentes`, `ludmilla_finalizar_run_impl`, `ludmilla_agendar_varreduras`) é igual antes e depois da migração.

Depois do rollback: 0 linhas de prova em `portal_email_mensagens`, `portal_updates`, `notifications`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261013120000_ludmilla_enel_email.sql
git commit -F <arquivo-da-mensagem>
```
Título: `feat(ludmilla): banco do acompanhamento da ENEL por e-mail`

---

### Task 2: Identificação do projeto (módulo puro)

**Files:**
- Create: `worker/ludmilla/src/email/enel/identificar.ts`
- Test: `worker/ludmilla/test/enel-identificar.test.ts`

**Interfaces:**
- Consumes: `casaTitular`, `comparavelTitular`, `semAcento` de `worker/ludmilla/src/email/util.ts`
- Produces:
  - `interface ProjetoEnel { project_id: string; company_id: string; codigo: string; protocolo: string | null; uc: string | null; titular: string | null; status: string; ativo: boolean }`
  - `type Sinal = 'protocolo' | 'uc' | 'titular'`
  - `type Identificacao = { tipo: 'achado'; projeto: ProjetoEnel; por: Sinal } | { tipo: 'inativo'; projeto: ProjetoEnel; por: Sinal } | { tipo: 'conflito'; motivo: string; codigos: string[] } | { tipo: 'nenhum' }`
  - `MIN_DIGITOS = 9`
  - `numerosDoTexto(texto: string | null | undefined): Set<string>`
  - `titularNoAssunto(assunto: string, titular: string): boolean`
  - `identificarPorTexto(m: { assunto: string; corpo: string }, projetos: ProjetoEnel[]): Identificacao`
  - `identificarPorDocumento(doc: { nt: string | null; uc: string | null; titular: string | null }, projetos: ProjetoEnel[]): Identificacao`
  - `combinar(texto: Identificacao, documento: Identificacao): Identificacao`
  - `nomeTrazOutroProjeto(nome: string, projeto: ProjetoEnel, projetos: ProjetoEnel[]): boolean`
  - `referenciaDoProjeto(p: ProjetoEnel): string`

- [ ] **Step 1: Escrever os testes**

```ts
// worker/ludmilla/test/enel-identificar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combinar, identificarPorDocumento, identificarPorTexto, nomeTrazOutroProjeto, numerosDoTexto,
  referenciaDoProjeto, titularNoAssunto, type ProjetoEnel,
} from '../src/email/enel/identificar.js';

const P = (o: Partial<ProjetoEnel>): ProjetoEnel => ({
  project_id: 'x', company_id: 'c', codigo: 'PRJ-X', protocolo: null, uc: null, titular: null,
  status: 'analysis', ativo: true, ...o,
});
const A = P({ project_id: 'a', codigo: 'PRJ-A', protocolo: '123456789', uc: '1111111111', titular: 'MARIA APARECIDA SILVA' });
const B = P({ project_id: 'b', codigo: 'PRJ-B', protocolo: '987654321', uc: '2222222222', titular: 'JOSE CARLOS SANTOS' });
const C = P({ project_id: 'c', codigo: 'PRJ-C', protocolo: 'aguardando protocolo', uc: '3333333333',
              titular: 'OSSEL LOCACAO DE SALAS PARA VELORIOS LTDA' });
const VELHO = P({ project_id: 'v', codigo: 'PRJ-V', protocolo: '555555555', uc: '4444444444',
                  titular: 'MARIA APARECIDA SILVA', status: 'completed', ativo: false });
const TODOS = [A, B, C, VELHO];
const txt = (assunto: string, corpo = '') => ({ assunto, corpo });

test('numerosDoTexto: só sequências de 9+ dígitos, sem zero à esquerda', () => {
  assert.deepEqual([...numerosDoTexto('NT 0123456789 em 13/10/2026, CEP 01310100')], ['123456789']);
  assert.deepEqual([...numerosDoTexto('data 20261013')], []); // 8 dígitos não identificam
  assert.deepEqual([...numerosDoTexto(null)], []);
});

test('NT no assunto identifica pelo protocolo', () => {
  const id = identificarPorTexto(txt('VISTORIA GD 123456789 - resultado'), TODOS);
  assert.equal(id.tipo, 'achado');
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-A');
  assert.equal(id.tipo === 'achado' && id.por, 'protocolo');
});

test('instalação no corpo identifica pela UC', () => {
  const id = identificarPorTexto(txt('RE: TROCA DE RELÓGIO', 'referente a instalação 2222222222 , para a troca'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'uc');
});

test('protocolo de contato da ENEL (10 dígitos, de ninguém) NÃO identifica', () => {
  const id = identificarPorTexto(txt('RE: atendimento', 'Protocolo: 9876543210. Atenciosamente'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('números de dois projetos é conflito', () => {
  const id = identificarPorTexto(txt('NT 123456789 e NT 987654321'), TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('número de um projeto e nome do titular de outro é conflito', () => {
  const id = identificarPorTexto(txt('TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 123456789'), TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('número e nome do MESMO projeto identificam pelo protocolo', () => {
  const id = identificarPorTexto(txt('TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 987654321'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'protocolo');
});

test('só o nome no assunto, único entre os ATIVOS, identifica pelo titular', () => {
  // MARIA APARECIDA SILVA também é titular do VELHO, que está concluído: não conta
  const id = identificarPorTexto(txt('PROJETO GD - MARIA A. SILVA'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-A');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('nome que casa com dois projetos ativos é conflito', () => {
  const GEMEO = P({ project_id: 'g', codigo: 'PRJ-G', titular: 'MARIA APARECIDA SILVA' });
  const id = identificarPorTexto(txt('PROJETO GD - MARIA APARECIDA SILVA'), [...TODOS, GEMEO]);
  assert.equal(id.tipo, 'conflito');
});

test('nome no CORPO não identifica (assinatura de funcionário da ENEL)', () => {
  const id = identificarPorTexto(txt('RE: sua solicitação', 'Atenciosamente, Jose Carlos Santos — Serviço da Enel'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('empresa com palavras curtas no meio casa pelo nome completo', () => {
  assert.equal(titularNoAssunto('PROJETO GD - OSSEL LOCACAO DE SALAS PARA VELORIOS LTDA', C.titular!), true);
  assert.equal(titularNoAssunto('PROJETO GD - OSSEL', C.titular!), false);
});

test('titular de uma palavra só nunca identifica', () => {
  assert.equal(titularNoAssunto('PROJETO GD - IVANILDO', 'IVANILDO'), false);
});

test('número de projeto concluído dá "inativo", não achado', () => {
  const id = identificarPorTexto(txt('VISTORIA GD 555555555'), TODOS);
  assert.equal(id.tipo, 'inativo');
});

test('protocolo só com texto não identifica por número', () => {
  const id = identificarPorTexto(txt('aguardando protocolo'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('documento: NT e UC trocados de campo pela IA ainda identificam', () => {
  const id = identificarPorDocumento({ nt: '2222222222', uc: '987654321', titular: null }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
});

test('documento: titular extraído identifica quando é único', () => {
  const id = identificarPorDocumento({ nt: null, uc: null, titular: 'José Carlos dos Santos' }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('combinar: texto e documento apontando projetos diferentes é conflito', () => {
  const t = identificarPorTexto(txt('NT 123456789'), TODOS);
  const d = identificarPorDocumento({ nt: '987654321', uc: null, titular: null }, TODOS);
  assert.equal(combinar(t, d).tipo, 'conflito');
});

test('combinar: texto vazio fica com o documento; mesmo projeto fica com o sinal mais forte', () => {
  const nada = identificarPorTexto(txt('Carta'), TODOS);
  const d = identificarPorDocumento({ nt: '123456789', uc: null, titular: null }, TODOS);
  assert.equal(combinar(nada, d).tipo === 'achado' && (combinar(nada, d) as { projeto: ProjetoEnel }).projeto.codigo, 'PRJ-A');
  const t = identificarPorTexto(txt('', 'instalação 1111111111'), TODOS);
  const r = combinar(t, d);
  assert.equal(r.tipo === 'achado' && r.por, 'protocolo');
});

test('arquivo com o número de OUTRO projeto (ativo ou não) não vai para este card', () => {
  assert.equal(nomeTrazOutroProjeto('CARTA_987654321.pdf', A, TODOS), true);
  assert.equal(nomeTrazOutroProjeto('CARTA_555555555.pdf', A, TODOS), true); // concluído também barra
  assert.equal(nomeTrazOutroProjeto('CARTA_123456789.pdf', A, TODOS), false);
  assert.equal(nomeTrazOutroProjeto('parecer.pdf', A, TODOS), false);
  assert.equal(nomeTrazOutroProjeto('nota_de_servico_400012345678.pdf', A, TODOS), false); // número de ninguém
});

test('referência do projeto: protocolo numérico, senão UC, senão o código', () => {
  assert.equal(referenciaDoProjeto(A), '123456789');
  assert.equal(referenciaDoProjeto(C), 'UC 3333333333');
  assert.equal(referenciaDoProjeto(P({ codigo: 'PRJ-Z' })), 'PRJ-Z');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd worker/ludmilla && npm test`
Expected: FAIL — `Cannot find module '../src/email/enel/identificar.js'`.

- [ ] **Step 3: Implementar**

```ts
// worker/ludmilla/src/email/enel/identificar.ts
import { casaTitular, comparavelTitular, semAcento } from '../util.js';

/**
 * De qual projeto é este e-mail da ENEL?
 *
 * PRINCÍPIO (spec §6.1): a robô procura os NOSSOS números dentro do e-mail —
 * nunca trata um número qualquer do e-mail como protocolo. As respostas da ENEL
 * trazem NT (9 dígitos), instalação (10), nota de serviço (12), protocolo de
 * contato (10) e número SF; o protocolo de contato tem o MESMO tamanho da UC.
 * Só casa o número que for exatamente o de um projeto nosso, como número inteiro.
 *
 * Puro: sem banco, sem rede.
 */

export interface ProjetoEnel {
  project_id: string;
  company_id: string;
  codigo: string;
  protocolo: string | null;
  uc: string | null;
  titular: string | null;
  status: string;
  /** false = concluído/arquivado: o número RECONHECE o e-mail, mas nada vai para o card */
  ativo: boolean;
}

export type Sinal = 'protocolo' | 'uc' | 'titular';

export type Identificacao =
  | { tipo: 'achado'; projeto: ProjetoEnel; por: Sinal }
  | { tipo: 'inativo'; projeto: ProjetoEnel; por: Sinal }
  | { tipo: 'conflito'; motivo: string; codigos: string[] }
  | { tipo: 'nenhum' };

/** A NT tem 9 dígitos; nada menor é aceito como identificador (data tem 8, CEP tem 8). */
export const MIN_DIGITOS = 9;

/** As sequências de dígitos com 9+ dígitos, sem zero à esquerda. */
export function numerosDoTexto(texto: string | null | undefined): Set<string> {
  const s = new Set<string>();
  for (const bruto of (texto ?? '').match(/\d+/g) ?? []) {
    const n = bruto.replace(/^0+/, '');
    if (n.length >= MIN_DIGITOS) s.add(n);
  }
  return s;
}

const algumEm = (a: Set<string>, b: Set<string>): boolean => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

/** Sufixo de empresa no fim do nome não é sobrenome. */
const SUFIXOS_PJ = new Set(['LTDA', 'EPP', 'EIRELI', 'MEI']);

function nomesDe(titular: string): string[] {
  const p = semAcento(titular).toUpperCase().split(/[^A-Z]+/).filter(x => x.length > 2);
  while (p.length > 2 && SUFIXOS_PJ.has(p[p.length - 1])) p.pop();
  return p;
}

/**
 * O assunto cita o titular? Duas formas, ambas estritas:
 *  - o nome inteiro, aceitando palavras curtas no meio ("OSSEL LOCACAO DE SALAS…");
 *  - primeiro e último nome a até 24 caracteres (pessoa com nome do meio abreviado).
 * Nome de uma palavra só não identifica ninguém.
 */
export function titularNoAssunto(assunto: string, titular: string): boolean {
  const nomes = nomesDe(titular);
  if (nomes.length < 2) return false;
  const t = ` ${semAcento(assunto).toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  const completo = new RegExp(`\\b${nomes.join('(?: [A-Z0-9]{1,2})* ')}\\b`);
  if (completo.test(t)) return true;
  const janela = new RegExp(`\\b${nomes[0]}\\b.{0,24}?\\b${nomes[nomes.length - 1]}\\b`);
  return janela.test(t);
}

function decidir(porProtocolo: ProjetoEnel[], porUc: ProjetoEnel[], porTitular: ProjetoEnel[]): Identificacao {
  const fortes = new Map<string, ProjetoEnel>();
  for (const p of [...porProtocolo, ...porUc]) fortes.set(p.project_id, p);

  if (fortes.size > 1) {
    const codigos = [...fortes.values()].map(p => p.codigo);
    return { tipo: 'conflito', motivo: `o e-mail traz números de mais de um projeto (${codigos.join(', ')})`, codigos };
  }
  if (fortes.size === 1) {
    const f = [...fortes.values()][0];
    if (porTitular.length > 0 && !porTitular.some(p => p.project_id === f.project_id)) {
      const outros = porTitular.map(p => p.codigo);
      return {
        tipo: 'conflito',
        motivo: `o número é do projeto ${f.codigo}, mas o nome é do titular de outro (${outros.join(', ')})`,
        codigos: [f.codigo, ...outros],
      };
    }
    const por: Sinal = porProtocolo.some(p => p.project_id === f.project_id) ? 'protocolo' : 'uc';
    return f.ativo ? { tipo: 'achado', projeto: f, por } : { tipo: 'inativo', projeto: f, por };
  }

  // Só o nome: decisão do usuário — identifica só se for ÚNICO entre os ATIVOS.
  const ativos = porTitular.filter(p => p.ativo);
  if (ativos.length === 1) return { tipo: 'achado', projeto: ativos[0], por: 'titular' };
  if (ativos.length > 1) {
    const codigos = ativos.map(p => p.codigo);
    return { tipo: 'conflito', motivo: `o nome casa com o titular de mais de um projeto (${codigos.join(', ')})`, codigos };
  }
  return { tipo: 'nenhum' };
}

/**
 * Pelo texto, sem IA. Números: assunto + corpo. Nome: SÓ o assunto — o corpo traz
 * a assinatura de funcionário da ENEL, e um cliente homônimo casaria com ela.
 */
export function identificarPorTexto(m: { assunto: string; corpo: string }, projetos: ProjetoEnel[]): Identificacao {
  const nums = numerosDoTexto(`${m.assunto ?? ''}\n${m.corpo ?? ''}`);
  const porProtocolo = projetos.filter(p => algumEm(numerosDoTexto(p.protocolo), nums));
  const porUc = projetos.filter(p => algumEm(numerosDoTexto(p.uc), nums));
  const porTitular = projetos.filter(p => p.titular !== null && titularNoAssunto(m.assunto ?? '', p.titular));
  return decidir(porProtocolo, porUc, porTitular);
}

/**
 * Pelo que a IA extraiu do PDF. A IA às vezes troca NT e UC de campo: os dois
 * números do documento valem contra os dois identificadores do projeto.
 */
export function identificarPorDocumento(
  doc: { nt: string | null; uc: string | null; titular: string | null }, projetos: ProjetoEnel[],
): Identificacao {
  const nums = new Set([...numerosDoTexto(doc.nt), ...numerosDoTexto(doc.uc)]);
  const porProtocolo = projetos.filter(p => algumEm(numerosDoTexto(p.protocolo), nums));
  const porUc = projetos.filter(p => algumEm(numerosDoTexto(p.uc), nums));
  const titular = doc.titular;
  const porTitular = titular && comparavelTitular(titular)
    ? projetos.filter(p => p.titular !== null && comparavelTitular(p.titular) && casaTitular(p.titular, titular))
    : [];
  return decidir(porProtocolo, porUc, porTitular);
}

const FORCA: Record<Sinal, number> = { protocolo: 3, uc: 2, titular: 1 };

/** Texto e documento juntos: discordando, é conflito; concordando, fica o sinal mais forte. */
export function combinar(texto: Identificacao, documento: Identificacao): Identificacao {
  if (texto.tipo === 'conflito') return texto;
  if (documento.tipo === 'conflito') return documento;
  if (texto.tipo === 'nenhum') return documento;
  if (documento.tipo === 'nenhum') return texto;
  if (texto.projeto.project_id !== documento.projeto.project_id) {
    const codigos = [texto.projeto.codigo, documento.projeto.codigo];
    return {
      tipo: 'conflito',
      motivo: `o texto do e-mail aponta para o projeto ${codigos[0]} e o documento para o ${codigos[1]}`,
      codigos,
    };
  }
  return FORCA[texto.por] >= FORCA[documento.por] ? texto : documento;
}

/**
 * O nome do arquivo traz o número (protocolo ou UC) de OUTRO projeto — ativo ou
 * não? Então não vai para este card. É o "procurar os nossos números" aplicado ao
 * nome do arquivo: número que não é de projeto nenhum (nota de serviço, protocolo
 * de contato) não barra.
 */
export function nomeTrazOutroProjeto(nome: string, projeto: ProjetoEnel, projetos: ProjetoEnel[]): boolean {
  const nums = numerosDoTexto(nome);
  if (nums.size === 0) return false;
  return projetos.some(p => p.project_id !== projeto.project_id
    && (algumEm(numerosDoTexto(p.protocolo), nums) || algumEm(numerosDoTexto(p.uc), nums)));
}

/**
 * Como o projeto aparece no cartão e na chave do anexo. Estável por projeto:
 * protocolo numérico; sem ele (14 dos 34 em 13/10), a UC; sem ela, o código.
 */
export function referenciaDoProjeto(p: ProjetoEnel): string {
  const prot = [...numerosDoTexto(p.protocolo)][0];
  if (prot) return prot;
  const uc = [...numerosDoTexto(p.uc)][0];
  if (uc) return `UC ${uc}`;
  return p.codigo;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd worker/ludmilla && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: `tsc` sem saída; `fail 0`.

- [ ] **Step 5: Mutação**

Aplique uma de cada vez, rode `npm test`, anote quantos testes caem, e **desfaça conferindo que o arquivo voltou byte a byte**:
1. `MIN_DIGITOS = 8`
2. em `decidir`, apagar o `if` do conflito número×nome
3. `const ativos = porTitular` (sem filtrar ativos)
4. em `identificarPorTexto`, `titularNoAssunto(`${m.assunto}\n${m.corpo}`, …)` (nome no corpo)
5. em `combinar`, trocar a comparação de `project_id` por `true`
6. em `nomeTrazOutroProjeto`, filtrar só `p.ativo`
7. em `decidir`, devolver `achado` também para projeto inativo

Toda mutação tem de derrubar ao menos um teste. Mutação que sobrevive = teste que falta: escreva o teste e repita.

- [ ] **Step 6: Commit**

```bash
git add worker/ludmilla/src/email/enel/identificar.ts worker/ludmilla/test/enel-identificar.test.ts
git commit -F <arquivo-da-mensagem>
```
Título: `feat(ludmilla): identificar de qual projeto e um e-mail da ENEL`

---

### Task 3: O que o corpo diz (módulo puro)

**Files:**
- Create: `worker/ludmilla/src/email/enel/classificar.ts`
- Test: `worker/ludmilla/test/enel-classificar.test.ts`

**Interfaces:**
- Consumes: `semAcento` de `../util.js`
- Produces:
  - `type Classificacao = { tipo: 'resultado_vistoria'; aprovada: boolean } | { tipo: 'troca_relogio'; estado: 'agendada'; prazoDias: number | null } | { tipo: 'troca_relogio'; estado: 'nao_executada'; motivo: string | null } | null`
  - `semCitacao(corpo: string): string`
  - `classificarCorpo(corpo: string | null | undefined): Classificacao`

As frases vêm de e-mails reais da ENEL (spec §8). Sem IA: é determinístico e de graça.

- [ ] **Step 1: Escrever os testes**

```ts
// worker/ludmilla/test/enel-classificar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarCorpo, semCitacao } from '../src/email/enel/classificar.js';

const VISTORIA_OK = 'INTERNAL Prezado(a) Senhor(a), Informamos que após realização da vistoria através de relatorio fotográfico, a vistoria do sistema de microgeração fotovoltaica está APROVADA. Importante: Quaisquer itens não visíveis…';
const TROCA_AGENDADA = 'Prezado Luiz, boa tarde! Nota de serviço criada 400012345678 , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Protocolo: 9876543210 . Atenciosamente';
const TROCA_FALHOU = 'Prezado(a), bom dia! Identificamos pelo registro em sistema que a tentativa de troca do medidor no dia 15/09 , não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução. Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. -------------- Mensagem original -------------- De: Equipe [equipe@exemplo.com] Assunto: TROCA DE RELOGIO Prezado, nota de serviço criada 400099999999 para a troca do medidor';

test('vistoria aprovada no corpo', () => {
  assert.deepEqual(classificarCorpo(VISTORIA_OK), { tipo: 'resultado_vistoria', aprovada: true });
});

test('vistoria reprovada no corpo', () => {
  assert.deepEqual(classificarCorpo('Informamos que a vistoria do sistema de microgeração está REPROVADA pelos motivos abaixo'),
    { tipo: 'resultado_vistoria', aprovada: false });
});

test('troca agendada, com o prazo', () => {
  assert.deepEqual(classificarCorpo(TROCA_AGENDADA), { tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 });
});

test('troca agendada na outra redação ("o prazo para execução é de até")', () => {
  const r = classificarCorpo('informamos que a nota de serviço 400012345678 , referente a instalação: 2222222222 , para a troca do medidor bidirecional, foi criada em 01/10/2026 , o prazo para execução é de até 10 dias úteis.');
  assert.deepEqual(r, { tipo: 'troca_relogio', estado: 'agendada', prazoDias: 10 });
});

test('troca que FALHOU vence o "nota de serviço" da mesma mensagem, e traz o motivo', () => {
  const r = classificarCorpo(TROCA_FALHOU);
  assert.equal(r?.tipo, 'troca_relogio');
  assert.equal(r && r.tipo === 'troca_relogio' && r.estado, 'nao_executada');
  assert.match((r as { motivo: string }).motivo, /cliente nao permitiu/);
});

test('a citação não conta: só a parte nova da mensagem', () => {
  const corpo = 'Prezado, segue. -------------- Mensagem original -------------- A vistoria do sistema está APROVADA.';
  assert.equal(classificarCorpo(corpo), null);
  assert.equal(semCitacao('Novo. Em qua., 10 de set. de 2026 às 10:00, Canal GD <canalgd.sp@br.enel.com> escreveu: velho'), 'Novo. ');
});

test('pedido NOSSO citado ("foi aprovada na etapa de vistoria") não vira resultado', () => {
  const corpo = 'Nota de serviço criada 400012345678 para a troca do medidor bidirecional. -------------- Mensagem original -------------- A NT 123456789 foi aprovada na etapa de vistoria.';
  assert.equal(classificarCorpo(corpo)?.tipo, 'troca_relogio');
});

test('resposta automática e corpo vazio não classificam', () => {
  assert.equal(classificarCorpo('Olá, Informamos que seu e-mail foi recebido com sucesso, gerando o número de atendimento SF0123456789'), null);
  assert.equal(classificarCorpo(''), null);
  assert.equal(classificarCorpo(null), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd worker/ludmilla && npm test` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// worker/ludmilla/src/email/enel/classificar.ts
import { semAcento } from '../util.js';

/**
 * O que o CORPO de um e-mail da ENEL diz — por texto, sem IA. As frases vêm de
 * e-mails reais (spec §8):
 *  · tecnico.*: "a vistoria do sistema de microgeração fotovoltaica está APROVADA"
 *  · canalgd:   "Nota de serviço criada … para a troca do medidor bidirecional,
 *               com o prazo de execução de até N dias úteis"
 *  · canalgd:   "a tentativa de troca do medidor no dia … não foi executada pelo
 *               seguinte motivo: …"
 * Só vale a parte NOVA da mensagem: a citação traz o histórico (inclusive o
 * nosso pedido, "a NT … foi aprovada na etapa de vistoria").
 */

export type Classificacao =
  | { tipo: 'resultado_vistoria'; aprovada: boolean }
  | { tipo: 'troca_relogio'; estado: 'agendada'; prazoDias: number | null }
  | { tipo: 'troca_relogio'; estado: 'nao_executada'; motivo: string | null }
  | null;

const MARCAS_DE_CITACAO = [
  /-{5,}\s*Mensagem original/i,
  /\bEm [^\n]{0,160}escreveu:/i,
  /^\s*De:\s/im,
  /^\s*From:\s/im,
  /^>/m,
];

/** Corta no começo da primeira citação. */
export function semCitacao(corpo: string): string {
  let fim = corpo.length;
  for (const re of MARCAS_DE_CITACAO) {
    const m = re.exec(corpo);
    if (m && m.index < fim) fim = m.index;
  }
  return corpo.slice(0, fim);
}

const normalizar = (s: string): string => semAcento(s).toLowerCase().replace(/\s+/g, ' ');

export function classificarCorpo(corpo: string | null | undefined): Classificacao {
  const t = normalizar(semCitacao(corpo ?? ''));
  if (!t.trim()) return null;

  // A falha vem antes: a resposta de falha também fala em "nota de serviço".
  if (/tentativa de troca do medidor[^.]{0,80}nao foi executada/.test(t)) {
    const m = /pelo seguinte motivo:\s*([^.]{3,120})/.exec(t);
    return { tipo: 'troca_relogio', estado: 'nao_executada', motivo: m ? m[1].trim() : null };
  }
  if (/nota de servico[^.]{0,160}troca do medidor/.test(t)) {
    const m = /prazo (?:de|para) execucao (?:e )?de ate (\d+) dias/.exec(t);
    return { tipo: 'troca_relogio', estado: 'agendada', prazoDias: m ? Number(m[1]) : null };
  }
  const v = /vistoria[^.]{0,160}?\b(?:esta|foi)\s+(aprovad[ao]|reprovad[ao])/.exec(t);
  if (v) return { tipo: 'resultado_vistoria', aprovada: v[1].startsWith('aprovad') };
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsc --noEmit -p tsconfig.json && npm test`, `fail 0`.

- [ ] **Step 5: Mutação** (uma de cada vez, conferindo o retorno byte a byte):
1. `classificarCorpo` usar `corpo` em vez de `semCitacao(corpo)`
2. inverter a ordem: testar "nota de serviço" antes da falha
3. `aprovada: true` fixo
4. remover a marca `/-{5,}\s*Mensagem original/i`

Cada uma tem de derrubar teste.

- [ ] **Step 6: Commit** — título: `feat(ludmilla): ler pelo texto o que a ENEL diz sobre vistoria e troca do relogio`

---

### Task 4: `ludmilla-parecer` ganha o modo ENEL (aditivo)

**Files:**
- Modify: `supabase/functions/ludmilla-parecer/index.ts`
- Test: `worker/ludmilla/test/parecer-enel.test.ts` (mesma técnica de `test/parecer-marcadores.test.ts`: carregar o ARQUIVO REAL transpilado, com `Deno`, `createClient` e `fetch` de mentira — **leia aquele teste antes**)

**Interfaces:**
- Consumes: o contrato atual `{ ok, veredito, resumo, pendencias, titular, endereco }`
- Produces: corpo de entrada aceita `concessionaria?: string`; **toda** resposta passa a trazer também `tipo: string | null`, `nt: string | null`, `uc: string | null`. Sem `concessionaria` (EDP), os três são `null` e **o prompt é exatamente o de hoje**.

- [ ] **Step 1: Escrever os testes** em `worker/ludmilla/test/parecer-enel.test.ts`, carregando a função real, que provem:
  1. com `concessionaria: 'enel'`, o texto enviado à Anthropic (capture o `body` do `fetch` falso) contém `Nota Técnica`; sem `concessionaria`, **não** contém (e o prompt da EDP é o de antes — afirme que contém o trecho que ele já tem hoje, `Protocolo/nota esperado`);
  2. a IA respondendo `{"tipo":"carta_projeto","veredito":"favoravel","nt":"NT 123.456.789","uc":"1111111111","titular":"Maria Aparecida Silva", …}` sai com `tipo: 'carta_projeto'`, `nt: '123456789'`, `uc: '1111111111'`;
  3. `nt: "número da nota técnica ou null"` (eco do formato) sai `null`; `nt: "12345"` (curto) sai `null`;
  4. `tipo: "Carta Projeto"` fora da lista branca sai `'outro'` no modo ENEL;
  5. sem `concessionaria`, a resposta traz `tipo: null, nt: null, uc: null` e os seis campos de sempre iguais aos de hoje.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar**, mudando só isto:

```ts
// tipos do documento no modo ENEL (lista branca)
const TIPOS_ENEL = ['carta_projeto', 'resultado_vistoria', 'troca_relogio', 'outro']

/** Número do documento: só dígitos, 9+ (a NT tem 9). Eco do prompt vira null. */
const numeroOuNulo = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const d = v.replace(/\D/g, '').replace(/^0+/, '')
  return d.length >= 9 ? d : null
}

const PROMPT_ENEL = [
  'Você lê um documento da ENEL Distribuição São Paulo sobre um projeto de micro ou minigeração distribuída (energia solar).',
  'Responda SOMENTE com um objeto JSON, sem texto antes ou depois, neste formato:',
  '{"tipo":"carta_projeto|resultado_vistoria|troca_relogio|outro","veredito":"favoravel|pendencia|inconclusivo","resumo":"uma frase em português","pendencias":["..."],"titular":"nome do titular ou null","endereco":"logradouro e número ou null","nt":"número da Nota Técnica ou null","uc":"número da instalação ou null"}',
  'Regras:',
  '- "carta_projeto": carta de resposta ao projeto (aprovação, reprovação ou exigências).',
  '- "resultado_vistoria": resultado da vistoria (relatório fotográfico ou vídeo de anti-ilhamento).',
  '- "troca_relogio": troca do medidor (relógio).',
  '- "favoravel": aprovado. "pendencia": reprovado ou com exigência a cumprir. "inconclusivo": não dá para dizer.',
  '- "nt": o número da Nota Técnica (NT) do projeto, só dígitos. NÃO confunda com protocolo de atendimento, nota de serviço ou número SF.',
  '- "uc": o número da instalação (unidade consumidora), só dígitos.',
  '- Use null quando o documento não trouxer a informação. Não invente.',
].join('\n')
```

  - `body` passa a aceitar `concessionaria?: string`; `const modoEnel = body?.concessionaria === 'enel'`.
  - O prompt enviado é `PROMPT_ENEL` quando `modoEnel`; senão, o de hoje, **intocado**.
  - Os helpers de resposta (`inconclusivo`, `falhaDaIA`) e o caminho de sucesso passam a incluir `tipo`, `nt`, `uc`: no modo ENEL, `tipo` normalizado (`normalizar` já existe) e filtrado por `TIPOS_ENEL` com padrão `'outro'`, `nt`/`uc` por `numeroOuNulo`; fora do modo ENEL, os três `null`.
  - Portão, extrato de IA, `AbortController`, filtros de titular/endereço/resumo: **nada muda**.

- [ ] **Step 4: Rodar** `npm test` no worker (`fail 0`), e confira que `test/parecer-marcadores.test.ts` segue passando **sem alteração**.

- [ ] **Step 5: Publicar e provar o portão**

Run: `npx -y supabase functions deploy ludmilla-parecer --project-ref yqsqrdndvsnhbsoaoilf --no-verify-jwt --use-api`
(O `--use-api` é porque o Docker não roda nesta máquina.) Depois, sem credencial, uma chamada tem de dar **401** — mostre só o status.

- [ ] **Step 6: Commit** — título: `feat(ludmilla-parecer): modo ENEL que devolve tipo, NT e UC do documento`

---

### Task 5: Caixa e fila — buscar por remetente e falar com as RPCs novas

**Files:**
- Modify: `worker/ludmilla/src/email/caixa.ts`
- Modify: `worker/ludmilla/src/fila.ts`
- Test: `worker/ludmilla/test/email-caixa.test.ts` (acrescentar)

**Interfaces:**
- Consumes: RPCs da Task 1; `ProjetoEnel` da Task 2
- Produces:
  - `Caixa.procurarDe(remetente: string, desde: Date): Promise<number[]>`
  - `uidsDaBuscaPorRemetente(resultado: number[] | false | undefined, remetente: string): number[]` (pura, exportada de `caixa.ts`)
  - `contaDoEmail(accountId: string): Promise<{ identificacao: 'protocolo_no_assunto' | 'remetente'; ultimaVarreduraEm: string | null }>`
  - `projetosDoEmail(accountId: string): Promise<ProjetoEnel[]>`
  - `interface AvisoEmail { accountId: string; messageId: string; protocolo: string; projectId: string | null; titulo: string; mensagem: string }` e `avisarEquipe(p: AvisoEmail): Promise<number>`
  - `EmailLido` ganha `referencia?: string | null; casamento?: 'protocolo' | 'uc' | 'titular'; abrirCartao?: boolean`

- [ ] **Step 1: Teste da função pura nova**

```ts
// acrescentar em worker/ludmilla/test/email-caixa.test.ts
import { uidsDaBuscaPorRemetente } from '../src/email/caixa.js';

test('busca por remetente: lista vira lista; falha do servidor LANÇA, nunca vira "não achei"', () => {
  assert.deepEqual(uidsDaBuscaPorRemetente([3, 7], 'nao.responda@enel.com'), [3, 7]);
  assert.throws(() => uidsDaBuscaPorRemetente(false, 'nao.responda@enel.com'), /busca na caixa de e-mail falhou/);
  assert.throws(() => uidsDaBuscaPorRemetente(undefined, 'nao.responda@enel.com'));
});
```

- [ ] **Step 2: Ver falhar.**

- [ ] **Step 3: Implementar em `caixa.ts`**

```ts
export function uidsDaBuscaPorRemetente(resultado: number[] | false | undefined, remetente: string): number[] {
  if (Array.isArray(resultado)) return resultado;
  throw new Error(`A busca na caixa de e-mail falhou (remetente ${remetente}): o servidor não devolveu a lista de mensagens.`);
}
```

Na interface `Caixa`:
```ts
  /** uids das mensagens DESTE remetente desde a data (granularidade de dia do IMAP). */
  procurarDe(remetente: string, desde: Date): Promise<number[]>;
```

No objeto devolvido por `abrirCaixa`:
```ts
    async procurarDe(remetente: string, desde: Date): Promise<number[]> {
      verificarConexao();
      // Sem try/catch: busca que falhou NÃO pode virar "não achei".
      return uidsDaBuscaPorRemetente(await client.search({ from: remetente, since: desde }, { uid: true }), remetente);
    },
```
`procurar`, `envelopes`, `baixar`, `naoLidas`, `fechar`, o ouvinte de `'error'` e o `readOnly`: **nada muda**.

- [ ] **Step 4: Implementar em `fila.ts`** (no bloco de e-mail, sem `nomeRpc`, como as irmãs)

```ts
import type { ProjetoEnel } from './email/enel/identificar.js';

export async function contaDoEmail(accountId: string): Promise<{
  identificacao: 'protocolo_no_assunto' | 'remetente'; ultimaVarreduraEm: string | null;
}> {
  const { data, error } = await supabase().rpc('ludmilla_email_conta' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui ler a configuração da conta: ${error.message}`);
  const l = ((data ?? []) as { identificacao: string; ultima_varredura_em: string | null }[])[0];
  if (!l) throw new Error('A conta de e-mail não foi encontrada.');
  return {
    identificacao: l.identificacao === 'remetente' ? 'remetente' : 'protocolo_no_assunto',
    ultimaVarreduraEm: l.ultima_varredura_em,
  };
}

export async function projetosDoEmail(accountId: string): Promise<ProjetoEnel[]> {
  const { data, error } = await supabase().rpc('ludmilla_email_projetos' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui listar os projetos da concessionária: ${error.message}`);
  return (data ?? []) as ProjetoEnel[];
}

export interface AvisoEmail {
  accountId: string; messageId: string; protocolo: string; projectId: string | null;
  titulo: string; mensagem: string;
}

/** Toca o sino de admin + staff. Uma vez por mensagem: a retentativa devolve 0. */
export async function avisarEquipe(p: AvisoEmail): Promise<number> {
  const { data, error } = await supabase().rpc('ludmilla_email_avisar' as never, {
    p_account_id: p.accountId, p_message_id: p.messageId, p_protocolo: p.protocolo,
    p_project_id: p.projectId, p_titulo: p.titulo, p_mensagem: p.mensagem,
  } as never);
  if (error) throw new Error(`Não consegui avisar a equipe: ${error.message}`);
  return Number(data ?? 0);
}
```

Em `EmailLido`, acrescente:
```ts
  /** ENEL: como o projeto aparece no cartão. A EDP não manda (vale o protocolo). */
  referencia?: string | null;
  /** ENEL: por qual sinal o projeto foi achado. A EDP não manda (vale 'protocolo'). */
  casamento?: 'protocolo' | 'uc' | 'titular';
  /** false = registra a mensagem sem abrir cartão (só anota). Padrão do banco: true. */
  abrirCartao?: boolean;
```
Em `registrarEmailLido`, acrescente ao objeto do `rpc`: `p_referencia: p.referencia, p_casamento: p.casamento, p_abrir_cartao: p.abrirCartao`. Quando ficam `undefined`, o `JSON.stringify` do supabase-js os omite e o banco usa o `DEFAULT` — **a chamada da EDP não muda de payload**. Prove isso num teste: chamando `registrarEmailLido` com um `supabase()` falso (ou inspecionando o objeto que seria serializado) sem os três campos, o JSON não contém `p_referencia`.

- [ ] **Step 5: Rodar** `npx tsc --noEmit -p tsconfig.json && npm test` (`fail 0`).

- [ ] **Step 6: Commit** — título: `feat(ludmilla): buscar na caixa por remetente e falar com as RPCs da ENEL`

---

### Task 6: As decisões da ENEL (puro) e o run

**Files:**
- Create: `worker/ludmilla/src/email/enel/decidir.ts`
- Create: `worker/ludmilla/src/email/enel/run.ts`
- Create: `worker/ludmilla/src/email/rotear.ts`
- Modify: `worker/ludmilla/src/index.ts` (só o import e a chamada no ramo `varredura_email`, linhas 9 e 299)
- Test: `worker/ludmilla/test/enel-decidir.test.ts`, `worker/ludmilla/test/enel-run.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4 (contrato), 5; de `../util.js`: `casaTitular`, `comparavelTitular`, `destinoNoBucket`, `ehImagem`, `ocorrenciasPorNome`, `pdfDoParecer`, `regraQueCasa`, `RegraEmail`, `Veredito`; de `../caixa.js`: `abrirCaixa`, `Caixa`, `EnvelopeLido`, `MensagemLida`; de `../../fila.js`: `abrirTentativaEmail`, `anexoDeEmail`, `anexoEnviado`, `anexoErro`, `avisarEquipe`, `credencialDaCaixa`, `finalizarRun`, `mensagemPendente`, `projetosDoEmail`, `registrarEmailLido`, `regrasDoEmail`, `subirDocumento`, `Run`; de `../../erros.js`: `classificarErroEmail`, `razaoDeFalhaDeArquivo`
- Produces: `executarAcompanhamentoEmail(run: Run): Promise<void>` (roteador), `executarVarreduraEnel(run: Run, ultimaVarreduraEm: string | null): Promise<void>`, `tratarMensagemEnel(...)`

- [ ] **Step 1: Testes das decisões puras** — `worker/ludmilla/test/enel-decidir.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisosEnel, janelaDeBusca, precisaLerPdf, recomendacaoCabe, recomendacaoEnel, remetentesParaBuscar,
} from '../src/email/enel/decidir.js';
import type { RegraEmail } from '../src/email/util.js';

const R = (o: Partial<RegraEmail>): RegraEmail => ({ id: 'r', remetente: 'x@enel.com', assunto: '', tipo_documento: 'outro', anexar: true, ler_pdf: true, ...o });
const ACHADO = { tipo: 'achado' as const, projeto: { codigo: 'PRJ-A' } as never, por: 'protocolo' as const };
const NENHUM = { tipo: 'nenhum' as const };

test('Carta: lê o PDF mesmo com o projeto achado no texto (precisa do veredito)', () => {
  assert.equal(precisaLerPdf(R({ tipo_documento: 'carta_projeto' }), ACHADO, null, true), true);
});
test('vistoria resolvida pelo corpo: NÃO paga IA', () => {
  assert.equal(precisaLerPdf(R({ tipo_documento: 'resultado_vistoria' }), ACHADO, { tipo: 'resultado_vistoria', aprovada: true }, true), false);
});
test('texto não identificou: lê o PDF para descobrir o projeto', () => {
  assert.equal(precisaLerPdf(R({ tipo_documento: 'troca_relogio' }), NENHUM, null, true), true);
});
test('conflito ou projeto inativo no texto: não paga IA (ler não resolve)', () => {
  assert.equal(precisaLerPdf(R({}), { tipo: 'conflito', motivo: '', codigos: [] }, null, true), false);
  assert.equal(precisaLerPdf(R({}), { tipo: 'inativo', projeto: {} as never, por: 'uc' }, null, true), false);
});
test('regra que não lê PDF, ou e-mail sem PDF: nunca lê', () => {
  assert.equal(precisaLerPdf(R({ ler_pdf: false }), NENHUM, null, true), false);
  assert.equal(precisaLerPdf(R({}), NENHUM, null, false), false);
});

test('mapa de etapas (spec §8)', () => {
  const ok = { ok: true, tipo: null, veredito: null };
  assert.equal(recomendacaoEnel(null, { ok: true, tipo: 'carta_projeto', veredito: 'favoravel' }), 'approved');
  assert.equal(recomendacaoEnel(null, { ok: true, tipo: 'carta_projeto', veredito: 'pendencia' }), 'pendencia');
  assert.equal(recomendacaoEnel({ tipo: 'resultado_vistoria', aprovada: false }, ok), 'vistoria_reprovada');
  assert.equal(recomendacaoEnel({ tipo: 'resultado_vistoria', aprovada: true }, ok), null);
  assert.equal(recomendacaoEnel({ tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 }, ok), null);
  assert.equal(recomendacaoEnel(null, { ok: false, tipo: 'carta_projeto', veredito: 'favoravel' }), null);
  assert.equal(recomendacaoEnel(null, { ok: true, tipo: 'resultado_vistoria', veredito: 'pendencia' }), 'vistoria_reprovada');
});

test('não sugere etapa para trás nem a mesma', () => {
  assert.equal(recomendacaoCabe('approved', 'analysis'), true);
  assert.equal(recomendacaoCabe('approved', 'vistoria_solicitada'), false);
  assert.equal(recomendacaoCabe('approved', 'approved'), false);
  assert.equal(recomendacaoCabe('pendencia', 'approved'), false);
  assert.equal(recomendacaoCabe('vistoria_reprovada', 'vistoria_solicitada'), true);
  assert.equal(recomendacaoCabe('vistoria_reprovada', 'analysis'), false);
});

test('avisos: vídeo aprovado, troca que falhou, e-mail devolvido', () => {
  const p = { codigo: 'PRJ-A' };
  assert.equal(avisosEnel('resultado_vistoria', { tipo: 'resultado_vistoria', aprovada: true }, null, p).length, 1);
  assert.match(avisosEnel('troca_relogio', { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'cliente nao permitiu execucao' }, null, p)[0].mensagem, /cliente nao permitiu/);
  assert.equal(avisosEnel('devolucao', null, null, null).length, 1);
  assert.equal(avisosEnel('troca_relogio', { tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 }, null, p).length, 0);
  assert.equal(avisosEnel('carta_projeto', null, { ok: true, tipo: 'resultado_vistoria', veredito: 'favoravel' }, p).length, 1);
});

test('janela: 30 dias na primeira leitura; depois desde a última menos 2 dias, nunca mais que 30', () => {
  const agora = new Date('2026-10-13T12:00:00Z');
  assert.equal(janelaDeBusca(null, agora).toISOString(), '2026-09-13T12:00:00.000Z');
  assert.equal(janelaDeBusca('2026-10-12T12:00:00Z', agora).toISOString(), '2026-10-10T12:00:00.000Z');
  assert.equal(janelaDeBusca('2026-07-01T00:00:00Z', agora).toISOString(), '2026-09-13T12:00:00.000Z');
});

test('remetentes: os das regras, sem repetir e sem o comunicado', () => {
  const regras = [
    R({ remetente: 'nao.responda@enel.com' }), R({ remetente: 'NAO.RESPONDA@enel.com' }),
    R({ remetente: 'atendimento.edsp@enel.com', tipo_documento: 'comunicado' }), R({ remetente: null }),
  ];
  assert.deepEqual(remetentesParaBuscar(regras), ['nao.responda@enel.com']);
});
```

- [ ] **Step 2: Ver falhar.**

- [ ] **Step 3: Implementar `decidir.ts`**

```ts
// worker/ludmilla/src/email/enel/decidir.ts
import type { RegraEmail, Veredito } from '../util.js';
import type { Classificacao } from './classificar.js';
import type { Identificacao } from './identificar.js';

/** O que interessa da leitura do PDF para decidir. */
export interface LeituraParaDecidir { ok: boolean; tipo: string | null; veredito: Veredito | null }

/**
 * A IA (US$ ~0,10 por PDF) só é chamada em dois casos (spec §6.3):
 *  1. o texto não identificou o projeto — o PDF pode dizer;
 *  2. a regra espera um veredito e o corpo não trouxe — as Cartas chegam com o
 *     corpo vazio, tudo está no PDF.
 * Conflito ou projeto inativo no texto: ler não resolve, então não paga.
 */
export function precisaLerPdf(regra: RegraEmail, idTexto: Identificacao, c: Classificacao, temPdf: boolean): boolean {
  if (!regra.ler_pdf || !temPdf) return false;
  if (idTexto.tipo === 'conflito' || idTexto.tipo === 'inativo') return false;
  if (idTexto.tipo === 'nenhum') return true;
  const esperaVeredito = regra.tipo_documento === 'carta_projeto' || regra.tipo_documento === 'resultado_vistoria';
  return esperaVeredito && c === null;
}

/** Mapa de etapas (spec §8). O corpo vale antes do PDF; sem leitura ok, não há sugestão do PDF. */
export function recomendacaoEnel(c: Classificacao, p: LeituraParaDecidir): string | null {
  if (c?.tipo === 'resultado_vistoria') return c.aprovada ? null : 'vistoria_reprovada';
  if (c?.tipo === 'troca_relogio') return null;
  if (!p.ok) return null;
  if (p.tipo === 'carta_projeto') {
    if (p.veredito === 'favoravel') return 'approved';
    if (p.veredito === 'pendencia') return 'pendencia';
    return null;
  }
  if (p.tipo === 'resultado_vistoria') return p.veredito === 'pendencia' ? 'vistoria_reprovada' : null;
  return null;
}

const ANTES_DA_APROVACAO = new Set(['pending', 'analysis', 'documentation', 'approval', 'pendencia']);

/**
 * A sugestão cabe na etapa em que o projeto está? A primeira leitura traz 30 dias
 * de e-mails: uma Carta de aprovação de um projeto que já está em vistoria não
 * pode virar sugestão de voltar para Aprovado.
 */
export function recomendacaoCabe(recomendacao: string, statusAtual: string): boolean {
  if (recomendacao === statusAtual) return false;
  if (recomendacao === 'approved' || recomendacao === 'pendencia') return ANTES_DA_APROVACAO.has(statusAtual);
  if (recomendacao === 'vistoria_reprovada') return statusAtual === 'approved' || statusAtual === 'vistoria_solicitada';
  return true;
}

export interface Aviso { titulo: string; mensagem: string }

/** Os três momentos que pedem ação de uma pessoa (spec §10). A robô só lembra. */
export function avisosEnel(
  tipoDaRegra: string, c: Classificacao, p: LeituraParaDecidir | null, projeto: { codigo: string } | null,
): Aviso[] {
  const sobre = projeto ? ` do projeto ${projeto.codigo}` : '';
  if (tipoDaRegra === 'devolucao') {
    return [{ titulo: '📡 Um e-mail para a ENEL voltou', mensagem: `Um e-mail enviado à ENEL${sobre} não foi entregue. Confira e reenvie.` }];
  }
  const videoOk = (c?.tipo === 'resultado_vistoria' && c.aprovada)
    || (c === null && p?.ok && p.tipo === 'resultado_vistoria' && p.veredito === 'favoravel');
  if (videoOk) {
    return [{ titulo: '📡 Vistoria virtual aprovada na ENEL', mensagem: `A ENEL aprovou o vídeo de anti-ilhamento${sobre}. É hora de pedir a troca do relógio.` }];
  }
  if (c?.tipo === 'troca_relogio' && c.estado === 'nao_executada') {
    return [{ titulo: '📡 A ENEL não trocou o relógio', mensagem: `A tentativa de troca do relógio${sobre} não foi executada${c.motivo ? `: ${c.motivo}` : ''}.` }];
  }
  return [];
}

export const JANELA_MAXIMA_DIAS = 30;
const DIA = 86_400_000;

/** 30 dias na primeira leitura; depois, desde a última verificação menos 2 dias — nunca mais que 30. */
export function janelaDeBusca(ultimaVarreduraEm: string | null, agora: Date): Date {
  const limite = new Date(agora.getTime() - JANELA_MAXIMA_DIAS * DIA);
  if (!ultimaVarreduraEm) return limite;
  const desde = new Date(new Date(ultimaVarreduraEm).getTime() - 2 * DIA);
  return desde > limite ? desde : limite;
}

/** Os remetentes a procurar: os das regras, sem repetir, sem o comunicado (que é ignorado sem nem ser buscado). */
export function remetentesParaBuscar(regras: RegraEmail[]): string[] {
  const s = new Set<string>();
  for (const r of regras) {
    if (r.remetente && r.tipo_documento !== 'comunicado') s.add(r.remetente.trim().toLowerCase());
  }
  return [...s];
}
```

- [ ] **Step 4: Rodar** — `fail 0`.

- [ ] **Step 5: Testes do tratamento** — `worker/ludmilla/test/enel-run.test.ts`, com `DepsEnel` falsas que **gravam** o que foi chamado. Casos (cada um afirma chamadas e retorno):

1. **Carta** (`nao.responda`, corpo vazio, `CARTA.pdf`): IA devolve `{ ok: true, tipo: 'carta_projeto', veredito: 'favoravel', nt: '123456789', titular: 'MARIA APARECIDA SILVA' }` para projeto em `analysis` → `abrirTentativa` chamada ANTES de `lerParecer`; 1 anexo subiu; `registrarEmailLido` com `protocolo: ''`, `referencia: '123456789'`, `casamento: 'protocolo'`, `recomendacao: 'approved'`, `abrirCartao: true`, `concluida: true`.
2. **Carta de projeto já em `vistoria_solicitada`** → anexa, `recomendacao: null`, `abrirCartao: false`, ressalva "já está à frente" no `motivo`.
3. **`tecnico.abc` VISTORIA GD com corpo "está APROVADA"** → `lerParecer` **não** chamado; 1 aviso (vistoria virtual aprovada); `recomendacao: null`; o `motivo` traz "vistoria virtual aprovada — falta a troca do relógio".
4. **Troca não executada** (`canalgd`, assunto com a NT) → sem IA; 1 aviso com o motivo.
5. **Troca agendada** → sem IA, sem aviso, `abrirCartao: false`, `motivo` com o prazo.
6. **Sem identificação e sem PDF** → `situacao: 'nao_identificado'`, `concluida: true`, nada anexado, IA não chamada, `projectId: null`.
7. **Sem identificação no texto e a IA falha** (`ok: false`) → `nao_identificado`, `concluida: false`.
8. **Texto aponta A, documento aponta B** → `conflito`, nada anexado, `projectId: null`.
9. **Titular do documento diverge do projeto** → `bloqueado`, nada anexado, `abrirCartao: true`.
10. **Arquivo com a NT de B ao tratar A** → não anexado, `deOutroProjeto: 1`.
11. **`no-reply`** (regra `resposta_automatica`, `anexar: false`, `ler_pdf: false`) com a NT no assunto → `tratado`, sem IA, sem anexo, `abrirCartao: false`.
12. **`postmaster`** (regra `devolucao`) → 1 aviso de devolução.
13. **Comunicado** → `ignorado`, `concluida: true`.
14. **Projeto concluído** (NT de projeto `ativo: false`) → `inativo`, nada anexado.
15. **Privacidade:** capture `console.log`; num caso de bloqueio por titular e num de anexo que falha com a mensagem `Invalid key: …/1760000000000_PARECER_MARIA_APARECIDA_SILVA.pdf`, afirme que `MARIA`, `APARECIDA`, `.pdf` e o assunto **não** aparecem no log — e que aparecem no `motivo` gravado.

- [ ] **Step 6: Ver falhar.**

- [ ] **Step 7: Implementar `run.ts`**

```ts
// worker/ludmilla/src/email/enel/run.ts
import { classificarErroEmail, razaoDeFalhaDeArquivo } from '../../erros.js';
import {
  abrirTentativaEmail, anexoDeEmail, anexoEnviado, anexoErro, avisarEquipe, credencialDaCaixa,
  finalizarRun, mensagemPendente, projetosDoEmail, registrarEmailLido, regrasDoEmail, subirDocumento,
  type Run,
} from '../../fila.js';
import { abrirCaixa, type Caixa, type EnvelopeLido, type MensagemLida } from '../caixa.js';
import {
  casaTitular, comparavelTitular, destinoNoBucket, ehImagem, ocorrenciasPorNome, pdfDoParecer, regraQueCasa,
  type RegraEmail, type Veredito,
} from '../util.js';
import { classificarCorpo, type Classificacao } from './classificar.js';
import {
  avisosEnel, janelaDeBusca, precisaLerPdf, recomendacaoCabe, recomendacaoEnel, remetentesParaBuscar,
} from './decidir.js';
import {
  combinar, identificarPorDocumento, identificarPorTexto, nomeTrazOutroProjeto, referenciaDoProjeto,
  type Identificacao, type ProjetoEnel, type Sinal,
} from './identificar.js';

/**
 * Run `varredura_email` para conta com `identificacao = 'remetente'` (ENEL).
 * Parte do E-MAIL, pelos remetentes; descobre o projeto; anexa; sugere a etapa;
 * toca o sino nos momentos que pedem ação. NUNCA move card, NUNCA envia nada,
 * NUNCA escreve na caixa. Nenhum dado de cliente no log.
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/**
 * A chave da linha da mensagem na ENEL é FIXA: uma linha por e-mail. Antes de
 * identificar não se sabe o projeto, e a tentativa tem de ser contada antes do
 * gasto de IA — com chave fixa, `tentativas` sobe na MESMA linha a cada retentativa
 * e o teto de 5 vale. O projeto vai em `project_id`; o cartão recebe a referência.
 */
export const CHAVE_DA_MENSAGEM_ENEL = '';

export interface ParecerEnel {
  ok: boolean; veredito: Veredito | null; resumo: string;
  titular: string | null; endereco: string | null;
  tipo: string | null; nt: string | null; uc: string | null;
  erro: string | null;
}
const SEM_LEITURA: ParecerEnel = { ok: true, veredito: null, resumo: '', titular: null, endereco: null, tipo: null, nt: null, uc: null, erro: null };
const falha = (erro: string): ParecerEnel => ({ ...SEM_LEITURA, ok: false, erro });
const VEREDITOS: readonly string[] = ['favoravel', 'pendencia', 'inconclusivo'];

/**
 * Igual à leitura da EDP (`email/index.ts`), com `concessionaria: 'enel'`. Fica
 * separada de propósito: o caminho da EDP não é alterado nesta entrega.
 */
async function lerParecerEnel(pdf: Buffer, tenantId: string): Promise<ParecerEnel> {
  const base = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave) return falha('falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no ambiente do robô');
  let r: Response;
  try {
    r = await fetch(`${base}/functions/v1/ludmilla-parecer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${chave}`, apikey: chave },
      body: JSON.stringify({ pdf_base64: pdf.toString('base64'), tenant_id: tenantId, concessionaria: 'enel' }),
    });
  } catch (e) {
    return falha(`não consegui chamar a leitura do documento: ${(e as Error).message}`);
  }
  const c = await r.json().catch(() => null) as Partial<ParecerEnel> & { error?: string } | null;
  if (!c) return falha(`a leitura do documento respondeu ${r.status} sem JSON`);
  if (!r.ok || c.ok === false) return falha(c.error ?? `a leitura do documento respondeu ${r.status}`);
  return {
    ok: true,
    veredito: VEREDITOS.includes(String(c.veredito)) ? c.veredito as Veredito : 'inconclusivo',
    resumo: c.resumo ?? '', titular: c.titular ?? null, endereco: c.endereco ?? null,
    tipo: c.tipo ?? null, nt: c.nt ?? null, uc: c.uc ?? null, erro: null,
  };
}

export interface DepsEnel {
  abrirTentativa: typeof abrirTentativaEmail;
  anexoDeEmail: typeof anexoDeEmail;
  subirDocumento: typeof subirDocumento;
  anexoEnviado: typeof anexoEnviado;
  anexoErro: typeof anexoErro;
  registrarEmailLido: typeof registrarEmailLido;
  avisar: typeof avisarEquipe;
  lerParecer: (pdf: Buffer, tenantId: string) => Promise<ParecerEnel>;
}
export const DEPS_ENEL: DepsEnel = {
  abrirTentativa: abrirTentativaEmail, anexoDeEmail, subirDocumento, anexoEnviado, anexoErro,
  registrarEmailLido, avisar: avisarEquipe, lerParecer: lerParecerEnel,
};

export interface TratamentoEnel {
  situacao: 'tratado' | 'ignorado' | 'nao_identificado' | 'conflito' | 'inativo' | 'bloqueado';
  por: Sinal | null;
  anexados: number; imagensIgnoradas: number; recusados: number; semNome: number; deOutroProjeto: number;
  avisos: number;
  /** false = falha passageira: um run futuro tenta de novo (teto de 5) */
  concluida: boolean;
}

/** Até três nomes; o resto vira "e mais N". Vai para o banco, nunca para o log. */
function nomes(lista: string[]): string {
  const m = lista.slice(0, 3).join(', ');
  return lista.length > 3 ? `${m} e mais ${lista.length - 3}` : m;
}

/** A frase que entra no histórico sobre o que o corpo disse. */
function anotacao(c: Classificacao): string | null {
  if (c?.tipo === 'resultado_vistoria') return c.aprovada
    ? 'vistoria virtual aprovada — falta a troca do relógio'
    : 'vistoria reprovada pela ENEL';
  if (c?.tipo === 'troca_relogio' && c.estado === 'agendada') return `troca do relógio agendada${c.prazoDias ? ` (prazo de até ${c.prazoDias} dias úteis)` : ''}`;
  if (c?.tipo === 'troca_relogio') return `a troca do relógio não foi executada${c.motivo ? `: ${c.motivo}` : ''}`;
  return null;
}

export async function tratarMensagemEnel(
  run: Run, m: MensagemLida, regras: RegraEmail[], projetos: ProjetoEnel[], deps: DepsEnel = DEPS_ENEL,
): Promise<TratamentoEnel> {
  const base = {
    runId: run.id, accountId: run.account_id, messageId: m.messageId, protocolo: CHAVE_DA_MENSAGEM_ENEL,
    assunto: m.assunto, remetente: m.remetente, recebidoEm: m.recebidoEm?.toISOString() ?? null,
  };
  const vazio = { por: null, anexados: 0, imagensIgnoradas: 0, recusados: 0, semNome: m.anexosSemNome, deOutroProjeto: 0, avisos: 0 };

  // Contada ANTES de qualquer gasto (lição da EDP): se o tratamento morrer no
  // meio, a linha já existe com concluida=false e o teto de 5 é real.
  await deps.abrirTentativa({ ...base, projectId: null });

  const regra = regraQueCasa(regras, m.assunto, m.remetente);
  if (!regra || regra.tipo_documento === 'comunicado') {
    await deps.registrarEmailLido({
      ...base, projectId: null, tipoDocumento: regra?.tipo_documento ?? null, veredito: null, resumo: null,
      anexos: 0, recomendacao: null, concluida: true, arquivoLido: null, abrirCartao: false,
      motivo: regra ? 'comunicado enviado a todos: ignorado pela regra' : 'nenhuma regra casa com este assunto/remetente',
    });
    return { ...vazio, situacao: 'ignorado', concluida: true };
  }

  const classificacao = classificarCorpo(m.texto);
  const idTexto = identificarPorTexto({ assunto: m.assunto, corpo: m.texto }, projetos);

  const ocorrencias = ocorrenciasPorNome(m.anexos);
  const todos = m.anexos.map((a, i) => ({ ...a, ocorrencia: ocorrencias[i] }));
  const semImagem = todos.filter(a => !ehImagem(a));
  const imagensIgnoradas = todos.length - semImagem.length;
  const pdf = pdfDoParecer(semImagem);

  const ler = precisaLerPdf(regra, idTexto, classificacao, pdf !== null);
  const parecer = ler && pdf ? await deps.lerParecer(pdf.bytes, run.tenant_id) : SEM_LEITURA;
  // a IA não respondeu: tentar de novo no próximo run
  const passageira = ler && !parecer.ok;
  if (passageira) log('não consegui ler o documento', { nivel: 'falha', erro: parecer.erro });

  const idDoc: Identificacao = ler && parecer.ok
    ? identificarPorDocumento({ nt: parecer.nt, uc: parecer.uc, titular: parecer.titular }, projetos)
    : { tipo: 'nenhum' };
  const id = combinar(idTexto, idDoc);

  if (id.tipo !== 'achado') {
    const motivo =
      id.tipo === 'conflito' ? `não anexei · ${id.motivo} — confira à mão`
      : id.tipo === 'inativo' ? `não anexei · o e-mail é do projeto ${id.projeto.codigo}, que já está concluído ou arquivado`
      : passageira ? `não consegui ler o anexo para descobrir o projeto: ${parecer.erro}`
      : 'não reconheci de qual projeto é este e-mail (nenhum protocolo, UC ou nome de titular nosso) — confira à mão';
    await deps.registrarEmailLido({
      ...base, projectId: null, tipoDocumento: regra.tipo_documento,
      veredito: parecer.ok ? parecer.veredito : null, resumo: parecer.resumo || null, anexos: 0,
      motivo, recomendacao: null, concluida: !passageira, arquivoLido: null, abrirCartao: false,
    });
    let avisos = 0;
    for (const a of avisosEnel(regra.tipo_documento, null, null, null)) {
      avisos += await deps.avisar({ accountId: run.account_id, messageId: m.messageId, protocolo: CHAVE_DA_MENSAGEM_ENEL, projectId: null, ...a });
    }
    log('e-mail sem projeto certo', { nivel: 'aviso', situacao: id.tipo, codigos: id.tipo === 'conflito' ? id.codigos : undefined });
    return {
      ...vazio, imagensIgnoradas, avisos, concluida: !passageira,
      situacao: id.tipo === 'nenhum' ? 'nao_identificado' : id.tipo,
    };
  }

  const projeto = id.projeto;
  const referencia = referenciaDoProjeto(projeto);
  const lido = ler && parecer.ok && pdf ? pdf.nome : null;

  // O titular do DOCUMENTO de outra pessoa é o único bloqueio (como na EDP).
  if (parecer.ok && parecer.titular && projeto.titular && comparavelTitular(parecer.titular)
      && comparavelTitular(projeto.titular) && !casaTitular(projeto.titular, parecer.titular)) {
    await deps.registrarEmailLido({
      ...base, projectId: projeto.project_id, referencia, casamento: id.por, abrirCartao: true,
      tipoDocumento: regra.tipo_documento, veredito: parecer.veredito, resumo: parecer.resumo || null, anexos: 0,
      motivo: `não anexei · o documento é de "${parecer.titular}" e o projeto é de "${projeto.titular}"`,
      recomendacao: null, concluida: true, arquivoLido: lido,
    });
    log('anexo bloqueado: o titular do documento não é o do projeto', { nivel: 'aviso', projeto: projeto.codigo, por: id.por });
    return { ...vazio, imagensIgnoradas, situacao: 'bloqueado', por: id.por, concluida: true };
  }

  const ressalvas: string[] = [];
  const nota = anotacao(classificacao);
  if (nota) ressalvas.push(nota);

  const paraAnexar = regra.anexar ? semImagem.filter(a => !nomeTrazOutroProjeto(a.nome, projeto, projetos)) : [];
  const barrados = regra.anexar ? semImagem.filter(a => !paraAnexar.includes(a)) : [];
  if (barrados.length) ressalvas.push(`${barrados.length} arquivo(s) não anexado(s): o nome traz o número de outro projeto (${nomes(barrados.map(a => a.nome))})`);

  const aceitos: (typeof paraAnexar[number] & { mime: string })[] = [];
  const recusados: string[] = [];
  for (const a of paraAnexar) {
    const d = destinoNoBucket(a);
    if (d.aceito) aceitos.push({ ...a, mime: d.mime }); else recusados.push(`${a.nome} [${d.motivo}]`);
  }
  if (recusados.length) ressalvas.push(`${recusados.length} arquivo(s) não anexado(s): o armazenamento do projeto só aceita pdf, xls, xlsx e docx de até 10 MB (${nomes(recusados)})`);
  if (imagensIgnoradas) ressalvas.push(`${imagensIgnoradas} imagem(ns) do e-mail não foram anexadas (assinatura)`);
  if (m.anexosSemNome) ressalvas.push(`${m.anexosSemNome} anexo(s) sem nome de arquivo não foram anexados`);
  if (passageira) ressalvas.push(`não consegui ler o documento: ${parecer.erro}`);

  let anexados = 0;
  let anexoFalhou = false;
  for (const a of aceitos) {
    const aberto = await deps.anexoDeEmail(run.account_id, referencia, projeto.project_id, m.messageId, a.nome, id.por, a.ocorrencia);
    if (aberto.situacao === 'ja_resolvido') { log('anexo já estava no card; não subi de novo', { nivel: 'aviso', projeto: projeto.codigo }); continue; }
    if (aberto.situacao === 'projeto_inexistente') { log('o projeto não existe mais; não anexei', { nivel: 'falha', projeto: projeto.codigo }); continue; }
    try {
      const caminho = await deps.subirDocumento(aberto.anexo, a.bytes, a.mime);
      await deps.anexoEnviado(aberto.anexo.id, caminho, a.mime);
      anexados++;
    } catch (e) {
      anexoFalhou = true;
      await deps.anexoErro(aberto.anexo.id, (e as Error).message);
      log('anexo falhou ao subir', { nivel: 'falha', projeto: projeto.codigo, mime: a.mime, razao: razaoDeFalhaDeArquivo(e) });
    }
  }

  const sugerida = recomendacaoEnel(classificacao, parecer);
  const recomendacao = sugerida && recomendacaoCabe(sugerida, projeto.status) ? sugerida : null;
  if (sugerida && !recomendacao) ressalvas.push(`não sugeri "${sugerida}": o projeto já está em "${projeto.status}"`);

  const concluida = !passageira && !anexoFalhou;
  await deps.registrarEmailLido({
    ...base, projectId: projeto.project_id, referencia, casamento: id.por,
    // cartão só quando há sugestão de etapa: 99 respostas automáticas não podem virar 99 cartões
    abrirCartao: recomendacao !== null,
    tipoDocumento: regra.tipo_documento, veredito: parecer.ok ? parecer.veredito : null,
    resumo: parecer.resumo || null, anexos: anexados,
    motivo: ressalvas.length ? ressalvas.join(' · ') : null, recomendacao, concluida, arquivoLido: lido,
  });

  let avisos = 0;
  for (const a of avisosEnel(regra.tipo_documento, classificacao, parecer, projeto)) {
    avisos += await deps.avisar({ accountId: run.account_id, messageId: m.messageId, protocolo: CHAVE_DA_MENSAGEM_ENEL, projectId: projeto.project_id, ...a });
  }

  log('e-mail tratado', {
    projeto: projeto.codigo, por: id.por, tipo: regra.tipo_documento, leu_pdf: ler,
    anexados, recomendacao, avisos, concluida,
  });
  return {
    situacao: 'tratado', por: id.por, anexados, imagensIgnoradas, recusados: recusados.length,
    semNome: m.anexosSemNome, deOutroProjeto: barrados.length, avisos, concluida,
  };
}

export interface ContaEnel {
  lidos: number; tratados: number; porProtocolo: number; porUc: number; porTitular: number;
  naoIdentificados: number; conflitos: number; inativos: number; bloqueados: number; ignorados: number;
  anexados: number; deOutroProjeto: number; recusados: number; semNome: number; imagens: number;
  avisos: number; pulados: number; aTentarDeNovo: number; naoLidas: number;
  limpos: number; falhasBusca: number; falhasTratamento: number;
}
export const contaEnelZerada = (): ContaEnel => ({
  lidos: 0, tratados: 0, porProtocolo: 0, porUc: 0, porTitular: 0, naoIdentificados: 0, conflitos: 0,
  inativos: 0, bloqueados: 0, ignorados: 0, anexados: 0, deOutroProjeto: 0, recusados: 0, semNome: 0,
  imagens: 0, avisos: 0, pulados: 0, aTentarDeNovo: 0, naoLidas: 0, limpos: 0, falhasBusca: 0, falhasTratamento: 0,
});

export function somarEnel(n: ContaEnel, r: TratamentoEnel): void {
  n.anexados += r.anexados; n.imagens += r.imagensIgnoradas; n.recusados += r.recusados;
  n.semNome += r.semNome; n.deOutroProjeto += r.deOutroProjeto; n.avisos += r.avisos;
  if (!r.concluida) n.aTentarDeNovo++;
  if (r.situacao === 'tratado') {
    n.tratados++;
    if (r.por === 'protocolo') n.porProtocolo++; else if (r.por === 'uc') n.porUc++; else if (r.por === 'titular') n.porTitular++;
  } else if (r.situacao === 'nao_identificado') n.naoIdentificados++;
  else if (r.situacao === 'conflito') n.conflitos++;
  else if (r.situacao === 'inativo') n.inativos++;
  else if (r.situacao === 'bloqueado') n.bloqueados++;
  else n.ignorados++;
}

/** O `resultado` do run — é daqui que a tela lê os contadores. */
export function resultadoEnel(n: ContaEnel, remetentes: number, projetosAtivos: number, falhas: number): Record<string, number> {
  return {
    remetentes, projetos_ativos: projetosAtivos, lidos: n.lidos, tratados: n.tratados,
    por_protocolo: n.porProtocolo, por_uc: n.porUc, por_titular: n.porTitular,
    nao_identificados: n.naoIdentificados, conflitos: n.conflitos, inativos: n.inativos,
    bloqueados: n.bloqueados, ignorados: n.ignorados, anexados: n.anexados,
    anexos_de_outro_projeto: n.deOutroProjeto, anexos_recusados: n.recusados, anexos_sem_nome: n.semNome,
    imagens_ignoradas: n.imagens, avisos: n.avisos, pulados: n.pulados,
    a_tentar_de_novo: n.aTentarDeNovo, nao_lidas: n.naoLidas,
    falhas, falhas_busca: n.falhasBusca, falhas_tratamento: n.falhasTratamento,
  };
}

export async function executarVarreduraEnel(run: Run, ultimaVarreduraEm: string | null): Promise<void> {
  log('varredura por e-mail (por remetente) iniciada', { run: run.id });
  let caixa: Caixa | null = null;
  try {
    const creds = await credencialDaCaixa(run.account_id);
    const projetos = await projetosDoEmail(run.account_id);
    const regras = await regrasDoEmail(run.account_id);
    if (regras.length === 0) throw new Error('Esta concessionária não tem regras de e-mail cadastradas na tela da Ludmilla.');
    const remetentes = remetentesParaBuscar(regras);
    const desde = janelaDeBusca(ultimaVarreduraEm, new Date());
    caixa = await abrirCaixa(creds);
    const n = contaEnelZerada();

    for (const rem of remetentes) {
      let uids: number[];
      try { uids = await caixa.procurarDe(rem, desde); }
      catch (e) { n.falhasBusca++; log('a busca na caixa falhou para este remetente', { nivel: 'falha', remetente: rem, erro: (e as Error).message }); continue; }
      n.limpos++;
      if (uids.length === 0) continue;

      const envelopes: EnvelopeLido[] = [];
      try { for await (const env of caixa.envelopes(uids)) envelopes.push(env); }
      catch (e) { n.falhasBusca++; log('não consegui ler os envelopes deste remetente', { nivel: 'falha', remetente: rem, erro: (e as Error).message }); continue; }

      const aprovados = new Map<number, EnvelopeLido>();
      for (const env of envelopes) {
        let pendente: boolean;
        try { pendente = await mensagemPendente(run.account_id, env.messageId, CHAVE_DA_MENSAGEM_ENEL); }
        catch (e) { n.falhasTratamento++; log('não consegui conferir se a mensagem já foi tratada', { nivel: 'falha', mensagem: env.messageId, erro: (e as Error).message }); continue; }
        if (!pendente) { n.pulados++; continue; }
        aprovados.set(env.uid, env);
      }
      if (aprovados.size === 0) continue;

      try {
        for await (const baixada of caixa.baixar([...aprovados.keys()])) {
          const env = aprovados.get(baixada.uid);
          const m = env ? { ...baixada, messageId: env.messageId } : baixada;
          try { n.lidos++; somarEnel(n, await tratarMensagemEnel(run, m, regras, projetos)); }
          catch (e) { n.falhasTratamento++; log('o tratamento desta mensagem falhou', { nivel: 'falha', mensagem: m.messageId, erro: (e as Error).message }); }
        }
      } catch (e) {
        n.falhasBusca++;
        log('não consegui baixar as mensagens deste remetente', { nivel: 'falha', remetente: rem, erro: (e as Error).message });
      }
    }

    n.naoLidas = caixa.naoLidas();
    if (n.limpos === 0 && n.falhasBusca > 0) throw new Error(`Nenhum dos ${n.falhasBusca} remetentes pôde ser procurado na caixa de e-mail.`);
    const falhas = n.falhasBusca + n.falhasTratamento;
    const ativos = projetos.filter(p => p.ativo).length;
    await finalizarRun(run.id, {
      situacao: 'ok', situacaoConta: 'ok', protocolos: ativos, mudancas: n.anexados,
      resultado: resultadoEnel(n, remetentes.length, ativos, falhas),
    });
    log('varredura por e-mail (por remetente) ok', { run: run.id, ...n, falhas });
  } catch (e) {
    const erro = classificarErroEmail(e);
    await finalizarRun(run.id, {
      situacao: 'erro', erro: erro.mensagem,
      situacaoConta: erro.situacaoConta === 'ok' ? undefined : erro.situacaoConta,
    }).catch(err => log('não consegui fechar o run', { run: run.id, erro: (err as Error).message }));
    log('varredura por e-mail (por remetente) com erro', { run: run.id, classe: erro.classe, mensagem: erro.mensagem });
  } finally {
    await caixa?.fechar().catch(() => undefined);
  }
}
```

Atenção ao log: `remetente` é endereço da **ENEL** (não é dado de cliente) e pode ir para o log; `erro` de busca/banco vem do IMAP ou do PostgREST, não traz dado de cliente. Nunca logue `m.assunto`, nome de arquivo ou titular.

- [ ] **Step 8: Implementar o roteador** — `worker/ludmilla/src/email/rotear.ts`

```ts
// worker/ludmilla/src/email/rotear.ts
import { contaDoEmail, finalizarRun, type Run } from '../fila.js';
import { modoAtual } from '../local.js';
import { executarVarreduraEnel } from './enel/run.js';
import { executarVarreduraEmail } from './index.js';

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/**
 * O run `varredura_email` tem dois modos, escolhidos pela CONTA:
 *  · protocolo_no_assunto (EDP) → `executarVarreduraEmail`, que NÃO foi alterado;
 *  · remetente (ENEL)           → `executarVarreduraEnel`.
 * Nada escapa daqui: o laço principal chama sem try, e exceção que escapasse
 * mataria o processo (`principal().catch` faz `process.exit(1)`).
 */
export async function executarAcompanhamentoEmail(run: Run): Promise<void> {
  // na estação local, o caminho de sempre recusa com a explicação
  if (modoAtual() === 'local') return executarVarreduraEmail(run);
  let conta: Awaited<ReturnType<typeof contaDoEmail>>;
  try {
    conta = await contaDoEmail(run.account_id);
  } catch (e) {
    log('não consegui ler a configuração da conta de e-mail', { nivel: 'falha', run: run.id, erro: (e as Error).message });
    await finalizarRun(run.id, { situacao: 'erro', erro: `Não consegui ler a configuração da conta: ${(e as Error).message}` })
      .catch(() => undefined);
    return;
  }
  if (conta.identificacao === 'remetente') return executarVarreduraEnel(run, conta.ultimaVarreduraEm);
  return executarVarreduraEmail(run);
}
```

- [ ] **Step 9: Trocar a chamada em `worker/ludmilla/src/index.ts`**

Linha 9: `import { executarVarreduraEmail } from './email/index.js';` → `import { executarAcompanhamentoEmail } from './email/rotear.js';`
Linha 299: `await executarVarreduraEmail(run);` → `await executarAcompanhamentoEmail(run);`
**Nada mais muda nesse arquivo.** Mostre o `git diff` dele: dois hunks de uma linha.

- [ ] **Step 10: Rodar tudo**

Run: `cd worker/ludmilla && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: `tsc` limpo; `fail 0`; **os 225 testes de antes continuam passando sem alteração** (compare a lista dos arquivos de teste da EDP: nenhum foi editado).

- [ ] **Step 11: Mutação** em `decidir.ts` e `run.ts` (uma de cada vez, conferindo o retorno byte a byte):
1. `precisaLerPdf` devolver `true` sempre
2. `recomendacaoCabe` devolver `true` sempre
3. em `tratarMensagemEnel`, `abrirCartao: true` sempre
4. tirar o `!nomeTrazOutroProjeto(...)` do filtro de anexos
5. `concluida = !anexoFalhou` (esquecendo a IA que falhou)
6. mover `deps.abrirTentativa` para depois de `deps.lerParecer`
7. logar `m.assunto` no "e-mail tratado"

Cada uma derruba teste.

- [ ] **Step 12: Commit** (só os caminhos desta task) — título: `feat(ludmilla): o run da ENEL le os e-mails pelos remetentes, acha o projeto e avisa`

---

### Task 7: A tela — a ENEL no cartão de e-mail

**Files:**
- Modify: `src/hooks/useLudmilla.ts`
- Modify: `src/components/ludmilla/RegrasEmail.tsx`
- Modify: `src/components/ludmilla/MensagensEmail.tsx`
- Read first: `src/pages/Ludmilla.tsx` (como o cartão escolhe o corpo pelo `acompanhamento`)

**Interfaces:**
- Consumes: `portal_accounts.identificacao` (Task 1); chaves do `resultado` de `resultadoEnel` (Task 6)
- Produces: tipos e rótulos da ENEL; contadores de identificação

- [ ] **Step 1: Tipos** — em `src/hooks/useLudmilla.ts`:
  - `TipoDocumentoEmail` passa a incluir `'carta_projeto' | 'resultado_vistoria' | 'troca_relogio' | 'resposta_automatica' | 'devolucao' | 'comunicado'`.
  - `PortalAccount` ganha `identificacao: 'protocolo_no_assunto' | 'remetente';` (a coluna já vem no `select *`).

- [ ] **Step 2: Rótulos** — em `src/components/ludmilla/RegrasEmail.tsx`, acrescente ao mapa de rótulos e à lista `TIPOS`:
  `carta_projeto: 'carta do projeto'`, `resultado_vistoria: 'resultado da vistoria'`, `troca_relogio: 'troca do relógio'`, `resposta_automatica: 'resposta automática'`, `devolucao: 'e-mail devolvido'`, `comunicado: 'comunicado (ignorar)'`.
  Assunto vazio é válido (quer dizer "qualquer assunto deste remetente"): se o formulário exige assunto, relaxe essa exigência e mostre **"qualquer assunto"** na linha quando ele for vazio.

- [ ] **Step 3: Contadores** — em `MensagensEmail.tsx`, quando a conta tem `identificacao === 'remetente'`, os quadros da última leitura passam a ser: **pelo protocolo** (`por_protocolo`), **pela UC** (`por_uc`), **pelo nome** (`por_titular`), **levantei a mão** (`nao_identificados + conflitos`, destacado em âmbar quando > 0), **bloqueados** (`bloqueados`), **avisos** (`avisos`), mais os que a EDP já mostra e que existem aqui (`anexados` como "documentos anexados", `imagens_ignoradas`, `a_tentar_de_novo`). No histórico, quando `protocolo === ''`, mostre o código do projeto (já vem no join) ou "—".
  O cartão da EDP e o da CPFL **não mudam**.

- [ ] **Step 4: Verificar**

Run (raiz): `npx tsc --noEmit -p tsconfig.app.json` — Expected: **65** erros, nenhum nos arquivos tocados.
Run: `npm run build` — Expected: `✓ built`.
Prova na tela pelo navegador embutido: a `/ludmilla` real exige login e **não se insere senha**. Use a mesma técnica da Task 6 da EDP — um segundo servidor Vite com config temporária trocando só `AuthContext`, `MainLayout`, `useTenant` e o cliente Supabase por dublês com fixtures copiadas de linhas reais, renderizando a `Ludmilla.tsx` de verdade — e **apague o harness** antes do `tsc`/`build` finais. Prints: cartão da ENEL com regras e contadores; cartão da EDP inalterado; cartão da CPFL inalterado.

- [ ] **Step 5: Commit** (só os três arquivos) — título: `feat(ludmilla): a tela mostra o acompanhamento da ENEL por remetente`

---

### Task 8: Documentação, memória e roteiro do primeiro run

**Files:**
- Modify: `docs/modules/integrations/ludmilla.md` (seção "Acompanhamento por E-MAIL — a ENEL", cabeçalho, item dos "Próximos")
- Modify: `CLAUDE.md` (linha da Ludmilla no índice)
- Create: `docs/superpowers/2026-10-13-primeiro-run-enel-email.md`
- Modify (memória, fora do repositório): `C:\Users\luiza\.claude\projects\C--Users-luiza-Desktop-DADOS-DESENVOLVIMENTO---GD-MANAGER-ENERGY-pv-harmony-hub-main-pv-harmony-hub-main\memory\ludmilla.md` e `MEMORY.md`

- [ ] **Step 1: Doc do módulo** — registre o PORQUÊ de cada decisão não óbvia: a direção invertida; o princípio "nossos números"; os cinco números da ENEL e o perigo do protocolo de contato com 10 dígitos; nome só no assunto (assinatura de funcionário no corpo); a chave fixa da mensagem (`''`) e por que (tentativa antes da IA); `referencia` no cartão; `p_abrir_cartao` (99 respostas automáticas não viram 99 cartões); `recomendacaoCabe` (30 dias de e-mail não pode sugerir etapa para trás); o sino uma vez por mensagem (`aviso_em`); e a **proteção acidental** do agendador (só enfileira conta com login e `secret_id` — EDP e ENEL não têm; mudar isso sem cuidado faria o cron mandar varredura de portal para conta de e-mail).
- [ ] **Step 2: Roteiro do primeiro run** — no mesmo formato de `docs/superpowers/2026-10-11-primeiro-run-edp-email.md`: a ordem (publicar antes; o push ainda espera a frente de assinatura), o pré-voo em SQL (conta, regras, número de projetos ativos — **replicando a consulta sem a guarda de `service_role`**, porque pelo CLI as RPCs devolvem vazio), como disparar (`INSERT` em `portal_sync_runs` com `tipo = 'varredura_email'` para a conta `enel`, ou "Verificar agora"), as consultas de conferência, e o que olhar: **quantos por qual sinal** e **quantos levantaram a mão**; abrir cards na mão; se apareceu alguma "troca feita"; o custo de IA; e o aviso de que a primeira leitura de 30 dias pode tocar o sino para coisas que a equipe já fez.
- [ ] **Step 3: CLAUDE.md e memória** — linha da Ludmilla com a ENEL; memória do módulo com as decisões e as armadilhas novas.
- [ ] **Step 4: Commit** (só os arquivos do repositório) — título: `docs(ludmilla): acompanhamento da ENEL por e-mail e o roteiro do primeiro run`

---

## Fora deste plano (não fazer)

- Enviar qualquer e-mail — pedir troca do relógio é a fase 2 (spec §13).
- Agendar o run da ENEL (cron) — só depois do primeiro run manual.
- Mexer no Claudinho, no caminho da EDP, no caminho de portal, no agendador.
- Etapa nova no Kanban.
- Sugerir protocolo a partir do e-mail de abertura (fase 2).
- Publicar (`git push`), disparar workflow ou enfileirar run.
