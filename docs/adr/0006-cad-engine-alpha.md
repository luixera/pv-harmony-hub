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
