# Assinatura digital — Roteiro de aceite

Este é o roteiro para colocar a assinatura digital no ar **pela primeira vez** e
provar, de ponta a ponta, que ela funciona. Foi escrito para você poder seguir
sozinho. Ele está dividido em quem faz o quê:

| Parte | Quem | O que é |
|---|---|---|
| **1** | quem desenvolve | deploy das duas funções, do robô e do front; conferências |
| **2** | **só você** | cadastrar o certificado, conferir o PDF, validar no ITI, testar a tranca |
| **3** | você, olhando | o que observar no primeiro deploy, porque **nada disso nunca rodou** |
| **4** | você, sabendo | armadilhas conhecidas |
| **5** | quem desenvolve | o que olhar se algo falhar |

**Estado de partida:** o banco já está pronto (as cinco migrações de 03/10 foram
aplicadas e as provas SQL passaram). Falta tudo o que mora fora do banco: as duas
edge functions, o robô na VPS e o front. **A tela de assinaturas nunca foi vista
autenticada por quem a construiu, e o robô nunca rodou na VPS.** Se algo estiver
estranho, é esperado que apareça aqui — anote com print.

---

## Antes de tudo: o seu certificado precisa servir

> ### ⚠️ Pré-requisito que pode travar tudo
>
> O sistema só assina com **certificado A1 de arquivo** — um arquivo **`.pfx`
> ou `.p12`** — emitido para o **CPF do engenheiro responsável** (pessoa
> física, o "e-CPF").
>
> **Se hoje você assina pelo Gov.br, isso NÃO serve.** O Gov.br não entrega
> arquivo de certificado: a assinatura fica dentro dele. Também não servem
> certificado A3 (token ou cartão, a chave nunca sai do aparelho) nem e-CNPJ
> (o cadastro exige CPF).
>
> **Confirme isto antes de gastar tempo com o resto.** Você precisa ter, em
> mãos: o arquivo `.pfx`/`.p12`, a **senha** dele, o **nome** e o **CPF** do
> titular. Se não tem, o próximo passo é comprar/emitir um A1 de uma
> autoridade certificadora — e o roteiro espera por isso.

**Esta assinatura é real.** Ela é feita com o seu e-CPF de verdade e tem valor
jurídico. Por isso: use um **projeto de teste** e **documentos de teste**
(um memorial com "DOCUMENTO DE TESTE" no título, um contrato inventado). O
`..._assinado.pdf` fica anexado ao projeto.

---

## Parte 1 — O que quem desenvolve faz antes

Marque cada item. Você só começa a Parte 2 quando todos estiverem marcados.

### 1.1 Conferir o banco (leitura, não altera nada)

- [ ] Os 6 tipos do catálogo existem, o extrato está vazio e os dois jobs estão
  agendados:

  ```sql
  select count(*) as tipos from public.documentos_assinaveis;            -- 6
  select count(*) as pedidos from public.assinaturas;                    -- 0
  select jobname, schedule from cron.job
   where jobname in ('certificado-vencimento', 'ze-expirar');
  -- certificado-vencimento | 0 10 * * *     ze-expirar | 0 * * * *
  ```

  (`npx supabase db query --linked -f arquivo.sql`.)

### 1.2 Deploy da `ze-brain` — **primeiro, antes do robô**

- [ ] Publicar a `ze-brain` (push em `main` roda `deploy.yml`, ou
  `supabase functions deploy ze-brain --project-ref yqsqrdndvsnhbsoaoilf --no-verify-jwt`).
- [ ] **Confirmar que a versão nova subiu** (`supabase functions list`): o job de
  funções do `deploy.yml` tem `continue-on-error`, então uma falha ali **não
  derruba o deploy e passa em silêncio**.

> **Por que antes do worker.** O robô entrega os recados do Zé chamando a
> `ze-brain` com `modo:'recado'`. Se o robô subir primeiro, a função velha não
> conhece esse modo, **todo recado falha e queima as tentativas** (8, com espera
> crescente) e é abandonado — inclusive o "Libero?" do teste da tranca. Subir
> a `ze-brain` depois não recupera o que já foi queimado.

### 1.3 Deploy da `assinatura-triagem`

- [ ] Publicar (ela **não está em nenhum workflow**, é manual):

  ```
  supabase functions deploy assinatura-triagem --project-ref yqsqrdndvsnhbsoaoilf --no-verify-jwt
  ```

  O `supabase/config.toml` já traz `verify_jwt = false` para ela; a função
  confere por conta própria quem a chama.

### 1.4 `ASSINADOR_WORKER_KEY` no ambiente das functions

- [ ] `supabase secrets list --project-ref yqsqrdndvsnhbsoaoilf` tem de mostrar
  **`ASSINADOR_WORKER_KEY`** (a listagem mostra só o nome).
  O passo "Segredo do robô…" do `deploy.yml` a grava a partir do mesmo segredo
  do GitHub que o robô usa (`SUPABASE_SERVICE_ROLE_KEY`), então as duas pontas
  casam por construção. Se esse passo foi pulado (o próprio passo avisa quando o
  segredo do GitHub não existe), a função recusa o robô com 403.

> Sem essa chave a segurança **não é quebrada, ela fecha**: a triagem passa a
> responder "dúvida" para tudo e os recados não são entregues. É um sintoma
> confuso, por isso a conferência vem antes.

### 1.5 Rodar o workflow do robô — primeiro só diagnóstico

- [ ] GitHub → **Actions** → **Assinador — deploy do robô na VPS** →
  **Run workflow**, com **`simular: true`**. Ler o diagnóstico (versão do Node,
  `soffice`, se a unit existe, estado do serviço, últimas linhas do log).
  Nada é alterado na VPS.
- [ ] Rodar de novo com **`simular: false`**. Isso instala o LibreOffice e as
  fontes, cria o usuário `gdmassinador`, grava `/etc/gdm-assinador/env` (só root
  lê) e inicia o serviço `gdm-assinador`.

> Atenção: mesmo no modo `simular`, o job instala o LibreOffice no *runner* e
> **roda os testes** — se um teste falhar, nem o diagnóstico sai.

### 1.6 Conferir o serviço

- [ ] Na VPS (SSH, porta 22022): `systemctl is-active gdm-assinador` → `active`.
- [ ] `journalctl -u gdm-assinador -n 20` tem de conter **`assinador no ar`**
  com **`"soffice":true`**. Se aparecer "aviso: LibreOffice ausente", planilha e
  `.docx` não serão convertidos.

### 1.7 Deploy do front

- [ ] O front sobe pelo mesmo push em `main` (job `build-and-deploy` do
  `deploy.yml`). Conferir, logado como **admin do GD Manager**, que o item
  **"Assinaturas"** aparece na sidebar e que a aba **"Assinaturas"** aparece no
  modal de um projeto.

### 1.8 O Zé precisa estar conectado

- [ ] Em `/ze`, o WhatsApp está **conectado**. O banco só enfileira recado
  quando o tenant tem Zé ligado; desconectado, o recado fica na fila sem sair, e
  o passo 7 e o teste da tranca não terão o que mostrar.

---

## Parte 2 — O que só você pode fazer

Em ordem, porque cada passo depende do anterior. Tenha à mão: o `.pfx`, a senha,
o nome e CPF do titular, um memorial `.docx` de teste e um "contrato" de teste
em PDF.

### Passo 1 — Cadastrar o certificado (você digita a senha)

1. Entre como **admin** do GD Manager e abra **Assinaturas** na sidebar.
2. No cartão do certificado, clique em **Cadastrar certificado**.
3. Escolha o arquivo `.pfx`/`.p12`, informe o **nome** e o **CPF** do titular
   (11 dígitos) e **digite a senha você mesmo**.
4. Clique em **Guardar**.

> **A senha é só sua.** O assistente (Claude) nunca digita nem toca nela, e
> nenhuma parte do sistema a devolve depois de gravada (ela vai para um cofre,
> o Vault). **Ninguém — nem você — consegue baixar o `.pfx` de volta** do
> sistema depois de enviar. **Guarde o arquivo original em outro lugar.**

**Esperado:** o cartão mostra **"conferindo o arquivo…"**.

### Passo 2 — Esperar o certificado ser conferido

O robô olha a fila a cada 15 segundos. Espere a situação sair de
**"conferindo"** (normalmente menos de 1 minuto).

**Esperado:** **"válido"**, com **emissor**, **série** e **validade**
preenchidos, e o CPF aparecendo mascarado (`***.***.123-45`).

- **"inválido"**: leia a mensagem. As causas são senha errada, arquivo
  corrompido ou **CPF diferente do que está dentro do certificado**. Cadastre de
  novo (o novo substitui o anterior).
- **Continua "conferindo" depois de 2 minutos**: o robô não está pegando. Avise
  quem desenvolve — Parte 5.

### Passo 3 — Pedir a assinatura de um memorial `.docx`

1. Abra o **projeto de teste** → aba **Assinaturas**.
2. Confirme que a faixa de cima diz que o certificado está válido.
3. Em **Assinar documento**, escolha **Memorial descritivo**, escreva um motivo
   (opcional) e clique em **Escolher o arquivo**. Envie o memorial `.docx`.

**Esperado:** aviso "Pedido enviado — vou preparar o PDF para você conferir", a
linha aparece como **"Preparando o PDF…"** e, em alguns segundos (a conversão leva
mais que um PDF puro), vira **"Confira antes de assinar"**.

### Passo 4 — Conferir o PDF preparado e dar o "está certo"

Este é o passo que garante que **ninguém assina o que não viu**. Faça com
atenção.

1. Clique em **Ver o PDF**. Se nada abrir, libere pop-ups para o site.
2. Confira o **conteúdo**: é o seu memorial? Tabelas, acentos, fontes, quebras
   de página, imagens — a conversão do Word para PDF pode mudar o layout.
3. Vá até a **última página**. Confira a **estampa** no canto inferior direito:
   - nome do titular;
   - CPF **mascarado**;
   - a **cidade do projeto**;
   - data e hora;
   - o **código de verificação** (6 caracteres), o mesmo que aparece na linha.
4. A estampa **não pode cobrir** nada importante do documento.
5. Tudo certo? Clique em **Está certo, assine**. Se algo estiver errado, clique
   em **Cancelar** — nada é assinado.

> A partir do "está certo" **nenhum byte do PDF é reescrito**: a assinatura só é
> acrescentada ao final. Por isso a estampa vem antes.

### Passo 5 — Acompanhar até assinar e confirmar as três provas

O memorial passa pela triagem do Claudinho. A linha vai por **"Em triagem"** →
**"Na fila para assinar"** → **"Assinado"**, em geral em 1 a 2 minutos.

> Se, no meio, ela parar em **"Esperando liberação"** (a triagem ficou em dúvida
> sobre um documento que é seu), o Zé vai te perguntar "Libero?" no WhatsApp.
> Sendo o seu memorial de teste, responda "pode". Isso não é erro — é a regra
> funcionando.

Quando virar **"Assinado"**, confirme as **três provas**:

1. **O documento assinado**: um arquivo **`..._assinado.pdf`** apareceu no
   projeto (e em **Assinaturas → Abrir assinado**). Abra e veja a estampa.
2. **O comentário no card** do projeto, com o código de verificação, e a linha
   "Documento assinado" no histórico do projeto.
3. **O recado no WhatsApp**, no chat "Você", dito pelo Zé, no formato:
   *"Assinei … com o e-CPF de …, 14:32. Código AX7F2."*

Se o recado não chegar em ~5 minutos, avise — Parte 5. (A entrega é feita por
uma fila com reenvio, então um atraso pequeno é normal.)

### Passo 6 — Validar o assinado no ITI

1. Baixe o `..._assinado.pdf` (Abrir assinado → salvar).
2. Abra **validar.iti.gov.br** e envie o arquivo. *(Use o documento de teste, não
   um de cliente: o arquivo é enviado ao site do governo.)*
3. **Anote exatamente o que o validador mostra** (print). Opcionalmente, abra
   também no **Adobe Reader** e olhe o painel de assinaturas.

O que esperar, e o que cada resultado significa:

- **Reconhece a assinatura, íntegra, com a cadeia ICP-Brasil** → aceito.
  Avisos sobre **carimbo de tempo** ou **política de assinatura** são
  esperados: o sistema produz `adbe.pkcs7.detached`, que **não é PAdES-Baseline**
  (sem carimbo de ACT e sem política AD-RB — ver [overview](overview.md)).
- **Rejeita, diz que a assinatura é inválida ou que o documento foi alterado** →
  **pare e traga o print.** Pode ser defeito do sistema ou pode ser que o ITI
  exija o carimbo do tempo de uma ACT. Esse é um caminho **fora de escopo hoje**
  (envolve custo e decisão de produto), então a decisão é sua.
- **Não consegue avaliar** → tente o Adobe Reader e traga o print.

> Este passo é o que confirma, na prática, se o ITI aceita a forma de
> assinatura que o sistema produz. Não é só formalidade.

### Passo 7 — O teste da tranca

O objetivo é provar que **um contrato não consegue ser assinado fingindo ser
memorial**.

1. Prepare um **contrato de mentira em PDF** — por exemplo, "CONTRATO DE
   PRESTAÇÃO DE SERVIÇOS — MODELO DE TESTE", com algumas cláusulas e um valor.
   **Não use um contrato real de cliente:** o conteúdo é enviado à IA para a
   triagem.
2. No mesmo projeto de teste → aba **Assinaturas** → escolha o tipo
   **"Memorial descritivo"** (de propósito, o tipo errado) → envie o contrato.
3. Quando chegar em "Confira antes de assinar", abra o PDF e **dê o "está certo"
   de propósito**. Você está passando pelo portão humano; o que está sendo
   testado é o que vem *depois* dele.

**Esperado — um destes dois desfechos:**

- **A tranca barrou.** A linha vira **"Recusado"**, com o motivo escrito na tela;
  o card ganha um comentário **"🚫 Assinatura recusada — …"**; e o Zé manda
  *"Barrei uma assinatura: …"*.
- **A triagem ficou em dúvida e caiu no Zé.** A linha fica **"Esperando liberação"**
  e, em alguns minutos, o Zé pergunta no WhatsApp algo como *"… quer assinar
  contrato.pdf no PRJ-… como Memorial descritivo. … Libero?"*.
  **Responda "não".** Esperado: a linha vira **"Recusado"**, o card ganha
  *"Assinatura recusada — O gestor não liberou a assinatura."* e o Zé confirma
  *"Não assinei …: você não liberou."*

> **Não responda "pode".** Se responder, a assinatura sai, com o seu e-CPF, num
> contrato.

**Se o contrato foi ASSINADO sem passar por você** (linha em "Na fila para assinar" ou
"Assinado" sem triagem barrar): a **tranca falhou** — o e-CPF assinou algo que
não é de projeto. Pare, **anote o código de verificação**, não repita com
documento real e avise quem desenvolve.

### Passo 8 (opcional) — Conferir o papel de staff

Entre como **staff** do GD Manager. Deve ver a página Assinaturas **sem** o cartão
do certificado e, num pedido em "Esperando liberação", **sem** o botão Liberar
(aparece "Só o admin libera."). Anexos da aba de documentos (contrato social,
conta de energia…) **não** têm botão de assinar.

---

## Parte 3 — O que observar no primeiro deploy

Porque **nada disto jamais rodou**, estas são as três coisas mais prováveis de
dar problema. Estão no log do job **"Assinador — deploy do robô na VPS"** (GitHub
→ Actions → o run → o passo indicado).

### 3.1 O `systemd-run` — o sandbox da conversão

No passo **"Instalar / reiniciar"**, procure a seção
**"fumaça: o LibreOffice instalado converte?"**. O instalador converte um
arquivo de teste **sob as mesmas restrições do serviço** (usuário sem
privilégios, `/tmp` privado, sistema de arquivos protegido, código só leitura),
para o endurecimento não quebrar o LibreOffice só na primeira conversão real.

| O que aparece | O que significa |
|---|---|
| `FUMACA_OK (N bytes)` e **`conversão ok — sob o sandbox da unit`** | **O esperado.** |
| `aviso: não consegui rodar a fumaça sob o sandbox — o endurecimento da unit NÃO foi exercitado; testando fora dele` | O `systemd-run` não estava disponível (ou sem `sudo`). O deploy segue, mas **o sandbox não foi testado**: a primeira conversão real pode falhar. Avise. |
| `aviso: fora do sandbox a conversão FUNCIONA — o endurecimento da unit é que está atrapalhando o LibreOffice` | Ajustar a unit (`worker/assinador/deploy/gdm-assinador.service`). Planilha e `.docx` **não** convertem até lá. |
| `aviso: a conversão de fumaça falhou …` | LibreOffice ou fontes com problema. PDF já pronto continua assinável; `.docx` e planilha não. |

### 3.2 Os 4 testes de conversão no CI

No passo **"Testes do assinador"** os 4 testes de conversão têm de aparecer
**passando — não "skipped"**: converte `.docx`, converte planilha (o caminho da
CEMIG), duas conversões simultâneas, e recusa `.docx` corrompido. Na sua máquina
(Windows, sem LibreOffice) eles são pulados; **no CI eles falham de propósito**
se o LibreOffice não estiver instalado, com a mensagem *"CI sem LibreOffice:
instale libreoffice-calc e libreoffice-writer no pipeline…"*. Pulá-los em
silêncio deixaria o CI verde sem nunca exercitar a conversão.

### 3.3 O teste do `.docx` corrompido

É o mais frágil dos quatro. Ele fabrica um zip sem nenhuma entrada legível e
espera que o sistema **recuse com mensagem em português que cita "corrompido" e
o nome do arquivo**. Se falhar com **"Missing expected rejection"**, o
LibreOffice **converteu o lixo** e a validação do PDF não pegou: **não é problema
de ambiente, é defeito a corrigir**. Traga o log.

### 3.4 E mais duas coisas

- No log do serviço, ao subir: `assinador no ar` com `"soffice":true`; depois,
  `certificado conferido` quando você cadastrar o certificado.
- O log do instalador e do worker traz o **nome do titular do certificado** e
  nomes de arquivo de cliente. O repositório é privado; só saiba que está lá.

---

## Parte 4 — Armadilhas conhecidas

- **Virada de dia da validade, em Brasília.** O banco compara a validade com a
  data em **UTC**. No **dia da validade, entre 21h e meia-noite de Brasília**, o
  banco já considera o certificado vencido (e recusa pedidos) enquanto a tela
  ainda diz **"vence hoje"**. Se acontecer, é isso, não é defeito. Renove antes.
- **Documentos antigos que nunca poderão ser marcados como assináveis: 45 de
  1.415.** São 38 do formulário público (caminho `public/…`) e 7 de jan–mar/2026
  com espaço ou parêntese no nome, de antes da sanitização de nomes. **Todos são
  anexos de cliente** (conta de energia, documento do titular, fotos do padrão);
  nenhum é do tipo que o Bidu ou a assinatura usam. Recusá-los é o comportamento
  **correto**. Hoje a tela nem tenta marcar documento existente — só aceita
  envio de arquivo.
- **O que o Bidu gera não vira assinável por clique.** Para assinar um
  formulário ou memorial gerado, baixe o arquivo e envie-o pela aba Assinaturas.
  (A integração direta está prevista na spec e **não foi construída**.)
- **A data na estampa é a do preparo**, não a do instante em que a assinatura é
  gravada.
- **Se "Ver o PDF" não abre**, o navegador bloqueou o pop-up (a janela abre
  depois de uma espera).
- **O recado pode chegar duplicado** em casos raros (o robô enviou e caiu antes
  de marcar como entregue). Entrega "ao menos uma vez".
- **O extrato mostra as últimas 100 linhas.** Um "Esperando você" muito antigo
  pode sumir do bloco "Esperando você".
- **A triagem custa IA** (aparece no extrato de IA do console como
  `assinatura_triagem`). Falha de IA não é cobrada.
- **Sem Zé ligado no tenant**, a pendência de exceção abre, ninguém é avisado, e
  ela expira recusando em 24 h — a menos que o admin abra a página Assinaturas e
  libere ou recuse por lá.
- **O passo 4 depende de você olhar.** Nada impede você de clicar "Está certo"
  sem conferir; o sistema registra *quem* deu, mas não *se leu*.

---

## Parte 5 — Se algo falhar (para quem desenvolve)

| Sintoma | Onde olhar |
|---|---|
| Certificado fica em "conferindo" | `systemctl is-active gdm-assinador`; `journalctl -u gdm-assinador -n 50`. Falha de download deixa em `conferindo` e tenta no ciclo seguinte; o log diz "não consegui buscar o certificado" |
| Fica em "Preparando o PDF…" | idem; mensagem de conversão em português na coluna `erro` da linha (aparece na tela) |
| "Deu erro" na tela | a mensagem é legível; 3 tentativas por etapa, com espera. O pedido pode ser cancelado e refeito |
| Triagem sempre "dúvida" | a mensagem diz "Triagem indisponível: …". 403 = `ASSINADOR_WORKER_KEY` ausente ou função sem deploy (1.3/1.4); sem cota de IA também cai aqui |
| Recado não chega | a fila: `select left(texto,60), tentativas, claim_em, entregue_em, nota from public.ze_recados order by criado_em desc limit 5;` — `nota` explica ("não entregue (Zé desconectado ou falha no envio)", "descartado: mais de 20 h…"). Confirme `ze-brain` com `modo:'recado'` publicada, Zé conectado e `ASSINADOR_WORKER_KEY` |
| "Libero?" não chega | o recado do "Libero?" está em `ze_recados` com `pendencia_id`; só vale o "pode" depois de `perguntada_em` preenchido em `ze_pending_actions` |
| Recusado por "O PDF mudou depois do 'está certo'" | o arquivo no bucket foi trocado; refazer o pedido |

---

## Critério de aceite

O módulo está aceito quando **todos** estes itens forem verdadeiros:

- [ ] Partes 1.1 a 1.8 concluídas.
- [ ] O certificado ficou **"válido"**, com emissor, série e validade.
- [ ] O memorial `.docx` foi convertido, a estampa estava na **última página**
  com a **cidade do projeto**, e o "está certo" foi seu.
- [ ] Existe o `..._assinado.pdf` no projeto, o **comentário no card** e o
  **recado no WhatsApp**.
- [ ] O **`validar.iti.gov.br`** reconheceu a assinatura (ou a decisão sobre
  carimbo de tempo foi tomada — ver Passo 6).
- [ ] O contrato de teste com o tipo errado foi **barrado ou recusado pelo seu
  "não"**, com o motivo no card.
- [ ] O log do instalador mostrou **`conversão ok — sob o sandbox da unit`** e os
  4 testes de conversão **passaram** no CI.

Depois do aceite, atualize o "Estado" em [overview.md](overview.md) e a linha do
módulo no `CLAUDE.md`.
