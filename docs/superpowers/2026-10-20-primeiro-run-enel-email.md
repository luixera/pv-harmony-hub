# Primeiro run da ENEL por e-mail — roteiro

> Escrito em 20/10/2026, com a entrega pronta e **não publicada**; os números do
> banco foram conferidos em 21/10. A publicação espera a decisão do usuário (o push
> da `main` e a frente de assinatura digital, que divide o mesmo branch).
>
> Este run é **manual e acompanhado**, por decisão. É o primeiro exercício real do
> caminho inteiro: IMAP com os remetentes reais da ENEL, a `ludmilla-parecer` em modo
> ENEL contra PDF de verdade, as RPCs de verdade, e escrita em **cards de projeto de
> clientes reais** (e o sino de seis pessoas).

Contexto do módulo: [docs/modules/integrations/ludmilla.md](../modules/integrations/ludmilla.md)
(seção "Acompanhamento por E-MAIL — a ENEL"). Spec:
[2026-10-13-ludmilla-enel-email-design.md](specs/2026-10-13-ludmilla-enel-email-design.md)
(seção "O que mudou na implementação"). Roteiro anterior, no mesmo formato:
[2026-10-11-primeiro-run-edp-email.md](2026-10-11-primeiro-run-edp-email.md).

---

## 0. A regra que vale antes de tudo

> **NÃO clique em "Verificar agora" no cartão da ENEL antes do passo 3.**
>
> Em 14/10 alguém clicou, e o robô da VPS ainda não tinha o código da ENEL: o run
> rodou **no modo da EDP** (procura o protocolo no assunto), criou 18 cartões, 18
> sinos e 18 linhas de mensagem com a chave errada. A limpeza foi feita em 16/10. O
> botão está ligado de verdade e não sabe qual robô está na VPS.

Quem faz o quê: o **push** e a hora de publicar são do usuário. Este roteiro não faz
push, e o `stash@{0}` do repositório é de outra sessão — não mexer.

Estado em 21/10 (refazer se demorar):

| O quê | Estado |
|---|---|
| Migrações da ENEL (`20261013120000` … `20261019120000`, 6 arquivos) | **todas aplicadas** no banco vivo (passo 3 confere pelas funções) |
| Commits | 11 à frente do `origin/main` (de `0764d6b` a `13200de`; o `bd8ed0b` é do financeiro, de outra frente), mais o commit da documentação |
| `ludmilla-parecer` no ar | do `deploy.yml` de 19/10: **tem** o modo ENEL (`08e59f2`) e **não tem** a correção `455b4d2` (o `tipo` só é lido no modo ENEL) |
| Robô da VPS | do deploy de 16/10: tem `identificar.ts` e `classificar.ts`, **não tem** `run.ts` nem `rotear.ts` — roda a ENEL como a EDP |
| Tela `/ludmilla` no ar | a de antes: sem titular/empresa nos cartões, sem os quadros da ENEL |

## 1. Publicar primeiro, rodar depois — a ordem importa

### 1.1 O push e o `deploy.yml` (do usuário)

```bash
git push origin main
```

O `deploy.yml` publica as edge functions (entre elas a `ludmilla-parecer`, com
`--no-verify-jwt`), **define o segredo `LUDMILLA_WORKER_KEY`** a partir do mesmo
segredo do GitHub que o robô usa, e sobe o front novo. Espere terminar **em verde**:

```bash
gh run list --workflow deploy.yml --limit 1
```

O `deploy.yml` **não** publica o robô da VPS (passo 1.3).

### 1.2 A edge function `ludmilla-parecer` — só se o `deploy.yml` não a publicou

Se o 1.1 terminou em verde, ela já foi. Senão, da raiz do repositório:

```bash
# o --use-api é porque o Docker não roda nesta máquina
npx -y supabase functions deploy ludmilla-parecer --project-ref yqsqrdndvsnhbsoaoilf --no-verify-jwt --use-api
```

Em qualquer caso, a **prova do portão**: sem credencial tem de dar `401`. Mostre só
o status, nunca o corpo nem uma chave:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ludmilla-parecer -H "content-type: application/json" -d '{}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ludmilla-parecer -H "content-type: application/json" -d '{"concessionaria":"enel"}'
```

Os dois têm de imprimir `401`: o modo ENEL não abre o portão.

### 1.3 Atualizar o robô da VPS — à mão

```bash
gh workflow run ludmilla-worker.yml
gh run list --workflow ludmilla-worker.yml --limit 1     # esperar "completed / success"
```

O workflow é manual (`workflow_dispatch`) e usa o código **que está no GitHub**:
por isso só depois do push. Ele roda os testes do robô (`npm test`), compila,
sincroniza `/opt/ludmilla` e reinicia o serviço `ludmilla-worker` — se um run da
CPFL estiver no meio, ele é interrompido. Para ter certeza de que o robô novo está
lá (SSH na VPS, porta 22022):

```bash
grep -c executarVarreduraEnel /opt/ludmilla/dist/email/rotear.js    # maior que 0
systemctl is-active ludmilla-worker                                  # active
```

**Só depois disto** o "Verificar agora" do cartão da ENEL faz o que o desenho manda.

## 2. Abrir `/ludmilla` logado — a prova do embed novo

Logado como admin/staff do GD Manager. A consulta dos cartões ganhou um embed
(`project:projects(id, code, status, title, companies:company_id(name),
project_general_data(holder_name))`) que **nunca rodou contra o PostgREST real**: foi
provado por SQL, não pela tela. Confira:

1. a página carrega e os cartões pendentes (CPFL) mostram **Titular** e **Empresa**;
   onde falta um dos dois, aparece um traço, nunca "undefined". Nos cartões da CPFL, o
   nome do portal aparece abaixo como "no portal: …" quando difere do cadastro;
2. **não** aparece o aviso vermelho com "Tentar de novo" (é o que a tela mostra se a
   consulta falhar; antes dele o erro virava "Nada pendente");
3. o cartão da ENEL diz "Acompanho por: e-mail" e, em vez de contadores, o texto
   "Ela ainda não leu a caixa… os últimos 30 dias dos remetentes das regras";
4. as 8 regras aparecem, editáveis (a escrita é só do `admin`).

Se o aviso vermelho aparecer, **pare**: o erro (ambiguidade de relacionamento, política
de RLS na tabela `companies`…) está no console do navegador e na aba de rede. Não
rode o robô antes de consertar — o cartão que ele abrir seria ilegível.

## 3. Pré-voo em SQL

Pelo CLI (`npx -y supabase db query --linked -f arquivo.sql`) só o **último** `SELECT`
com linhas volta: um arquivo por consulta. A guarda de `service_role` de
`ludmilla_email_projetos` faz a RPC devolver **vazio** pelo CLI, então a lista de
projetos é replicada abaixo **sem a guarda** (mesmo JOIN, mesmo critério de "ativo").

```sql
-- /tmp/pre-voo.sql
WITH conta AS (
  SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel'
), projetos AS (
  SELECT p.id, p.protocol_number, g.uc_number,
         (p.archived_at IS NULL AND p.status::text <> 'completed') AS ativo
    FROM conta a
    JOIN public.projects p
      ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
    LEFT JOIN public.project_general_data g ON g.project_id = p.id
   WHERE NOT p.is_deleted
)
SELECT
  (SELECT count(*) FROM conta)                                                        AS contas_enel,
  (SELECT string_agg(DISTINCT acompanhamento || '/' || identificacao, ',') FROM conta) AS modo,
  (SELECT bool_and(enabled) FROM conta)                                               AS conta_ligada,
  (SELECT count(*) FROM conta WHERE login IS NULL AND secret_id IS NULL)              AS sem_login_e_sem_segredo,
  (SELECT count(*) FROM public.portal_email_regras r JOIN conta c ON c.id = r.account_id WHERE r.ativo) AS regras_ativas,
  (SELECT count(*) FROM public.portal_email_regras r JOIN conta c ON c.id = r.account_id
    WHERE r.remetente = 'atendimento.edsp@enel.com' AND r.tipo_documento = 'resultado_vistoria'
      AND r.anexar AND NOT r.ler_pdf)                                                 AS regra_edsp_corrigida,
  (SELECT count(*) FROM projetos)                                                     AS projetos_total,
  (SELECT count(*) FROM projetos WHERE ativo)                                         AS projetos_ativos,
  (SELECT count(*) FROM projetos WHERE ativo
      AND length(ltrim(regexp_replace(coalesce(uc_number, ''), '\D', '', 'g'), '0')) BETWEEN 7 AND 8) AS ativos_com_uc_de_8_digitos,
  (SELECT count(*) FROM projetos WHERE ativo
      AND length(regexp_replace(coalesce(protocol_number, ''), '\D', '', 'g')) = 0)   AS ativos_sem_protocolo_numerico,
  (SELECT (c.gmail_email <> '' AND c.gmail_app_password <> '')
     FROM public.agent_config c WHERE c.tenant_id = (SELECT tenant_id FROM conta) LIMIT 1) AS caixa_configurada,
  (SELECT count(*) FROM public.profiles p
    WHERE p.tenant_id = (SELECT tenant_id FROM conta) AND p.role IN ('admin', 'staff')) AS quem_recebe_cada_sino,
  (SELECT count(*) FROM public.portal_email_mensagens m JOIN conta c ON c.id = m.account_id) AS mensagens_enel_ja_lidas,
  (SELECT count(*) FROM public.portal_updates u JOIN conta c ON c.id = u.account_id)  AS cartoes_enel,
  (SELECT count(*) FROM public.portal_anexos x JOIN conta c ON c.id = x.account_id)   AS anexos_enel,
  (SELECT count(*) FROM public.portal_sync_runs s JOIN conta c ON c.id = s.account_id
    WHERE s.situacao IN ('na_fila', 'rodando'))                                       AS runs_abertos_da_enel;
```

Esperado em **21/10**: `contas_enel = 1`, `modo = email/remetente`, `conta_ligada =
true`, `sem_login_e_sem_segredo = 1` (é o que mantém o agendador longe dela),
`regras_ativas = 8`, `regra_edsp_corrigida = 1`, `projetos_total = 42`,
`projetos_ativos = 30`, `ativos_com_uc_de_8_digitos = 17`,
`ativos_sem_protocolo_numerico = 13`, `caixa_configurada = true`,
`quem_recebe_cada_sino = 6`, e **zeros** em `mensagens_enel_ja_lidas`,
`cartoes_enel`, `anexos_enel` e `runs_abertos_da_enel`. (Os 34 ativos de 13/10 são 30
hoje; o que muda entre uma conferência e outra é o cadastro, não o robô.) Há um run
da **Elektro** parado em `na_fila` desde 16/10: é da estação local e não conta.

Se `mensagens_enel_ja_lidas` não for 0, alguém clicou antes da hora: pare e veja a
seção 8.

Que o banco tem as funções finais (um arquivo à parte):

```sql
-- /tmp/funcoes-vivas.sql
SELECT p.proname AS funcao, count(*) AS versoes, max(p.pronargs) AS parametros,
       bool_or(p.prosrc LIKE '%atualizar_protocolo%') AS tem_troca_de_protocolo,
       bool_or(p.prosrc LIKE '%p_chave%')             AS tem_p_chave
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('ludmilla_email_registrar', 'ludmilla_email_anexo_novo', 'ludmilla_aplicar_update',
                     'ludmilla_email_conta', 'ludmilla_email_projetos', 'ludmilla_email_avisar')
 GROUP BY p.proname ORDER BY 1;
```

Esperado: **uma** versão de cada (`versoes = 1`); `ludmilla_email_registrar` com
`parametros = 20` e `tem_troca_de_protocolo = true`; `ludmilla_email_anexo_novo` com
`parametros = 8` e `tem_p_chave = true`; `ludmilla_aplicar_update` com
`tem_troca_de_protocolo = true` (o ramo que se perdeu em 22/09).

**Crédito na Anthropic**: confira o saldo no extrato de IA do console. Sem crédito,
a leitura do PDF volta `ok:false`: as Cartas não se identificam (a NT e a UC estão no
PDF), o motivo diz "não consegui ler o anexo para descobrir o projeto", e as
mensagens ficam para a próxima (até 5 vezes).

## 4. Disparar o run

Dois caminhos, mesmo efeito. **Escolha um** — não faça os dois.

**Pela tela** (`/ludmilla`): "Verificar agora" no cartão da ENEL. O botão só destrava
com a caixa configurada no tenant. Esse clique **é** o primeiro run.

**Por SQL**, se preferir controlar o momento:

```sql
-- /tmp/primeiro-run-enel.sql
INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo, situacao)
SELECT a.tenant_id, a.id, 'varredura_email', 'na_fila'
  FROM public.portal_accounts a
 WHERE a.connector = 'enel' AND a.acompanhamento = 'email'
RETURNING id;
```

O robô pega da fila pelo `ludmilla_claim_run` (só de conta ligada). Rodar duas vezes
enfileira dois runs — por isso o `runs_abertos_da_enel = 0` do pré-voo. Acompanhe o
log do robô na VPS (só códigos de projeto e contagens; nunca assunto, nome ou
arquivo):

```bash
journalctl -u ludmilla-worker -f | grep -E "por remetente|sem projeto certo|e-mail tratado|bloqueado|falhou"
```

## 5. O que olhar quando terminar

As consultas abaixo, uma por arquivo. **A primeira devolve o último run da ENEL**: até
o run novo terminar, ela mostra o do incidente de 14/10 (`pedido_em` de 14/10, quadros
vazios) — confira o `pedido_em`.

```sql
-- /tmp/confere-run.sql
SELECT s.pedido_em, s.situacao, s.erro,
       age(s.terminado_em, s.iniciado_em)           AS duracao,
       s.protocolos_lidos                           AS projetos_ativos,
       s.mudancas                                   AS documentos_anexados,
       s.resultado->>'remetentes'                   AS remetentes,
       s.resultado->>'lidos'                        AS lidos,
       s.resultado->>'pulados'                      AS pulados,
       s.resultado->>'tratados'                     AS tratados,
       s.resultado->>'por_protocolo'                AS por_protocolo,
       s.resultado->>'por_uc'                       AS por_uc,
       s.resultado->>'por_titular'                  AS por_nome,
       s.resultado->>'nao_identificados'            AS nao_identificados,
       s.resultado->>'conflitos'                    AS conflitos,
       s.resultado->>'inativos'                     AS inativos,
       s.resultado->>'bloqueados'                   AS bloqueados,
       s.resultado->>'ignorados'                    AS ignorados,
       s.resultado->>'avisos'                       AS avisos,
       s.resultado->>'anexos_de_outro_projeto'      AS anexos_de_outro_projeto,
       s.resultado->>'anexos_recusados'             AS anexos_recusados,
       s.resultado->>'anexos_sem_nome'              AS anexos_sem_nome,
       s.resultado->>'imagens_ignoradas'            AS imagens_ignoradas,
       s.resultado->>'a_tentar_de_novo'             AS a_tentar_de_novo,
       s.resultado->>'nao_lidas'                    AS nao_lidas,
       s.resultado->>'falhas_busca'                 AS falhas_busca,
       s.resultado->>'falhas_tratamento'            AS falhas_tratamento,
       (SELECT count(*) FROM public.portal_email_mensagens m
         WHERE m.account_id = s.account_id AND m.message_id LIKE 'imap-uid-%') AS mensagens_sem_message_id
  FROM public.portal_sync_runs s
  JOIN public.portal_accounts a ON a.id = s.account_id
 WHERE a.connector = 'enel' AND s.tipo = 'varredura_email'
 ORDER BY s.pedido_em DESC LIMIT 1;
```

Por situação e por remetente (é aqui que se separa "levantou a mão por bom motivo" de
"levantou a mão por defeito"):

```sql
-- /tmp/confere-situacao.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel')
SELECT lower(substring(m.remetente FROM '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')) AS remetente,
       CASE
         WHEN m.project_id IS NOT NULL AND m.motivo LIKE 'não anexei · o documento é de%' THEN '4 bloqueado (titular do documento)'
         WHEN m.project_id IS NOT NULL                                                  THEN '1 tratado'
         WHEN m.motivo LIKE 'não reconheci%'                                            THEN '2 não reconheci'
         WHEN m.motivo LIKE 'não anexei · %'                                            THEN '3 conflito ou projeto concluído'
         WHEN m.motivo LIKE 'não consegui ler o anexo%'                                 THEN '5 IA falhou (tenta de novo)'
         ELSE '6 ignorado ou outro'
       END AS situacao,
       count(*)                                  AS mensagens,
       count(*) FILTER (WHERE NOT m.concluida)   AS a_tentar_de_novo,
       count(*) FILTER (WHERE m.aviso_em IS NOT NULL) AS tocaram_o_sino
  FROM public.portal_email_mensagens m JOIN conta a ON a.id = m.account_id
 GROUP BY 1, 2 ORDER BY 1, 2;
```

E, mensagem por mensagem (as 60 mais recentes; o `achou_por` só existe nas que
abriram cartão):

```sql
-- /tmp/confere-mensagens.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel')
SELECT m.recebido_em::date AS dia,
       lower(substring(m.remetente FROM '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')) AS remetente,
       left(m.assunto, 70)  AS assunto,
       p.code               AS projeto,
       u.casamento          AS achou_por,
       m.tipo_documento, m.veredito, u.recomendacao, m.anexos, m.concluida, m.tentativas,
       left(coalesce(m.motivo, ''), 160) AS motivo
  FROM public.portal_email_mensagens m
  JOIN conta a ON a.id = m.account_id
  LEFT JOIN public.projects p ON p.id = m.project_id
  LEFT JOIN public.portal_updates u ON u.id = m.update_id
 ORDER BY m.created_at DESC LIMIT 60;
```

### Os números que decidem se o automático é confiável

| O que | Por que importa |
|---|---|
| **`por_protocolo` · `por_uc` · `por_nome`** | quantos e-mails entraram por qual sinal — é o número que diz se a identificação funciona. O nome é sinal de **reserva**: se `por_nome` vier alto, abra essas mensagens (o nome só vale no assunto e só como trecho inteiro) |
| **`nao_identificados` + `conflitos`** ("levantei a mão") | e-mails que ficaram para uma pessoa. **Leia por remetente** (`confere-situacao`): `no-reply` e `postmaster` cujo assunto não traz número nosso caem aqui sem problema; uma Carta do `nao.responda` ou um `tecnico.*` aqui **é** problema (deviam se identificar pelo PDF). Em `conflitos`, o `motivo` lista os dois códigos de projeto |
| **`bloqueados`** | parecer que a robô **recusou** anexar porque o titular do PDF é outra pessoa. Nunca rodou contra PDF real. Se vier alto, abra as mensagens: o nome do cadastro diferente do documento é real, ou a IA leu mal (ordem invertida, sufixos)? |
| **`inativos`** | e-mail cujo número é de projeto concluído ou arquivado: nada vai para o card. Esperado > 0 (12 dos 42 projetos não estão ativos) |
| **`anexados`** (= `documentos_anexados`) | documentos que chegaram a um card. Cada um se confere à mão (abaixo) |
| **`imagens_ignoradas`** | a robô não anexa imagem (quase sempre logo de assinatura). Se a ENEL mandar documento **escaneado**, este é o único lugar onde aparece |
| **`anexos_recusados`** · **`anexos_sem_nome`** · **`anexos_de_outro_projeto`** | os mesmos da EDP: arquivo que o bucket não aceita (p7s, dwg, zip, acima de 10 MB); anexo sem nome; arquivo cujo nome traz o número de **outro** projeto nosso (a robô acertou em não anexar — mas alguém leva o arquivo ao card certo à mão) |
| **`a_tentar_de_novo`** | a IA ou o anexo falhou. Normal ser > 0; preocupante ficar igual run após run, ou vir com "não consegui ler o anexo" em todas (crédito acabou?) |
| **`nao_lidas`** | corpo que o parser não leu. Condição permanente: no run de 14/10 foram 2 |
| **`falhas_busca` · `falhas_tratamento`** | > 0: olhe o log do robô (`o tratamento desta mensagem falhou`, `a busca na caixa falhou`) |
| **`duracao`** | só envelopes + IA para os pendentes; o run de 14/10, sem IA, levou 45 s para 18 mensagens. Se passar de uns 15 minutos, meça antes de falar em agendamento |
| **`mensagens_sem_message_id`** | linha com `imap-uid-…`: envelope sem `Message-ID`; se a caixa for recriada, a mensagem é tratada de novo |

### Os cartões que o run abriu

```sql
-- /tmp/confere-cartoes.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel')
SELECT p.code AS projeto, p.status::text AS etapa_agora, u.situacao, u.status_anterior,
       u.recomendacao, u.atualizar_protocolo AS troca_de_protocolo, u.protocolo AS ref_do_cartao,
       u.protocolo_anterior, u.casamento, left(coalesce(m.motivo, ''), 220) AS motivo
  FROM public.portal_updates u
  JOIN conta a ON a.id = u.account_id
  LEFT JOIN public.projects p ON p.id = u.project_id
  LEFT JOIN public.portal_email_mensagens m ON m.update_id = u.id
 ORDER BY u.detectado_em DESC;
```

O cartão só nasce quando há o que decidir: uma etapa sugerida, a troca de protocolo,
ou um bloqueio por titular. Esperado: **poucos** (a maioria dos 30 ativos está em
Aprovado ou Vistoria solicitada, e a sugestão de Aprovado/Pendência só vale antes da
aprovação). Cada um tem a etapa sugerida ou o selo violeta da troca.

**Atenção à data**: a sugestão de etapa **não olha a data do e-mail**. Uma "vistoria
reprovada" de três semanas atrás, com o projeto já reaprovado e de volta em Vistoria
solicitada, vira cartão "Vistoria reprovada". Antes de **Aplicar** qualquer cartão,
veja o `dia` na `confere-mensagens`.

### O sino

```sql
-- /tmp/confere-avisos.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel'),
ultimo AS (
  SELECT coalesce(s.iniciado_em, s.pedido_em) AS desde
    FROM public.portal_sync_runs s JOIN conta a ON a.id = s.account_id
   WHERE s.tipo = 'varredura_email' ORDER BY s.pedido_em DESC LIMIT 1)
SELECT CASE WHEN n.title LIKE '%mudou no portal' THEN '(cartão aberto) mudou no portal' ELSE n.title END AS sino,
       count(DISTINCT n.message || coalesce(n.project_id::text, '')) AS avisos,
       count(*) AS sinos_tocados
  FROM public.notifications n, conta c, ultimo u
 WHERE n.tenant_id = c.tenant_id AND n.type = 'ludmilla' AND n.created_at >= u.desde
   AND (n.title LIKE '%Vistoria virtual aprovada na ENEL' OR n.title LIKE '%A ENEL não trocou o relógio'
        OR n.title LIKE '%Um e-mail nosso voltou'
        -- o sino do cartão não diz de qual conta é: só os de projetos que têm cartão da ENEL
        OR (n.title LIKE '%mudou no portal' AND n.project_id IN
              (SELECT x.project_id FROM public.portal_updates x WHERE x.account_id = c.id)))
 GROUP BY 1 ORDER BY 1;
```

São **dois tipos de sino**: os **avisos da robô** (vistoria virtual aprovada, troca não
executada, e-mail devolvido — um por mensagem, para os 6 admin/staff) e o **sino do
cartão** ("PRJ-… mudou no portal"; o texto diz "portal" mesmo vindo de e-mail —
herança do portal — para os responsáveis do projeto, ou os admins se não houver). Um
aviso gera até 6 `sinos_tocados`.

### O custo de IA

```sql
-- /tmp/confere-custo.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel'),
ultimo AS (
  SELECT coalesce(s.iniciado_em, s.pedido_em) AS desde
    FROM public.portal_sync_runs s JOIN conta a ON a.id = s.account_id
   WHERE s.tipo = 'varredura_email' ORDER BY s.pedido_em DESC LIMIT 1)
SELECT count(*) AS leituras_de_pdf,
       coalesce(sum(l.input_tokens), 0)  AS tokens_entrada,
       coalesce(sum(l.output_tokens), 0) AS tokens_saida,
       round(coalesce(sum(public.ai_call_cost_usd(l.model, l.input_tokens, l.output_tokens, l.kind)), 0)::numeric, 2) AS usd,
       count(*) FILTER (WHERE l.model IS NULL) AS sem_tokens_lancados
  FROM public.ai_usage_log l, conta c, ultimo u
 WHERE l.kind = 'ludmilla_parecer' AND l.tenant_id = c.tenant_id AND l.created_at >= u.desde;
```

~US$ 0,10 por PDF lido (é a estimativa da reserva; os tokens reais corrigem depois).
Ordem de grandeza: 305 e-mails em ~5 meses são ≈ 60 em 30 dias, e só custam os que
trazem PDF e dependem dele — alguns dólares. Chamada que falha **não cobra** (a reserva
é desfeita). Se a EDP rodar na mesma janela, as leituras dela entram na mesma conta
(mesmo `kind` e tenant). `sem_tokens_lancados > 0` é leitura cujo custo caiu na
estimativa.

### "Troca feita" e entidades HTML

**"Troca feita".** A ENEL avisa quando cria a nota de serviço e quando a tentativa
falha, mas existe a frase "a troca … já foi realizada através da nota de serviço", que
hoje **só anota** (a robô não a classifica; nenhum cartão, nenhum sino). É uma
**decisão pendente do usuário**: vira sino ou sugestão de Concluído? Para saber se ela
apareceu: busque no Gmail da caixa, últimos 30 dias, `from:canalgd.sp@br.enel.com "já
foi realizada"`, e compare com as mensagens do `canalgd` que a robô leu **sem** a
anotação de troca no `motivo`:

```sql
-- /tmp/troca-feita.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel')
SELECT m.recebido_em::date AS dia, left(m.assunto, 80) AS assunto, p.code AS projeto
  FROM public.portal_email_mensagens m
  JOIN conta a ON a.id = m.account_id
  LEFT JOIN public.projects p ON p.id = m.project_id
 WHERE m.remetente ILIKE '%canalgd%' AND coalesce(m.motivo, '') NOT LIKE '%troca do relógio%'
 ORDER BY m.recebido_em DESC;
```

**Entidades HTML.** O texto dos e-mails da ENEL chega às vezes com `&ccedil;`, `&atilde;`
(e até `&amp;ccedil;`). O classificador decodifica (até 2 passadas) antes de ler; o que a
equipe vê (o motivo da falha de troca no `motivo` e no sino) tem de sair com acento:

```sql
-- /tmp/entidades-html.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel')
SELECT 'motivo ou resumo da mensagem' AS onde, count(*) AS com_entidade
  FROM public.portal_email_mensagens m JOIN conta a ON a.id = m.account_id
 WHERE m.motivo ~ '&[A-Za-z#0-9]+;' OR m.resumo ~ '&[A-Za-z#0-9]+;'
UNION ALL
SELECT 'texto do sino', count(*)
  FROM public.notifications n JOIN conta a ON a.tenant_id = n.tenant_id
 WHERE n.type = 'ludmilla' AND n.message ~ '&[A-Za-z#0-9]+;'
   AND (n.title LIKE '%Vistoria virtual aprovada na ENEL' OR n.title LIKE '%A ENEL não trocou o relógio');
```

Esperado: `0` e `0`. Se aparecer `&…;` em algum, é entidade que o classificador não
conhece: anote qual e conserte a tabela de entidades.

## 6. Abrir os cards na mão — o principal

Três projetos, no mínimo. Nada disto é automatizável, e é a razão de o primeiro run
ser acompanhado. Em cada um, conferir:

1. o PDF que chegou é o documento **daquele** projeto (titular e endereço);
2. o comentário no card diz **"Anexo emitido pela ENEL"** e diz a verdade sobre o que
   foi conferido ("conferido pelo número do protocolo", "UC conferida" ou "titular
   conferido");
3. a etapa sugerida (se houver) faz sentido **para o que o documento diz e para a data
   do e-mail**;
4. nenhuma imagem de assinatura virou documento.

**O caso que motivou o pedido: PRJ-67567** (Carta de 13/10 do `nao.responda`,
11 páginas, corpo vazio; NT 392812955, instalação 88101266, "o projeto apresentado
foi aprovado, porém solicitamos observar os itens abaixo"; UC do cadastro 0088101266;
sem protocolo). Esperado:

- a robô acha o projeto **pela UC** (selo "UC"; a UC curta "88101266" × "0088101266"
  é exatamente o que a regra de 7+ dígitos resolve), lendo o PDF — ou pelo nome do
  titular do PDF (selo "nome do titular"), se a IA não devolver a instalação;
- o PDF aparece em Documentos do card, com o comentário "Anexo emitido pela ENEL para
  o protocolo 392812955 (UC conferida)";
- um cartão em `/ludmilla` com **titular e empresa** do cadastro, o selo violeta
  "protocolo novo — casado por UC; no cadastro está (vazio)" e a **sugestão de gravar a
  NT 392812955**; "Aplicar" sem etapa grava só o protocolo;
- os itens que a ENEL listou, na ressalva: "aprovado com observações: …";
- **a sugestão de Aprovado — atenção ao estado do projeto.** Em 16/10 o PRJ-67567 estava
  em `analysis`, e a Carta traria a sugestão de **Aprovado**. Em 21/10 ele já está em
  **`approved`** (alguém o moveu à mão): `recomendacaoCabe` não sugere a etapa em que o
  projeto já está, e a ressalva diz "não sugeri "approved": o projeto já está nessa
  etapa". Então hoje o esperado é **só a troca de protocolo**. Se o projeto estiver em
  `pending`, `analysis`, `documentation`, `approval` ou `pendencia` no dia do run, vêm as
  duas sugestões.

**Se aparecer alguma "troca feita"** (a frase da seção 5), anote o projeto e o texto para a
decisão do usuário. E use este momento para olhar, nos cartões de troca de protocolo,
o `protocolo_anterior`: nunca deve ser a UC, nem o CPF/CNPJ, nem uma nota de serviço (o
banco recusa, mas é bom ver).

## 7. Aviso: a primeira leitura traz 30 dias

A janela é de **30 dias, fixa**, e a primeira leitura trata tudo o que a equipe já
resolveu à mão. Pode tocar o sino para **coisas que a equipe já fez** — a "vistoria
virtual aprovada" de três semanas atrás de um projeto cujo relógio já foi pedido, uma
troca não executada que já foi reaberta. Cada aviso vai para os 6 admin/staff. O
cartão de uma Carta de pendência antiga, ou de uma "vistoria reprovada" velha, pode
sugerir etapa para um projeto que já andou (veja a data antes de Aplicar). Avise a
equipe **antes** de clicar, para ninguém tomar o sino por urgência. Depois, se for o
caso, marque como lidos os sinos do run (nunca se apagam):

```sql
-- /tmp/sinos-lidos.sql — EDITE a data para a hora do run
UPDATE public.notifications n
   SET read = true
  FROM public.portal_accounts a
 WHERE a.connector = 'enel' AND n.tenant_id = a.tenant_id AND n.type = 'ludmilla'
   AND n.created_at >= TIMESTAMPTZ '2026-10-21 00:00:00-03'
   AND (n.title LIKE '%Vistoria virtual aprovada na ENEL' OR n.title LIKE '%A ENEL não trocou o relógio'
        OR n.title LIKE '%Um e-mail nosso voltou'
        OR (n.title LIKE '%mudou no portal' AND n.project_id IN
              (SELECT x.project_id FROM public.portal_updates x WHERE x.account_id = a.id)))
RETURNING n.id;
```

## 8. Se algo der errado

- **Parar já.** Desliga a conta e cancela o que está na fila. O robô só pega run de
  conta **ligada**. Um run que já está `rodando` **não para** por aqui — termina
  sozinho. Para pará-lo, `sudo systemctl stop ludmilla-worker` na VPS (isso para
  também a CPFL; depois, marque o run como `erro` à mão). Religar: `enabled = true`.

  ```sql
  -- /tmp/parar.sql
  UPDATE public.portal_accounts SET enabled = false WHERE connector = 'enel' RETURNING id, enabled;
  UPDATE public.portal_sync_runs s
     SET situacao = 'erro', erro = 'Cancelado à mão antes de começar.', terminado_em = now()
    FROM public.portal_accounts a
   WHERE a.id = s.account_id AND a.connector = 'enel' AND s.situacao = 'na_fila'
  RETURNING s.id, s.situacao;
  ```

- **Anexo no card errado** — o achado grave. **Pare** (acima), não enfileire outro run,
  e guarde o `id` da mensagem (`portal_email_mensagens`), o do anexo (`portal_anexos`)
  e os dois códigos de projeto. Isto não deveria acontecer: número nosso inteiro,
  conflito vira "levanta a mão", o titular do PDF é conferido, o nome do arquivo com o
  número de outro projeto é barrado, e a chave do anexo carrega o `project_id`.
- **401 na leitura do parecer** → o segredo `LUDMILLA_WORKER_KEY` não foi definido: o
  `deploy.yml` não rodou, ou rodou sem o segredo do GitHub.
- **"Esta concessionária não tem regras de e-mail cadastradas…"** → as regras sumiram
  (ou nenhuma tem remetente); cadastre pela tela.
- **"O acesso à caixa não está configurado"** → `agent_config` do tenant sem
  `gmail_email` / `gmail_app_password`.
- **Mensagem travada** (`concluida = false`, `tentativas = 5`) → a tela mostra em
  destaque; "Ler de novo" zera o contador (não zera `aviso_em`: o sino não toca de
  novo).
- **Quadros vazios na tela com o run `ok`** → renomearam uma chave de `resultadoEnel`
  (veja o comentário em `MensagensEmail.tsx`); o dado está em `confere-run.sql`.

### Desfazer o run — DESTRUTIVO, só com o OK do usuário

Apagar é irreversível, e há cartões, documentos e comentários em projetos de cliente.
Faça em dois passos, como na limpeza de 16/10. **Primeiro** conte:

```sql
-- /tmp/desfazer-1-contar.sql — SÓ LEITURA
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel')
SELECT
  (SELECT count(*) FROM public.portal_updates u JOIN conta c ON c.id = u.account_id WHERE u.situacao = 'pendente') AS cartoes_pendentes,
  (SELECT count(*) FROM public.portal_updates u JOIN conta c ON c.id = u.account_id WHERE u.situacao <> 'pendente') AS cartoes_decididos_ficam,
  (SELECT count(*) FROM public.portal_email_mensagens m JOIN conta c ON c.id = m.account_id) AS mensagens,
  (SELECT count(*) FROM public.portal_anexos x JOIN conta c ON c.id = x.account_id) AS anexos,
  (SELECT count(*) FROM public.documents d WHERE d.id IN
     (SELECT x.document_id FROM public.portal_anexos x JOIN conta c ON c.id = x.account_id WHERE x.document_id IS NOT NULL)) AS documentos_nos_cards,
  (SELECT count(*) FROM public.comments k
    WHERE k.user_id = '00000000-10d1-4000-8000-000000000002' AND k.message LIKE '%Anexo emitido pela%'
      AND k.project_id IN (SELECT x.project_id FROM public.portal_anexos x JOIN conta c ON c.id = x.account_id)) AS comentarios_de_anexo,
  (SELECT count(*) FROM public.portal_updates u JOIN conta c ON c.id = u.account_id
    WHERE u.situacao = 'aplicada' AND u.atualizar_protocolo) AS protocolos_ja_gravados_pela_equipe;
```

**Depois**, com os números na mão, apague. O bloco **aborta e não apaga nada** se a
contagem de agora for diferente da que você escreveu nos `_esp_*` (como o da limpeza
de 16/10, que só andava com exatamente 18):

```sql
-- /tmp/desfazer-2-apagar.sql — DESTRUTIVO. Troque os zeros pelos números do passo 1.
DO $$
DECLARE
  _conta   public.portal_accounts%ROWTYPE;
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
  _esp_cartoes     INT := 0;   -- cartoes_pendentes
  _esp_mensagens   INT := 0;   -- mensagens
  _esp_anexos      INT := 0;   -- anexos
  _esp_documentos  INT := 0;   -- documentos_nos_cards
  _esp_comentarios INT := 0;   -- comentarios_de_anexo
  _n INT;
BEGIN
  SELECT * INTO _conta FROM public.portal_accounts WHERE connector = 'enel';
  IF _conta.id IS NULL THEN RAISE EXCEPTION 'não achei a conta da ENEL'; END IF;

  SELECT count(*) INTO _n FROM public.portal_updates WHERE account_id = _conta.id AND situacao = 'pendente';
  IF _n <> _esp_cartoes THEN RAISE EXCEPTION 'cartões pendentes: esperava %, achei %', _esp_cartoes, _n; END IF;
  SELECT count(*) INTO _n FROM public.portal_email_mensagens WHERE account_id = _conta.id;
  IF _n <> _esp_mensagens THEN RAISE EXCEPTION 'mensagens: esperava %, achei %', _esp_mensagens, _n; END IF;
  SELECT count(*) INTO _n FROM public.portal_anexos WHERE account_id = _conta.id;
  IF _n <> _esp_anexos THEN RAISE EXCEPTION 'anexos: esperava %, achei %', _esp_anexos, _n; END IF;
  SELECT count(*) INTO _n FROM public.documents WHERE id IN
    (SELECT document_id FROM public.portal_anexos WHERE account_id = _conta.id AND document_id IS NOT NULL);
  IF _n <> _esp_documentos THEN RAISE EXCEPTION 'documentos: esperava %, achei %', _esp_documentos, _n; END IF;
  SELECT count(*) INTO _n FROM public.comments
   WHERE user_id = _ludmilla AND message LIKE '%Anexo emitido pela%'
     AND project_id IN (SELECT project_id FROM public.portal_anexos WHERE account_id = _conta.id);
  IF _n <> _esp_comentarios THEN RAISE EXCEPTION 'comentários: esperava %, achei %', _esp_comentarios, _n; END IF;

  DELETE FROM public.comments
   WHERE user_id = _ludmilla AND message LIKE '%Anexo emitido pela%'
     AND project_id IN (SELECT project_id FROM public.portal_anexos WHERE account_id = _conta.id);
  DELETE FROM public.documents WHERE id IN
    (SELECT document_id FROM public.portal_anexos WHERE account_id = _conta.id AND document_id IS NOT NULL);
  DELETE FROM public.portal_anexos WHERE account_id = _conta.id;
  DELETE FROM public.portal_updates WHERE account_id = _conta.id AND situacao = 'pendente';
  DELETE FROM public.portal_email_mensagens WHERE account_id = _conta.id;
END $$;

SELECT 'apagado' AS resultado;
```

O que ele **não** faz, de propósito:

- não apaga os **cartões já decididos** (aplicados ou ignorados): são decisão da equipe.
  `protocolos_ja_gravados_pela_equipe > 0` quer dizer que alguém aplicou uma troca de
  protocolo: o protocolo antigo está em `portal_updates.protocolo_anterior` e no
  histórico do projeto, e **se desfaz à mão**, projeto a projeto;
- não apaga os **sinos** (use o `sinos-lidos.sql` da seção 7), nem o **extrato de IA**;
- não apaga o **arquivo no bucket** `project-documents`: o documento some do card, mas o
  objeto fica órfão no Storage. Apague pela API do Storage (painel), **não** por SQL;
- apagar as linhas de mensagem faz o próximo run **reler** tudo (com `aviso_em` zerado,
  o sino toca de novo): desligue a conta (`parar.sql`) até decidir.

**Não agende nada** antes de olhar os números e os cards deste primeiro run. O agendador
(`ludmilla_agendar_varreduras`) só enfileira conta com login e `secret_id`, e a ENEL não
tem nenhum dos dois — é proteção **acidental**, que este roteiro não muda. O `INSERT`
de `varredura_email` é sempre manual.

## 9. Depois do primeiro run

1. Preencha os números reais (os da seção 5) na doc do módulo, em "O que NÃO está
   provado" da seção da ENEL, e atualize o estado no cabeçalho e no `CLAUDE.md`.
2. Leve ao usuário as **decisões pendentes**: a "troca feita" (sino ou sugestão de
   Concluído?), os cartões do portal CPFL em que o "Aplicar" não gravou o protocolo
   entre 22/09 e 16/10 (PRJ-36467 → 2233593787; PRJ-89660 → 2250770386), e se vale
   repetir o run depois de corrigir regra ou cadastro.
3. Só então se fala em agendamento.
