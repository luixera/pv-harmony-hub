# Assinatura digital dentro do GD Manager

> Decidido com o usuário em 02/10/2026. Certificado **A1** (`.pfx`) guardado no
> sistema, assinatura **PAdES** feita por um worker na VPS (abordagem **A**),
> quem assina são **staff e admin** com registro, e o **Zé** avisa toda
> assinatura e autoriza as exceções pelo WhatsApp.
>
> Revisada em 03/10/2026 depois de provar a cadeia de assinatura numa bancada
> (ver §5): a estampa passou para o passo que a pessoa confere, a assinatura
> virou *append* puro sobre os bytes aprovados, e as telas saíram de `/painel`
> (master da plataforma) para uma rota própria `/assinaturas`.

## Por que

O gestor está contratando alguém para o operacional. Hoje, quando um projeto
precisa de documento assinado, a assinatura sai do GD Manager: vai pro Gov.br
ou pro programa do certificado digital, volta como arquivo e sobe como anexo.
Com mais gente na operação isso fica caro de controlar — ninguém sabe o que foi
assinado, por quem, com qual certificado, e nada impede que o certificado do
engenheiro seja usado em documento que não é de projeto.

A assinatura passa a morar no sistema, com três garantias: **só documento de
projeto é assinável**, **toda assinatura fica registrada**, e **o gestor é
avisado sempre**.

## 1. O que pode ser assinado — a tranca

Esta é a parte que o usuário mais pediu ("disponibilizar essas assinaturas
apenas para os documentos cadastrados") e é a que precisa ser **determinística**.

Hoje todo arquivo de projeto cai em `documents` com um `document_type` do enum:
`holder_document`, `social_contract`, `power_of_attorney`, `cnpj_card`,
`energy_bill_generator`, `extra_attachment`… — e o que o Bidu gera entra como
`extra_attachment`, igual a qualquer anexo solto. **O tipo, sozinho, não
distingue "memorial do projeto" de "contrato comercial".**

Então a regra é a porta de entrada:

> **Só é assinável o documento que entrou pelo fluxo de assinatura, com um tipo
> escolhido do catálogo de documentos assináveis.**

Um contrato social sobe pela aba de anexos como sempre e nunca recebe essa
marca: não aparece botão de assinar, e a RPC recusa mesmo que alguém a chame na
mão. Não existe caminho em que "documento sem cunho de projeto" chegue ao
certificado por engano.

Três condições, todas verificadas no banco pela RPC (não na tela):

1. o documento pertence a um projeto vivo do tenant de quem pede
   (`documents.project_id` → `projects` não apagado, `tenant_id` igual);
2. `documents.assinavel_id` aponta para uma linha **ativa** de
   `documentos_assinaveis` do mesmo tenant;
3. o arquivo é PDF na hora de assinar (ver §4 — conversão é passo separado).

## 2. Dados

### `documentos_assinaveis` — o catálogo

| Coluna | Papel |
|---|---|
| `id`, `tenant_id` | identidade e isolamento (RLS RESTRICTIVE, padrão da casa) |
| `codigo` | `memorial_descritivo`, `formulario_concessionaria`, `art`, `diagrama_unifilar`, `declaracao_conformidade`, `procuracao_concessionaria`… único por tenant |
| `nome` | como aparece na tela |
| `origem` | `gerado` · `enviado` · `ambos` — de onde o arquivo pode vir |
| `ativo` | desligar um tipo sem apagar histórico |
| `exige_triagem` | se passa pela peneira do Claudinho (padrão: `true` para `enviado`, `false` para `gerado`) |
| `created_at`, `updated_at` | padrão da casa |

Semeado na migração com os tipos acima para o tenant `is_library` (GD Manager).
Só **admin** mexe no catálogo.

### `documents` — uma coluna nova

```sql
ALTER TABLE public.documents
  ADD COLUMN assinavel_id UUID REFERENCES public.documentos_assinaveis(id) ON DELETE SET NULL;
```

Preenchida em dois casos, e só neles:

- a pessoa subiu o arquivo **pelo fluxo de assinatura**, escolhendo o tipo;
- o documento foi gerado de um template marcado como assinável
  (`concessionaire_templates.assinavel_id`, coluna nova análoga) — é o caminho
  do formulário da CEMIG/ENEL e do memorial. `bidu_anexar_documento(...)` ganha
  um parâmetro `p_assinavel_id` (opcional, `NULL` por padrão) e só o aceita se
  o template de origem tiver a marca.

Todo o resto fica `null`. O enum `document_type` não muda.

### `certificados_digitais`

| Coluna | Papel |
|---|---|
| `id`, `tenant_id` | isolamento |
| `titular_nome`, `titular_cpf` | o engenheiro responsável (pessoa física, e-CPF) |
| `emissor`, `serial` | lidos do próprio `.pfx` no cadastro, para conferência |
| `validade_inicio`, `validade_fim` | lidos do `.pfx`; base do alerta de vencimento |
| `arquivo_path` | caminho no bucket privado `certificados` |
| `secret_id` | id do segredo no **Vault** (a senha do `.pfx`) |
| `situacao` | `conferindo` · `ok` · `invalido` · `vencido` — o worker preenche na conferência (§3) |
| `ativo` | índice único parcial garante **um ativo por tenant** |
| `created_by`, `created_at` | quem cadastrou |

### `assinaturas` — a fila e o histórico na mesma tabela

Como em `portal_sync_runs` da Ludmilla: a linha nasce pendente e termina
sendo o registro histórico.

| Coluna | Papel |
|---|---|
| `id`, `tenant_id`, `project_id`, `document_id` | o que foi assinado |
| `assinavel_id` | qual tipo do catálogo autorizou |
| `certificado_id`, `titular_nome`, `titular_cpf`, `serial` | **cópia** dos dados do certificado no momento da assinatura (histórico não quebra se o certificado for trocado) |
| `pedida_por`, `pedida_em` | quem pediu |
| `liberada_por`, `liberada_em` | preenchido quando foi exceção liberada pelo Zé |
| `situacao` | `preparando` · `conferir` · `triagem` · `aguardando_ze` · `pendente` · `assinando` · `assinado` · `recusado` · `erro` |
| `motivo` | o que a pessoa escreveu ao pedir |
| `recusa` | por que foi barrado (triagem ou "não" do Zé) |
| `documento_aprovado_path` | o PDF preparado (convertido + estampado) que a pessoa conferiu |
| `hash_original`, `hash_aprovado`, `hash_assinado` | SHA-256 do arquivo de origem, dos bytes aprovados (é o que a assinatura cobre) e do resultado |
| `documento_assinado_id` | o documento novo (`..._assinado.pdf`) |
| `codigo_verificacao` | código curto estampado no PDF que permite achar a linha; único por tenant |
| `erro`, `tentativas`, `created_at`, `updated_at` | operação |

RLS: `tenant_isolation` RESTRICTIVE nas quatro tabelas; leitura para
`authenticated` do tenant; escrita só pelas RPCs.

## 3. O certificado

**Cadastro (só admin):** a tela manda o `.pfx` para o bucket privado
`certificados` e chama `certificado_cadastrar(path, senha, titular_cpf)`. A
RPC grava a senha com `vault.create_secret(...)` — exatamente o padrão de
`set_portal_credentials`. **A senha nunca é devolvida por nenhuma RPC para
`authenticated`**; só `certificado_do_robo(id)`, com `GRANT` apenas para
`service_role`, lê o segredo decifrado — igual a `ludmilla_portal_credentials`.

O bucket `certificados` nasce **sem nenhuma policy de storage**: nem admin
baixa o arquivo depois de subir. Só o service role alcança.

**Conferência.** O cadastro grava a linha em `situacao = 'conferindo'`. O laço
do worker (§5) olha primeiro os certificados nesse estado: abre o `.pfx` com a
senha do Vault, lê emissor, serial e validade, confere o CPF do titular contra
o informado e fecha em `ok`, `invalido` (senha errada, CPF divergente, arquivo
corrompido) ou `vencido`. Até sair de `conferindo`, a tela mostra "conferindo…"
e nenhuma assinatura é aceita.

**Vencimento:** job diário `certificados_avisar_vencimento()` (pg_cron) cria
notificação e manda recado do Zé em 30, 15, 7 e 1 dia antes de `validade_fim`.
Certificado vencido = assinatura recusada com motivo claro, nunca assinatura
silenciosamente inválida.

> O assistente (Claude) nunca digita nem manipula a senha do certificado — o
> usuário a informa na tela, como fez com as senhas dos portais.

## 4. O fluxo

1. **Pedir** — no modal do projeto, "Assinar documento": a pessoa escolhe um
   tipo do catálogo e o arquivo (upload novo, ou um documento já gerado que
   tenha `assinavel_id`), escreve o motivo e confirma. Staff e admin podem.
2. **Preparar — o passo que a pessoa confere.** O sistema produz o
   **PDF para assinar**: converte quando o arquivo não é PDF (planilha da
   CEMIG, `.docx` do memorial) e desenha a **estampa visível** da assinatura
   (nome, CPF mascarado, data, código de verificação). Esse PDF é mostrado na
   tela e **só entra na fila depois do "está certo"**. É assim que a fidelidade
   exigida pelo usuário fica garantida: ninguém assina uma conversão — nem uma
   estampa — que não foi olhada. O arquivo original não é tocado.
3. **Triagem** (§6) quando `exige_triagem`.
4. **Fila** — `assinatura_pedir(...)` grava `assinaturas` em `pendente`, com o
   `hash_aprovado` dos bytes que a pessoa viu.
5. **Assinar** — o worker (§5) **anexa** a assinatura aos bytes aprovados, sem
   reescrever nada: o PDF aprovado é prefixo exato do arquivo assinado
   (propriedade verificada em teste). Sobe como **documento novo**.
6. **Registrar** — `assinaturas` fechada em `assinado`, comentário no card,
   linha em `project_history`, recado do Zé.

> **Por que a estampa vem antes da assinatura.** A estampa muda o PDF; a
> assinatura só vale se nada mudar depois dela. Fazendo a estampa no passo 2 e
> a assinatura por *append* no passo 5, a conferência humana cobre tudo o que
> será assinado, e da aprovação em diante nenhum byte é reescrito.

## 5. O worker — abordagem A

`worker/assinador/`, Node 22 + TypeScript, mesmo molde do worker da Ludmilla
(systemd `gdm-assinador`, `.env` em `/etc/gdm-assinador/env`, service role que
**nunca sai da VPS**, deploy pelo GitHub Actions).

Laço: certificado em `conferindo` primeiro (§3), depois
`assinatura_claim()` (RPC só para `service_role`, `FOR UPDATE SKIP LOCKED`,
marca `assinando`) → trabalha → `assinatura_finalizar(...)`.

Por assinatura:

1. baixa o PDF **aprovado** e confere `hash_aprovado` — se o arquivo mudou
   depois do "está certo", recusa;
2. baixa o `.pfx` do bucket `certificados` e lê a senha por
   `certificado_do_robo` — **em memória, nunca em disco**;
3. valida o certificado: validade e CPF do titular;
4. anexa a assinatura **PAdES** com `plainAddPlaceholder` +
   `@signpdf/signer-p12` — *append* puro, sem reescrever o PDF;
5. confere que os bytes aprovados são prefixo do assinado e que o resultado
   abre com a mesma contagem de páginas;
6. sobe `<<nome>>_assinado.pdf`, registra o documento novo com o mesmo
   `project_id` e o `assinavel_id` do pedido, e fecha a linha.

Erro em qualquer passo: `situacao = 'erro'`, mensagem legível na tela, até 3
tentativas; o original nunca é tocado.

**Preparo** (conversão `soffice --headless --convert-to pdf` + estampa com
`pdf-lib`, salvo com `useObjectStreams: false` para o PDF ficar com tabela xref
clássica) roda no mesmo worker, no passo 2 do fluxo — antes da fila, para a
pessoa conferir. O worker nunca prepara e assina no mesmo salto sem o "está
certo".

> **Armadilha confirmada em teste (03/10/2026):** `plainAddPlaceholder` não lê
> PDF com *xref stream* — falha com "Expected xref at NaN". Por isso o preparo
> grava com `useObjectStreams: false`. Com isso a cadeia foi provada
> ponta a ponta: `.pfx` gerado no teste → estampa → assinatura → bytes
> aprovados são prefixo exato do assinado, `/ByteRange` presente, páginas
> preservadas.

## 6. A peneira do Claudinho

Edge function `assinatura-triagem` (Deno, Anthropic, `max_tokens: 16000` pela
regra da casa): recebe o **próprio PDF em base64** como bloco `document` — o
mesmo caminho do `datasheet-extract`, sem extrair texto no front — e devolve
`{ veredito: 'projeto' | 'nao_projeto' | 'duvida', motivo }`. Arquivo acima de
10 MB vai direto para `aguardando_ze` em vez de ser enviado.

- `projeto` → segue para a fila;
- `nao_projeto` → **barra**: `situacao = 'recusado'`, `recusa` com o motivo,
  comentário no card;
- `duvida` → `aguardando_ze` (§7).

Duas regras que importam:

- **a triagem nunca é a única tranca.** A tranca é o catálogo (§1). A triagem
  pega o caso de alguém cadastrar um contrato escolhendo o tipo "memorial";
- **falha fechada.** IA fora do ar, resposta cortada ou JSON inválido ⇒ o
  pedido vai para `aguardando_ze`, nunca para `pendente`.

Documento gerado pelo próprio sistema a partir de template (`origem: 'gerado'`)
não passa por triagem — nós o produzimos.

## 7. O Zé

O Zé já tem o que é preciso: fala **só** com o gestor no chat "Você", nunca com
terceiros, e já sabe pedir confirmação antes de escrever
(`ze_pending_actions`).

**Avisa sempre.** Modo novo `modo: 'recado'` na edge function `ze-brain`: envia
um texto pronto, **sem chamar o modelo** (custo zero de IA, texto
determinístico). Chamado pelo worker ao fechar cada assinatura:

> Assinei o Memorial do PRJ-78930 (Eliana de Freitas) com o e-CPF do João,
> 14:32. Código AX7F2.

**Autoriza a exceção.** `assinaturas` em `aguardando_ze` cria uma
`ze_pending_actions` do tipo novo `liberar_assinatura` (hoje o CHECK só aceita
`mover_etapa`), com o resumo:

> A Fernanda quer assinar "contrato-ourosolar.pdf" no PRJ-78930 — não tem cara
> de documento de projeto. Libero?

"pode" → `ze_resolver_pendencia(id, true)` chama
`assinatura_liberar(assinatura_id, autor)`, que grava `liberada_por` e manda
para a fila. "não" → `recusado`, com o motivo no card. Expira em 24 h pelo
`ze_expirar_pendentes()` que já existe; **expirado = recusado**.

O Zé não assina por iniciativa própria, não libera sozinho, e não fala com
ninguém além do gestor.

## 8. Telas

**Página `/assinaturas`** (rota nova, `admin` + `staff`, no molde de
`/ludmilla` — **não** em `/painel`, que é exclusivo do master da plataforma e
não serve ao admin do tenant):
- cadastro do certificado, **só visível para admin**: titular, CPF, emissor,
  serial, validade com selo de "vence em 23 dias", trocar e desativar;
- **extrato de assinaturas** do tenant, no modelo do registro da Ludmilla: o
  que foi assinado, projeto, quem pediu, quem liberou, certificado, situação,
  link para o assinado e para o original;
- fila de "conferir": os PDFs preparados esperando o "está certo".

**Modal do projeto — aba "Assinaturas"** (no `TABS` de `ProjectModal`, com o
mesmo recorte do Bidu)
- botão "Assinar documento" (staff e admin), com o seletor do catálogo;
- lista do que já foi assinado no projeto, com código de verificação;
- pedido barrado aparece com o motivo, sem esconder a recusa.

**Aba de anexos:** nada muda. Documento sem `assinavel_id` não ganha botão.

## 9. Segurança

- `.pfx` em bucket sem policy; senha só no Vault; leitura só por
  `service_role`; service role só na VPS.
- Todas as RPCs `SECURITY DEFINER SET search_path = ''`, `REVOKE ... FROM
  PUBLIC, anon`, com `GRANT` explícito.
- Isolamento de tenant RESTRICTIVE nas quatro tabelas novas; a RPC de pedido
  confere o tenant do projeto antes de qualquer coisa.
- O original nunca é sobrescrito nem apagado; o assinado é documento novo.
- `hash_aprovado` conferido na hora de assinar: se o arquivo mudou entre o
  "está certo" e a assinatura, recusa.
- Liberado primeiro só para o tenant `is_library` (GD Manager), como Bidu,
  Ludmilla e Zé.

> **Decisão consciente registrada:** o staff assina com o e-CPF do engenheiro
> responsável — é o que a operação exige e o que o usuário escolheu. O controle
> não é impedir, é **rastrear**: catálogo fechado, recado do Zé em toda
> assinatura, exceção só com "pode" do gestor, e extrato com quem pediu e
> quando. Quem usa a conta de staff responde pelo que assinou em nome do
> engenheiro.

## Fora do escopo

Gov.br (não há API pública para assinar em nome de terceiro), certificado A3
(token/cartão, exige a máquina física), mais de uma assinatura no mesmo PDF
(cosign), carimbo do tempo de ACT pago, e validação de assinatura de terceiros
em documentos recebidos.

## Como se prova

- **banco:** migração + RLS testadas por impersonação dentro de
  `begin; … rollback;` — staff do tenant A não vê assinatura do tenant B;
  `authenticated` não lê a senha do Vault; `assinatura_pedir` recusa documento
  sem `assinavel_id`, de projeto apagado, de outro tenant e com certificado
  vencido;
- **triagem:** testes vitest da função que interpreta o veredito, incluindo
  resposta cortada e JSON inválido ⇒ `aguardando_ze`;
- **worker:** testes `node:test` com um `.pfx` de teste gerado no próprio teste
  (`node-forge`) — o PDF assinado abre com as mesmas páginas, **os bytes
  aprovados são prefixo exato do assinado**, `/ByteRange` está presente, o
  original continua intocado, e a estampa cai na última página;
- **Zé:** teste do `modo: 'recado'` (texto sai sem chamar o modelo) e do
  `liberar_assinatura` ("pode" assina, "não" recusa, expirado recusa);
- **regressão:** anexo comum continua sem botão de assinar, e o fluxo de
  documentos de hoje (upload, geração, pacote do instalador) não muda.
