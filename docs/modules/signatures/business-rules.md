# Assinatura digital — Regras de Negócio

Cada regra diz **o que** vale e **por que** — a maioria nasceu de um furo achado
numa revisão, e o porquê é o que impede alguém de desfazê-la por engano.
Números estáveis (`RN-ASS-NN`): outras docs e comentários apontam para eles.

## A. A tranca — o que pode ser assinado

- **RN-ASS-01 — Só assina o documento que entrou pela porta da assinatura.**
  Vale o documento com `documents.assinavel_id` apontando para um tipo **ativo**
  do catálogo do tenant. Contrato social, procuração avulsa, documento pessoal e
  qualquer anexo comum ficam sem a marca: não ganham botão e o banco recusa
  mesmo que a função seja chamada na mão. *Por quê:* o `document_type` não
  distingue "memorial do projeto" de "contrato comercial" (tudo o que o Bidu
  gera é `extra_attachment`), então a regra tem de ser a porta de entrada.

- **RN-ASS-02 — Só o banco coloca a marca.** A coluna `assinavel_id` está fora
  de todo `GRANT` de `documents` e **ninguém tem `UPDATE`** na tabela. As únicas
  portas são `documento_para_assinar` (arquivo enviado) e
  `documento_marcar_assinavel` (documento existente), ambas `SECURITY DEFINER`.
  *Por quê:* sem isso a tela podia gravar `assinavel_id` num insert comum e
  anular a tranca inteira. E sem `UPDATE` ninguém troca o `file_url` de um
  documento **já marcado** por um arquivo que nunca passou pela porta.

- **RN-ASS-03 — O pedido repete a tranca, com cinco condições.**
  `assinatura_pedir` exige, no banco: (1) projeto vivo do tenant de quem pede;
  (2) tipo ativo no catálogo; (3) documento **do projeto, marcado com o mesmo
  tipo** pedido; (4) certificado `ok` e dentro da validade; (5) nenhum pedido em
  andamento para o documento. *Por quê:* a condição 3 compara os tipos — um
  documento marcado como "ART" não pode ser pedido como "memorial". Uma tranca
  que só olhasse `assinavel_id IS NOT NULL` aceitaria o par errado.

- **RN-ASS-04 — O arquivo tem de estar na pasta do projeto.** O caminho precisa
  começar por `<company_id do projeto>/<project_id>/` (a empresa vem do banco,
  nunca de parâmetro) e o resto só pode ter `[A-Za-z0-9._-]` em segmentos
  separados por `/`, sem segmento `.` ou `..`. É **allowlist**, de propósito.
  *Por quê:* o robô baixa esse caminho com a service role, que ignora RLS. O
  `fetch` normaliza `..`, `%2e%2e` e `..\` e remove tab/quebra de linha antes de
  enviar, então uma lista de proibidos tem furo real (`%2e%2e`, `\`, tab). Sem a
  regra, um staff colocaria na fila o documento de **outra empresa** para ser
  assinado com o e-CPF do engenheiro. Vale nas duas portas, porque o `INSERT`
  comum aceita `file_url` arbitrário (é o upload de anexo) e o `marcar` marcaria
  qualquer coisa.

- **RN-ASS-05 — A triagem é a segunda camada, nunca a única, e falha
  fechada.** O Claudinho lê o PDF preparado e responde `projeto`, `nao_projeto`
  ou `duvida`. Só `projeto` segue sozinho. **Qualquer outra coisa vira
  `aguardando_ze`**: IA fora do ar, sem cota, resposta cortada, JSON inválido,
  arquivo acima de 10 MB (nem é enviado), erro HTTP. O parser só aceita uma
  resposta que *seja* o objeto (tirada a cerca de código), e se o texto já abre
  com `{` ele vale mais do que uma cerca mais adiante. *Por quê:* a triagem roda
  **depois** do "está certo" humano; no caso que motivou o módulo — alguém sobe
  um contrato escolhendo o tipo "memorial" e aprova o PDF porque *quer* a
  assinatura — o veredito é a última barreira, e o conteúdo do documento é o
  caminho natural de injeção de prompt. Resíduo aceito: prosa contendo uma cerca
  com um objeto dentro ainda é lida como o veredito da cerca.
  Documento **gerado** pelo sistema poderia ser isento (`exige_triagem = false`),
  mas esse canal não existe: **hoje todos os tipos exigem triagem**, inclusive o
  `formulario_concessionaria` (que já foi semeado sem ela e deixava um contrato
  enviado com esse tipo chegar ao e-CPF sem peneira — corrigido em 12/10/2026).
  A isenção só volta junto com o canal do documento gerado.

- **RN-ASS-05a — Documento misto é dúvida, não recusa.** Um ART legítimo tem
  campo de valor de contrato. `nao_projeto` recusa **sem passar pelo gestor**;
  na mistura, o prompt manda responder `duvida`.

- **RN-ASS-06 — Exceção só com o "pode" do gestor; expirado é recusado.** Na
  dúvida, a assinatura fica em `aguardando_ze` e o Zé pergunta "Libero?" no
  WhatsApp. "Pode" libera (grava `liberada_por`); "não" recusa com o motivo no
  card; **sem resposta em 24 h recusa** (cron de hora em hora). Pela tela só o
  **admin** libera. O Zé nunca libera por iniciativa própria: pelo WhatsApp o
  banco exige que o "Libero?" **tenha chegado** ao gestor (`perguntada_em`) e que
  haja fala **dele** depois da pergunta. *Por quê:* o prompt do Zé carrega nome
  de arquivo e motivo escritos por terceiros (a IA leu o PDF de um cliente) —
  se o modelo for enganado, o banco ainda barra. O texto que vai ao prompt é
  sanitizado e marcado como dado, nunca como ordem.

## B. Estampa e assinatura

- **RN-ASS-07 — A estampa vem antes da assinatura, e a assinatura é *append*
  sobre os bytes aprovados.** A estampa muda o PDF; a assinatura só vale se nada
  mudar depois dela. A estampa é desenhada no passo que a pessoa confere; a
  assinatura apenas **acrescenta** ao final. O PDF aprovado é **prefixo exato**
  do assinado, e `assinar()` confere isso em runtime e **lança erro** se falhar.
  Decisão registrada no [ADR 0008](../../adr/0008-assinatura-append-sobre-bytes-aprovados.md).

- **RN-ASS-08 — Assina-se exatamente o que foi conferido.** O robô recalcula o
  SHA-256 do PDF aprovado e compara com `hash_aprovado`. Mudou entre o "está
  certo" e a assinatura → recusa ("O PDF mudou depois do 'está certo'"). Ninguém
  assina uma conversão, nem uma estampa, que não foi olhada.

- **RN-ASS-09 — O original nunca é tocado; o assinado é documento novo.** O
  `..._assinado.pdf` entra em `documents` como `extra_attachment`, **sem**
  `assinavel_id`. *Por quê:* com a marca, o assinado seria ele mesmo assinável —
  assinatura sobre assinatura (cosign), fora de escopo. O vínculo com o tipo
  fica em `assinaturas.assinavel_id` e `documento_assinado_id`.

- **RN-ASS-10 — Se a pessoa recusou enquanto o robô assinava, o assinado não
  sai.** `assinatura_passo` devolve `FALSE` quando a transição é inválida e o
  robô **para**. Quando é recusa explícita, apaga o PDF que acabou de subir: ele
  seria uma assinatura ICP-Brasil **válida**, com o e-CPF do engenheiro, sobre
  um documento que a pessoa recusou — alcançável por quem tem leitura no bucket.
  Em erro ambíguo (rede, timeout) **não apaga**, porque o commit pode ter
  acontecido; o caminho leva um `uuid` por tentativa, para que um segundo claim
  não sobrescreva um assinado já entregue.

- **RN-ASS-11 — O que a estampa mostra.** Nome do titular, **CPF mascarado**
  (`***.***.123-45`: só os dígitos 7 a 11), cidade do projeto, data/hora no fuso
  de Brasília e o código de verificação, na **última página**. A data é a do
  **preparo** (quando o PDF foi gerado para conferência), não a do instante da
  assinatura. Nome fora do alfabeto da fonte padrão perde o diacrítico ou vira
  `?`, para não derrubar a assinatura.

## C. O certificado

- **RN-ASS-12 — Só A1 de arquivo, de pessoa física, com o CPF conferido.** O
  cadastro exige CPF com 11 dígitos (e-CNPJ é recusado). O robô só marca `ok`
  se o CPF **dentro** do certificado bate com o informado no cadastro; recusa
  de novo na hora de assinar. O titular lido é o certificado cuja **chave
  pública casa com a chave privada** — um e-CPF real traz a cadeia (titular +
  ACs) sem ordem garantida, e pegar o primeiro poderia estampar o nome da
  autoridade certificadora com CPF vazio. Nunca se imprime um CPF inventado.

- **RN-ASS-13 — Certificado vencido = recusa, nunca assinatura inválida.**
  `assinatura_pedir` recusa com data clara, e o robô reconfere a validade antes
  de assinar. O job diário também move para `vencido` quem passou da validade.
  Até sair de `conferindo`, nenhuma assinatura é aceita.

- **RN-ASS-14 — A senha do certificado nunca é devolvida.** Mora no Vault;
  nenhuma função a devolve a `authenticated`; só `certificado_do_robo` (apenas
  `service_role`) a lê. O `.pfx` fica num bucket **sem policy de leitura**: nem
  o admin o baixa de volta. No robô, ambos vivem **só em memória**, nunca em
  disco nem em log. O assistente (Claude) **nunca digita nem manipula** essa
  senha — o usuário a informa na tela. Na tela, o formulário não guarda a senha
  em estado global: a mutação tem `gcTime: 0` e é limpa ao fim, porque o React
  Query guardaria as variáveis (a senha) por ~5 min.

- **RN-ASS-15 — Um certificado ativo por tenant; só o admin cadastra.** Cadastrar
  desativa o anterior. Por isso, se a leitura do certificado **falhar**, a
  tela mostra o erro e **esconde** o botão de cadastrar: tratar erro como
  "nenhum certificado" levaria o admin a trocar um certificado bom. Erro de
  rede ou de download na conferência deixa o certificado em `conferindo` (o
  próximo ciclo tenta de novo); só senha errada, arquivo ruim ou CPF divergente
  viram `invalido`.

- **RN-ASS-16 — O vencimento é avisado.** Em 30, 15, 7, 1 e 0 dias: sino para os
  admins e recado do Zé. Uma vez por dia (`avisado_em`), só para certificado
  `ok`.

- **RN-ASS-16a — Toda assinatura acende o sino dos admins.** Além do "Assinei…"
  do Zé (que depende do WhatsApp: tenant sem Zé, falha de enfileirar ou Zé fora
  do ar por mais de 20 h apagam o aviso), `assinatura_passo` insere uma
  notificação para cada admin do tenant no mesmo commit da assinatura.

- **RN-ASS-16b — O nome na estampa é o do certificado.** A conferência grava o
  nome lido do `.pfx` por cima do digitado no cadastro; o CPF continua sendo
  conferido contra o informado.

- **RN-ASS-16c — "Esperando liberação" nunca fica sem pergunta.** Se o pedido ao
  Zé falhar depois de a linha ir para `aguardando_ze`, o cron de hora em hora
  reabre a pergunta (linha parada há mais de 15 min, sem pendência aberta).

## D. O rastro

- **RN-ASS-17 — O staff assina com o e-CPF do engenheiro — decisão consciente.**
  É o que a operação exige e o que o usuário escolheu. **O controle não é
  impedir, é rastrear**: catálogo fechado, triagem, recado do Zé em toda
  assinatura, exceção só com o "pode" do gestor e extrato com quem pediu e
  quando. Quem usa a conta de staff responde pelo que assinou em nome do
  engenheiro. Não "corrigir" isso criando bloqueio por papel.

- **RN-ASS-18 — O gestor é avisado de toda assinatura.** "Assinei X com o e-CPF
  de Y, 14:32. Código AX7F2." — o único sinal, fora da tela, de que o
  certificado foi usado. Também avisa quando barra, quando pergunta, quando o
  "não" ou a expiração recusam e quando o certificado vai vencer. Tudo pela
  fila `ze_recados`, com reenvio (espera crescente, ~4 h; descarta com mais de
  20 h) e entrega **ao menos uma vez** — se o worker cair entre enviar e
  marcar, o aviso pode chegar duplicado. Só enfileira se o tenant tem Zé ligado.
  O texto sai pronto, **sem chamar o modelo** (custo zero, determinístico).

- **RN-ASS-19 — Um pedido em andamento por documento.** Índice único parcial no
  banco (dois cliques não criam dois pedidos). Cada pedido tem um **código de
  verificação** de 6 caracteres sem ambiguidade (sem O/0, I/1, S/5 — é lido em
  voz alta), único por tenant, estampado no PDF.

- **RN-ASS-20 — O histórico não depende do certificado atual.** A linha copia
  titular, CPF e série na hora do pedido. Assinar grava comentário no card,
  linha em `project_history` e o documento novo; recusar pelo robô também comenta.
  Recusa feita **pela tela** (`assinatura_recusar`) não deixa comentário — é
  uma assimetria conhecida ([roadmap](../../project/roadmap.md#assinatura-digital)).

## E. Armadilhas técnicas (leia antes de mexer)

- **RN-ASS-21 — O termo correto é `adbe.pkcs7.detached`, não PAdES.** Assinatura
  CMS embutida no PDF, **sem carimbo de tempo e sem política AD-RB**. Não é
  PAdES-Baseline. Não escreva "PAdES" em código, tela ou doc. A aceitação pelo
  validador do ITI é o que o [aceite](aceite.md) confirma; carimbo de ACT está
  fora de escopo. (Dois comentários do código ainda dizem "PAdES" —
  `worker/assinador/src/assinar.ts` e `index.ts` — e o título de um commit
  antigo também. São resquício; o termo certo é este.)

- **RN-ASS-22 — Não use `node-forge` para VERIFICAR assinatura nem validar
  cadeia.** A advisory do forge é justamente na verificação RSA PKCS#1 v1.5, e
  isto vale também para `verifyCertificateChain` e `cert.verify`, que passam
  pelo mesmo caminho. O forge fica **só para ler o `.pfx`** (e gerar o
  certificado de teste). Se for preciso verificar algo (digest do CMS, cadeia
  da ICP-Brasil), use `node:crypto` — `X509Certificate`.

- **RN-ASS-23 — O PDF preparado tem de usar xref clássica.** O `plainAddPlaceholder`
  não lê PDF com *xref stream* (o padrão do `pdf-lib`) e falha com "Expected xref
  at NaN". Por isso a estampa grava com `useObjectStreams: false`. Há três
  testes que discriminam isso (tabela em linha própria presente; `/Type /XRef`
  ausente; e o contraste com o original). Atenção: `includes('xref')` **não**
  discrimina nada — todo PDF tem `startxref`.

- **RN-ASS-24 — O espaço da assinatura é de 16 KB.** O padrão do signpdf (8192
  bytes) pode estourar com um e-CPF ICP-Brasil de cadeia completa, e falharia na
  primeira vez que o usuário assina com o certificado real. O preço é só um
  `/Contents` maior.

- **RN-ASS-25 — Conversão: lista fechada, PDF validado, processo contido.** Só
  `.xlsx`, `.xls`, `.docx`, `.doc` (CSV é recusado: separador `;` e Latin-1 geram
  uma coluna única com lixo que passaria pela rede de detecção). A extensão manda
  sobre o MIME. O resultado só vale se for PDF de verdade (`%PDF-` no início,
  `%%EOF` no fim, tamanho mínimo, ≥ 1 página) — arquivo ausente, vazio, truncado
  ou ilegível gera erro **em português, com orientação**. **Isto NÃO é uma
  tranca contra arquivo corrompido:** o CI de 13/10/2026 provou que o LibreOffice
  converte até lixo (`PK` + bytes aleatórios num `.docx`), sai com código 0 e
  entrega um PDF plausível que passa em todas essas checagens. A garantia contra
  esse caso é **humana** — o passo "Confira antes de assinar" (ver RN-ASS-08:
  ninguém assina uma conversão que não foi olhada); por isso não há teste
  automatizado de recusa de `.docx` corrompido. `soffice` roda sem shell, em perfil e pasta
  próprios, em grupo de processos próprio; o **timeout e o SIGTERM matam o
  grupo** (o wrapper `soffice` deixa o `soffice.bin` vivo, e conversões travadas
  esgotariam a RAM da VPS, que também hospeda a Ludmilla). Uma conversão por
  vez: o laço do worker é serial.

- **RN-ASS-26 — Três tentativas por etapa, com espera.** `tentativas` zera a cada
  mudança de situação. No erro, o robô espera `tentativa × 15 s` antes de
  devolver a linha; na 3ª falha a linha vai para `erro`, com a mensagem legível
  na tela. `erro` é cancelável. Lease de 10 min no claim.

- **RN-ASS-27 — Fusos.** `validade_fim` é `DATE`. No front a data é lida como
  local (`T00:00:00`) — `new Date('2026-12-31')` é meia-noite UTC, ou seja, 30/12
  em São Paulo, e o selo diria "vencido" no último dia de validade. A contagem
  usa dias de calendário. **O banco compara com `current_date` em UTC**, então
  entre 21h e meia-noite de Brasília no dia da validade a função já recusa
  (`validade_fim < current_date`) enquanto a tela ainda diz "vence hoje".

## Referências cruzadas

- Tabelas, funções e transições: [database.md](database.md)
- Telas e fluxo: [overview.md](overview.md)
- Segurança do certificado: [project/security.md](../../project/security.md#certificado-digital)
- O Zé: [modules/ze](../ze/overview.md)
