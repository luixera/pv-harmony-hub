# Ludmilla — a página vira uma caixa de entrada de decisões

Data: 22/10/2026 · Desenho aprovado pelo usuário em conversa · Mockup:
https://claude.ai/artifact/AnHYjm9ARHjYzdgeKY2B6L (privado; 4 telas: Decidir no
computador — clicável —, aba Concessionárias, celular lista e celular detalhe).

## 1. O problema

A `/ludmilla` (`src/pages/Ludmilla.tsx`) é uma pilha vertical: cabeçalho → CAPTCHA →
um cartão por concessionária → criações na CPFL → **Recomendações** → Registro. Os
cartões das contas por e-mail (EDP, ENEL) abrem na largura toda com regras,
contadores e o histórico inteiro de mensagens dentro. Resultado: o que pede ação da
equipe — as recomendações — fica enterrado embaixo de configuração e histórico; a
página é longa, confusa e "não é dinâmica" (palavras do usuário).

## 2. Decisões do usuário (22/10/2026)

| Pergunta | Resposta |
|---|---|
| O que a equipe vem fazer na maioria das vezes? | **Decidir recomendações** |
| Como decidir quando há várias? | **Lista compacta + painel de detalhe ao lado** |
| Uso no celular? | **Às vezes** (decidir uma, digitar o código da Elektro) |
| Organização da página | **A: caixa de entrada + abas secundárias** |
| Avisos do sino (vistoria aprovada, troca que falhou, e-mail que voltou) | **Entram na página como itens "A fazer", com botão "Feito"** |

## 3. O desenho

### 3.1 Topo (sempre visível)
- **Alertas urgentes**, só quando existem, acima de tudo: código da imagem da
  Elektro (5 min), concessionária com erro ou sessão expirada, caixa de e-mail não
  configurada.
- **Faixa de saúde**: um chip por concessionária — ponto de saúde, nome, meio
  (portal/e-mail/estação), "lida há X", número de pendentes. Clicar filtra a lista;
  um botão ao lado do chip faz "Verificar agora". "Todas" limpa o filtro.

### 3.2 Aba "Decidir" (a de abertura, com o número de pendentes)
- Busca (projeto, titular, empresa, protocolo); situação **Pendentes · Aplicadas ·
  Ignoradas · Todas**; filtros por tipo **Mudar etapa · Gravar protocolo ·
  Bloqueados · A fazer**.
- **Linha compacta**: ícone do meio, código, concessionária, há quanto tempo,
  titular, empresa e selos (`Em análise → Aprovado`, `Gravar protocolo`,
  `Documento anexado`, `Documento bloqueado`, `A fazer: …`). Ordem: mais antigas
  primeiro.
- **Painel de detalhe**: *Quem* (titular, empresa, UC, protocolo no cadastro, "no
  portal: …" quando difere); *O que chegou* (remetente e assunto, ou status do
  portal; resumo da IA; itens/pendências da Carta; documento anexado com "Abrir");
  *A sugestão* (de → para, seletor de etapa com a recomendação, troca de protocolo
  explicada, ressalvas); *Ações* (Aplicar / Ignorar; "Aplicar etapa e protocolo"
  quando há troca; "Marcar como feito" no A fazer; "Dispensar" no bloqueado);
  *Este projeto na Ludmilla* (linha do tempo).
- Depois de decidir: o painel vai para a próxima pendente e aparece "PRJ-x foi
  para Aprovado … · Desfazer".

### 3.3 Abas secundárias
- **Concessionárias**: um cartão por conta — situação, meio, última leitura,
  contadores da última leitura, regras de e-mail (recolhidas), "O que ela leu na
  caixa", "Verificar agora", "Acesso ao portal". Tudo o que hoje empurra as
  decisões para baixo vem para cá.
- **Criações na CPFL**: o que existe hoje (passos com print), mais o número da CPFL.
- **Registro**: o que existe hoje (Ela fez / A equipe fez).

### 3.4 Celular
Chips em linha rolável; lista em tela cheia; tocar abre o detalhe por cima, com
Ignorar/Aplicar fixos embaixo; abas viram barra inferior.

## 4. O que muda nos dados

- **Recomendações**: nada novo. O detalhe junta o que já existe: `portal_updates`
  (+ projeto, empresa, titular — já no select desde a Task 7 da ENEL),
  `portal_email_mensagens` (assunto, remetente, resumo, motivo, arquivo lido — via
  `update_id`) e `portal_anexos`/`portal_pareceres` do projeto.
- **"Este projeto na Ludmilla"**: a união que `ludmilla_registro` já faz, filtrada
  por projeto (RPC nova ou parâmetro novo, só leitura).
- **"A fazer" — tabela nova** (decisão do usuário): hoje o aviso é só uma linha em
  `notifications` POR PESSOA. "Feito" precisa ser da EQUIPE, uma vez. Proposta:
  `portal_afazeres (id, tenant_id, account_id, project_id, message_id, tipo,
  titulo, mensagem, criado_em, feito_por, feito_em)` com RLS RESTRICTIVE por tenant
  (+ `is_library`, como o resto da Ludmilla), gravada pela mesma RPC que toca o sino
  (`ludmilla_email_avisar`, idempotente por mensagem como o `aviso_em`) e
  `ludmilla_afazer_feito(id)` (SECURITY DEFINER, equipe do tenant). O sino continua.

## 5. O que NÃO muda

- Ela só sugere; quem aplica é uma pessoa (`ludmilla_aplicar_update` intocada).
- Nenhuma regra de identificação, classificação ou varredura muda.
- `/ludmilla` continua só para a equipe do GD Manager (`useLudmillaDisponivel`).

## 6. Ordem e dependências

A frente da ENEL por e-mail mexe nos mesmos arquivos (`Ludmilla.tsx`,
`useLudmilla.ts`, `MensagensEmail.tsx`) e está na revisão final + rodada de
fechamento. **A implementação desta página começa depois que a rodada de fechamento
da ENEL for commitada**, para não haver duas frentes no mesmo arquivo.

## 7. Riscos

- A página é o ponto de decisão diário: a troca tem de ser completa no primeiro
  deploy (sem meia-página). Mitigação: a aba Decidir substitui a seção de
  Recomendações de uma vez, sobre os MESMOS hooks e RPCs de hoje (só a tela muda), e
  a prova na tela cobre CPFL, EDP e ENEL antes do commit.
- Ações em lote ficaram FORA (o usuário escolheu lista + painel, não lote).
- A primeira leitura de 30 dias da ENEL pode encher o "A fazer" com avisos de coisas
  já feitas: oferecer "Marcar todos desta concessionária como feitos" só se o
  primeiro run mostrar o problema.
