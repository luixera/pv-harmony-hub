# Primeiro run da EDP por e-mail — roteiro

> Escrito em 11/10/2026, com a entrega pronta e **não publicada** (decisão do
> usuário: esperar a frente de assinatura digital fechar, porque os commits dela
> estão no mesmo branch e há trabalho não commitado nos arquivos que ela toca).
>
> Este run é **manual e acompanhado**, por decisão. Ele é o primeiro exercício
> real do caminho inteiro: IMAP de verdade, edge function de verdade, RPCs de
> verdade, e escrita em **cards de projeto de clientes reais**.

Contexto do módulo: [docs/modules/integrations/ludmilla.md](../modules/integrations/ludmilla.md)
(seção "Acompanhamento por E-MAIL"). Spec:
[2026-10-02-ludmilla-edp-email-design.md](specs/2026-10-02-ludmilla-edp-email-design.md).

---

## 1. Antes de qualquer coisa — a ordem importa

> **Já está no banco, antes do push** (12/10/2026): a migração
> `20261012120000_ludmilla_email_rodada3.sql` (recomendação nunca rebaixada,
> chave do anexo com ocorrência, `ludmilla_email_anexo_novo` com `abertura`) e a
> `ludmilla-parecer` com os marcadores por frase (versão 12). O código do robô só
> sobe no push; o robô antigo da VPS não tem o run de e-mail, então nada chama as
> funções novas antes disso.

**Publicar primeiro, rodar depois.** Se o run vier antes do deploy, ele toma 401
na leitura do parecer, porque o segredo que a função usa para reconhecer o robô é
definido pelo `deploy.yml`.

```bash
git push origin main
```

Isso dispara o `deploy.yml`, que: publica as edge functions (entre elas a
`ludmilla-parecer`, com `--no-verify-jwt`), **define o segredo
`LUDMILLA_WORKER_KEY`** a partir do mesmo segredo do GitHub que o worker usa, e
sobe o front novo (a tela com o cartão da EDP).

Depois, o robô em si — é outro workflow:

```bash
gh workflow run ludmilla-worker.yml
```

Confira que o deploy do worker terminou bem antes de seguir. O `instalar.sh`
roda `npm ci --omit=dev` com o `package.json` copiado, e `imapflow` e
`mailparser` estão em `dependencies` e no lockfile — então chegam à VPS.

## 2. Pré-voo (conferido em 09/10, refazer se demorar)

```sql
-- /tmp/pre-voo.sql
-- A guarda de service_role de ludmilla_email_protocolos faz ela devolver 0 pelo
-- CLI, então a contagem de protocolos é replicada sem a guarda.
WITH ativos AS (
  SELECT p.id,
         regexp_replace(ltrim(regexp_replace(p.protocol_number, '\D', '', 'g'), '0'), '^$', 'x') AS chave
    FROM public.portal_accounts a
    JOIN public.projects p
      ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
   WHERE a.acompanhamento = 'email' AND a.connector = 'edp'
     AND NOT p.is_deleted AND p.archived_at IS NULL
     AND p.status::text <> 'completed'
     AND coalesce(p.protocol_number, '') <> ''
), unicos AS (SELECT chave FROM ativos GROUP BY chave HAVING count(*) = 1)
SELECT
  (SELECT count(*) FROM ativos t JOIN unicos u ON u.chave = t.chave) AS a_procurar,
  (SELECT count(*) FROM public.portal_email_regras r
     JOIN public.portal_accounts a ON a.id = r.account_id
    WHERE a.connector = 'edp' AND r.ativo)                           AS regras_ativas,
  (SELECT count(*) FROM public.portal_email_mensagens)               AS mensagens_ja_lidas,
  (SELECT count(*) FROM public.portal_sync_runs
    WHERE situacao IN ('na_fila','rodando'))                         AS runs_abertos;
```

Esperado em 09/10: `a_procurar = 8`, `regras_ativas = 3`,
`mensagens_ja_lidas = 0`, `runs_abertos = 0`.

**Crédito na Anthropic**: recarregado em 07/10. Sem crédito, a leitura do parecer
volta `ok:false` — o PDF é anexado de todo jeito, mas **nenhuma recomendação de
etapa sai**, e a mensagem fica para ser tentada de novo (até 5 vezes).

## 3. Disparar o run

Dois caminhos, mesmo efeito. **Escolha um** — não faça os dois.

**Pela tela** (`/ludmilla`): "Verificar agora" no cartão da EDP. Atenção: esse
botão está ligado de verdade; o primeiro clique nele **é** o primeiro run.

**Por SQL**, se preferir controlar o momento:

```sql
-- /tmp/primeiro-run.sql
INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo, situacao)
SELECT a.tenant_id, a.id, 'varredura_email', 'na_fila'
  FROM public.portal_accounts a
 WHERE a.connector = 'edp' AND a.acompanhamento = 'email'
RETURNING id;
```

O worker pega da fila pelo `ludmilla_claim_run`. Rodar duas vezes enfileira dois
runs — por isso o `runs_abertos = 0` do pré-voo.

## 4. O que olhar quando terminar

```sql
-- /tmp/confere-run.sql
SELECT s.situacao, s.protocolos_lidos, s.mudancas,
       s.erro,
       s.resultado->>'lidos'              AS lidos,
       s.resultado->>'anexados'           AS anexados,
       s.resultado->>'bloqueados'         AS bloqueados,
       s.resultado->>'imagens_ignoradas'  AS imagens_ignoradas,
       s.resultado->>'sem_dono'           AS sem_dono,
       s.resultado->>'anexos_de_outro_protocolo' AS anexos_de_outro_protocolo,
       s.resultado->>'anexos_recusados'   AS anexos_recusados,
       s.resultado->>'anexos_sem_nome'    AS anexos_sem_nome,
       s.resultado->>'a_tentar_de_novo'   AS a_tentar_de_novo,
       s.resultado->>'nao_lidas'          AS nao_lidas,
       s.resultado->>'falhas_busca'       AS falhas_busca,
       s.resultado->>'falhas_tratamento'  AS falhas_tratamento,
       age(s.terminado_em, s.iniciado_em) AS duracao
  FROM public.portal_sync_runs s
 WHERE s.tipo = 'varredura_email'
 ORDER BY s.pedido_em DESC LIMIT 1;
```

E, mensagem por mensagem:

```sql
-- /tmp/confere-mensagens.sql
SELECT m.protocolo, p.code AS projeto, m.tipo_documento, m.veredito,
       m.anexos, m.concluida, m.tentativas, m.arquivo_lido,
       coalesce(m.motivo, '') AS motivo
  FROM public.portal_email_mensagens m
  LEFT JOIN public.projects p ON p.id = m.project_id
 ORDER BY m.created_at DESC LIMIT 20;
```

### Os números que decidem se o automático é confiável

| O que | Por que importa |
|---|---|
| **`bloqueados`** | parecer que a robô **recusou** anexar por divergência de nome do titular. É o único bloqueio do fluxo, e **nunca rodou contra um PDF real**. Se vier alto, abra as mensagens e veja se a divergência é real ou se é a IA lendo mal o nome |
| **`imagens_ignoradas`** | a robô não anexa imagem (é quase sempre logo de assinatura). Se uma concessionária mandar documento **escaneado**, este contador é o único lugar onde isso aparece |
| **`sem_dono`** | **mensagens** em que nenhum arquivo é seguramente deste protocolo: o e-mail cita **mais de um** protocolo e nenhum nome traz o número deste, **ou** todos os nomes trazem o número de **outro** protocolo. A robô **não anexou nada** e não chamou a IA. Cada linha tem o `motivo` ("confira à mão") — anexe à mão. A tela não mostra este contador; as linhas aparecem em "Terminei, mas com um porém" |
| **`anexos_de_outro_protocolo`** | **arquivos** (não mensagens) que a robô **não pôs neste card** porque o nome traz o número de um protocolo que o e-mail não serve. Pode ser > 0 sem `sem_dono`: o arquivo genérico do mesmo e-mail foi anexado e só o de outro ficou de fora (o `motivo` da linha cita o nome). Não conta a divisão normal de e-mail com dois protocolos **nossos**. Se vier > 0, abra a linha: o parecer de outro cliente estava na caixa e a robô acertou em não anexá-lo — mas alguém precisa levar o arquivo ao card certo à mão se o protocolo dele for nosso |
| **`anexos_recusados`** | arquivo que o bucket não aceita (p7s, dwg, zip, acima de 10 MB): ignorado, não é falha. O nome e a razão estão no `motivo` da mensagem. Se vier um PDF legítimo acima de 10 MB, é decisão de produto aumentar o limite do bucket |
| **`anexos_sem_nome`** | anexo sem nome de arquivo (não dá para identificar nem anexar). Normalmente 0 |
| **`a_tentar_de_novo`** | mensagens que ficaram para a próxima (IA falhou, anexo não subiu). Normal ser > 0; preocupante é ficar igual run após run |
| **`nao_lidas`** | corpo de e-mail que não parseou. Condição permanente — não entra em `falhas` de propósito |
| **`duracao`** | até 80 buscas IMAP em sequência. Se passar de alguns minutos, medir antes de agendar |
| **`imap-uid-` no log** | envelope sem `Message-ID`: o uid vira o id do dedupe, e se a caixa for recriada a mensagem é tratada de novo |

### E o mais importante: abrir os cards

Dois ou três projetos que receberam anexo. Conferir **na mão**:

1. o PDF que chegou é o parecer **daquele** projeto;
2. o comentário no card diz **"emitido pela EDP"** (não CPFL) e diz a verdade
   sobre o que foi conferido;
3. a recomendação de etapa faz sentido para o que o parecer diz;
4. nenhuma imagem de assinatura virou documento do projeto.

Nada disso é automatizável, e é a razão de o primeiro run ser acompanhado.

## 5. Se algo der errado

- **401 na leitura do parecer** → o segredo `LUDMILLA_WORKER_KEY` não foi
  definido: o `deploy.yml` não rodou, ou rodou sem o segredo do GitHub.
- **"Esta concessionária não tem regras de e-mail cadastradas"** → a semente das
  3 regras não está lá; cadastre pela tela.
- **"O acesso à caixa não está configurado"** → `agent_config` do tenant sem
  `gmail_email` / `gmail_app_password`.
- **Mensagem travada** (`concluida = false`, `tentativas = 5`) → a tela mostra em
  destaque; "Ler de novo" zera o contador e a robô volta nela.
- **Anexo no card errado** → pare o agendamento, não enfileire outro run, e
  guarde o `id` da mensagem e do anexo. Isso não deveria acontecer (chave com
  protocolo + guarda de projeto + arquivo escolhido pelo número no nome quando o
  e-mail cita vários protocolos), e se acontecer é um achado grave. Os dois casos
  que a regra **não** cobre estão em "Lacunas conhecidas do E1" na doc do módulo:
  assunto com dois protocolos em que só um é nosso, e arquivo com o número de
  outro projeto nosso num e-mail de um protocolo só.

**Não agende nada** (cron) antes de olhar os números e os cards deste primeiro
run.

## 6. Pendências pequenas, para depois do primeiro run

Estão no item 0 de "Próximos" na doc do módulo:

- o `motivo` mostra "o robô começou a tratar esta mensagem" enquanto o tratamento
  corre, e **permanentemente** se o robô morrer no meio — trocar por um texto que
  diga que começou e **não terminou**;
- guarda em `(p_resultado->>'falhas')::int` dentro de
  `ludmilla_finalizar_run_impl`: valor não numérico levanta exceção e o run não
  fecha (hoje só o nosso worker escreve ali);
- os contadores do cartão são só do **último** run;
- não há "Ler de novo" em lote;
- o grupo "não reconheci" não oferece criar a regra a partir do assunto.

E dois fatos de dado, não defeitos: **2 projetos ativos da EDP estão sem número
de protocolo** (não há o que buscar, ficam fora da automação até ganharem
protocolo), e o portal da EDP e o pedido de vistoria continuam **fora do escopo**,
por decisão.
