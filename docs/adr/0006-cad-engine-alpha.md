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
