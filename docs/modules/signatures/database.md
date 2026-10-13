# Assinatura digital — Banco de Dados

Migrações em `supabase/migrations/`, todas de 03/10/2026:

| Arquivo | O que traz |
|---|---|
| `20261003100000_assinatura_fundacao.sql` | catálogo, certificado, `assinaturas`, RLS, bucket `certificados`, `certificado_cadastrar`/`_do_robo`/`_conferido`, código de verificação |
| `20261003110000_assinatura_fluxo.sql` | `assinatura_pedir`/`aprovar`/`recusar`/`claim`/`passo`/`liberar`/`registro`, índice de pedido único |
| `20261003120000_assinatura_ze_e_vencimento.sql` | pendência `liberar_assinatura`, outbox `ze_recados`, resolver reescrito, vencimento do certificado, crons |
| `20261003130000_documento_para_assinar.sql` | a porta da assinatura e o **privilégio por coluna em `documents`** |
| `20261003140000_assinatura_claim_company.sql` | `assinatura_claim` passa a devolver `company_id` |

Toda função é `SECURITY DEFINER SET search_path = ''`, com
`REVOKE ALL … FROM PUBLIC, anon` e `GRANT` explícito. **`anon` não executa
nenhuma função do módulo.**

## Tabelas

Todas com RLS: `tenant_isolation` **RESTRICTIVE** (padrão da casa) + uma policy
permissiva **só de SELECT** para admin/staff do tenant `is_library`
(`assinatura_equipe_ok()`; no `ze_recados`, `ze_admin_ok()`). Não existe policy
de INSERT/UPDATE: **a escrita é só pelas funções**. Como defesa em
profundidade, `INSERT/UPDATE/DELETE` foi revogado de `anon` e `authenticated`
nas quatro tabelas, para que uma policy permissiva posta por engano no futuro
não abra a escrita.

### `documentos_assinaveis` — o catálogo

| Coluna | Papel |
|---|---|
| `id`, `tenant_id` | identidade e isolamento; `UNIQUE (tenant_id, codigo)` |
| `codigo` | `memorial_descritivo`, `formulario_concessionaria`, `art`, `diagrama_unifilar`, `declaracao_conformidade`, `procuracao_concessionaria` |
| `nome` | como aparece na tela |
| `origem` | `gerado` · `enviado` · `ambos` — de onde o arquivo pode vir |
| `exige_triagem` | passa pela peneira do Claudinho? |
| `ativo` | desligar um tipo sem apagar histórico |
| `created_at`, `updated_at` | |

Semeado para o tenant `is_library` com 6 tipos. **Todos exigem triagem.**
`formulario_concessionaria` chegou a ser semeado sem triagem ("é o que nós
geramos"), mas o canal "documento gerado" nunca foi construído e o tipo aparece
no seletor de upload — então um contrato enviado com esse tipo chegaria ao e-CPF
sem peneira. Corrigido em `20261003150000_assinatura_correcoes_finais.sql`; só
volta a `false` **quando esse canal existir** (a isenção pressupõe que o sistema
produziu o arquivo). `art` e `procuracao_concessionaria` são só `enviado`; os
outros são `ambos`. Mexer no catálogo é só pela função
`catalogo_assinavel_salvar` (admin) — não há tela.

### `certificados_digitais`

| Coluna | Papel |
|---|---|
| `titular_nome`, `titular_cpf` | o engenheiro (pessoa física); CPF só dígitos, 11 |
| `emissor`, `serial`, `validade_inicio`, `validade_fim` | lidos do `.pfx` pelo robô na conferência |
| `arquivo_path` | caminho no bucket `certificados` (`<tenant_id>/…`) |
| `secret_id` | id da **senha no Vault** (`vault.create_secret`) |
| `situacao` | `conferindo` · `ok` · `invalido` · `vencido` |
| `erro` | por que ficou `invalido`/`vencido`, em português |
| `ativo` | **índice único parcial**: um ativo por tenant (`certificado_ativo_unico`) |
| `avisado_em` | `DATE` — último dia em que o aviso de vencimento saiu (idempotência do cron) |
| `created_by`, `created_at`, `updated_at` | quem cadastrou |

Cadastrar um novo **desativa o anterior**. O `.pfx` e a senha antigos ficam
(bucket e Vault), inalcançáveis por `authenticated` — dívida de limpeza.

### `assinaturas` — a fila e o histórico na mesma tabela

Como `portal_sync_runs` da Ludmilla: nasce pendente e termina sendo o registro.

| Coluna | Papel |
|---|---|
| `tenant_id`, `project_id`, `document_id`, `assinavel_id` | o que foi pedido e qual tipo autorizou |
| `certificado_id`, `titular_nome`, `titular_cpf`, `serial` | **cópia** dos dados do certificado na hora do pedido (o histórico não muda se ele for trocado) |
| `pedida_por`, `pedida_em` | quem pediu |
| `aprovada_por`, `aprovada_em` | quem deu o "está certo" |
| `liberada_por`, `liberada_em` | preenchido na exceção liberada. **Quem NEGOU não aparece aqui** (fica no comentário do card) |
| `situacao` | ver a tabela de transições abaixo |
| `motivo` | o que a pessoa escreveu ao pedir (até 500) |
| `recusa` | por que foi barrado (triagem, "não" do gestor, expiração) |
| `documento_aprovado_path` | o PDF preparado que a pessoa conferiu |
| `hash_original`, `hash_aprovado`, `hash_assinado` | SHA-256 do arquivo de origem, dos bytes aprovados (o que a assinatura cobre) e do resultado |
| `documento_assinado_id` | o documento novo (`…_assinado.pdf`) |
| `codigo_verificacao` | 6 caracteres sem ambiguidade visual (sem O/0, I/1, S/5), `UNIQUE (tenant_id, codigo_verificacao)`; gerado por `assinatura_codigo_novo`, **não** por `DEFAULT` (um default aleatório sob `UNIQUE` transforma colisão em erro na cara do usuário) |
| `erro`, `tentativas`, `claim_em` | operação: último erro, tentativas **na etapa atual**, lease do robô |

Índices: `assinatura_uma_por_documento` (único parcial — **um pedido em
andamento por documento**, é a trava de verdade contra duplo clique; o `EXISTS`
em `assinatura_pedir` só dá a mensagem boa), `assinaturas_tenant_idx`,
`assinaturas_projeto_idx`, `assinaturas_fila_idx`.

### `ze_recados` — a fila de avisos do Zé (outbox)

Quem decide avisar o gestor (função do banco) só **enfileira**; o assinador, na
VPS, pega a fila e entrega pelo `ze-brain` (`modo:'recado'`). Um mecanismo só
para o "Assinei…", o "Barrei…", o "Libero?", o "não", a expiração e o aviso de
vencimento. Tabela própria, e não colunas em `ze_messages`, por menor
privilégio: `ze_messages` é a conversa **privada** do gestor e o worker do
assinador não deve lê-la.

| Coluna | Papel |
|---|---|
| `tenant_id`, `texto` (até 1200) | |
| `pendencia_id` | quando é o "Libero?" de uma pendência: ao ser entregue, carimba `perguntada_em` nela |
| `criado_em`, `claim_em`, `entregue_em`, `tentativas`, `nota` | operação e diagnóstico |

RLS: `tenant_isolation` + `admin_le` (`ze_admin_ok()`); escrita só por funções.

### Colunas novas em tabelas que já existiam

| Tabela.coluna | Papel |
|---|---|
| **`documents.assinavel_id`** | `UUID → documentos_assinaveis`, `ON DELETE SET NULL`. **É a tranca.** Só as duas funções da porta gravam |
| `concessionaire_templates.assinavel_id` | prevista na spec para o gerado por template. **Existe e está sem uso** — a integração com o Bidu não foi feita |
| `ze_pending_actions.perguntada_em` | quando o "Libero?" **chegou de fato** ao gestor. Sem isto preenchido o Zé não libera nada |
| `certificados_digitais.avisado_em` | ver acima |

`ze_pending_actions` também teve o CHECK de `tipo` ampliado para
`('mover_etapa', 'liberar_assinatura')` e ganhou o índice único parcial
`ze_pendencia_liberar_unica` (uma pendência de liberação **aberta** por
assinatura).

## Situações de `assinaturas` e quem pode movê-las

`assinatura_passo` (só robô) aceita cada situação **apenas a partir das
origens da coluna do meio**; se a linha não está numa delas (ou outra chamada
já a moveu), devolve `FALSE` e **não grava documento, comentário nem
histórico**. É isso que impede o robô de sobrescrever um `recusado` com
`assinado` — o portão humano — e dá idempotência a uma chamada repetida. As
demais transições são feitas por outras funções (coluna da direita).

| Situação | Pelo robô (`assinatura_passo`), a partir de | Por outra função |
|---|---|---|
| `preparando` | `preparando` (retry da etapa) | `assinatura_pedir` (a linha nasce aqui) |
| `conferir` | `preparando` | — |
| `triagem` | `triagem` (retry) | `assinatura_aprovar`, a partir de `conferir`, se o tipo exige triagem |
| `pendente` | `triagem`, `pendente` (retry) | `assinatura_aprovar` (de `conferir`, tipo sem triagem); `assinatura_liberar` (de `aguardando_ze`) |
| `aguardando_ze` | `triagem` | — |
| `assinando` | `pendente` — **mas o worker nunca grava `assinando`** (vai de `pendente` direto a `assinado`). Existe no CHECK e é cancelável pela tela | — |
| `assinado` | `pendente`, `assinando` (exige `file_url` e `file_name`) | — |
| `recusado` | `preparando`, `triagem`, `aguardando_ze`, `pendente`, `assinando` | `assinatura_recusar` (a pessoa, de qualquer não-terminal, inclusive `conferir` e `erro`); `assinatura_recusada_pelo_ze` (de `aguardando_ze`: o "não" ou a expiração) |
| `erro` | `preparando`, `triagem`, `pendente`, `assinando` (3ª falha) | `assinatura_claim`, ao esgotar as tentativas |

`tentativas` **zera a cada mudança de situação**: o limite de 3 vale *por
etapa*. Sem isso o caminho feliz com triagem já gastaria 3 claims. `erro` é
cancelável pela tela (`assinatura_recusar`), para a linha não bloquear o
documento para sempre.

## Funções (RPCs)

### Para a equipe — `authenticated`

Todas conferem `assinatura_equipe_ok()` (admin/staff do tenant `is_library`) e
o tenant da linha. Exceções marcadas.

| Função | Retorna | O que faz |
|---|---|---|
| `assinatura_equipe_ok()` / `assinatura_admin_ok()` | `boolean` | as duas checagens de papel (também para `service_role`) |
| `documento_para_assinar(p_project_id uuid, p_assinavel_id uuid, p_path text, p_name text, p_type text)` | `uuid` | registra o arquivo **enviado** com a marca. Recusa tipo de origem `gerado`, tipo inativo/de outro tenant, e caminho fora da pasta do projeto |
| `documento_marcar_assinavel(p_document_id uuid, p_assinavel_id uuid)` | `boolean` | marca documento **já existente** (o gerado). Recusa tipo de origem `enviado`; confere o caminho da mesma forma. **Nenhuma tela a chama hoje** |
| `assinatura_pedir(p_project_id uuid, p_document_id uuid, p_assinavel_id uuid, p_motivo text default null)` | `uuid` | **a tranca**: projeto vivo do tenant · tipo ativo · documento do projeto **com a marca do mesmo tipo** · certificado `ok` e dentro da validade · sem pedido em andamento |
| `assinatura_aprovar(p_id uuid)` | `text` (`'triagem'`\|`'pendente'`) | o "está certo"; só a partir de `conferir` |
| `assinatura_recusar(p_id uuid, p_motivo text default null)` | `boolean` | cancela/recusa; fecha também a pendência do Zé, se houver. **Não** grava comentário nem histórico (diferente do `passo('recusado')`) |
| `assinatura_liberar(p_id uuid, p_autor uuid default null)` | `boolean` | `aguardando_ze` → `pendente`, grava `liberada_por`. **Pela tela: só admin, no próprio tenant.** Também concedida a `service_role` (caminho do Zé), onde `p_autor` tem de ser admin do tenant **da linha** |
| `assinatura_registro(p_limite int default 100)` | tabela de 17 colunas | o extrato da página (máx. 500) |
| `certificado_cadastrar(p_path text, p_senha text, p_titular_nome text, p_titular_cpf text)` | `uuid` | **só admin**. O caminho tem de estar na pasta do tenant; a senha vai ao Vault; o anterior é desativado; nasce `conferindo` |
| `catalogo_assinavel_salvar(p_codigo, p_nome, p_origem default 'ambos', p_exige_triagem default true, p_ativo default true)` | `uuid` | **só admin**; upsert por `(tenant, codigo)` |
| `assinatura_caminho_erro(p_path text, p_company uuid, p_project uuid)` | `text` | função pura (`IMMUTABLE`): devolve `NULL` se o caminho é válido, ou a recusa. Ver [RN-ASS-04](business-rules.md) |
| `ze_resolver_pendencia(_id uuid, _confirmar boolean, _como_usuario uuid default null)` | `jsonb` | já existia (`mover_etapa`); reescrita para `liberar_assinatura`. Ver [Zé](../ze/overview.md) |

### Só o robô — `service_role`

`authenticated` **não alcança** nenhuma destas — em particular, não alcança a
senha do certificado. Todas checam `auth.role() = 'service_role'` por dentro.

| Função | Retorna | O que faz |
|---|---|---|
| `certificado_do_robo(p_id uuid)` | `arquivo_path, senha, titular_cpf, titular_nome` | **o único caminho de leitura da senha** (Vault decifrado). Só do certificado `ativo` |
| `certificado_conferido(p_id, p_situacao, p_emissor, p_serial, p_inicio date, p_fim date, p_erro, p_titular_nome)` | `boolean` | o robô grava o resultado da conferência. **`p_titular_nome` é o nome lido do `.pfx` e sobrescreve o digitado** (é ele que a assinatura usa; sem nome, mantém o que está) |
| `assinatura_claim()` | 18 colunas (inclui `company_id`, `cidade`, `file_*`) | pega o próximo trabalho: `FOR UPDATE SKIP LOCKED`, **lease de 10 min**, até 3 tentativas por etapa; quem esgotou vai para `erro`. Devolve `company_id` porque a policy do bucket `project-documents` exige a **empresa** como 1º segmento do caminho (não o tenant) |
| `assinatura_passo(p_id uuid, p_situacao text, p_campos jsonb default '{}')` | `boolean` | devolve o passo, com a tabela de transições. Ao chegar em `assinado`: insere o documento novo, comenta no card, escreve em `project_history` e **insere uma notificação (sino) para cada admin do tenant** (em sub-bloco: falha de aviso não desfaz a assinatura). **`FALSE` = pare e não publique o resultado** |
| `assinatura_codigo_novo(_tenant uuid)` | `text` | 6 caracteres, até 50 tentativas até achar um livre |
| `assinatura_pedir_ao_ze(p_id uuid)` | `uuid` | abre a pendência `liberar_assinatura` (uma por assinatura; advisory lock + índice único) e enfileira o "Libero?". É um invólucro (checa `service_role`) sobre `assinatura_pedir_ao_ze_interno`, que o cron também chama (sem JWT) para **reabrir a pergunta** de quem ficou em `aguardando_ze` há mais de 15 min sem pendência |
| `ze_recado_enfileirar(_tenant uuid, _texto text, _pendencia uuid default null)` | `uuid` | só enfileira se o tenant **tem Zé ligado** |
| `ze_recados_pendentes()` | `id, tenant_id, texto` | o worker pega até 10 recados |
| `ze_recado_entregue(_id uuid, _ok boolean)` | `boolean` | fecha o recado; se era o "Libero?", carimba `perguntada_em` |

**Espera crescente dos recados:** `2 min × 2^tentativas`, teto de 60 min, até 8
tentativas (≈ 4 h no total). A tentativa é contada **ao pegar**, para que um
envio que saiu mas cuja marcação falhou não repita o aviso sem parar. Recado com
mais de **20 h** é descartado ("vence em 7 dias" chegando dias depois é pior que
não chegar — o sino continua). O "Libero?" cuja pendência já foi decidida
também é descartado.

### Internas — sem `GRANT` para ninguém

Chamadas por outras funções `SECURITY DEFINER` ou pelo cron:
`certificados_avisar_vencimento()`, `ze_expirar_pendentes()`,
`assinatura_recusada_pelo_ze(p_id, p_tenant, p_motivo, p_autor)`,
`assinatura_pendencia_expirou(p_tenant, p_assinatura)`,
`assinatura_rotulo(p_id)`, `ze_texto_limpo(_t, _max)`.

`ze_texto_limpo` deixa o texto de fora em **uma linha, sem aspas, crase nem
`<>`** e com tamanho limitado. Nome de arquivo e motivo da triagem vêm de
terceiros (a IA leu o PDF de um cliente) e acabam no prompt do Zé. O worker tem
uma cópia espelhada, caractere por caractere (`textoLimpo`).

## O privilégio por coluna em `documents`

Esta é a peça que faz a tranca valer. Sem ela, qualquer admin/staff poderia, pelo
PostgREST, gravar `assinavel_id` num insert comum — ou marcar o contrato social —
e a regra de negócio ficaria só na tela.

```sql
REVOKE INSERT, UPDATE ON public.documents FROM authenticated, anon;
GRANT INSERT (id, project_id, document_type, file_name, file_url, file_type,
              uploaded_by, created_at) ON public.documents TO authenticated;
GRANT INSERT (id, project_id, document_type, file_name, file_url, file_type,
              created_at) ON public.documents TO anon;
```

- `assinavel_id` **fica fora dos dois `GRANT`**. O anexo comum continua entrando
  (a lista cobre tudo o que o app insere); o formulário público (`anon`) não usa
  `uploaded_by`.
- **Ninguém tem `UPDATE` na tabela, nem em coluna.** Se houvesse `UPDATE` em
  `file_url`, bastaria trocar o caminho de um documento **já marcado** para um
  arquivo que nunca passou pela porta (o contrato social, por exemplo): a marca
  seguiria valendo e `assinatura_pedir` só confere `assinavel_id`. Hoje nenhum
  código do repositório faz `UPDATE` em `documents`. **Se um dia precisar
  renomear anexo, vai por função**, não por `GRANT`.
- O `SELECT` e o `DELETE` não foram tocados — `INSERT … RETURNING` e
  `useDeleteDocument` seguem funcionando.
- As funções que gravam em `documents` são `SECURITY DEFINER` (dono `postgres`)
  e **não sofrem** o `REVOKE`: `assinatura_passo` (o assinado), `documento_*`,
  as do Bidu.
- **Armadilha para quem mexer:** uma coluna nova em `documents` precisa entrar
  nos dois `GRANT INSERT`, senão o upload comum passa a falhar com
  `permission denied`.

## Storage

| Bucket | Regra |
|---|---|
| **`certificados`** | privado, 5 MB, só MIME de PKCS#12. **Nenhuma policy de leitura.** Existe **uma** policy, de `INSERT` (`certificado_admin_sobe`): admin, na pasta do próprio tenant (`<tenant_id>/…`). Sem `SELECT`/`UPDATE`/`DELETE` — **nem o admin baixa o `.pfx` de volta**; só o `service_role` do robô o alcança. O upload funciona só com `INSERT`, como a Ludmilla já faz com os prints |
| `project-documents` | o que a assinatura grava segue a convenção da casa `<company_id>/<project_id>/assinatura/…`: envio da pessoa (`{Date.now()}_{nome}`), PDF preparado (`{id}_para_assinar.pdf`) e assinado (`{id}_{uuid}_{nome}`) |

O primeiro segmento é o id da **empresa** (`companies.id`), não o do tenant: é o
que a policy de leitura/escrita de `project-documents` exige. Um caminho com o
tenant faria o upload funcionar (o robô ignora RLS) e a **equipe não conseguiria
abrir o PDF preparado** para dar o "está certo" — foi um defeito do plano
original, corrigido na Task 5.

## Jobs (`pg_cron`)

| Job | Agenda | O que faz |
|---|---|---|
| `certificado-vencimento` | `0 10 * * *` (10:00 UTC = 07:00 em Brasília) | `certificados_avisar_vencimento()`: avisa em **30, 15, 7, 1 e 0 dias** antes de `validade_fim` (sino para os admins + recado do Zé); idempotente via `avisado_em`; só certificado `ok` avisa. Também move para `vencido` quem passou da validade |
| `ze-expirar` | `0 * * * *` (de hora em hora) | `ze_expirar_pendentes()`: pendência de 24 h vira `expirada` **e a assinatura vira `recusado`** com comentário no card e recado. Era diário às 04:00; a pendência vive 24 h, não ~48. Depois disso, **reabre a pergunta** de toda assinatura em `aguardando_ze` há mais de 15 min sem pendência aberta (cada reabertura em sub-bloco: se falhar, tenta no ciclo seguinte) |

## O que o `ze_resolver_pendencia` exige para liberar

Pelo Zé (ou seja, sem sessão de usuário), liberar uma assinatura exige **as duas**:

1. `perguntada_em` preenchido — o "Libero?" **chegou** ao gestor;
2. existe mensagem `papel = 'user'` em `ze_messages` **posterior** a essa pergunta.

É regra do banco, não do prompt: o prompt do Zé carrega nome de arquivo e
motivo escritos por terceiros, e se o modelo for enganado o banco ainda não
deixa liberar sem a palavra do gestor. A conferência de tenant usa
`IS DISTINCT FROM` (não `<>`): `get_user_tenant_id` devolve `NULL` para tenant
sem acesso, e `NULL <> x` é `NULL` — o `IF` nunca disparava. O mesmo bug foi
corrigido em `ze_aceitar_tarefa_sugerida` e `ze_recusar_tarefa_sugerida`.
