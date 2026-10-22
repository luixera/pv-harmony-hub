# Ludmilla — a página vira caixa de decisões — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** trocar a pilha vertical da `/ludmilla` por uma caixa de entrada de decisões (aba "Decidir" com lista compacta + painel de detalhe, A fazer com "Feito" da equipe), com as configurações e o histórico em abas secundárias, no computador e no celular.

**Arquitetura:** banco ganha uma tabela (`portal_afazeres`), uma RPC de escrita (`ludmilla_afazer_feito`), uma de leitura (`ludmilla_linha_do_tempo`) e um acréscimo em `ludmilla_email_avisar`. Toda decisão de tela (o que a linha mostra, filtros, ordem, selos, próximo item, saúde das contas, ações) vira função pura com vitest. Os componentes novos são de apresentação (recebem dados por props) e ficam provados em harness com dados inventados; uns poucos componentes "conectados" ligam os hooks. Só a última tarefa toca `Ludmilla.tsx`.

**Tecnologias:** React 18 + TypeScript + Vite, TailwindCSS + shadcn/ui (Tabs, Sheet, Select), React Query 5, sonner 1.7, Supabase (Postgres, RLS, PL/pgSQL), vitest (ambiente `node`).

**Spec:** `docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md` (o mockup citado nela é privado; não abrir).

## Restrições globais

Valem para TODA tarefa, além do que ela pede.

- **Só a equipe do GD Manager**: a tela usa `useLudmillaDisponivel()`; o banco usa `public.ludmilla_equipe_ok()` (admin/staff de tenant `is_library`). Isolamento de tenant por política **RESTRICTIVE** `tenant_id = public.get_user_tenant_id((SELECT auth.uid()))`, como as outras `portal_*`.
- **Nada muda no que a Ludmilla faz**: `ludmilla_aplicar_update` intocada (md5 do `prosrc` vivo em 22/10/2026: `6183edef6c3f93810282039bdd565a26`); `ludmilla_registro` intocada (`ff561bfc0a7abff9803c2b7ca2893f0c`); identificação, classificação, varredura e o worker (`worker/ludmilla/`) intocados.
- **Única RPC existente alterada**: `ludmilla_email_avisar` (md5 vivo em 22/10/2026: `f86bec4deda9d45e683aa42163e880bc`), que passa a gravar também o "A fazer". Idempotente por mensagem; o sino, o retorno e a EDP continuam iguais. Função reescrita parte SEMPRE do `prosrc` VIVO.
- **"Feito" vale para a equipe toda**, uma vez (`feito_por`, `feito_em`).
- **Ordem da lista: mais antigas primeiro.** Ações em lote ficam FORA (spec §7).
- **Ordem das tarefas**: as Tasks 1–7 criam só arquivos NOVOS. A Task 8 (a única que mexe em `src/pages/Ludmilla.tsx`, e que lê o que a frente da ENEL mudou em `useLudmilla.ts`, `MensagensEmail.tsx` e `ludmillaCartao.ts`) roda **só depois da rodada de fechamento da ENEL**. Nenhuma tarefa deste plano edita `src/hooks/useLudmilla.ts`, `src/components/ludmilla/MensagensEmail.tsx` nem `src/lib/ludmillaCartao.ts`.
- **Verificação de toda tarefa com TypeScript**: antes de mexer, medir `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` (era **65** em 22/10/2026; uma QUEDA grande = falha de parse, não melhoria). No fim, o mesmo número, `npm run build` sem erro e `npm test` com a linha `Tests … passed` e nenhum `failed`.
- **Banco**: `npx -y supabase db query --linked -f arquivo.sql` (só o último SELECT com linhas volta; RPCs com guarda de `service_role` devolvem vazio pelo CLI — ler `prosrc`). RLS se prova com impersonação dentro de `begin; … rollback;`.
- **Prova na tela**: harness com dados inventados (`src/lib/ludmillaCaixa.fixtures.ts`) e dublês, nunca com senha nem com sessão de verdade. Harness apagado ANTES do commit e NUNCA commitado (outras sessões commitam a árvore inteira neste repositório: `git status --short` no fim de cada tarefa não pode listar `harness*`, `src/harness*` nem `vite.harness.config.ts`).
- **Commits**: `git add <caminhos>` + `git commit -F <arquivo-da-mensagem> -- <caminhos>`; a mensagem vai num arquivo do rascunho da sessão, escrito com a ferramenta Write (o heredoc do bash desta máquina come a linha em branco), com linha em branco depois do título e o trailer `Co-Authored-By:` do modelo que executa a tarefa. Conferir com `git show --stat HEAD`. Não mexer no `stash@{0}` (é de outra sessão).
- **Push**: regra da casa (memória `session-workflow`): empurrar ao fim da tarefa só se a `main` local não levar commits de outra frente; se levar, perguntar ao usuário no COMEÇO da resposta.
- **`$RASCUNHO`** nos comandos = o diretório de rascunho (scratchpad) da SUA sessão, nunca dentro do repositório. Os comandos rodam da raiz do repositório.
- **Celular**: `useWindowSize()` — `isMobile` < 640 px, `isDesktop` ≥ 1024 px (fonte única em `src/mobile/breakpoints.ts`). Abaixo de 767 px o `src/index.css` dá `min-height: 48px` a todo botão: nunca pôr `minHeight` inline menor. `position: sticky` não gruda dentro de `overflow: hidden` — não usar sticky; o rodapé fixo do detalhe é um flex de coluna. A barra de atalhos do app (`BottomNav`, 64 px + área segura) continua visível.
- **Visual**: o do GD Manager (sem skill de estilo, ver `desenvolveLuiz` §2). Textos em português; identificadores em português.

## Decisões tomadas além da spec

1. **"Desfazer" = a decisão espera 8 s antes de ir ao banco** (padrão "desfazer envio"): o item some da lista na hora, o painel vai para a próxima pendente, o aviso mostra "Desfazer" e só depois dos 8 s chama a MESMA RPC de hoje. Nada novo no banco; `ludmilla_aplicar_update` intocada. Sair da página grava na hora; fechar a aba com decisão em espera faz o navegador perguntar.
2. **`portal_afazeres.mensagem_id`** (UUID → `portal_email_mensagens.id`) no lugar do `message_id` da spec, para não confundir com o Message-ID (texto) do e-mail. **`tipo`** (`vistoria_aprovada` | `troca_falhou` | `devolucao` | `aviso`) é deduzido do título do sino dentro da RPC — o worker não muda. Título novo vira `aviso` e a tela mostra o próprio título.
3. **"Este projeto na Ludmilla"** = RPC NOVA `ludmilla_linha_do_tempo(p_project_id, p_limite)`: os ramos de `ludmilla_registro` que têm projeto, mais e-mails lidos e A fazer. `ludmilla_registro` não muda.
4. **"Bloqueado"** = cartão cujo `raw.motivo` abre com "não anexei ·" (a mesma regra de `detalheDoCartaoDeEmail`, da rodada da ENEL). A EDP bloqueada não abre cartão — segue visível em "O que ela leu na caixa", na aba Concessionárias. **"Dispensar"** = Ignorar.
5. **A fazer feito aparece em "Aplicadas"**; "Ignoradas" nunca tem A fazer.
6. **Selos "Documento anexado/bloqueado" nas linhas** vêm do `raw` do cartão de e-mail; na CPFL os anexos e pareceres aparecem só no detalhe.
7. **Celular**: detalhe por cima (Sheet em tela cheia, não modal, com rodapé fixo); lado a lado só a partir de 1024 px. A barra das abas fica logo ACIMA da barra de atalhos do app (as duas visíveis).
8. **O aviso do Desfazer aparece no alto** (não cobre os botões fixos do celular) e é clicável mesmo com o detalhe aberto.
9. **Contador da barra lateral não muda** (só recomendações). A aba "Decidir" conta recomendações + A fazer.
10. **Criações na CPFL** mostram o código do projeto e o número da CPFL (`resultado.node`, senão `projects.cpfl_node_id`).
11. **Migração** com timestamp `20261022200000` (a frente da ENEL já usa `20261022120000`).

## Mapa de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261022200000_ludmilla_afazeres.sql` | 1 | tabela + RLS, `ludmilla_email_avisar` (+A fazer), `ludmilla_afazer_feito`, `ludmilla_linha_do_tempo` |
| `src/lib/ludmillaCaixa.ts` (+ `.test.ts`) | 2 | itens da lista, selos, tipos, filtros, busca, ordem, contagens, próximo item |
| `src/lib/ludmillaCaixa.fixtures.ts` | 2, 3 | dados inventados para testes e harnesses (não entra no app) |
| `src/lib/ludmillaPainel.ts` (+ `.test.ts`) | 3 | saúde das contas, chips, alertas, "o que chegou", ações, textos, UC, criação |
| `src/lib/ludmillaFilaDeDecisoes.ts` (+ `.test.ts`) | 4 | espera de 8 s com Desfazer, descarregar, falha |
| `src/hooks/useFilaDeDecisoes.ts` | 4 | a fila em React: itens ocultos, aviso com Desfazer, `beforeunload` |
| `src/hooks/useLudmillaDecidir.ts` | 5 | consultas novas (A fazer, mensagem, projeto, documentos, linha do tempo, criações) e "Feito" |
| `src/hooks/useCaixaDaLudmilla.ts` | 5 | junta os hooks de hoje + A fazer e devolve os itens |
| `src/hooks/useAgora.ts` | 6 | relógio de minuto para "há X min" |
| `src/components/ludmilla/decidir/visual.ts` | 6 | ícones, cores, data curta |
| `src/components/ludmilla/decidir/LinhaDaCaixa.tsx` | 6 | a linha compacta |
| `src/components/ludmilla/decidir/FiltrosDaCaixa.tsx` | 6 | busca, situação, tipos |
| `src/components/ludmilla/decidir/PainelDeDetalhe.tsx` | 6 | o detalhe (Quem, O que chegou, A sugestão, Ações, linha do tempo) |
| `src/components/ludmilla/decidir/CaixaDeDecisoes.tsx` | 6 | filtros + lista + detalhe ao lado ou por cima |
| `src/components/ludmilla/decidir/AbaDecidir.tsx` | 6 | a cola: seleção, decidir, próximo item |
| `src/components/ludmilla/decidir/AbaDecidirConectada.tsx` | 6 | liga a aba aos hooks |
| `src/components/ludmilla/decidir/DetalheConectado.tsx` | 6 | liga o detalhe aos hooks |
| `src/components/ludmilla/topo/FaixaDeSaude.tsx` | 7 | chips das concessionárias |
| `src/components/ludmilla/topo/AlertasDasContas.tsx` | 7 | alertas urgentes |
| `src/components/ludmilla/topo/BarraDeAbas.tsx` | 7 | abas no celular |
| `src/components/ludmilla/abas/CartaoCaptcha.tsx` | 8 | movido de `Ludmilla.tsx` |
| `src/components/ludmilla/abas/CartaoDaConta.tsx` | 8 | cartão da conta + bloco de e-mail, movidos |
| `src/components/ludmilla/abas/AbaConcessionarias.tsx` | 8 | a aba Concessionárias |
| `src/components/ludmilla/abas/CriacoesCpfl.tsx` | 8 | a aba Criações na CPFL, movida |
| `src/components/ludmilla/abas/RegistroDaLudmilla.tsx` | 8 | a aba Registro, movida |
| `src/pages/Ludmilla.tsx` | 8 | reescrita: casca com topo e abas |
| `docs/modules/integrations/ludmilla.md`, `CLAUDE.md` | 8 | documentação |

---

### Task 1: Banco — "A fazer" da equipe e linha do tempo do projeto

**Files:**
- Create: `supabase/migrations/20261022200000_ludmilla_afazeres.sql`
- Test: `$RASCUNHO/prova_afazeres.sql` (fora do repositório; não commitar)

**Interfaces:**
- Consumes: `public.ludmilla_equipe_ok()`, `public.get_user_tenant_id(uuid)`, tabelas `portal_accounts`, `portal_email_mensagens`, `portal_updates`, `portal_anexos`, `portal_pareceres`, `tasks`, `profiles`, `projects`.
- Produces:
  - tabela `public.portal_afazeres (id uuid, tenant_id uuid, account_id uuid, project_id uuid null, mensagem_id uuid null UNIQUE, tipo text, titulo text, mensagem text, criado_em timestamptz, feito_por uuid null → profiles, feito_em timestamptz null)`; leitura só da equipe; escrita só por RPC.
  - `public.ludmilla_afazer_feito(p_afazer_id uuid) RETURNS boolean` — `true` marcou agora, `false` já estava feito; erro se não existe no tenant.
  - `public.ludmilla_linha_do_tempo(p_project_id uuid, p_limite integer DEFAULT 60) RETURNS TABLE(quando timestamptz, ator text, quem text, acao text, titulo text, detalhe text, situacao text, project_id uuid, projeto text, protocolo text)` — `acao` ∈ as de `ludmilla_registro` + `email`, `afazer`, `afazer_feito`.
  - `public.ludmilla_email_avisar(...)` com a mesma assinatura e o mesmo retorno de hoje.

- [ ] **Step 1: Guardar o estado de antes e conferir o corpo vivo**

Escreva `$RASCUNHO/antes_afazeres.sql`:

```sql
select md5(p.prosrc) as md5_avisar,
       (select md5(prosrc) from pg_proc where proname = 'ludmilla_aplicar_update') as md5_aplicar,
       (select md5(prosrc) from pg_proc where proname = 'ludmilla_registro') as md5_registro,
       pg_get_functiondef(p.oid) as definicao_avisar
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'ludmilla_email_avisar';
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/antes_afazeres.sql" > "$RASCUNHO/antes_afazeres.out"`
Expected: `md5_avisar = f86bec4deda9d45e683aa42163e880bc`, `md5_aplicar = 6183edef6c3f93810282039bdd565a26`, `md5_registro = ff561bfc0a7abff9803c2b7ca2893f0c`. Se o `md5_avisar` for OUTRO, alguém mudou a função: copie o corpo de `definicao_avisar` para a seção 2 da migração do Step 4 e acrescente nele só o bloco marcado `-- NOVO`. Confira também que `ls supabase/migrations | sort | tail -1` é anterior a `20261022200000`; se não for, use o timestamp de agora (`AAAAMMDDHHMMSS`) no nome do arquivo, com o mesmo sufixo.

- [ ] **Step 2: Escrever a prova (o teste)**

Escreva `$RASCUNHO/prova_afazeres.sql`:

```sql
-- PROVA da migração 20261022200000_ludmilla_afazeres — tudo numa transação DESFEITA no fim.
-- Esperado: a tabela final (passo, ok, detalhe) com TODAS as linhas ok = true.
begin;

do $$ begin
  if to_regclass('public.portal_afazeres') is null then
    raise exception 'VERMELHO: a tabela portal_afazeres ainda não existe';
  end if;
end $$;

create temp table _prova (em timestamptz default clock_timestamp(), passo text, ok boolean, detalhe text);
grant insert, select on _prova to authenticated, anon;

create temp table _ctx as
select a.id as conta, a.tenant_id as tenant,
  (select p.id from public.profiles p where p.tenant_id = a.tenant_id and p.role = 'staff' and p.active order by p.id limit 1) as staff_gd,
  (select p.id from public.profiles p where p.tenant_id = a.tenant_id and p.role = 'company' and p.active order by p.id limit 1) as empresa_gd,
  (select p.id from public.profiles p join public.tenants t on t.id = p.tenant_id
    where not t.is_library and p.role in ('admin', 'staff') and p.active order by p.id limit 1) as de_fora,
  (select pr.id from public.projects pr where pr.tenant_id = a.tenant_id order by pr.created_at desc limit 1) as projeto,
  (select u.project_id from public.portal_updates u join public.portal_accounts c on c.id = u.account_id
    where c.connector = 'cpfl' and u.project_id is not null order by u.detectado_em desc limit 1) as projeto_cpfl
from public.portal_accounts a where a.connector = 'enel' limit 1;
grant select on _ctx to authenticated, anon;

insert into _prova (passo, ok, detalhe)
select 'contexto: conta ENEL, staff, empresa, outro tenant e projetos encontrados',
       conta is not null and staff_gd is not null and empresa_gd is not null and de_fora is not null
       and projeto is not null and projeto_cpfl is not null,
       concat_ws(' ', conta, staff_gd, empresa_gd, de_fora, projeto, projeto_cpfl)
from _ctx;

-- a mensagem que o robô já teria aberto (a tentativa abre a linha antes do sino)
insert into public.portal_email_mensagens (tenant_id, account_id, message_id, protocolo, project_id, assunto, concluida, tentativas)
select tenant, conta, 'prova-afazer-20261022@exemplo.test', '', projeto, 'PROVA da migração — pode apagar', false, 1 from _ctx;
insert into public.portal_email_mensagens (tenant_id, account_id, message_id, protocolo, project_id, assunto, concluida, tentativas)
select tenant, conta, 'prova-afazer-20261022-b@exemplo.test', '', null, 'PROVA B — pode apagar', false, 1 from _ctx;

-- ── o robô (service_role) ──────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

insert into _prova (passo, ok, detalhe)
select '1ª chamada do sino avisa a equipe (> 0)', n > 0, n::text
from (select public.ludmilla_email_avisar(c.conta, 'prova-afazer-20261022@exemplo.test', '', c.projeto,
             '📡 PROVA — vistoria aprovada', 'prova da migração 20261022200000 — pode apagar') as n from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select '2ª chamada não avisa de novo (idempotente por mensagem)', n = 0, n::text
from (select public.ludmilla_email_avisar(c.conta, 'prova-afazer-20261022@exemplo.test', '', c.projeto,
             '📡 PROVA — vistoria aprovada', 'prova da migração 20261022200000 — pode apagar') as n from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select 'um A fazer só, tipo vistoria_aprovada, ligado à mensagem e ao projeto',
       count(*) = 1 and bool_and(f.tipo = 'vistoria_aprovada' and f.feito_em is null and f.project_id = (select projeto from _ctx)),
       count(*)::text
from public.portal_afazeres f join public.portal_email_mensagens m on m.id = f.mensagem_id
where m.message_id = 'prova-afazer-20261022@exemplo.test';
insert into _prova (passo, ok, detalhe)
select 'o sino continua: uma notificação por admin/staff do tenant',
       (select count(*) from public.notifications n where n.message = 'prova da migração 20261022200000 — pode apagar')
     = (select count(*) from public.profiles pr where pr.tenant_id = (select tenant from _ctx) and pr.role in ('admin', 'staff')),
       null;

insert into _prova (passo, ok, detalhe)
select 'título desconhecido: avisa mesmo assim', n > 0, n::text
from (select public.ludmilla_email_avisar(c.conta, 'prova-afazer-20261022-b@exemplo.test', '', null,
             '📡 PROVA — título novo', 'prova B — pode apagar') as n from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select 'título desconhecido vira tipo aviso, sem projeto',
       count(*) = 1 and bool_and(f.tipo = 'aviso' and f.project_id is null), count(*)::text
from public.portal_afazeres f where f.mensagem = 'prova B — pode apagar';

create temp table _ids as
select f.id from public.portal_afazeres f where f.mensagem = 'prova da migração 20261022200000 — pode apagar';
grant select on _ids to authenticated, anon;

-- ── staff do GD Manager ────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select staff_gd from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into _prova (passo, ok, detalhe)
select 'equipe do GD vê o A fazer', exists (select 1 from public.portal_afazeres f where f.id = (select id from _ids)), null;
insert into _prova (passo, ok, detalhe)
select '"Feito": o 1º clique marca (true)', public.ludmilla_afazer_feito((select id from _ids)), null;
insert into _prova (passo, ok, detalhe)
select '"Feito": o 2º clique não marca de novo (false)', not public.ludmilla_afazer_feito((select id from _ids)), null;
insert into _prova (passo, ok, detalhe)
select 'quem e quando ficaram gravados (vale para a equipe toda)',
       exists (select 1 from public.portal_afazeres f where f.id = (select id from _ids)
                 and f.feito_por = (select staff_gd from _ctx) and f.feito_em is not null), null;
insert into _prova (passo, ok, detalhe)
select 'linha do tempo do projeto traz o A fazer e o Feito', count(distinct t.acao) = 2, string_agg(distinct t.acao, ',')
from public.ludmilla_linha_do_tempo((select projeto from _ctx), 200) t where t.acao in ('afazer', 'afazer_feito');
insert into _prova (passo, ok, detalhe)
select 'linha do tempo de um projeto da CPFL roda e traz eventos', count(*) > 0, count(*)::text
from public.ludmilla_linha_do_tempo((select projeto_cpfl from _ctx), 60) t;
do $$ begin
  begin
    update public.portal_afazeres set feito_em = null, feito_por = null where id = (select id from _ids);
    insert into _prova (passo, ok, detalhe) values ('escrita direta na tabela é barrada', false, 'o UPDATE passou');
  exception when insufficient_privilege then
    insert into _prova (passo, ok, detalhe) values ('escrita direta na tabela é barrada', true, sqlerrm);
  end;
  begin
    perform public.ludmilla_email_avisar((select conta from _ctx), 'x', '', null, 't', 'm');
    insert into _prova (passo, ok, detalhe) values ('a equipe não toca o sino do robô', false, 'a função aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('a equipe não toca o sino do robô', true, sqlerrm);
  end;
end $$;
reset role;

-- ── empresa integradora do próprio GD Manager ──────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select empresa_gd from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _prova (passo, ok, detalhe)
select 'empresa integradora não vê A fazer', not exists (select 1 from public.portal_afazeres), null;
reset role;

-- ── usuário de OUTRO tenant ─────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select de_fora from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _prova (passo, ok, detalhe)
select 'outro tenant não vê nenhum A fazer', not exists (select 1 from public.portal_afazeres), null;
do $$ begin
  begin
    perform public.ludmilla_afazer_feito((select id from _ids));
    insert into _prova (passo, ok, detalhe) values ('outro tenant não marca Feito', false, 'a função aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('outro tenant não marca Feito', true, sqlerrm);
  end;
  begin
    perform 1 from public.ludmilla_linha_do_tempo((select projeto from _ctx), 10);
    insert into _prova (passo, ok, detalhe) values ('outro tenant não lê a linha do tempo', false, 'a função aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('outro tenant não lê a linha do tempo', true, sqlerrm);
  end;
end $$;
reset role;

-- ── anônimo ─────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.portal_afazeres limit 1;
    insert into _prova (passo, ok, detalhe) values ('anônimo não lê a tabela', false, 'o SELECT passou');
  exception when insufficient_privilege then
    insert into _prova (passo, ok, detalhe) values ('anônimo não lê a tabela', true, sqlerrm);
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

select passo, ok, detalhe from _prova order by em;
rollback;
```

- [ ] **Step 3: Rodar a prova antes da migração (vermelho)**

Run: `npx -y supabase db query --linked -f "$RASCUNHO/prova_afazeres.sql"`
Expected: FALHA com `VERMELHO: a tabela portal_afazeres ainda não existe` (nada é gravado: o erro aborta a transação antes de qualquer sino).

- [ ] **Step 4: Escrever a migração**

Crie `supabase/migrations/20261022200000_ludmilla_afazeres.sql`:

```sql
-- ============================================================================
-- LUDMILLA — o "A fazer" da equipe e a linha do tempo do projeto (22/10/2026)
-- Spec: docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md §4
--
-- 1. portal_afazeres: o aviso que pede ação de uma pessoa (vistoria aprovada,
--    troca do relógio que falhou, e-mail nosso que voltou). Até aqui ele só
--    existia como uma linha em `notifications` POR PESSOA; o "Feito" é da
--    EQUIPE, uma vez. Leitura só da equipe do GD Manager; escrita só por RPC.
-- 2. ludmilla_email_avisar: corpo copiado do prosrc VIVO de 22/10/2026 (md5
--    f86bec4deda9d45e683aa42163e880bc) com UM acréscimo, marcado NOVO: grava o
--    "A fazer" da mensagem. O sino, o retorno (quantas pessoas avisadas) e o
--    guarda de service_role não mudam. Idempotente por mensagem, como o
--    `aviso_em`: só chega ao acréscimo quem acabou de preencher `aviso_em`, e a
--    UNIQUE (mensagem_id) segura o resto.
-- 3. ludmilla_afazer_feito(id): marca para a equipe toda.
-- 4. ludmilla_linha_do_tempo(projeto, limite): "Este projeto na Ludmilla". Os
--    ramos de `ludmilla_registro` que têm projeto (copiados do prosrc vivo, md5
--    ff561bfc0a7abff9803c2b7ca2893f0c), mais e-mails lidos e A fazer. Só leitura.
--
-- NÃO mexe em ludmilla_aplicar_update, ludmilla_registro, identificação,
-- classificação, varredura nem no worker.
-- ============================================================================

-- ── 1. A tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_afazeres (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- a mensagem lida (portal_email_mensagens.id), NÃO o Message-ID do e-mail
  mensagem_id  UUID REFERENCES public.portal_email_mensagens(id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL DEFAULT 'aviso'
               CHECK (tipo IN ('vistoria_aprovada', 'troca_falhou', 'devolucao', 'aviso')),
  titulo       TEXT NOT NULL,
  mensagem     TEXT NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  feito_por    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  feito_em     TIMESTAMPTZ,
  CONSTRAINT portal_afazeres_mensagem_unica UNIQUE (mensagem_id),
  -- quem fez só existe com quando (o inverso pode: a pessoa foi apagada)
  CONSTRAINT portal_afazeres_feito_coerente CHECK (feito_por IS NULL OR feito_em IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_portal_afazeres_pendentes
  ON public.portal_afazeres (tenant_id, criado_em) WHERE feito_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_afazeres_projeto
  ON public.portal_afazeres (project_id);

ALTER TABLE public.portal_afazeres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.portal_afazeres;
CREATE POLICY tenant_isolation ON public.portal_afazeres
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((SELECT auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((SELECT auth.uid())));

DROP POLICY IF EXISTS equipe_le_afazeres ON public.portal_afazeres;
CREATE POLICY equipe_le_afazeres ON public.portal_afazeres
  FOR SELECT USING ((SELECT public.ludmilla_equipe_ok()));

-- nenhuma política de escrita: só as RPCs SECURITY DEFINER escrevem
REVOKE ALL ON public.portal_afazeres FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.portal_afazeres FROM authenticated;
GRANT SELECT ON public.portal_afazeres TO authenticated;

-- ── 2. O sino passa a gravar o A fazer ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_email_avisar(p_account_id uuid, p_message_id text, p_protocolo text, p_project_id uuid, p_titulo text, p_mensagem text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- NOVO (22/10/2026): o "A fazer" da EQUIPE — uma linha por mensagem, que
  -- qualquer pessoa marca como feita para todos. O `tipo` sai do título que o
  -- robô manda (worker/ludmilla/src/email/enel/decidir.ts, `avisosEnel`);
  -- título que ninguém previu vira 'aviso' e a tela mostra o próprio título.
  INSERT INTO public.portal_afazeres (tenant_id, account_id, project_id, mensagem_id, tipo, titulo, mensagem)
  VALUES (_conta.tenant_id, p_account_id,
          (SELECT x.id FROM public.projects x WHERE x.id = p_project_id AND x.tenant_id = _conta.tenant_id),
          _msg,
          CASE
            WHEN p_titulo ILIKE '%voltou%' THEN 'devolucao'
            WHEN p_titulo ILIKE '%vistoria%aprovada%' THEN 'vistoria_aprovada'
            WHEN p_titulo ILIKE '%rel_gio%' THEN 'troca_falhou'
            ELSE 'aviso'
          END,
          left(p_titulo, 200), left(p_mensagem, 1000))
  ON CONFLICT (mensagem_id) DO NOTHING;

  RETURN _n;
END;
$function$;
REVOKE ALL ON FUNCTION public.ludmilla_email_avisar(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_avisar(uuid, text, text, uuid, text, text) TO service_role;

-- ── 3. "Feito" para a equipe toda ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_afazer_feito(p_afazer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (SELECT auth.uid()); _tenant UUID; _n INTEGER;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  UPDATE public.portal_afazeres
     SET feito_por = _uid, feito_em = now()
   WHERE id = p_afazer_id AND tenant_id = _tenant AND feito_em IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 1 THEN RETURN TRUE; END IF;

  -- já estava feito (outra pessoa, ou clique duplo): o estado é o que se pediu
  IF EXISTS (SELECT 1 FROM public.portal_afazeres WHERE id = p_afazer_id AND tenant_id = _tenant) THEN
    RETURN FALSE;
  END IF;
  RAISE EXCEPTION 'Aviso não encontrado.';
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_afazer_feito(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_afazer_feito(UUID) TO authenticated;

-- ── 4. "Este projeto na Ludmilla" ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_linha_do_tempo(p_project_id UUID, p_limite INTEGER DEFAULT 60)
RETURNS TABLE(quando timestamptz, ator text, quem text, acao text, titulo text, detalhe text,
              situacao text, project_id uuid, projeto text, protocolo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _tenant UUID; _codigo TEXT;
BEGIN
  IF NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id((SELECT auth.uid()));
  SELECT pr.code INTO _codigo FROM public.projects pr WHERE pr.id = p_project_id AND pr.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;

  RETURN QUERY
  WITH eventos AS (
    -- recomendações que ela levantou (ramo de ludmilla_registro, filtrado pelo projeto)
    SELECT u.detectado_em AS quando, 'ludmilla'::text AS ator, 'Ludmilla'::text AS quem,
           'recomendacao'::text AS acao,
           ('Mudança no portal: ' || u.status_portal)::text AS titulo,
           ('Protocolo ' || u.protocolo || coalesce(' · ' || u.titular_portal, '')
             || coalesce(' · sugere ' || u.recomendacao, ' · sem etapa sugerida')
             || CASE WHEN u.casamento IS NOT NULL AND u.casamento <> 'protocolo' THEN ' · casado por ' || u.casamento ELSE '' END)::text AS detalhe,
           'ok'::text AS situacao, u.protocolo::text AS protocolo
      FROM public.portal_updates u
     WHERE u.tenant_id = _tenant AND u.project_id = p_project_id

    UNION ALL
    -- o que a equipe decidiu sobre cada recomendação
    SELECT u.aplicada_em, 'equipe', coalesce(p.name, 'equipe'),
           CASE WHEN u.situacao = 'aplicada' THEN 'aplicada' ELSE 'ignorada' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'Recomendação aplicada' ELSE 'Recomendação ignorada' END,
           'Protocolo ' || u.protocolo
             || CASE WHEN u.situacao = 'aplicada' THEN coalesce(' → ' || u.recomendacao, '') ELSE '' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'ok' ELSE 'aviso' END,
           u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.profiles p ON p.id = u.aplicada_por
     WHERE u.tenant_id = _tenant AND u.project_id = p_project_id
       AND u.situacao IN ('aplicada', 'ignorada') AND u.aplicada_em IS NOT NULL

    UNION ALL
    -- anexos que ela trouxe para o card
    SELECT coalesce(x.enviado_em, x.created_at), 'ludmilla', 'Ludmilla', 'anexo',
           CASE x.situacao WHEN 'enviado' THEN 'Anexo da concessionária no card'
                           WHEN 'bloqueado' THEN 'Anexo bloqueado (titular/UC não conferem)'
                           WHEN 'erro' THEN 'Anexo falhou' ELSE 'Anexo pendente' END,
           x.nome_arquivo || ' · protocolo ' || x.protocolo || coalesce(' · ' || x.motivo, '')
             || coalesce(' · conferido por ' || x.conferido_por, ''),
           CASE x.situacao WHEN 'enviado' THEN 'ok' WHEN 'erro' THEN 'erro' ELSE 'aviso' END,
           x.protocolo
      FROM public.portal_anexos x
     WHERE x.tenant_id = _tenant AND x.project_id = p_project_id

    UNION ALL
    -- pareceres do portal virando comentário no card
    SELECT pa.created_at, 'ludmilla', 'Ludmilla', 'parecer', 'Parecer da concessionária no card',
           coalesce(pa.analise || ' · ', '') || coalesce(pa.status, '') || ' · protocolo ' || pa.protocolo,
           'ok', pa.protocolo
      FROM public.portal_pareceres pa
     WHERE pa.tenant_id = _tenant AND pa.project_id = p_project_id

    UNION ALL
    -- tarefas encerradas porque o projeto mudou de etapa
    SELECT k.completed_at,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'ludmilla' ELSE 'equipe' END,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'Ludmilla' ELSE coalesce(p.name, 'equipe') END,
           'tarefa_encerrada', 'Tarefa encerrada: ' || k.title,
           regexp_replace(split_part(k.description, '✅ ', 2), E'\\s+', ' ', 'g'),
           'ok', NULL::text
      FROM public.tasks k
      LEFT JOIN public.profiles p ON p.id = k.completed_by
     WHERE k.tenant_id = _tenant AND k.project_id = p_project_id AND k.status = 'completed'
       AND k.completed_at IS NOT NULL AND k.description LIKE '%✅ Encerrada%'

    UNION ALL
    -- NOVO: e-mails lidos deste projeto (EDP e ENEL)
    SELECT coalesce(m.recebido_em, m.created_at), 'ludmilla', 'Ludmilla', 'email',
           'E-mail lido: ' || coalesce(nullif(btrim(m.assunto), ''), '(sem assunto)'),
           nullif(concat_ws(' · ', nullif(btrim(m.remetente), ''), nullif(btrim(m.resumo), ''), nullif(btrim(m.motivo), '')), ''),
           CASE WHEN m.motivo IS NOT NULL THEN 'aviso' ELSE 'ok' END,
           nullif(m.protocolo, '')
      FROM public.portal_email_mensagens m
     WHERE m.tenant_id = _tenant AND m.project_id = p_project_id

    UNION ALL
    -- NOVO: o A fazer que ela levantou
    SELECT f.criado_em, 'ludmilla', 'Ludmilla', 'afazer', 'A fazer: ' || f.titulo, f.mensagem, 'aviso', NULL::text
      FROM public.portal_afazeres f
     WHERE f.tenant_id = _tenant AND f.project_id = p_project_id

    UNION ALL
    -- NOVO: quem marcou como feito
    SELECT f.feito_em, 'equipe', coalesce(p.name, 'equipe'), 'afazer_feito', 'Feito: ' || f.titulo, NULL::text, 'ok', NULL::text
      FROM public.portal_afazeres f
      LEFT JOIN public.profiles p ON p.id = f.feito_por
     WHERE f.tenant_id = _tenant AND f.project_id = p_project_id AND f.feito_em IS NOT NULL
  )
  SELECT e.quando, e.ator, e.quem, e.acao, e.titulo, e.detalhe, e.situacao, p_project_id, _codigo, e.protocolo
    FROM eventos e
   WHERE e.quando IS NOT NULL
   ORDER BY e.quando DESC
   LIMIT greatest(1, least(coalesce(p_limite, 60), 200));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_linha_do_tempo(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_linha_do_tempo(UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 5: Aplicar a migração**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261022200000_ludmilla_afazeres.sql`
Expected: sem erro (as migrações da Ludmilla são aplicadas assim e não entram em `schema_migrations`).

- [ ] **Step 6: Rodar a prova (verde)**

Run: `npx -y supabase db query --linked -f "$RASCUNHO/prova_afazeres.sql"`
Expected: a tabela final com 20 linhas e `ok = true` em todas. Se o CLI não devolver as linhas (a API às vezes não devolve resultado antes do `rollback`), troque as duas últimas linhas do arquivo por:

```sql
do $$ declare r text; begin
  select string_agg(passo || ' = ' || ok || coalesce(' (' || detalhe || ')', ''), E'\n' order by em) into r from _prova;
  raise exception E'PROVA\n%', r;
end $$;
```

e rode de novo: o erro "PROVA …" traz a lista e desfaz tudo. Se alguma linha de prova escapar (não deveria), apague com:

```sql
delete from public.portal_afazeres where mensagem in ('prova da migração 20261022200000 — pode apagar', 'prova B — pode apagar');
delete from public.notifications where message in ('prova da migração 20261022200000 — pode apagar', 'prova B — pode apagar');
delete from public.portal_email_mensagens where message_id like 'prova-afazer-20261022%';
```

- [ ] **Step 7: Conferir que o resto ficou intocado**

Run: `npx -y supabase db query --linked -f "$RASCUNHO/antes_afazeres.sql"`
Expected: `md5_aplicar = 6183edef6c3f93810282039bdd565a26` e `md5_registro = ff561bfc0a7abff9803c2b7ca2893f0c` (iguais ao Step 1); `md5_avisar` MUDOU (é o acréscimo).

- [ ] **Step 8: Commit**

Mensagem (`$RASCUNHO/msg-task1.txt`, escrita com a ferramenta Write):

```text
feat(ludmilla): A fazer da equipe e linha do tempo do projeto no banco

O aviso que pede ação (vistoria aprovada, troca do relógio que falhou,
e-mail que voltou) era só uma linha de notifications por pessoa; o "Feito"
precisa ser da equipe, uma vez. portal_afazeres guarda o aviso, a
ludmilla_email_avisar passa a gravá-lo (corpo copiado do prosrc vivo, sino e
retorno iguais) e ludmilla_afazer_feito marca para todos. A
ludmilla_linha_do_tempo alimenta o "Este projeto na Ludmilla" do detalhe.
Aplicar, registro, varredura e worker intocados (md5 conferidos).

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add supabase/migrations/20261022200000_ludmilla_afazeres.sql
git commit -F "$RASCUNHO/msg-task1.txt" -- supabase/migrations/20261022200000_ludmilla_afazeres.sql
git show --stat HEAD
```

---

### Task 2: Lógica pura da caixa — itens, selos, filtros, busca, ordem e próximo item

**Files:**
- Create: `src/lib/ludmillaCaixa.ts`
- Create: `src/lib/ludmillaCaixa.fixtures.ts`
- Test: `src/lib/ludmillaCaixa.test.ts`

**Interfaces:**
- Consumes: `PortalAccount`, `PortalUpdate`, `ProjetoDoCartao` (tipos de `@/hooks/useLudmilla`, só `import type`); `identidadeDoCartao` de `@/lib/ludmillaCartao`.
- Produces (todos exportados de `@/lib/ludmillaCaixa`):
  - tipos `TipoAfazer`, `Afazer`, `SituacaoDoFiltro = 'pendente'|'aplicada'|'ignorada'|'todas'`, `TipoDoFiltro = 'etapa'|'protocolo'|'bloqueado'|'afazer'`, `MeioDoItem = 'portal'|'email'|'estacao'`, `TomDoSelo`, `Selo`, `ItemDaCaixa`, `FiltroDaCaixa`, `EntradaDaCaixa`; constante `FILTRO_INICIAL`.
  - `meioDaConta(c): MeioDoItem` · `normalizar(s): string` · `anexosDoCartao(u): number` · `cartaoBloqueado(u): boolean` · `rotuloDoAfazer(f): string` · `itensDaCaixa(e: EntradaDaCaixa): ItemDaCaixa[]` · `casaBusca(item, busca): boolean` · `ordenarItens(itens): ItemDaCaixa[]` · `filtrarItens(itens, filtro, ocultos?: ReadonlySet<string>): ItemDaCaixa[]` · `contarPendentes(itens, ocultos?): { total: number; porConta: Record<string, number> }` · `proximaDepoisDe(lista, chave): string | null` · `selecaoValida(lista, selecionada, abrirPrimeira: boolean): string | null` · `limparOcultos(ocultos, itens): Set<string>` · `unirPorId<T extends { id: string }>(...listas: T[][]): T[]`.
  - fixtures em `@/lib/ludmillaCaixa.fixtures`: `TENANT`, `AGORA`, `CONTA_CPFL`, `CONTA_EDP`, `CONTA_ENEL`, `CONTA_ELEKTRO`, `CONTAS_DE_EXEMPLO`, `nomeDaContaDeExemplo`, `ETAPAS_DE_EXEMPLO`, `rotuloDeExemplo`, `U_CPFL`, `U_ENEL_TROCA`, `U_ENEL_BLOQUEADO`, `U_EDP`, `U_CPFL_SEM_PROJETO`, `U_APLICADA`, `U_IGNORADA`, `UPDATES_DE_EXEMPLO`, `F_VISTORIA`, `F_DEVOLUCAO`, `F_FEITO`, `AFAZERES_DE_EXEMPLO`, `MENSAGEM_DA_TROCA`.

- [ ] **Step 1: Medir o baseline do tsc**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: `65` (anote o número; é ele que vale no fim da tarefa).

- [ ] **Step 2: Escrever os dados inventados**

Crie `src/lib/ludmillaCaixa.fixtures.ts`:

```ts
/**
 * DADOS INVENTADOS para os testes e os harnesses da página da Ludmilla.
 * Nenhum nome, protocolo, e-mail ou número aqui é de verdade. Código do app
 * NUNCA importa este arquivo.
 */
import type { MensagemEmail, PortalAccount, PortalUpdate } from '@/hooks/useLudmilla';
import type { Afazer } from '@/lib/ludmillaCaixa';

export const TENANT = '00000000-0000-4000-8000-0000000000aa';
/** "Agora" fixo dos testes: 22/10/2026 12:00 UTC. */
export const AGORA = Date.parse('2026-10-22T12:00:00Z');

const conta = (id: string, connector: string, extra: Partial<PortalAccount>): PortalAccount => ({
  id, tenant_id: TENANT, concessionaire_id: `conc-${connector}`, connector, login: 'robo@exemplo.test',
  situacao: 'ok', ultimo_erro: null, ultima_varredura_em: '2026-10-22T11:00:00Z', enabled: true,
  updated_at: '2026-10-22T11:00:00Z', modo: 'vps', operador_local: null, estacao_vista_em: null,
  sessao_viva_desde: null, acompanhamento: 'portal', identificacao: 'protocolo_no_assunto', ...extra,
});

export const CONTA_CPFL = conta('conta-cpfl', 'cpfl', {});
export const CONTA_EDP = conta('conta-edp', 'edp', { acompanhamento: 'email', login: null, ultima_varredura_em: null });
export const CONTA_ENEL = conta('conta-enel', 'enel', {
  acompanhamento: 'email', login: null, identificacao: 'remetente', ultima_varredura_em: '2026-10-22T10:30:00Z',
});
export const CONTA_ELEKTRO = conta('conta-elektro', 'elektro', {
  modo: 'local', situacao: 'sessao_expirada', operador_local: 'op-1',
  estacao_vista_em: '2026-10-22T11:58:00Z', ultima_varredura_em: '2026-10-15T09:00:00Z',
});
export const CONTAS_DE_EXEMPLO = [CONTA_CPFL, CONTA_EDP, CONTA_ENEL, CONTA_ELEKTRO];

const NOMES: Record<string, string> = {
  'conta-cpfl': 'CPFL Paulista', 'conta-edp': 'EDP São Paulo', 'conta-enel': 'ENEL SP', 'conta-elektro': 'Elektro',
};
export const nomeDaContaDeExemplo = (id: string) => NOMES[id] ?? '';

export const ETAPAS_DE_EXEMPLO = [
  { key: 'pending', label: 'Pendente' }, { key: 'analysis', label: 'Em análise' },
  { key: 'documentation', label: 'Documentação' }, { key: 'approval', label: 'Aprovação' },
  { key: 'approved', label: 'Aprovado' }, { key: 'vistoria_solicitada', label: 'Vistoria solicitada' },
  { key: 'pendencia', label: 'Pendência' }, { key: 'completed', label: 'Concluído' },
];
export const rotuloDeExemplo = (s: string | null | undefined) =>
  ETAPAS_DE_EXEMPLO.find(e => e.key === s)?.label ?? (s ?? '—');

const projeto = (id: string, code: string, status: string, titular: string, empresa: string) => ({
  id, code, status, title: titular, companies: { name: empresa }, project_general_data: { holder_name: titular },
});

/** O banco grava `raw.anexos` como NÚMERO; o tipo do hook diz texto. */
const raw = (r: Record<string, unknown>) => r as unknown as Record<string, string>;

const cartao = (id: string, extra: Partial<PortalUpdate>): PortalUpdate => ({
  id, account_id: 'conta-cpfl', protocolo: '0000000', titular_portal: null, status_portal: 'Em Andamento',
  status_anterior: null, project_id: null, casamento: 'protocolo', recomendacao: null, atualizar_protocolo: false,
  protocolo_anterior: null, situacao: 'pendente', aplicada_por: null, aplicada_em: null,
  detectado_em: '2026-10-20T00:00:00Z', raw: null, project: null, ...extra,
});

/** CPFL: Em Andamento → Aprovado; o portal escreve o nome diferente do cadastro. */
export const U_CPFL = cartao('u-cpfl', {
  protocolo: '7001234', titular_portal: 'UFV MARTA RIBEIRO', status_anterior: 'Em Andamento', status_portal: 'Aprovado',
  project_id: 'p-1', recomendacao: 'approved', detectado_em: '2026-10-20T11:00:00Z',
  raw: raw({ 'Última atualização': '19/10/2026' }),
  project: projeto('p-1', 'PRJ-10001', 'analysis', 'Marta Ribeiro Campos', 'Solar Alfa'),
});
/** ENEL: Carta favorável + troca do protocolo pela NT. */
export const U_ENEL_TROCA = cartao('u-enel-troca', {
  account_id: 'conta-enel', protocolo: '900000222', titular_portal: 'João Pedro Lima',
  status_portal: 'CARTA_PROJETO · FAVORAVEL', status_anterior: 'documentation', project_id: 'p-2', casamento: 'uc',
  recomendacao: 'approved', atualizar_protocolo: true, protocolo_anterior: 'Sem protocolo',
  detectado_em: '2026-10-21T09:00:00Z',
  raw: raw({
    assunto: 'Carta de aprovação do projeto', remetente: 'naoresponda@enel.exemplo.test',
    resumo: 'A ENEL aprovou o projeto.', anexos: 1, arquivo_lido: 'carta-900000222.pdf',
    motivo: 'a Carta traz a NT 900000222; o cadastro tem nenhum — o cartão sugere gravar a NT',
  }),
  project: projeto('p-2', 'PRJ-10002', 'documentation', 'João Pedro Lima', 'Sol Nascente'),
});
/** ENEL: o documento é de outra pessoa — bloqueado, sem sugestão. */
export const U_ENEL_BLOQUEADO = cartao('u-enel-bloq', {
  account_id: 'conta-enel', protocolo: '900000333', titular_portal: 'Ana Paula Reis',
  status_portal: 'CARTA_PROJETO · PENDENCIA', status_anterior: 'analysis', project_id: 'p-3', casamento: 'titular',
  detectado_em: '2026-10-19T15:00:00Z',
  raw: raw({
    assunto: 'Carta de pendência', remetente: 'naoresponda@enel.exemplo.test', anexos: 0,
    motivo: 'não anexei · o documento é de "Carlos Souza" e o projeto é de "Ana Paula Reis"',
  }),
  project: projeto('p-3', 'PRJ-10003', 'analysis', 'Ana Paula Reis', 'Solar Alfa'),
});
/** EDP: parecer favorável, 2 documentos no card, protocolo com zero à esquerda. */
export const U_EDP = cartao('u-edp', {
  account_id: 'conta-edp', protocolo: '045006443920', titular_portal: 'Rita de Cássia Prado',
  status_portal: 'PARECER · FAVORAVEL', status_anterior: 'analysis', project_id: 'p-4', recomendacao: 'approved',
  detectado_em: '2026-10-21T14:00:00Z',
  raw: raw({
    assunto: 'Parecer de acesso 045006443920', remetente: 'gd@edp.exemplo.test', resumo: 'Parecer favorável.',
    anexos: 2, motivo: null, arquivo_lido: 'parecer.pdf',
  }),
  project: projeto('p-4', 'PRJ-10004', 'analysis', 'Rita de Cássia Prado', 'Energia Boa'),
});
/** CPFL sem projeto casado e sem sugestão. */
export const U_CPFL_SEM_PROJETO = cartao('u-cpfl-sem', {
  protocolo: '7009999', titular_portal: 'UFV JOSE ALVES', status_portal: 'Pendente', status_anterior: 'Em Andamento',
  detectado_em: '2026-10-21T20:00:00Z',
});
export const U_APLICADA = cartao('u-aplicada', {
  protocolo: '7005555', status_portal: 'Aprovado', project_id: 'p-5', recomendacao: 'approved', situacao: 'aplicada',
  aplicada_por: 'pessoa-1', aplicada_em: '2026-10-18T13:00:00Z', detectado_em: '2026-10-18T11:00:00Z',
  project: projeto('p-5', 'PRJ-10005', 'approved', 'Bruno Teixeira', 'Solar Alfa'),
});
export const U_IGNORADA = cartao('u-ignorada', {
  protocolo: '7006666', status_portal: 'Cancelado', project_id: 'p-6', situacao: 'ignorada',
  aplicada_por: 'pessoa-1', aplicada_em: '2026-10-17T10:00:00Z', detectado_em: '2026-10-17T09:00:00Z',
  project: projeto('p-6', 'PRJ-10006', 'analysis', 'Carla Nunes', 'Sol Nascente'),
});
export const UPDATES_DE_EXEMPLO = [U_CPFL, U_ENEL_TROCA, U_ENEL_BLOQUEADO, U_EDP, U_CPFL_SEM_PROJETO, U_APLICADA, U_IGNORADA];

const afazer = (id: string, extra: Partial<Afazer>): Afazer => ({
  id, tenant_id: TENANT, account_id: 'conta-enel', project_id: null, mensagem_id: null, tipo: 'aviso',
  titulo: '📡 Aviso', mensagem: '', criado_em: '2026-10-20T00:00:00Z', feito_por: null, feito_em: null,
  project: null, feito: null, ...extra,
});
export const F_VISTORIA = afazer('f-vistoria', {
  project_id: 'p-7', tipo: 'vistoria_aprovada', titulo: '📡 Vistoria virtual aprovada na ENEL',
  mensagem: 'A ENEL aprovou o vídeo de anti-ilhamento do projeto PRJ-10007. É hora de pedir a troca do relógio.',
  criado_em: '2026-10-20T08:00:00Z', project: projeto('p-7', 'PRJ-10007', 'approved', 'Diego Martins', 'Energia Boa'),
});
export const F_DEVOLUCAO = afazer('f-devolucao', {
  tipo: 'devolucao', titulo: '📡 Um e-mail nosso voltou',
  mensagem: 'Um dos destinatários de um e-mail não recebeu a mensagem (devolução do servidor).',
  criado_em: '2026-10-22T07:00:00Z',
});
export const F_FEITO = afazer('f-feito', {
  project_id: 'p-8', tipo: 'troca_falhou', titulo: '📡 A ENEL não trocou o relógio',
  mensagem: 'A tentativa de troca do relógio do projeto PRJ-10008 não foi executada.',
  criado_em: '2026-10-16T08:00:00Z', feito_por: 'pessoa-2', feito_em: '2026-10-16T15:00:00Z', feito: { name: 'Bia Souza' },
  project: projeto('p-8', 'PRJ-10008', 'approved', 'Elisa Rocha', 'Solar Alfa'),
});
export const AFAZERES_DE_EXEMPLO = [F_VISTORIA, F_DEVOLUCAO, F_FEITO];

export const MENSAGEM_DA_TROCA: MensagemEmail = {
  id: 'm-1', account_id: 'conta-enel', run_id: null, message_id: 'carta-1@enel.exemplo.test', protocolo: '',
  project_id: 'p-2', assunto: 'Carta de aprovação do projeto', remetente: 'naoresponda@enel.exemplo.test',
  recebido_em: '2026-10-21T08:55:00Z', tipo_documento: 'carta_projeto', veredito: 'favoravel',
  resumo: 'A ENEL aprovou o projeto.', anexos: 1,
  motivo: 'a Carta traz a NT 900000222; o cadastro tem nenhum — o cartão sugere gravar a NT',
  concluida: true, tentativas: 1, arquivo_lido: 'carta-900000222.pdf', update_id: 'u-enel-troca',
  created_at: '2026-10-21T09:00:00Z', project: null,
};
```

- [ ] **Step 3: Escrever o teste que falha**

Crie `src/lib/ludmillaCaixa.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FILTRO_INICIAL, cartaoBloqueado, contarPendentes, filtrarItens, itensDaCaixa, limparOcultos, proximaDepoisDe,
  rotuloDoAfazer, selecaoValida, unirPorId, type ItemDaCaixa,
} from './ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, CONTAS_DE_EXEMPLO, UPDATES_DE_EXEMPLO, U_CPFL, U_EDP, U_ENEL_BLOQUEADO, U_ENEL_TROCA,
  nomeDaContaDeExemplo, rotuloDeExemplo,
} from './ludmillaCaixa.fixtures';

// Todos os nomes e números são inventados (ver o arquivo de fixtures).
const itens = itensDaCaixa({
  updates: UPDATES_DE_EXEMPLO, afazeres: AFAZERES_DE_EXEMPLO, contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (chave: string) => itens.find(i => i.chave === chave)!;
const chaves = (l: ItemDaCaixa[]) => l.map(i => i.chave);
const PENDENTES = ['u:u-enel-bloq', 'f:f-vistoria', 'u:u-cpfl', 'u:u-enel-troca', 'u:u-edp', 'u:u-cpfl-sem', 'f:f-devolucao'];

describe('itensDaCaixa — recomendações e A fazer na mesma lista', () => {
  it('uma linha por recomendação e por aviso, com a origem na chave', () => {
    expect(itens).toHaveLength(10);
    expect(item('u:u-cpfl').origem).toBe('recomendacao');
    expect(item('f:f-vistoria').origem).toBe('afazer');
  });
  it('a linha diz quem é, de qual empresa e de qual concessionária', () => {
    expect(item('u:u-cpfl')).toMatchObject({
      codigo: 'PRJ-10001', projectId: 'p-1', titular: 'Marta Ribeiro Campos', noPortal: 'UFV MARTA RIBEIRO',
      empresa: 'Solar Alfa', concessionaria: 'CPFL Paulista', meio: 'portal', protocolo: '7001234', situacao: 'pendente',
    });
  });
  it('o meio vem da conta', () => {
    expect(item('u:u-edp').meio).toBe('email');
    expect(item('f:f-vistoria').meio).toBe('email');
  });
  it('mudar etapa: selo "de → para" com os rótulos do Kanban', () => {
    expect(item('u:u-cpfl').selos).toEqual([{ texto: 'Em análise → Aprovado', tom: 'etapa' }]);
    expect(item('u:u-cpfl').tipos).toEqual(['etapa']);
  });
  it('troca de protocolo: "Gravar protocolo" e os dois tipos', () => {
    expect(item('u:u-enel-troca').selos.map(s => s.texto)).toEqual(['Documentação → Aprovado', 'Gravar protocolo', 'Documento anexado']);
    expect(item('u:u-enel-troca').tipos).toEqual(['etapa', 'protocolo']);
  });
  it('documento de outra pessoa: só "Documento bloqueado"', () => {
    expect(item('u:u-enel-bloq').selos).toEqual([{ texto: 'Documento bloqueado', tom: 'bloqueado' }]);
    expect(item('u:u-enel-bloq').tipos).toEqual(['bloqueado']);
  });
  it('vários documentos: o número vai no selo', () => {
    expect(item('u:u-edp').selos).toContainEqual({ texto: '2 documentos anexados', tom: 'anexo' });
  });
  it('sem etapa, sem troca e sem bloqueio: "Sem sugestão"; sem projeto, sem código', () => {
    expect(item('u:u-cpfl-sem').selos).toEqual([{ texto: 'Sem sugestão', tom: 'neutro' }]);
    expect(item('u:u-cpfl-sem').tipos).toEqual([]);
    expect(item('u:u-cpfl-sem').codigo).toBeNull();
    expect(item('u:u-cpfl-sem').titular).toBe('UFV JOSE ALVES');
  });
  it('A fazer: selo curto pelo tipo; situação pelo feito_em', () => {
    expect(item('f:f-vistoria').selos).toEqual([{ texto: 'A fazer: pedir a troca do relógio', tom: 'afazer' }]);
    expect(item('f:f-vistoria')).toMatchObject({ situacao: 'pendente', codigo: 'PRJ-10007', titular: 'Diego Martins', tipos: ['afazer'] });
    expect(item('f:f-feito').situacao).toBe('feito');
    expect(item('f:f-devolucao').codigo).toBeNull();
    expect(item('f:f-devolucao').concessionaria).toBe('ENEL SP');
  });
});

describe('cartaoBloqueado — só "não anexei · …"', () => {
  const comMotivo = (motivo: string) => ({
    ...U_ENEL_BLOQUEADO, raw: { assunto: 'x', remetente: 'y', motivo } as unknown as Record<string, string>,
  });
  it('"não anexei · …" e "NAO ANEXEI" são bloqueio', () => {
    expect(cartaoBloqueado(comMotivo('não anexei · o documento é de "X"'))).toBe(true);
    expect(cartaoBloqueado(comMotivo('NAO ANEXEI'))).toBe(true);
  });
  it('"não anexei ainda: …" e "não anexado(s)" não são', () => {
    expect(cartaoBloqueado(comMotivo('não anexei ainda: a IA não leu o documento'))).toBe(false);
    expect(cartaoBloqueado(comMotivo('2 arquivo(s) não anexado(s): o nome traz outro número'))).toBe(false);
  });
  it('cartão do portal, sem motivo, não é', () => {
    expect(cartaoBloqueado(U_CPFL)).toBe(false);
  });
});

describe('rotuloDoAfazer', () => {
  it('tipos conhecidos têm texto próprio', () => {
    expect(rotuloDoAfazer({ tipo: 'troca_falhou', titulo: 'x' })).toBe('A fazer: troca do relógio não executada');
    expect(rotuloDoAfazer({ tipo: 'devolucao', titulo: 'x' })).toBe('A fazer: conferir o e-mail que voltou');
  });
  it('tipo genérico usa o título sem o emoji do sino (e não come letra acentuada)', () => {
    expect(rotuloDoAfazer({ tipo: 'aviso', titulo: '📡 Ótimo aviso novo' })).toBe('A fazer: Ótimo aviso novo');
    expect(rotuloDoAfazer({ tipo: 'aviso', titulo: '📡 ' })).toBe('A fazer');
  });
});

describe('filtrarItens — situação, tipo, concessionária e busca', () => {
  it('Pendentes, mais antigas primeiro', () => {
    expect(chaves(filtrarItens(itens, FILTRO_INICIAL))).toEqual(PENDENTES);
  });
  it('Aplicadas inclui o A fazer feito; Ignoradas só as ignoradas; Todas tudo', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'aplicada' }))).toEqual(['f:f-feito', 'u:u-aplicada']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'ignorada' }))).toEqual(['u:u-ignorada']);
    expect(filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'todas' })).toHaveLength(10);
  });
  it('tipo: qualquer um dos marcados basta', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, tipos: ['afazer'] }))).toEqual(['f:f-vistoria', 'f:f-devolucao']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, tipos: ['protocolo', 'bloqueado'] }))).toEqual(['u:u-enel-bloq', 'u:u-enel-troca']);
  });
  it('concessionária escolhida no chip', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, contaId: 'conta-cpfl' }))).toEqual(['u:u-cpfl', 'u:u-cpfl-sem']);
  });
  it('busca por titular sem acento e sem caixa', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'cassia PRADO' }))).toEqual(['u:u-edp']);
  });
  it('busca por empresa, código e nome do portal', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'sol nascente' }))).toEqual(['u:u-enel-troca']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'prj-10007' }))).toEqual(['f:f-vistoria']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'jose alves' }))).toEqual(['u:u-cpfl-sem']);
  });
  it('busca por protocolo ignora zeros à esquerda (EDP)', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: '45006443920' }))).toEqual(['u:u-edp']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: '0045006443920' }))).toEqual(['u:u-edp']);
  });
  it('o que foi decidido agora (esperando o Desfazer) sai da lista', () => {
    expect(chaves(filtrarItens(itens, FILTRO_INICIAL, new Set(['u:u-cpfl'])))).not.toContain('u:u-cpfl');
  });
});

describe('contarPendentes', () => {
  it('total e por concessionária, sem os ocultos', () => {
    expect(contarPendentes(itens)).toEqual({ total: 7, porConta: { 'conta-enel': 4, 'conta-cpfl': 2, 'conta-edp': 1 } });
    expect(contarPendentes(itens, new Set(['f:f-devolucao'])).porConta['conta-enel']).toBe(3);
  });
});

describe('proximaDepoisDe — o painel vai para a próxima pendente', () => {
  const lista = filtrarItens(itens, FILTRO_INICIAL);
  it('a de baixo', () => expect(proximaDepoisDe(lista, 'u:u-cpfl')).toBe('u:u-enel-troca'));
  it('na última, a de cima', () => expect(proximaDepoisDe(lista, 'f:f-devolucao')).toBe('u:u-cpfl-sem'));
  it('a única: nenhuma', () => expect(proximaDepoisDe(lista.slice(0, 1), 'u:u-enel-bloq')).toBeNull());
  it('pula as já decididas', () => {
    const todas = filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'todas' });
    expect(proximaDepoisDe(todas, 'u:u-enel-bloq')).toBe('f:f-vistoria');
    expect(proximaDepoisDe(todas.slice(0, 4), 'u:u-enel-bloq')).toBeNull();
  });
  it('chave que sumiu da lista: a primeira pendente', () => expect(proximaDepoisDe(lista, 'u:nao-existe')).toBe('u:u-enel-bloq'));
});

describe('selecaoValida', () => {
  const lista = filtrarItens(itens, FILTRO_INICIAL);
  it('mantém a escolhida enquanto ela estiver na lista', () => expect(selecaoValida(lista, 'u:u-edp', true)).toBe('u:u-edp'));
  it('no computador abre a primeira', () => expect(selecaoValida(lista, null, true)).toBe('u:u-enel-bloq'));
  it('no celular não abre nada sozinha', () => {
    expect(selecaoValida(lista, null, false)).toBeNull();
    expect(selecaoValida(lista, 'u:sumiu', false)).toBeNull();
  });
});

describe('limparOcultos', () => {
  it('fica oculto só o que ainda está pendente nos dados', () => {
    expect([...limparOcultos(new Set(['u:u-cpfl', 'u:u-aplicada', 'u:sumiu']), itens)]).toEqual(['u:u-cpfl']);
  });
});

describe('unirPorId', () => {
  it('junta as listas sem repetir, na ordem em que aparecem', () => {
    expect(unirPorId([U_CPFL, U_EDP], [U_EDP, U_ENEL_TROCA]).map(u => u.id)).toEqual(['u-cpfl', 'u-edp', 'u-enel-troca']);
  });
});
```

- [ ] **Step 4: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/ludmillaCaixa.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaCaixa"` (o arquivo ainda não existe).

- [ ] **Step 5: Escrever a implementação**

Crie `src/lib/ludmillaCaixa.ts`:

```ts
/**
 * A CAIXA DE DECISÕES DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md §3.2.
 * A aba "Decidir" é UMA lista com dois tipos de linha: a RECOMENDAÇÃO
 * (`portal_updates`, a de sempre) e o A FAZER (`portal_afazeres`, o aviso que
 * pede ação de uma pessoa). O que a linha mostra, em que ordem, o que cada
 * filtro deixa passar e para onde o painel vai depois de decidir mora aqui,
 * com teste; a tela só desenha.
 */
import type { PortalAccount, PortalUpdate, ProjetoDoCartao } from '@/hooks/useLudmilla';
import { identidadeDoCartao } from '@/lib/ludmillaCartao';

/** O que o aviso pede (a RPC `ludmilla_email_avisar` deduz do título do sino). */
export type TipoAfazer = 'vistoria_aprovada' | 'troca_falhou' | 'devolucao' | 'aviso';

/** Uma linha de `portal_afazeres`, com o projeto e quem marcou "Feito" (embeds). */
export interface Afazer {
  id: string;
  tenant_id: string;
  account_id: string;
  project_id: string | null;
  mensagem_id: string | null;
  tipo: TipoAfazer;
  titulo: string;
  mensagem: string;
  criado_em: string;
  feito_por: string | null;
  feito_em: string | null;
  project?: ProjetoDoCartao | null;
  feito?: { name: string | null } | null;
}

export type SituacaoDoFiltro = 'pendente' | 'aplicada' | 'ignorada' | 'todas';
export type TipoDoFiltro = 'etapa' | 'protocolo' | 'bloqueado' | 'afazer';
export type MeioDoItem = 'portal' | 'email' | 'estacao';
export type TomDoSelo = 'etapa' | 'protocolo' | 'anexo' | 'bloqueado' | 'afazer' | 'neutro';

export interface Selo { texto: string; tom: TomDoSelo }

export interface ItemDaCaixa {
  /** `u:<id>` para recomendação, `f:<id>` para A fazer — única na lista */
  chave: string;
  origem: 'recomendacao' | 'afazer';
  id: string;
  accountId: string;
  concessionaria: string;
  meio: MeioDoItem;
  /** detectado_em (recomendação) ou criado_em (A fazer) */
  quando: string;
  codigo: string | null;
  projectId: string | null;
  titular: string | null;
  noPortal: string | null;
  empresa: string | null;
  protocolo: string | null;
  situacao: 'pendente' | 'aplicada' | 'ignorada' | 'feito';
  tipos: TipoDoFiltro[];
  selos: Selo[];
  /** já normalizado (sem acento, minúsculo) */
  textoDeBusca: string;
  update: PortalUpdate | null;
  afazer: Afazer | null;
}

export interface FiltroDaCaixa {
  situacao: SituacaoDoFiltro;
  /** vazio = todos; mais de um marcado = qualquer um deles */
  tipos: TipoDoFiltro[];
  /** o chip da faixa de saúde; null = todas as concessionárias */
  contaId: string | null;
  busca: string;
}

export const FILTRO_INICIAL: FiltroDaCaixa = { situacao: 'pendente', tipos: [], contaId: null, busca: '' };

export interface EntradaDaCaixa {
  updates: PortalUpdate[];
  afazeres: Afazer[];
  contas: PortalAccount[];
  nomeDaConta: (accountId: string) => string;
  rotuloEtapa: (status: string | null | undefined) => string;
}

/** Como a concessionária é acompanhada: e-mail, estação local (Elektro) ou portal pela VPS. */
export function meioDaConta(c: Pick<PortalAccount, 'acompanhamento' | 'modo'> | null | undefined): MeioDoItem {
  if (c?.acompanhamento === 'email') return 'email';
  return c?.modo === 'local' ? 'estacao' : 'portal';
}

/** Sem acento, minúsculo, espaços únicos. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const semZeros = (d: string) => d.replace(/^0+/, '') || '0';

function lerRaw(u: PortalUpdate, chave: string): unknown {
  return (u.raw as Record<string, unknown> | null | undefined)?.[chave];
}

/** Quantos documentos o e-mail levou ao card (`raw.anexos`, gravado como número). */
export function anexosDoCartao(u: PortalUpdate): number {
  const n = Number(lerRaw(u, 'anexos'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** "não anexei · …" — e NÃO "não anexei ainda: …" (a ENEL tenta de novo) nem "não anexado(s)". */
const ABRE_COM_NAO_ANEXEI = /^nao anexei\s*(?:·|$)/;

/**
 * O cartão diz que o documento NÃO foi anexado (o titular dele é de outra pessoa).
 * É a mesma regra de `detalheDoCartaoDeEmail` (ludmillaCartao.ts, rodada da ENEL):
 * quando aquela função existir, esta passa a chamá-la.
 */
export function cartaoBloqueado(u: PortalUpdate): boolean {
  const m = lerRaw(u, 'motivo');
  return typeof m === 'string' && ABRE_COM_NAO_ANEXEI.test(normalizar(m));
}

const ROTULO_AFAZER: Record<Exclude<TipoAfazer, 'aviso'>, string> = {
  vistoria_aprovada: 'A fazer: pedir a troca do relógio',
  troca_falhou: 'A fazer: troca do relógio não executada',
  devolucao: 'A fazer: conferir o e-mail que voltou',
};

/** O selo do A fazer. Tipo genérico: o título sem o emoji do sino. */
export function rotuloDoAfazer(f: Pick<Afazer, 'tipo' | 'titulo'>): string {
  if (f.tipo !== 'aviso') return ROTULO_AFAZER[f.tipo];
  const t = f.titulo.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return t ? `A fazer: ${t}` : 'A fazer';
}

function textoDeBusca(partes: (string | null | undefined)[], protocolo: string | null | undefined): string {
  const digitos = (protocolo ?? '').replace(/\D/g, '');
  return normalizar([...partes, digitos ? semZeros(digitos) : null].filter(Boolean).join(' | '));
}

function selosDaRecomendacao(u: PortalUpdate, rotulo: EntradaDaCaixa['rotuloEtapa']): Selo[] {
  const selos: Selo[] = [];
  if (u.recomendacao) {
    const de = u.project ? rotulo(u.project.status) : null;
    selos.push({ texto: de ? `${de} → ${rotulo(u.recomendacao)}` : `→ ${rotulo(u.recomendacao)}`, tom: 'etapa' });
  }
  if (u.atualizar_protocolo) selos.push({ texto: 'Gravar protocolo', tom: 'protocolo' });
  const n = anexosDoCartao(u);
  if (n === 1) selos.push({ texto: 'Documento anexado', tom: 'anexo' });
  if (n > 1) selos.push({ texto: `${n} documentos anexados`, tom: 'anexo' });
  if (cartaoBloqueado(u)) selos.push({ texto: 'Documento bloqueado', tom: 'bloqueado' });
  if (selos.length === 0) selos.push({ texto: 'Sem sugestão', tom: 'neutro' });
  return selos;
}

function tiposDaRecomendacao(u: PortalUpdate): TipoDoFiltro[] {
  const tipos: TipoDoFiltro[] = [];
  if (u.recomendacao) tipos.push('etapa');
  if (u.atualizar_protocolo) tipos.push('protocolo');
  if (cartaoBloqueado(u)) tipos.push('bloqueado');
  return tipos;
}

export function itensDaCaixa(e: EntradaDaCaixa): ItemDaCaixa[] {
  const contaPorId = new Map(e.contas.map(c => [c.id, c]));

  const daRecomendacao = (u: PortalUpdate): ItemDaCaixa => {
    const { titular, noPortal, empresa } = identidadeDoCartao(u);
    const codigo = u.project?.code ?? null;
    return {
      chave: `u:${u.id}`, origem: 'recomendacao', id: u.id, accountId: u.account_id,
      concessionaria: e.nomeDaConta(u.account_id), meio: meioDaConta(contaPorId.get(u.account_id)),
      quando: u.detectado_em, codigo, projectId: u.project?.id ?? u.project_id ?? null,
      titular, noPortal, empresa, protocolo: u.protocolo?.trim() || null,
      situacao: u.situacao, tipos: tiposDaRecomendacao(u), selos: selosDaRecomendacao(u, e.rotuloEtapa),
      textoDeBusca: textoDeBusca([codigo, titular, noPortal, empresa, u.protocolo], u.protocolo),
      update: u, afazer: null,
    };
  };

  const doAfazer = (f: Afazer): ItemDaCaixa => {
    const { titular, empresa } = identidadeDoCartao({ titular_portal: null, project: f.project ?? null });
    const codigo = f.project?.code ?? null;
    return {
      chave: `f:${f.id}`, origem: 'afazer', id: f.id, accountId: f.account_id,
      concessionaria: e.nomeDaConta(f.account_id), meio: meioDaConta(contaPorId.get(f.account_id)),
      quando: f.criado_em, codigo, projectId: f.project?.id ?? f.project_id ?? null,
      titular, noPortal: null, empresa, protocolo: null,
      situacao: f.feito_em ? 'feito' : 'pendente', tipos: ['afazer'],
      selos: [{ texto: rotuloDoAfazer(f), tom: 'afazer' }],
      textoDeBusca: textoDeBusca([codigo, titular, empresa, f.titulo], null),
      update: null, afazer: f,
    };
  };

  return [...e.updates.map(daRecomendacao), ...e.afazeres.map(doAfazer)];
}

/** Todas as palavras precisam aparecer; número também casa sem os zeros à esquerda. */
export function casaBusca(item: ItemDaCaixa, busca: string): boolean {
  const termos = normalizar(busca).split(' ').filter(Boolean);
  return termos.every(t =>
    item.textoDeBusca.includes(t) || (/^\d+$/.test(t) && item.textoDeBusca.includes(semZeros(t))));
}

function casaSituacao(item: ItemDaCaixa, s: SituacaoDoFiltro): boolean {
  if (s === 'todas') return true;
  if (s === 'pendente') return item.situacao === 'pendente';
  if (s === 'aplicada') return item.situacao === 'aplicada' || item.situacao === 'feito';
  return item.situacao === 'ignorada';
}

/** Mais antigas primeiro (spec §3.2). Empate: pela chave, para a ordem não pular. */
export function ordenarItens(itens: ItemDaCaixa[]): ItemDaCaixa[] {
  return [...itens].sort((a, b) => (Date.parse(a.quando) - Date.parse(b.quando)) || a.chave.localeCompare(b.chave));
}

export function filtrarItens(
  itens: ItemDaCaixa[], filtro: FiltroDaCaixa, ocultos: ReadonlySet<string> = new Set(),
): ItemDaCaixa[] {
  return ordenarItens(itens.filter(i =>
    !ocultos.has(i.chave)
    && casaSituacao(i, filtro.situacao)
    && (filtro.tipos.length === 0 || i.tipos.some(t => filtro.tipos.includes(t)))
    && (!filtro.contaId || i.accountId === filtro.contaId)
    && casaBusca(i, filtro.busca)));
}

export function contarPendentes(
  itens: ItemDaCaixa[], ocultos: ReadonlySet<string> = new Set(),
): { total: number; porConta: Record<string, number> } {
  const porConta: Record<string, number> = {};
  let total = 0;
  for (const i of itens) {
    if (i.situacao !== 'pendente' || ocultos.has(i.chave)) continue;
    total++;
    porConta[i.accountId] = (porConta[i.accountId] ?? 0) + 1;
  }
  return { total, porConta };
}

/**
 * Depois de decidir `chave`: a próxima PENDENTE abaixo dela na lista visível; sem
 * nenhuma abaixo, a pendente de cima mais próxima; sem nenhuma, null.
 */
export function proximaDepoisDe(lista: ItemDaCaixa[], chave: string): string | null {
  const pendente = (x: ItemDaCaixa) => x.situacao === 'pendente' && x.chave !== chave;
  const i = lista.findIndex(x => x.chave === chave);
  if (i < 0) return lista.find(pendente)?.chave ?? null;
  const abaixo = lista.slice(i + 1).find(pendente);
  if (abaixo) return abaixo.chave;
  return [...lista.slice(0, i)].reverse().find(pendente)?.chave ?? null;
}

/** A seleção vale enquanto estiver na lista; senão a primeira (computador) ou nenhuma (celular). */
export function selecaoValida(lista: ItemDaCaixa[], selecionada: string | null, abrirPrimeira: boolean): string | null {
  if (selecionada && lista.some(x => x.chave === selecionada)) return selecionada;
  return abrirPrimeira ? (lista[0]?.chave ?? null) : null;
}

/** Fica oculto só o que ainda está pendente nos dados: o resto a decisão já levou ao banco. */
export function limparOcultos(ocultos: ReadonlySet<string>, itens: ItemDaCaixa[]): Set<string> {
  const pendentes = new Set(itens.filter(i => i.situacao === 'pendente').map(i => i.chave));
  return new Set([...ocultos].filter(c => pendentes.has(c)));
}

export function unirPorId<T extends { id: string }>(...listas: T[][]): T[] {
  const vistos = new Map<string, T>();
  for (const l of listas) for (const x of l) if (!vistos.has(x.id)) vistos.set(x.id, x);
  return [...vistos.values()];
}
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/ludmillaCaixa.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 7: Verificar o resto**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1.
Run: `npm run build` → sem erro.
Run: `npm test` → `Tests … passed`, nenhum `failed`.

- [ ] **Step 8: Commit**

Mensagem (`$RASCUNHO/msg-task2.txt`):

```text
feat(ludmilla): lógica da caixa de decisões (itens, selos, filtros, ordem)

A aba Decidir junta recomendações e A fazer numa lista só. O que cada linha
mostra, os selos, a busca (sem acento, protocolo sem zeros à esquerda), a
ordem (mais antigas primeiro) e para onde o painel vai depois de decidir
ficam em funções puras com teste. Dados inventados num arquivo de fixtures.

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaCaixa.ts src/lib/ludmillaCaixa.fixtures.ts src/lib/ludmillaCaixa.test.ts
git commit -F "$RASCUNHO/msg-task2.txt" -- src/lib/ludmillaCaixa.ts src/lib/ludmillaCaixa.fixtures.ts src/lib/ludmillaCaixa.test.ts
git show --stat HEAD
```

---

### Task 3: Lógica pura do topo e do detalhe

**Files:**
- Create: `src/lib/ludmillaPainel.ts`
- Modify: `src/lib/ludmillaCaixa.fixtures.ts` (acrescentar no fim `DOCUMENTOS_DE_EXEMPLO` e `LINHA_DO_TEMPO_DE_EXEMPLO`)
- Test: `src/lib/ludmillaPainel.test.ts`

**Interfaces:**
- Consumes: de `@/lib/ludmillaCaixa` — `ItemDaCaixa`, `MeioDoItem`, `anexosDoCartao`, `cartaoBloqueado`, `meioDaConta`, `itensDaCaixa`; tipos `MensagemEmail`, `PortalAccount`, `PortalUpdate`, `RegistroLudmilla` de `@/hooks/useLudmilla` (só `import type`).
- Produces (exportados de `@/lib/ludmillaPainel`):
  - tipos: `TomDaSaude = 'ok'|'atencao'|'erro'|'parada'`, `SaudeDaConta { tom; texto }`, `EstadoDaEstacao { online: boolean; texto: string }`, `ChipDaConta { id; nome; meio; saude; lida; pendentes; podeVerificar; tipoDoRun: 'varredura'|'varredura_email' }`, `AlertaUrgente { chave; tom: 'erro'|'atencao'; titulo; detalhe: string|null }`, `OQueChegou` (união `meio: 'email' | 'portal'`), `AcaoDaDecisao = 'aplicar'|'ignorar'|'feito'`, `AcoesDoItem`, `SituacaoDecidida`, `AcaoDoProjeto`, `EventoDoProjeto`, `AnexoDoPortal`, `ParecerDoPortal`, `ProjetoDoDetalhe`, `ProjetoDaCriacao`; constante `HORAS_SEM_LER_ATRASADA = 18`.
  - `haQuantoTempo(iso, agora): string` · `saudeDaConta(conta, { estacao, caixaPronta, agora }): SaudeDaConta` · `chipsDaFaixa(contas, { nomeDaConta, pendentesPorConta, estacaoDe, caixaPronta, agora }): ChipDaConta[]` · `alertasDasContas(contas, nomeDaConta, caixaPronta): AlertaUrgente[]` · `oQueChegou(u, m, meio): OQueChegou` · `ressalvaDoCartao(u, m): string | null` · `acoesDoItem(item, etapa: string | null): AcoesDoItem` · `textoDaDecisao(item, acao, rotuloDaEtapa: string | null): string` · `situacaoDecidida(item): SituacaoDecidida | null` · `ucDoProjeto(p): string | null` · `rotuloDaCriacao(run, projetoDe): { titulo: string; numeroCpfl: string | null }`.
  - fixtures novas: `DOCUMENTOS_DE_EXEMPLO: { anexos: AnexoDoPortal[]; pareceres: ParecerDoPortal[] }`, `LINHA_DO_TEMPO_DE_EXEMPLO: EventoDoProjeto[]`.

- [ ] **Step 1: Medir o baseline do tsc**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → anote.

- [ ] **Step 2: Escrever o teste que falha**

Crie `src/lib/ludmillaPainel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  acoesDoItem, alertasDasContas, chipsDaFaixa, haQuantoTempo, oQueChegou, ressalvaDoCartao, rotuloDaCriacao,
  saudeDaConta, situacaoDecidida, textoDaDecisao, ucDoProjeto,
} from './ludmillaPainel';
import { itensDaCaixa } from './ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, AGORA, CONTAS_DE_EXEMPLO, CONTA_CPFL, CONTA_EDP, CONTA_ELEKTRO, CONTA_ENEL, MENSAGEM_DA_TROCA,
  UPDATES_DE_EXEMPLO, U_CPFL, U_EDP, U_ENEL_BLOQUEADO, U_ENEL_TROCA, nomeDaContaDeExemplo, rotuloDeExemplo,
} from './ludmillaCaixa.fixtures';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const itens = itensDaCaixa({
  updates: UPDATES_DE_EXEMPLO, afazeres: AFAZERES_DE_EXEMPLO, contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (c: string) => itens.find(i => i.chave === c)!;

describe('haQuantoTempo', () => {
  it('minutos, horas e dias', () => {
    expect(haQuantoTempo(iso(AGORA - 30_000), AGORA)).toBe('agora há pouco');
    expect(haQuantoTempo(iso(AGORA - 5 * 60_000), AGORA)).toBe('há 5 min');
    expect(haQuantoTempo(iso(AGORA - 3 * H), AGORA)).toBe('há 3 h');
    expect(haQuantoTempo(iso(AGORA - 47 * H), AGORA)).toBe('há 47 h');
    expect(haQuantoTempo(iso(AGORA - 72 * H), AGORA)).toBe('há 3 dias');
  });
  it('sem data ou data inválida: nunca', () => {
    expect(haQuantoTempo(null, AGORA)).toBe('nunca');
    expect(haQuantoTempo('não é data', AGORA)).toBe('nunca');
  });
});

describe('saudeDaConta — o ponto do chip', () => {
  const base = { estacao: null, caixaPronta: true, agora: AGORA };
  it('em dia', () => expect(saudeDaConta(CONTA_CPFL, base)).toEqual({ tom: 'ok', texto: 'em dia' }));
  it('erro vence tudo', () => expect(saudeDaConta({ ...CONTA_CPFL, situacao: 'erro' }, base)).toEqual({ tom: 'erro', texto: 'com erro' }));
  it('sessão expirada', () => {
    expect(saudeDaConta(CONTA_ELEKTRO, { ...base, estacao: { online: true, texto: 'estação online' } }))
      .toEqual({ tom: 'atencao', texto: 'sessão expirada' });
  });
  it('estação offline', () => {
    expect(saudeDaConta({ ...CONTA_ELEKTRO, situacao: 'ok' }, { ...base, estacao: { online: false, texto: 'estação offline há 2 h' } }))
      .toEqual({ tom: 'atencao', texto: 'estação offline há 2 h' });
  });
  it('e-mail sem caixa configurada', () => {
    expect(saudeDaConta(CONTA_ENEL, { ...base, caixaPronta: false })).toEqual({ tom: 'parada', texto: 'caixa não configurada' });
  });
  it('nunca leu', () => expect(saudeDaConta(CONTA_EDP, base)).toEqual({ tom: 'parada', texto: 'ainda não leu a caixa' }));
  it('mais de 18 h sem ler é rodada perdida', () => {
    expect(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: iso(AGORA - 19 * H) }, base)).toEqual({ tom: 'atencao', texto: 'leitura atrasada' });
    expect(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: iso(AGORA - 17 * H) }, base).tom).toBe('ok');
  });
  it('desligada', () => expect(saudeDaConta({ ...CONTA_CPFL, enabled: false }, base)).toEqual({ tom: 'parada', texto: 'desligada' }));
});

describe('chipsDaFaixa', () => {
  const opcoes = {
    nomeDaConta: nomeDaContaDeExemplo, pendentesPorConta: { 'conta-enel': 4, 'conta-cpfl': 2 },
    estacaoDe: () => null, caixaPronta: true, agora: AGORA,
  };
  const chips = chipsDaFaixa(CONTAS_DE_EXEMPLO, opcoes);
  it('um chip por conta, em ordem de nome', () => {
    expect(chips.map(c => c.nome)).toEqual(['CPFL Paulista', 'EDP São Paulo', 'Elektro', 'ENEL SP']);
  });
  it('lida há / nunca lida, pendentes e o meio', () => {
    expect(chips.find(c => c.id === 'conta-enel')).toMatchObject({
      meio: 'email', lida: 'lida há 1 h', pendentes: 4, podeVerificar: true, tipoDoRun: 'varredura_email',
    });
    expect(chips.find(c => c.id === 'conta-edp')!.lida).toBe('nunca lida');
    expect(chips.find(c => c.id === 'conta-edp')!.pendentes).toBe(0);
    expect(chips.find(c => c.id === 'conta-elektro')!.meio).toBe('estacao');
  });
  it('"Verificar agora" como hoje: e-mail precisa da caixa, portal precisa do login', () => {
    const semCaixa = chipsDaFaixa(CONTAS_DE_EXEMPLO, { ...opcoes, caixaPronta: false });
    expect(semCaixa.find(c => c.id === 'conta-enel')!.podeVerificar).toBe(false);
    expect(semCaixa.find(c => c.id === 'conta-cpfl')).toMatchObject({ podeVerificar: true, tipoDoRun: 'varredura' });
    expect(chipsDaFaixa([{ ...CONTA_CPFL, login: null }], opcoes)[0].podeVerificar).toBe(false);
  });
});

describe('alertasDasContas', () => {
  it('erro e sessão expirada viram alerta; conta em dia não', () => {
    const a = alertasDasContas(
      [{ ...CONTA_CPFL, situacao: 'erro', ultimo_erro: 'Tempo esgotado ao abrir a lista' }, CONTA_ELEKTRO, CONTA_ENEL],
      nomeDaContaDeExemplo, true);
    expect(a).toEqual([
      { chave: 'erro:conta-cpfl', tom: 'erro', titulo: 'CPFL Paulista: a última leitura deu erro', detalhe: 'Tempo esgotado ao abrir a lista' },
      { chave: 'sessao:conta-elektro', tom: 'atencao', titulo: 'Elektro: sessão expirada', detalhe: 'A estação espera alguém entrar no portal e digitar o código da imagem.' },
    ]);
  });
  it('caixa de e-mail não configurada: um alerta só, com as concessionárias', () => {
    expect(alertasDasContas([CONTA_CPFL, CONTA_EDP, CONTA_ENEL], nomeDaContaDeExemplo, false)).toEqual([{
      chave: 'caixa', tom: 'atencao', titulo: 'A caixa de e-mail não está configurada',
      detalhe: 'Sem ela a Ludmilla não lê EDP São Paulo nem ENEL SP. Configure em Claudinho / Agente de e-mails.',
    }]);
  });
  it('conta desligada não alerta', () => {
    expect(alertasDasContas([{ ...CONTA_CPFL, enabled: false, situacao: 'erro' }], nomeDaContaDeExemplo, true)).toEqual([]);
  });
});

describe('oQueChegou e ressalvaDoCartao', () => {
  it('e-mail: a mensagem manda; o raw do cartão cobre o que faltar', () => {
    expect(oQueChegou(U_ENEL_TROCA, MENSAGEM_DA_TROCA, 'email')).toEqual({
      meio: 'email', assunto: 'Carta de aprovação do projeto', remetente: 'naoresponda@enel.exemplo.test',
      recebidoEm: '2026-10-21T08:55:00Z', lidoEm: '2026-10-21T09:00:00Z', resumo: 'A ENEL aprovou o projeto.',
      arquivoLido: 'carta-900000222.pdf', anexos: 1, veredito: 'favoravel', tipoDocumento: 'carta_projeto',
    });
    expect(oQueChegou(U_EDP, null, 'email')).toMatchObject({
      assunto: 'Parecer de acesso 045006443920', remetente: 'gd@edp.exemplo.test', anexos: 2, veredito: null, recebidoEm: null,
    });
  });
  it('portal: de → para e a data do portal', () => {
    expect(oQueChegou(U_CPFL, null, 'portal')).toEqual({ meio: 'portal', de: 'Em Andamento', para: 'Aprovado', atualizadoNoPortal: '19/10/2026' });
  });
  it('ressalva: a da mensagem, senão a do cartão; vazio é null', () => {
    expect(ressalvaDoCartao(U_ENEL_BLOQUEADO, null)).toBe('não anexei · o documento é de "Carlos Souza" e o projeto é de "Ana Paula Reis"');
    expect(ressalvaDoCartao(U_EDP, null)).toBeNull();
    expect(ressalvaDoCartao(U_EDP, { ...MENSAGEM_DA_TROCA, motivo: '  ' })).toBeNull();
  });
});

describe('acoesDoItem — os botões do detalhe', () => {
  it('troca de protocolo: com etapa "Aplicar etapa e protocolo", sem etapa "Atualizar protocolo"', () => {
    expect(acoesDoItem(item('u:u-enel-troca'), 'approved').principal)
      .toEqual({ acao: 'aplicar', rotulo: 'Aplicar etapa e protocolo', habilitada: true, porque: null });
    expect(acoesDoItem(item('u:u-enel-troca'), null).principal).toMatchObject({ rotulo: 'Atualizar protocolo', habilitada: true });
  });
  it('mudar etapa: "Aplicar" e "Ignorar"', () => {
    expect(acoesDoItem(item('u:u-cpfl'), 'approved')).toEqual({
      principal: { acao: 'aplicar', rotulo: 'Aplicar', habilitada: true, porque: null },
      secundaria: { acao: 'ignorar', rotulo: 'Ignorar' },
    });
  });
  it('sem etapa escolhida, o Aplicar espera e diz por quê', () => {
    expect(acoesDoItem(item('u:u-cpfl'), '').principal)
      .toEqual({ acao: 'aplicar', rotulo: 'Aplicar', habilitada: false, porque: 'Escolha a etapa para onde mover o card.' });
  });
  it('bloqueado: "Dispensar"', () => {
    expect(acoesDoItem(item('u:u-enel-bloq'), null).secundaria).toEqual({ acao: 'ignorar', rotulo: 'Dispensar' });
  });
  it('sem projeto casado: não há card para mover', () => {
    expect(acoesDoItem(item('u:u-cpfl-sem'), 'approved').principal)
      .toMatchObject({ habilitada: false, porque: 'Sem projeto casado: não há card para mover.' });
  });
  it('A fazer: só "Marcar como feito"', () => {
    expect(acoesDoItem(item('f:f-vistoria'), null)).toEqual({
      principal: { acao: 'feito', rotulo: 'Marcar como feito', habilitada: true, porque: null }, secundaria: null,
    });
  });
  it('já decidido: nenhum botão', () => {
    expect(acoesDoItem(item('u:u-aplicada'), 'approved')).toEqual({ principal: null, secundaria: null });
    expect(acoesDoItem(item('f:f-feito'), null)).toEqual({ principal: null, secundaria: null });
  });
});

describe('textoDaDecisao — o aviso com Desfazer diz o que vai acontecer', () => {
  it('cada caso', () => {
    expect(textoDaDecisao(item('u:u-cpfl'), 'aplicar', 'Aprovado')).toBe('PRJ-10001 vai para Aprovado');
    expect(textoDaDecisao(item('u:u-enel-troca'), 'aplicar', 'Aprovado')).toBe('PRJ-10002 vai para Aprovado e grava o protocolo 900000222');
    expect(textoDaDecisao(item('u:u-enel-troca'), 'aplicar', null)).toBe('PRJ-10002: o protocolo do cadastro vai virar 900000222');
    expect(textoDaDecisao(item('u:u-cpfl'), 'ignorar', null)).toBe('PRJ-10001: recomendação ignorada');
    expect(textoDaDecisao(item('u:u-enel-bloq'), 'ignorar', null)).toBe('PRJ-10003: documento bloqueado dispensado');
    expect(textoDaDecisao(item('f:f-devolucao'), 'feito', null)).toBe('ENEL SP: marcado como feito');
  });
});

describe('situacaoDecidida', () => {
  it('pendente: nada; aplicada/ignorada com a data; feito com quem', () => {
    expect(situacaoDecidida(item('u:u-cpfl'))).toBeNull();
    expect(situacaoDecidida(item('u:u-aplicada'))).toEqual({ rotulo: 'Aplicada', em: '2026-10-18T13:00:00Z', por: null });
    expect(situacaoDecidida(item('u:u-ignorada'))).toEqual({ rotulo: 'Ignorada', em: '2026-10-17T10:00:00Z', por: null });
    expect(situacaoDecidida(item('f:f-feito'))).toEqual({ rotulo: 'Feito', em: '2026-10-16T15:00:00Z', por: 'Bia Souza' });
  });
});

describe('ucDoProjeto', () => {
  it('objeto ou lista; vazio é null', () => {
    expect(ucDoProjeto({ project_general_data: { uc_number: ' 0123456789 ' } })).toBe('0123456789');
    expect(ucDoProjeto({ project_general_data: [{ uc_number: '111' }] })).toBe('111');
    expect(ucDoProjeto({ project_general_data: null })).toBeNull();
    expect(ucDoProjeto(null)).toBeNull();
  });
});

describe('rotuloDaCriacao — o cartão da criação na CPFL', () => {
  const projetos = { 'p-1': { id: 'p-1', code: 'PRJ-10001', cpfl_node_id: null }, 'p-9': { id: 'p-9', code: 'PRJ-10009', cpfl_node_id: '611111' } };
  const projetoDe = (id: string) => projetos[id as keyof typeof projetos] ?? null;
  it('código do projeto e número que a criação devolveu', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 'p-1' }, resultado: { node: '598536' } }, projetoDe)).toEqual({ titulo: 'PRJ-10001', numeroCpfl: '598536' });
  });
  it('sem número no run: o do cadastro', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 'p-9' }, resultado: null }, projetoDe)).toEqual({ titulo: 'PRJ-10009', numeroCpfl: '611111' });
  });
  it('projeto desconhecido ou ausente', () => {
    expect(rotuloDaCriacao({ dados: { project_id: 'abcdef1234' }, resultado: null }, projetoDe)).toEqual({ titulo: 'Projeto abcdef12…', numeroCpfl: null });
    expect(rotuloDaCriacao({ dados: null, resultado: { node: 598536 } }, projetoDe)).toEqual({ titulo: 'Criar na CPFL', numeroCpfl: '598536' });
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/ludmillaPainel.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaPainel"`.

- [ ] **Step 4: Escrever a implementação**

Crie `src/lib/ludmillaPainel.ts`:

```ts
/**
 * O TOPO E O PAINEL DE DETALHE DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md §3.1
 * (alertas urgentes, faixa de saúde) e §3.2 (o detalhe e as ações).
 */
import type { MensagemEmail, PortalAccount, PortalUpdate, RegistroLudmilla } from '@/hooks/useLudmilla';
import { anexosDoCartao, cartaoBloqueado, meioDaConta, type ItemDaCaixa, type MeioDoItem } from '@/lib/ludmillaCaixa';

// ── tipos das consultas novas (os hooks devolvem estes formatos) ─────────────

export type AcaoDoProjeto = RegistroLudmilla['acao'] | 'email' | 'afazer' | 'afazer_feito';
/** Uma linha de `ludmilla_linha_do_tempo` — o formato de `ludmilla_registro` + 3 ações. */
export type EventoDoProjeto = Omit<RegistroLudmilla, 'acao'> & { acao: AcaoDoProjeto };

export interface AnexoDoPortal {
  id: string;
  protocolo: string;
  nome_arquivo: string;
  situacao: 'pendente' | 'enviado' | 'bloqueado' | 'erro';
  motivo: string | null;
  enviado_em: string | null;
  created_at: string;
  /** `documents.file_url` é o caminho no bucket `project-documents` */
  document: { file_url: string; file_name: string | null } | null;
}

export interface ParecerDoPortal {
  id: string;
  protocolo: string;
  data: string | null;
  analise: string | null;
  status: string | null;
  created_at: string;
}

type DadosGerais = { uc_number?: string | null } | null | undefined;
export interface ProjetoDoDetalhe {
  id: string;
  code: string;
  status: string;
  protocol_number: string | null;
  project_general_data?: DadosGerais | DadosGerais[];
}

export interface ProjetoDaCriacao { id: string; code: string; cpfl_node_id: string | null }

// ── utilidades ───────────────────────────────────────────────────────────────

function limpo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function dataValida(v: unknown): string | null {
  const s = limpo(v);
  return s !== null && !Number.isNaN(Date.parse(s)) ? s : null;
}

const MIN = 60_000;

export function haQuantoTempo(iso: string | null | undefined, agora: number): string {
  if (!iso) return 'nunca';
  const min = Math.floor((agora - Date.parse(iso)) / MIN);
  if (!Number.isFinite(min)) return 'nunca';
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} dias`;
}

// ── a faixa de saúde e os alertas (§3.1) ────────────────────────────────────

export type TomDaSaude = 'ok' | 'atencao' | 'erro' | 'parada';
export interface SaudeDaConta { tom: TomDaSaude; texto: string }
/** O que `estadoDaEstacao` (useLudmilla.ts) devolve; quem chama passa pronto. */
export interface EstadoDaEstacao { online: boolean; texto: string }

/** Duas leituras por dia (11h e 20h UTC): mais de 18 h sem ler é rodada perdida. */
export const HORAS_SEM_LER_ATRASADA = 18;

export function saudeDaConta(
  conta: PortalAccount, o: { estacao: EstadoDaEstacao | null; caixaPronta: boolean; agora: number },
): SaudeDaConta {
  if (!conta.enabled) return { tom: 'parada', texto: 'desligada' };
  if (conta.situacao === 'erro') return { tom: 'erro', texto: 'com erro' };
  if (conta.situacao === 'sessao_expirada') return { tom: 'atencao', texto: 'sessão expirada' };
  if (conta.acompanhamento === 'email' && !o.caixaPronta) return { tom: 'parada', texto: 'caixa não configurada' };
  if (conta.situacao === 'nao_configurado') return { tom: 'parada', texto: 'sem acesso' };
  if (o.estacao && !o.estacao.online) return { tom: 'atencao', texto: o.estacao.texto };
  if (!conta.ultima_varredura_em) {
    return { tom: 'parada', texto: conta.acompanhamento === 'email' ? 'ainda não leu a caixa' : 'ainda não varreu' };
  }
  if (o.agora - Date.parse(conta.ultima_varredura_em) > HORAS_SEM_LER_ATRASADA * 60 * MIN) {
    return { tom: 'atencao', texto: 'leitura atrasada' };
  }
  return { tom: 'ok', texto: 'em dia' };
}

export interface ChipDaConta {
  id: string;
  nome: string;
  meio: MeioDoItem;
  saude: SaudeDaConta;
  /** "lida há 2 h" ou "nunca lida" */
  lida: string;
  pendentes: number;
  /** a mesma trava do botão de hoje: e-mail precisa da caixa; portal precisa do login */
  podeVerificar: boolean;
  tipoDoRun: 'varredura' | 'varredura_email';
}

export function chipsDaFaixa(contas: PortalAccount[], o: {
  nomeDaConta: (id: string) => string;
  pendentesPorConta: Record<string, number>;
  estacaoDe: (c: PortalAccount) => EstadoDaEstacao | null;
  caixaPronta: boolean;
  agora: number;
}): ChipDaConta[] {
  return contas
    .map(c => ({
      id: c.id,
      nome: o.nomeDaConta(c.id) || c.connector.toUpperCase(),
      meio: meioDaConta(c),
      saude: saudeDaConta(c, { estacao: o.estacaoDe(c), caixaPronta: o.caixaPronta, agora: o.agora }),
      lida: c.ultima_varredura_em ? `lida ${haQuantoTempo(c.ultima_varredura_em, o.agora)}` : 'nunca lida',
      pendentes: o.pendentesPorConta[c.id] ?? 0,
      podeVerificar: c.acompanhamento === 'email' ? o.caixaPronta : !!c.login,
      tipoDoRun: (c.acompanhamento === 'email' ? 'varredura_email' : 'varredura') as ChipDaConta['tipoDoRun'],
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export interface AlertaUrgente { chave: string; tom: 'erro' | 'atencao'; titulo: string; detalhe: string | null }

/** Os alertas que vão acima de tudo (o código da imagem da Elektro vem à parte, do `portal_captchas`). */
export function alertasDasContas(
  contas: PortalAccount[], nomeDaConta: (id: string) => string, caixaPronta: boolean,
): AlertaUrgente[] {
  const nome = (c: PortalAccount) => nomeDaConta(c.id) || c.connector.toUpperCase();
  const alertas: AlertaUrgente[] = [];
  for (const c of contas) {
    if (!c.enabled) continue;
    if (c.situacao === 'erro') {
      alertas.push({ chave: `erro:${c.id}`, tom: 'erro', titulo: `${nome(c)}: a última leitura deu erro`, detalhe: limpo(c.ultimo_erro) });
    } else if (c.situacao === 'sessao_expirada') {
      alertas.push({
        chave: `sessao:${c.id}`, tom: 'atencao', titulo: `${nome(c)}: sessão expirada`,
        detalhe: c.modo === 'local'
          ? 'A estação espera alguém entrar no portal e digitar o código da imagem.'
          : 'Ela tenta entrar de novo na próxima visita.',
      });
    }
  }
  const porEmail = contas.filter(c => c.enabled && c.acompanhamento === 'email');
  if (porEmail.length > 0 && !caixaPronta) {
    alertas.push({
      chave: 'caixa', tom: 'atencao', titulo: 'A caixa de e-mail não está configurada',
      detalhe: `Sem ela a Ludmilla não lê ${porEmail.map(nome).join(' nem ')}. Configure em Claudinho / Agente de e-mails.`,
    });
  }
  return alertas;
}

// ── o detalhe (§3.2) ─────────────────────────────────────────────────────────

export type OQueChegou =
  | {
      meio: 'email'; assunto: string | null; remetente: string | null;
      /** a data do e-mail (mensagem ou `raw.recebido_em`); null nos cartões antigos */
      recebidoEm: string | null;
      /** quando a Ludmilla leu — o que a tela mostra quando não há a data do e-mail */
      lidoEm: string;
      resumo: string | null; arquivoLido: string | null; anexos: number;
      veredito: MensagemEmail['veredito']; tipoDocumento: string | null;
    }
  | { meio: 'portal'; de: string | null; para: string; atualizadoNoPortal: string | null };

/** E-mail (EDP, ENEL): a mensagem ligada ao cartão manda; o `raw` cobre o que ela não tiver. */
export function oQueChegou(u: PortalUpdate, m: MensagemEmail | null, meio: MeioDoItem): OQueChegou {
  const r = (u.raw ?? {}) as Record<string, unknown>;
  if (meio === 'email') {
    return {
      meio: 'email',
      assunto: limpo(m?.assunto) ?? limpo(r.assunto),
      remetente: limpo(m?.remetente) ?? limpo(r.remetente),
      recebidoEm: dataValida(m?.recebido_em) ?? dataValida(r.recebido_em),
      lidoEm: u.detectado_em,
      resumo: limpo(m?.resumo) ?? limpo(r.resumo),
      arquivoLido: limpo(m?.arquivo_lido) ?? limpo(r.arquivo_lido),
      anexos: Math.max(m?.anexos ?? 0, anexosDoCartao(u)),
      veredito: m?.veredito ?? null,
      tipoDocumento: limpo(m?.tipo_documento),
    };
  }
  return { meio: 'portal', de: limpo(u.status_anterior), para: u.status_portal, atualizadoNoPortal: limpo(r['Última atualização']) };
}

/** A ressalva da robô (o porquê): a da mensagem, senão a do `raw` do cartão. */
export function ressalvaDoCartao(u: PortalUpdate, m: MensagemEmail | null): string | null {
  return limpo(m?.motivo) ?? limpo((u.raw as Record<string, unknown> | null)?.motivo);
}

export type AcaoDaDecisao = 'aplicar' | 'ignorar' | 'feito';

export interface AcoesDoItem {
  principal: { acao: 'aplicar' | 'feito'; rotulo: string; habilitada: boolean; porque: string | null } | null;
  secundaria: { acao: 'ignorar'; rotulo: 'Ignorar' | 'Dispensar' } | null;
}

/** Os botões. A trava do Aplicar é a de sempre: precisa de projeto e (etapa ou troca de protocolo). */
export function acoesDoItem(item: ItemDaCaixa, etapa: string | null): AcoesDoItem {
  if (item.situacao !== 'pendente') return { principal: null, secundaria: null };
  if (item.afazer) {
    return { principal: { acao: 'feito', rotulo: 'Marcar como feito', habilitada: true, porque: null }, secundaria: null };
  }
  const u = item.update;
  if (!u) return { principal: null, secundaria: null };
  const comEtapa = !!etapa;
  const rotulo = u.atualizar_protocolo ? (comEtapa ? 'Aplicar etapa e protocolo' : 'Atualizar protocolo') : 'Aplicar';
  const porque = !u.project ? 'Sem projeto casado: não há card para mover.'
    : (!comEtapa && !u.atualizar_protocolo) ? 'Escolha a etapa para onde mover o card.'
    : null;
  return {
    principal: { acao: 'aplicar', rotulo, habilitada: porque === null, porque },
    secundaria: { acao: 'ignorar', rotulo: cartaoBloqueado(u) ? 'Dispensar' : 'Ignorar' },
  };
}

/** O texto do aviso com "Desfazer": diz o que VAI acontecer quando a espera acabar. */
export function textoDaDecisao(item: ItemDaCaixa, acao: AcaoDaDecisao, rotuloDaEtapa: string | null): string {
  const quem = item.codigo || item.concessionaria || 'Item';
  if (acao === 'feito') return `${quem}: marcado como feito`;
  if (acao === 'ignorar') {
    return item.update && cartaoBloqueado(item.update) ? `${quem}: documento bloqueado dispensado` : `${quem}: recomendação ignorada`;
  }
  if (rotuloDaEtapa) {
    return item.update?.atualizar_protocolo
      ? `${quem} vai para ${rotuloDaEtapa} e grava o protocolo ${item.protocolo}`
      : `${quem} vai para ${rotuloDaEtapa}`;
  }
  return `${quem}: o protocolo do cadastro vai virar ${item.protocolo}`;
}

export interface SituacaoDecidida { rotulo: 'Aplicada' | 'Ignorada' | 'Feito'; em: string | null; por: string | null }

export function situacaoDecidida(item: ItemDaCaixa): SituacaoDecidida | null {
  if (item.situacao === 'pendente') return null;
  if (item.afazer) return { rotulo: 'Feito', em: item.afazer.feito_em, por: limpo(item.afazer.feito?.name) };
  const u = item.update;
  if (!u) return null;
  return { rotulo: u.situacao === 'aplicada' ? 'Aplicada' : 'Ignorada', em: u.aplicada_em, por: null };
}

/** A UC do cadastro; o embed 1:1 pode vir como objeto ou como lista de uma linha. */
export function ucDoProjeto(p: { project_general_data?: DadosGerais | DadosGerais[] } | null | undefined): string | null {
  const d = p?.project_general_data;
  const linha = Array.isArray(d) ? d[0] : d;
  return limpo(linha?.uc_number);
}

/** O título do cartão de criação e o número que a CPFL deu ao projeto. */
export function rotuloDaCriacao(
  run: { dados: Record<string, unknown> | null; resultado: Record<string, unknown> | null },
  projetoDe: (projectId: string) => ProjetoDaCriacao | null,
): { titulo: string; numeroCpfl: string | null } {
  const bruto = run.dados?.project_id;
  const pid = typeof bruto === 'string' ? bruto : null;
  const projeto = pid ? projetoDe(pid) : null;
  const node = run.resultado?.node;
  const doRun = typeof node === 'number' ? String(node) : limpo(node);
  return {
    titulo: projeto?.code ?? (pid ? `Projeto ${pid.slice(0, 8)}…` : 'Criar na CPFL'),
    numeroCpfl: doRun ?? limpo(projeto?.cpfl_node_id),
  };
}
```

- [ ] **Step 5: Acrescentar as fixtures do detalhe**

No FIM de `src/lib/ludmillaCaixa.fixtures.ts`, acrescente (e a linha de import logo abaixo do import de `Afazer`):

```ts
import type { AnexoDoPortal, EventoDoProjeto, ParecerDoPortal } from '@/lib/ludmillaPainel';
```

```ts
export const DOCUMENTOS_DE_EXEMPLO: { anexos: AnexoDoPortal[]; pareceres: ParecerDoPortal[] } = {
  anexos: [
    {
      id: 'a-1', protocolo: '900000222', nome_arquivo: 'carta-900000222.pdf', situacao: 'enviado', motivo: null,
      enviado_em: '2026-10-21T09:01:00Z', created_at: '2026-10-21T09:00:30Z',
      document: { file_url: 'exemplo/p-2/carta-900000222.pdf', file_name: 'carta-900000222.pdf' },
    },
    {
      id: 'a-2', protocolo: '900000222', nome_arquivo: 'assinatura.png', situacao: 'bloqueado',
      motivo: 'imagem de assinatura', enviado_em: null, created_at: '2026-10-21T09:00:31Z', document: null,
    },
  ],
  pareceres: [
    { id: 'pa-1', protocolo: '7001234', data: '19/10/2026', analise: 'Análise técnica', status: 'APROVADO', created_at: '2026-10-20T11:00:00Z' },
  ],
};

export const LINHA_DO_TEMPO_DE_EXEMPLO: EventoDoProjeto[] = [
  {
    quando: '2026-10-21T09:00:00Z', ator: 'ludmilla', quem: 'Ludmilla', acao: 'email',
    titulo: 'E-mail lido: Carta de aprovação do projeto', detalhe: 'naoresponda@enel.exemplo.test · A ENEL aprovou o projeto.',
    situacao: 'ok', project_id: 'p-2', projeto: 'PRJ-10002', protocolo: null,
  },
  {
    quando: '2026-10-21T09:00:00Z', ator: 'ludmilla', quem: 'Ludmilla', acao: 'recomendacao',
    titulo: 'Mudança no portal: CARTA_PROJETO · FAVORAVEL', detalhe: 'Protocolo 900000222 · sugere approved',
    situacao: 'ok', project_id: 'p-2', projeto: 'PRJ-10002', protocolo: '900000222',
  },
  {
    quando: '2026-10-10T14:00:00Z', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada',
    titulo: 'Recomendação aplicada', detalhe: 'Protocolo 900000111 → documentation',
    situacao: 'ok', project_id: 'p-2', projeto: 'PRJ-10002', protocolo: '900000111',
  },
];
```

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `npx vitest run src/lib/ludmillaPainel.test.ts src/lib/ludmillaCaixa.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 7: Verificar o resto**

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1 · `npm run build` sem erro · `npm test` sem `failed`.

- [ ] **Step 8: Commit**

Mensagem (`$RASCUNHO/msg-task3.txt`):

```text
feat(ludmilla): lógica do topo e do detalhe da página nova

Saúde de cada concessionária (erro, sessão, estação, caixa, leitura
atrasada), os chips com "lida há" e pendentes, os alertas urgentes, o que
chegou (e-mail ou portal), os botões do detalhe com a trava de sempre do
Aplicar, o texto do aviso com Desfazer e o número da CPFL na criação —
tudo em funções puras com teste.

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaPainel.ts src/lib/ludmillaPainel.test.ts src/lib/ludmillaCaixa.fixtures.ts
git commit -F "$RASCUNHO/msg-task3.txt" -- src/lib/ludmillaPainel.ts src/lib/ludmillaPainel.test.ts src/lib/ludmillaCaixa.fixtures.ts
git show --stat HEAD
```

---

### Task 4: Fila de decisões com "Desfazer"

**Files:**
- Create: `src/lib/ludmillaFilaDeDecisoes.ts`
- Create: `src/hooks/useFilaDeDecisoes.ts`
- Test: `src/lib/ludmillaFilaDeDecisoes.test.ts`

**Interfaces:**
- Consumes: `ItemDaCaixa`, `limparOcultos` (Task 2); `toast` de `sonner`.
- Produces:
  - `criarFilaDeDecisoes(op: OpcoesDaFila): FilaDeDecisoes` com `adiar({ chave, executar })`, `desfazer(chave): boolean`, `descarregar(): void`, `emEspera(): string[]`; `OpcoesDaFila = { esperaMs; aoMudar(chaves: string[]); aoFalhar(chave, erro); relogio? }`.
  - `ESPERA_DO_DESFAZER_MS = 8_000` e `useFilaDeDecisoes(itens: ItemDaCaixa[]): { ocultos: ReadonlySet<string>; emEspera: string[]; decidir(chave: string, texto: string, executar: () => Promise<unknown>): void }`.

- [ ] **Step 1: Medir o baseline do tsc**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → anote.

- [ ] **Step 2: Escrever o teste que falha**

Crie `src/lib/ludmillaFilaDeDecisoes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarFilaDeDecisoes } from './ludmillaFilaDeDecisoes';

describe('fila de decisões com Desfazer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const montar = () => {
    const mudancas: string[][] = [];
    const falhas: [string, unknown][] = [];
    const fila = criarFilaDeDecisoes({
      esperaMs: 8000, aoMudar: c => mudancas.push(c), aoFalhar: (c, e) => falhas.push([c, e]),
    });
    return { fila, mudancas, falhas };
  };

  it('só grava depois da espera', async () => {
    const { fila } = montar();
    const executar = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar });
    await vi.advanceTimersByTimeAsync(7999);
    expect(executar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(executar).toHaveBeenCalledTimes(1);
    expect(fila.emEspera()).toEqual([]);
  });

  it('Desfazer dentro da espera: nada vai ao banco', async () => {
    const { fila } = montar();
    const executar = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fila.desfazer('u:1')).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(executar).not.toHaveBeenCalled();
    expect(fila.desfazer('u:1')).toBe(false);
  });

  it('Desfazer depois da espera não volta atrás (já foi)', async () => {
    const { fila } = montar();
    const executar = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar });
    await vi.advanceTimersByTimeAsync(8000);
    expect(fila.desfazer('u:1')).toBe(false);
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it('descarregar grava já o que está esperando, uma vez só', async () => {
    const { fila } = montar();
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar: a });
    fila.adiar({ chave: 'f:2', executar: b });
    fila.descarregar();
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('falha devolve a chave para a tela', async () => {
    const { fila, falhas } = montar();
    const erro = new Error('Esta recomendação já foi aplicada.');
    fila.adiar({ chave: 'u:1', executar: vi.fn().mockRejectedValue(erro) });
    await vi.advanceTimersByTimeAsync(8000);
    expect(falhas).toEqual([['u:1', erro]]);
  });

  it('erro síncrono também é falha', async () => {
    const { fila, falhas } = montar();
    fila.adiar({ chave: 'u:1', executar: () => { throw new Error('quebrou'); } });
    await vi.advanceTimersByTimeAsync(8000);
    expect(falhas.map(f => f[0])).toEqual(['u:1']);
  });

  it('avisa a tela do que está em espera', () => {
    const { fila, mudancas } = montar();
    fila.adiar({ chave: 'u:1', executar: vi.fn().mockResolvedValue(undefined) });
    fila.adiar({ chave: 'u:2', executar: vi.fn().mockResolvedValue(undefined) });
    fila.desfazer('u:1');
    expect(mudancas).toEqual([['u:1'], ['u:1', 'u:2'], ['u:2']]);
  });

  it('decidir de novo o mesmo item recomeça a espera e só grava a última', async () => {
    const { fila } = montar();
    const primeira = vi.fn().mockResolvedValue(undefined);
    const segunda = vi.fn().mockResolvedValue(undefined);
    fila.adiar({ chave: 'u:1', executar: primeira });
    await vi.advanceTimersByTimeAsync(5000);
    fila.adiar({ chave: 'u:1', executar: segunda });
    await vi.advanceTimersByTimeAsync(5000);
    expect(segunda).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(primeira).not.toHaveBeenCalled();
    expect(segunda).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/ludmillaFilaDeDecisoes.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaFilaDeDecisoes"`.

- [ ] **Step 4: Escrever a fila**

Crie `src/lib/ludmillaFilaDeDecisoes.ts`:

```ts
/**
 * A FILA DE DECISÕES COM "DESFAZER" — sem React.
 *
 * Decisão do plano (22/10/2026): "Desfazer" não desfaz nada no banco — a decisão
 * ESPERA alguns segundos antes de ir. Assim a mesma RPC de hoje
 * (`ludmilla_aplicar_update`, `ludmilla_ignorar_update`, `ludmilla_afazer_feito`)
 * continua sendo a única coisa que grava, e desfazer é só não mandar.
 */

export interface DecisaoAdiada {
  chave: string;
  executar: () => Promise<unknown>;
}

export interface OpcoesDaFila {
  esperaMs: number;
  /** o conjunto do que está esperando mudou (a tela liga/desliga o aviso de saída) */
  aoMudar: (emEspera: string[]) => void;
  /** a gravação falhou: a tela devolve o item à lista */
  aoFalhar: (chave: string, erro: unknown) => void;
  relogio?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
}

export interface FilaDeDecisoes {
  adiar(d: DecisaoAdiada): void;
  /** true = cancelou a tempo; false = já tinha ido (ou nunca esteve na fila) */
  desfazer(chave: string): boolean;
  /** grava agora tudo o que está esperando (saída da página) */
  descarregar(): void;
  emEspera(): string[];
}

export function criarFilaDeDecisoes(op: OpcoesDaFila): FilaDeDecisoes {
  const relogio = op.relogio ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const espera = new Map<string, { timer: unknown; executar: () => Promise<unknown> }>();
  const avisar = () => op.aoMudar([...espera.keys()]);

  const disparar = (chave: string) => {
    const d = espera.get(chave);
    if (!d) return;
    relogio.clearTimeout(d.timer);
    espera.delete(chave);
    avisar();
    Promise.resolve()
      .then(() => d.executar())
      .catch(e => op.aoFalhar(chave, e));
  };

  return {
    adiar(d) {
      const velha = espera.get(d.chave);
      if (velha) relogio.clearTimeout(velha.timer);
      const timer = relogio.setTimeout(() => disparar(d.chave), op.esperaMs);
      espera.set(d.chave, { timer, executar: d.executar });
      avisar();
    },
    desfazer(chave) {
      const d = espera.get(chave);
      if (!d) return false;
      relogio.clearTimeout(d.timer);
      espera.delete(chave);
      avisar();
      return true;
    },
    descarregar() {
      for (const chave of [...espera.keys()]) disparar(chave);
    },
    emEspera: () => [...espera.keys()],
  };
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/ludmillaFilaDeDecisoes.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 6: Escrever o hook**

Crie `src/hooks/useFilaDeDecisoes.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { criarFilaDeDecisoes, type FilaDeDecisoes } from '@/lib/ludmillaFilaDeDecisoes';
import { limparOcultos, type ItemDaCaixa } from '@/lib/ludmillaCaixa';

/** Quanto a decisão espera antes de ir ao banco (é a janela do "Desfazer"). */
export const ESPERA_DO_DESFAZER_MS = 8_000;

function semChave(o: ReadonlySet<string>, chave: string): ReadonlySet<string> {
  const n = new Set(o);
  n.delete(chave);
  return n;
}

/**
 * A fila em React. `ocultos` = o que a pessoa já decidiu e a lista não mostra
 * mais — fica oculto até a decisão chegar ao banco e o refetch trazer o item como
 * não pendente (`limparOcultos`). Sair da página grava na hora; fechar a aba com
 * decisão esperando faz o navegador perguntar.
 */
export function useFilaDeDecisoes(itens: ItemDaCaixa[]) {
  const [ocultos, setOcultos] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [emEspera, setEmEspera] = useState<string[]>([]);
  const filaRef = useRef<FilaDeDecisoes | null>(null);
  if (filaRef.current === null) {
    filaRef.current = criarFilaDeDecisoes({
      esperaMs: ESPERA_DO_DESFAZER_MS,
      aoMudar: setEmEspera,
      // o banco recusou (alguém decidiu antes, rede caiu): a linha volta; o hook
      // da mutação já mostrou o erro
      aoFalhar: chave => setOcultos(o => semChave(o, chave)),
    });
  }
  const fila = filaRef.current;

  useEffect(() => () => fila.descarregar(), [fila]);

  useEffect(() => {
    if (emEspera.length === 0) return;
    const segurar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [emEspera.length]);

  useEffect(() => {
    setOcultos(o => {
      if (o.size === 0) return o;
      const n = limparOcultos(o, itens);
      return n.size === o.size ? o : n;
    });
  }, [itens]);

  const decidir = useCallback((chave: string, texto: string, executar: () => Promise<unknown>) => {
    setOcultos(o => new Set(o).add(chave));
    fila.adiar({ chave, executar });
    toast(texto, {
      duration: ESPERA_DO_DESFAZER_MS,
      // no alto: embaixo ele cobriria os botões fixos do detalhe no celular
      position: 'top-center',
      // com o detalhe aberto (Radix) o body fica sem clique; o aviso precisa dele
      style: { pointerEvents: 'auto' },
      action: {
        label: 'Desfazer',
        onClick: () => {
          if (fila.desfazer(chave)) setOcultos(o => semChave(o, chave));
          else toast.info('Já foi gravado. Para voltar, mude a etapa no card do projeto.');
        },
      },
    });
  }, [fila]);

  return { ocultos, emEspera, decidir };
}
```

- [ ] **Step 7: Verificar o resto**

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1 · `npm run build` sem erro · `npm test` sem `failed`.

- [ ] **Step 8: Commit**

Mensagem (`$RASCUNHO/msg-task4.txt`):

```text
feat(ludmilla): fila de decisões com Desfazer

O Desfazer não desfaz nada no banco: a decisão espera 8 s antes de ir, e
desfazer é só não mandar. Assim as RPCs de hoje continuam sendo a única
coisa que grava (ludmilla_aplicar_update intocada). Sair da página grava na
hora; fechar a aba com decisão esperando faz o navegador perguntar.

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaFilaDeDecisoes.ts src/lib/ludmillaFilaDeDecisoes.test.ts src/hooks/useFilaDeDecisoes.ts
git commit -F "$RASCUNHO/msg-task4.txt" -- src/lib/ludmillaFilaDeDecisoes.ts src/lib/ludmillaFilaDeDecisoes.test.ts src/hooks/useFilaDeDecisoes.ts
git show --stat HEAD
```

---

### Task 5: Hooks de dados da página nova

**Files:**
- Create: `src/hooks/useLudmillaDecidir.ts`
- Create: `src/hooks/useCaixaDaLudmilla.ts`
- Test: `$RASCUNHO/verificar-selects.mjs` (fora do repositório; não commitar)

**Interfaces:**
- Consumes: `supabase` (`@/integrations/supabase/client`); `useLudmillaDisponivel`, `usePortalAccounts`, `usePortalUpdates`, tipos `MensagemEmail` (`@/hooks/useLudmilla`); `useEnergyConcessionaires`; `useStatusLabel`; de `@/lib/ludmillaCaixa`: `Afazer`, `SituacaoDoFiltro`, `itensDaCaixa`, `unirPorId`; de `@/lib/ludmillaPainel`: `AnexoDoPortal`, `ParecerDoPortal`, `EventoDoProjeto`, `ProjetoDoDetalhe`, `ProjetoDaCriacao`. RPCs `ludmilla_afazer_feito(p_afazer_id)` e `ludmilla_linha_do_tempo(p_project_id, p_limite)` (Task 1).
- Produces:
  - em `@/hooks/useLudmillaDecidir`: constantes `SELECT_AFAZER`, `SELECT_MENSAGEM`, `SELECT_PROJETO_DO_DETALHE`, `SELECT_ANEXOS_DO_PROJETO`, `SELECT_PARECERES_DO_PROJETO`, `SELECT_PROJETO_DA_CRIACAO`; `urlDoDocumento(caminho): Promise<string | null>`; `useAfazeres(situacao)` (queryKey `['portal-afazeres', situacao]`); `useMarcarAfazerFeito()` (mutação `(id: string) => Promise<boolean>`); `useLinhaDoTempo(projectId)`; `useMensagemDaRecomendacao(updateId)`; `useProjetoDoDetalhe(projectId)`; `useDocumentosDoProjeto(projectId)` → `{ anexos, pareceres }`; `useProjetosDasCriacoes(ids)`.
  - em `@/hooks/useCaixaDaLudmilla`: `useCaixaDaLudmilla(situacao): { itens: ItemDaCaixa[]; contas: PortalAccount[]; nomeDaConta(id): string; carregando: boolean; buscando: boolean; erro: unknown; tentarDeNovo(): void }`.

- [ ] **Step 1: Medir o baseline do tsc**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → anote.

- [ ] **Step 2: Escrever a verificação dos selects (o teste)**

Ela pergunta ao PostgREST de verdade, com a chave PÚBLICA do `.env` (sem sessão, sem senha): um embed ou coluna errada volta como `PGRST1xx/PGRST2xx/42703`; um select certo volta `200 []` (a RLS esconde tudo) ou `42501` (o anônimo não tem privilégio na tabela nova).

Crie `$RASCUNHO/verificar-selects.mjs`:

```js
// Uso (da raiz do repositório): node "$RASCUNHO/verificar-selects.mjs"
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const url = env.VITE_SUPABASE_URL;
const chave = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const fonte = readFileSync('src/hooks/useLudmillaDecidir.ts', 'utf8');
const sel = nome => {
  const m = fonte.match(new RegExp(`export const ${nome} =\\s*'([^']+)'`));
  if (!m) throw new Error(`${nome} não encontrado em src/hooks/useLudmillaDecidir.ts`);
  return m[1];
};

const consultas = [
  ['portal_afazeres', 'SELECT_AFAZER'],
  ['portal_email_mensagens', 'SELECT_MENSAGEM'],
  ['projects', 'SELECT_PROJETO_DO_DETALHE'],
  ['projects', 'SELECT_PROJETO_DA_CRIACAO'],
  ['portal_anexos', 'SELECT_ANEXOS_DO_PROJETO'],
  ['portal_pareceres', 'SELECT_PARECERES_DO_PROJETO'],
];

for (const [tabela, nome] of consultas) {
  const r = await fetch(`${url}/rest/v1/${tabela}?select=${encodeURIComponent(sel(nome))}&limit=1`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
  const corpo = await r.json().catch(() => null);
  const codigo = corpo && !Array.isArray(corpo) ? corpo.code : null;
  const ok = r.ok || codigo === '42501';
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome} → ${tabela} ${r.status} ${codigo ?? ''}${ok ? '' : ' ' + JSON.stringify(corpo)}`);
  if (!ok) process.exitCode = 1;
}
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node "$RASCUNHO/verificar-selects.mjs"`
Expected: FALHA — `ENOENT … src/hooks/useLudmillaDecidir.ts`.

- [ ] **Step 4: Escrever os hooks de dados**

Crie `src/hooks/useLudmillaDecidir.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLudmillaDisponivel, type MensagemEmail } from '@/hooks/useLudmilla';
import type { Afazer, SituacaoDoFiltro } from '@/lib/ludmillaCaixa';
import type {
  AnexoDoPortal, EventoDoProjeto, ParecerDoPortal, ProjetoDaCriacao, ProjetoDoDetalhe,
} from '@/lib/ludmillaPainel';

/**
 * O QUE A PÁGINA NOVA DA LUDMILLA LÊ ALÉM DO QUE JÁ LIA (spec 2026-10-22 §4).
 * As recomendações continuam vindo de `usePortalUpdates` (useLudmilla.ts); aqui
 * moram o A fazer, o "Feito" e o que o painel de detalhe precisa. Tudo passa pela
 * RLS de quem lê. Os selects são constantes para a verificação contra o PostgREST.
 */

export const SELECT_AFAZER =
  '*, project:projects(id, code, status, title, companies:company_id(name), project_general_data(holder_name)), feito:feito_por(name)';
export const SELECT_MENSAGEM = '*';
export const SELECT_PROJETO_DO_DETALHE = 'id, code, status, protocol_number, project_general_data(uc_number)';
export const SELECT_ANEXOS_DO_PROJETO =
  'id, protocolo, nome_arquivo, situacao, motivo, enviado_em, created_at, document:documents(file_url, file_name)';
export const SELECT_PARECERES_DO_PROJETO = 'id, protocolo, data, analise, status, created_at';
export const SELECT_PROJETO_DA_CRIACAO = 'id, code, cpfl_node_id';

/** URL assinada de 5 min para abrir um documento do card (bucket privado). */
export async function urlDoDocumento(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(caminho, 300);
  if (error) return null;
  return data.signedUrl;
}

/** O A fazer da equipe. "Aplicadas" = os feitos; "Ignoradas" não existe para A fazer. */
export function useAfazeres(situacao: SituacaoDoFiltro) {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['portal-afazeres', situacao],
    queryFn: async (): Promise<Afazer[]> => {
      if (situacao === 'ignorada') return [];
      let q = supabase
        .from('portal_afazeres' as never)
        .select(SELECT_AFAZER)
        .order('criado_em', { ascending: false })
        .limit(200);
      if (situacao === 'pendente') q = q.is('feito_em', null);
      if (situacao === 'aplicada') q = q.not('feito_em', 'is', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Afazer[];
    },
    enabled: disponivel,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** "Marcar como feito": vale para a equipe toda. `false` = alguém já tinha marcado. */
export function useMarcarAfazerFeito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const { data, error } = await supabase.rpc('ludmilla_afazer_feito' as never, { p_afazer_id: id } as never);
      if (error) throw error;
      return data as unknown as boolean;
    },
    onSuccess: marcou => {
      qc.invalidateQueries({ queryKey: ['portal-afazeres'], exact: false });
      qc.invalidateQueries({ queryKey: ['ludmilla-linha-do-tempo'], exact: false });
      if (!marcou) toast.info('Alguém da equipe já tinha marcado como feito.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** "Este projeto na Ludmilla". */
export function useLinhaDoTempo(projectId: string | null) {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['ludmilla-linha-do-tempo', projectId],
    queryFn: async (): Promise<EventoDoProjeto[]> => {
      const { data, error } = await supabase.rpc('ludmilla_linha_do_tempo' as never, {
        p_project_id: projectId, p_limite: 60,
      } as never);
      if (error) throw error;
      return (data ?? []) as EventoDoProjeto[];
    },
    enabled: disponivel && !!projectId,
    staleTime: 30_000,
  });
}

/** A mensagem de e-mail que abriu o cartão (assunto, remetente, veredito, data). */
export function useMensagemDaRecomendacao(updateId: string | null) {
  return useQuery({
    queryKey: ['mensagem-da-recomendacao', updateId],
    queryFn: async (): Promise<MensagemEmail | null> => {
      const { data, error } = await supabase
        .from('portal_email_mensagens' as never)
        .select(SELECT_MENSAGEM)
        .eq('update_id', updateId as string)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as unknown as MensagemEmail[])[0] ?? null;
    },
    enabled: !!updateId,
    staleTime: 60_000,
  });
}

/** UC e protocolo do cadastro, para o "Quem". */
export function useProjetoDoDetalhe(projectId: string | null) {
  return useQuery({
    queryKey: ['projeto-do-detalhe', projectId],
    queryFn: async (): Promise<ProjetoDoDetalhe | null> => {
      const { data, error } = await supabase
        .from('projects' as never)
        .select(SELECT_PROJETO_DO_DETALHE)
        .eq('id', projectId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ProjetoDoDetalhe | null) ?? null;
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/** Anexos e pareceres que a Ludmilla levou a este projeto (os 10 mais novos de cada). */
export function useDocumentosDoProjeto(projectId: string | null) {
  return useQuery({
    queryKey: ['documentos-do-projeto-ludmilla', projectId],
    queryFn: async (): Promise<{ anexos: AnexoDoPortal[]; pareceres: ParecerDoPortal[] }> => {
      const [anexos, pareceres] = await Promise.all([
        supabase.from('portal_anexos' as never).select(SELECT_ANEXOS_DO_PROJETO)
          .eq('project_id', projectId as string).order('created_at', { ascending: false }).limit(10),
        supabase.from('portal_pareceres' as never).select(SELECT_PARECERES_DO_PROJETO)
          .eq('project_id', projectId as string).order('created_at', { ascending: false }).limit(10),
      ]);
      if (anexos.error) throw anexos.error;
      if (pareceres.error) throw pareceres.error;
      return {
        anexos: (anexos.data ?? []) as unknown as AnexoDoPortal[],
        pareceres: (pareceres.data ?? []) as unknown as ParecerDoPortal[],
      };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/** Código e número da CPFL dos projetos das criações (aba Criações na CPFL). */
export function useProjetosDasCriacoes(ids: string[]) {
  const chave = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['projetos-das-criacoes', chave],
    queryFn: async (): Promise<ProjetoDaCriacao[]> => {
      const { data, error } = await supabase
        .from('projects' as never)
        .select(SELECT_PROJETO_DA_CRIACAO)
        .in('id', chave);
      if (error) throw error;
      return (data ?? []) as unknown as ProjetoDaCriacao[];
    },
    enabled: chave.length > 0,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 5: Escrever o hook que junta tudo**

Crie `src/hooks/useCaixaDaLudmilla.ts`:

```ts
import { useCallback, useMemo } from 'react';
import { usePortalAccounts, usePortalUpdates } from '@/hooks/useLudmilla';
import { useAfazeres } from '@/hooks/useLudmillaDecidir';
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires';
import { useStatusLabel } from '@/hooks/useStatusLabel';
import { itensDaCaixa, unirPorId, type SituacaoDoFiltro } from '@/lib/ludmillaCaixa';

/**
 * Os itens da caixa: as pendentes SEMPRE (para os contadores) e as da situação
 * escolhida, recomendações + A fazer, sobre os MESMOS hooks de hoje (as chaves de
 * `usePortalUpdates` são as mesmas: Aplicar/Ignorar continuam atualizando tudo).
 */
export function useCaixaDaLudmilla(situacao: SituacaoDoFiltro) {
  const rotulo = useStatusLabel();
  const { data: contas = [] } = usePortalAccounts();
  const { data: concessionarias = [] } = useEnergyConcessionaires(false);
  const pendentes = usePortalUpdates('pendente');
  const daSituacao = usePortalUpdates(situacao);
  const afazeresPendentes = useAfazeres('pendente');
  const afazeresDaSituacao = useAfazeres(situacao);

  const nomeDaConta = useCallback((id: string) => {
    const c = contas.find(a => a.id === id);
    return concessionarias.find(x => x.id === c?.concessionaire_id)?.name ?? c?.connector?.toUpperCase() ?? '';
  }, [contas, concessionarias]);

  const itens = useMemo(() => itensDaCaixa({
    updates: unirPorId(pendentes.data ?? [], daSituacao.data ?? []),
    afazeres: unirPorId(afazeresPendentes.data ?? [], afazeresDaSituacao.data ?? []),
    contas, nomeDaConta, rotuloEtapa: rotulo,
  }), [pendentes.data, daSituacao.data, afazeresPendentes.data, afazeresDaSituacao.data, contas, nomeDaConta, rotulo]);

  const consultas = [pendentes, daSituacao, afazeresPendentes, afazeresDaSituacao];
  return {
    itens,
    contas,
    nomeDaConta,
    carregando: consultas.some(q => q.isLoading),
    buscando: consultas.some(q => q.isFetching),
    /** consulta que falhou NÃO é lista vazia: a tela avisa */
    erro: consultas.find(q => q.isError)?.error ?? null,
    tentarDeNovo: () => { for (const q of consultas) void q.refetch(); },
  };
}
```

- [ ] **Step 6: Rodar a verificação e ver passar**

Run: `node "$RASCUNHO/verificar-selects.mjs"`
Expected: seis linhas `OK` — `SELECT_AFAZER → portal_afazeres` com código `42501` (status 401 ou 403: o anônimo não tem privilégio na tabela nova) e as outras `200`. Qualquer `FALHA` (ex.: `PGRST200`, relação não encontrada) é select errado: corrija a constante e rode de novo.

- [ ] **Step 7: Verificar o resto**

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1 · `npm run build` sem erro · `npm test` sem `failed`.

- [ ] **Step 8: Commit**

Mensagem (`$RASCUNHO/msg-task5.txt`):

```text
feat(ludmilla): hooks da página nova (A fazer, detalhe, linha do tempo)

O A fazer (pendentes e feitos), o "Feito" da equipe, a mensagem de e-mail
do cartão, UC e protocolo do cadastro, anexos e pareceres do projeto, a
linha do tempo e o código/número da CPFL das criações. As recomendações
seguem nos hooks de hoje; useCaixaDaLudmilla junta tudo em itens. Os
selects foram conferidos contra o PostgREST com a chave pública.

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/hooks/useLudmillaDecidir.ts src/hooks/useCaixaDaLudmilla.ts
git commit -F "$RASCUNHO/msg-task5.txt" -- src/hooks/useLudmillaDecidir.ts src/hooks/useCaixaDaLudmilla.ts
git show --stat HEAD
```

---

### Task 6: Aba "Decidir" — lista, detalhe e celular

**Files:**
- Create: `src/hooks/useAgora.ts`
- Create: `src/components/ludmilla/decidir/visual.ts`
- Create: `src/components/ludmilla/decidir/LinhaDaCaixa.tsx`
- Create: `src/components/ludmilla/decidir/FiltrosDaCaixa.tsx`
- Create: `src/components/ludmilla/decidir/PainelDeDetalhe.tsx`
- Create: `src/components/ludmilla/decidir/CaixaDeDecisoes.tsx`
- Create: `src/components/ludmilla/decidir/AbaDecidir.tsx`
- Create: `src/components/ludmilla/decidir/AbaDecidirConectada.tsx`
- Create: `src/components/ludmilla/decidir/DetalheConectado.tsx`
- Test (harness, apagar antes do commit): `harness-ludmilla.html`, `src/harness-ludmilla.tsx`

**Interfaces:**
- Consumes: Tasks 2–5 (`ItemDaCaixa`, `FiltroDaCaixa`, `filtrarItens`, `proximaDepoisDe`, `selecaoValida`, `acoesDoItem`, `textoDaDecisao`, `situacaoDecidida`, `oQueChegou`, `ressalvaDoCartao`, `ucDoProjeto`, `cartaoBloqueado`, `useFilaDeDecisoes`, os hooks de `useLudmillaDecidir`, `useCaixaDaLudmilla`); `useAplicarUpdate`, `useIgnorarUpdate` (`@/hooks/useLudmilla`); `textoDaTrocaDeProtocolo`, `rotuloCasamento`, `mensagemDeErro` (`@/lib/ludmillaCartao`); `useStatusLabel`, `useStatusOrder`; `useWindowSize`.
- Produces:
  - `useAgora(intervaloMs?: number): number`.
  - `visual.ts`: `ICONE_DO_MEIO`, `NOME_DO_MEIO`, `COR_DO_SELO`, `corDoStatusDoPortal(status)`, `dataCurta(iso)`.
  - `DetalheDaDecisao(props: PropsDoDetalhe)` com `DadosDoDetalhe = { item; chegou: OQueChegou | null; ressalva: string | null; projeto: { uc; protocoloNoCadastro } | null; documentos: { anexos; pareceres } | null; linhaDoTempo: EventoDoProjeto[] | null; etapas: { key; label }[]; rotuloEtapa }` e `PropsDoDetalhe = { dados; layout: 'painel'|'folha'; onDecidir(acao: AcaoDaDecisao, etapa: string | null); onAbrirProjeto(id); urlDoDocumento(caminho) }`.
  - `CaixaDeDecisoes(props: PropsDaCaixa)`.
  - `AcoesDaCaixa = { aplicar(updateId, etapa: string | null): Promise<unknown>; ignorar(updateId): Promise<unknown>; feito(afazerId): Promise<unknown> }` e `AbaDecidir(props: PropsDaAbaDecidir)`.
  - `AbaDecidirConectada({ contaId: string | null; ocultos: ReadonlySet<string>; decidir; agora: number })` — é o que a Task 8 usa.
  - Atributos de prova: linha `data-linha="<chave>"`, detalhe `data-detalhe="<chave>"`, botões `data-teste="botoes-da-decisao"`.

- [ ] **Step 1: Medir o baseline do tsc**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → anote.

- [ ] **Step 2: Escrever o harness (o teste de tela)**

Crie `harness-ludmilla.html` (raiz do repositório):

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Harness — Ludmilla Decidir</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/harness-ludmilla.tsx"></script>
  </body>
</html>
```

Crie `src/harness-ludmilla.tsx`:

```tsx
// HARNESS DA ABA DECIDIR — dados inventados, nenhuma rede. APAGAR antes do commit.
import '@/index.css';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import { AbaDecidir, type AcoesDaCaixa } from '@/components/ludmilla/decidir/AbaDecidir';
import { DetalheDaDecisao } from '@/components/ludmilla/decidir/PainelDeDetalhe';
import { useFilaDeDecisoes } from '@/hooks/useFilaDeDecisoes';
import { useWindowSize } from '@/hooks/useWindowSize';
import { FILTRO_INICIAL, itensDaCaixa, type FiltroDaCaixa } from '@/lib/ludmillaCaixa';
import { oQueChegou, ressalvaDoCartao } from '@/lib/ludmillaPainel';
import {
  AFAZERES_DE_EXEMPLO, AGORA, CONTAS_DE_EXEMPLO, DOCUMENTOS_DE_EXEMPLO, ETAPAS_DE_EXEMPLO, LINHA_DO_TEMPO_DE_EXEMPLO,
  MENSAGEM_DA_TROCA, UPDATES_DE_EXEMPLO, nomeDaContaDeExemplo, rotuloDeExemplo,
} from '@/lib/ludmillaCaixa.fixtures';

declare global { interface Window { __decisoes: string[] } }
window.__decisoes = [];
const gravar = (o: string) => { window.__decisoes.push(o); return Promise.resolve(); };

function Harness() {
  const [filtro, setFiltro] = useState<FiltroDaCaixa>(FILTRO_INICIAL);
  const itens = useMemo(() => itensDaCaixa({
    updates: UPDATES_DE_EXEMPLO, afazeres: AFAZERES_DE_EXEMPLO, contas: CONTAS_DE_EXEMPLO,
    nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
  }), []);
  const { ocultos, decidir } = useFilaDeDecisoes(itens);
  const { isDesktop } = useWindowSize();
  const acoes: AcoesDaCaixa = {
    aplicar: (id, etapa) => gravar(`aplicar:${id}:${etapa ?? ''}`),
    ignorar: id => gravar(`ignorar:${id}`),
    feito: id => gravar(`feito:${id}`),
  };
  return (
    <div className="mx-auto max-w-7xl p-4">
      <AbaDecidir
        itens={itens} filtro={filtro} onFiltro={setFiltro} contaId={null} ocultos={ocultos} decidir={decidir}
        acoes={acoes} rotuloEtapa={rotuloDeExemplo} carregando={false} buscando={false} erro={null}
        onTentarDeNovo={() => undefined} agora={AGORA} modo={isDesktop ? 'lado_a_lado' : 'folha'}
        detalhe={(item, layout, onDecidir) => {
          const mensagem = item.id === 'u-enel-troca' ? MENSAGEM_DA_TROCA : null;
          return (
            <DetalheDaDecisao
              key={item.chave} layout={layout} onDecidir={onDecidir}
              onAbrirProjeto={id => window.__decisoes.push(`abrir:${id}`)}
              urlDoDocumento={async () => 'data:text/plain,documento-de-exemplo'}
              dados={{
                item,
                chegou: item.update ? oQueChegou(item.update, mensagem, item.meio) : null,
                ressalva: item.update ? ressalvaDoCartao(item.update, mensagem) : null,
                projeto: item.projectId ? { uc: '0123456789', protocoloNoCadastro: item.update?.protocolo_anterior ?? item.protocolo } : null,
                documentos: item.projectId ? DOCUMENTOS_DE_EXEMPLO : null,
                linhaDoTempo: item.projectId ? LINHA_DO_TEMPO_DE_EXEMPLO : [],
                etapas: ETAPAS_DE_EXEMPLO, rotuloEtapa: rotuloDeExemplo,
              }}
            />
          );
        }}
      />
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
```

- [ ] **Step 3: Abrir o harness e ver falhar**

Run (em segundo plano): `npx vite --port 5174 --strictPort`
Abra `http://localhost:5174/harness-ludmilla.html` no navegador do Claude.
Expected: erro do Vite `Failed to resolve import "@/components/ludmilla/decidir/AbaDecidir"`.

- [ ] **Step 4: Escrever `useAgora` e `visual.ts`**

Crie `src/hooks/useAgora.ts`:

```ts
import { useEffect, useState } from 'react';

/** "Agora" que anda sozinho — para o "há X min" das linhas e dos chips. */
export function useAgora(intervaloMs = 60_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return agora;
}
```

Crie `src/components/ludmilla/decidir/visual.ts`:

```ts
import { Globe, Mail, MonitorSmartphone, type LucideIcon } from 'lucide-react';
import type { MeioDoItem, TomDoSelo } from '@/lib/ludmillaCaixa';

export const ICONE_DO_MEIO: Record<MeioDoItem, LucideIcon> = { portal: Globe, email: Mail, estacao: MonitorSmartphone };
export const NOME_DO_MEIO: Record<MeioDoItem, string> = { portal: 'portal', email: 'e-mail', estacao: 'estação' };

export const COR_DO_SELO: Record<TomDoSelo, string> = {
  etapa: 'bg-emerald-100 text-emerald-800',
  protocolo: 'bg-violet-100 text-violet-800',
  anexo: 'bg-sky-100 text-sky-800',
  bloqueado: 'bg-red-100 text-red-800',
  afazer: 'bg-amber-100 text-amber-800',
  neutro: 'bg-slate-100 text-slate-700',
};

/** Cor do selo pelo status do portal (CPFL: Aprovado / Reprovado / Pendente / Em Andamento / Cancelado). */
export function corDoStatusDoPortal(status: string) {
  const s = status.toLowerCase();
  if (s.includes('aprov') && !s.includes('reprov')) return 'bg-emerald-100 text-emerald-800';
  if (s.includes('reprov') || s.includes('cancel')) return 'bg-red-100 text-red-800';
  if (s.includes('andamento')) return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
}

export const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
```

- [ ] **Step 5: Escrever a linha e os filtros**

Crie `src/components/ludmilla/decidir/LinhaDaCaixa.tsx`:

```tsx
import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { haQuantoTempo } from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';
import { COR_DO_SELO, ICONE_DO_MEIO, NOME_DO_MEIO } from './visual';

/** A linha compacta (spec §3.2): meio, código, concessionária, há quanto tempo, titular, empresa e selos. */
export function LinhaDaCaixa({ item, ativa, agora, onAbrir }: {
  item: ItemDaCaixa; ativa: boolean; agora: number; onAbrir: () => void;
}) {
  const Icone = ICONE_DO_MEIO[item.meio];
  return (
    <button
      type="button" onClick={onAbrir} data-linha={item.chave} aria-current={ativa ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
        ativa && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
        item.situacao !== 'pendente' && 'opacity-70',
      )}
    >
      <Icone size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label={NOME_DO_MEIO[item.meio]} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{item.codigo ?? 'Sem projeto casado'}</span>
          <span className="text-xs text-muted-foreground">{item.concessionaria}</span>
          <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{haQuantoTempo(item.quando, agora)}</span>
        </span>
        <span className="block truncate text-sm">
          {item.titular ?? '—'}
          <span className="text-muted-foreground"> · {item.empresa ?? '—'}</span>
        </span>
        <span className="flex flex-wrap gap-1">
          {item.selos.map(s => (
            <span key={s.texto} className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', COR_DO_SELO[s.tom])}>{s.texto}</span>
          ))}
        </span>
      </span>
    </button>
  );
}
```

Crie `src/components/ludmilla/decidir/FiltrosDaCaixa.tsx`:

```tsx
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FiltroDaCaixa, SituacaoDoFiltro, TipoDoFiltro } from '@/lib/ludmillaCaixa';

const SITUACOES: [SituacaoDoFiltro, string][] = [
  ['pendente', 'Pendentes'], ['aplicada', 'Aplicadas'], ['ignorada', 'Ignoradas'], ['todas', 'Todas'],
];
const TIPOS: [TipoDoFiltro, string][] = [
  ['etapa', 'Mudar etapa'], ['protocolo', 'Gravar protocolo'], ['bloqueado', 'Bloqueados'], ['afazer', 'A fazer'],
];

export function FiltrosDaCaixa({ filtro, onFiltro }: { filtro: FiltroDaCaixa; onFiltro: (f: FiltroDaCaixa) => void }) {
  const alternar = (t: TipoDoFiltro) => onFiltro({
    ...filtro, tipos: filtro.tipos.includes(t) ? filtro.tipos.filter(x => x !== t) : [...filtro.tipos, t],
  });
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={filtro.busca} onChange={e => onFiltro({ ...filtro, busca: e.target.value })}
          placeholder="Buscar projeto, titular, empresa ou protocolo" aria-label="Buscar" className="pl-8"
        />
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {SITUACOES.map(([v, r]) => (
          <Button key={v} size="sm" className="shrink-0" variant={filtro.situacao === v ? 'default' : 'ghost'}
            aria-pressed={filtro.situacao === v} onClick={() => onFiltro({ ...filtro, situacao: v })}>{r}</Button>
        ))}
        <span className="mx-1 hidden w-px self-stretch bg-border sm:block" aria-hidden />
        {TIPOS.map(([v, r]) => (
          <Button key={v} size="sm" className="shrink-0" variant={filtro.tipos.includes(v) ? 'secondary' : 'outline'}
            aria-pressed={filtro.tipos.includes(v)} onClick={() => alternar(v)}>{r}</Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Escrever o painel de detalhe**

Crie `src/components/ludmilla/decidir/PainelDeDetalhe.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, ClipboardCheck, ClipboardList, ExternalLink, FileText,
  Mail, MessageSquare, Paperclip, Radar, ShieldAlert, ShieldQuestion, XCircle, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rotuloCasamento, textoDaTrocaDeProtocolo } from '@/lib/ludmillaCartao';
import { cartaoBloqueado, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import {
  acoesDoItem, situacaoDecidida, type AcaoDaDecisao, type AcaoDoProjeto, type AnexoDoPortal, type EventoDoProjeto,
  type OQueChegou, type ParecerDoPortal,
} from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';
import { COR_DO_SELO, NOME_DO_MEIO, corDoStatusDoPortal, dataCurta } from './visual';

/**
 * O PAINEL DE DETALHE (spec §3.2): Quem · O que chegou · A sugestão · Ações ·
 * Este projeto na Ludmilla. Só desenha: os dados chegam prontos (DetalheConectado
 * no app, fixtures no harness). `layout = 'folha'` (celular) põe os botões num
 * rodapé fixo — um flex de coluna, NUNCA sticky (não gruda dentro de overflow).
 */

export interface DadosDoDetalhe {
  item: ItemDaCaixa;
  chegou: OQueChegou | null;
  ressalva: string | null;
  projeto: { uc: string | null; protocoloNoCadastro: string | null } | null;
  documentos: { anexos: AnexoDoPortal[]; pareceres: ParecerDoPortal[] } | null;
  /** null = carregando */
  linhaDoTempo: EventoDoProjeto[] | null;
  etapas: { key: string; label: string }[];
  rotuloEtapa: (s: string | null | undefined) => string;
}

export interface PropsDoDetalhe {
  dados: DadosDoDetalhe;
  layout: 'painel' | 'folha';
  onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void;
  onAbrirProjeto: (projectId: string) => void;
  urlDoDocumento: (caminho: string) => Promise<string | null>;
}

const VEREDITO: Record<string, { texto: string; cor: string }> = {
  favoravel: { texto: 'favorável', cor: 'bg-emerald-100 text-emerald-800' },
  pendencia: { texto: 'com pendência', cor: 'bg-amber-100 text-amber-800' },
  inconclusivo: { texto: 'não consegui ler', cor: 'bg-slate-200 text-slate-700' },
};

const ICONE_DO_EVENTO: Record<AcaoDoProjeto, LucideIcon> = {
  visita: Radar, recomendacao: ArrowRight, aplicada: CheckCircle2, ignorada: XCircle, anexo: Paperclip,
  parecer: MessageSquare, captcha_pedido: ShieldQuestion, captcha_respondido: ShieldQuestion,
  tarefa_encerrada: ClipboardCheck, email: Mail, afazer: ClipboardList, afazer_feito: CheckCheck,
};

const semEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '');

async function abrirDocumento(caminho: string, urlDoDocumento: PropsDoDetalhe['urlDoDocumento']) {
  // a janela abre NO clique (o bloqueador de pop-up deixa) e recebe o endereço depois
  const janela = window.open('', '_blank');
  if (janela) janela.opener = null;
  const url = await urlDoDocumento(caminho);
  if (janela && url) janela.location.href = url;
  else janela?.close();
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

function Selos({ item }: { item: ItemDaCaixa }) {
  return (
    <div className="flex flex-wrap gap-1">
      {item.selos.map(s => (
        <span key={s.texto} className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', COR_DO_SELO[s.tom])}>{s.texto}</span>
      ))}
    </div>
  );
}

function Quem({ item, projeto }: { item: ItemDaCaixa; projeto: DadosDoDetalhe['projeto'] }) {
  const casado = item.update && item.update.casamento !== 'protocolo' ? rotuloCasamento(item.update.casamento) : null;
  const linhas: [string, ReactNode][] = [
    ['Titular', (
      <>
        {item.titular ?? '—'}
        {item.noPortal && (
          <span className="block text-xs text-muted-foreground">no portal: <span className="font-mono">{item.noPortal}</span></span>
        )}
        {casado && <span className="block text-xs text-muted-foreground">casado por {casado}</span>}
      </>
    )],
    ['Empresa', item.empresa ?? '—'],
    ['UC', projeto?.uc ?? '—'],
    ['Protocolo no cadastro', projeto?.protocoloNoCadastro ?? '—'],
  ];
  return (
    <Secao titulo="Quem">
      <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="pt-0.5 text-xs text-muted-foreground">{rotulo}</dt>
            <dd className="break-words">{valor}</dd>
          </div>
        ))}
      </dl>
    </Secao>
  );
}

function OQueChegouSecao({ item, chegou, ressalva, documentos, urlDoDocumento }: {
  item: ItemDaCaixa; chegou: OQueChegou | null; ressalva: string | null;
  documentos: DadosDoDetalhe['documentos']; urlDoDocumento: PropsDoDetalhe['urlDoDocumento'];
}) {
  const bloqueado = !!item.update && cartaoBloqueado(item.update);
  return (
    <Secao titulo="O que chegou">
      {bloqueado && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 text-sm">
            <b>Documento não anexado</b>
            {ressalva && <span className="block break-words text-xs">{ressalva}</span>}
          </div>
        </div>
      )}
      {item.afazer ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{semEmoji(item.afazer.titulo)}</p>
          <p className="break-words text-muted-foreground">{item.afazer.mensagem}</p>
          <p className="text-xs text-muted-foreground">{item.concessionaria} · {dataCurta(item.afazer.criado_em)}</p>
        </div>
      ) : chegou?.meio === 'email' ? (
        <div className="space-y-1.5 text-sm">
          <p className="text-xs text-muted-foreground">
            {chegou.remetente ?? 'remetente desconhecido'} ·{' '}
            {chegou.recebidoEm ? `e-mail recebido em ${dataCurta(chegou.recebidoEm)}` : `lido pela Ludmilla em ${dataCurta(chegou.lidoEm)}`}
          </p>
          <p className="break-words font-mono text-xs">{chegou.assunto ?? '(sem assunto)'}</p>
          <div className="flex flex-wrap items-center gap-2">
            {chegou.veredito && (
              <span className={cn('rounded px-1.5 py-0.5 text-[11px]', VEREDITO[chegou.veredito].cor)}>{VEREDITO[chegou.veredito].texto}</span>
            )}
            {chegou.anexos > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700"><Paperclip size={11} aria-hidden /> {chegou.anexos} no card</span>
            )}
          </div>
          {chegou.resumo && <p className="break-words">{chegou.resumo}</p>}
          {chegou.arquivoLido && (
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileText size={11} aria-hidden /> a IA leu <span className="font-mono">{chegou.arquivoLido}</span>
            </p>
          )}
        </div>
      ) : chegou?.meio === 'portal' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chegou.de && (
            <>
              <span className={cn('rounded px-2 py-0.5 text-xs', corDoStatusDoPortal(chegou.de))}>{chegou.de}</span>
              <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
            </>
          )}
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', corDoStatusDoPortal(chegou.para))}>{chegou.para}</span>
          {chegou.atualizadoNoPortal && <span className="text-xs text-muted-foreground">atualizado no portal em {chegou.atualizadoNoPortal}</span>}
        </div>
      ) : null}
      {documentos && (documentos.anexos.length > 0 || documentos.pareceres.length > 0) && (
        <ul className="divide-y rounded-lg border text-xs">
          {documentos.anexos.map(a => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2">
              <Paperclip size={12} className="shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono">{a.nome_arquivo}</span>
              <span className={cn('rounded px-1.5 py-0.5',
                a.situacao === 'enviado' ? 'bg-emerald-100 text-emerald-800'
                  : a.situacao === 'bloqueado' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700')}>
                {a.situacao === 'enviado' ? 'no card' : a.situacao}
              </span>
              {a.document?.file_url && (
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2"
                  onClick={() => void abrirDocumento(a.document!.file_url, urlDoDocumento)}>
                  <ExternalLink size={12} aria-hidden /> Abrir
                </Button>
              )}
            </li>
          ))}
          {documentos.pareceres.map(pa => (
            <li key={pa.id} className="flex items-start gap-2 px-3 py-2">
              <MessageSquare size={12} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 break-words">
                Parecer{pa.data ? ` de ${pa.data}` : ''}{pa.analise ? ` · ${pa.analise}` : ''}{pa.status ? ` · ${pa.status}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

function Sugestao({ item, etapa, onEtapa, etapas, rotuloEtapa, ressalva }: {
  item: ItemDaCaixa; etapa: string; onEtapa: (v: string) => void;
  etapas: DadosDoDetalhe['etapas']; rotuloEtapa: DadosDoDetalhe['rotuloEtapa']; ressalva: string | null;
}) {
  const u = item.update;
  if (!u) return null;
  const pendente = item.situacao === 'pendente';
  return (
    <Secao titulo="A sugestão">
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          No sistema: <b className="text-foreground">{rotuloEtapa(u.project?.status)}</b>
          {u.recomendacao && <> · a Ludmilla sugere <b className="text-foreground">{rotuloEtapa(u.recomendacao)}</b></>}
        </p>
        {pendente && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Mover para</span>
            <Select value={etapa} onValueChange={onEtapa}>
              <SelectTrigger className="h-9 w-56" aria-label="Etapa"><SelectValue placeholder="escolha a etapa" /></SelectTrigger>
              <SelectContent>{etapas.map(e => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}</SelectContent>
            </Select>
            {u.recomendacao && etapa === u.recomendacao && <span className="text-xs text-emerald-700">recomendação da Ludmilla</span>}
          </div>
        )}
        {u.atualizar_protocolo && (
          <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
            {textoDaTrocaDeProtocolo(u.casamento, u.protocolo_anterior)}. Aplicar grava <span className="font-mono">{u.protocolo}</span> no cadastro.
          </p>
        )}
        {ressalva && !cartaoBloqueado(u) && (
          <p className="flex items-start gap-1.5 break-words text-xs text-amber-800">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {ressalva}
          </p>
        )}
      </div>
    </Secao>
  );
}

function BotoesDaDecisao({ item, etapa, onDecidir }: { item: ItemDaCaixa; etapa: string; onDecidir: PropsDoDetalhe['onDecidir'] }) {
  const decidida = situacaoDecidida(item);
  if (decidida) {
    return (
      <p data-teste="botoes-da-decisao" className="text-sm text-muted-foreground">
        {decidida.rotulo}{decidida.por ? ` por ${decidida.por}` : ''}{decidida.em ? ` em ${dataCurta(decidida.em)}` : ''}.
      </p>
    );
  }
  const { principal, secundaria } = acoesDoItem(item, etapa || null);
  return (
    <div data-teste="botoes-da-decisao" className="space-y-1.5">
      <div className="flex gap-2">
        {secundaria && (
          <Button variant="outline" className="flex-1 gap-1.5 sm:flex-none" onClick={() => onDecidir('ignorar', null)}>
            <XCircle size={15} aria-hidden /> {secundaria.rotulo}
          </Button>
        )}
        {principal && (
          <Button className="flex-1 gap-1.5 sm:flex-none" disabled={!principal.habilitada}
            onClick={() => onDecidir(principal.acao, principal.acao === 'aplicar' ? (etapa || null) : null)}>
            <CheckCircle2 size={15} aria-hidden /> {principal.rotulo}
          </Button>
        )}
      </div>
      {principal?.porque && <p className="text-xs text-muted-foreground">{principal.porque}</p>}
    </div>
  );
}

function LinhaDoTempo({ eventos }: { eventos: EventoDoProjeto[] | null }) {
  return (
    <Secao titulo="Este projeto na Ludmilla">
      {eventos === null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : eventos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nada registrado para este projeto.</p>
      ) : (
        <ol className="space-y-2">
          {eventos.map((e, i) => {
            const Icone = ICONE_DO_EVENTO[e.acao] ?? Radar;
            return (
              <li key={`${e.quando}-${i}`} className="flex gap-2 text-xs">
                <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                  e.situacao === 'erro' ? 'bg-red-100 text-red-700'
                    : e.situacao === 'aviso' ? 'bg-amber-100 text-amber-700'
                    : e.ator === 'ludmilla' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                  <Icone size={12} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{e.titulo}</span>
                  {e.detalhe && <span className="block break-words text-muted-foreground">{e.detalhe}</span>}
                </span>
                <span className="shrink-0 text-right text-muted-foreground">
                  <span className="block whitespace-nowrap">{dataCurta(e.quando)}</span>
                  <span className="block text-[11px]">{e.ator === 'ludmilla' ? 'Ludmilla' : e.quem || 'equipe'}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Secao>
  );
}

export function DetalheDaDecisao({ dados, layout, onDecidir, onAbrirProjeto, urlDoDocumento }: PropsDoDetalhe) {
  const { item } = dados;
  // nasce da recomendação; o componente pai troca a `key` quando ela muda no refetch
  const [etapa, setEtapa] = useState<string>(item.update?.recomendacao ?? '');

  const abrirProjeto = item.projectId && item.codigo ? (
    <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      onClick={() => onAbrirProjeto(item.projectId!)}>
      Abrir {item.codigo} <ExternalLink size={13} aria-hidden />
    </button>
  ) : null;

  const quem = <Quem item={item} projeto={dados.projeto} />;
  const chegou = <OQueChegouSecao item={item} chegou={dados.chegou} ressalva={dados.ressalva} documentos={dados.documentos} urlDoDocumento={urlDoDocumento} />;
  const sugestao = <Sugestao item={item} etapa={etapa} onEtapa={setEtapa} etapas={dados.etapas} rotuloEtapa={dados.rotuloEtapa} ressalva={dados.ressalva} />;
  const botoes = <BotoesDaDecisao item={item} etapa={etapa} onDecidir={onDecidir} />;
  const linha = item.projectId ? <LinhaDoTempo eventos={dados.linhaDoTempo} /> : null;

  if (layout === 'folha') {
    return (
      <div data-detalhe={item.chave} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><Selos item={item} />{abrirProjeto}</div>
          {quem}{chegou}{sugestao}{linha}
        </div>
        <div className="shrink-0 border-t bg-background p-3 safe-area-bottom">{botoes}</div>
      </div>
    );
  }

  return (
    <div data-detalhe={item.chave} className="space-y-5 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          {item.projectId && item.codigo ? (
            <button type="button" className="inline-flex items-center gap-1 text-lg font-semibold hover:underline"
              onClick={() => onAbrirProjeto(item.projectId!)}>
              {item.codigo} <ExternalLink size={14} aria-hidden />
            </button>
          ) : (
            <span className="text-lg font-semibold text-muted-foreground">{item.codigo ?? 'Sem projeto casado'}</span>
          )}
          <p className="text-xs text-muted-foreground">{item.concessionaria} · por {NOME_DO_MEIO[item.meio]} · {dataCurta(item.quando)}</p>
        </div>
        <Selos item={item} />
      </div>
      {quem}{chegou}{sugestao}
      <Secao titulo="Decidir">{botoes}</Secao>
      {linha}
    </div>
  );
}
```

- [ ] **Step 7: Escrever a caixa e a cola**

Crie `src/components/ludmilla/decidir/CaixaDeDecisoes.tsx`:

```tsx
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { FiltroDaCaixa, ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { FiltrosDaCaixa } from './FiltrosDaCaixa';
import { LinhaDaCaixa } from './LinhaDaCaixa';

export interface PropsDaCaixa {
  lista: ItemDaCaixa[];
  filtro: FiltroDaCaixa;
  onFiltro: (f: FiltroDaCaixa) => void;
  selecionada: string | null;
  onSelecionar: (chave: string | null) => void;
  /** lado_a_lado a partir de 1024 px; folha = detalhe por cima (celular e tablet) */
  modo: 'lado_a_lado' | 'folha';
  carregando: boolean;
  buscando: boolean;
  /** null = sem erro; texto (pode ser vazio) = a consulta falhou */
  erro: string | null;
  onTentarDeNovo: () => void;
  agora: number;
  renderDetalhe: (item: ItemDaCaixa, layout: 'painel' | 'folha') => ReactNode;
}

export function CaixaDeDecisoes(p: PropsDaCaixa) {
  const aberto = p.lista.find(i => i.chave === p.selecionada) ?? null;
  const semFiltro = p.filtro.situacao === 'pendente' && !p.filtro.busca && p.filtro.tipos.length === 0 && !p.filtro.contaId;

  const lista = (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {p.lista.map(i => (
        <li key={i.chave}>
          <LinhaDaCaixa item={i} ativa={i.chave === p.selecionada} agora={p.agora} onAbrir={() => p.onSelecionar(i.chave)} />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-3">
      <FiltrosDaCaixa filtro={p.filtro} onFiltro={p.onFiltro} />

      {/* Consulta que falhou NÃO é lista vazia: "Nada pendente" esconderia as recomendações. */}
      {p.erro !== null && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <AlertTriangle size={18} className="shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <b>Não consegui carregar as recomendações.</b>{' '}
            Isto não quer dizer que não haja nenhuma pendente — a consulta falhou.
            {p.erro && <span className="mt-0.5 block break-words text-xs text-red-800">{p.erro}</span>}
          </div>
          <Button size="sm" variant="outline" className="gap-2" disabled={p.buscando} onClick={p.onTentarDeNovo}>
            {p.buscando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Tentar de novo
          </Button>
        </div>
      )}

      {p.carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      ) : p.lista.length === 0 ? (
        p.erro === null && (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            {semFiltro ? 'Nada pendente — as concessionárias estão como o sistema.' : 'Nada com estes filtros.'}
          </div>
        )
      ) : p.modo === 'lado_a_lado' ? (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-4">
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto rounded-xl">{lista}</div>
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto rounded-xl border bg-card">
            {aberto ? p.renderDetalhe(aberto, 'painel') : <p className="p-6 text-sm text-muted-foreground">Escolha uma linha.</p>}
          </div>
        </div>
      ) : lista}

      {p.modo === 'folha' && (
        // Não modal: o aviso com "Desfazer" (fora da folha) precisa continuar clicável.
        <Sheet open={!!aberto} modal={false} onOpenChange={o => { if (!o) p.onSelecionar(null); }}>
          <SheetContent
            side="right" className="flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-none"
            onInteractOutside={e => {
              const alvo = e.target as Element | null;
              if (alvo?.closest?.('[data-sonner-toaster]')) e.preventDefault();
            }}
          >
            {aberto && (
              <>
                <SheetHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left">
                  <SheetTitle className="text-base">{aberto.codigo ?? 'Sem projeto casado'}</SheetTitle>
                  <SheetDescription>{aberto.concessionaria}{aberto.titular ? ` · ${aberto.titular}` : ''}</SheetDescription>
                </SheetHeader>
                {p.renderDetalhe(aberto, 'folha')}
              </>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
```

Crie `src/components/ludmilla/decidir/AbaDecidir.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from 'react';
import { filtrarItens, proximaDepoisDe, selecaoValida, type FiltroDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { textoDaDecisao, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import { CaixaDeDecisoes } from './CaixaDeDecisoes';

/** As três gravações possíveis — no app, as mutações de hoje; no harness, dublês. */
export interface AcoesDaCaixa {
  aplicar: (updateId: string, etapa: string | null) => Promise<unknown>;
  ignorar: (updateId: string) => Promise<unknown>;
  feito: (afazerId: string) => Promise<unknown>;
}

export interface PropsDaAbaDecidir {
  itens: ItemDaCaixa[];
  filtro: FiltroDaCaixa;
  onFiltro: (f: FiltroDaCaixa) => void;
  /** o chip da faixa de saúde (vem de fora da aba) */
  contaId: string | null;
  ocultos: ReadonlySet<string>;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  acoes: AcoesDaCaixa;
  rotuloEtapa: (s: string | null | undefined) => string;
  carregando: boolean;
  buscando: boolean;
  erro: string | null;
  onTentarDeNovo: () => void;
  agora: number;
  modo: 'lado_a_lado' | 'folha';
  detalhe: (item: ItemDaCaixa, layout: 'painel' | 'folha', onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void) => ReactNode;
}

/**
 * A COLA DA ABA DECIDIR: escolhe a linha aberta, decide e vai para a próxima
 * pendente (spec §3.2, "Depois de decidir"). Não lê banco — recebe tudo pronto.
 */
export function AbaDecidir(p: PropsDaAbaDecidir) {
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const lista = useMemo(
    () => filtrarItens(p.itens, { ...p.filtro, contaId: p.contaId }, p.ocultos),
    [p.itens, p.filtro, p.contaId, p.ocultos],
  );
  const efetiva = selecaoValida(lista, selecionada, p.modo === 'lado_a_lado');

  const decidirItem = (item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null) => {
    const proxima = proximaDepoisDe(lista, item.chave);
    const executar = acao === 'feito' ? () => p.acoes.feito(item.id)
      : acao === 'ignorar' ? () => p.acoes.ignorar(item.id)
      : () => p.acoes.aplicar(item.id, etapa);
    p.decidir(item.chave, textoDaDecisao(item, acao, etapa ? p.rotuloEtapa(etapa) : null), executar);
    setSelecionada(proxima);
  };

  return (
    <CaixaDeDecisoes
      lista={lista} filtro={{ ...p.filtro, contaId: p.contaId }} onFiltro={f => p.onFiltro({ ...f, contaId: null })}
      selecionada={efetiva} onSelecionar={setSelecionada} modo={p.modo}
      carregando={p.carregando} buscando={p.buscando} erro={p.erro} onTentarDeNovo={p.onTentarDeNovo} agora={p.agora}
      renderDetalhe={(item, layout) => p.detalhe(item, layout, (acao, etapa) => decidirItem(item, acao, etapa))}
    />
  );
}
```

Crie `src/components/ludmilla/decidir/DetalheConectado.tsx`:

```tsx
import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { oQueChegou, ressalvaDoCartao, ucDoProjeto, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import {
  urlDoDocumento, useDocumentosDoProjeto, useLinhaDoTempo, useMensagemDaRecomendacao, useProjetoDoDetalhe,
} from '@/hooks/useLudmillaDecidir';
import { DetalheDaDecisao, type DadosDoDetalhe } from './PainelDeDetalhe';

/** Liga o painel de detalhe às consultas (mensagem, cadastro, documentos, linha do tempo). */
export function DetalheConectado({ item, layout, etapas, rotuloEtapa, onDecidir, onAbrirProjeto }: {
  item: ItemDaCaixa;
  layout: 'painel' | 'folha';
  etapas: DadosDoDetalhe['etapas'];
  rotuloEtapa: DadosDoDetalhe['rotuloEtapa'];
  onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void;
  onAbrirProjeto: (projectId: string) => void;
}) {
  const ehEmail = item.origem === 'recomendacao' && item.meio === 'email';
  const { data: mensagem = null } = useMensagemDaRecomendacao(ehEmail ? item.id : null);
  const { data: projeto = null } = useProjetoDoDetalhe(item.projectId);
  const { data: documentos = null } = useDocumentosDoProjeto(item.projectId);
  const { data: linha } = useLinhaDoTempo(item.projectId);

  const dados: DadosDoDetalhe = {
    item,
    chegou: item.update ? oQueChegou(item.update, mensagem, item.meio) : null,
    ressalva: item.update ? ressalvaDoCartao(item.update, mensagem) : null,
    projeto: projeto ? { uc: ucDoProjeto(projeto), protocoloNoCadastro: projeto.protocol_number?.trim() || null } : null,
    documentos,
    linhaDoTempo: item.projectId ? (linha ?? null) : [],
    etapas,
    rotuloEtapa,
  };
  return <DetalheDaDecisao dados={dados} layout={layout} onDecidir={onDecidir} onAbrirProjeto={onAbrirProjeto} urlDoDocumento={urlDoDocumento} />;
}
```

Crie `src/components/ludmilla/decidir/AbaDecidirConectada.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAplicarUpdate, useIgnorarUpdate } from '@/hooks/useLudmilla';
import { useMarcarAfazerFeito } from '@/hooks/useLudmillaDecidir';
import { useCaixaDaLudmilla } from '@/hooks/useCaixaDaLudmilla';
import { useStatusLabel, useStatusOrder } from '@/hooks/useStatusLabel';
import { useWindowSize } from '@/hooks/useWindowSize';
import { FILTRO_INICIAL, type FiltroDaCaixa } from '@/lib/ludmillaCaixa';
import { mensagemDeErro } from '@/lib/ludmillaCartao';
import { AbaDecidir, type AcoesDaCaixa } from './AbaDecidir';
import { DetalheConectado } from './DetalheConectado';

/** A aba Decidir de verdade: os MESMOS hooks e RPCs de hoje + o A fazer. */
export function AbaDecidirConectada({ contaId, ocultos, decidir, agora }: {
  contaId: string | null;
  ocultos: ReadonlySet<string>;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  agora: number;
}) {
  const [filtro, setFiltro] = useState<FiltroDaCaixa>(FILTRO_INICIAL);
  const caixa = useCaixaDaLudmilla(filtro.situacao);
  const aplicar = useAplicarUpdate();
  const ignorar = useIgnorarUpdate();
  const feito = useMarcarAfazerFeito();
  const rotulo = useStatusLabel();
  const etapas = useStatusOrder();
  const navigate = useNavigate();
  const { isDesktop } = useWindowSize();

  const acoes = useMemo<AcoesDaCaixa>(() => ({
    aplicar: (id, etapa) => aplicar.mutateAsync({ id, status: etapa ?? undefined }),
    ignorar: id => ignorar.mutateAsync(id),
    feito: id => feito.mutateAsync(id),
  }), [aplicar.mutateAsync, ignorar.mutateAsync, feito.mutateAsync]);

  return (
    <AbaDecidir
      itens={caixa.itens} filtro={filtro} onFiltro={setFiltro} contaId={contaId} ocultos={ocultos} decidir={decidir}
      acoes={acoes} rotuloEtapa={rotulo} carregando={caixa.carregando} buscando={caixa.buscando}
      erro={caixa.erro ? (mensagemDeErro(caixa.erro) ?? '') : null} onTentarDeNovo={caixa.tentarDeNovo}
      agora={agora} modo={isDesktop ? 'lado_a_lado' : 'folha'}
      detalhe={(item, layout, onDecidir) => (
        // a etapa do detalhe nasce da recomendação: refetch que muda a recomendação recria o detalhe
        <DetalheConectado
          key={`${item.chave}|${item.update?.recomendacao ?? ''}`} item={item} layout={layout} etapas={etapas}
          rotuloEtapa={rotulo} onDecidir={onDecidir} onAbrirProjeto={id => navigate(`/project/${id}`)}
        />
      )}
    />
  );
}
```

- [ ] **Step 8: Provar no computador (1280 × 900)**

Recarregue `http://localhost:5174/harness-ludmilla.html` com a janela em 1280 × 900. Rode no console da página (ferramenta de JavaScript do navegador) e confira cada resultado:

```js
[...document.querySelectorAll('[data-linha]')].map(e => e.dataset.linha)
// ["u:u-enel-bloq","f:f-vistoria","u:u-cpfl","u:u-enel-troca","u:u-edp","u:u-cpfl-sem","f:f-devolucao"]
document.querySelector('[data-detalhe]').dataset.detalhe   // "u:u-enel-bloq" (a primeira abre sozinha)
document.querySelector('[data-detalhe]').textContent.includes('Documento não anexado')   // true
[...document.querySelectorAll('[data-teste="botoes-da-decisao"] button')].map(b => b.textContent.trim())   // ["Dispensar","Aplicar"]
document.documentElement.scrollWidth <= innerWidth   // true
```

Clique (de verdade, pela ferramenta de clique) na linha `PRJ-10002` e confira:

```js
document.querySelector('[data-detalhe]').textContent.includes('protocolo novo — casado por UC; no cadastro está "Sem protocolo"')   // true
document.querySelector('[data-detalhe]').textContent.includes('e-mail recebido em')   // true
```

Clique em "Aplicar etapa e protocolo" e confira em seguida:

```js
[...document.querySelectorAll('[data-linha]')].some(e => e.dataset.linha === 'u:u-enel-troca')   // false
document.querySelector('[data-detalhe]').dataset.detalhe   // "u:u-edp" (a de baixo)
document.querySelector('[data-sonner-toast]').textContent.includes('PRJ-10002 vai para Aprovado e grava o protocolo 900000222')   // true
window.__decisoes   // [] (ainda esperando)
```

Clique em "Desfazer" no aviso: a linha `u:u-enel-troca` volta e `window.__decisoes` continua `[]`. Agora clique em "Ignorar" no detalhe aberto (`u:u-edp`) e rode:

```js
await new Promise(r => setTimeout(r, 8500)); window.__decisoes   // ["ignorar:u-edp"]
```

Filtros: clique em "A fazer" → `[...document.querySelectorAll('[data-linha]')].map(e => e.dataset.linha)` dá `["f:f-vistoria","f:f-devolucao"]`; desmarque. Digite `prj-10001` na busca → `["u:u-cpfl"]`; limpe a busca. Clique em "Aplicadas" → `["f:f-feito","u:u-aplicada"]` e o detalhe de `f:f-feito` diz "Feito por Bia Souza".

- [ ] **Step 9: Provar no celular (390 × 812)**

Ponha a janela no preset `mobile`, recarregue e confira:

```js
document.querySelector('[data-detalhe]')   // null (no celular nada abre sozinho)
document.documentElement.scrollWidth <= innerWidth   // true
```

Toque na linha `PRJ-10001` e confira:

```js
document.querySelector('[role="dialog"]') !== null   // true (o detalhe por cima)
const b = document.querySelector('[data-teste="botoes-da-decisao"]').getBoundingClientRect(); b.bottom <= innerHeight && b.top > innerHeight - 140   // true (rodapé fixo, embaixo)
[...document.querySelectorAll('[data-teste="botoes-da-decisao"] button')].every(x => x.getBoundingClientRect().height >= 48)   // true
```

Role o corpo do detalhe até o fim (a rolagem é dentro da folha; os botões não se movem). Toque em "Aplicar": a folha mostra a próxima pendente (`u:u-enel-troca`). Com a folha aberta, toque DE VERDADE (clique por coordenada, não `.click()`) em "Desfazer" no aviso do alto: a folha continua aberta e `u:u-cpfl` volta à lista. Tire um print das duas larguras para o relatório.

- [ ] **Step 10: Apagar o harness e verificar o resto**

Pare o servidor do harness. Apague `harness-ludmilla.html` e `src/harness-ludmilla.tsx`.
Run: `git status --short` → nenhum `harness`.
Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1 · `npm run build` sem erro · `npm test` sem `failed`.

- [ ] **Step 11: Commit**

Mensagem (`$RASCUNHO/msg-task6.txt`):

```text
feat(ludmilla): aba Decidir — lista, detalhe e celular

Lista compacta com selos (mais antigas primeiro), busca e filtros, painel de
detalhe com Quem, O que chegou, A sugestão, os botões de sempre e a linha do
tempo do projeto; depois de decidir o painel vai para a próxima pendente e o
aviso oferece Desfazer. No celular o detalhe abre por cima, com os botões
fixos embaixo. Provado em harness com dados inventados (1280 e 390 px).
Ainda não ligado à página: entra na troca da Ludmilla.tsx.

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/hooks/useAgora.ts src/components/ludmilla/decidir
git commit -F "$RASCUNHO/msg-task6.txt" -- src/hooks/useAgora.ts src/components/ludmilla/decidir
git show --stat HEAD
```

---

### Task 7: Topo — faixa de saúde, alertas urgentes e barra de abas

**Files:**
- Create: `src/components/ludmilla/topo/FaixaDeSaude.tsx`
- Create: `src/components/ludmilla/topo/AlertasDasContas.tsx`
- Create: `src/components/ludmilla/topo/BarraDeAbas.tsx`
- Test (harness, apagar antes do commit): `harness-topo.html`, `src/harness-topo.tsx`

**Interfaces:**
- Consumes: `ChipDaConta`, `TomDaSaude`, `AlertaUrgente`, `chipsDaFaixa`, `alertasDasContas` (Task 3); `ICONE_DO_MEIO`, `NOME_DO_MEIO` (Task 6).
- Produces:
  - `FaixaDeSaude({ chips: ChipDaConta[]; contaId: string | null; onFiltrar(id: string | null): void; onVerificar(chip: ChipDaConta): void; verificando: boolean })`.
  - `AlertasDasContas({ alertas: AlertaUrgente[] })`.
  - `AbaDaLudmilla = 'decidir' | 'concessionarias' | 'criacoes' | 'registro'`, `ABAS_DA_LUDMILLA: { valor; rotulo; rotuloCurto; icone }[]`, `BarraDeAbas({ ativa: AbaDaLudmilla; onTrocar(a: AbaDaLudmilla): void; contadores: Partial<Record<AbaDaLudmilla, number>> })`.

- [ ] **Step 1: Medir o baseline do tsc**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → anote.

- [ ] **Step 2: Escrever o harness (o teste de tela)**

Crie `harness-topo.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Harness — Ludmilla topo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/harness-topo.tsx"></script>
  </body>
</html>
```

Crie `src/harness-topo.tsx`:

```tsx
// HARNESS DO TOPO DA LUDMILLA — dados inventados, nenhuma rede. APAGAR antes do commit.
import '@/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertasDasContas } from '@/components/ludmilla/topo/AlertasDasContas';
import { BarraDeAbas, type AbaDaLudmilla } from '@/components/ludmilla/topo/BarraDeAbas';
import { FaixaDeSaude } from '@/components/ludmilla/topo/FaixaDeSaude';
import { alertasDasContas, chipsDaFaixa } from '@/lib/ludmillaPainel';
import { AGORA, CONTA_CPFL, CONTA_EDP, CONTA_ELEKTRO, CONTA_ENEL, nomeDaContaDeExemplo } from '@/lib/ludmillaCaixa.fixtures';

declare global { interface Window { __verificar: string[] } }
window.__verificar = [];
const contas = [{ ...CONTA_CPFL, situacao: 'erro' as const, ultimo_erro: 'Tempo esgotado ao abrir a lista' }, CONTA_EDP, CONTA_ENEL, CONTA_ELEKTRO];

function Harness() {
  const [contaId, setContaId] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaDaLudmilla>('decidir');
  const chips = chipsDaFaixa(contas, {
    nomeDaConta: nomeDaContaDeExemplo, pendentesPorConta: { 'conta-enel': 4, 'conta-cpfl': 2 },
    estacaoDe: c => (c.modo === 'local' ? { online: true, texto: 'estação online' } : null), caixaPronta: false, agora: AGORA,
  });
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 pb-40">
      <AlertasDasContas alertas={alertasDasContas(contas, nomeDaContaDeExemplo, false)} />
      <FaixaDeSaude chips={chips} contaId={contaId} onFiltrar={setContaId}
        onVerificar={c => window.__verificar.push(`${c.id}:${c.tipoDoRun}`)} verificando={false} />
      <output data-teste="conta">{contaId ?? 'todas'}</output> · <output data-teste="aba">{aba}</output>
      <BarraDeAbas ativa={aba} onTrocar={setAba} contadores={{ decidir: 7 }} />
      {/* dublê da barra de atalhos do app (BottomNav: 64 px, embaixo de tudo) */}
      <nav aria-label="Atalhos" className="fixed bottom-0 left-0 right-0 z-30 h-16 bg-slate-800" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
```

- [ ] **Step 3: Abrir o harness e ver falhar**

Run (em segundo plano): `npx vite --port 5174 --strictPort`
Abra `http://localhost:5174/harness-topo.html`.
Expected: erro do Vite `Failed to resolve import "@/components/ludmilla/topo/AlertasDasContas"`.

- [ ] **Step 4: Escrever os três componentes**

Crie `src/components/ludmilla/topo/AlertasDasContas.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react';
import type { AlertaUrgente } from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';

/** Alertas urgentes (spec §3.1), só quando existem, acima de tudo (o código da imagem vem à parte). */
export function AlertasDasContas({ alertas }: { alertas: AlertaUrgente[] }) {
  if (alertas.length === 0) return null;
  return (
    <div className="space-y-2">
      {alertas.map(a => (
        <div key={a.chave} role="alert" className={cn('flex items-start gap-2 rounded-xl border-2 p-3 text-sm',
          a.tom === 'erro' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900')}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <b>{a.titulo}</b>
            {a.detalhe && <p className="mt-0.5 break-words text-xs">{a.detalhe}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

Crie `src/components/ludmilla/topo/FaixaDeSaude.tsx`:

```tsx
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChipDaConta, TomDaSaude } from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';
import { ICONE_DO_MEIO, NOME_DO_MEIO } from '@/components/ludmilla/decidir/visual';

const COR_DO_PONTO: Record<TomDaSaude, string> = {
  ok: 'bg-emerald-500', atencao: 'bg-amber-500', erro: 'bg-red-500', parada: 'bg-slate-400',
};

/**
 * A FAIXA DE SAÚDE (spec §3.1): um chip por concessionária. Clicar filtra a lista;
 * o botão ao lado faz "Verificar agora". No celular a faixa rola de lado.
 */
export function FaixaDeSaude({ chips, contaId, onFiltrar, onVerificar, verificando }: {
  chips: ChipDaConta[];
  contaId: string | null;
  onFiltrar: (id: string | null) => void;
  onVerificar: (chip: ChipDaConta) => void;
  verificando: boolean;
}) {
  return (
    <div data-teste="faixa" role="toolbar" aria-label="Concessionárias"
      className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
      <Button size="sm" className="shrink-0" variant={contaId === null ? 'default' : 'outline'}
        aria-pressed={contaId === null} onClick={() => onFiltrar(null)}>Todas</Button>
      {chips.map(c => {
        const Icone = ICONE_DO_MEIO[c.meio];
        const ativo = c.id === contaId;
        return (
          <div key={c.id} data-chip={c.id} className={cn('flex shrink-0 items-stretch rounded-lg border bg-card', ativo && 'ring-2 ring-primary/50')}>
            <button type="button" onClick={() => onFiltrar(ativo ? null : c.id)} aria-pressed={ativo}
              title={`${c.nome}: ${c.saude.texto}`} className="flex items-center gap-2 px-3 py-1.5 text-left text-sm">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COR_DO_PONTO[c.saude.tom])} aria-hidden />
              <span className="sr-only">{c.saude.texto}: </span>
              <span className="whitespace-nowrap font-medium">{c.nome}</span>
              <Icone size={13} className="text-muted-foreground" aria-label={NOME_DO_MEIO[c.meio]} />
              <span className="whitespace-nowrap text-xs text-muted-foreground">{c.lida}</span>
              {c.pendentes > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">{c.pendentes}</span>
              )}
            </button>
            <button type="button" onClick={() => onVerificar(c)} disabled={!c.podeVerificar || verificando}
              aria-label={`Verificar agora: ${c.nome}`} title="Verificar agora"
              className="border-l px-2 text-muted-foreground hover:text-foreground disabled:opacity-40">
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

Crie `src/components/ludmilla/topo/BarraDeAbas.tsx`:

```tsx
import { Building2, FilePlus2, Inbox, ScrollText, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AbaDaLudmilla = 'decidir' | 'concessionarias' | 'criacoes' | 'registro';

export const ABAS_DA_LUDMILLA: { valor: AbaDaLudmilla; rotulo: string; rotuloCurto: string; icone: LucideIcon }[] = [
  { valor: 'decidir', rotulo: 'Decidir', rotuloCurto: 'Decidir', icone: Inbox },
  { valor: 'concessionarias', rotulo: 'Concessionárias', rotuloCurto: 'Contas', icone: Building2 },
  { valor: 'criacoes', rotulo: 'Criações na CPFL', rotuloCurto: 'Criações', icone: FilePlus2 },
  { valor: 'registro', rotulo: 'Registro', rotuloCurto: 'Registro', icone: ScrollText },
];

/**
 * As abas no celular viram barra inferior (spec §3.4) — logo ACIMA da barra de
 * atalhos do app (BottomNav: 64 px + área segura), que continua visível.
 */
export function BarraDeAbas({ ativa, onTrocar, contadores }: {
  ativa: AbaDaLudmilla;
  onTrocar: (a: AbaDaLudmilla) => void;
  contadores: Partial<Record<AbaDaLudmilla, number>>;
}) {
  return (
    <nav aria-label="Abas da Ludmilla" className="fixed inset-x-0 z-20 grid h-14 grid-cols-4 border-t bg-background"
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
      {ABAS_DA_LUDMILLA.map(a => {
        const Icone = a.icone;
        const ligada = a.valor === ativa;
        const n = contadores[a.valor] ?? 0;
        return (
          <button key={a.valor} type="button" onClick={() => onTrocar(a.valor)} aria-current={ligada ? 'page' : undefined}
            className={cn('relative flex flex-col items-center justify-center gap-0.5 text-[11px]',
              ligada ? 'font-medium text-primary' : 'text-muted-foreground')}>
            <Icone size={18} aria-hidden />
            <span className="max-w-full truncate px-1">{a.rotuloCurto}</span>
            {n > 0 && (
              <span className="absolute right-[18%] top-1 min-w-[1.1rem] rounded-full bg-primary px-1 text-[10px] leading-4 tabular-nums text-primary-foreground">{n}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Provar no computador (1280 × 900)**

Recarregue `http://localhost:5174/harness-topo.html` em 1280 × 900:

```js
[...document.querySelectorAll('[role="alert"]')].map(a => a.querySelector('b').textContent)
// ["CPFL Paulista: a última leitura deu erro","Elektro: sessão expirada","A caixa de e-mail não está configurada"]
[...document.querySelectorAll('[data-chip]')].map(c => c.dataset.chip)   // ["conta-cpfl","conta-edp","conta-elektro","conta-enel"]
document.querySelector('[data-chip="conta-enel"]').textContent.includes('lida há 1 h')   // true
document.querySelector('[data-chip="conta-edp"]').textContent.includes('nunca lida')   // true
document.querySelector('[aria-label="Verificar agora: ENEL SP"]').disabled   // true (caixa não configurada)
document.querySelector('[data-teste="faixa"]').scrollWidth <= document.querySelector('[data-teste="faixa"]').clientWidth   // true (no computador quebra linha)
```

Clique no chip "ENEL SP" → `document.querySelector('[data-teste="conta"]').textContent === 'conta-enel'`; clique de novo → `'todas'`. Clique em "Verificar agora: CPFL Paulista" → `window.__verificar` dá `["conta-cpfl:varredura"]`.

- [ ] **Step 6: Provar no celular (390 × 812)**

Preset `mobile`, recarregue:

```js
document.documentElement.scrollWidth <= innerWidth   // true (a página não rola de lado)
const f = document.querySelector('[data-teste="faixa"]'); f.scrollWidth > f.clientWidth   // true (a faixa rola de lado)
const abas = document.querySelector('nav[aria-label="Abas da Ludmilla"]').getBoundingClientRect();
const atalhos = document.querySelector('nav[aria-label="Atalhos"]').getBoundingClientRect();
abas.bottom <= atalhos.top + 1 && abas.height >= 48   // true (acima da barra do app, alvo de toque ok)
```

Toque em "Contas" na barra → `document.querySelector('[data-teste="aba"]').textContent === 'concessionarias'`. Tire um print das duas larguras.

- [ ] **Step 7: Apagar o harness e verificar o resto**

Pare o servidor. Apague `harness-topo.html` e `src/harness-topo.tsx`. `git status --short` sem `harness`.
`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1 · `npm run build` sem erro · `npm test` sem `failed`.

- [ ] **Step 8: Commit**

Mensagem (`$RASCUNHO/msg-task7.txt`):

```text
feat(ludmilla): faixa de saúde, alertas e barra de abas

Topo da página nova: um chip por concessionária (saúde, meio, "lida há",
pendentes; clicar filtra, o botão ao lado faz Verificar agora), os alertas
urgentes só quando existem e, no celular, as abas numa barra logo acima da
barra de atalhos do app. Provado em harness (1280 e 390 px).

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/components/ludmilla/topo
git commit -F "$RASCUNHO/msg-task7.txt" -- src/components/ludmilla/topo
git show --stat HEAD
```

---

### Task 8: A página vira caixa de decisões — **só depois da rodada de fechamento da ENEL**

**Files:**
- Modify: `src/lib/ludmillaCaixa.ts` (`cartaoBloqueado` passa a chamar `detalheDoCartaoDeEmail`, se ela existir)
- Create: `src/components/ludmilla/abas/CartaoCaptcha.tsx`
- Create: `src/components/ludmilla/abas/CartaoDaConta.tsx`
- Create: `src/components/ludmilla/abas/AbaConcessionarias.tsx`
- Create: `src/components/ludmilla/abas/CriacoesCpfl.tsx`
- Create: `src/components/ludmilla/abas/RegistroDaLudmilla.tsx`
- Modify (reescrita inteira): `src/pages/Ludmilla.tsx`
- Modify: `docs/modules/integrations/ludmilla.md`, `CLAUDE.md`
- Test (harness, apagar antes do commit): `harness-pagina.html`, `src/harness-pagina.tsx`, `src/harness-duble/supabase.ts`, `src/harness-duble/AuthContext.tsx`, `vite.harness.config.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–7 (`AbaDecidirConectada`, `useFilaDeDecisoes`, `useCaixaDaLudmilla`, `useAgora`, `FaixaDeSaude`, `AlertasDasContas`, `BarraDeAbas`, `ABAS_DA_LUDMILLA`, `chipsDaFaixa`, `alertasDasContas`, `contarPendentes`, `rotuloDaCriacao`, `useProjetosDasCriacoes`, `dataCurta`); de `@/hooks/useLudmilla`: `estadoDaEstacao`, `useLudmillaDisponivel`, `usePedirRun`, `usePortalCaptchas`, `useRunsCriacaoCpfl`, `useResponderCaptcha`, `urlDoPrint`, `usePassosCriacao`, `useRegistroLudmilla`, `useUltimoRunEmail` e tipos; `useAgentConfig`; `RegrasEmail`; `ContadoresEmail`, `MensagensEmail`.
- Produces: a rota `/ludmilla` nova (export default `Ludmilla`, mesmo caminho, nada muda em `App.tsx`). Some o export `LinhaRecomendacao` (ninguém mais o importa).

- [ ] **Step 0: Portão — a rodada da ENEL já foi commitada?**

Pergunte ao usuário se a rodada de fechamento da ENEL foi commitada e confira:

```bash
git status --short -- src/pages/Ludmilla.tsx src/hooks/useLudmilla.ts src/components/ludmilla/MensagensEmail.tsx src/lib/ludmillaCartao.ts
git log --oneline 68c8a53..HEAD -- src/pages/Ludmilla.tsx src/hooks/useLudmilla.ts src/components/ludmilla/MensagensEmail.tsx src/lib/ludmillaCartao.ts
```

Expected: o `status` não lista nenhum desses arquivos (nada pendente da outra frente) e o usuário confirmou. Se listar, PARE: esta tarefa não começa com a outra frente aberta no mesmo arquivo.

- [ ] **Step 1: Medir o baseline do tsc e ler o que a ENEL mudou**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → anote.
Run: `git diff 68c8a53 HEAD -- src/pages/Ludmilla.tsx > "$RASCUNHO/ludmilla-enel.diff"` e leia o arquivo inteiro.

Regra para os Steps 3–7: o código abaixo é o de `Ludmilla.tsx` em `68c8a53`. Toda mudança do diff que caia dentro de `CartaoCaptcha`, do cartão de cada conta (`contas.map`), de `BlocoEmail`, de `CardCriacaoCpfl` ou de `RegistroDaLudmilla` entra no arquivo novo correspondente. Mudança em `LinhaRecomendacao` (ex.: a faixa "Documento não anexado", o "achado por", a data do e-mail) tem de existir no `PainelDeDetalhe`/`LinhaDaCaixa`: se não existir, acrescente-a lá. Liste no commit cada mudança carregada.

- [ ] **Step 2: Uma regra de bloqueio só (com a da ENEL)**

Run: `grep -n "export function detalheDoCartaoDeEmail" src/lib/ludmillaCartao.ts`
Se encontrar, troque em `src/lib/ludmillaCaixa.ts` o corpo de `cartaoBloqueado` (e apague a constante `ABRE_COM_NAO_ANEXEI` e o comentário dela):

```ts
import { detalheDoCartaoDeEmail, identidadeDoCartao } from '@/lib/ludmillaCartao';
```

```ts
/** O cartão diz que o documento NÃO foi anexado — a regra é a de `detalheDoCartaoDeEmail`. */
export function cartaoBloqueado(u: PortalUpdate): boolean {
  return detalheDoCartaoDeEmail(u)?.bloqueio ?? false;
}
```

Run: `npx vitest run src/lib/ludmillaCaixa.test.ts src/lib/ludmillaPainel.test.ts`
Expected: PASS (os casos de `cartaoBloqueado` têm `assunto` no `raw`, então valem para as duas regras). Se `grep` não encontrar, nada muda aqui.

- [ ] **Step 3: Mover o cartão do código da imagem**

Crie `src/components/ludmilla/abas/CartaoCaptcha.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { urlDoPrint, useResponderCaptcha, type PortalCaptcha } from '@/hooks/useLudmilla';

/**
 * CÓDIGO DA IMAGEM — a estação fotografou o CAPTCHA do portal e espera uma
 * pessoa. Quem responder primeiro (aqui, do celular que seja) libera a
 * visita. A Ludmilla nunca lê a imagem: a foto é para você.
 */
export function CartaoCaptcha({ c, portal }: { c: PortalCaptcha; portal: string }) {
  const responder = useResponderCaptcha();
  const [imagem, setImagem] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { urlDoPrint(c.imagem_path).then(setImagem); }, [c.imagem_path]);
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const restam = Math.max(0, Math.round((new Date(c.expira_em).getTime() - agora) / 1000));
  const enviar = () => {
    if (!codigo.trim()) return;
    responder.mutate({ captchaId: c.id, resposta: codigo.trim() });
  };
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="w-5 h-5 text-amber-700" />
        <span className="font-semibold text-amber-900">A Ludmilla precisa do código da imagem — {portal}</span>
        <span className="ml-auto text-xs text-amber-800 tabular-nums">{Math.floor(restam / 60)}:{String(restam % 60).padStart(2, '0')}</span>
      </div>
      {c.tentativa > 1 && (
        <p className="text-xs text-amber-800">
          Tentativa {c.tentativa}{c.mensagem ? ` — o portal disse: "${c.mensagem}"` : ''}. Nova imagem abaixo.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {imagem
          ? <img src={imagem} alt="Código da imagem do portal" className="rounded border bg-white h-16 object-contain" />
          : <div className="h-16 w-40 rounded border bg-white flex items-center justify-center text-xs text-muted-foreground">carregando…</div>}
        <Input
          value={codigo} onChange={e => setCodigo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar(); }}
          placeholder="Digite os caracteres" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false}
          className="w-44 text-lg tracking-widest font-mono"
        />
        <Button onClick={enviar} disabled={!codigo.trim() || responder.isPending || restam === 0} className="gap-2">
          {responder.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Enviar
        </Button>
      </div>
      <p className="text-xs text-amber-800">
        A estação preenche o código no portal e entra. Se errar, ela manda outra imagem. Ninguém além de você lê a imagem.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Mover o cartão da conta e criar a aba Concessionárias**

Crie `src/components/ludmilla/abas/CartaoDaConta.tsx` (o cartão de `contas.map` e o `BlocoEmail`, com duas mudanças pedidas pela spec §3.3: as regras de e-mail RECOLHIDAS num `<details>` e o botão "Acesso ao portal"):

```tsx
import { Clock, Globe, Inbox, KeyRound, Mail, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RegrasEmail } from '@/components/ludmilla/RegrasEmail';
import { ContadoresEmail, MensagensEmail } from '@/components/ludmilla/MensagensEmail';
import { estadoDaEstacao, useUltimoRunEmail, type PortalAccount, type TipoRun } from '@/hooks/useLudmilla';
import type { AgentConfigSafe } from '@/hooks/useAgentConfig';
import { dataCurta as quando } from '@/components/ludmilla/decidir/visual';
import { cn } from '@/lib/utils';

/**
 * O CORPO DO CARTÃO DE QUEM É ACOMPANHADA POR E-MAIL. Não tem nada de portal:
 * nem estação local, nem sessão viva, nem login — a credencial aqui é a caixa
 * do agente de e-mails, por tenant. Traz os contadores da última leitura, as
 * regras que ensinam a robô a reconhecer os e-mails, e o que ela já leu.
 */
function BlocoEmail({ conta, caixa }: { conta: PortalAccount; caixa: AgentConfigSafe | null | undefined }) {
  const { data: run = null } = useUltimoRunEmail(conta.id);

  return (
    <div className="space-y-3 pt-1">
      <div className="text-xs text-muted-foreground flex flex-wrap items-start gap-1.5">
        <Inbox size={12} className="mt-0.5 shrink-0" />
        {caixa?.gmail_email ? (
          <span>
            Caixa <b className="text-foreground">{caixa.gmail_email}</b> — a mesma do agente de e-mails.
            Ela só lê: nunca marca como lido nem move mensagem.
          </span>
        ) : (
          <span className="text-amber-700">
            A caixa de e-mail deste tenant não está configurada — sem ela não há o que ler.
            Configure em Claudinho / Agente de e-mails.
          </span>
        )}
      </div>

      <ContadoresEmail run={run} identificacao={conta.identificacao} />

      {/* spec §3.3: as regras ficam RECOLHIDAS — é configuração, não decisão */}
      <details className="rounded-lg border bg-muted/20 p-3">
        <summary className="cursor-pointer text-sm font-medium">Regras de leitura dos e-mails</summary>
        <div className="pt-2"><RegrasEmail accountId={conta.id} tenantId={conta.tenant_id} /></div>
      </details>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h4 className="text-sm font-medium">O que ela leu na caixa</h4>
          <span className="text-xs text-muted-foreground">
            o que precisa de você vem no alto, separado do histórico
          </span>
        </div>
        <MensagensEmail accountId={conta.id} />
      </div>
    </div>
  );
}

export function CartaoDaConta({ conta: c, nome, caixa, caixaPronta, verificando, onVerificar, onAcessoAoPortal }: {
  conta: PortalAccount;
  nome: string;
  caixa: AgentConfigSafe | null | undefined;
  caixaPronta: boolean;
  verificando: boolean;
  onVerificar: (tipo: TipoRun) => void;
  onAcessoAoPortal: () => void;
}) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 space-y-2',
      // quem é acompanhada por e-mail tem regras e histórico para mostrar
      c.acompanhamento === 'email' && 'sm:col-span-2 lg:col-span-3')}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{nome}</span>
        <span className={cn('text-xs',
          c.situacao === 'ok' ? 'text-emerald-600' : c.situacao === 'nao_configurado' ? 'text-muted-foreground' : 'text-red-600')}>
          {c.situacao === 'ok' ? 'conectada' : c.situacao === 'nao_configurado' ? 'sem acesso' : c.situacao === 'sessao_expirada' ? 'sessão expirada' : 'com erro'}
        </span>
      </div>
      {/* `modo` diz ONDE o robô roda; `acompanhamento` diz por que meio ele acompanha */}
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        {c.acompanhamento === 'email' ? <Mail size={12} /> : <Globe size={12} />}
        Acompanho por <b className="text-foreground">
          {c.acompanhamento === 'email' ? 'e-mail' : c.modo === 'local' ? 'portal (estação local)' : 'portal (VPS)'}
        </b>
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock size={12} />
        {c.acompanhamento === 'email'
          ? (c.ultima_varredura_em ? `última leitura da caixa ${quando(c.ultima_varredura_em)}` : 'ainda não leu a caixa')
          : (c.ultima_varredura_em ? `última varredura ${quando(c.ultima_varredura_em)}` : 'ainda não varreu')}
      </div>
      {c.acompanhamento === 'email' ? (
        <BlocoEmail conta={c} caixa={caixa} />
      ) : (
        <>
          {(() => {
            const e = estadoDaEstacao(c);
            if (!e) return null;
            return (
              <div className={cn('text-xs flex items-center gap-1.5', e.online ? 'text-emerald-600' : 'text-amber-600')}>
                <MonitorSmartphone size={12} />
                <span className={cn('inline-block w-2 h-2 rounded-full', e.online ? 'bg-emerald-500' : 'bg-amber-500')} />
                {e.texto}
              </div>
            );
          })()}
          {c.modo === 'local' && c.sessao_viva_desde && (
            <p className="text-xs text-emerald-700">Sessão no portal viva desde {quando(c.sessao_viva_desde)} — a estação toca o portal a cada 10 min; sem pedir código.</p>
          )}
          {c.modo === 'local' && c.situacao === 'sessao_expirada' && !c.sessao_viva_desde && (
            <p className="text-xs text-amber-700">Aguardando login na estação: ninguém digitou o código da imagem na última visita.</p>
          )}
        </>
      )}
      {c.ultimo_erro && <p className="text-xs text-red-600">{c.ultimo_erro}</p>}
      <div className="flex gap-2">
        {/* No e-mail não há login de portal: o que destrava o botão é a caixa configurada. */}
        <Button size="sm" variant="outline" className="gap-2 flex-1"
          disabled={(c.acompanhamento === 'email' ? !caixaPronta : !c.login) || verificando}
          onClick={() => onVerificar(c.acompanhamento === 'email' ? 'varredura_email' : 'varredura')}>
          <RefreshCw size={14} /> Verificar agora
        </Button>
        {c.acompanhamento !== 'email' && (
          <Button size="sm" variant="ghost" className="gap-2" onClick={onAcessoAoPortal}>
            <KeyRound size={14} /> Acesso ao portal
          </Button>
        )}
      </div>
    </div>
  );
}
```

Crie `src/components/ludmilla/abas/AbaConcessionarias.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { usePedirRun, type PortalAccount } from '@/hooks/useLudmilla';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { CartaoDaConta } from './CartaoDaConta';

/** Aba Concessionárias (spec §3.3): tudo o que hoje empurra as decisões para baixo. */
export function AbaConcessionarias({ contas, nomeDaConta }: { contas: PortalAccount[]; nomeDaConta: (id: string) => string }) {
  const navigate = useNavigate();
  const pedir = usePedirRun();
  // a caixa do agente de e-mails é por tenant: uma consulta serve para todos os cartões
  const { data: caixa } = useAgentConfig();
  const caixaPronta = !!caixa?.is_configured && !!caixa.gmail_email;

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {contas.length === 0 && (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
          Nenhum portal configurado. Em Concessionárias, use o ícone de chave para cadastrar o acesso.
        </div>
      )}
      {contas.map(c => (
        <CartaoDaConta
          key={c.id} conta={c} nome={nomeDaConta(c.id)} caixa={caixa} caixaPronta={caixaPronta}
          verificando={pedir.isPending} onVerificar={tipo => pedir.mutate({ accountId: c.id, tipo })}
          onAcessoAoPortal={() => navigate('/admin/energy-concessionaires')}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Mover as criações na CPFL (com código e número)**

Crie `src/components/ludmilla/abas/CriacoesCpfl.tsx`:

```tsx
import { useState } from 'react';
import { CheckCircle2, ChevronRight, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { urlDoPrint, usePassosCriacao, type PassoCriacao, type PortalRun } from '@/hooks/useLudmilla';
import { useProjetosDasCriacoes } from '@/hooks/useLudmillaDecidir';
import { rotuloDaCriacao, type ProjetoDaCriacao } from '@/lib/ludmillaPainel';
import { dataCurta as quando } from '@/components/ludmilla/decidir/visual';
import { cn } from '@/lib/utils';

const NOMES_PASSO: Record<PassoCriacao['nome'], string> = {
  login:          'Login na CPFL',
  introducao:     'Introdução',
  dados_uc:       'Dados da UC',
  dados_projeto:  'Dados do Projeto',
  dados_cliente:  'Dados do Cliente',
  revisao:        'Revisão',
  concluido:      'Concluído',
  simulado:       'Simulação concluída (sem salvar)',
};

function CardCriacaoCpfl({ run, projetoDe }: { run: PortalRun; projetoDe: (id: string) => ProjetoDaCriacao | null }) {
  const [expandido, setExpandido] = useState(false);
  const { data: passos = [] } = usePassosCriacao(expandido ? run.id : null);
  const [printUrls, setPrintUrls] = useState<Record<string, string>>({});
  const { titulo, numeroCpfl } = rotuloDaCriacao(run, projetoDe);

  async function carregarPrint(passo: PassoCriacao) {
    if (!passo.screenshot || printUrls[passo.id]) return;
    const url = await urlDoPrint(passo.screenshot);
    if (url) setPrintUrls(prev => ({ ...prev, [passo.id]: url }));
  }

  const situacaoCor = run.situacao === 'ok'
    ? 'text-emerald-600' : run.situacao === 'erro'
      ? 'text-red-600' : run.situacao === 'rodando'
        ? 'text-blue-600' : 'text-muted-foreground';

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button type="button" onClick={() => setExpandido(e => !e)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{titulo}</span>
            {numeroCpfl && <span className="text-xs text-muted-foreground">CPFL nº {numeroCpfl}</span>}
            <span className={cn('text-xs font-semibold', situacaoCor)}>
              {run.situacao === 'na_fila' ? 'na fila'
               : run.situacao === 'rodando' ? 'em andamento'
               : run.situacao === 'ok' ? 'concluído'
               : 'erro'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{quando(run.pedido_em)}</div>
        </div>
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', expandido && 'rotate-90')} />
      </button>

      {run.situacao === 'erro' && run.erro && <p className="px-4 pb-3 text-xs text-red-600">{run.erro}</p>}

      {expandido && (
        <div className="px-4 pb-4 space-y-2">
          {passos.length === 0 && run.situacao !== 'na_fila' && (
            <p className="text-xs text-muted-foreground">Nenhum passo registrado ainda.</p>
          )}
          {passos.map(p => (
            <div key={p.id} className="border rounded-md overflow-hidden">
              <button type="button" onClick={() => carregarPrint(p)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left">
                {p.status === 'ok'
                  ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  : p.status === 'erro'
                    ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    : <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />}
                <span className="flex-1 font-medium">{NOMES_PASSO[p.nome] ?? p.nome}</span>
                {p.screenshot && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {p.erro && <p className="px-3 pb-2 text-xs text-red-600">{p.erro}</p>}
              {printUrls[p.id] && (
                <div className="px-3 pb-3">
                  <a href={printUrls[p.id]} target="_blank" rel="noopener noreferrer">
                    <img src={printUrls[p.id]} alt={`Screenshot — ${NOMES_PASSO[p.nome]}`}
                      className="rounded border w-full max-h-48 object-cover object-top" />
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Aba Criações na CPFL. Cada tentativa é um run: por padrão, só a última por projeto. */
export function AbaCriacoesCpfl({ runs }: { runs: PortalRun[] }) {
  const [historico, setHistorico] = useState(false);
  const ids = runs.map(r => r.dados?.['project_id']).filter((x): x is string => typeof x === 'string');
  const { data: projetos = [] } = useProjetosDasCriacoes(ids);
  const projetoDe = (id: string) => projetos.find(p => p.id === id) ?? null;

  const visiveis = (() => {
    if (historico) return runs;
    const porProjeto = new Map<string, PortalRun>();
    for (const r of runs) {
      const chave = String(r.dados?.['project_id'] ?? r.id);
      if (!porProjeto.has(chave)) porProjeto.set(chave, r);
    }
    return [...porProjeto.values()].slice(0, 5);
  })();

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        Nenhuma criação pedida ainda. O botão "Criar na CPFL" fica no modal do projeto.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Criações no portal CPFL</h2>
        {runs.length > visiveis.length || historico ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setHistorico(v => !v)}>
            {historico ? 'Só a última por projeto' : `Ver histórico (${runs.length})`}
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">{visiveis.map(r => <CardCriacaoCpfl key={r.id} run={r} projetoDe={projetoDe} />)}</div>
    </div>
  );
}
```

- [ ] **Step 6: Mover o Registro**

Crie `src/components/ludmilla/abas/RegistroDaLudmilla.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardCheck, Loader2, MessageSquare, Paperclip, Radar, ShieldQuestion, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRegistroLudmilla, type AtorLudmilla, type RegistroLudmilla } from '@/hooks/useLudmilla';
import { dataCurta as quando } from '@/components/ludmilla/decidir/visual';
import { cn } from '@/lib/utils';

/**
 * REGISTRO — o que a Ludmilla fez e o que a equipe fez através dela.
 *
 * Não é uma tabela de log: é leitura unificada do que já estava gravado
 * (visitas, recomendações, decisões, anexos, pareceres, códigos de imagem,
 * tarefas encerradas), então o histórico inteiro aparece desde o primeiro dia.
 */
const ICONE_ACAO: Record<RegistroLudmilla['acao'], typeof Radar> = {
  visita: Radar,
  recomendacao: ArrowRight,
  aplicada: CheckCircle2,
  ignorada: XCircle,
  anexo: Paperclip,
  parecer: MessageSquare,
  captcha_pedido: ShieldQuestion,
  captcha_respondido: ShieldQuestion,
  tarefa_encerrada: ClipboardCheck,
};

export function RegistroDaLudmilla() {
  const navigate = useNavigate();
  const [ator, setAtor] = useState<'todos' | AtorLudmilla>('todos');
  const [tudo, setTudo] = useState(false);
  const { data: registro = [], isLoading } = useRegistroLudmilla(tudo ? 400 : 60, ator === 'todos' ? undefined : ator);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Registro</h2>
        <span className="text-xs text-muted-foreground">o que ela fez e o que foi feito através dela</span>
        <div className="ml-auto flex gap-1">
          {([['todos', 'Tudo'], ['ludmilla', 'Ela fez'], ['equipe', 'A equipe fez']] as const).map(([v, r]) => (
            <Button key={v} size="sm" variant={ator === v ? 'default' : 'ghost'} onClick={() => setAtor(v)}>{r}</Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      ) : registro.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Nada registrado ainda.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {registro.map((e, i) => {
            const Icone = ICONE_ACAO[e.acao] ?? Radar;
            return (
              <div key={`${e.quando}-${i}`} className="flex gap-3 p-3">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                  e.situacao === 'erro' ? 'bg-red-100 text-red-700'
                    : e.situacao === 'aviso' ? 'bg-amber-100 text-amber-700'
                    : e.ator === 'ludmilla' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                  <Icone size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{e.titulo}</span>
                    {e.projeto && (
                      <button className="text-xs text-primary hover:underline" onClick={() => e.project_id && navigate(`/project/${e.project_id}`)}>
                        {e.projeto}
                      </button>
                    )}
                  </div>
                  {e.detalhe && <p className="text-xs text-muted-foreground break-words">{e.detalhe}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground whitespace-nowrap">{quando(e.quando)}</div>
                  <div className="text-[11px] text-muted-foreground">{e.ator === 'ludmilla' ? 'Ludmilla' : e.quem || 'equipe'}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {registro.length >= (tudo ? 400 : 60) && !tudo && (
        <Button variant="outline" size="sm" onClick={() => setTudo(true)}>Ver mais</Button>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Reescrever a página**

Substitua TODO o conteúdo de `src/pages/Ludmilla.tsx` por:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Radar } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  estadoDaEstacao, useLudmillaDisponivel, usePedirRun, usePortalCaptchas, useRunsCriacaoCpfl,
} from '@/hooks/useLudmilla';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { useCaixaDaLudmilla } from '@/hooks/useCaixaDaLudmilla';
import { useFilaDeDecisoes } from '@/hooks/useFilaDeDecisoes';
import { useAgora } from '@/hooks/useAgora';
import { useWindowSize } from '@/hooks/useWindowSize';
import { contarPendentes } from '@/lib/ludmillaCaixa';
import { alertasDasContas, chipsDaFaixa } from '@/lib/ludmillaPainel';
import { AbaDecidirConectada } from '@/components/ludmilla/decidir/AbaDecidirConectada';
import { AlertasDasContas } from '@/components/ludmilla/topo/AlertasDasContas';
import { FaixaDeSaude } from '@/components/ludmilla/topo/FaixaDeSaude';
import { ABAS_DA_LUDMILLA, BarraDeAbas, type AbaDaLudmilla } from '@/components/ludmilla/topo/BarraDeAbas';
import { CartaoCaptcha } from '@/components/ludmilla/abas/CartaoCaptcha';
import { AbaConcessionarias } from '@/components/ludmilla/abas/AbaConcessionarias';
import { AbaCriacoesCpfl } from '@/components/ludmilla/abas/CriacoesCpfl';
import { RegistroDaLudmilla } from '@/components/ludmilla/abas/RegistroDaLudmilla';
import { cn } from '@/lib/utils';

/**
 * LUDMILLA — a caixa de entrada de decisões (spec 2026-10-22).
 *
 * O que a equipe vem fazer aqui é DECIDIR: a aba de abertura é a lista de
 * recomendações + A fazer, com o detalhe ao lado (computador) ou por cima
 * (celular). Configuração e histórico foram para abas secundárias. A Ludmilla
 * só sugere: quem aplica é uma pessoa, pelas MESMAS RPCs de sempre — a decisão
 * espera 8 s antes de ir, e é isso que faz o "Desfazer".
 */
export default function Ludmilla() {
  const disponivel = useLudmillaDisponivel();
  const navigate = useNavigate();
  const [aba, setAba] = useState<AbaDaLudmilla>('decidir');
  const [contaId, setContaId] = useState<string | null>(null);
  const caixa = useCaixaDaLudmilla('pendente');
  const { ocultos, decidir } = useFilaDeDecisoes(caixa.itens);
  const { data: captchas = [] } = usePortalCaptchas();
  const { data: agente } = useAgentConfig();
  const caixaPronta = !!agente?.is_configured && !!agente.gmail_email;
  const { data: runsCriacao = [] } = useRunsCriacaoCpfl();
  const pedir = usePedirRun();
  const agora = useAgora(60_000);
  const { isMobile } = useWindowSize();

  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-muted-foreground">A Ludmilla está disponível só para a equipe do GD Manager.</div>
      </MainLayout>
    );
  }

  const pendentes = contarPendentes(caixa.itens, ocultos);
  const chips = chipsDaFaixa(caixa.contas, {
    nomeDaConta: caixa.nomeDaConta, pendentesPorConta: pendentes.porConta,
    estacaoDe: c => estadoDaEstacao(c, agora), caixaPronta, agora,
  });

  return (
    <MainLayout>
      <div className={cn('mx-auto max-w-7xl space-y-4', isMobile && 'pb-16')}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Radar className="w-6 h-6 text-primary" /></div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">Ludmilla</h1>
            <p className="text-sm text-muted-foreground">
              O que mudou nas concessionárias, com a recomendação de etapa. Ela lê; você decide.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/admin/energy-concessionaires')}>
            <KeyRound size={14} /> Acessos aos portais
          </Button>
        </div>

        {/* Urgente primeiro: o código da imagem expira em 5 min */}
        {captchas.map(c => <CartaoCaptcha key={c.id} c={c} portal={caixa.nomeDaConta(c.account_id)} />)}
        <AlertasDasContas alertas={alertasDasContas(caixa.contas, caixa.nomeDaConta, caixaPronta)} />

        <FaixaDeSaude
          chips={chips} contaId={contaId} verificando={pedir.isPending}
          onFiltrar={id => { setContaId(id); setAba('decidir'); }}
          onVerificar={c => pedir.mutate({ accountId: c.id, tipo: c.tipoDoRun })}
        />

        <Tabs value={aba} onValueChange={v => setAba(v as AbaDaLudmilla)}>
          {!isMobile && (
            <TabsList className="h-auto flex-wrap">
              {ABAS_DA_LUDMILLA.map(a => (
                <TabsTrigger key={a.valor} value={a.valor} className="gap-1.5">
                  {a.rotulo}
                  {a.valor === 'decidir' && pendentes.total > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[11px] tabular-nums text-primary-foreground">{pendentes.total}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          <TabsContent value="decidir" className="mt-3">
            <AbaDecidirConectada contaId={contaId} ocultos={ocultos} decidir={decidir} agora={agora} />
          </TabsContent>
          <TabsContent value="concessionarias" className="mt-3">
            <AbaConcessionarias contas={caixa.contas} nomeDaConta={caixa.nomeDaConta} />
          </TabsContent>
          <TabsContent value="criacoes" className="mt-3">
            <AbaCriacoesCpfl runs={runsCriacao} />
          </TabsContent>
          <TabsContent value="registro" className="mt-3">
            <RegistroDaLudmilla />
          </TabsContent>
        </Tabs>

        {isMobile && <BarraDeAbas ativa={aba} onTrocar={setAba} contadores={{ decidir: pendentes.total }} />}
      </div>
    </MainLayout>
  );
}
```

Confira que ninguém importava o que sumiu:

Run: `grep -rn "LinhaRecomendacao" src`
Expected: nenhuma linha.

- [ ] **Step 8: Verificar tipos e build antes da prova**

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1 · `npm run build` sem erro · `npm test` sem `failed`.

- [ ] **Step 9: Montar o harness da página inteira (com dublês)**

A página real roda com dois dublês trocados pelo Vite (nada de rede, nada de senha): o cliente do Supabase responde com dados inventados e o `AuthContext` devolve uma pessoa da equipe inventada.

Crie `vite.harness.config.ts` (raiz):

```ts
// SÓ PARA O HARNESS DA PÁGINA DA LUDMILLA — APAGAR antes do commit.
import path from 'path';
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import base from './vite.config';

export default defineConfig(async env => {
  const b = (typeof base === 'function' ? await base(env) : base) as UserConfig;
  return mergeConfig(b, {
    server: { port: 5174, strictPort: true },
    resolve: {
      alias: [
        { find: /^@\/integrations\/supabase\/client$/, replacement: path.resolve(__dirname, 'src/harness-duble/supabase.ts') },
        { find: /^@\/contexts\/AuthContext$/, replacement: path.resolve(__dirname, 'src/harness-duble/AuthContext.tsx') },
      ],
    },
  });
});
```

Crie `src/harness-duble/AuthContext.tsx`:

```tsx
// DUBLÊ do AuthContext — SÓ para o harness da página. APAGAR antes do commit.
import type { ReactNode } from 'react';
import { TENANT } from '@/lib/ludmillaCaixa.fixtures';

const USUARIO = {
  id: 'u-harness', email: 'equipe@exemplo.test', name: 'Pessoa da Equipe', role: 'staff' as const,
  tenantId: TENANT, isActive: true,
};

export function AuthProvider({ children }: { children: ReactNode }) { return <>{children}</>; }

export function useAuth() {
  return {
    user: USUARIO, session: null, isAuthenticated: true, isLoading: false,
    login: async () => ({ success: false }), logout: async () => undefined, refreshUser: async () => undefined,
  };
}
```

Crie `src/harness-duble/supabase.ts`:

```ts
// DUBLÊ do cliente do Supabase — SÓ para o harness da página. Nenhuma rede. APAGAR antes do commit.
import {
  AFAZERES_DE_EXEMPLO, CONTAS_DE_EXEMPLO, DOCUMENTOS_DE_EXEMPLO, LINHA_DO_TEMPO_DE_EXEMPLO, MENSAGEM_DA_TROCA,
  TENANT, UPDATES_DE_EXEMPLO,
} from '@/lib/ludmillaCaixa.fixtures';

type Linha = Record<string, unknown>;
declare global { interface Window { __chamadas: { tipo: string; nome: string; args: unknown }[] } }
window.__chamadas = [];

const COLUNAS = [
  ['pending', 'Pendente'], ['analysis', 'Em análise'], ['documentation', 'Documentação'], ['approval', 'Aprovação'],
  ['approved', 'Aprovado'], ['vistoria_solicitada', 'Vistoria solicitada'], ['pendencia', 'Pendência'], ['completed', 'Concluído'],
].map(([status_key, status_label], order_index) => ({ id: `col-${status_key}`, status_key, status_label, order_index, color: '#94a3b8' }));

const TABELAS: Record<string, Linha[]> = {
  tenants: [{ id: TENANT, name: 'GD Manager', is_library: true, logo_url: null, plan: null }],
  profiles: [{ id: 'u-harness', name: 'Pessoa da Equipe', email: 'equipe@exemplo.test', role: 'staff', active: true, tenant_id: TENANT, onboarding_completed_at: '2026-01-01T00:00:00Z' }],
  kanban_models: [{ id: 'k-1', is_active: true, created_at: '2026-01-01T00:00:00Z', columns: COLUNAS }],
  agent_config_safe: [{ id: 'ac-1', config_key: 'email_agent', gmail_email: 'caixa@exemplo.test', is_configured: true, is_active: true, scan_times: [] }],
  energy_concessionaires: [
    { id: 'conc-cpfl', name: 'CPFL Paulista', tenant_id: TENANT, is_active: true },
    { id: 'conc-edp', name: 'EDP São Paulo', tenant_id: TENANT, is_active: true },
    { id: 'conc-enel', name: 'ENEL SP', tenant_id: TENANT, is_active: true },
    { id: 'conc-elektro', name: 'Elektro', tenant_id: TENANT, is_active: true },
  ],
  portal_accounts: CONTAS_DE_EXEMPLO as unknown as Linha[],
  portal_updates: UPDATES_DE_EXEMPLO as unknown as Linha[],
  portal_afazeres: AFAZERES_DE_EXEMPLO as unknown as Linha[],
  portal_email_mensagens: [MENSAGEM_DA_TROCA] as unknown as Linha[],
  portal_anexos: DOCUMENTOS_DE_EXEMPLO.anexos.map(a => ({ ...a, project_id: 'p-2' })),
  portal_pareceres: DOCUMENTOS_DE_EXEMPLO.pareceres.map(p => ({ ...p, project_id: 'p-1' })),
  portal_email_regras: [{ id: 'r-1', account_id: 'conta-enel', remetente: 'naoresponda@enel.exemplo.test', assunto: 'Carta', tipo_documento: 'carta_projeto', anexar: true, ler_pdf: true, ativo: true, ordem: 1, created_at: '2026-10-01T00:00:00Z' }],
  portal_captchas: [{ id: 'cap-1', account_id: 'conta-elektro', run_id: null, imagem_path: 'captcha/exemplo.png', situacao: 'aguardando', tentativa: 1, mensagem: null, criado_em: new Date().toISOString(), expira_em: new Date(Date.now() + 4 * 60_000).toISOString() }],
  portal_sync_runs: [
    { id: 'run-c1', account_id: 'conta-cpfl', tipo: 'criar_projeto', situacao: 'ok', pedido_em: '2026-10-21T15:00:00Z', iniciado_em: null, terminado_em: null, erro: null, print_path: null, resultado: { node: '598536' }, dados: { project_id: 'p-1' } },
    { id: 'run-e1', account_id: 'conta-enel', tipo: 'varredura_email', situacao: 'ok', pedido_em: '2026-10-22T10:30:00Z', iniciado_em: null, terminado_em: null, erro: null, print_path: null, resultado: { lidos: 12, por_protocolo: 3, por_uc: 1, por_titular: 1, nao_identificados: 2, conflitos: 0, bloqueados: 1, avisos: 2, anexados: 4, imagens_ignoradas: 3, a_tentar_de_novo: 0, falhas: 0 }, dados: null },
  ],
  projects: [
    { id: 'p-1', code: 'PRJ-10001', status: 'analysis', protocol_number: '7001234', cpfl_node_id: '598536', project_general_data: { uc_number: '0123456789' } },
    { id: 'p-2', code: 'PRJ-10002', status: 'documentation', protocol_number: 'Sem protocolo', cpfl_node_id: null, project_general_data: { uc_number: '0987654321' } },
  ],
};

const RPCS: Record<string, unknown> = {
  ludmilla_registro: [
    { quando: '2026-10-22T10:31:00Z', ator: 'ludmilla', quem: 'agendamento', acao: 'visita', titulo: 'Leitura dos e-mails da ENEL SP', detalhe: '12 projetos conferidos · 4 documento(s) anexado(s)', situacao: 'ok', project_id: null, projeto: null, protocolo: null },
    { quando: '2026-10-21T09:00:00Z', ator: 'ludmilla', quem: 'Ludmilla', acao: 'recomendacao', titulo: 'Mudança no portal: CARTA_PROJETO · FAVORAVEL', detalhe: 'Protocolo 900000222 · sugere approved', situacao: 'ok', project_id: 'p-2', projeto: 'PRJ-10002', protocolo: '900000222' },
  ],
  ludmilla_linha_do_tempo: LINHA_DO_TEMPO_DE_EXEMPLO,
  ludmilla_afazer_feito: true,
  ludmilla_pedir_run: 'run-novo',
};

interface Estado { unico: boolean; filtros: [string, string, unknown][]; escrita: string | null; corpo: unknown }

function responder(tabela: string, e: Estado) {
  if (e.escrita) {
    window.__chamadas.push({ tipo: e.escrita, nome: tabela, args: e.corpo });
    return { data: null, error: null };
  }
  let linhas = TABELAS[tabela] ?? [];
  for (const [op, col, val] of e.filtros) {
    if (op === 'eq') linhas = linhas.filter(l => l[col] === val);
    if (op === 'is') linhas = linhas.filter(l => (l[col] ?? null) === val);
  }
  return { data: e.unico ? (linhas[0] ?? null) : linhas, error: null, count: linhas.length };
}

/** Qualquer método encadeia; `then` responde com as fixtures (filtros eq/is valem; o resto é ignorado). */
function consulta(tabela: string): unknown {
  const e: Estado = { unico: false, filtros: [], escrita: null, corpo: null };
  const p: unknown = new Proxy({}, {
    get(_alvo, nome) {
      if (nome === 'then') {
        return (ok: (v: unknown) => unknown, falha?: (r: unknown) => unknown) => Promise.resolve(responder(tabela, e)).then(ok, falha);
      }
      if (nome === 'single' || nome === 'maybeSingle') return () => { e.unico = true; return p; };
      return (...args: unknown[]) => {
        if (nome === 'eq' || nome === 'is') e.filtros.push([String(nome), String(args[0]), args[1]]);
        if (nome === 'insert' || nome === 'update' || nome === 'upsert' || nome === 'delete') { e.escrita = String(nome); e.corpo = args[0]; }
        return p;
      };
    },
  });
  return p;
}

function resposta(valor: unknown): unknown {
  const p: unknown = new Proxy({}, {
    get(_alvo, nome) {
      if (nome === 'then') {
        return (ok: (v: unknown) => unknown, falha?: (r: unknown) => unknown) => Promise.resolve(valor).then(ok, falha);
      }
      return () => p;
    },
  });
  return p;
}

const IMAGEM = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect width="160" height="48" fill="#eee"/><text x="12" y="32" font-size="22" font-family="monospace">EXEMPLO</text></svg>');
const canal = { on() { return canal; }, subscribe() { return canal; }, unsubscribe() { return Promise.resolve('ok'); } };

export const supabase = {
  from: (tabela: string) => consulta(tabela),
  rpc: (nome: string, args?: unknown) => {
    window.__chamadas.push({ tipo: 'rpc', nome, args });
    return resposta({ data: nome in RPCS ? RPCS[nome] : null, error: null });
  },
  storage: {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: IMAGEM }, error: null }),
      download: async () => ({ data: null, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      upload: async () => ({ data: null, error: null }),
      remove: async () => ({ data: null, error: null }),
    }),
  },
  channel: () => canal,
  removeChannel: async () => 'ok',
  functions: { invoke: async () => ({ data: null, error: null }) },
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { return undefined; } } } }),
    signOut: async () => ({ error: null }),
  },
};
```

Crie `harness-pagina.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Harness — página da Ludmilla</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/harness-pagina.tsx"></script>
  </body>
</html>
```

Crie `src/harness-pagina.tsx`:

```tsx
// HARNESS DA PÁGINA INTEIRA DA LUDMILLA — dublês, dados inventados. APAGAR antes do commit.
import '@/index.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import Ludmilla from '@/pages/Ludmilla';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}>
    <TooltipProvider>
      <MemoryRouter initialEntries={['/ludmilla']}>
        <Routes><Route path="*" element={<Ludmilla />} /></Routes>
      </MemoryRouter>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>,
);
```

Run (em segundo plano): `npx vite --config vite.harness.config.ts`
Abra `http://localhost:5174/harness-pagina.html`. Se a página quebrar por falta de uma tabela ou RPC no dublê (a Sidebar e a Topbar leem outras), acrescente a linha em `TABELAS`/`RPCS` com dados inventados e recarregue.

- [ ] **Step 10: Provar a página no computador (1280 × 900) — CPFL, EDP e ENEL**

```js
document.body.textContent.includes('A Ludmilla precisa do código da imagem — Elektro')   // true
[...document.querySelectorAll('[role="alert"]')].some(a => a.textContent.includes('Elektro: sessão expirada'))   // true
[...document.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim())   // ["Decidir7","Concessionárias","Criações na CPFL","Registro"]
[...document.querySelectorAll('[data-linha]')].map(e => e.dataset.linha)
// ["u:u-enel-bloq","f:f-vistoria","u:u-cpfl","u:u-enel-troca","u:u-edp","u:u-cpfl-sem","f:f-devolucao"]
```

Clique no chip "ENEL SP": as linhas viram só `u:u-enel-bloq`, `f:f-vistoria`, `u:u-enel-troca`, `f:f-devolucao`; clique em "Todas". Clique na linha `PRJ-10002`:

```js
const d = document.querySelector('[data-detalhe]').textContent;
d.includes('Carta de aprovação do projeto') && d.includes('E-mail lido') && d.includes('carta-900000222.pdf')   // true
```

Clique em "Aplicar etapa e protocolo", espere e confira que a RPC de SEMPRE foi chamada, uma vez:

```js
await new Promise(r => setTimeout(r, 8500));
window.__chamadas.filter(c => c.nome === 'ludmilla_aplicar_update').map(c => c.args)
// [{ p_update_id: "u-enel-troca", p_status: "approved" }]
```

Clique na linha `PRJ-10007` (A fazer) → "Marcar como feito" → espere 8,5 s → `window.__chamadas.filter(c => c.nome === 'ludmilla_afazer_feito').length === 1`. Abra a linha `PRJ-10004` (EDP): o detalhe mostra `Parecer de acesso 045006443920` e `2 no card`. Abra `PRJ-10001` (CPFL): o detalhe mostra `Em Andamento` → `Aprovado` e `atualizado no portal em 19/10/2026`.

Aba "Concessionárias":

```js
document.querySelectorAll('details').length === 2 && [...document.querySelectorAll('details')].every(x => !x.open)   // true (regras recolhidas, EDP e ENEL)
document.body.textContent.includes('O que ela leu na caixa')   // true
[...document.querySelectorAll('button')].filter(b => b.textContent.includes('Acesso ao portal')).length   // 2 (CPFL e Elektro)
```

Aba "Criações na CPFL": `document.body.textContent.includes('PRJ-10001') && document.body.textContent.includes('CPFL nº 598536')` → `true`. Aba "Registro": `document.body.textContent.includes('Leitura dos e-mails da ENEL SP')` → `true`. `document.documentElement.scrollWidth <= innerWidth` → `true`.

- [ ] **Step 11: Provar a página no celular (390 × 812)**

Preset `mobile`, recarregue:

```js
document.querySelectorAll('[role="tab"]').length   // 0 (no celular as abas são a barra)
const abas = document.querySelector('nav[aria-label="Abas da Ludmilla"]').getBoundingClientRect();
const atalhos = document.querySelector('nav[aria-label="Atalhos"]').getBoundingClientRect();
abas.bottom <= atalhos.top + 1   // true (a barra das abas fica acima da do app)
document.documentElement.scrollWidth <= innerWidth   // true
document.querySelector('[data-detalhe]')   // null
```

Toque na linha `PRJ-10001`: o detalhe abre por cima com os botões no rodapé (`document.querySelector('[data-teste="botoes-da-decisao"]').getBoundingClientRect().bottom <= innerHeight` → `true`). Toque em "Contas" na barra: aparecem os 4 cartões. Tire prints de 1280 e 390.

- [ ] **Step 12: Apagar o harness e verificar de novo**

Pare o servidor. Apague `vite.harness.config.ts`, `harness-pagina.html`, `src/harness-pagina.tsx` e a pasta `src/harness-duble/`.
Run: `git status --short` → nenhum `harness`.
`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → o número do Step 1 · `npm run build` sem erro · `npm test` sem `failed`.
Escreva `$RASCUNHO/md5_aplicar.sql`:

```sql
select md5(prosrc) as md5_aplicar from pg_proc where proname = 'ludmilla_aplicar_update';
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/md5_aplicar.sql"` → `md5_aplicar = 6183edef6c3f93810282039bdd565a26` (a decisão continua indo pela mesma RPC, intocada).

- [ ] **Step 13: Documentação**

Em `docs/modules/integrations/ludmilla.md`, acrescente no FIM do arquivo:

```markdown
## A página como caixa de decisões (22/10/2026)

Spec: `docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md` · plano:
`docs/superpowers/plans/2026-10-22-ludmilla-pagina-decidir.md`.

**O que mudou na tela.** A `/ludmilla` deixou de ser uma pilha (cartões das contas →
criações → recomendações → registro). No topo: o código da imagem da Elektro e os
alertas das contas (erro, sessão expirada, caixa de e-mail não configurada), só quando
existem, e a **faixa de saúde** — um chip por concessionária (ponto de saúde, meio,
"lida há", pendentes; clicar filtra, o botão ao lado faz "Verificar agora"). Abas:
**Decidir** (a de abertura, com o número de pendentes), **Concessionárias** (os
cartões de antes, com as regras de e-mail recolhidas e "Acesso ao portal"),
**Criações na CPFL** (agora com o código do projeto e o número da CPFL) e
**Registro** (igual). No celular as abas viram uma barra logo acima da barra de
atalhos do app, e o detalhe abre por cima com os botões fixos embaixo; lado a lado
só a partir de 1024 px.

**Decidir.** Uma lista só com recomendações (`portal_updates`) e **A fazer**
(`portal_afazeres`), mais antigas primeiro, com busca (projeto, titular, empresa,
protocolo — sem acento; protocolo sem zeros à esquerda), situação e tipo (Mudar
etapa · Gravar protocolo · Bloqueados · A fazer). "Bloqueado" = `raw.motivo` abrindo
com "não anexei ·"; "Dispensar" = Ignorar. O detalhe mostra Quem, O que chegou, A
sugestão, os botões e "Este projeto na Ludmilla" (`ludmilla_linha_do_tempo`).
Depois de decidir, o painel vai para a próxima pendente e o aviso oferece
**Desfazer**: a decisão ESPERA 8 s antes de chamar a RPC de sempre
(`ludmilla_aplicar_update` / `ludmilla_ignorar_update` / `ludmilla_afazer_feito`) —
desfazer é não mandar. Sair da página grava na hora; fechar a aba com decisão
esperando faz o navegador perguntar. Lógica pura em `src/lib/ludmillaCaixa.ts`,
`ludmillaPainel.ts` e `ludmillaFilaDeDecisoes.ts` (vitest).

**Banco (migração `20261022200000_ludmilla_afazeres`).** `portal_afazeres (id,
tenant_id, account_id, project_id, mensagem_id → portal_email_mensagens, tipo,
titulo, mensagem, criado_em, feito_por, feito_em)`: RESTRICTIVE por tenant, leitura
só da equipe (`ludmilla_equipe_ok`), sem política de escrita. `ludmilla_email_avisar`
(corpo do prosrc vivo) grava o A fazer junto com o sino, uma vez por mensagem
(UNIQUE `mensagem_id`); `tipo` sai do título (`vistoria_aprovada`, `troca_falhou`,
`devolucao`; o resto é `aviso`). `ludmilla_afazer_feito(id)` → `true` marcou,
`false` já estava feito — vale para a equipe toda. `ludmilla_linha_do_tempo(projeto,
limite)` = os ramos de `ludmilla_registro` com projeto + e-mails lidos + A fazer.
`ludmilla_aplicar_update`, `ludmilla_registro`, a varredura e o worker não mudaram.
O sino e o contador da barra lateral (só recomendações) continuam iguais.
```

Em `CLAUDE.md`, na linha da Ludmilla da tabela de módulos, troque o trecho `Elektro pela estação local — aguarda aceite; só GD Manager` por `Elektro pela estação local — aguarda aceite; página = caixa de decisões (Decidir + A fazer); só GD Manager` (se a rodada da ENEL mudou essa linha, acrescente `página = caixa de decisões (Decidir + A fazer)` antes de `só GD Manager`).

Atualize a memória do módulo (`memory/ludmilla.md`, fora do repositório) com um parágrafo "Página nova (22/10/2026)" resumindo: abas, A fazer com Feito da equipe, Desfazer por espera de 8 s, `ludmilla_linha_do_tempo`, e que `cartaoBloqueado` segue `detalheDoCartaoDeEmail`.

- [ ] **Step 14: Commit e push**

Mensagem (`$RASCUNHO/msg-task8.txt`; acrescente no corpo a lista do que veio do diff da ENEL, do Step 1):

```text
feat(ludmilla): a página vira caixa de decisões

A /ludmilla era uma pilha em que as recomendações ficavam embaixo de
configuração e histórico. Agora abre na aba Decidir (lista + detalhe, A
fazer com Feito da equipe, Desfazer), com a faixa de saúde e os alertas no
topo; Concessionárias, Criações na CPFL e Registro viraram abas, e no
celular as abas ficam numa barra acima da do app. Os cartões, as criações e
o registro foram movidos sem mudar o que fazem (regras de e-mail agora
recolhidas, código e número da CPFL nas criações). Mesmas RPCs de sempre;
ludmilla_aplicar_update intocada (md5 conferido). Prova na tela com dublês
cobrindo CPFL, EDP e ENEL, em 1280 e 390 px.

Co-Authored-By: <modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/pages/Ludmilla.tsx src/lib/ludmillaCaixa.ts src/components/ludmilla/abas docs/modules/integrations/ludmilla.md CLAUDE.md
git commit -F "$RASCUNHO/msg-task8.txt" -- src/pages/Ludmilla.tsx src/lib/ludmillaCaixa.ts src/components/ludmilla/abas docs/modules/integrations/ludmilla.md CLAUDE.md
git show --stat HEAD
git log --oneline origin/main..HEAD
```

Se `git log origin/main..HEAD` só tiver commits deste plano, `git push origin main`. Se tiver commit de outra frente, pergunte ao usuário no COMEÇO da resposta antes de empurrar.

---

## Autorrevisão (feita ao escrever o plano)

**Cobertura da spec.**
- §3.1 alertas urgentes → código da imagem (Task 8, `CartaoCaptcha`), conta com erro/sessão e caixa não configurada (Task 3 `alertasDasContas`, Task 7 componente). Faixa de saúde (ponto, nome, meio, "lida há", pendentes, filtra, Verificar agora, Todas) → Tasks 3, 7, 8.
- §3.2 busca, situação, tipos → Tasks 2 e 6; linha compacta e selos → Tasks 2 e 6; ordem → Task 2; detalhe (Quem, O que chegou, A sugestão, Ações, linha do tempo) → Tasks 1, 3, 5, 6; "próxima pendente" e "Desfazer" → Tasks 2, 4, 6.
- §3.3 Concessionárias, Criações (com número da CPFL), Registro → Task 8 (+ Tasks 3 e 5 para o número).
- §3.4 celular (chips roláveis, lista em tela cheia, detalhe por cima com botões fixos, abas embaixo) → Tasks 6, 7, 8.
- §4 dados (`portal_afazeres`, RLS, `ludmilla_email_avisar` idempotente, `ludmilla_afazer_feito`, linha do tempo) → Task 1; os mesmos hooks → Task 5.
- §5 o que não muda → restrições globais + md5 conferidos nas Tasks 1 e 8.
- §6 ordem → portão da Task 8. §7 riscos: troca completa num deploy (Task 8 inteira), prova cobrindo CPFL/EDP/ENEL (Task 8 Step 10), sem lote. "Marcar todos desta concessionária como feitos" fica para depois do primeiro run, como a spec manda.

**Placeholders.** Nenhum "TBD"/"implementar depois"; todo passo de código traz o código. Os únicos trechos condicionais são guardas com o código pronto para os dois casos (md5 diferente na Task 1, `detalheDoCartaoDeEmail` existir na Task 8, o CLI não devolver o resultado antes do `rollback`). `<modelo que executou>` no trailer é o nome que o executor preenche.

**Consistência de tipos.** `ItemDaCaixa`, `FiltroDaCaixa`, `AcaoDaDecisao`, `AcoesDaCaixa`, `DadosDoDetalhe`, `ChipDaConta`, `AlertaUrgente`, `AbaDaLudmilla` e as assinaturas `selecaoValida(lista, selecionada, abrirPrimeira)`, `proximaDepoisDe(lista, chave)`, `acoesDoItem(item, etapa)`, `textoDaDecisao(item, acao, rotuloDaEtapa)`, `useFilaDeDecisoes(itens)`, `AbaDecidirConectada({ contaId, ocultos, decidir, agora })` são as mesmas em todas as tarefas que as usam. Atributos de prova: `data-linha`, `data-detalhe`, `data-teste="botoes-da-decisao"`, `data-chip`, `data-teste="faixa"`.
