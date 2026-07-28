# Decisões de Produto

Registro de decisões de produto/UX (não arquiteturais — essas ficam em
[../adr](../adr/README.md)). Decisões tomadas com o cliente.

## Log

- **Microinversores: regras próprias e duas representações** (jul/2026): caso
  real trazido pelo usuário (projeto MARA, Hoymiles HMS-2000 4T + DAH 610Wp).
  Perguntas feitas e respondidas por ele: (1) **as duas representações**, com
  escolha na hora de gerar — compacto (1 fileira por ramal, quantidades nas
  legendas) e esquemático (cada micro com os seus módulos, encadeados no
  barramento CA, como a prancha que ele mandou); (2) o limite de micros por
  ramal é **regra editável com padrão 3**, e o datasheet do micro sobrepõe
  quando preenchido. Daí decorre que a corrente do ramal **não corta** o número
  de micros: quando 3 × 9,09A passa dos 25A previstos, o motor avisa e dá as
  duas saídas, mas quem decide é o projetista. Limite de folha assumido: a
  seguimentação de 2+ ramais não cabe em A4 junto do padrão de entrada — a UI
  desabilita a opção e explica; prancha separada fica como próximo passo.

- **Equipotencialização no BEP e geometria dos nós** (jul/2026): o usuário
  pediu para trocar o aviso de aterramento por uma declaração explícita —
  "adicione embaixo da legenda dos DPS 'Conectado ao BEP' como se todos os
  pontos fossem interligados; as concessionárias pedem que o aterramento do
  padrão, o neutro e o aterramento da edificação sejam equipotencializados".
  Decisão: os dois DPS ganham essa legenda e o desenho traz a nota normativa
  citando a NBR 5410; o validador passa a aceitar essa indicação como
  aterramento presente (em vez de cobrar o símbolo de terra desenhado).
  Na sequência, com duas fotos do diagrama gerado: "ajuste os nós e pontos de
  ligação entre os componentes, como exemplo o bug da ligação no DPS; deixe o
  seguimento entre o QGBT Solar e o padrão de entrada um pouco maior".
  Decisões: (1) todo ponto de derivação nasce **no eixo da porta** do
  componente — o degrauzinho no DPS era o roteador ortogonal costurando 2mm
  de desalinhamento; (2) arranjo entra no nó do tronco **em esquadro**
  (horizontal na altura da fileira, vertical pra dentro do nó) em vez do Z
  automático; (3) o eixo do tronco desceu pra passar **por baixo da tabela de
  legenda**, o que liberou a largura da folha e abriu 20mm de vão entre o
  QGBT e o padrão de entrada (eram 3mm) sem trocar a prancha de A4.

- **QGBT Solar e regra do inversor único** (jul/2026): pedido do usuário —
  "com 1 inversor, o disjuntor do inversor e o geral são o mesmo, apenas um
  é suficiente"; "deixe o DPS CA mais próximo do disjuntor do inversor (com
  2, na junção)"; "coloque um tracejado igual ao do padrão de entrada com
  nome QGBT Solar". Decisões: o disjuntor único ganha a legenda "(arranjo +
  geral)" pra o analista não procurar um segundo; o DPS CA passa a derivar
  do TRONCO no mesmo nó da junção (antes vinha do barramento pós-geral); e
  o QGBT vira uma caixa de grupo com `moveContents`, então o quadro inteiro
  se move junto no editor. Junto veio a limpeza de **pontuação órfã** nos
  documentos: campo vazio em template com tags separadas deixava "Rua X,
  2007, , São José" — o gerador agora normaliza o texto renderizado.
  (jul/2026)

- **Diagrama harmônico: rótulos móveis, disjuntores calculados e bitola por
  trecho** (jul/2026): pedidos do usuário depois de usar o motor num projeto
  real. (1) Rótulos dos componentes coladinhos no símbolo (3,4mm em vez de
  5mm) e **arrastáveis** — o texto guarda só o deslocamento, então acompanha
  o símbolo quando ele se move; duplo-clique devolve ao lugar padrão.
  (2) **Disjuntor de cada arranjo dimensionado pela corrente CA de saída do
  inversor** (campo novo no catálogo: "Corrente CA máx. de saída"), e o
  **geral proporcional à SOMA das correntes** — decisão: nunca somar os
  disjuntores individuais (superdimensiona); quando o geral fica abaixo
  dessa soma, o motor explica o porquê. Ao gerar o diagrama, o sistema
  PERGUNTA se o disjuntor geral entra. (3) **Bitola marcada em cada trecho**
  (CC, CA de cada arranjo, tronco pós-junção) reusando o rótulo de ligação
  que já existia — mesma linguagem do padrão de entrada. (jul/2026)
- **UX de linhas, folha e teto de string** (jul/2026): lote de ajustes do
  usuário usando o motor de verdade. (1) "Não consigo excluir um traço de
  linha, só movimentar" → agora dá pra apagar UM trecho (Delete no traço
  clicado ou menu de contexto): trecho de ponta encurta a linha, trecho do
  meio parte em duas. (2) Bugs de interseção: o encaixe grudava sempre na
  primeira linha do par (a junção pulava de lugar quando a outra se movia)
  e cada junção existente virava uma "interseção fantasma" — os dois
  corrigidos. (3) O tracejado do PADRÃO DE ENTRADA cobria a tabela de
  legenda: o desenho automático passou a respeitar a coluna reservada da
  legenda (nada além de x=235). (4) Símbolo da rede virou um POSTE de
  distribuição (cruzeta + isoladores) e o rótulo passou a nomear a
  concessionária ("Rede – CPFL"). (5) **Bug de regra**: o teto de módulos
  por string só era aplicado quando o equipamento NÃO tinha datasheet — por
  isso o ajuste do usuário "não surtia efeito" e apareciam strings de 14/16
  módulos em inversor pequeno. O teto agora vale sempre, e há regra nova:
  inversores até 10 kW → no máximo 11 módulos por string (ambos editáveis
  nas Regras de Engenharia). (jul/2026)
- **Validador elétrico + memoriais ENEL/EDP** (jul/2026): dos próximos
  passos propostos, o usuário escolheu "vamos iniciar pelo validador
  elétrico e pela confecção de 2 memoriais descritivos", enviando os
  modelos reais da ENEL e da EDP. Decisões de produto: **sem lista de
  equipamentos/materiais** ("as concessionárias não exigem isso"); cada
  concessionária tem seu PRÓPRIO layout de memorial (os dois modelos foram
  recriados como templates .docx com tags, em docs/modelos-memoriais/,
  para subir na tela de Templates); o arranjo de strings no memorial é a
  mesma melhor sugestão do Motor de Engenharia ("Usar esta") e as
  bitolas/disjuntores vêm do dimensionamento pelas regras. O validador
  roda em tempo real no diagrama do projeto, sem IA, e nunca bloqueia.
  (jul/2026)
- **Placas de advertência: FOTO REAL nativa no diagrama** (jul/2026): o
  usuário enviou as fotos das placas exigidas e pediu — explicitamente
  ("quero a imagem nativa no diagrama, não uma representação") — que a
  própria imagem fosse usada no lugar de um redesenho vetorial. Decisão: as
  duas fotos (amarela "CUIDADO / RISCO DE CHOQUE ELÉTRICO / GERAÇÃO
  PRÓPRIA" para CPFL e demais; ENEL "AVISO / RETORNO GERADOR DE ENERGIA")
  foram comprimidas (~360px, JPEG q72, ~20KB) e embutidas como data URLs em
  `cadEngine/warningPlates.ts`; o gerador as coloca como `PlacedPhoto`
  (aparecem no canvas, SVG e PDF; o DXF R12 não carrega raster — pra DXF há
  as versões vetoriais `warning-sign`/`warning-sign-enel`, mantidas na
  paleta). A escolha da placa é automática pelo nome da concessionária do
  projeto (contém "enel"). (jul/2026)
- **Motor de Engenharia — padrão de entrada no diagrama + auto-reorganização**
  (jul/2026): pedidos do usuário: "Está faltando o disjuntor do padrão de
  entrada, ao lado do medidor — o disjuntor do padrão + medidor
  correspondem a um bloco do padrão de entrada que já cadastramos suas
  regras anteriormente em concessionárias"; "o próprio layout deve se
  reorganizar em caso de projetos com vários inversores"; "adicionar a
  placa de advertência de geração própria como componente"; "as
  concessionárias estão pedindo DPS no padrão de entrada também — em
  paralelo ao disjuntor do padrão". Decisões: o bloco PADRÃO DE ENTRADA é
  uma caixa de grupo (move tudo junto) e a legenda do disjuntor do padrão
  REUSA as regras de `concessionaire_entry_rules` via `matchEntryRule`
  (nenhuma regra duplicada); a reorganização comprime espaçamento e reduz
  a escala dos ramais em vez de aumentar a prancha (A4 é o formato aceito
  nas homologações); símbolo novo `warning-sign` na paleta. Ver
  [ADR 0007](../adr/0007-engineering-rules-engine.md). (jul/2026)
- **Motor de Engenharia — topologia multi-arranjo + edição livre no
  projeto** (jul/2026): pedido do usuário: "Em casos de arranjos com mais
  de um inversor, precisamos colocar um disjuntor para cada arranjo. Um
  disjuntor para seccionar os dois arranjos ou mais pode ser opcional. O
  DPS deve ficar em paralelo após a junção dos dois arranjos. Deve ser
  prevista também, apenas para referência, um caminho para indicar as
  cargas do local. Permita a edição manual direta na aba do diagrama no
  modal de projetos." Decisões: disjuntor por arranjo é OBRIGATÓRIO na
  cena gerada; o disjuntor geral e o caminho de cargas são regras
  liga/desliga do próprio motor (`protections.include_general_ac_breaker`
  e `arrays.include_loads_reference` — editáveis com histórico como
  qualquer regra); a cena gerada sai 100% com ids `manual-`, então é
  editável livremente e o reconcile nunca recria nada por cima; e o
  editor passou a permitir REMOVER qualquer componente no diagrama do
  projeto (inclusive os fixos do cadastro — `suppressedIds`; "Restaurar"
  traz de volta). Ver [ADR 0007](../adr/0007-engineering-rules-engine.md).
  (jul/2026)
- **Motor de Engenharia (Engineering Rules Engine) — Fase 1** (jul/2026):
  pedido detalhado do usuário ("antes de criar me fale o que vai fazer...
  o objetivo é ser prático, sem complicação, para que alguém com baixo
  conhecimento de engenharia possa atuar"), plano apresentado e aprovado
  ("pode seguir"). Decisões de produto: regras 100% no banco (nada fixo em
  código), editáveis na aba "Regras de Engenharia" do Motor de Templates
  com histórico automático; o motor NUNCA desenha e NUNCA bloqueia (só
  alertas âmbar com sugestão de correção); sempre ≥2 sugestões quando há
  mais de uma opção válida, explicadas em português simples com a fonte
  (NBR/fabricante/interna); no projeto, o painel verde "Motor de
  engenharia" mostra as opções e "Usar esta" já gera o diagrama. Validado
  com os exemplos do briefing (120 módulos → 6×20 e 5×24; 240 módulos em
  2×75kW → 120+120 e 118+122). Ver
  [ADR 0007](../adr/0007-engineering-rules-engine.md). (jul/2026)
- **Diagrama unifilar — desenho livre de linhas de volta (reversão da 7ª
  rodada, a pedido)** (jul/2026): "além de não precisar conectar uma linha
  até outro componente para desenhá-la, quero poder desenhá-la livremente".
  A regra "linha sempre termina em algo" (que também tinha vindo de pedido
  direto, na 7ª rodada) foi relaxada no Traçar: começa em qualquer lugar
  (inclusive interseção de linhas, com nó de junção), duplo-clique/Enter
  termina a linha solta, arrastar uma ponta pro vazio a deixa lá. Os
  encaixes inteligentes (porta/componente/final/interseção/corpo) continuam
  com prioridade quando o cursor está perto — liberdade e precisão
  convivem. O arrastar-da-porta segue exigindo alvo (anti-lixo acidental).
  Ver [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — 13ª rodada: Fase E, Organizar, DXF, paramétrico e
  aprendizado** (jul/2026): dos próximos passos propostos, o usuário
  escolheu "1, 3, 4, 5 e 6 (porém ainda não libere para os tenants)" — o
  validador elétrico local (item 2) ficou de fora por escolha, e a
  liberação a outros tenants segue travada pela checagem de `is_library`.
  Entregues: componente em série solto EM CIMA de uma linha divide a
  ligação (e remover refaz o fio); condutores com tipo CA/CC/terra
  (cores/tracejado idênticos no canvas, SVG, PDF, DXF e legenda); botão
  "Organizar" (alinha fileiras/colunas e re-roteia); exportador DXF R12
  com camadas; casamento de modelo por concessionária + nº de inversores e
  multiplicação automática do ramal FV; e o loop de aprendizado — as
  correções do engenheiro revisor viram lições injetadas nos prompts das
  próximas importações. Ver [ADR 0006](../adr/0006-cad-engine-alpha.md).
  (jul/2026)
- **Console master — extrato "Agentes de IA" com saldo local** (jul/2026):
  pedido do usuário: "um extrato de uso dos agentes que já temos... saldo
  atual e outras informações... para que a gente não deixe a conta sem
  saldo e se programe para sempre reabastecer". Decisão: a API da Anthropic
  não expõe o saldo da conta, então o saldo é um **livro-caixa local** — o
  master lança cada recarga comprada (USD) e o sistema desconta o custo de
  cada chamada calculado dos **tokens reais** (as edge functions passaram a
  registrar modelo + input/output tokens em `ai_usage_log`; chamadas
  antigas sem tokens entram por estimativa média por tipo). A tela mostra
  saldo, gasto do mês, projeção de "quantos dias o saldo aguenta" no ritmo
  do mês e alerta âmbar/vermelho pra programar a recarga. (jul/2026)
- **Diagrama unifilar — motor de conexões vivas em 4 fases** (12ª rodada):
  o usuário pediu que o motor ficasse "dinâmico como precisamos, inclusive
  com o desenho de linhas, ligação entre os componentes, entre as próprias
  linhas e figuras para determinar seções", com o plano completo
  apresentado antes de implementar (aprovado: "pode fazer"). As 4 fases:
  (1) conexões vivas — portas nomeadas na geometria de cada símbolo,
  derivação FORMAL que acompanha a linha-mãe (a antiga era ponto fixo que
  ficava pra trás) com nó de junção (•) como nos unifilares reais, remoção
  nunca apaga derivações em cascata; (2) desenho em esquadro com Shift pra
  liberar, prévia elástica, rotas automáticas desviando de símbolos, guias
  de alinhamento magenta, arrastar um segmento só; (3) figuras de anotação
  (retângulo/elipse/divisória/seta), grupo com traço sólido/tracejado e
  "arrastar conteúdo junto", frente/trás pra figuras e fotos; (4) modos
  Selecionar×Ligar explícitos e menu de contexto no botão direito.
  Diagramas já salvos continuam abrindo sem migração. Ver
  [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — "agente engenheiro" virou 2ª passada de revisão por
  IA** (11ª rodada): o usuário, ainda insatisfeito com a fidelidade da
  importação nativa, sugeriu "um agente de IA com características de
  engenheiro para ajudar nas definições e criação dos templates a partir de
  um modelo". Decisão de produto: em vez de um chat interativo, a persona de
  engenheiro revisor roda como **2ª passada automática da importação** e
  como **botão sob demanda** ("Revisão do engenheiro") no editor de modelos
  — a IA recebe o documento original E uma imagem do nosso redesenho lado a
  lado, revisa com checklist de engenharia (tipos, disposição, ligações,
  coerência elétrica da cadeia FV) e devolve o diagrama corrigido + notas do
  que mudou (banner no editor). As duas funções de diagrama subiram pro
  modelo mais capaz (Opus + adaptive thinking) — importar/revisar é raro e
  de alto valor, diferente do Claudinho que roda em todo envio. Ver
  [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — revisão completa aprovada em 4 fases; entregues a
  folha profissional e o reconhecimento com posições + fundo do PDF**
  (10ª rodada, mesmo mês): o usuário avaliou que o resultado "ainda está
  muito cru" e pediu uma revisão de tudo com propostas significativas
  (funcional, sólido, com UX). Diagnóstico apresentado e aprovado ("sim"):
  o que existia era um editor de diagrama de blocos, não de unifilar. Plano
  em 4 fases na ordem A folha profissional → C reconhecimento fiel +
  underlay → B UX do editor → D fechar o ciclo template→projeto — **as 4
  entregues na mesma rodada**. A e C: legenda automática, carimbo completo (resp. técnico/ART/revisão
  como campos da folha com tags), caixas de agrupamento, bitola por
  ligação; reconhecimento passou a pedir posições normalizadas 0–100 à IA
  (revisão explícita da decisão anterior de "nunca pedir posição" — posição
  RELATIVA é confiável, mm exato não) e o PDF original agora aparece
  esmaecido no fundo do editor pra conferência (nunca no arquivo
  exportado). B: undo/redo, zoom/pan, painel de propriedades no lugar dos
  prompts, multi-seleção/duplicar. D: diagrama do projeto saiu do
  localStorage pro banco (project_diagrams) e o modal do projeto agora
  IMPORTA modelos (dropdown + sugestão por concessionária — decisão de UX
  que estava pendente desde a 6ª rodada). Validado com o diagrama ENEL
  real: disposição espacial preservada. Ver
  [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — reconhecimento de PDF ganha stage/branch (fileira
  principal + derivações) em vez de fileira única** (9ª rodada, mesmo mês):
  a primeira importação real ficou aquém do esperado ("falhou
  vergonhosamente"); perguntado, o usuário esclareceu que o objetivo é o PDF
  "ser redesenhado no editor" pra não precisar montar do zero — decisão da
  8ª rodada (só topologia, sem nenhuma noção de posição) ficou curta demais.
  Resolvido sem tentar coordenada mm exata (continua fora de alcance
  confiável pra IA de visão): a IA passou a informar `stage` (posição no
  fluxo principal) e `branch` (é derivação?) por componente, e o layout
  inicial usa isso pra já sair parecido com um unifilar de verdade. De
  quebra, corrigido um bug real (2 chamadas separadas create+update podiam
  deixar um modelo órfão vazio se a segunda falhasse — virou 1 insert
  atômico) e adicionada normalização de sinônimos de `kind` pra reduzir o
  risco de uma resposta boa da IA virar "0 componentes" por uma diferença de
  string. Ver [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — reconhecimento de PDF só reconhece topologia, símbolos
  recalibrados por um 2º diagrama real** (8ª rodada, mesmo mês): pedido do
  usuário pra "ir pro próximo nível" (reconhecimento automático, adiado desde
  a 6ª rodada) e reaproveitar a legenda de um segundo diagrama unifilar real
  (ENEL) enviado como referência pra substituir símbolos aproximados por
  símbolos calibrados. Duas decisões: (1) o reconhecimento (`diagram-recognize`,
  IA de visão via Anthropic, mesmo padrão do Claudinho) devolve **só
  topologia** — quais componentes existem e como se ligam — e nunca posição,
  rotação ou coordenadas; pedir isso à IA teria taxa de erro alta demais pra
  ser confiável, e o editor manual já existente é rápido o bastante pra
  reposicionar, então o resultado sempre abre com um aviso de revisão
  obrigatória antes de considerar o modelo pronto; (2) a legenda do segundo
  diagrama revelou que o disjuntor genérico e o medidor confundiam variações
  reais (bipolar/tripolar, convencional/bidirecional) e faltava chave CC —
  viraram 3 símbolos novos (`breaker-tripolar`, `meter-bidirectional`,
  `dc-switch`) em vez de generalizar os existentes, pra não perder a
  distinção visual que aparece nos diagramas reais. Dados pessoais do PDF de
  referência (titular, endereço, ART) não entraram em nenhum lugar do
  código/prompt — só a legenda de símbolos (informação genérica/técnica) foi
  usada. Ver [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — linhas nunca ficam soltas no vazio** (7ª rodada):
  reversão parcial da decisão da 4ª rodada. Pedido direto: "não deixe que as
  linhas possam ser desenhadas livremente, mas sim, conectando componentes
  uns aos outros ou em outras linhas". A "linha totalmente livre" (as duas
  pontas soltas, sem ligar a nada) foi removida — uma ligação agora sempre
  termina num componente ou em cima de outra linha (derivação). O botão
  "Terminar aqui" (que fechava a ligação num ponto cru) foi removido junto —
  clicar numa linha durante o desenho já fecha ali. Arrastar uma ligação já
  existente pro vazio também deixou de ser possível: volta pro lugar se não
  achar componente/linha perto. Ver [ADR 0006](../adr/0006-cad-engine-alpha.md).
  (jul/2026)
- **Diagrama unifilar — alpha só para master/GD Manager**: começar com uma
  fatia vertical dentro do app (sem monorepo, sem dependência nova) em vez do
  motor completo da proposta de arquitetura. Duas correções de rota no mesmo
  dia, ambas por feedback direto: (1) a entrada não devia ser uma aba dentro
  do modal do projeto sozinha sem contexto — mantida ali mesmo (não virou
  página separada no menu, que exigiria o editor visual completo, semanas de
  trabalho); (2) a primeira versão (só leitura) foi considerada simples
  demais — incrementada com edição manual (arrastar, girar, ligar
  componentes), persistida em `localStorage` por projeto. Motor de layout
  automático e templates reutilizáveis continuam no roadmap. Símbolos
  aproximados de IEC 60617 até o usuário enviar unifilares reais aprovados
  para calibração. Ver [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — componentes/fotos avulsos e desenhar linha** (3ª
  rodada, mesmo mês): componentes adicionados manualmente (2º inversor, DPS,
  disjuntor extra) são **só visuais**, sem exigir cadastro real no projeto —
  prioriza flexibilidade do desenho sobre consistência estrita com
  `project_equipment`. "Desenhar linha" virou parte do próprio modo de ligar
  (clicar pontos no canvas antes do destino), em vez de uma ferramenta
  separada. Foto é elemento do diagrama (arrasta/redimensiona, sai impressa),
  não fundo de referência. Ver [ADR 0006](../adr/0006-cad-engine-alpha.md).
  (jul/2026)
- **Diagrama unifilar — derivações/linhas soltas, tags, motor de templates
  fica pra depois** (4ª rodada, mesmo mês): "outros caminhos com as linhas" =
  derivação de uma linha existente **e** linha solta, as duas — resolvido
  unificando `from`/`to` da ligação num tipo só (`ConnectionEndpoint`:
  componente OU ponto fixo), em vez de dois mecanismos separados. "Legendas"
  = texto solto **e** editar legenda do componente **e** puxar as tags do
  projeto — reaproveitado o catálogo já existente dos templates .docx
  (mesmo `{chave}`), em vez de inventar um novo sistema de variáveis só para
  o diagrama. Confirmado com o usuário: o **motor de templates de diagrama**
  (salvar/aplicar modelos reutilizáveis) vai ganhar uma **tela própria numa
  etapa futura**, fora do modal do projeto — até lá, o editor ad-hoc dentro
  do modal continua recebendo incrementos diretos (redimensionar, arrastar
  linha como bloco, excluir com Delete). Ver
  [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Diagrama unifilar — motor de templates em aba própria, acesso muda de
  "só master" pra "admin/staff da GD Manager"** (6ª rodada, mesmo mês):
  pedido do usuário pra "ir pro próximo nível" — sair de editar dentro do
  modal do projeto pra ter uma aba dedicada de motor de templates, acessível
  ao projetista (staff) e ao administrador, não só ao master. Duas decisões:
  (1) **escopo de acesso continua restrito à GD Manager por enquanto** — não
  libera pra todos os tenants nesta rodada, só muda quem dentro da GD
  Manager acessa; (2) **reconhecimento automático a partir de um PDF
  enviado** (pedido separado do usuário) fica pra uma iniciativa própria e
  dedicada, depois de validar a base do motor de templates com criação
  manual — não é um ajuste incremental, é outro projeto (IA de visão, não
  um parser). O usuário mandou um diagrama unifilar real (ENEL) como
  referência durante a implementação; não usado pra reconhecimento
  automático (adiado), mas a legenda dele revelou 3 símbolos faltando
  (fusível, aterramento, quadro de distribuição), adicionados por serem
  baratos e melhorarem a qualidade de qualquer template novo. Ver
  [ADR 0006](../adr/0006-cad-engine-alpha.md). (jul/2026)
- **Visão master de empresas por tenant**: drill-down dentro da aba **Tenants**
  do `/painel` (não uma aba nova) — cada tenant expande para suas empresas, e
  cada empresa para seus projetos. Só o master vê, via RPCs `is_master`-gated.
  (jul/2026)

- **Precificação por faixa fixa** (`tiered_flat`): faixas de/até kWp com **preço
  fechado** por projeto, além da faixa por kWp existente. No limite exato, vale a
  faixa que termina nele. (jul/2026)
- **Logo nos relatórios**: os PDFs usam **o logo do tenant** (não o da empresa).
  O logo da empresa fica para a identidade dela (autoatendimento no perfil).
- **Anexos extras no formulário** ficam disponíveis para incluir no pacote do
  projetista.
- **Documentos de PJ** (cartão CNPJ, contrato social, doc. do responsável,
  procuração) são **opcionais com aviso** — não travam o envio.
- **Coordenadas manuais** (lat/long) sempre visíveis no formulário; na maioria
  dos casos não vêm do endereço. No form público valem para qualquer projeto,
  não só rural.
- **Concessionárias, formulários e Kanban** são copiados para o tenant no
  cadastro (biblioteca), com aviso de atualização e reimport seletivo — para
  facilitar o onboarding do SaaS.
- **AFCI é documento da marca** do inversor: novo equipamento da mesma marca
  herda o certificado; certificado novo se propaga aos que não têm (sem
  sobrescrever).
- **Claudinho não altera o projeto sozinho**: lê o e-mail, casa pelo protocolo e
  **sugere** a etapa; a aplicação é do usuário (automação é passo futuro).
- **Catálogo de equipamentos é compartilhado** entre todos os tenants (cresce
  mais rápido). Gerar documento força o cadastro no catálogo.
