# ADR 0006 — CAD Engine: fatia vertical dentro do app, antes do motor completo

**Status:** Aceito · jul/2026

## Contexto
Existe uma proposta de arquitetura completa para um motor de geração de
diagramas unifilares (`DIAGRAMA UNIFILAR/cad-engine-arquitetura.md`, fora deste
repositório): pacote isolado `packages/cad-engine/`, motor de layout
automático com grafo elétrico e roteador ortogonal, biblioteca de símbolos
declarativa versionada, exportadores SVG/PDF/DXF/PNG sobre uma IR neutra
(Scene Graph). É um projeto de semanas, com 6 decisões explicitamente
pendentes de aprovação no próprio documento (§14).

Este repositório é hoje um app Vite único, sem estrutura de monorepo.

## Decisão
Implementar primeiro uma **fatia vertical mínima** dentro do app atual, sem
criar monorepo nem adicionar dependências pesadas novas:

- Módulo comum em `src/utils/cadEngine/` (não um pacote `packages/` isolado).
- **Layout fixo** (fileira única, ordem pré-definida) em vez do motor de
  grafo/roteamento automático da proposta completa.
- **Scene IR** mantida como conceito (D1 da proposta): layout e exportadores
  não se conhecem, um exportador novo é ~1 arquivo.
- Exportador PDF via `jsPDF` (já usado em `resumoPdf.ts`), não `pdf-lib` —
  evita dependência nova para o alpha.
- Símbolos aproximados de IEC 60617, a recalibrar com unifilares reais da
  GD Manager quando o usuário os enviar.
- Escopo de acesso: só o master, e só sobre projetos do próprio tenant do
  master (GD Manager) — obtido de graça pelo gate `user.isMaster` no front,
  porque o master no app normal já só vê o próprio tenant (ADR 0005).

## Consequências
- Ganha-se feedback visual em dias, não semanas, antes de investir no motor
  geral.
- O código atual **não** segue a estrutura de pastas nem os contratos exatos
  da proposta original (sem `ILayoutEngine`, sem `ISymbolProvider`, sem
  `IExporter` genérico) — é deliberadamente mais simples.
- Migrar para o motor completo depois exigirá reescrever `layout.ts`
  (hoje fixo) por um motor de grafo real, e possivelmente promover
  `src/utils/cadEngine/` a pacote isolado se/quando houver um segundo
  consumidor (ex.: um editor visual separado, como o `cad-editor` da
  proposta). A IR (`Scene`) e os exportadores (SVG/PDF) tendem a sobreviver
  a essa migração sem reescrita, por já seguirem o princípio D1.
- Suporta só a cadeia PV→Inversor→Disjuntor→Medidor→Rede — projetos com BESS,
  múltiplos inversores/QDCs ou geração compartilhada não são representados
  ainda.

## Atualização (mesmo dia)
O primeiro recorte era só leitura (prévia calculada). Feedback direto do
usuário: "muito simples" — pediu incrementar com **arrastar, girar e ligar
manualmente**, aceitando que fosse gradual. Implementado o
`ManualLayoutSource` do §17.2 **antes** do motor automático (inversão
deliberada da ordem do roadmap original — ver `docs/modules/diagrams/overview.md`).
Persistência ficou em `localStorage` por projeto (não é o `DiagramTemplate`
do §17.3, que continua no roadmap).

## Atualização (mesmo dia, 2ª rodada)
Novo feedback direto: "ainda está bem simples" — três pontos concretos:
1. **Disjuntor com orientação errada**: o símbolo (`symbols.ts`) tinha sido
   desenhado como chave **vertical**, enquanto todo o resto do diagrama (e o
   roteamento de condutores, que assume conexão nas bordas esquerda/direita à
   altura `y = H/2`) flui na **horizontal**. Redesenhado como chave horizontal.
2. **Arrastar não pegava de qualquer ponto do símbolo**: primitivos com
   `fill="none"` só capturam clique em cima do traço em SVG, não no interior —
   corrigido com uma área de clique invisível (`fill="transparent"`) do
   tamanho da caixa do símbolo, ver `docs/modules/diagrams/overview.md`.
3. **Traço de linha 100% automático**: adicionados pontos de dobra
   (`waypoints`) arrastáveis por conexão — arrastar o traço cria um ponto novo
   ali; arrastar um ponto existente o reposiciona; duplo-clique remove.
   `computeConnectorPoints` (`editableLayout.ts`) decide entre o roteamento
   ortogonal automático (sem pontos de dobra) e o caminho manual exato
   (com eles).

## Atualização (3ª rodada) — componentes/fotos avulsos + desenhar linha
Pedido do usuário: mexer mais na linha, "ter a opção de desenhar", e poder
adicionar componentes (inversor extra, módulos, DPS, disjuntor) e uma foto ao
diagrama. Decisões tomadas com o usuário antes de implementar (3 perguntas):
- **Componentes extras são só visuais** — não precisam existir no cadastro do
  projeto; ficam junto do layout manual (`localStorage`), sem tocar em
  `project_equipment`. Habilita, por ex., um DPS (símbolo novo,
  `ComponentKind` ganhou `dps`) mesmo sem campo de cadastro pra isso.
- **"Desenhar linha" virou parte do mesmo modo de ligar**: clicar na origem,
  depois no destino liga direto (como antes); clicar em pontos vazios do
  canvas antes do destino desenha o traço manualmente, já na criação da
  ligação (em vez de só poder ajustar depois, arrastando).
- **Foto é elemento do diagrama** (não fundo/referência): vira um bloco
  arrastável/redimensionável, sai impressa no SVG/PDF. `Primitive` ganhou a
  variante `image`; `LayerId` ganhou `PHOTO`.

Ao implementar, um teste headless (`node` + `esbuild`, mesma técnica já usada
nesta fatia) pegou um bug antes do commit: o `reconcile()` que funde o layout
salvo com o projeto atual usava "id ausente do projeto atual" como critério
para decidir o que era "componente manual" — mas um componente **real**,
removido do cadastro do projeto, cai no mesmo caso e viraria um fantasma
permanente no diagrama. Corrigido adotando um marcador estável: todo id criado
manualmente pelo `addComponent()`/upload de foto começa com `manual-`, e é
esse prefixo (não a ausência no projeto atual) que decide o que sobrevive à
reconciliação.

## Atualização (4ª rodada) — derivações/linhas soltas, redimensionar, tags
Feedback: "está ficando bom", com pedidos concretos de mexer mais na linha
(excluir, criar outros caminhos), legendas, redimensionar componentes,
arrastar linha como bloco — e o aviso de que uma **tela dedicada de motor de
templates de diagrama** virá numa etapa futura (fora desta fatia), onde o
`DiagramTemplate` (§17.3) vai realmente morar; até lá, o modal do projeto
continua com o editor ad-hoc. Duas perguntas feitas ao usuário antes de
implementar, ambas respondidas com múltiplas opções marcadas:

- **"Outros caminhos"** = derivação de uma linha existente **e** linha solta
  sem amarrar em componente — as duas. Resolvido com uma única mudança de
  modelo: `ManualConnection.from`/`to` deixou de ser um id de componente
  (`string`) e virou `ConnectionEndpoint` — `{kind:'symbol', id}` **ou**
  `{kind:'point', at}`. Clicar num componente gera a primeira; clicar em
  qualquer outro lugar do canvas (vazio ou em cima de uma linha já existente)
  gera a segunda — o mesmo mecanismo cobre derivação (parece um Y/T por estar
  no mesmo ponto de uma linha existente) e linha totalmente livre (as duas
  pontas soltas), sem precisar de um segundo tipo de entidade só pra isso.
  Diagramas salvos no formato antigo (`from`/`to` como string) são migrados
  na leitura (`migrateConnection()`).
- **"Legendas"** = texto solto no diagrama **e** editar a legenda de cada
  componente **e** "puxar as tags dos componentes também" (pedido extra do
  usuário, não estava nas opções oferecidas). Em vez de inventar um novo
  sistema de variáveis, reaproveitado o catálogo **já existente** dos
  templates .docx (`TEMPLATE_VARIABLES`/`buildProjectValues` em
  `projectValues.ts`, mesmo delimitador `{chave}` do `docxGenerator.ts`) —
  um texto solto ou a legenda de um componente podem conter `{nome_titular}`,
  `{potencia_total}` etc., resolvidos ao vivo (`resolveProjectTags()`) tanto
  no canvas quanto no SVG/PDF exportado, com um seletor "+ tag do projeto…"
  na barra pra não precisar decorar as chaves.

Além disso, sem pergunta separada (interpretação direta do pedido):
- **Excluir/arrastar linha como bloco**: uma ligação agora é selecionável
  (clique no traço) e a seleção habilita Delete/Backspace e "Remover
  selecionado"; arrastar um trecho selecionado ou não move a linha inteira
  (todos os pontos de dobra e pontas soltas juntos) — se ainda não tinha
  pontos de dobra, o primeiro arrasto semeia com o roteamento automático
  atual antes de mover. Criar um novo ponto de dobra virou duplo-clique (era
  o próprio gesto de arrastar antes — agora esse gesto move a linha toda).
- **Redimensionar componentes**: `PlacedSymbol.scale` (0,4×–3×), alça de
  arrastar no canto do símbolo selecionado. A composição escala-depois-gira
  em torno do centro do bloco precisou ser replicada manualmente no PDF
  (`scalePoint` antes de `rotatePoint`, mesma ordem do `transform` do SVG,
  extraído como `blockTransform()` em `exportSvg.ts` e reaproveitado ao vivo
  pelo canvas) — os dois foram comparados numericamente ponto a ponto antes
  do commit para garantir que exportam exatamente o que a tela mostra.

## Atualização (5ª rodada) — pixels precisam se encontrar
Print do usuário mostrando um gap visível entre a linha de derivação e o
símbolo do DPS: "OS PIXELS DEVEM SE ENCONTRAR AO LIGAR LINHAS E COMPONENTES
UNS AOS OUTROS". Investigando, achei **dois** problemas, não um:

1. **`edgePoint()` mirava a borda vazia da caixa de 24×20mm, não a ponta real
   do traço desenhado do símbolo.** Cada símbolo tem uma margem própria entre
   a caixa e onde o desenho de fato acaba (ex.: o medidor é um círculo de
   raio 8 centrado no meio — a borda real do círculo fica a 4mm da caixa, não
   0mm; os demais símbolos usam stubs com ~2mm de recuo). Isso significava
   que **toda** ligação símbolo↔condutor da fatia inteira tinha um gap de
   2–4mm — não só a derivação do print, só ficava mais óbvio nela por causa
   do ângulo reto e dos marcadores de ponta desenhados por cima. Corrigido com
   `CONNECTION_INSET` (`symbols.ts`, um recuo por tipo de símbolo, calibrado
   olhando a geometria de cada um), subtraído em `edgePoint()`.
2. **Pontas soltas (`{kind:'point'}`, da 4ª rodada) não grudavam em nada
   perto delas.** Terminar uma derivação perto de um componente sem acertar
   sua área de clique exata deixava a ponta como um ponto flutuante — nunca
   formalmente ligado ao símbolo, então mesmo com o `edgePoint()` corrigido
   não tinha efeito ali (a ligação não referenciava o símbolo, só um ponto
   fixo). Corrigido com snapping por proximidade: `findNearestSymbol()` /
   `nearestPointOnPolyline()` (`editableLayout.ts`, raio de captura
   `SNAP_RADIUS = 6mm`) resolvem todo clique de iniciar/terminar uma ligação
   — perto de um componente vira aquele componente de verdade (ligação
   pixel-perfeita via `edgePoint()`), perto de uma linha existente sem
   símbolo vira o ponto exato projetado sobre ela, e **soltar** uma ponta já
   existente perto de um componente também gruda nela (dá pra corrigir uma
   ligação já salva só arrastando, sem apagar/refazer).

Verificado com um teste headless (`node`) comparando as coordenadas exatas
esperadas (ex.: disjuntor→medidor devia encostar em x=22/x=54, não x=24/x=50)
antes do commit — as duas correções batem com os valores calculados à mão.
Diagramas já salvos com uma ponta solta não-grudada continuam com o gap até
o usuário arrastar a pontinha pra dentro do símbolo ou refazer a ligação —
não há migração retroativa automática (ver limitações em
`docs/modules/diagrams/overview.md`).

## Atualização (6ª rodada) — motor de templates, aba própria, mudança de permissão
Pedido explícito: "a gente ir para o próximo nível" — sair de editar um
diagrama dentro do modal do projeto pra ter uma **aba própria como motor de
templates**, com acesso pra projetista (staff) e administrador, não só
master. Duas decisões tomadas com o usuário antes de implementar:

- **Escopo de acesso continua restrito à GD Manager por enquanto** (não abre
  pra todos os tenants ainda) — mas o *papel* que ganha acesso muda de
  "só master" pra "admin/staff do tenant `is_library`". Reaproveitado o flag
  `tenants.is_library` que já existia (marca a origem da biblioteca de
  concessionárias) em vez de criar um flag novo só pra isso —
  `useDiagramEngineAccess()` centraliza a regra (`role admin|staff` **e**
  `is_library`), usada nos três pontos de gate (menu, rota, aba do modal do
  projeto). Master, sendo `admin` do tenant GD Manager, já cai na regra sem
  caso especial.
- **Reconhecimento automático de PDF fica pra depois, como iniciativa
  própria** — construir a aba/motor primeiro com criação **manual** de
  template (reaproveitando o editor já pronto), o reconhecimento (que exige
  IA de visão, não um parser determinístico — mais parecido com o Claudinho
  do que com um simples leitor de PDF) vira um projeto à parte, planejado
  quando chegar a vez.

Durante a implementação, o usuário mandou um diagrama unifilar real (PDF de
um projeto ENEL) como referência — não usado pra reconhecimento automático
(decidido que isso fica pra depois), mas a **legenda** dele revelou 3 tipos
de símbolo que faltavam na biblioteca: fusível, aterramento (como componente
próprio, não só embutido na base do DPS) e quadro de distribuição. Os três
foram adicionados (`symbols.ts`) já com `CONNECTION_INSET` calibrado, dado
que era barato e melhora a qualidade de qualquer template feito daqui pra
frente — sem tentar recalibrar a biblioteca inteira nesta mesma rodada.

### Arquitetura: extrair o editor do `UnifilarTab`
Antes desta rodada, todo o canvas interativo (arrastar, ligar, redimensionar
etc. — ~930 linhas) vivia dentro de `UnifilarTab.tsx`, amarrado a
`ProjectWithDetails`. Reescrever tudo de novo pro motor de templates
duplicaria essa lógica inteira — proibido pelas regras do projeto (nunca
duplicar lógica complexa). Em vez disso, extraído pra
`src/components/diagrams/DiagramEditor.tsx`, um componente que não sabe se
está editando um projeto ou um template: recebe `json` (JSON técnico —
título + `components`/`connections`, vazios num template), `initialState`
(`DiagramSceneState`, o mesmo formato salvo tanto em `localStorage` quanto
em `diagram_templates.scene_data`), `tagValues` opcional (ausente = mostra
`{chave}` cru, presente = resolve — o mesmo mecanismo cobre "modo template"
e "prévia com dados de exemplo" no motor de templates) e `onStateChange` (o
dono decide onde persistir). `UnifilarTab.tsx` ficou um wrapper fino: monta
o JSON/valores do projeto real, carrega/salva em `localStorage`, tem a
lógica de `reconcile()`/migração de formato antigo — nada disso pertence ao
editor genérico.

### Banco: `diagram_templates`
Tabela nova, RLS no mesmo padrão de `energy_concessionaires` (RESTRICTIVE
por `tenant_id` via `get_user_tenant_id()`, PERMISSIVE liberando
`admin`/`staff` via `has_role()`). `scene_data jsonb` guarda o
`DiagramSceneState` inteiro — a legenda de um componente pode conter tags
`{chave}`, resolvidas só na hora de mostrar/exportar (nunca gravadas como
valor fixo), então um modelo funciona pra qualquer projeto que o importar.
Liberar pra todos os tenants no futuro não exige mudança nenhuma de schema
— só remover a checagem de `is_library` em `useDiagramEngineAccess()`.

### O que ainda falta pra fechar o pedido original
O usuário descreveu o fluxo completo: motor de templates numa aba própria
(feito), e o modal do projeto **apresentando** o diagrama (importado de um
modelo) com opção de editar antes de baixar sem afetar o modelo salvo. A
segunda metade — importar um modelo salvo dentro do `UnifilarTab` — **não
foi implementada nesta rodada**: os dois editores já usam o mesmo formato de
dados (`DiagramSceneState`), então tecnicamente é um `initialState` diferente
em vez do resultado de `reconcile()`, mas falta decidir com o usuário *como*
ele escolhe qual modelo importar (manual, por concessionária, por critério
paramétrico) antes de construir essa tela. Ver roadmap.

## Atualização (7ª rodada) — linhas nunca ficam soltas no vazio
Pedido direto: "não deixe que as linhas possam ser desenhadas livremente,
mas sim, conectando componentes um ao outros ou em outras linhas". A ponta
solta genuína (`{kind:'point'}` sem estar perto de nenhum componente/linha),
introduzida na 4ª rodada como "linha totalmente livre", foi removida —
uma ligação agora **sempre** termina em algo real.

`resolveClickEndpoint()` (`DiagramEditor.tsx`) deixou de ter fallback pro
clique cru: retorna `ConnectionEndpoint | null` — símbolo perto, ponto sobre
outra linha perto, ou `null` (não é lugar válido pra ponta nenhuma). Isso
muda o fluxo de `handleCanvasClick`:
- Sem origem escolhida ainda: só inicia a ligação se o clique acertar
  componente/linha; clique no vazio não faz nada (antes, virava o começo de
  uma linha livre).
- Com origem escolhida: clique perto de componente/linha **fecha** a
  ligação ali (inclusive criando uma derivação, se for numa linha); clique
  longe dos dois vira só mais um ponto de dobra do traço em andamento — o
  meio do caminho continua livre pra desenhar, só as pontas são obrigadas.

O botão "Terminar aqui" (que fechava a ligação no ponto cru, criando a
ponta solta) deixou de fazer sentido e foi removido — fechar numa linha
agora é só clicar nela durante o desenho, sem precisar de um botão à parte.

Fechado também um buraco que sobrava: **arrastar** a ponta de uma ligação já
existente até o vazio ainda deixava um ponto solto (só o clique de
criação tinha a regra nova, não o arrasto). Agora o `onUp` do arrasto de
ponta (`type: 'endpoint'`) checa componente perto, senão linha perto
(excluindo a própria ligação sendo arrastada, senão ela sempre "acerta" a si
mesma — via `nearestLinePoint(..., excludeConnId)`), senão **desfaz o
arrasto e volta pra posição original**. Precisou de um `connectionsRef`
(mesmo padrão do `placementsRef` já existente) pra ler o estado atual de
conexões dentro do listener de `mouseup` persistente sem risco de closure
desatualizada.

Diagramas salvos antes desta correção que já tinham uma ponta genuinamente
solta continuam funcionando como estão — não há migração retroativa — mas
arrastar essa ponta agora sempre resolve pra algo ou volta pro lugar, nunca
mais fica solta de novo (ver limitações em
`docs/modules/diagrams/overview.md`).

## Atualização (8ª rodada) — reconhecimento de PDF (só topologia) + 3 símbolos novos
Pedido explícito: "vamos partir para o próximo nível" — construir o
reconhecimento automático de PDF adiado na 6ª rodada, reaproveitando a
legenda de um **segundo** diagrama unifilar real (ENEL) enviado como
referência pra "substituir os já usados pelos que tem lá". Pedido de escopo
explícito do próprio usuário: "bom, funcional, fácil de mexer... não precisa
de detalhamentos extremos, apenas a informação completa" — norteou as duas
decisões abaixo, ambas escolhendo o caminho mais simples que ainda resolve o
problema de verdade.

### Reconhecimento: só topologia, nunca posição/rotação
Edge function nova, `diagram-recognize`, no **exato mesmo padrão** do
`claudinho-verifica` (Anthropic API, PDF nativo via `document` content block
+ `anthropic-beta: pdfs-2024-09-25`, `consume_ai_quota`/`ai_usage_log`,
`verify_jwt: false` com checagem própria de Authorization, modelo
`claude-haiku-4-5-20251001` já confirmado funcionando neste projeto,
publicada manualmente via MCP — não entra no CI). O prompt trava a IA num
vocabulário fechado (os `ComponentKind` existentes, com descrição visual
curta de cada um) e devolve **só** `{ components: [{id, kind, label}],
connections: [{from, to}], warnings }` — deliberadamente sem coordenadas.

Decisão: pedir posição/rotação em mm alinhada à nossa página teria taxa de
erro alta demais pra ser útil (IA de visão erra grosseiramente em coordenada
pixel-perfeita, mesmo quando acerta "o que tem e o que liga com o quê"), e
implementar uma heurística de auto-layout só pra esse caso seria trabalho
duplicado — o editor manual já existe e já é rápido pra reposicionar. Em vez
de inventar um posicionamento novo, `buildSceneFromRecognition()`
(`editableLayout.ts`) reaproveita **exatamente** `initialPlacement()`/
`initialConnections()` — as mesmas funções que já posicionam a fileira
inicial de qualquer diagrama novo vindo do cadastro do projeto — tratando a
resposta da IA como se fosse um `TechnicalJsonMvp.components/connections`
qualquer. Isso exigiu só afrouxar a assinatura dessas duas funções de
`TechnicalJsonMvp` completo pra `Pick<TechnicalJsonMvp, 'components'>`/
`Pick<..., 'connections'>` (mudança compatível, zero lógica nova). O
resultado abre direto no editor de modelos com um banner roxo avisando que é
reconhecimento automático e precisa de revisão — nunca é tratado como
pronto pra uso sem passar pelos olhos do usuário.

UI: botão "Importar de PDF" na lista de `/admin/diagram-templates` (ao lado
de "Novo modelo") — sobe o arquivo, chama `useDiagramRecognition()`, cria o
`diagram_template` e já abre editando. Sanitização defensiva na própria edge
function: componente com `kind` fora do vocabulário é descartado (vira um
item em `warnings`, nunca quebra o resto); conexão cujas pontas não existam
entre os componentes aceitos também é descartada.

### Privacidade do PDF de referência
O usuário reenviou o mesmo tipo de PDF real (diagrama unifilar de um projeto
real de cliente, com titular/endereço/ART/CREA) usado como referência na 6ª
rodada, agora atualizado. Só a **legenda de símbolos** (informação técnica
genérica, sem dado pessoal) foi extraída e usada — em código, prompt ou
documentação. O prompt de `diagram-recognize` instrui explicitamente a IA a
nunca incluir dado pessoal do documento analisado na resposta (regra 1 do
prompt), mesmo que apareça no PDF enviado pelo usuário real do sistema.

### 3 símbolos novos, em vez de generalizar os existentes
A legenda do segundo diagrama diferenciava visualmente disjuntor
**bipolar** de **tripolar**, e medidor **convencional** (círculo com "M") de
**bidirecional** (caixa "kWh") — o símbolo genérico único que já existia
(`breaker`, `meter`) só cobria uma das duas variações de cada. Também
apareceu **chave CC** (seccionadora), sem equivalente nenhum na biblioteca.
Decisão: 3 `ComponentKind` novos (`breaker-tripolar`, `meter-bidirectional`,
`dc-switch`) em vez de adicionar uma propriedade "variante" aos existentes —
mantém `breaker`/`meter` com o significado que diagramas/templates já salvos
esperam (nenhuma migração necessária) e deixa cada símbolo com geometria
própria, sem `if` de variante dentro do desenho. `KIND_LABEL` de `breaker` e
`meter` ganhou o sufixo "Bipolar"/"Convencional" só pra clarear a paleta
"Adicionar" — não afeta rótulos já salvos em diagramas existentes (o rótulo
de cada componente é gravado no momento da criação, não recalculado ao
vivo). Símbolos de linha de condutor (cor por tipo: fase/neutro/terra) e o
rótulo de bitola (`2#6mm²`) que também apareciam na legenda **não** viraram
funcionalidade nova — são convenção de estilo de linha/anotação de texto,
não um componente discreto, e o texto livre já cobre a bitola; ver
"Limitações" em `docs/modules/diagrams/overview.md`.

## Atualização (9ª rodada) — a primeira importação real falhou vazia; stage/branch em vez de fileira única
A primeira tentativa real de "Importar de PDF" (mesmo diagrama ENEL da 8ª
rodada, reenviado pelo usuário) criou um modelo vazio — "a importação de
diagramas falhou vergonhosamente". Perguntei antes de tentar corrigir (o
usuário pediu explicitamente pra eu perguntar em caso de dúvida): o que
"aparecer" deveria significar. Resposta: **"o PDF é redesenhado no editor,
para que o usuário não precise construir um modelo específico do zero em um
editor limitado"** — ou seja, o design da 8ª rodada (só topologia, fileira
única) ficou aquém do esperado; o pedido real sempre foi um resultado que já
pareça com o diagrama de verdade, não só uma lista de peças na ordem
errada.

### Investigação do "vazio" (antes de mudar qualquer coisa)
Consultei os logs do Supabase em vez de assumir a causa:
- `ai_usage_log`: 1 chamada registrada (cota consumida, então passou da
  checagem de auth).
- Logs de invocação da edge function: `POST 200`, 7.8s — sem erro HTTP.
- Logs de runtime: nenhum `console.error` no meio da execução (só
  boot/shutdown) — ou seja, nem o parse do JSON da IA nem a chamada à API
  Claude falharam visivelmente.
- O `diagram_templates` criado (`scene_data`) estava **exatamente**
  `{placements:[],connections:[],photos:[],texts:[]}` — o `EMPTY_SCENE`
  default de `useCreateDiagramTemplate`, não um resultado parcial.

Isso apontava pra um de dois caminhos: a IA devolveu `kind`s fora do
vocabulário daquela vez (não-determinismo do modelo) e meu próprio código
zerou tudo silenciosamente, OU o `updateTemplate` (2º passo, depois do
`createTemplate`) falhou e deixou o registro no estado default do 1º passo.
Pra decidir, implantei uma edge function de diagnóstico temporária
(`diagram-recognize-debug`, sem auth, sem alterar a função real) e reenviei
o MESMO PDF real via `curl`: a resposta bruta da IA veio **limpa**, com os
12 componentes certos, todos com `kind` válido — o que aponta pro segundo
caminho como mais provável (falha no `updateTemplate`, deixando o registro
já criado pelo `createTemplate` no `EMPTY_SCENE` default) mais do que pra
uma resposta ruim da IA daquela vez. Não dá pra provar retroativamente qual
dos dois foi exatamente — por isso as duas causas foram endereçadas, não só
uma.

### Fix 1 — elimina a corrida create-depois-update
`useCreateDiagramTemplate` passou a aceitar `sceneData` opcional no insert;
`handleImport` (`DiagramTemplates.tsx`) monta a cena reconhecida ANTES de
criar o modelo e insere tudo numa única chamada — não existe mais uma janela
onde o modelo já existe no banco com uma cena vazia esperando um 2º passo
que pode falhar. Se a criação falhar agora, não sobra nada órfão.

### Fix 2 — normalização de `kind` + log de diagnóstico
`KIND_ALIASES` (`diagram-recognize/index.ts`) mapeia variações comuns que a
IA pode usar em vez do `kind` exato (inglês, sinônimo, plural) antes de
validar contra o vocabulário — não elimina 100% o risco de uma resposta com
tipos desconhecidos, mas reduz bastante a chance de uma resposta quase-certa
virar "0 componentes". A função também loga (server-side) a lista bruta de
`kind` a cada chamada, e o texto bruto da IA quando zero sobrevivem à
validação — sem isso, diagnosticar um caso futuro exigiria reproduzir tudo
de novo com uma função de debug, como desta vez.

### Fix 3 (o pedido real) — `stage`/`branch` em vez de fileira única
O prompt passou a pedir, por componente, `stage` (posição inteira no fluxo
principal — 0 na geração, crescente até a rede) e `branch` (`true` = é uma
derivação, não fica em série no condutor principal). `layoutFromRecognition`
(`editableLayout.ts`, nova) usa isso pra montar a cena: componentes
`branch: false` do mesmo `stage` ficam na fileira principal (mesmo `x` —
mesma lógica de espaçamento de `initialPlacement`); `branch: true` empilham
abaixo, no mesmo `x` do seu `stage` (a mesma convenção visual que DPS/
aterramento já usam quando o usuário os arrasta manualmente pra baixo da
linha — esses símbolos já são desenhados pra conectar "por cima"). Testado
de novo com o mesmo PDF real via a função de debug antes de decidir: saiu
com 10 componentes, `stage` 0–5, `branch` corretamente marcando DPS/
aterramento/quadro como derivação — resultado visualmente muito mais perto
de "redesenhado" do que a fileira única da 8ª rodada. Decisão deliberada:
não pedir coordenada mm exata (continua fora de alcance confiável pra uma
IA de visão), só estrutura suficiente pra já sair parecido, com o editor
manual cobrindo o ajuste fino.

### Limpeza
Modelo "ENEL" vazio (órfão do bug) excluído do banco. A função de debug foi
substituída por um stub que só devolve 410 (não há como excluir uma edge
function via MCP) — não deveria ter ficado exposta sem auth chamando a API
paga da Anthropic; se sobrar tempo depois, excluir de vez pelo painel do
Supabase.

## Atualização (10ª rodada) — revisão completa: folha profissional + reconhecimento com posições
O usuário pediu uma **revisão de tudo** ("ainda está muito cru... o sistema
não está conseguindo fazer a leitura nativa do diagrama... revise tudo o que
foi dito, o caminho onde a gente quer chegar, pra que seja construído de
maneira sólida e seja funcional e tem atributos de UX"). A revisão
diagnosticou: construímos um editor de **diagrama de blocos**, e o alvo é um
editor de **unifilar** — a diferença está na folha (legenda/carimbo/grupos),
na fidelidade espacial do reconhecimento e na UX do editor. Plano aprovado
em 4 fases (A folha → C reconhecimento+underlay → B UX → D fechar ciclo).
Esta atualização cobre A e C.

### Fase A — folha profissional (zero IA, tudo determinístico)
- **Tabela de LEGENDA automática** (`drawLegendTable` + `KIND_LEGEND`):
  gerada dos tipos usados no diagrama; coluna reservada no lado direito
  (`LEGEND_X0`); desligável por diagrama (`sheet.showLegend`).
- **Carimbo 2×4** (`drawTitleBlock`): TITULAR/ENDEREÇO/CONCESSIONÁRIA/
  POTÊNCIA + RESP. TÉCNICO/ART/DATA/REVISÃO. Resp. técnico/ART/revisão não
  existem no cadastro do projeto → viraram **campos da folha**
  (`DiagramSceneState.sheet`, painel "Dados da folha" no editor), com
  suporte a tags — num template, digita uma vez, todo projeto herda.
- **`PlacedGroup`** (caixa tracejada com título) e **`ManualConnection.label`**
  (bitola no trecho) — os dois elementos que faltavam pra reproduzir o
  visual dos unifilares reais. `Primitive` rect/line ganhou `dashed`
  (SVG `stroke-dasharray` / jsPDF `setLineDashPattern`, mesmo padrão);
  camada nova `GROUP_BOX`.
- API `buildSceneFromPlacement(json, state, tagValues)` passou a receber o
  `DiagramSceneState` inteiro (era 5 arrays posicionais); mobília da folha
  extraída em `buildSheetFurnitureScene` pro canvas usar como camada
  estática que reage a símbolos usados/sheet.

### Fase C — reconhecimento v3 + underlay do PDF
- **Revisão de decisão da 8ª/9ª rodada**: "nunca pedir posição à IA" era
  binário demais. IA de visão erra coordenada exata, mas acerta posição
  RELATIVA. O prompt v3 pede `x`/`y` normalizados 0–100 do centro de cada
  símbolo (na área do diagrama, ignorando carimbo/legenda/planta), grupos
  com caixa 0–100 e a bitola escrita em cada conexão. `stage`/`branch`
  continuam como fallback quando <60% dos componentes vêm com posição.
- **Testado no PDF ENEL real antes de integrar** (função de debug
  temporária, depois neutralizada): a IA devolveu a cadeia FV horizontal
  embaixo, o eixo da rede SUBINDO na vertical à direita, o BEP no
  alto-esquerda, o grupo do QG e as bitolas `2#6mm² + #6mm²` por trecho —
  disposição fiel ao original. Headless test confirmou o mapeamento pra
  folha (colunas verticais preservadas, nada fora da área útil, sem
  colisões).
- **Underlay**: a importação também renderiza a 1ª página do PDF
  (`pdfjs-dist`, dependência nova, import dinâmico — só quem importa PDF
  carrega) como fundo esmaecido/travado no editor (`PlacedPhoto.underlay`),
  com liga/desliga e remoção na barra, **excluído do export**. É o
  "o PDF precisa aparecer" literal + a ferramenta de conferência do
  reconhecimento. Privacidade: o underlay reproduz o documento original
  dentro do editor (restrito à GD Manager); nunca vai pro arquivo exportado.

### Fase B — UX de editor de verdade (entregue na mesma rodada)
- **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y + botões): histórico de até
  50 snapshots do `DiagramSceneState`. Detalhe importante: arrastos capturam
  o estado pré-arrasto de forma **preguiçosa** (`preState` no dragRef, só
  vira passo de desfazer no primeiro movimento real) — snapshot no mousedown
  encheria o Ctrl+Z de passos vazios a cada clique de seleção.
- **Zoom/pan**: viewBox do SVG como estado de janela; roda do mouse (zoom no
  cursor, listener nativo `passive:false`), espaço+arrastar ou botão do meio
  (pan), botões +/−/folha inteira. Toda conversão px→mm passou a considerar
  o zoom.
- **Painel de propriedades** contextual à direita do canvas — substituiu
  TODOS os `window.prompt` (nome/legenda do componente, bitola da ligação,
  título do grupo, conteúdo/tamanho do texto), com snapshot de undo no focus
  de cada campo.
- **Multi-seleção**: retângulo de seleção em área vazia + shift+clique;
  arrasto em conjunto; Delete nos manuais; **Ctrl+D duplica** (duplicata
  nasce sempre `manual-`, mesmo vinda de um componente do cadastro).

### Fase D — fechar o ciclo (entregue na mesma rodada)
- **`project_diagrams`** (tabela nova, RLS idêntica a `diagram_templates`):
  o diagrama do projeto saiu do `localStorage` (por navegador — editava no
  escritório, sumia em casa) pro banco, com autosave debounced silencioso.
  Migração suave: sem linha no banco, o `localStorage` antigo é lido como
  ponto de partida e persiste no banco na primeira edição.
- **Importar modelo no projeto** (o elo pendente desde a 6ª rodada — a
  decisão de UX foi tomada aqui: dropdown manual + modelos da mesma
  concessionária do projeto marcados como sugeridos e listados primeiro; o
  casamento paramétrico do §17.3 fica pro futuro). Aplicar copia
  `template.scene_data` pro projeto (o modelo nunca é alterado); as tags do
  modelo resolvem com os dados do projeto. **Cena de modelo é detectada por
  derivação, sem flag persistida**: modelos começam vazios, então TODO id de
  componente de modelo tem prefixo `manual-` — se o diagrama salvo só tem
  ids `manual-`, o `reconcile()` não semeia a cadeia fixa do cadastro (o
  modelo é o diagrama inteiro); "Restaurar automático" volta pra cadeia e
  sai do modo modelo naturalmente.

### Fase E (futura, não aprovada em detalhe)
Componentes em série desenhados "no fio" (condutor contínuo atravessando
disjuntor/fusível/chave) e portas CC/CA no inversor — o último degrau
visual, exige refactor do modelo de cena.
