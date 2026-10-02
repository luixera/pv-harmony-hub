# Ludmilla — acompanhar a EDP por e-mail · Plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — usar `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans`, tarefa por tarefa. Os passos usam
> caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** a Ludmilla acha o e-mail da EDP pelo protocolo do projeto, anexa o parecer no card, lê o PDF e recomenda a etapa — sem nunca mover o card sozinha.

**Arquitetura:** um segundo meio de acompanhamento (`portal_accounts.acompanhamento = 'email'`) ao lado do portal. Um run `varredura_email` entra na mesma fila do worker Node da VPS; ele lê a caixa por IMAP com a credencial que o Claudinho já usa, aplica regras configuráveis do banco, reaproveita o caminho `portal_anexos → subirDocumento → documents` e grava recomendações em `portal_updates`. A leitura do PDF é uma edge function nova.

**Stack:** Node 22 + TypeScript no worker (`worker/ludmilla`), `imapflow` + `mailparser`, Postgres/Supabase (RPCs SECURITY DEFINER), edge function Deno, React + React Query no front.

**Spec:** `docs/superpowers/specs/2026-10-02-ludmilla-edp-email-design.md`

## Restrições globais

- **Isolamento de tenant é inegociável.** Toda tabela nova leva `tenant_id` com RLS RESTRICTIVE; toda RPC nova é `SECURITY DEFINER SET search_path = ''` e exige `(SELECT auth.role()) = 'service_role'`.
- **A Ludmilla recomenda, não aplica.** Nenhum código deste plano altera `projects.status`.
- **A caixa é só de leitura.** Nunca marcar como lido, mover ou apagar mensagem — o Claudinho usa a mesma caixa.
- **Verificação antes de concluir:** `npx tsc --noEmit -p tsconfig.app.json` contra o **baseline de 65 erros** (queda grande = falha de parse, não melhoria) e, no worker, `npx tsc --noEmit -p tsconfig.json` + `npm test` com **fail 0**.
- **Banco:** aplicar migração com `npx -y supabase db query --linked -f <arquivo>`; só o último SELECT com linhas volta.
- **Identificadores em português** (o módulo já é assim). Comunicação e mensagens de erro em português.
- Comparação de protocolo é **sempre** por dígitos sem zeros à esquerda: `045006443920` ≡ `45006443920`.

---

### Task 1: Utilitários puros do e-mail

Funções sem rede e sem banco, cobertas por teste. É a base de todo o resto: casar protocolo, aplicar as regras, conferir titular/endereço e traduzir o veredito em recomendação.

**Arquivos:**
- Criar: `worker/ludmilla/src/email/util.ts`
- Criar: `worker/ludmilla/test/email-util.test.ts`

**Interfaces:**
- Consome: nada.
- Produz: `chaveProtocolo(s: string): string` · `casaProtocolo(a: string, b: string): boolean` · `protocoloDoAssunto(assunto: string, candidatos: string[]): string | null` · `semAcento(s: string): string` · `regraQueCasa(regras: RegraEmail[], assunto: string, remetente: string): RegraEmail | null` · `casaTitular(doSistema: string, doEmail: string): boolean` · `casaEndereco(doSistema: string, doEmail: string): boolean` · `recomendacaoDoVeredito(tipo: string, v: Veredito | null): string | null` · `interface RegraEmail` · `type Veredito`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// worker/ludmilla/test/email-util.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  casaEndereco, casaProtocolo, casaTitular, chaveProtocolo, protocoloDoAssunto,
  recomendacaoDoVeredito, regraQueCasa, type RegraEmail,
} from '../src/email/util.js';

const REGRAS: RegraEmail[] = [
  { id: '1', remetente: 'relacionamento.edp', assunto: 'ENVIO DE PARECER', tipo_documento: 'parecer', anexar: true, ler_pdf: true },
  { id: '2', remetente: null, assunto: 'CARTA DE OBRAS', tipo_documento: 'carta_obras', anexar: true, ler_pdf: false },
  { id: '3', remetente: null, assunto: 'NOTA', tipo_documento: 'nota', anexar: true, ler_pdf: false },
];

test('chaveProtocolo tira pontuação e zeros à esquerda', () => {
  assert.equal(chaveProtocolo('045006443920'), '45006443920');
  assert.equal(chaveProtocolo('45006443920'), '45006443920');
  assert.equal(chaveProtocolo('0.400.083.127-22'), '40008312722');
  assert.equal(chaveProtocolo(''), '');
});

test('casaProtocolo ignora o zero à esquerda do sistema', () => {
  assert.ok(casaProtocolo('045006443920', '45006443920'));
  assert.ok(!casaProtocolo('045006443920', '45006439205'));
  // número curto demais não casa: evita colar e-mail pelo número da rua
  assert.ok(!casaProtocolo('123', '123'));
});

test('protocoloDoAssunto acha o protocolo do projeto dentro do assunto', () => {
  const candidatos = ['045006443920', '040008312722'];
  assert.equal(protocoloDoAssunto('ENVIO DE PARECER - NOTA 45006443920', candidatos), '045006443920');
  assert.equal(protocoloDoAssunto('NOTA - 40008312722', candidatos), '040008312722');
  assert.equal(protocoloDoAssunto('RA HugMe - EDP São Paulo te mandou mensagem', candidatos), null);
});

test('regraQueCasa usa assunto e, quando houver, remetente', () => {
  assert.equal(regraQueCasa(REGRAS, 'ENVIO DE PARECER - NOTA 45006443920', 'relacionamento.edp@edp.com.br')?.tipo_documento, 'parecer');
  // assunto de parecer vindo de outro remetente não vale como parecer
  assert.equal(regraQueCasa(REGRAS, 'ENVIO DE PARECER - NOTA 1', 'estranho@exemplo.com'), null);
  assert.equal(regraQueCasa(REGRAS, 'EDP - CARTA DE OBRAS', 'edpdocumentoporemail@edpbr.com.br')?.tipo_documento, 'carta_obras');
  assert.equal(regraQueCasa(REGRAS, 'Protocolo de Atendimento EDP 0460917635', 'protocolodoatendimentosp@edp.com.br'), null);
});

test('casaTitular compara primeiro e último nome, sem acento', () => {
  assert.ok(casaTitular('WERLHE DE ARAUJO LIMA', 'Sr. Werlhe de Araújo Lima'));
  assert.ok(!casaTitular('WERLHE DE ARAUJO LIMA', 'Miguel Arcanjo Corcini'));
  assert.ok(!casaTitular('', 'Werlhe de Araujo Lima'));
});

test('casaEndereco compara rua e número normalizados', () => {
  assert.ok(casaEndereco('RUA DAS FLORES 120', 'Rua das Flores, nº 120 - Centro'));
  assert.ok(!casaEndereco('RUA DAS FLORES 120', 'Rua das Flores, nº 999'));
  assert.ok(!casaEndereco('', 'Rua das Flores 120'));
});

test('recomendacaoDoVeredito só recomenda etapa para parecer', () => {
  assert.equal(recomendacaoDoVeredito('parecer', 'favoravel'), 'approved');
  assert.equal(recomendacaoDoVeredito('parecer', 'pendencia'), 'pendencia');
  assert.equal(recomendacaoDoVeredito('parecer', 'inconclusivo'), null);
  assert.equal(recomendacaoDoVeredito('carta_obras', 'favoravel'), null);
});
```

- [ ] **Passo 2: Rodar o teste e ver falhar**

```bash
cd worker/ludmilla && npx tsc -p tsconfig.test.json
```
Esperado: FALHA — `Cannot find module '../src/email/util.js'`.

- [ ] **Passo 3: Escrever a implementação mínima**

```ts
// worker/ludmilla/src/email/util.ts
/**
 * Utilitários puros do acompanhamento por e-mail — sem rede, sem banco.
 * Tudo o que é comparação ou conta vive aqui; o roteiro só orquestra.
 */

export interface RegraEmail {
  id: string;
  /** trecho do remetente; null = qualquer remetente */
  remetente: string | null;
  /** trecho do assunto que identifica o documento */
  assunto: string;
  tipo_documento: string;
  anexar: boolean;
  ler_pdf: boolean;
}

export type Veredito = 'favoravel' | 'pendencia' | 'inconclusivo';

export const semAcento = (s: string): string =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Só os dígitos, sem zeros à esquerda: o protocolo do sistema tem um zero a mais que a nota. */
export const chaveProtocolo = (s: string): string =>
  (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/** Protocolos com menos de 8 dígitos não casam: evita colar e-mail por número de rua ou CEP. */
export function casaProtocolo(a: string, b: string): boolean {
  const x = chaveProtocolo(a);
  return x.length >= 8 && x === chaveProtocolo(b);
}

/** Acha, entre os protocolos dos projetos, aquele que aparece no assunto. */
export function protocoloDoAssunto(assunto: string, candidatos: string[]): string | null {
  const numeros = (assunto.match(/\d[\d.\-/]{6,}/g) ?? []).map(chaveProtocolo);
  return candidatos.find(c => numeros.some(n => casaProtocolo(c, n))) ?? null;
}

/** Primeira regra ativa cujo assunto (e remetente, quando a regra tiver) casa. */
export function regraQueCasa(regras: RegraEmail[], assunto: string, remetente: string): RegraEmail | null {
  const a = semAcento(assunto).toUpperCase();
  const r = semAcento(remetente).toLowerCase();
  return regras.find(x =>
    a.includes(semAcento(x.assunto).toUpperCase())
    && (!x.remetente || r.includes(semAcento(x.remetente).toLowerCase()))
  ) ?? null;
}

const palavras = (s: string): string[] =>
  semAcento(s).toUpperCase().split(/[^A-Z0-9]+/).filter(p => p.length > 2);

/** Primeiro + último nome — a mesma regra que o Claudinho usa para casar titular. */
export function casaTitular(doSistema: string, doEmail: string): boolean {
  const a = palavras(doSistema);
  const b = palavras(doEmail);
  if (a.length === 0 || b.length === 0) return false;
  return b.includes(a[0]) && b.includes(a[a.length - 1]);
}

export const normalizarEndereco = (s: string): string =>
  semAcento(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Rua (palavras com mais de 3 letras) e número têm de aparecer no endereço do e-mail. */
export function casaEndereco(doSistema: string, doEmail: string): boolean {
  const a = normalizarEndereco(doSistema);
  const b = normalizarEndereco(doEmail);
  if (!a || !b) return false;
  const numero = (a.match(/\b\d+\b/) ?? [])[0];
  const rua = a.replace(/\b\d+\b/g, '').split(' ').filter(p => p.length > 3);
  if (rua.length === 0) return false;
  return rua.every(p => b.includes(p)) && (!numero || new RegExp(`\\b${numero}\\b`).test(b));
}

/** Etapa recomendada para o card. Null = só avisa que o documento chegou. */
export function recomendacaoDoVeredito(tipo: string, v: Veredito | null): string | null {
  if (tipo !== 'parecer') return null;
  if (v === 'favoravel') return 'approved';
  if (v === 'pendencia') return 'pendencia';
  return null;
}
```

- [ ] **Passo 4: Rodar os testes e ver passar**

```bash
cd worker/ludmilla && npm test
```
Esperado: `pass` com os 7 testes novos e **`fail 0`** (o total sobe de 64 para 71).

- [ ] **Passo 5: Commitar**

```bash
git add worker/ludmilla/src/email/util.ts worker/ludmilla/test/email-util.test.ts
git commit -m "feat(ludmilla): utilitarios do acompanhamento por e-mail (protocolo, regras, conferencia)"
```

---

### Task 2: Banco — acompanhamento, regras, mensagens e RPCs

Uma migração só, com as colunas, as duas tabelas novas, as RPCs que o worker usa e a semente da EDP.

**Arquivos:**
- Criar: `supabase/migrations/20261002120000_ludmilla_email_edp.sql`

**Interfaces:**
- Consome: `portal_accounts`, `portal_sync_runs`, `portal_anexos`, `portal_updates`, `projects`, `project_general_data`, `energy_concessionaires`, `agent_config`.
- Produz (chamadas pelo worker):
  - `ludmilla_email_credencial(p_account_id UUID) → TABLE (email TEXT, senha TEXT)`
  - `ludmilla_email_protocolos(p_account_id UUID) → TABLE (protocolo TEXT, project_id UUID, company_id UUID, codigo TEXT, titular TEXT, endereco TEXT)`
  - `ludmilla_email_regras(p_account_id UUID) → TABLE (id UUID, remetente TEXT, assunto TEXT, tipo_documento TEXT, anexar BOOLEAN, ler_pdf BOOLEAN)`
  - `ludmilla_email_mensagem_nova(p_account_id UUID, p_message_id TEXT) → BOOLEAN`
  - `ludmilla_email_anexo_novo(p_account_id UUID, p_protocolo TEXT, p_project_id UUID, p_message_id TEXT, p_nome_arquivo TEXT, p_conferido_por TEXT) → TABLE (anexo_id UUID, company_id UUID, codigo TEXT)`
  - `ludmilla_email_registrar(p_run_id UUID, p_account_id UUID, p_message_id TEXT, p_protocolo TEXT, p_project_id UUID, p_assunto TEXT, p_remetente TEXT, p_recebido_em TIMESTAMPTZ, p_tipo_documento TEXT, p_veredito TEXT, p_resumo TEXT, p_anexos INTEGER, p_motivo TEXT, p_recomendacao TEXT) → UUID`

- [ ] **Passo 1: Escrever a migração**

```sql
-- supabase/migrations/20261002120000_ludmilla_email_edp.sql
-- Ludmilla: segundo meio de acompanhamento — o E-MAIL — estreando na EDP.
-- Spec: docs/superpowers/specs/2026-10-02-ludmilla-edp-email-design.md

-- ── 1. Como a conta é acompanhada (ortogonal a `modo`, que diz ONDE roda) ─────
ALTER TABLE public.portal_accounts
  ADD COLUMN IF NOT EXISTS acompanhamento TEXT NOT NULL DEFAULT 'portal';
ALTER TABLE public.portal_accounts
  DROP CONSTRAINT IF EXISTS portal_accounts_acompanhamento_check;
ALTER TABLE public.portal_accounts
  ADD CONSTRAINT portal_accounts_acompanhamento_check
  CHECK (acompanhamento IN ('portal', 'email'));
COMMENT ON COLUMN public.portal_accounts.acompanhamento IS
  'portal = a Ludmilla entra no site; email = ela lê a caixa. CPFL portal+vps, EDP email+vps, Elektro portal+local.';

-- ── 2. A EDP é um conector válido ────────────────────────────────────────────
ALTER TABLE public.portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_connector_check;
ALTER TABLE public.portal_accounts
  ADD CONSTRAINT portal_accounts_connector_check
  CHECK (connector IN ('cpfl', 'elektro', 'edp'));

-- ── 3. O novo tipo de run ────────────────────────────────────────────────────
ALTER TABLE public.portal_sync_runs DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;
ALTER TABLE public.portal_sync_runs
  ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'descoberta', 'varredura', 'criar_projeto', 'varredura_email'));

-- ── 4. Conferência por protocolo/titular/endereço, além de cpf/uc ────────────
ALTER TABLE public.portal_anexos DROP CONSTRAINT IF EXISTS portal_anexos_conferido_por_check;
ALTER TABLE public.portal_anexos
  ADD CONSTRAINT portal_anexos_conferido_por_check
  CHECK (conferido_por IS NULL OR conferido_por IN ('cpf', 'uc', 'protocolo', 'titular', 'endereco'));

-- ── 5. Regras de leitura por concessionária (editáveis na tela) ──────────────
CREATE TABLE IF NOT EXISTS public.portal_email_regras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  remetente      TEXT,
  assunto        TEXT NOT NULL,
  tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('parecer', 'carta_obras', 'nota', 'outro')),
  anexar         BOOLEAN NOT NULL DEFAULT TRUE,
  ler_pdf        BOOLEAN NOT NULL DEFAULT FALSE,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  ordem          INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_email_regras_conta ON public.portal_email_regras (account_id) WHERE ativo;

-- ── 6. O que já foi lido — nunca reprocessar o mesmo e-mail ──────────────────
CREATE TABLE IF NOT EXISTS public.portal_email_mensagens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  run_id         UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  message_id     TEXT NOT NULL,
  protocolo      TEXT NOT NULL,
  project_id     UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  assunto        TEXT,
  remetente      TEXT,
  recebido_em    TIMESTAMPTZ,
  tipo_documento TEXT,
  veredito       TEXT CHECK (veredito IS NULL OR veredito IN ('favoravel', 'pendencia', 'inconclusivo')),
  resumo         TEXT,
  anexos         INTEGER NOT NULL DEFAULT 0,
  motivo         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_email_mensagens_unica UNIQUE (account_id, message_id)
);

-- ── 7. RLS: só a equipe do tenant vê; o robô entra por service role ──────────
ALTER TABLE public.portal_email_regras    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_email_mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_email_regras_tenant ON public.portal_email_regras
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
CREATE POLICY portal_email_regras_leitura ON public.portal_email_regras
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY portal_email_mensagens_tenant ON public.portal_email_mensagens
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
CREATE POLICY portal_email_mensagens_leitura ON public.portal_email_mensagens
  FOR SELECT TO authenticated USING (TRUE);

-- ── 8. RPCs do robô (só service role) ────────────────────────────────────────

-- credencial da caixa: a MESMA do Claudinho (agent_config do tenant da conta)
CREATE OR REPLACE FUNCTION public.ludmilla_email_credencial(p_account_id UUID)
RETURNS TABLE (email TEXT, senha TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.gmail_email, c.gmail_app_password
    FROM public.portal_accounts a
    JOIN public.agent_config c ON c.tenant_id = a.tenant_id
   WHERE a.id = p_account_id
     AND c.config_key = 'email_agent' AND c.is_active
     AND (SELECT auth.role()) = 'service_role'
   LIMIT 1;
$$;

-- protocolos a procurar, com o que serve de conferência.
-- Protocolo repetido em dois projetos do mesmo tenant fica DE FORA: com dois
-- candidatos não dá para saber de quem é o parecer (spec §6, ambiguidade).
CREATE OR REPLACE FUNCTION public.ludmilla_email_protocolos(p_account_id UUID)
RETURNS TABLE (protocolo TEXT, project_id UUID, company_id UUID, codigo TEXT, titular TEXT, endereco TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  WITH ativos AS (
    SELECT p.id, p.code, p.company_id, p.protocol_number, p.created_at, p.tenant_id,
           regexp_replace(ltrim(regexp_replace(p.protocol_number, '\D', '', 'g'), '0'), '^$', 'x') AS chave
      FROM public.portal_accounts a
      JOIN public.projects p
        ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
     WHERE a.id = p_account_id
       AND (SELECT auth.role()) = 'service_role'
       AND NOT p.is_deleted AND p.archived_at IS NULL
       AND p.status::text <> 'completed'
       AND coalesce(p.protocol_number, '') <> ''
  ),
  unicos AS (
    SELECT chave FROM ativos GROUP BY chave HAVING count(*) = 1
  )
  SELECT t.protocol_number, t.id, t.company_id, t.code, g.holder_name,
         trim(coalesce(g.address, '') || ' ' || coalesce(g.address_number, ''))
    FROM ativos t
    JOIN unicos u ON u.chave = t.chave
    LEFT JOIN public.project_general_data g ON g.project_id = t.id
   ORDER BY t.created_at DESC
   LIMIT 80;
$$;

CREATE OR REPLACE FUNCTION public.ludmilla_email_regras(p_account_id UUID)
RETURNS TABLE (id UUID, remetente TEXT, assunto TEXT, tipo_documento TEXT, anexar BOOLEAN, ler_pdf BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT r.id, r.remetente, r.assunto, r.tipo_documento, r.anexar, r.ler_pdf
    FROM public.portal_email_regras r
   WHERE r.account_id = p_account_id AND r.ativo
     AND (SELECT auth.role()) = 'service_role'
   ORDER BY r.ordem, r.created_at;
$$;

CREATE OR REPLACE FUNCTION public.ludmilla_email_mensagem_nova(p_account_id UUID, p_message_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (SELECT auth.role()) = 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.portal_email_mensagens m
        WHERE m.account_id = p_account_id AND m.message_id = p_message_id);
$$;

-- abre o anexo como pendente e devolve o que subirDocumento precisa
CREATE OR REPLACE FUNCTION public.ludmilla_email_anexo_novo(
  p_account_id UUID, p_protocolo TEXT, p_project_id UUID,
  p_message_id TEXT, p_nome_arquivo TEXT, p_conferido_por TEXT
) RETURNS TABLE (anexo_id UUID, company_id UUID, codigo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _proj public.projects%ROWTYPE; _id UUID;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra anexos de e-mail';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  SELECT * INTO _proj  FROM public.projects WHERE id = p_project_id AND tenant_id = _conta.tenant_id;
  IF _proj.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.portal_anexos
    (tenant_id, account_id, protocolo, project_id, id_arquivo, nome_arquivo, situacao, conferido_por)
  VALUES
    (_conta.tenant_id, p_account_id, p_protocolo, p_project_id,
     p_message_id || '#' || p_nome_arquivo, p_nome_arquivo, 'pendente', p_conferido_por)
  RETURNING id INTO _id;

  RETURN QUERY SELECT _id, _proj.company_id, _proj.code;
END;
$$;

-- registra o e-mail lido e, quando houver etapa recomendada, a recomendação
CREATE OR REPLACE FUNCTION public.ludmilla_email_registrar(
  p_run_id UUID, p_account_id UUID, p_message_id TEXT, p_protocolo TEXT,
  p_project_id UUID, p_assunto TEXT, p_remetente TEXT, p_recebido_em TIMESTAMPTZ,
  p_tipo_documento TEXT, p_veredito TEXT, p_resumo TEXT, p_anexos INTEGER,
  p_motivo TEXT, p_recomendacao TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _msg UUID; _proj public.projects%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra e-mails lidos';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;

  INSERT INTO public.portal_email_mensagens
    (tenant_id, account_id, run_id, message_id, protocolo, project_id, assunto, remetente,
     recebido_em, tipo_documento, veredito, resumo, anexos, motivo)
  VALUES
    (_conta.tenant_id, p_account_id, p_run_id, p_message_id, p_protocolo, p_project_id,
     left(p_assunto, 300), left(p_remetente, 200), p_recebido_em, p_tipo_documento,
     p_veredito, left(p_resumo, 2000), coalesce(p_anexos, 0), left(p_motivo, 500))
  ON CONFLICT (account_id, message_id) DO NOTHING
  RETURNING id INTO _msg;
  IF _msg IS NULL THEN RETURN NULL; END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT * INTO _proj FROM public.projects WHERE id = p_project_id;
    INSERT INTO public.portal_updates
      (tenant_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
       project_id, casamento, recomendacao, situacao, detectado_em, raw)
    VALUES
      (_conta.tenant_id, p_account_id, p_protocolo, NULL,
       upper(coalesce(p_tipo_documento, 'e-mail')) ||
         coalesce(' · ' || upper(p_veredito), ''),
       _proj.status::text, p_project_id, 'protocolo', p_recomendacao, 'pendente', now(),
       jsonb_build_object('assunto', p_assunto, 'remetente', p_remetente,
                          'resumo', p_resumo, 'anexos', coalesce(p_anexos, 0)));
  END IF;
  RETURN _msg;
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_email_credencial(UUID)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_protocolos(UUID)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_regras(UUID)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_mensagem_nova(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_registrar(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ludmilla_email_credencial(UUID)      TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_protocolos(UUID)      TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_regras(UUID)          TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_mensagem_nova(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_registrar(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO service_role;

-- ── 9. A conta da EDP e as regras observadas em set–out/2026 ─────────────────
-- A concessionária EDP com projetos é a que tem mais projetos ativos no tenant.
INSERT INTO public.portal_accounts (tenant_id, concessionaire_id, connector, acompanhamento, modo, situacao, enabled)
SELECT c.tenant_id, c.id, 'edp', 'email', 'vps', 'ok', TRUE
  FROM public.energy_concessionaires c
 WHERE c.name ILIKE '%elektro%' IS NOT TRUE AND c.name ILIKE 'EDP%'
   AND (SELECT count(*) FROM public.projects p
         WHERE p.concessionaire_id = c.id AND NOT p.is_deleted AND p.archived_at IS NULL) > 0
   AND NOT EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.concessionaire_id = c.id)
 ORDER BY (SELECT count(*) FROM public.projects p WHERE p.concessionaire_id = c.id) DESC
 LIMIT 1;

INSERT INTO public.portal_email_regras (tenant_id, account_id, remetente, assunto, tipo_documento, anexar, ler_pdf, ordem)
SELECT a.tenant_id, a.id, r.remetente, r.assunto, r.tipo, r.anexar, r.ler, r.ordem
  FROM public.portal_accounts a
 CROSS JOIN (VALUES
   ('relacionamento.edp',   'ENVIO DE PARECER', 'parecer',     TRUE,  TRUE,  1),
   ('edpdocumentoporemail', 'CARTA DE OBRAS',   'carta_obras', TRUE,  FALSE, 2),
   (NULL,                   'NOTA -',           'nota',        TRUE,  FALSE, 3)
 ) AS r(remetente, assunto, tipo, anexar, ler, ordem)
 WHERE a.connector = 'edp'
   AND NOT EXISTS (SELECT 1 FROM public.portal_email_regras x WHERE x.account_id = a.id);
```

- [ ] **Passo 2: Aplicar e conferir**

```bash
npx -y supabase db query --linked -f supabase/migrations/20261002120000_ludmilla_email_edp.sql
```

Depois, conferir que a conta e as regras nasceram:

```sql
-- salvar como /tmp/confere.sql e rodar com o mesmo comando
select a.connector, a.acompanhamento, count(r.id) as regras
  from public.portal_accounts a
  left join public.portal_email_regras r on r.account_id = a.id
 group by 1, 2;
```
Esperado: uma linha `edp | email | 3` e uma linha `cpfl | portal | 0`.

- [ ] **Passo 3: Commitar**

```bash
git add supabase/migrations/20261002120000_ludmilla_email_edp.sql
git commit -m "feat(banco): acompanhamento por e-mail, regras da EDP e RPCs da Ludmilla"
```

---

### Task 3: Leitor da caixa (IMAP)

Conecta, procura por protocolo e devolve as mensagens com os anexos já em memória. A parte que dá para testar sem rede — extrair os dados de um e-mail parseado — fica numa função pura, exercitada com um `.eml` de mentira.

**Arquivos:**
- Criar: `worker/ludmilla/src/email/caixa.ts`
- Criar: `worker/ludmilla/test/email-caixa.test.ts`
- Modificar: `worker/ludmilla/package.json` (dependências `imapflow` e `mailparser`)

**Interfaces:**
- Consome: `chaveProtocolo` da Task 1.
- Produz: `interface MensagemLida { messageId: string; assunto: string; remetente: string; recebidoEm: Date | null; texto: string; anexos: { nome: string; mime: string; bytes: Buffer }[] }` · `extrairMensagem(parsed: ParsedMail, uid: number): MensagemLida` · `abrirCaixa(c: { email: string; senha: string }): Promise<Caixa>` · `interface Caixa { procurar(protocolo: string): Promise<number[]>; baixar(uids: number[]): AsyncGenerator<MensagemLida>; fechar(): Promise<void> }`

- [ ] **Passo 1: Instalar as dependências**

```bash
cd worker/ludmilla && npm i imapflow mailparser && npm i -D @types/mailparser
```

- [ ] **Passo 2: Escrever o teste que falha**

```ts
// worker/ludmilla/test/email-caixa.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { extrairMensagem } from '../src/email/caixa.js';

const EML = [
  'From: "Relacionamento EDP" <relacionamento.edp@edp.com.br>',
  'To: projetos@exemplo.com.br',
  'Subject: ENVIO DE PARECER - NOTA 45006443920',
  'Date: Wed, 10 Sep 2026 09:12:00 -0300',
  'Message-ID: <abc-123@edp.com.br>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="X"',
  '',
  '--X',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Segue o parecer de acesso do titular WERLHE DE ARAUJO LIMA.',
  '',
  '--X',
  'Content-Type: application/pdf; name="parecer.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="parecer.pdf"',
  '',
  'JVBERi0xLjQK',
  '',
  '--X--',
  '',
].join('\r\n');

test('extrairMensagem lê assunto, remetente, texto e anexos', async () => {
  const m = extrairMensagem(await simpleParser(EML), 7);
  assert.equal(m.messageId, '<abc-123@edp.com.br>');
  assert.equal(m.assunto, 'ENVIO DE PARECER - NOTA 45006443920');
  assert.ok(m.remetente.includes('relacionamento.edp@edp.com.br'));
  assert.ok(m.texto.includes('WERLHE DE ARAUJO LIMA'));
  assert.equal(m.anexos.length, 1);
  assert.equal(m.anexos[0].nome, 'parecer.pdf');
  assert.equal(m.anexos[0].mime, 'application/pdf');
  assert.ok(m.anexos[0].bytes.length > 0);
});

test('mensagem sem Message-ID cai para o uid, para não repetir', async () => {
  const semId = EML.replace('Message-ID: <abc-123@edp.com.br>\r\n', '');
  const m = extrairMensagem(await simpleParser(semId), 42);
  assert.equal(m.messageId, 'imap-uid-42');
});
```

- [ ] **Passo 3: Rodar e ver falhar**

```bash
cd worker/ludmilla && npx tsc -p tsconfig.test.json
```
Esperado: FALHA — `Cannot find module '../src/email/caixa.js'`.

- [ ] **Passo 4: Escrever a implementação**

```ts
// worker/ludmilla/src/email/caixa.ts
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { chaveProtocolo } from './util.js';

/**
 * A caixa de e-mail, só de leitura. A mesma caixa do Claudinho: nunca marcar
 * como lido, mover ou apagar — a Ludmilla só olha.
 */

export interface MensagemLida {
  messageId: string;
  assunto: string;
  remetente: string;
  recebidoEm: Date | null;
  texto: string;
  anexos: { nome: string; mime: string; bytes: Buffer }[];
}

/** Puro: o que interessa de um e-mail já parseado. Testado com .eml de mentira. */
export function extrairMensagem(p: ParsedMail, uid: number): MensagemLida {
  const anexos = (p.attachments ?? [])
    .filter(a => a.content && (a.filename ?? '').trim() !== '')
    .map(a => ({
      nome: String(a.filename),
      mime: a.contentType || 'application/octet-stream',
      bytes: Buffer.from(a.content as Buffer),
    }));
  return {
    messageId: (p.messageId ?? '').trim() || `imap-uid-${uid}`,
    assunto: (p.subject ?? '').trim(),
    remetente: p.from?.text ?? '',
    recebidoEm: p.date ?? null,
    texto: (p.text ?? '').replace(/\s+/g, ' ').trim(),
    anexos,
  };
}

export interface Caixa {
  /** uids das mensagens cujo assunto OU corpo tem o número do protocolo. */
  procurar(protocolo: string): Promise<number[]>;
  baixar(uids: number[]): AsyncGenerator<MensagemLida>;
  fechar(): Promise<void>;
}

export async function abrirCaixa(c: { email: string; senha: string }): Promise<Caixa> {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: c.email, pass: c.senha.replace(/\s+/g, '') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  return {
    async procurar(protocolo: string): Promise<number[]> {
      const n = chaveProtocolo(protocolo);
      if (n.length < 8) return [];
      try {
        const uids = await client.search({ or: [{ subject: n }, { body: n }] }, { uid: true });
        return (uids as number[]) ?? [];
      } catch {
        return [];
      }
    },
    async *baixar(uids: number[]): AsyncGenerator<MensagemLida> {
      if (uids.length === 0) return;
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
        let p: ParsedMail;
        try { p = await simpleParser(msg.source as Buffer); } catch { continue; }
        yield extrairMensagem(p, msg.uid);
      }
    },
    async fechar(): Promise<void> {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
}
```

- [ ] **Passo 5: Rodar os testes e ver passar**

```bash
cd worker/ludmilla && npm test
```
Esperado: os 2 testes novos passam, **`fail 0`** (total 73).

- [ ] **Passo 6: Commitar**

```bash
git add worker/ludmilla/src/email/caixa.ts worker/ludmilla/test/email-caixa.test.ts worker/ludmilla/package.json worker/ludmilla/package-lock.json
git commit -m "feat(ludmilla): leitor da caixa por IMAP, com busca por protocolo"
```

---

### Task 4: Edge function `ludmilla-parecer` — ler o PDF

Recebe o PDF do parecer e devolve veredito, resumo e os dados que reforçam a conferência.

**Arquivos:**
- Criar: `supabase/functions/ludmilla-parecer/index.ts`

**Interfaces:**
- Consome: segredo `ANTHROPIC_API_KEY` (já existe no projeto).
- Produz: `POST /ludmilla-parecer` com `{ pdf_base64: string, nome_arquivo: string, protocolo: string }` → `{ ok: true, veredito: 'favoravel'|'pendencia'|'inconclusivo', resumo: string, pendencias: string[], titular: string|null, endereco: string|null }`

- [ ] **Passo 1: Escrever a função**

```ts
// supabase/functions/ludmilla-parecer/index.ts
// Lê o parecer de acesso (PDF) e diz se é favorável ou tem pendência.
// Mesmo padrão de chamada do datasheet-extract (documento em base64).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MODELO_IA = 'claude-sonnet-5'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }, 500)

  let body: { pdf_base64?: string; nome_arquivo?: string; protocolo?: string }
  try { body = await req.json() } catch { return json({ ok: false, error: 'corpo inválido' }, 400) }
  if (!body.pdf_base64) return json({ ok: false, error: 'pdf_base64 é obrigatório' }, 400)

  const prompt = [
    'Você está lendo um PARECER DE ACESSO da distribuidora EDP para um projeto de geração distribuída.',
    `Protocolo/nota esperado: ${body.protocolo ?? '(não informado)'}.`,
    '',
    'Responda SOMENTE com um JSON, sem texto em volta, neste formato:',
    '{"veredito":"favoravel|pendencia|inconclusivo","resumo":"uma frase em português",',
    ' "pendencias":["..."],"titular":"nome do titular ou null","endereco":"logradouro e número ou null"}',
    '',
    '- "favoravel": o parecer aprova a conexão (ainda que com condições técnicas normais).',
    '- "pendencia": o parecer pede correção, complementação ou indefere.',
    '- "inconclusivo": não dá para afirmar pelo documento.',
  ].join('\n')

  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO_IA,
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.pdf_base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!resposta.ok) {
    return json({ ok: false, error: `IA respondeu ${resposta.status}`, veredito: 'inconclusivo' }, 200)
  }
  const data = await resposta.json()
  if (data.stop_reason === 'max_tokens') console.error('Resposta cortada por max_tokens', data.usage)

  const texto = (data.content ?? []).filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text).join('')
  const bruto = texto.match(/\{[\s\S]*\}/)?.[0]
  if (!bruto) return json({ ok: true, veredito: 'inconclusivo', resumo: 'não consegui ler o parecer', pendencias: [], titular: null, endereco: null })

  try {
    const r = JSON.parse(bruto)
    const veredito = ['favoravel', 'pendencia', 'inconclusivo'].includes(r.veredito) ? r.veredito : 'inconclusivo'
    return json({
      ok: true, veredito,
      resumo: String(r.resumo ?? '').slice(0, 500),
      pendencias: Array.isArray(r.pendencias) ? r.pendencias.map(String).slice(0, 10) : [],
      titular: r.titular ? String(r.titular).slice(0, 150) : null,
      endereco: r.endereco ? String(r.endereco).slice(0, 200) : null,
    })
  } catch {
    return json({ ok: true, veredito: 'inconclusivo', resumo: 'resposta da IA fora do formato', pendencias: [], titular: null, endereco: null })
  }
})
```

- [ ] **Passo 2: Publicar e testar com um PDF de verdade**

```bash
npx -y supabase functions deploy ludmilla-parecer
```

Testar com um parecer baixado da caixa (qualquer PDF serve para ver o formato da resposta):

```bash
B64=$(base64 -w0 /caminho/parecer.pdf)
curl -s -X POST "$SUPABASE_URL/functions/v1/ludmilla-parecer" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d "{\"pdf_base64\":\"$B64\",\"protocolo\":\"045006443920\"}" | head -c 600
```
Esperado: JSON com `"ok":true` e `veredito` sendo um dos três valores.

- [ ] **Passo 3: Commitar**

```bash
git add supabase/functions/ludmilla-parecer/index.ts
git commit -m "feat(ludmilla): edge function que le o parecer de acesso da EDP"
```

---

### Task 5: O run `varredura_email` no worker

Junta tudo: credencial, protocolos, busca, regras, conferência, anexo, leitura do PDF e recomendação.

**Arquivos:**
- Criar: `worker/ludmilla/src/email/index.ts`
- Modificar: `worker/ludmilla/src/fila.ts` (funções novas de acesso às RPCs)
- Modificar: `worker/ludmilla/src/index.ts` (desviar o run `varredura_email`, como já é feito com `criar_projeto`)

**Interfaces:**
- Consome: `abrirCaixa`, `extrairMensagem`, `MensagemLida` (Task 3); `regraQueCasa`, `protocoloDoAssunto`, `casaTitular`, `casaEndereco`, `recomendacaoDoVeredito`, `RegraEmail`, `Veredito` (Task 1); RPCs da Task 2; `subirDocumento`, `anexoEnviado`, `anexoErro`, `finalizarRun` (já existem em `fila.ts`).
- Produz: `executarVarreduraEmail(run: Run): Promise<void>`

- [ ] **Passo 1: Acrescentar os acessos ao banco em `fila.ts`**

No fim de `worker/ludmilla/src/fila.ts`:

```ts
// ── Acompanhamento por e-mail ────────────────────────────────────────────────

import type { RegraEmail } from './email/util.js';

export interface ProtocoloDeProjeto {
  protocolo: string; project_id: string; company_id: string;
  codigo: string; titular: string | null; endereco: string | null;
}

export async function credencialDaCaixa(accountId: string): Promise<{ email: string; senha: string }> {
  const { data, error } = await supabase().rpc('ludmilla_email_credencial' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui ler o acesso à caixa: ${error.message}`);
  const linha = ((data ?? []) as { email: string; senha: string }[])[0];
  if (!linha?.email || !linha?.senha) {
    throw new Error('O acesso à caixa de e-mail não está configurado para este tenant (agent_config → email_agent).');
  }
  return linha;
}

export async function protocolosDoEmail(accountId: string): Promise<ProtocoloDeProjeto[]> {
  const { data, error } = await supabase().rpc('ludmilla_email_protocolos' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui listar os protocolos: ${error.message}`);
  return (data ?? []) as ProtocoloDeProjeto[];
}

export async function regrasDoEmail(accountId: string): Promise<RegraEmail[]> {
  const { data, error } = await supabase().rpc('ludmilla_email_regras' as never, { p_account_id: accountId } as never);
  if (error) throw new Error(`Não consegui listar as regras de e-mail: ${error.message}`);
  return (data ?? []) as RegraEmail[];
}

export async function mensagemEhNova(accountId: string, messageId: string): Promise<boolean> {
  const { data } = await supabase().rpc('ludmilla_email_mensagem_nova' as never,
    { p_account_id: accountId, p_message_id: messageId } as never);
  return data === true;
}

export async function anexoDeEmail(
  accountId: string, protocolo: string, projectId: string, messageId: string, nomeArquivo: string, conferidoPor: string,
): Promise<AnexoPendente | null> {
  const { data, error } = await supabase().rpc('ludmilla_email_anexo_novo' as never, {
    p_account_id: accountId, p_protocolo: protocolo, p_project_id: projectId,
    p_message_id: messageId, p_nome_arquivo: nomeArquivo, p_conferido_por: conferidoPor,
  } as never);
  if (error) throw new Error(`Não consegui abrir o anexo: ${error.message}`);
  const l = ((data ?? []) as { anexo_id: string; company_id: string; codigo: string }[])[0];
  if (!l) return null;
  return {
    id: l.anexo_id, project_id: projectId, company_id: l.company_id, protocolo,
    id_arquivo: `${messageId}#${nomeArquivo}`, nome_arquivo: nomeArquivo, codigo: l.codigo,
  };
}

export async function registrarEmailLido(p: {
  runId: string; accountId: string; messageId: string; protocolo: string;
  projectId: string | null; assunto: string; remetente: string; recebidoEm: string | null;
  tipoDocumento: string | null; veredito: string | null; resumo: string | null;
  anexos: number; motivo: string | null; recomendacao: string | null;
}): Promise<void> {
  const { error } = await supabase().rpc('ludmilla_email_registrar' as never, {
    p_run_id: p.runId, p_account_id: p.accountId, p_message_id: p.messageId, p_protocolo: p.protocolo,
    p_project_id: p.projectId, p_assunto: p.assunto, p_remetente: p.remetente, p_recebido_em: p.recebidoEm,
    p_tipo_documento: p.tipoDocumento, p_veredito: p.veredito, p_resumo: p.resumo,
    p_anexos: p.anexos, p_motivo: p.motivo, p_recomendacao: p.recomendacao,
  } as never);
  if (error) throw new Error(`Não consegui registrar o e-mail lido: ${error.message}`);
}
```

- [ ] **Passo 2: Escrever o roteiro do run**

```ts
// worker/ludmilla/src/email/index.ts
import { classificarErro } from '../erros.js';
import {
  anexoDeEmail, anexoEnviado, anexoErro, credencialDaCaixa, finalizarRun, mensagemEhNova,
  protocolosDoEmail, registrarEmailLido, regrasDoEmail, subirDocumento,
  type ProtocoloDeProjeto, type Run,
} from '../fila.js';
import { abrirCaixa, type MensagemLida } from './caixa.js';
import {
  casaEndereco, casaTitular, protocoloDoAssunto, recomendacaoDoVeredito, regraQueCasa,
  type RegraEmail, type Veredito,
} from './util.js';

/**
 * Run `varredura_email`: parte dos PROJETOS (ao contrário do Claudinho, que
 * varre por remetente). Para cada protocolo em andamento, procura o número na
 * caixa, aplica as regras do banco, confere, anexa no card e recomenda a etapa.
 * Nunca move card, nunca escreve na caixa.
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

interface Conferencia { ok: boolean; por: string; motivo: string | null }

/** Protocolo é obrigatório; titular e endereço reforçam quando aparecem, e divergência barra. */
export function conferir(p: ProtocoloDeProjeto, texto: string, doPdf: { titular: string | null; endereco: string | null }): Conferencia {
  const titularEmail = doPdf.titular ?? texto;
  const enderecoEmail = doPdf.endereco ?? texto;

  if (p.titular && titularEmail) {
    if (casaTitular(p.titular, titularEmail)) return { ok: true, por: 'titular', motivo: null };
    if (doPdf.titular) {
      return { ok: false, por: 'titular', motivo: `o parecer é de "${doPdf.titular}" e o projeto é de "${p.titular}"` };
    }
  }
  if (p.endereco && enderecoEmail && casaEndereco(p.endereco, enderecoEmail)) {
    return { ok: true, por: 'endereco', motivo: null };
  }
  if (doPdf.endereco && p.endereco && !casaEndereco(p.endereco, doPdf.endereco)) {
    return { ok: false, por: 'endereco', motivo: `o parecer é do endereço "${doPdf.endereco}" e o projeto é "${p.endereco}"` };
  }
  return { ok: true, por: 'protocolo', motivo: null };
}

async function lerParecer(pdf: Buffer, protocolo: string): Promise<{ veredito: Veredito; resumo: string; titular: string | null; endereco: string | null }> {
  const url = `${process.env.SUPABASE_URL}/functions/v1/ludmilla-parecer`;
  const vazio = { veredito: 'inconclusivo' as Veredito, resumo: 'não consegui ler o parecer', titular: null, endereco: null };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ pdf_base64: pdf.toString('base64'), protocolo }),
    });
    if (!r.ok) return vazio;
    const d = await r.json() as { veredito?: Veredito; resumo?: string; titular?: string | null; endereco?: string | null };
    return {
      veredito: d.veredito ?? 'inconclusivo',
      resumo: d.resumo ?? '',
      titular: d.titular ?? null,
      endereco: d.endereco ?? null,
    };
  } catch {
    return vazio;
  }
}

async function tratarMensagem(
  run: Run, p: ProtocoloDeProjeto, m: MensagemLida, regras: RegraEmail[],
): Promise<'anexado' | 'ignorado' | 'bloqueado'> {
  const regra = regraQueCasa(regras, m.assunto, m.remetente);
  const comum = {
    runId: run.id, accountId: run.account_id, messageId: m.messageId, protocolo: p.protocolo,
    assunto: m.assunto, remetente: m.remetente, recebidoEm: m.recebidoEm?.toISOString() ?? null,
  };
  if (!regra) {
    await registrarEmailLido({ ...comum, projectId: null, tipoDocumento: null, veredito: null, resumo: null, anexos: 0, motivo: 'nenhuma regra casa com este assunto/remetente', recomendacao: null });
    return 'ignorado';
  }

  // o parecer é lido ANTES de anexar: o titular/endereço que ele traz entram na conferência
  const pdfs = m.anexos.filter(a => /pdf$/i.test(a.mime) || /\.pdf$/i.test(a.nome));
  const doPdf = regra.ler_pdf && pdfs.length > 0
    ? await lerParecer(pdfs[0].bytes, p.protocolo)
    : { veredito: null as Veredito | null, resumo: '', titular: null, endereco: null };

  const c = conferir(p, m.texto, { titular: doPdf.titular, endereco: doPdf.endereco });
  if (!c.ok) {
    await registrarEmailLido({ ...comum, projectId: p.project_id, tipoDocumento: regra.tipo_documento, veredito: doPdf.veredito, resumo: doPdf.resumo, anexos: 0, motivo: `não anexei: ${c.motivo}`, recomendacao: null });
    log('anexo bloqueado pela conferência', { protocolo: p.protocolo, motivo: c.motivo });
    return 'bloqueado';
  }

  let anexados = 0;
  if (regra.anexar) {
    for (const a of m.anexos) {
      const pendente = await anexoDeEmail(run.account_id, p.protocolo, p.project_id, m.messageId, a.nome, c.por);
      if (!pendente) continue;
      try {
        const caminho = await subirDocumento(pendente, a.bytes, a.mime);
        await anexoEnviado(pendente.id, caminho, a.mime);
        anexados++;
      } catch (e) {
        await anexoErro(pendente.id, (e as Error).message);
      }
    }
  }

  await registrarEmailLido({
    ...comum, projectId: p.project_id, tipoDocumento: regra.tipo_documento,
    veredito: doPdf.veredito, resumo: doPdf.resumo, anexos: anexados, motivo: null,
    recomendacao: recomendacaoDoVeredito(regra.tipo_documento, doPdf.veredito),
  });
  log('e-mail tratado', { projeto: p.codigo, tipo: regra.tipo_documento, veredito: doPdf.veredito, anexados });
  return 'anexado';
}

export async function executarVarreduraEmail(run: Run): Promise<void> {
  log('varredura por e-mail iniciada', { run: run.id });
  let caixa: Awaited<ReturnType<typeof abrirCaixa>> | null = null;
  try {
    const creds = await credencialDaCaixa(run.account_id);
    const protocolos = await protocolosDoEmail(run.account_id);
    const regras = await regrasDoEmail(run.account_id);
    if (regras.length === 0) {
      throw new Error('Esta concessionária não tem regras de e-mail cadastradas na tela da Ludmilla.');
    }
    caixa = await abrirCaixa(creds);

    let lidos = 0, anexados = 0, ignorados = 0, bloqueados = 0;
    for (const p of protocolos) {
      const uids = await caixa.procurar(p.protocolo);
      if (uids.length === 0) continue;
      for await (const m of caixa.baixar(uids)) {
        // a busca do IMAP é por texto: confere que o protocolo está mesmo no assunto
        if (!protocoloDoAssunto(m.assunto, [p.protocolo])) continue;
        if (!(await mensagemEhNova(run.account_id, m.messageId))) continue;
        lidos++;
        const r = await tratarMensagem(run, p, m, regras);
        if (r === 'anexado') anexados++; else if (r === 'ignorado') ignorados++; else bloqueados++;
      }
    }

    await finalizarRun(run.id, {
      situacao: 'ok', situacaoConta: 'ok',
      protocolos: protocolos.length, mudancas: anexados,
      resultado: { lidos, anexados, ignorados, bloqueados, protocolos: protocolos.length },
    });
    log('varredura por e-mail ok', { run: run.id, lidos, anexados, ignorados, bloqueados });
  } catch (e) {
    const erro = classificarErro(e);
    await finalizarRun(run.id, {
      situacao: 'erro', erro: erro.mensagem,
      situacaoConta: erro.situacaoConta === 'ok' ? undefined : erro.situacaoConta,
    }).catch(err => log('não consegui fechar o run', { erro: (err as Error).message }));
    log('varredura por e-mail com erro', { run: run.id, classe: erro.classe, mensagem: erro.mensagem });
  } finally {
    await caixa?.fechar().catch(() => undefined);
  }
}
```

- [ ] **Passo 3: Desviar o run no laço principal**

Em `worker/ludmilla/src/index.ts`, no import do módulo de criação, acrescentar:

```ts
import { executarVarreduraEmail } from './email/index.js';
```

E, no laço, logo antes do desvio que já existe para `criar_projeto`:

```ts
    if (run.tipo === 'varredura_email') {
      // acompanhamento por e-mail: não usa navegador, fora do laço do Playwright
      await executarVarreduraEmail(run);
      await dormir(5_000);
      continue;
    }
```

- [ ] **Passo 4: Compilar e rodar os testes**

```bash
cd worker/ludmilla && npx tsc --noEmit -p tsconfig.json && npm test
```
Esperado: `tsc` sem erro e **`fail 0`**.

- [ ] **Passo 5: Commitar e publicar**

```bash
git add worker/ludmilla/src/email/index.ts worker/ludmilla/src/fila.ts worker/ludmilla/src/index.ts
git commit -m "feat(ludmilla): run varredura_email — acha pelo protocolo, anexa o parecer e recomenda"
git push origin main
gh workflow run "Ludmilla — deploy do robô na VPS"
```

- [ ] **Passo 6: Primeiro run MANUAL, antes de qualquer agendamento**

Enfileirar um run para a conta da EDP:

```sql
-- /tmp/primeiro-run.sql
insert into public.portal_sync_runs (tenant_id, account_id, tipo, situacao)
select a.tenant_id, a.id, 'varredura_email', 'na_fila'
  from public.portal_accounts a where a.connector = 'edp'
returning id;
```

```bash
npx -y supabase db query --linked -f /tmp/primeiro-run.sql
```

Conferir o resultado (esperado: `ok`, com a contagem de lidos/anexados) e **abrir dois ou três cards** para ver se o PDF certo chegou no projeto certo:

```sql
-- /tmp/confere-run.sql
select m.protocolo, p.code, m.tipo_documento, m.veredito, m.anexos, coalesce(m.motivo,'') as motivo
  from public.portal_email_mensagens m
  left join public.projects p on p.id = m.project_id
 order by m.created_at desc limit 20;
```

---

### Task 6: A tela — como cada concessionária é acompanhada

O cartão passa a dizer o meio, e o da EDP ganha a lista de regras editável.

**Arquivos:**
- Criar: `src/components/ludmilla/RegrasEmail.tsx`
- Modificar: `src/hooks/useLudmilla.ts`
- Modificar: `src/pages/Ludmilla.tsx`

**Interfaces:**
- Consome: tabelas `portal_email_regras` e `portal_email_mensagens` (Task 2).
- Produz: `interface RegraEmail` (front) · `useRegrasEmail(accountId)` · `useSalvarRegraEmail()` · `useApagarRegraEmail()` · `<RegrasEmail accountId tenantId />` · campo `acompanhamento` em `PortalAccount`.

- [ ] **Passo 1: Hooks e tipo**

Em `src/hooks/useLudmilla.ts`, acrescentar `acompanhamento` à interface `PortalAccount`:

```ts
  /** portal = ela entra no site; email = ela lê a caixa */
  acompanhamento: 'portal' | 'email';
```

E, no fim do arquivo:

```ts
// ── Regras de leitura de e-mail por concessionária ───────────────────────────

export interface RegraEmail {
  id: string;
  account_id: string;
  remetente: string | null;
  assunto: string;
  tipo_documento: 'parecer' | 'carta_obras' | 'nota' | 'outro';
  anexar: boolean;
  ler_pdf: boolean;
  ativo: boolean;
  ordem: number;
}

export function useRegrasEmail(accountId: string | null) {
  return useQuery({
    queryKey: ['regras-email', accountId],
    queryFn: async (): Promise<RegraEmail[]> => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('portal_email_regras' as never)
        .select('*')
        .eq('account_id', accountId)
        .order('ordem');
      if (error) throw error;
      return (data ?? []) as RegraEmail[];
    },
    enabled: !!accountId,
    staleTime: 60_000,
  });
}

export function useSalvarRegraEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Partial<RegraEmail> & { account_id: string; tenant_id: string; assunto: string; tipo_documento: string }) => {
      const { error } = r.id
        ? await supabase.from('portal_email_regras' as never).update(r as never).eq('id', r.id)
        : await supabase.from('portal_email_regras' as never).insert(r as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regras-email'], exact: false });
      toast.success('Regra salva. Vale na próxima verificação.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApagarRegraEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('portal_email_regras' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['regras-email'], exact: false }),
    onError: (e: Error) => toast.error(e.message),
  });
}
```

- [ ] **Passo 2: O componente das regras**

```tsx
// src/components/ludmilla/RegrasEmail.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus } from 'lucide-react';
import { useApagarRegraEmail, useRegrasEmail, useSalvarRegraEmail, type RegraEmail } from '@/hooks/useLudmilla';

const TIPOS: RegraEmail['tipo_documento'][] = ['parecer', 'carta_obras', 'nota', 'outro'];

/**
 * O que a Ludmilla procura na caixa desta concessionária. Uma linha = "e-mail
 * com este assunto (e deste remetente, se informado) é um documento deste tipo".
 */
export function RegrasEmail({ accountId, tenantId }: { accountId: string; tenantId: string }) {
  const { data: regras = [] } = useRegrasEmail(accountId);
  const salvar = useSalvarRegraEmail();
  const apagar = useApagarRegraEmail();
  const [assunto, setAssunto] = useState('');
  const [remetente, setRemetente] = useState('');
  const [tipo, setTipo] = useState<RegraEmail['tipo_documento']>('parecer');

  function adicionar() {
    if (!assunto.trim()) return;
    salvar.mutate({
      account_id: accountId, tenant_id: tenantId,
      assunto: assunto.trim(), remetente: remetente.trim() || null,
      tipo_documento: tipo, anexar: true, ler_pdf: tipo === 'parecer',
      ordem: regras.length + 1,
    });
    setAssunto(''); setRemetente('');
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Assunto e remetente que ela procura na caixa. O parecer é lido por IA; os demais só são anexados no card.
      </p>
      {regras.map(r => (
        <div key={r.id} className="flex items-center gap-2 text-xs border rounded-md px-2 py-1.5">
          <span className="font-medium flex-1 truncate">{r.assunto}</span>
          <span className="text-muted-foreground truncate max-w-[9rem]">{r.remetente ?? 'qualquer remetente'}</span>
          <span className="px-1.5 py-0.5 rounded bg-muted">{r.tipo_documento}</span>
          {r.ler_pdf && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">lê o PDF</span>}
          <button type="button" onClick={() => apagar.mutate(r.id)} aria-label={`Apagar regra ${r.assunto}`}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={assunto} onChange={e => setAssunto(e.target.value)} placeholder="Trecho do assunto" className="h-8 w-44" />
        <Input value={remetente} onChange={e => setRemetente(e.target.value)} placeholder="Remetente (opcional)" className="h-8 w-44" />
        <select value={tipo} onChange={e => setTipo(e.target.value as RegraEmail['tipo_documento'])}
                className="h-8 rounded-md border bg-background px-2 text-xs">
          {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={adicionar} disabled={salvar.isPending}>
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Passo 3: Mostrar o meio no cartão**

Em `src/pages/Ludmilla.tsx`, dentro do cartão da conta, logo abaixo da linha da última varredura, acrescentar:

```tsx
              <div className="text-xs text-muted-foreground">
                Acompanho por: <b className="text-foreground">
                  {c.acompanhamento === 'email' ? 'E-mail'
                   : c.modo === 'local' ? 'Portal (estação local)' : 'Portal (VPS)'}
                </b>
              </div>
              {c.acompanhamento === 'email' && (
                <RegrasEmail accountId={c.id} tenantId={c.tenant_id} />
              )}
```

E o botão "Verificar agora" passa a pedir o tipo certo:

```tsx
                onClick={() => pedir.mutate({ accountId: c.id, tipo: c.acompanhamento === 'email' ? 'varredura_email' : 'varredura' })}
```

Acrescentar `'varredura_email'` ao tipo `TipoRun` em `src/hooks/useLudmilla.ts` e o import do componente no topo da página:

```tsx
import { RegrasEmail } from '@/components/ludmilla/RegrasEmail';
```

- [ ] **Passo 4: Verificar**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
```
Esperado: **65** (o baseline — nem mais, nem menos).

```bash
npm run build
```
Esperado: build conclui sem erro.

Abrir `/ludmilla` e conferir: o cartão da CPFL diz "Portal (VPS)", o da EDP diz "E-mail" e lista as 3 regras semeadas; adicionar e apagar uma regra funciona.

- [ ] **Passo 5: Commitar e publicar**

```bash
git add src/components/ludmilla/RegrasEmail.tsx src/hooks/useLudmilla.ts src/pages/Ludmilla.tsx
git commit -m "feat(ludmilla): tela mostra como cada concessionaria e acompanhada e edita as regras de e-mail"
git push origin main
```

---

### Task 7: Documentação e memória

**Arquivos:**
- Modificar: `docs/modules/integrations/ludmilla.md`
- Modificar: `CLAUDE.md` (linha da Ludmilla na tabela de módulos)
- Modificar: `C:\Users\luiza\.claude\projects\...\memory\ludmilla.md`

- [ ] **Passo 1: Seção nova na doc do módulo**

Em `docs/modules/integrations/ludmilla.md`, antes de "## Próximos", acrescentar uma seção "## Acompanhar por e-mail — EDP (02/10/2026)" contendo: a tabela de assuntos/remetentes da §3 da spec, o fluxo do run em 10 passos da §5, a regra de conferência da §6, os nomes das RPCs e das tabelas novas, e o aviso de que a caixa é compartilhada com o Claudinho e é só leitura.

- [ ] **Passo 2: Atualizar o índice**

Em `CLAUDE.md`, trocar a linha da Ludmilla por:

```
| Ludmilla (portais das concessionárias) | 🟡 CPFL pronta (VPS) + criação de projeto; EDP por e-mail; Elektro pela estação local — aguarda aceite; só GD Manager | [modules/integrations/ludmilla](docs/modules/integrations/ludmilla.md) |
```

- [ ] **Passo 3: Atualizar a memória do módulo**

Acrescentar ao arquivo de memória `ludmilla.md` um parágrafo "EDP por e-mail (02/10)": acha pelo protocolo (dígitos sem zeros à esquerda: `045006443920` ≡ nota `45006443920`), regras no banco (`portal_email_regras`) e nunca no código, conferência protocolo + titular/endereço com divergência bloqueando o anexo, caixa compartilhada com o Claudinho e só leitura, e o aviso de rodar o primeiro run à mão antes de agendar. Atualizar também a linha da Ludmilla no `MEMORY.md`.

- [ ] **Passo 4: Commitar**

```bash
git add docs/modules/integrations/ludmilla.md CLAUDE.md
git commit -m "docs(ludmilla): acompanhamento por e-mail da EDP"
git push origin main
```

---

## Depois deste plano (não entra agora)

Agendar a varredura por e-mail no cron só **depois** do primeiro run manual revisado. Portal da EDP, solicitação de vistoria e outras concessionárias por e-mail ficam para entregas próprias.
