# Primeiro run da ENEL por e-mail — roteiro

> Escrito em 20/10/2026, com a entrega pronta; os números do banco foram conferidos
> em 21/10. **Revisado em 22/10 depois da revisão final do ramo** (10 correções: a
> fila da ENEL se confere e se cancela antes de atualizar o robô; o "verde" do
> `deploy.yml` não prova a edge function; o robô novo pode não subir; o cartão de
> e-mail passou a dizer o porquê). **Estado do push em 22/10:** já foi feito (ver
> "Estado" abaixo) — o que falta publicar é o **robô da VPS** (passo 1.3) e a tela
> desta rodada de fechamento.
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

> **ATENÇÃO — até o robô novo estar na VPS (o passo do `ludmilla-worker.yml`, 1.3),
> NINGUÉM clica em "Verificar agora" no cartão da ENEL.**
>
> O robô antigo lê a ENEL **no modo da EDP** (procura o protocolo no assunto). Foi o
> incidente de 14/10: alguém clicou, o robô da VPS ainda não tinha o código da ENEL, e
> o run criou 18 cartões, 18 sinos e 18 linhas de mensagem com a chave errada. A
> limpeza foi feita em 16/10.
>
> **A conta da ENEL fica ligada** (decisão do usuário, 22/10: nada de `enabled =
> false`). Isso quer dizer que **nada segura o botão**: ele está ligado de verdade e
> não sabe qual robô está na VPS, e o robô antigo pega o run assim que ele entra na
> fila. A proteção é combinar com quem tem acesso à tela, e o passo 0 abaixo.

**Passo 0 — a fila da ENEL: conferir, e cancelar o que estiver parado.** O robô da VPS
pega a fila **a cada 30 s**: um clique de hoje vira `rodando` em até 30 s, e `rodando`
**não se cancela por SQL**. Por isso o `cancelar-fila-da-enel` só pega run **parado**,
o que acontece com o serviço fora do ar (parado, reiniciando, ou no meio do passo
1.3); com o serviço no ar a fila esvazia sozinha e o que se vê é `rodando`. **A
proteção real é o aviso do começo desta seção, não este SQL.** Confira (só leitura):

```sql
-- /tmp/fila-da-enel.sql
SELECT s.id, s.tipo, s.situacao, s.pedido_em
  FROM public.portal_sync_runs s
  JOIN public.portal_accounts a ON a.id = s.account_id
 WHERE a.connector = 'enel' AND s.situacao IN ('na_fila', 'rodando')
 ORDER BY s.pedido_em;
```

O esperado é **nenhuma linha**. Se houver `na_fila` (no banco o run pendente se chama
`na_fila`; é run parado, com o serviço fora), cancele **antes** de publicar o robô:

```sql
-- /tmp/cancelar-fila-da-enel.sql
UPDATE public.portal_sync_runs s
   SET situacao = 'erro', erro = 'Cancelado à mão antes de atualizar o robô.', terminado_em = now()
  FROM public.portal_accounts a
 WHERE a.id = s.account_id AND a.connector = 'enel' AND s.situacao = 'na_fila'
RETURNING s.id, s.tipo, s.situacao;
```

Um run `rodando` **não** se cancela por aqui: é o incidente de 14/10 em andamento (o
robô velho lendo a ENEL como a EDP) — vá direto para a seção 8 ("Parar já"). Repita a
conferência logo antes de disparar o `ludmilla-worker.yml` (passo 1.3).

Quem faz o quê: o **push** e a hora de publicar são do usuário. Este roteiro não faz
push, e o `stash@{0}` do repositório é de outra sessão — não mexer.

Estado (os itens de git e de Actions foram conferidos em 22/10; **refazer se demorar**):

| O quê | Estado |
|---|---|
| Migrações da ENEL (`20261013120000` … `20261019120000`, 6 arquivos) | **todas aplicadas** no banco vivo (passo 3 confere pelas funções) |
| Migração do fechamento A (`20261022120000`: cartão do projeto certo, UC pontuada, `recebido_em`) | **aplicada, conferido em 22/10**: o `ludmilla_email_registrar` vivo tem 20 parâmetros e `recebido_em` no `raw` (`tem_recebido_no_raw = true`, passo 3). A `20261022200000_ludmilla_afazeres.sql` (outra frente, o "A fazer" da equipe) também já está aplicada; não é da ENEL |
| Commits à frente do `origin/main` | **conte na hora**: `git fetch origin`, `git rev-list --count origin/main..HEAD` e `git log origin/main..HEAD --oneline`. O **primeiro push já foi feito** em 22/10 (01:38; `origin/main` = `832bb24`, run `39723536161` do `deploy.yml` em `success`) e levou, além da ENEL, o financeiro (`bd8ed0b`, recebimento em lote por etapa) e a correção da criação na CPFL (`b956468`, migração `20261021130000` já aplicada). **O `origin/main` NÃO tem o worker do fechamento A (`e9ab61f`).** O **próximo push** (6 commits na conferência de 22/10) leva: o **worker do A** (`e9ab61f`: `run.ts` e `classificar.ts`, os testes e o arquivo da migração `20261022120000`, já aplicada); a **tela do B** (`5d78b6e`); a migração `20261022200000_ludmilla_afazeres.sql` (de outra frente, já aplicada no banco); e a doc e os planos (`68c8a53`, `981d0a4`, `47e7bae`: spec e plano da página nova da Ludmilla) |
| `ludmilla-parecer` no ar | do `deploy.yml` de 22/10: **tem** o modo ENEL (`08e59f2`) e a correção `455b4d2`. **Confira o passo, não a cor do run** (passo 1.2): o job tem `continue-on-error: true` |
| Robô da VPS | do deploy de 16/10 (último `ludmilla-worker.yml` com sucesso): tem `identificar.ts` e `classificar.ts`, **não tem** `run.ts` nem `rotear.ts` — roda a ENEL como a EDP. **É o que falta publicar**, e só depois do push do worker do A (o workflow publica o que está no GitHub: trava do passo 1.3) |
| Tela `/ludmilla` no ar | a de 22/10 (titular e empresa nos cartões, quadros da ENEL). Os cartões de e-mail com o **motivo**, o "achado pela …", a data e a faixa de bloqueio, e o rótulo "avisos (mensagens)", são do fechamento B: só no ar depois do próximo push |
| Conta da ENEL | **ligada** (conferido no banco em 22/10: `conta_ligada = true`) e **assim fica**, por decisão do usuário. Sem robô novo na VPS, ninguém clica em "Verificar agora" |

## 1. Publicar primeiro, rodar depois — a ordem importa

### 1.1 O push e o `deploy.yml` (do usuário)

O **primeiro** push já foi feito em 22/10 (ver "Estado" acima), mas **falta o próximo**:
o `origin/main` (`832bb24`) **não tem o worker do fechamento A** (`e9ab61f`), e o robô
da VPS só pode ser atualizado depois dele (trava do 1.3). Confira o que vai junto, na
hora:

```bash
git fetch origin
git rev-list --count origin/main..HEAD     # quantos commits estão à frente, na hora
git log origin/main..HEAD --oneline        # e quais são
git push origin main
```

**O que o próximo push leva** (6 commits na conferência de 22/10; refaça a contagem):
o **worker do fechamento A** (`e9ab61f`); a **tela do fechamento B** (`5d78b6e`); a
migração `20261022200000_ludmilla_afazeres.sql` (**de outra frente**, o "A fazer" da
equipe, e **já aplicada** no banco); e a **doc e os planos** (`68c8a53`, `981d0a4`,
`47e7bae`: spec e plano da página nova da Ludmilla). **Não é só a ENEL.** O primeiro
push já tinha levado o **financeiro** (`bd8ed0b`, recebimento em lote por etapa) e a
**correção da criação na CPFL** (`b956468`: grava o número do projeto; a migração
`20261021130000` já estava aplicada). Todo push da `main` publica o que estiver nela,
de qualquer frente.

O `deploy.yml` publica as edge functions (entre elas a `ludmilla-parecer`, com
`--no-verify-jwt`), **define o segredo `LUDMILLA_WORKER_KEY`** a partir do mesmo
segredo do GitHub que o robô usa, e sobe o front novo. Espere o run terminar:

```bash
gh run list --workflow deploy.yml --limit 1
```

**Mas "verde" não basta.** O job `deploy-functions` tem `continue-on-error: true`
(para não bloquear o front): se o passo da `ludmilla-parecer` falhar, o run **continua
verde**. O passo 1.2 confere a função de verdade. O `deploy.yml` **não** publica o
robô da VPS (passo 1.3).

### 1.2 A edge function `ludmilla-parecer` — confira o PASSO, não a cor do run

Duas conferências, e as duas têm de bater:

```bash
# (a) o passo "Deploy ludmilla-parecer" do run — tem de estar "success"
RUN=$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --json jobs --jq '.jobs[] | select(.name=="deploy-functions") | .steps[] | select(.name | test("ludmilla-parecer")) | {name, conclusion}'
#   (ou, em texto: gh run view "$RUN" --log | grep "Deploy ludmilla-parecer")

# (b) a versão no ar — a data de atualização tem de ser a do push
npx -y supabase functions list --project-ref yqsqrdndvsnhbsoaoilf
```

Em (a), o passo "Segredo do robô para a ludmilla-parecer" também tem de estar em
`success` (é ele que define o `LUDMILLA_WORKER_KEY`). Em (b), olhe a linha da
`ludmilla-parecer`: a versão sobe a cada publicação, e a data de atualização tem de
ser a do push (em terminal sai tabela; sem terminal sai JSON, com `updated_at` em
milissegundos — `date -u -d @<segundos>` converte). **Conferido em 22/10:** run
`39723536161` com os dois passos em `success`, e a `ludmilla-parecer` na versão 108,
atualizada às 04:39:53Z (01:39 em Brasília), um minuto depois do push.

Se o passo falhou, ou a versão/data não bate, publique à mão, da raiz do repositório:

```bash
# o --use-api é porque o Docker não roda nesta máquina
npx -y supabase functions deploy ludmilla-parecer --project-ref yqsqrdndvsnhbsoaoilf --no-verify-jwt --use-api
```

A **prova do portão** continua valendo, mas prova **só o portão**: sem credencial tem
de dar `401`. Mostre só o status, nunca o corpo nem uma chave:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ludmilla-parecer -H "content-type: application/json" -d '{}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yqsqrdndvsnhbsoaoilf.supabase.co/functions/v1/ludmilla-parecer -H "content-type: application/json" -d '{"concessionaria":"enel"}'
```

Os dois têm de imprimir `401`: o modo ENEL não abre o portão. **Atenção: a versão
velha e a nova dão o mesmo `401`** — este teste NÃO distingue uma da outra. Quem
distingue é o (a) e o (b) acima.

### 1.3 Atualizar o robô da VPS — à mão

**Antes, duas travas:**

1. **O GitHub tem de ter o código do robô novo.** O `ludmilla-worker.yml` publica o que
   está no **GitHub**, não o que está nesta máquina. O `origin/main` (`832bb24`) **não**
   tem o worker do fechamento A (`e9ab61f`). Rode, e a saída tem de ser **VAZIA**:

   ```bash
   git fetch origin
   git diff --stat origin/main..HEAD -- worker/ludmilla/src
   ```

   Se mostrar qualquer arquivo (em 22/10 mostrava `classificar.ts` e `run.ts`), o
   workflow publicaria o robô **velho** com cara de novo: **faça primeiro o push** (1.1)
   e rode de novo até vir vazio.
2. **A fila da ENEL conferida** (passo 0, `fila-da-enel.sql`). E, até este passo
   terminar em `success`, ninguém clica em "Verificar agora" no cartão da ENEL.

```bash
gh workflow run ludmilla-worker.yml
gh run list --workflow ludmilla-worker.yml --limit 1     # esperar "completed / success"
```

O workflow é manual (`workflow_dispatch`) e usa o código **que está no GitHub**:
por isso só depois do push. Ele roda os testes do robô (`npm test`), compila, monta o
pacote da estação local, sincroniza `/opt/ludmilla` ("Sincronizar código") e reinicia o
serviço `ludmilla-worker` ("Instalar / reiniciar").

Dois cuidados:

1. **Só siga com `success`.** O `npm test` do workflow pode cair em 3 testes
   instáveis. Leia **onde** parou, com `gh run view <id>`:
   - falhou em "Testes do robô" ou "Compilar" (antes de "Sincronizar código"): a VPS
     ficou **intacta**, o robô velho (o que roda a ENEL como a EDP) **continua no ar**.
     Rode de novo (`gh run rerun <id> --failed`) ou conserte;
   - falhou **depois** de "Sincronizar código" (em "Instalar / reiniciar"), ou foi
     `cancelled` no meio: o estado é **incerto** — código novo na pasta e serviço velho,
     parado ou meio reiniciado. A prova, nesse caso, é o `grep` e o `systemctl` abaixo.
   Em qualquer dos dois, **não** passe para o passo 4 até os comandos abaixo baterem.
2. **Rode fora do horário do cron da CPFL: 8h e 17h** (`ludmilla-08h`/`ludmilla-17h`,
   horário de Brasília). O restart do serviço **interrompe** o run da CPFL que
   estiver no meio (se ele ficar `rodando`, marque como `erro` à mão, como no passo
   8). Dispare entre uma e outra, nunca perto delas.

Para ter certeza de que o robô novo está lá (SSH na VPS, porta 22022):

```bash
grep -c executarVarreduraEnel /opt/ludmilla/dist/email/rotear.js    # maior que 0
grep -c avisos_mensagens /opt/ludmilla/dist/email/enel/run.js       # maior que 0 (o código do fechamento A)
systemctl is-active ludmilla-worker                                  # active
```

**Só depois disto** o "Verificar agora" do cartão da ENEL faz o que o desenho manda.

## 2. Abrir `/ludmilla` logado — a prova do embed novo

Logado como admin/staff do GD Manager. A consulta dos cartões ganhou um embed
(`project:projects(id, code, status, title, companies:company_id(name),
project_general_data(holder_name))`). **A revisão final provou o embed no PostgREST
real**: sonda anônima devolveu `200 []` (a consulta é aceita e planejada; vazia
porque a RLS nega ao anônimo) e o controle, com uma coluna que não existe, devolveu
`400 42703` — ou seja, a sonda distingue consulta boa de consulta quebrada. Falta o
que a sonda não alcança: **linhas de verdade, com a sua sessão** (RLS de `companies` e
de `project_general_data` para o seu papel). Por isso esta conferência continua valendo.
Confira:

1. a página carrega e os cartões pendentes (CPFL) mostram **Titular** e **Empresa**;
   onde falta um dos dois, aparece um traço, nunca "undefined". Nos cartões da CPFL, o
   nome do portal aparece abaixo como "no portal: …" quando difere do cadastro;
2. **não** aparece o aviso vermelho com "Tentar de novo" (é o que a tela mostra se a
   consulta falhar; antes dele o erro virava "Nada pendente");
3. o cartão da ENEL diz "Acompanho por: e-mail". **Já existe um run de 14/10** (o do
   incidente: `ok`, 18 lidos), então o cartão mostra **"Na última leitura da caixa —
   14/10"** com os poucos quadros que aquele run gravou — **não** o texto "Ela ainda
   não leu a caixa…". Esse texto só aparece em conta sem nenhum run de e-mail. O run
   de 14/10 é do modo da EDP e gravou só estas chaves: `lidos` (18), `bloqueados`,
   `anexados`, `imagens_ignoradas` (1), `a_tentar_de_novo`, `falhas` (e outras que a
   tela não lê). Então aparecem esses quadros, e **somem** os de "achei pelo protocolo
   / pela UC / pelo nome", o de "levantei a mão" e **o de avisos**: o run de 14/10 não
   tem `avisos` **nem** `avisos_mensagens`, e `contadorDoRun` devolve `null` para chave
   que não existe — o quadro some, sem erro. Não é defeito;
4. as 8 regras aparecem, editáveis (a escrita é só do `admin`).

Se o aviso vermelho aparecer, **pare**: o erro (ambiguidade de relacionamento, política
de RLS na tabela `companies`…) está no console do navegador e na aba de rede. Não
rode o robô antes de consertar — o cartão que ele abrir seria ilegível.

**Atenção ao que o aviso vermelho leva junto: os cartões da CPFL também somem da
tela.** A consulta de recomendações é **uma só** (`usePortalUpdates`): se o embed
quebrar, caem as recomendações da CPFL, da EDP e da ENEL de uma vez, e o contador da
barra lateral junto.

**Desfazer** (se não der para consertar o embed na hora): reverter o front e fazer
push. O embed e o aviso vermelho vieram em `789b60d` (titular e empresa, quadros da
ENEL) e `8a79e80` (o aviso de erro e a etapa que acompanha o refetch); o commit do
fechamento B (`5d78b6e`: cartão de e-mail com motivo) mexe nos mesmos arquivos e tem de
sair junto. **O `5d78b6e` também traz a doc e este roteiro**, que **não** podem ser
desfeitos: por isso o revert é sem commit, e a doc volta ao que está no `HEAD`:

```bash
git revert --no-commit 5d78b6e 8a79e80 789b60d     # do mais novo para o mais velho; só prepara
# CONFLITO ESPERADO em MensagensEmail.tsx (o cc8627c mexeu no mesmo comentário): fique com o
# lado de ANTES do embed, que no revert é o "theirs":
git checkout --theirs src/components/ludmilla/MensagensEmail.tsx && git add src/components/ludmilla/MensagensEmail.tsx
git restore --staged --worktree docs/              # a doc NÃO é revertida: fica como está no HEAD
git status --short                                 # só src/ pode aparecer: Ludmilla.tsx, useLudmilla.ts,
                                                   # MensagensEmail.tsx, RegrasEmail.tsx, e ludmillaCartao.ts
                                                   # e .test.ts apagados
git commit -m "revert(ludmilla): volta a tela sem o embed de titular e empresa"
git push origin main                               # o deploy.yml sobe o front de antes
```

Testado em 22/10 num `git worktree` descartável: com o `checkout --theirs`, os quatro
arquivos de tela ficam **idênticos ao que eram antes do `789b60d`** e o `git status`
mostra só `src/`. **Cuidado com o `git restore … docs/`:** ele descarta **qualquer**
mudança de `docs/` no índice ou na árvore, a sua e a de **outra sessão** (já aconteceu).
Antes, rode `git status`: se houver arquivo de `docs/` que não seja efeito do revert,
**guarde-o** (`git stash push -- docs/`) ou faça o revert num `git worktree` à parte.
**E, se outra sessão já mexeu em `Ludmilla.tsx` por cima** (a página nova da Ludmilla
está em obra), o revert conflita nesses arquivos: resolva à mão, mantendo a consulta
antiga (`select('*, project:projects(id, code, status, title)')`), em vez de aceitar um
lado às cegas. O banco não precisa voltar: nada do banco depende desse front.

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

Esperado em **21/10** (reconferido em 22/10): `contas_enel = 1`,
`modo = email/remetente`, `conta_ligada = true` (a conta **fica ligada**, decisão do
usuário), `sem_login_e_sem_segredo = 1` (é o que mantém o agendador longe dela),
`regras_ativas = 8`, `regra_edsp_corrigida = 1`, `projetos_total = 42`,
`projetos_ativos = 30`, `ativos_com_uc_de_8_digitos = 17`,
`ativos_sem_protocolo_numerico = 13`, `caixa_configurada = true`,
`quem_recebe_cada_sino = 6`, e **zeros** em `mensagens_enel_ja_lidas`,
`cartoes_enel`, `anexos_enel` e `runs_abertos_da_enel`. (Os 34 ativos de 13/10 são 30
hoje; o que muda entre uma conferência e outra é o cadastro, não o robô.) Há um run
da **Elektro** parado em `na_fila` desde 16/10: é da estação local e não conta.

Se `mensagens_enel_ja_lidas` não for 0, alguém clicou antes da hora: pare e veja a
seção 8. Se `runs_abertos_da_enel` não for 0, é run na fila (clique perdido) ou rodando:
**não** siga — o passo 0 (`fila-da-enel.sql` e `cancelar-fila-da-enel.sql`) cancela o
que está em `na_fila`; o que está `rodando` é caso da seção 8.

Que o banco tem as funções finais (um arquivo à parte):

```sql
-- /tmp/funcoes-vivas.sql
SELECT p.proname AS funcao, count(*) AS versoes, max(p.pronargs) AS parametros,
       bool_or(p.prosrc LIKE '%atualizar_protocolo%') AS tem_troca_de_protocolo,
       bool_or(p.prosrc LIKE '%p_chave%')             AS tem_p_chave,
       -- fechamento A (20261022120000): o cartão leva o dia do e-mail em raw.recebido_em
       bool_or(p.prosrc ~ '''recebido_em''\s*,\s*p_recebido_em') AS tem_recebido_no_raw
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('ludmilla_email_registrar', 'ludmilla_email_anexo_novo', 'ludmilla_aplicar_update',
                     'ludmilla_email_conta', 'ludmilla_email_projetos', 'ludmilla_email_avisar')
 GROUP BY p.proname ORDER BY 1;
```

Esperado: **uma** versão de cada (`versoes = 1`); `ludmilla_email_registrar` com
`parametros = 20` e `tem_troca_de_protocolo = true`; `ludmilla_email_anexo_novo` com
`parametros = 8` e `tem_p_chave = true`; `ludmilla_aplicar_update` com
`tem_troca_de_protocolo = true` (o ramo que se perdeu em 22/09). E
`ludmilla_email_registrar` com **`tem_recebido_no_raw = true`**: a migração
`20261022120000` do fechamento A **está aplicada** (conferido em 22/10). Se vier
`false`, algo desfez isso (ou é outro banco): o run funciona, mas o "Ler de novo" tem
a falha C-1 (seção 8) e os cartões novos saem sem a data do e-mail (a tela usa "lido
pela Ludmilla em") — aplique a migração antes de seguir.

**Crédito na Anthropic**: confira o saldo no extrato de IA do console. Sem crédito,
a leitura do PDF volta `ok:false`: as Cartas não se identificam (a NT e a UC estão no
PDF), o motivo diz "não consegui ler o anexo para descobrir o projeto", e as
mensagens ficam para a próxima (até 5 vezes). **E, desde o I-2 (22/10), o PDF que
precisa da trava de titular não é anexado sem a leitura da IA**: o robô não anexa "às
cegas", e a mensagem espera a próxima tentativa, com a ressalva "não anexei ainda:
preciso ler o documento para conferir o titular" (até 5 tentativas). **Só espera quem
precisa ler** (`precisaLerPdf`, `decidir.ts`): a regra tem `ler_pdf` **e** (o texto não
achou o projeto, **ou** a regra é Carta/resultado de vistoria e o texto não classificou
o e-mail). **Não espera:** o e-mail que o texto **achou e classificou** (protocolo, UC ou
nome no assunto, mais um assunto que o classificador reconhece), e o que o texto achou
numa regra que não espera veredito (troca do relógio, por exemplo) — esses não chamam a
IA e anexam **sem leitura e sem a trava de titular**, como antes do I-2; e a regra com
`ler_pdf = false`, que não depende da IA. Então, sem crédito, ficam esperando os
e-mails que o texto **não identificou** e as Cartas e os resultados de vistoria que o
texto achou mas **não classificou**; o resto anexa normalmente.

## 4. Disparar o run

Só dispare quando **todos** estes estiverem verdadeiros: o passo 1.2 conferido
(edge function no ar), o passo 1.3 em `success` com o `grep` do `rotear.js` maior que
0 (**o robô novo está na VPS**), o pré-voo (passo 3) feito e a fila da ENEL vazia
(passo 0). A conta está ligada: o robô pega o run no instante em que ele entra na fila.

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
       s.resultado->>'avisos_mensagens'             AS avisos_mensagens,  -- mensagens que geraram aviso (fechamento A); NULL em run antigo
       s.resultado->>'avisos'                       AS sinos_tocados,     -- SINOS, ~6 por aviso — não é o número de avisos
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
         -- PRIMEIRO: a mensagem que o robô começou e não terminou (ver abaixo). Se ficasse
         -- depois do `project_id IS NOT NULL`, uma delas com projeto contaria como "tratado".
         WHEN m.motivo LIKE 'o robô começou a tratar%'                                  THEN '7 morreu no meio (começou e não terminou)'
         WHEN m.project_id IS NOT NULL AND m.motivo LIKE 'não anexei · o documento é de%' THEN '4 bloqueado (titular do documento)'
         WHEN m.project_id IS NOT NULL AND m.motivo LIKE '%não anexei ainda%'           THEN '5 esperando a IA (tenta de novo)'
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

**Separe as que morreram no meio** (grupo `7`). O robô grava a linha da mensagem
**antes** de tratá-la, com o motivo "o robô começou a tratar esta mensagem" e
`concluida = false` (é assim que a tentativa é contada antes de gastar IA). Se o
tratamento termina, o registro final troca esse motivo pelo resultado. Se o motivo
**continua** depois que o run fechou, a mensagem **começou e não terminou**: o robô
caiu, a IA estourou, o anexo deu erro, ou o serviço foi reiniciado no meio. Elas não
são "tratadas", não são "ignoradas" e não são "não reconheci" — contá-las em outro
grupo esconde a falha. Cada uma volta no run seguinte (até 5 tentativas); o que importa
é **quantas** e se são **sempre as mesmas** (a mesma mensagem que mata o robô). Para
listar, ou para ver se sobrou alguma depois do run:

```sql
-- /tmp/confere-morreu-no-meio.sql
WITH conta AS (SELECT a.* FROM public.portal_accounts a WHERE a.connector = 'enel')
SELECT m.recebido_em::date AS dia, p.code AS projeto, m.tentativas, m.concluida,
       left(m.assunto, 70) AS assunto
  FROM public.portal_email_mensagens m
  JOIN conta a ON a.id = m.account_id
  LEFT JOIN public.projects p ON p.id = m.project_id
 WHERE m.motivo LIKE 'o robô começou a tratar%'
 ORDER BY m.tentativas DESC, m.recebido_em DESC;
```

Zero linhas é o esperado com o run `ok`; `falhas_tratamento` (em `confere-run`) conta o
mesmo problema pelo lado do robô. Na tela, essas mensagens aparecem no grupo "Vou
tentar de novo" (e, com 5 tentativas, em "Desisti"), com o texto "o robô começou a
tratar esta mensagem".

**O quadro de avisos conta SINOS, não avisos.** Na tela e no `confere-run`, o antigo
`avisos` é a soma de **sinos tocados**: cada aviso vai para os 6 admin/staff, então um
aviso vale cerca de **6**. Com o fechamento A há a chave `avisos_mensagens` (quantas
**mensagens** geraram aviso) — use essa para dizer "quantos avisos". Na tela, o quadro
diz **"avisos (mensagens)"** num run novo, e **"sinos tocados"** num run que tenha só
`avisos`. **O run de 14/10 não tem nenhum dos dois** (as chaves reais dele não incluem
`avisos`): nele o quadro de avisos **some**, sem erro. Sem o fechamento A no robô (VPS
ainda com o código velho), um run da ENEL traria só `avisos` — e ele **não é** o número
de avisos.

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
| **`bloqueados`** | parecer que a robô **recusou** anexar porque o titular do PDF é outra pessoa. Nunca rodou contra PDF real. Se vier alto, abra as mensagens: o nome do cadastro diferente do documento é real, ou a IA leu mal (ordem invertida, sufixos)? Na tela cada um é um cartão com a faixa vermelha "Documento não anexado" e o motivo |
| **`avisos_mensagens`** (e `sinos_tocados`) | `avisos_mensagens` = mensagens que geraram aviso; o `avisos` antigo é de **sinos** (~6 por aviso). Não some um com o outro |
| **`inativos`** | e-mail cujo número é de projeto concluído ou arquivado: nada vai para o card. Esperado > 0 (12 dos 42 projetos não estão ativos) |
| **`anexados`** (= `documentos_anexados`) | documentos que chegaram a um card. Cada um se confere à mão (abaixo) |
| **`imagens_ignoradas`** | a robô não anexa imagem (quase sempre logo de assinatura). Se a ENEL mandar documento **escaneado**, este é o único lugar onde aparece |
| **`anexos_recusados`** · **`anexos_sem_nome`** · **`anexos_de_outro_projeto`** | os mesmos da EDP: arquivo que o bucket não aceita (p7s, dwg, zip, acima de 10 MB); anexo sem nome; arquivo cujo nome traz o número de **outro** projeto nosso (a robô acertou em não anexar — mas alguém leva o arquivo ao card certo à mão) |
| **`a_tentar_de_novo`** | a IA ou o anexo falhou, **ou o PDF esperou a leitura** ("não anexei ainda: preciso ler o documento…", I-2 — só quando o e-mail precisa ler: projeto não achado pelo texto, ou Carta/resultado de vistoria sem classificação pelo texto). Normal ser > 0; preocupante ficar igual run após run, ou vir com "não consegui ler o anexo" em todas (crédito acabou?). Separe as que **morreram no meio** (`confere-morreu-no-meio`) |
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
       u.protocolo_anterior, u.casamento, u.raw->>'recebido_em' AS email_recebido_em,
       left(coalesce(m.motivo, ''), 220) AS motivo
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

**O que o cartão de e-mail diz na tela** (fechamento B, 22/10): sempre **como o projeto
foi achado** ("achado pelo protocolo / pela UC / pelo nome do titular"), o **dia do
e-mail** ("e-mail recebido em …" nos cartões novos; "lido pela Ludmilla em …" nos
antigos, que não têm `recebido_em`) e o **motivo**, em âmbar. O cartão de **bloqueio**
tem a faixa vermelha "Documento não anexado" com o motivo. Confira, em cada cartão
aberto, que o "achado pelo nome do titular" foi de fato um assunto com o nome inteiro
(é o sinal de reserva). Os cartões da CPFL não mudam.

**Atenção à data**: a sugestão de etapa **não olha a data do e-mail**. Uma "vistoria
reprovada" de três semanas atrás, com o projeto já reaprovado e de volta em Vistoria
solicitada, vira cartão "Vistoria reprovada". Antes de **Aplicar** qualquer cartão,
veja a data no próprio cartão (ou o `dia` na `confere-mensagens`).

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
sem protocolo).

> **Este caso tem prazo: a Carta de 13/10 sai da janela de 30 dias por volta de
> 12/11.** A janela da primeira leitura é fixa (30 dias a partir de agora): depois
> disso a Carta nem é lida, e o caso de conferência — o único que exercita o
> caminho inteiro (UC curta, PDF, NT, troca de protocolo) — **deixa de existir**. Faça
> o run **antes de 12/11**; passando, escolha outra Carta mais nova para conferir.
> O PRJ-67567 **já está em `approved`** (alguém o moveu à mão): a Carta trará **só a
> troca de protocolo para a NT**, não a sugestão de Aprovado (veja o último item).

Esperado:

- a robô acha o projeto **pela UC** (o cartão diz "achado pela UC"; a UC curta
  "88101266" × "0088101266" é exatamente o que a regra de 7+ dígitos resolve), lendo o
  PDF — ou pelo nome do titular do PDF ("achado pelo nome do titular"), se a IA não
  devolver a instalação;
- o PDF aparece em Documentos do card, com o comentário "Anexo emitido pela ENEL para
  o protocolo 392812955 (UC conferida)";
- um cartão em `/ludmilla` com **titular e empresa** do cadastro, "achado pela UC" e
  o dia do e-mail (13/10), o selo violeta "protocolo novo — casado por UC; no cadastro
  está (vazio)" e a **sugestão de gravar a NT 392812955**; "Aplicar" sem etapa grava só
  o protocolo;
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
equipe **antes** de clicar, para ninguém tomar o sino por urgência.

**Dois efeitos do I-2 (22/10) na primeira leitura.** (1) Os documentos que precisam da
trava de titular esperam a IA: se ela estiver fora do ar (crédito, cota, erro), as
Cartas e os resultados de vistoria **sem pista no assunto** (e os e-mails que o texto
não identificou) ficam em `a_tentar_de_novo`, sem PDF anexado, até a leitura voltar. É
o esperado, e não é defeito. **Não esperam** os e-mails que o texto achou **e**
classificou (anexam sem leitura e sem a trava, como antes) nem as regras com `ler_pdf =
false`. (2) O sino que nasce da classificação **por texto** (assunto e corpo) não
espera a IA: os avisos de 30 dias podem tocar mesmo com a leitura fora do ar.

**Decisão do usuário (opcional, não implementada):** para a primeira leitura **não
tocar sino de e-mail com mais de N dias** (a "vistoria virtual aprovada" de três
semanas atrás de um projeto cujo relógio já foi pedido não deveria acordar 6 pessoas).
Seria uma mudança no robô — o corte por `recebido_em` na hora de avisar —, com N a
escolher (7 dias, por exemplo, cobre "só o que chegou esta semana"). Sem a decisão,
vale o que está acima: avise a equipe e marque como lidos depois. Se a decisão for por
implementar, é **antes** do primeiro run: depois dele os 30 dias já tocaram.

Depois, se for o caso, marque como lidos os sinos do run (nunca se apagam):

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

- **Parar já** (o freio de emergência — fora disto a conta fica **ligada**). Desliga a
  conta e cancela o que está na fila. O robô só pega run de conta **ligada**. Um run
  que já está `rodando` **não para** por aqui — termina
  sozinho. Para pará-lo é preciso parar o serviço na VPS, e isso tem **três tempos**,
  porque o serviço é o mesmo da CPFL:

  ```sql
  -- /tmp/parar.sql
  UPDATE public.portal_accounts SET enabled = false WHERE connector = 'enel' RETURNING id, enabled;
  UPDATE public.portal_sync_runs s
     SET situacao = 'erro', erro = 'Cancelado à mão antes de começar.', terminado_em = now()
    FROM public.portal_accounts a
   WHERE a.id = s.account_id AND a.connector = 'enel' AND s.situacao = 'na_fila'
  RETURNING s.id, s.situacao;
  ```

  1. `sudo systemctl stop ludmilla-worker` (na VPS, porta 22022) — para o run em
     andamento, e **também a CPFL**;
  2. marque o run interrompido como `erro` (ele ficaria `rodando` para sempre):

     ```sql
     -- /tmp/marcar-run-como-erro.sql — só o run que ficou "rodando" depois do stop
     UPDATE public.portal_sync_runs s
        SET situacao = 'erro', erro = 'Interrompido à mão (serviço parado).', terminado_em = now()
       FROM public.portal_accounts a
      WHERE a.id = s.account_id AND a.connector = 'enel' AND s.tipo = 'varredura_email'
        AND s.situacao = 'rodando'
     RETURNING s.id, s.tipo, s.situacao;
     ```

     (se o stop pegou um run da CPFL no meio, marque o dela igual: tire o filtro
     `a.connector = 'enel'` e confira antes com um `SELECT` de quem está `rodando`);
  3. **`sudo systemctl start ludmilla-worker`** — **não esqueça**: sem isto o serviço
     fica parado e **a CPFL para de ser varrida** (os crons de 8h e 17h enfileiram e
     ninguém pega). Confira com `systemctl is-active ludmilla-worker` (`active`).

  Para **religar a ENEL** depois da emergência: primeiro cancele o que ficou na fila
  (`cancelar-fila-da-enel.sql`, do passo 0), depois `UPDATE public.portal_accounts SET
  enabled = true WHERE connector = 'enel'`.

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
- **"Ler de novo" numa mensagem que já abriu cartão — regra só se o pré-voo vier
  `false`.** A migração `20261022120000` **está aplicada** (conferido em 22/10), então,
  com o pré-voo em `tem_recebido_no_raw = true`, a releitura que achar **outro projeto**
  abre um cartão **novo** para o outro projeto e o primeiro fica intacto: **não há regra
  a seguir**. Só se o pré-voo vier `false` (a migração não está lá) vale o que o C-1 da
  revisão final achou: a chave da mensagem da ENEL é fixa (`''`) e a releitura que
  achar outro projeto reescreve o cartão pendente do primeiro, e o "Aplicar" grava
  etapa e protocolo **no projeto errado**. Nesse caso, **ignore o cartão pendente ANTES
  de clicar em "Ler de novo"** — e aplique a migração.
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
