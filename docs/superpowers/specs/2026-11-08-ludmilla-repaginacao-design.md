# Ludmilla, a melhor funcionária: repaginação da página

Data: 08/11/2026 · Mockup aprovado pelo usuário ("Aprovo a v3") ·
Canvas: https://claude.ai/artifact/5f6ZZKyvN36fRkBsrvxWan (privado). Página
**"v3 — Estrutura A completa"**: computador clicável + celular (fila, detalhe,
menu). As páginas "v2 — Conta de luz" (mundo visual e as três estruturas) e
"v1 (não aprovada)" ficam como registro.

Substitui o desenho de 22/10 (`2026-10-22-ludmilla-pagina-decidir-design.md`)
no que toca à página. Tudo o que a Ludmilla lê, casa e envia continua como está.

## 1. O problema

A `/ludmilla` virou em 22/10 uma caixa de decisões (lista + detalhe + abas).
O usuário continuou desconfortável: ela mostra o que decidir, mas **não diz por
onde começar**, **não mostra a carteira** e **parece um robô, não uma colega**.
O pedido: "um ambiente para atualização e status de projetos automáticos que
nos ajude a organizar e tomar decisões… a ideia é que a Ludmilla seja o melhor
funcionário da empresa".

Um primeiro mockup (v1) tinha a informação certa e foi reprovado pela
organização: recado, números, fila, detalhe, risco e "fiz sozinha" com o mesmo
peso; status espalhado em quatro lugares; quatro faixas de controles antes do
conteúdo.

## 2. Decisões do usuário (07–08/11/2026)

| Pergunta | Resposta |
|---|---|
| Quem usa | **Gestor e projetistas**; cada projetista vê primeiro o que é dele |
| Abertura | **Tudo**: recado dela, fila, carteira e o número de parados, com hierarquia |
| O que ela faz sozinha | **Chave por tipo de ação**: gravar NT/protocolo, anexar documento conferido, mover etapa com prova forte, criar tarefa de parado. E-mail à concessionária **não tem chave** (ADR 0012) |
| Divisão da fila | **Pelo vínculo projetista↔empresa**; o gestor vê tudo e o que ficou sem dono |
| Carteira | **Lista ordenada por risco** |
| Atraso | **Pelo tempo normal medido** de cada concessionária em cada etapa |
| Único número da tela | **Parados e atrasados** (com quem está a bola) |
| Avisos fora da página | **Resumo da manhã no WhatsApp (Zé) e por e-mail, só para o gestor** |
| Voz | **Primeira pessoa, como colega**, em toda a página |
| Reestilização | **Integral, só a Ludmilla com cara própria**; o menu lateral do GD fica |
| Mundo visual | **"Conta de luz"** |
| Rosto | **Avatar ilustrado** |
| Estrutura | **A: três colunas** (resumo e navegação, lista, detalhe) |
| Navegação | **Tudo na coluna da esquerda**, sem abas; Ajustes numa engrenagem |
| Projeto da carteira | Abre a **ficha da Ludmilla** à direita |
| Fila | **Cartão completo** |
| Celular | **Uma coluna por vez** |

Processo combinado: perguntas antes do mockup; estrutura escolhida por versões
desenhadas; spec e plano antes do código.

## 3. O mundo visual: a conta de luz

Só a página `/ludmilla` usa este mundo. O menu lateral e o resto do GD Manager
não mudam.

- **Cores** (tokens próprios da página, sem mexer nos do GD):
  papel `#FFFFFF` (fundo), petróleo `#0F3D4C` (texto e faixa do topo), sol
  `#F2B705` (ação principal, item ativo, "agora"), caixa `#E7EEF0` (coluna da
  esquerda, painéis, campos), alerta `#C2410C` (além do normal), barra neutra
  `#9FB8C0`, texto secundário `#3E5F6A`. Texto sobre sol é petróleo. Todas as
  combinações de texto passam 4,5:1.
- **Tipo:** Public Sans (Google Fonts), números tabulares em toda a página;
  rótulos pequenos em caixa normal, como os campos da fatura.
- **Traço marcante: o histórico em barras.** Como o consumo dos últimos meses
  na conta, cada projeto mostra os dias que passou em cada etapa; um traço em
  cada barra marca o normal daquela concessionária; o que passa do traço fica
  em alerta. Versão pequena no cartão e na linha da carteira; versão grande no
  detalhe e na ficha.
- **"Para decidir agora"** ocupa o lugar do "total a pagar": o item ativo da
  navegação em sol, com o número em destaque.
- **Avatar:** ilustração da Ludmilla (pessoa) na faixa do topo. O do mockup é
  provisório; a ilustração final é encomendada e entra como arquivo do projeto
  (SVG ou PNG), com `aria-label="Ludmilla"`.

## 4. A tela (computador)

```
┌ menu do GD ┬──────────── faixa petróleo: avatar · Ludmilla · ⚙ Ajustes ─────────────┐
│            ├──────────────┬──────────────────────────────┬───────────────────────────┤
│            │ recado do dia│ título da lista              │ detalhe (decisão)         │
│            │ Para decidir │ cartões completos            │  ou ficha (projeto)       │
│            │  Agora   2   │  ou linhas da carteira       │  ou painel da vista       │
│            │  Semana  2   │  ou "fiz sozinha"            │                           │
│            │  Depois  1   │  ou diário                   │                           │
│            │  Fila de …   │  ou ajustes                  │                           │
│            │ Carteira     │                              │                           │
│            │ Comigo       │                              │                           │
│            │ Leituras     │                              │                           │
└────────────┴──────────────┴──────────────────────────────┴───────────────────────────┘
```

### 4.1 Faixa do topo
Avatar, "Ludmilla", "Analista de homologação" e o botão **Ajustes** (engrenagem
com rótulo). Nada mais: sem abas, sem chips.

### 4.2 Coluna da esquerda (resumo e navegação, fundo caixa)
1. **Recado do dia**, em primeira pessoa, montado a partir dos números (sem IA):
   "Bom dia. Desde sexta li 38 e-mails da ENEL e 199 protocolos da CPFL. Fiz 2
   coisas sozinha. Separei 5 coisas para vocês." Saudação pela hora; "desde"
   = última vez que a pessoa abriu a página, ou a última leitura do dia útil
   anterior.
2. **Para decidir:** Agora · Esta semana · Quando puder, cada um com a contagem;
   embaixo, o filtro **Fila de**: Todos · cada projetista · Sem dono.
3. **Carteira:** Parados além do normal (número em alerta) · Com a gente · Com a
   concessionária · Com o cliente · Todos os projetos.
4. **Comigo:** Fiz sozinha (contagem) · Diário.
5. **Leituras:** uma linha por concessionária acompanhada (hora da última
   leitura; em alerta quando pede alguém: "nunca lida", "espera o código",
   erro). Clicar leva aos Ajustes.

O item escolhido fica em sol. A coluna é a única navegação da página.

### 4.3 Meio: a lista da vista escolhida
- **Para decidir** (Agora / Esta semana / Quando puder): cartões completos —
  prazo (chip), responsável, a ação como título ("Cobrar a troca do relógio"),
  projeto, titular e concessionária, o porquê em primeira pessoa ("Vi que…"),
  o histórico pequeno com "14 dias na troca, o normal é até 7", e o botão
  principal. Clicar no cartão abre o detalhe à direita; o botão faz a ação.
- **Carteira**: uma linha por projeto — código e titular, concessionária,
  histórico pequeno com o tempo na etapa e o normal, com quem está, responsável.
  Ordem: mais passado do normal primeiro; depois os sem atraso, pelo tempo.
- **Fiz sozinha**: o que ela fez pelas chaves, com hora e **Desfazer** em cada um.
- **Diário**: o registro de hoje (`ludmilla_registro`), por dia, em primeira
  pessoa, marcando o que foi dela e o que foi da equipe.
- **Ajustes** (engrenagem): as quatro chaves, "Como eu te aviso" (resumo no
  WhatsApp e no e-mail) e a linha fixa "Mandar e-mail para a concessionária:
  sem chave, sempre com o clique de alguém".

### 4.4 Direita: depende da vista
- **Decisão**: chip e responsável · título · projeto · **histórico grande** ·
  "O que eu vi" (fonte e trecho) · "O que eu sugiro" com a certeza e o porquê ·
  "O e-mail que vai sair" (quando houver; texto editável como hoje) · ações ·
  "Abrir o projeto" e "Passar para outra pessoa".
- **Projeto da carteira — ficha da Ludmilla**: com quem está e responsável ·
  código e titular · empresa, concessionária e etapa · histórico grande · "O que
  eu li por último" (as últimas leituras dela sobre o projeto) · "O próximo
  passo" · botão da ação quando houver · "Abrir o projeto" (modal do GD).
- **Fiz sozinha**: as chaves ligadas hoje e "Mudar nos Ajustes".
- **Diário**: o resumo da manhã que ela mandou às 08:00 (a partir da entrega
  5; até lá, o recado do dia por inteiro).
- **Ajustes**: "Onde eu leio" — as contas das concessionárias (o que hoje está
  na aba Concessionárias: situação, meio, última leitura, Ler agora, Acesso ao
  portal, Regras de e-mail, primeira leitura da EDP, código da Elektro) e
  "Ainda não acompanho CEMIG, COPEL e Energisa".

### 4.5 Comportamentos que ficam
Desfazer em 8 s antes da mesma RPC de hoje; depois de decidir, o detalhe passa
ao próximo item da lista; o contador da barra lateral do GD (recomendações + A
fazer) continua; CAPTCHA da Elektro continua como alerta urgente acima de tudo
quando existe.

### 4.6 Estados
Carregando: esqueleto das três colunas. Erro de uma fonte: a coluna diz o que
não carregou e o resto funciona. Lista vazia: "Nada aqui agora. A próxima
leitura da ENEL é às 09:00. Se chegar algo, eu coloco aqui e aviso no sino."

## 5. A tela no celular (uma coluna por vez)
- **Fila**: faixa petróleo com menu, avatar e engrenagem; o recado em uma linha
  com "Ler o recado"; Agora / Esta semana / Quando puder como botões no topo;
  cartões completos com o botão principal na largura toda.
- **Detalhe**: tela cheia com voltar, histórico, o que eu vi, o que eu sugiro,
  e-mail; os botões fixos embaixo.
- **Menu**: a coluna da esquerda inteira, em tela cheia.
Toques de 44 px no mínimo. Segue o padrão de celular do GD (`src/mobile/`) só
onde ele não piora isto (memória `mobile-pwa`).

## 6. Regras

### 6.1 Em que grupo cai cada item
| Item | Grupo |
|---|---|
| Cobrança da troca vencida (`cobrar_troca`), troca que falhou, e-mail que voltou, CAPTCHA | **Agora** |
| Recomendação de etapa que chegou hoje | **Agora** |
| Recomendação de etapa de dias anteriores | **Esta semana** |
| Vistoria aprovada com o pedido da troca liberado | **Esta semana** (vai para Agora depois de 7 dias) |
| Projeto parado além do normal com a bola do nosso lado (item novo, 6.4) | **Esta semana** |
| Gravar protocolo, documento travado, aviso | **Quando puder** |

Dentro do grupo: mais antigo primeiro.

### 6.2 De quem é cada item
O dono do item é o projetista ligado à empresa do projeto (`staff_companies`).
Vários ligados: aparecem todos e o item conta na fila de cada um. Nenhum:
**Sem dono** (aviso no recado). O projetista abre a página com a fila dele
selecionada; o gestor abre em Todos. "Passar para outra pessoa" grava o dono no
item (não mexe no vínculo).

### 6.3 Tempo na etapa e o normal
- **Registro de etapas**: tabela nova `project_stage_log` (projeto, de, para,
  quando, quem, origem), alimentada por gatilho em `projects.status`. Carga
  inicial a partir do histórico em texto ("Etapa alterada de X para Y", desde
  19/07/2026, e "Status atualizado pelo portal") e de `last_status_change`.
- **As barras** seguem as colunas do Kanban do tenant pelas quais o projeto
  passou ou ainda vai passar; a troca do medidor (ENEL) entra como barra extra,
  contada dos dados da Ludmilla (aprovação da vistoria até a troca feita).
- **O normal** de uma etapa numa concessionária é a **mediana** do tempo que os
  projetos levaram nela nos últimos 12 meses, com no mínimo 5 passagens. Com
  menos: a mediana da etapa em todas as concessionárias, marcada "estimado";
  sem isso, o `stale_days` da coluna do Kanban; sem nada, não há alerta.
- **Parado além do normal** = dias na etapa atual maior que o normal.

### 6.4 Com quem está a bola (aprovada em 08/11; Aprovado decidido em 09/11)
| Situação do projeto | Com quem |
|---|---|
| Pendência pedida pela concessionária; aguardando instalação; **Aprovado com a empresa ainda instalando** (sem pedido de vistoria pelo painel depois de entrar em Aprovado) | **Com a empresa** (a empresa cliente) |
| Protocolo aberto esperando análise ou aprovação; vistoria solicitada; troca pedida | **Com a concessionária** |
| Recebido sem protocolo; documentação; **Aprovado com a empresa já tendo pedido a vistoria pelo painel**; vistoria aprovada sem pedido de troca; item na fila de decisão | **Com a gente** |

Decisão do usuário (09/11): "Para pedir vistoria somos nós, para instalar é com a empresa
cliente". O sinal de instalação feita é o pedido de vistoria da empresa pelo painel
(`solicitar_vistoria`, tarefas `origin = 'vistoria_request'`). Na tela, o rótulo é "Com a
empresa" (no banco, `cliente`). Em 09/11, os 49 projetos em Aprovado estavam sem esse pedido.

Parado além do normal **com a gente** vira item da fila ("Pedir a vistoria na
Elektro"), um por projeto e etapa; some quando a etapa muda.

### 6.5 As chaves (o que ela faz sozinha)
Por tenant; só o admin muda; cada mudança fica no Diário. Ligada, ela faz e
registra em "Fiz sozinha", com Desfazer; desligada, vira cartão na fila.

| Chave | O que faz | Começa |
|---|---|---|
| Gravar NT ou protocolo | Aplica sozinha o "gravar protocolo" quando a NT/protocolo vem de Carta ou portal e o campo está vazio | desligada |
| Anexar documento conferido | O que já acontece hoje (anexo com titular/UC conferidos vai ao card) | **ligada** (é o comportamento atual) |
| Mover etapa com prova forte | Aplica a recomendação quando o portal/e-mail diz a etapa com todas as letras, titular conferido, sem ressalva, **só para a frente** e **nunca para Concluído** | desligada |
| Criar tarefa para projeto parado | Cria a tarefa (`tasks`) para o dono do projeto, prazo de 2 dias, uma por projeto e etapa | desligada |

Nunca: e-mail à concessionária, solicitar vistoria, enviar documentos, CAPTCHA,
nada fora do tenant GD Manager (as mesmas proibições de hoje).

### 6.6 Fiz sozinha e Desfazer
Tabela nova `ludmilla_acoes` (o que, projeto, o antes, o depois, quando,
desfeita_em, desfeita_por). O Desfazer devolve o "antes" e o item volta para a
fila. Se o projeto mudou depois da ação, o Desfazer recusa e diz o que mudou.
Toda ação sozinha também entra em `project_history` assinada pela Ludmilla.

### 6.7 Resumo da manhã
Dias úteis, 08:00. Texto em primeira pessoa: o que leu desde a última vez, o que
fez sozinha, a fila por grupo com o responsável, os sem dono, os parados e o que
pede alguém (EDP, Elektro), com o link da página. **Só para o gestor** (o
admin que ligou o aviso em Ajustes). E-mail pelo `notify-dispatch` (Resend).
WhatsApp pelo Zé, no chat dele com o gestor — **depende do Zé instalado na VPS**
(memória `ze`); até lá a chave aparece desligada com o motivo.

## 7. Banco e serviços (novos)
- `project_stage_log` + gatilho + carga inicial (6.3).
- Função `ludmilla_normais(tenant)` → normal por concessionária × etapa, com
  amostra e a marca "estimado".
- RPC `ludmilla_carteira()` → projetos ativos acompanhados: etapa, dias, normal,
  atraso, com quem, donos, última leitura, histórico por etapa.
- Fila: `portal_afazeres` ganha o tipo `parado` (6.4), criado e fechado por um
  avaliador diário; o dono vem de `staff_companies`, e `portal_updates` e
  `portal_afazeres` ganham uma coluna de dono escolhido para o "passar para".
- `ludmilla_chaves` + RPCs ler/mudar (admin).
- `ludmilla_acoes` + RPC `ludmilla_desfazer_acao`.
- Preferências do resumo + cron das 08:00 + envio.
Tudo com RLS RESTRICTIVE por tenant e só para o tenant `is_library`, como a
Ludmilla hoje. Funções `SECURITY DEFINER` com `search_path = ''`; prova em
`begin … rollback` com os projetos reais antes de aplicar; nada de `db push`.

## 8. O que NÃO muda
O robô (leitura da CPFL, ENEL, EDP, Elektro), o casamento de e-mails, as regras
de recomendação, a cobrança e o pedido da troca (sempre com clique), o Kanban,
o modal do projeto, o contador da barra lateral, outros tenants.

## 9. Entregas (cada uma vai ao ar sozinha)
1. **Medir** — `project_stage_log`, carga inicial, `ludmilla_normais`,
   `ludmilla_carteira`. Sem tela; provado em SQL contra os projetos reais.
2. **A página nova** — mundo "Conta de luz", estrutura A, coluna da esquerda,
   fila com grupos e donos, detalhe com histórico, carteira com ficha, Diário,
   Ajustes com as contas, celular. Troca a página atual inteira. Ainda sem as
   chaves: "Fiz sozinha" lista o que ela já faz sozinha hoje (anexos
   conferidos), sem Desfazer, e os Ajustes mostram as contas e os avisos.
3. **Parados** — item `parado` na fila, avaliador diário.
4. **Chaves, Fiz sozinha e Desfazer** — as quatro chaves com o registro e o
   Desfazer. Ganha um ADR (0013): a Ludmilla age sozinha dentro do sistema por
   chave; o ADR 0012 (e-mail só com clique) continua valendo.
5. **Resumo da manhã** — e-mail primeiro; WhatsApp quando o Zé estiver na VPS.
6. **Avatar definitivo** — encomenda da ilustração (fora do código).

## 10. Como provar
- Funções puras com vitest: grupo de cada item, dono, recado, normal e atraso,
  com quem está, ordem da carteira, desenho das barras.
- SQL em `begin … rollback` com impersonação: carga do log, normais, carteira,
  chaves, Desfazer (inclusive a recusa), RLS entre tenants.
- Tela no navegador do Claude com dados de exemplo (harness, como em 25/10) e
  depois com dados reais; `web-design-guidelines` na tela pronta;
  `npx tsc --noEmit -p tsconfig.app.json` no baseline de 65 e `npm run build`.

## 11. Riscos e decisões em aberto
- **Amostra pequena**: o histórico estruturado só existe a partir de 19/07; nos
  primeiros meses muitos normais serão "estimados". A tela diz isso.
- **Com quem está a bola** (6.4): aprovada; Aprovado decidido em 09/11 (instalar é da empresa,
  pedir a vistoria é nosso). Projeto instalado sem o pedido pelo painel (avisado por telefone ou
  WhatsApp) continua aparecendo "com a empresa" até alguém registrar o pedido.
- **Destinatário do resumo**: "só o gestor" = o admin que ligar o aviso.
- **Concluído** fica fora da chave "Mover etapa" nesta versão.
- **Passar para outra pessoa** grava o dono no item; não muda o vínculo.
- **Desempenho** de `ludmilla_carteira` com todos os projetos ativos: medir na
  entrega 1.
- **Avatar** depende de ilustração encomendada.
