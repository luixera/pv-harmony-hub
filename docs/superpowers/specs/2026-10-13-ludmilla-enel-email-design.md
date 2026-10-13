# Ludmilla — acompanhamento da ENEL por e-mail (design)

> **Estado:** especificação para revisão do usuário. Nenhum código antes da
> aprovação. Escrita em 13/10/2026 a partir da conversa com o usuário e dos
> dados reais do tenant GD Manager.

## Resumo

A ENEL não tem portal útil para isso: **toda tratativa vem por e-mail**, e a
referência ao projeto vem no corpo **ou dentro do anexo** — às vezes o protocolo,
às vezes a UC, às vezes só o nome do titular. A Ludmilla passa a ler a caixa
**pelos remetentes da ENEL**, descobre de qual projeto é cada e-mail, anexa o
documento no card e **sugere** a etapa. Ela nunca move card e **nunca envia
nada** nesta fase. Reaproveita quase toda a infraestrutura do acompanhamento da
EDP; o que muda é a **direção da busca** e a **identificação do projeto**.

Pedir a troca do relógio por e-mail é a **fase 2**, esboçada no fim, para
conversar à parte.

---

## 1. O pedido

> "o acompanhamento de tratativas da ENEL agora… toda tratativa e atualização é
> por email… no corpo do email e/ou dentro do anexo sempre tem alguma referência
> do projeto, seja protocolo, seja nome do titular, número da UC… na maioria das
> vezes é necessário abrir o anexo."

Remetentes citados pelo usuário: `nao.responda@enel.com` (resposta do projeto,
aprovado ou não), `canalgd.sp@br.enel.com` (onde se envia o projeto, chega o
protocolo de abertura e se pede vistoria), `tecnico.abc@enel.com` (aprovação de
projeto maior).

## 2. O que os dados mostram (GD Manager, maio a outubro/2026)

O Claudinho (`scan-emails`) já recolhe os e-mails da ENEL — busca por remetente
contendo "enel" — e tenta ligar ao projeto pelo **corpo** (protocolo, UC,
titular). Ele **não abre anexo**.

| Medida | Valor |
|---|---|
| E-mails da ENEL recolhidos | **305** |
| Ligados a um projeto pelo corpo | **29 (≈10%)** |
| Cartas do `nao.responda` ligadas a projeto | **0 de 31** |
| Situação no `/email-updates` | **305 pendentes**, nenhum tratado |
| Projetos ativos da ENEL | 34 |

Confirma o que o usuário disse: a referência mora no anexo, sobretudo nas Cartas.

Remetentes que aparecem (o usuário citou três; há mais):

| Remetente | Qtde | Padrão do assunto |
|---|---|---|
| `canalgd.sp@br.enel.com` | 126 | respostas nas conversas de projeto, vistoria e troca de relógio |
| `no-reply@enel.com` | 99 | "Resposta Automática – PROJETO / VISTORIA / TROCA / Status" |
| `nao.responda@enel.com` | 31 | "Geração Distribuída – Carta…" |
| `atendimento.edsp@enel.com` | 21 | "Comunicado técnico sobre a…" (envio em massa) |
| `tecnico.abc@enel.com` | 13 | "VISTORIA GD <número>" / carta |
| `tecnico.norte@enel.com` | 6 | "Carta resposta referente à…" |
| `tecnico.oeste@enel.com` | 3 | idem |
| `servicos.tecnicos.sp@br.enel.com` | 3 | — |
| `postmaster@enel.com` | 2 | devolução de e-mail |

## 3. Decisões tomadas com o usuário (13/10)

| Tema | Decisão |
|---|---|
| Quem fica com a ENEL | **Os dois rodam.** O Claudinho segue exatamente como está; a Ludmilla não mexe nele. O mesmo e-mail pode gerar sugestão no `/email-updates` e na `/ludmilla` |
| Só o nome do titular | **Anexa só se o nome for único** entre os projetos ativos da ENEL do tenant; com dois parecidos, levanta a mão |
| Primeira leitura | **Últimos 30 dias** |
| `tecnico.norte` / `tecnico.oeste` | **Mesmo papel do `tecnico.abc`** (outra região) |
| Respostas automáticas (`no-reply`) | **Só anota** que a ENEL recebeu; não sugere etapa |
| Vídeo de anti-ilhamento aprovado | Anota, anexa **e toca o sino** lembrando de pedir a troca do relógio |

**A vistoria da ENEL tem duas etapas** (do usuário): primeiro o **vídeo de
anti-ilhamento com relatório** (a "vistoria virtual"); aprovado o vídeo, a equipe
**pede a troca do relógio**. As conversas de "TROCA DO RELÓGIO" significam que a
etapa 1 já passou.

## 4. Arquitetura

### O que muda em relação à EDP

| | EDP | ENEL |
|---|---|---|
| Ponto de partida | o **projeto** | o **e-mail** |
| Busca na caixa | pelo número do protocolo | pelos **remetentes** da ENEL, na janela |
| Identificação | protocolo **no assunto**, chave única | protocolo, UC ou titular, no assunto, corpo **ou anexo** |
| Quando abre o anexo | regra da mensagem | regra da mensagem **e** quando o texto não bastou para identificar |

### O que reaproveita da EDP, sem mudança de comportamento

`portal_email_regras` (regras editáveis na tela) · `portal_email_mensagens` com
`concluida`/`tentativas` e teto de 5 · a tentativa contada **antes** do gasto de
IA · a chave do anexo com o protocolo · o filtro de tipos aceitos pelo bucket ·
"não anexar imagem" · "Ler de novo" · o leitor IMAP (`caixa.ts`, só leitura) ·
o portão e o extrato de IA da `ludmilla-parecer` · a conta com
`acompanhamento = 'email'`.

**O caminho da EDP não pode regredir.** A ENEL entra como uma segunda forma de o
run de e-mail descobrir o projeto, escolhida pela conta — não como uma reescrita
da da EDP. Os testes da EDP (225 hoje) seguem passando sem alteração.

### Uma conta nova

`portal_accounts` ganha a conta da ENEL do tenant GD Manager, com
`acompanhamento = 'email'`. A forma de identificar o projeto passa a ser
propriedade da conta: `por_protocolo_no_assunto` (EDP, como hoje) ou
`por_remetente` (ENEL).

## 5. Leitura da caixa

- `SEARCH FROM <remetente> SINCE <data>` para cada remetente com regra ativa.
- Janela: **30 dias** na primeira leitura; nas seguintes, desde a última
  verificação bem-sucedida, com sobreposição de 2 dias.
- Triagem pelo **envelope** antes de baixar o corpo, como na EDP.
- Dedupe pela chave de mensagem já existente.
- Somente leitura (`readOnly`). O Claudinho lê a mesma caixa; os dois só leem.

## 6. Identificação do projeto — o coração, e o risco

### 6.1 Princípio

**A robô procura os NOSSOS números dentro do e-mail. Nunca trata um número
qualquer do e-mail como protocolo.**

Para cada projeto ativo da ENEL, ela verifica se a NT/protocolo, a UC ou o
titular **dele** aparece no e-mail. É a direção segura: um número que não é de
nenhum projeto nosso simplesmente não casa com nada.

### 6.2 Os números que aparecem nos e-mails da ENEL

As respostas da ENEL são cheias de números de naturezas diferentes. Tratar
qualquer um como protocolo faria a robô casar com o projeto errado.

| Número | Formato | Onde aparece | É do projeto? |
|---|---|---|---|
| **NT** (nota técnica) | 9 dígitos | "… - NT <n>", "VISTORIA GD <n>" | **sim** |
| **Instalação / UC** | 10 dígitos | "referente a instalação <n>" | **sim** |
| Nota de serviço | 12 dígitos | "nota de serviço <n>" (troca do relógio) | da troca |
| Protocolo de contato | 10 dígitos | "Protocolo: <n>" (atendimento) | **não** |
| Atendimento SF | "SF" + dígitos | resposta automática | **não** |

Note que **UC e protocolo de contato têm o mesmo tamanho (10 dígitos)**. Por
isso o 6.1: a robô só aceita um número se ele for **exatamente** o de um projeto
nosso, casado como número inteiro (`\m…\M`, como o Claudinho já faz).

Identificadores dos 34 projetos ativos, hoje:

| Campo | Situação |
|---|---|
| Protocolo com 9 dígitos (NT) | 12 |
| Protocolo com 12 dígitos | 8 |
| Protocolo só com texto, sem número | **8** |
| Sem protocolo | 6 |
| UC com 10 dígitos | 28 |
| UC com 22 dígitos (provavelmente duas UCs juntas) | 3 |
| Titular preenchido | 34 |

### 6.3 A escada

1. **Texto, sem IA**: assunto + corpo. Procura a NT/protocolo e a UC de cada
   projeto ativo, como número inteiro; procura o titular pela regra do Claudinho
   (primeiro + último nome numa janela curta, aceitando meio abreviado).
2. **Anexo, com IA** — a `ludmilla-parecer` lê o PDF e devolve NT, UC e
   titular **do documento**; a robô casa esses valores com os projetos ativos do
   mesmo jeito. A leitura acontece em dois casos: quando a regra pede o
   **veredito** (as Cartas — sem ler o PDF não se sabe se aprovou), e quando o
   texto **não bastou para identificar** e a regra permite abrir o anexo. Uma
   leitura só serve aos dois propósitos.

### 6.4 Regras de segurança

| Sinais encontrados | O que a robô faz |
|---|---|
| NT/protocolo **ou** UC de exatamente um projeto | anexa; selo `protocolo` ou `uc` |
| só o titular, e o nome é **único** entre os ativos da ENEL | anexa; selo `titular` (decisão do usuário) |
| só o titular, e há mais de um projeto com nome parecido | **não anexa**; levanta a mão |
| sinais apontam para **projetos diferentes** (NT de um, UC de outro) | **não anexa**; levanta a mão |
| sinais de **mais de um** projeto | **não anexa**; levanta a mão |
| nada casou | registra como "não reconheci"; aparece na tela |

"Levanta a mão" = linha no grupo de atenção da `/ludmilla`, com o motivo, e
`concluida = true` (não é falha passageira; insistir não resolve). "Ler de novo"
recupera depois que o cadastro for corrigido.

### 6.5 Arquivo com o número de outro projeto no nome

A regra da EDP (não anexar arquivo cujo nome traz número de protocolo diferente
do tratado) vale também para a ENEL — **mas com os formatos da ENEL**. A faixa de
11–12 dígitos é da EDP; na ENEL a NT tem 9 e a UC tem 10. A faixa passa a ser
parâmetro da conta. Sem isso, a proteção simplesmente não funcionaria para a
ENEL.

## 7. Leitura do anexo

A `ludmilla-parecer` ganha campos **adicionais** no contrato — a EDP os ignora,
então nada muda para ela:

```
{ ok, veredito, resumo, pendencias, titular, endereco,   // como hoje
  tipo,      // carta_projeto | resultado_vistoria | troca_relogio | outro
  nt,        // número da nota técnica, se o documento citar
  uc }       // número da instalação, se o documento citar
```

O prompt passa a conhecer os documentos da ENEL (carta de aprovação/reprovação,
resultado do vídeo de anti-ilhamento). `nt` e `uc` passam pelo mesmo filtro de
"não é dado" que o titular já passa.

Custo: cerca de US$ 0,10 por PDF lido, lançado no extrato de IA do console. A
IA só é chamada nos dois casos do 6.3 — veredito pedido pela regra, ou texto
insuficiente para identificar. Resposta automática, comunicado e devolução nunca
chamam a IA.

## 8. Mapa de etapas

| E-mail | Como a robô sabe | O que significa | Sugere |
|---|---|---|---|
| Carta — projeto aprovado | IA no PDF | aprovação do projeto | **Aprovado** |
| Carta — reprovado / com exigência | IA no PDF | pendência | **Pendência** |
| Resultado do vídeo — reprovado | IA no PDF ou corpo | vistoria virtual reprovada | **Vistoria reprovada** |
| Resultado do vídeo — aprovado | IA no PDF ou corpo | etapa 1 da vistoria passou | continua em Vistoria solicitada; anota; **toca o sino** |
| Troca — "nota de serviço criada" | texto do corpo | troca **agendada** | só anota (com o prazo) |
| Troca — "não foi executada" | texto do corpo | **a troca falhou** (ex.: cliente não permitiu) | **toca o sino** — exige ação |
| Resposta automática (`no-reply`) | regra | "recebemos seu pedido" | só anota |
| `postmaster` | regra | e-mail **nosso** que voltou | **toca o sino** |
| Comunicado (`atendimento.edsp`) | regra | envio em massa | ignora |

**O sistema não tem etapa "vídeo aprovado, aguardando relógio".** Criar uma
mexeria no Kanban de todos os tenants; fica fora. O projeto continua em Vistoria
solicitada e o histórico registra o passo.

**"Troca feita" não apareceu em nenhum e-mail.** Nas amostras, a ENEL avisa
quando **cria** a nota de serviço e quando a tentativa **falha** — não quando a
troca acontece. Se for assim mesmo, **Concluído continua manual**. O primeiro
run vai confirmar.

As frases da troca vêm de amostras reais: "Nota de serviço criada … para a troca
do medidor bidirecional, com o prazo de execução de até N dias úteis" e "a
tentativa de troca do medidor no dia … não foi executada pelo seguinte motivo:
…". Reconhecer por texto é barato e determinístico; não precisa de IA.

## 9. Regras iniciais por remetente

Semeadas na conta da ENEL, **editáveis na tela** como as da EDP:

| Remetente | Abre o anexo | Anexa no card | Sugere etapa |
|---|---|---|---|
| `nao.responda@enel.com` | sim | sim | sim |
| `tecnico.abc` / `tecnico.norte` / `tecnico.oeste` | sim | sim | sim |
| `canalgd.sp@br.enel.com` | quando o texto não identifica | sim | troca: só anota / sino |
| `no-reply@enel.com` | não | não | não (só anota) |
| `postmaster@enel.com` | não | não | não (sino) |
| `atendimento.edsp@enel.com` | — | — | ignora |

## 10. Avisos no sino

Para admin + staff do tenant, como os avisos da Ludmilla já fazem:

- **Vídeo aprovado** → "é hora de pedir a troca do relógio do projeto X". A robô
  **não** pede — só lembra.
- **Troca não executada** → "a ENEL não conseguiu trocar o relógio do projeto X:
  <motivo>".
- **E-mail devolvido** (`postmaster`) → "um e-mail nosso para a ENEL não chegou".

## 11. Tela `/ludmilla`

Mudança mínima: o cartão da ENEL usa o corpo de e-mail que já existe (regras,
contadores, histórico, grupos de atenção, "Ler de novo"). O que entra:
contadores novos de identificação ("pelo protocolo", "pela UC", "pelo nome",
"levantei a mão") e o selo `uc`.

## 12. Fora da fase 1

- **Enviar qualquer e-mail** — inclusive pedir troca do relógio ou vistoria.
- Mexer no Claudinho (decisão do usuário: os dois rodam).
- Etapa nova no Kanban.
- Preencher o protocolo do projeto a partir do e-mail de abertura (ver 13).
- Acompanhar a ENEL por portal.

## 13. Fase 2 — pedir a troca do relógio (para conversar)

O usuário quer ensinar a robô a pedir a troca. Pedir é **enviar e-mail para a
ENEL em nome da empresa** — a mesma família de "pedir vistoria", que a regra da
casa diz para nunca fazer sem conversar. Esboço para a conversa:

**O modelo, extraído dos pedidos reais da equipe** (citados nas respostas da
ENEL que o Claudinho guardou):

- Para: `canalgd.sp@br.enel.com`
- Assunto: `TROCA DE RELÓGIO - <TITULAR> - NT <número>`
- Corpo: *"Bom dia caro analista, a NT <número> passou pela etapa de vistoria,
  por gentileza seguir para a troca de relógio. Atenciosamente"*
- Sem anexo.
- Variante quando a troca falha: responder na mesma conversa pedindo para
  **reabrir** o pedido.

**Gatilho natural:** o vídeo aprovado (seção 8), que já toca o sino na fase 1.

**Proposta de segurança, a decidir:** a robô **monta** o e-mail e uma pessoa
**aprova** com um clique antes de sair — como a criação de projeto na CPFL.
Alternativa ainda mais conservadora: a robô cria o **rascunho no Gmail** e a
pessoa envia de lá.

Perguntas para a fase 2: o envio sai do mesmo Gmail (`luizaugusto716@…`)? Há
casos em que o pedido leva anexo? O pedido de reabertura também entra?

**Bônus da fase 2:** o `canalgd` manda o protocolo de abertura, e **14 dos 34**
projetos ativos estão sem protocolo numérico (6 com o campo vazio, 8 só com
texto). A robô poderia sugerir o preenchimento — a pessoa aprova. Além de
organizar o cadastro, isso melhora a própria identificação da fase 1: protocolo é
o sinal mais forte que ela tem.

## 14. Qualidade de dado encontrada

Não bloqueia a fase 1, mas reduz o que a robô consegue identificar:

- **8 projetos com o campo protocolo só com texto**, sem número — a robô os
  identifica só pela UC ou pelo titular.
- **8 projetos com protocolo de 12 dígitos** — o tamanho da nota de serviço, não
  da NT (9). Pergunta ao usuário: qual número da ENEL está guardado ali?
- **3 UCs com 22 dígitos** — provavelmente duas UCs no mesmo campo. Como número
  inteiro, não casam com nada.

## 15. Primeiro run

Manual e acompanhado, como na EDP, com um roteiro próprio. O que olhar:

- quantos foram identificados **por qual sinal** (protocolo, UC, nome) e quantos
  **levantaram a mão** — é o número que diz se a identificação funciona;
- abrir os cards que receberam documento e conferir **na mão** que é daquele
  projeto;
- se apareceu alguma "troca feita" (seção 8);
- o custo de IA da janela de 30 dias.

## 16. Verificação

- Testes da identificação com os números da seção 6.2, inclusive o **protocolo
  de contato de 10 dígitos que não pode casar com a UC** de outro projeto.
- Os 225 testes atuais da EDP seguem passando **sem alteração**.
- **Mutação**, como nas últimas rodadas da EDP: quebrar a regra de propósito e
  mostrar quantos testes caem.
- Provas de banco executadas em `begin; … rollback;`.
- Baseline do front (65) e build.
