# Módulo: Diagramas

**Estado: 🟡 Alpha interno** — visível só para o **master**, operando sobre os
projetos do próprio tenant do master (GD Manager). Não disponível para os
demais tenants ainda.

## Duas interpretações (contexto histórico)
Este item da estrutura padrão tinha duas leituras possíveis:
1. Diagramas de arquitetura/fluxo (documentação) — já cobertos por Mermaid nos
   `.md` deste repositório.
2. **Diagrama unifilar elétrico do projeto** (feature de produto) — é este que
   está descrito abaixo.

## Objetivo
Gerar o **diagrama unifilar** (esquema elétrico simplificado: geração →
conversão → proteção → medição → rede) a partir dos dados já cadastrados do
projeto, como uma cartilha adicional exportável em SVG/PDF.

## Arquitetura
Existe uma proposta completa (motor de layout automático, roteamento
ortogonal, biblioteca de símbolos versionada, exportador DXF, editor visual
drag-and-drop) em `DIAGRAMA UNIFILAR/cad-engine-arquitetura.md`, fora do
repositório do app. O que está implementado hoje incrementa uma **fatia
vertical** dessa proposta com edição manual interativa — o
`ManualLayoutSource` do §17.2, construído **antes** do motor de layout
automático (inversão deliberada da ordem do roadmap original, decidida com o
usuário: útil mais cedo, e o motor automático continua no roadmap):

| Peça da proposta | Nesta fatia |
|---|---|
| Pacote isolado `packages/cad-engine/` (monorepo) | Módulo comum em `src/utils/cadEngine/` — este repo não é monorepo |
| Motor de layout automático (grafo, ranking, roteador ortogonal) | Ainda não construído. Existe um **layout fixo inicial** (fileira única) como ponto de partida, editável manualmente por cima. |
| `ManualLayoutSource` (§17.2) — layout desenhado pelo usuário | **Implementado**: arrastar (clique em qualquer ponto da figura, não só no traço — ver nota abaixo), girar em passos de 90°, ligar dois componentes manualmente. Condutores sem pontos de dobra usam roteamento **ortogonal simplificado** (`orthogonalPath`); com pontos de dobra (`waypoints`), a linha segue exatamente o caminho desenhado (`computeConnectorPoints`) — ver "Ligar / desenhar linha" abaixo. |
| Biblioteca de símbolos declarativa versionada | 6 símbolos fixos (`symbols.ts`), aproximados de IEC 60617: arranjo FV, inversor, disjuntor, medidor, rede e **DPS** (dispositivo de proteção contra surtos). Os 5 primeiros ficam no eixo horizontal (`y = H/2`), alinhados ao fluxo esquerda→direita; o DPS é vertical (componente de derivação para o terra, não em série). |
| Componentes fora da cadeia fixa do projeto | **Implementado, mas só visual**: qualquer um dos 6 tipos pode ser adicionado livremente ao diagrama (paleta "Adicionar"), sem precisar existir no cadastro do projeto — útil para representar um 2º inversor, um DPS, um disjuntor extra etc. Não altera `project_equipment` nem qualquer dado do projeto. |
| Fotos no diagrama | **Implementado**: upload de uma imagem (comprimida no cliente), vira um bloco arrastável/redimensionável no canvas, sai impressa no SVG/PDF exportado. Não faz parte da `Scene` "elétrica" — é uma camada `PHOTO` à parte. |
| Exportadores SVG / PDF / DXF / PNG via IR neutra | **SVG e PDF**, ambos consumindo a mesma `Scene` (IR já segue o princípio D1: um exportador novo não toca em layout/símbolos). `Primitive` ganhou a variante `image` para as fotos. |
| JSON Técnico completo (grafo elétrico genérico) | `TechnicalJsonMvp`: cadeia fixa PV → Inversor → Disjuntor → Medidor → Rede, montada a partir de `project_equipment`/`project_general_data` do próprio projeto. Componentes adicionados manualmente (acima) não entram nesse JSON — só existem no layout salvo. |
| `DiagramTemplate` — salvar/aplicar layout como template (§17.3) | Não implementado ainda — ver roadmap |

## Arquivos
- `src/utils/cadEngine/types.ts` — `TechnicalJsonMvp` + Scene IR (subconjunto de D1; `BlockInstance.rotation`; `Primitive` inclui `image`; `LayerId` inclui `PHOTO`).
- `src/utils/cadEngine/symbols.ts` — definições geométricas dos 6 símbolos + `KIND_LABEL` (nome curto por tipo, usado na paleta "Adicionar").
- `src/utils/cadEngine/paper.ts` — constantes de papel/margem + moldura/carimbo (compartilhado entre o layout fixo e o editável).
- `src/utils/cadEngine/buildTechnicalJson.ts` — projeto → JSON técnico (reaproveita `buildProjectValues`).
- `src/utils/cadEngine/layout.ts` — JSON técnico → `Scene` com layout fixo (posição inicial, antes de qualquer edição).
- `src/utils/cadEngine/editableLayout.ts` — `PlacedSymbol`/`ManualConnection` (com `waypoints?: Point[]`)/`PlacedPhoto`, `orthogonalPath`, `computeConnectorPoints` (roteamento automático sem pontos de dobra, ou caminho manual exato quando há), `snapToGrid`, `buildSceneFromPlacement` (a `Scene` a partir do estado editado + fotos).
- `src/utils/cadEngine/exportSvg.ts` / `exportPdf.ts` — `Scene` → SVG / PDF, com suporte a `rotation` do bloco (PDF gira os pontos manualmente; SVG usa `transform="rotate(...)"` nativo) e à primitiva `image` (SVG: `<image href>`; PDF: `doc.addImage`, formato detectado pelo prefixo do data URL). PDF via `jspdf`, já usado em `resumoPdf.ts` — nenhuma dependência nova.
- `src/components/projects/UnifilarTab.tsx` — canvas SVG interativo (arrastar/girar/ligar-e-desenhar/adicionar componente/adicionar foto) + botões de download.

## Permissões
Aba "Unifilar" no `ProjectModal`, gateada por `user?.isMaster` no front. Como o
master, no app normal, só vê o próprio tenant (ADR 0005 — sem bypass de RLS), e
o tenant do master é a GD Manager, o gate por `isMaster` já restringe
naturalmente a escala inicial pedida ("apenas master, empresa GD Manager") sem
precisar de RLS/RPC nova — os dados consumidos (`project_equipment`,
`project_general_data`) já são os do próprio projeto aberto no modal.

## Componentes e fotos adicionados manualmente
Além dos 5 componentes que vêm do cadastro do projeto (`TechnicalJsonMvp`), a
paleta "Adicionar" na barra de ferramentas cria uma instância solta de
qualquer um dos 6 tipos (`addComponent()` em `UnifilarTab.tsx`) — o id sempre
começa com `manual-` (ex.: `manual-dps-1721...`). "Adicionar foto" abre um
seletor de arquivo; a imagem é redimensionada/comprimida no navegador (máx.
900px, JPEG ~78% de qualidade) antes de virar `PlacedPhoto` — sem isso, uma
foto de celular sem compressão estouraria a cota do `localStorage` rapidamente.
Ambos são **só visuais**: não criam nem alteram nenhum registro de
`project_equipment`. Só é possível remover (botão "Remover selecionado" /
ícone na foto) o que foi adicionado manualmente — os 5 componentes do
cadastro do projeto são sempre exibidos.

## Ligar / desenhar linha
Um único modo cobre os dois casos: clique no componente de origem, depois
clique no componente de destino para ligar direto (roteamento ortogonal
automático, como antes), **ou** clique em pontos vazios do canvas antes do
destino para desenhar o traço à mão — cada clique vira um `waypoint` da
ligação já na criação. Esc cancela a ligação em andamento. Depois de criada,
o traço continua editável do jeito já existente: arrastar o meio de um
segmento cria um novo ponto de dobra ali; arrastar um ponto move-o; duplo-clique
remove.

## Persistência
O layout editado (posições, rotações, ligações manuais, componentes extras e
fotos) é salvo em **`localStorage`**, por projeto (`unifilar-layout:{projectId}`)
— **só neste navegador**, não sincroniza entre dispositivos/usuários e não é
um `DiagramTemplate` reutilizável. Ao reabrir a aba, o estado salvo é
reconciliado com os componentes atuais do projeto (`reconcile()` em
`UnifilarTab.tsx`): os 5 componentes fixos (`PV-01`, `INV-01`, ...) são
resincronizados a cada troca de equipamento — um removido do cadastro some do
layout, um novo aparece na posição padrão. Componentes/fotos com id `manual-`
sobrevivem sempre, independentemente do que mudou no cadastro do projeto (essa
distinção pelo prefixo do id é proposital: "ausente do cadastro atual" não dá
pra usar como critério, porque um componente real removido do projeto cairia
no mesmo caso e ficaria fantasma no diagrama para sempre — bug pego e
corrigido num teste headless antes do commit).

## Nota técnica — arrastar símbolos com `fill="none"`
Os primitivos dos símbolos são desenhados com `fill="none"` (só contorno). Em
SVG, uma forma sem preenchimento só recebe eventos de mouse **exatamente em
cima do traço**, não no interior da figura — clicar no meio de um símbolo
"vazio" não disparava o `mousedown` de arrastar. Corrigido com um `<rect>`
invisível (`fill="transparent"`, do tamanho da caixa 24×20mm) como primeiro
filho do `<g>` arrastável de cada símbolo: preenchimento transparente ainda
é "pintado" para fins de hit-test do navegador, então captura clique em
qualquer ponto da caixa e propaga para o handler do grupo.

## Fluxo
```mermaid
flowchart LR
  Proj[Projeto aberto no modal] --> Build[buildTechnicalJsonFromProject]
  Build --> Init[initialPlacement/initialConnections ou localStorage + reconcile]
  Init --> Edit[Usuário arrasta / gira / liga-desenha linha / adiciona componente ou foto]
  Edit --> Scene[(buildSceneFromPlacement + fotos)]
  Scene --> Svg[Canvas SVG interativo na tela]
  Scene --> Down[sceneToSvg / sceneToPdfBlob - download]
  Edit --> LS[(localStorage por projeto: placements + connections + photos)]
```

## Limitações desta fatia (deliberadas)
- A cadeia **oficial** do projeto continua fixa (PV→Inversor→Disjuntor→Medidor→Rede,
  vinda do cadastro) — sem BESS, sem múltiplos inversores/QDCs reais, sem
  geração compartilhada. Componentes extras adicionados manualmente (2º
  inversor, DPS etc.) só existem no desenho, não no `project_equipment`.
- Sem motor de layout automático/roteador com detecção de cruzamento — sem
  pontos de dobra manuais, o roteamento é um Manhattan de 2 segmentos simples;
  com pontos de dobra (arrastando ou desenhando na criação), o usuário
  controla o caminho à mão, sem ajuda automática (sem ortogonalização, sem
  desvio de outros traços/símbolos).
- Símbolos aproximados; **pendente calibrar** com unifilares reais aprovados da
  GD Manager (combinado com o usuário — ele vai enviar exemplos).
- Fotos não giram (só arrastar/redimensionar) — suficiente para o uso previsto
  (foto do local, fachada, padrão de entrada).
- Sem exportador DXF, sem `DiagramTemplate` (salvar/aplicar layout em outro
  projeto).
- Layout persiste só em `localStorage` deste navegador — não sincroniza entre
  quem usa o sistema, e some se o navegador for trocado ou o storage limpo.
  Fotos sem compressão agressiva poderiam estourar a cota (~5-10MB) rápido;
  por isso o upload já redimensiona/comprime antes de salvar.
- Só o master vê; outros tenants não têm acesso ainda.

## Melhorias futuras
Ver a proposta completa em `DIAGRAMA UNIFILAR/cad-engine-arquitetura.md` para o
plano em etapas (motor de layout automático, roteamento, DXF, templates
reutilizáveis, editor visual, regras por concessionária, liberação para
outros tenants). Ver também [ADR 0006](../../adr/0006-cad-engine-alpha.md).
