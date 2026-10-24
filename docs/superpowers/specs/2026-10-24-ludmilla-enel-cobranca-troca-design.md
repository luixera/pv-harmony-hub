# Ludmilla — cobrar a ENEL sobre a troca do relógio (e leitura automática da ENEL)

Data: 24/10/2026. Desenho conversado com o usuário; as decisões dele estão na seção 2.

## 1. O fluxo da ENEL (nas palavras do usuário)

1. **Envio do projeto**, por um de dois caminhos:
   - **pelo portal**, com o login do cliente. O protocolo entra no modal quando o card vai para "Enviado", e a Carta chega por e-mail entre minutos e um dia depois;
   - **pelo Canal GD** (`canalgd.sp@br.enel.com`), com a documentação e um resumo. A Carta (parecer de acesso ou reprovação) chega em 15 a 30 dias, com o titular e a NT dentro do PDF.
2. **Vistoria online.** Aprovada a Carta, a equipe manda ao Canal GD o relatório de vistoria e o vídeo de anti-ilhamento, e espera a aprovação.
3. **Troca do relógio.** Aprovada a vistoria, **a equipe** pede a troca. A ENEL responde que abriu uma **nota de serviço** de troca ou de reprogramação: número da ordem, data e prazo.
4. **Depois da nota.** É preciso perguntar à ENEL se a troca já foi feita. Esta spec trata desse passo.

O que a Ludmilla já cobre está em `docs/modules/integrations/ludmilla.md` (ENEL por e-mail): Carta → Aprovado ou Pendência e gravar a NT; vistoria aprovada → sino; vistoria reprovada → cartão; nota de serviço → só anota; troca realizada → sugerir Concluído (24/10).

## 2. Decisões do usuário (24/10/2026)

| Pergunta | Resposta |
|---|---|
| Quem manda o e-mail de cobrança? | **A Ludmilla prepara, uma pessoa aprova.** Nada sai sem clique |
| Quando cobrar? | **7 dias** depois do e-mail da nota de serviço; sem resposta, **de novo a cada 7 dias** |
| Como o e-mail vai? | **Resposta na conversa da nota**: "RE: TROCA DE RELÓGIO - … - NT …" |
| A leitura da ENEL fica automática? | **Sim, de hora em hora no expediente.** Hoje ela só acontece pelo "Verificar agora" |
| De onde vem o texto? | **Modelo curto escrito por Claude**, aprovado pelo usuário (seção 5) |
| "Troca já realizada" | **Sugerir Concluído** (já em implementação) |

## 3. O desenho

### 3.1 Leitura automática da ENEL
- Função NOVA `ludmilla_agendar_email()`, chamada por um `pg_cron` de hora em hora, **de segunda a sexta, das 8h às 18h** (horário de Brasília, `0 11-21 * * 1-5` em UTC).
- Ela enfileira `varredura_email` para cada conta com `acompanhamento = 'email'`, `identificacao = 'remetente'` (hoje só a ENEL) e `enabled`, desde que a conta não tenha run aberto.
- **O agendador da CPFL (`ludmilla_agendar_varreduras`) não muda.** A prova é o md5 do `prosrc` antes e depois.
- A EDP (`protocolo_no_assunto`) continua manual: o primeiro run dela ainda está pendente.
- O "Verificar agora" continua igual.

### 3.2 A nota de serviço vira uma cobrança agendada
Quando o run lê o e-mail que abre a nota (a troca `agendada` do classificador, ou uma reprogramação), além do que já faz hoje ele grava:
- o **número da nota de serviço**, com 12 dígitos, tirado do corpo junto do termo "nota de serviço" ou "ordem";
- a **data da nota** (data do e-mail) e o **prazo**, quando houver;
- os **cabeçalhos para responder na conversa**: `Message-ID` (vira `In-Reply-To`), `References`, assunto e remetente;
- a **cobrança agendada** para a data da nota + 7 dias.

Tabela nova `portal_cobrancas`, uma linha por nota (único por conta + nota). Campos: `tenant_id`, `account_id`, `project_id`, `nota_servico`, `mensagem_id` (a da nota), `para`, `assunto`, `in_reply_to`, `references`, `vence_em`, `situacao` (`agendada` | `aguardando_envio` | `enviada` | `encerrada` | `dispensada`), `enviadas` (contador), `ultima_enviada_em`, `aprovada_por`, `erro`.
- RLS RESTRICTIVE por tenant, só para a equipe do GD Manager, como o resto da Ludmilla.
- Escrita só por RPC.

Nota repetida (a ENEL reenvia ou reprograma) **não** duplica: a cobrança existente é atualizada.

### 3.3 No dia, a cobrança aparece para aprovar
- A cobrança vencida, sem "troca realizada" recebida, aparece na aba **Decidir** como um **A fazer** do tipo "Cobrar a ENEL — troca do relógio do PRJ-x (nota N)".
- O item mostra o e-mail pronto: **Para**, **Assunto (RE: …)** e **Texto**. O texto é **editável**.
- Botões: **Enviar** e **Dispensar**.
- **Enviar** chama a RPC `ludmilla_cobranca_aprovar(id, texto)`: grava quem aprovou e o texto final e enfileira um run `enviar_cobranca`.
- **Dispensar** encerra a cobrança daquela nota, sem novas.

### 3.4 O robô envia
- Run novo, `enviar_cobranca`, no worker da VPS. Manda o e-mail pela **mesma conta Gmail** que a Ludmilla lê, por SMTP (`smtp.gmail.com`, a mesma senha de app do IMAP, lida da credencial da caixa como hoje, nunca pelo front).
- Usa os cabeçalhos `In-Reply-To` e `References` da nota, e o assunto com "RE:".
- **Travas, verificadas no worker E no banco:**
  - o destinatário tem de ser um endereço **@enel.com** ou **@br.enel.com** (o remetente da nota);
  - no máximo 1 envio por nota a cada 7 dias;
  - só envia cobrança `aguardando_envio`, aprovada por uma pessoa da equipe.
- **Depois de enviar:**
  - `ludmilla_cobranca_enviada` registra no histórico do projeto ("cobrança da nota N enviada à ENEL; aprovada por <pessoa>");
  - escreve um comentário no card;
  - agenda a próxima para dali a 7 dias, com `situacao = agendada`.
- **Se der erro:** grava `erro`, volta para `aguardando_envio` e avisa no A fazer. Não tenta sozinho de novo.
- **Log:** nunca leva assunto, nome, texto do e-mail nem endereço de cliente. O endereço da ENEL pode ir.

### 3.5 Quando as cobranças param
- Chegou o e-mail de **troca realizada** do mesmo projeto: `encerrada`, e o cartão sugere Concluído.
- Alguém **dispensou**: `dispensada`.
- O projeto foi **concluído ou arquivado**: `encerrada`.

## 4. O que NÃO muda
- **Só sai com clique.** Envio automático é outra decisão, a tomar quando o usuário confiar no texto.
- A Ludmilla continua **nunca** pedindo vistoria nem a troca do relógio, e nunca envia documento. Pedir a troca é a fase 2, ainda não desenhada.
- A leitura continua só leitura. O envio é a única escrita, e só da cobrança aprovada.
- CPFL e EDP: nada muda.

## 5. O modelo do e-mail (para o usuário aprovar)

**Para:** o remetente do e-mail da nota (o Canal GD). **Assunto:** `RE: <assunto do e-mail da nota>`. **Texto:**

> Prezados, bom dia.
>
> Referente à nota de serviço nº **{NOTA}**, aberta em **{DATA DA NOTA}** para a troca do medidor da instalação **{UC}** — titular **{TITULAR}**, NT **{NT}**:
>
> poderiam, por gentileza, confirmar se a troca já foi executada? Caso tenha sido reprogramada, pedimos a gentileza de nos informar a nova data.
>
> Atenciosamente,
> **{ASSINATURA}**

- "bom dia" vira "boa tarde" depois do meio-dia, na hora do envio.
- A partir da 2ª cobrança, a primeira linha passa a ser "Prezados, retomando o e-mail abaixo: …", e o resto segue igual.
- **{ASSINATURA}**: o nome que o usuário definir (pergunta aberta).

## 6. Riscos
- **E-mail errado para a ENEL.** Mitigação: o clique humano, o destinatário travado na ENEL e o texto editável.
- **Número da nota mal lido.** Ele vem do texto com regra estrita: 12 dígitos junto do termo "nota de serviço" ou "ordem". Se não achar, a cobrança é criada sem o número, e o item avisa "confira o número da nota" antes de enviar.
- **Leitura de hora em hora.** São cerca de 11 runs por dia. A IA só lê os e-mails novos. A busca de envelopes de 120 dias custa uma consulta ao banco por envelope (≈300 por run). Se isso pesar, otimizar com uma consulta em lote.
- **A pasta "Todos os e-mails" (24/10)** muda o que a busca alcança. Conferir no 1º run agendado.
