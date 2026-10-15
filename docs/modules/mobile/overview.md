# Módulo: Mobile e PWA

## Objetivo
Fazer o GD Manager funcionar bem no celular, sem app nativo. Duas coisas:

1. **Um padrão mobile** (`src/mobile/`) que as telas consomem — em vez de cada
   tela resolver o celular do seu jeito, onde doeu.
2. **PWA**: o app instala na tela inicial, abre em tela cheia e guarda a casca
   (HTML, JS, CSS, ícones) para abrir rápido com sinal ruim. **Dado nunca é
   guardado**: vem sempre da rede.

Públicos da Fase 1: o **gestor acompanhando** (admin/staff) e a **empresa
integradora** (`company`). O projetista em campo ficou fora.

> **Estado: 🟡 Fase 1 — padrão + telas do gestor e da empresa.** O padrão e o
> PWA estão de pé. **Só a lista de projetos da empresa usa o componente de
> cartões**; o resto das telas ou já tinha tratamento melhor ou não foi tocado.
> A lista do que **não** existe está em [Pendências](#o-que-não-existe-e-pendências).
>
> Spec: [`docs/superpowers/specs/2026-10-15-gd-mobile-pwa-design.md`](../../superpowers/specs/2026-10-15-gd-mobile-pwa-design.md) ·
> Plano: [`docs/superpowers/plans/2026-10-15-gd-mobile-pwa.md`](../../superpowers/plans/2026-10-15-gd-mobile-pwa.md)

Onde esta doc e a spec divergem, **vale o código** — as divergências estão em
[Construído diferente da spec](#construído-diferente-da-spec).

## Três decisões que moldam o módulo

### 1. O padrão serve onde não há nada. Onde já existe algo melhor, ele não entra.

A primeira tentativa trocou a lista de celular do `ProjectsKanban` pelo cartão
padrão e **foi desfeita**. O cartão mostra titular, selo de etapa e no máximo
três campos; a lista antiga tinha filtro de etapa e os selos "Xd parado" e "Sem
valor", informação de gestão que o cartão perderia. Uniformidade visual vale
menos que isso.

Dois casos concretos, hoje:

- **`ProjectsKanban` mantém a lista de celular própria.** Importa só
  `statusVariants` (o mapa etapa → variante do `Badge`) de
  `src/mobile/cartaoDeProjeto.ts`, para existir uma cópia só.
- **A aba de documentos do `ProjectModal` mantém o mestre-detalhe**: no celular
  mostra a lista e, ao tocar, troca pela prévia, com o botão "Voltar à lista".
  É melhor que uma pilha de cartões, porque a prévia faz parte do uso. A linha
  já mostra o *tipo* do documento (não o nome do arquivo, de propósito: sem
  isso vira "uma pilha de image.png indistinguíveis") e tem altura de 48 px pela
  regra global de toque.

Quem usa `ListaEmCartoes` hoje é **só** `src/pages/company/CompanyProjects.tsx`,
onde não havia nada.

**Regra para a próxima tela:** antes de trocar um tratamento de celular por
`ListaEmCartoes`, abra o que existe no celular e compare. Se o existente mostra
mais ou navega melhor, deixe como está.

### 2. Sem fila de escrita offline.

O service worker guarda **só a casca**. Não há `runtimeCaching` (a lista está
vazia de propósito em `vite.config.ts`) e nenhuma rota de dados é interceptada.
Sem sinal, o app abre, mas as listas não carregam — e isso é o comportamento
desejado.

Motivo (spec §4): o uso no celular é consulta e envio pontual. Fila de escrita é
onde esse tipo de projeto se perde: **conflito** (duas pessoas mexem no mesmo
projeto), **duplicata** (o envio repete ao voltar a rede) e **dado velho
aplicado por cima** do que mudou enquanto o aparelho estava sem sinal. Se um dia
o projetista em campo entrar no escopo, a conversa recomeça — com o desenho do
conflito primeiro.

### 3. `registerType: 'prompt'`: o usuário clica para atualizar.

Quando sai versão nova, aparece o aviso **"Nova versão disponível"** com o botão
**Atualizar** (toast do `sonner`, sem prazo para sumir), em vez de o app trocar
de versão sozinho. Está em `src/main.tsx`.

- **Por que** (spec §6 e comentário em `vite.config.ts`): a atualização tem de
  ser **explícita**. Com `autoUpdate` o usuário pode ficar preso numa versão
  velha sem saber que existe uma nova, e a troca recarrega a página sozinha —
  possivelmente no meio de um preenchimento. Com o aviso, a pessoa vê que há
  versão nova e escolhe a hora.
- **Custo:** quem não clicar fica na versão antiga. E como o `index.html` entra
  no precache, **depois da primeira visita quem manda na versão é o service
  worker**, não o `Cache-Control` do Nginx — ver [Armadilhas](#armadilhas).

## O padrão: `src/mobile/`

Lógica pura em `.ts` (testável) e um único componente em `.tsx`.

| Arquivo | O que faz |
|---|---|
| `breakpoints.ts` | **Fonte única dos limites**: `LARGURA_MOBILE = 640`, `LARGURA_TABLET = 1024`. `colunasPorLargura(largura, desejadas)` diz quantas colunas cabem: 1 abaixo de 640 px; de 640 a 1023 px, o pedido pela metade (mínimo 2, nunca mais que o pedido); de 1024 px para cima, o pedido inteiro. `gradeColapsavel(largura, desejadas)` devolve o mesmo já no formato do `gridTemplateColumns` (`'1fr'` ou `repeat(n, minmax(0, 1fr))`). |
| `resumoDeCartao.ts` | Escolhe, entre os campos de apoio de um cartão, **no máximo 3 campos cheios**. Campo vazio é pulado — rótulo solto com espaço em branco ao lado faz a lista parecer quebrada. |
| `atalhos.ts` | `atalhosDaBarra(papel)` devolve os 4 atalhos da barra inferior por papel. Todo caminho tem de existir em `src/App.tsx` (o teste confere). |
| `ListaEmCartoes.tsx` | Abaixo de 640 px mostra cartões; de 640 px para cima renderiza `children`. Ver a armadilha logo abaixo. |
| `cartaoDeProjeto.ts` | `cartaoDeProjeto(projeto, rotuloDaEtapa, aoAbrir)` monta o cartão de um projeto. Concentra também `statusVariants` e `corDaEtapa`. |

Cada arquivo de lógica tem teste em `*.test.ts` ao lado. O `vitest` roda com
`environment: 'node'`, **sem DOM** (ver `vitest.config.ts`) — por isso só a
lógica pura é testada. `ListaEmCartoes` e `BottomNav` não têm teste de
componente; tela se confere no navegador (ver
[Como conferir](#como-conferir-uma-tela-em-390-px)).

### Breakpoint único

`src/mobile/breakpoints.ts` é a **fonte única**. Os dois hooks importam dele:

- `src/hooks/useWindowSize.ts` → `isMobile` (< 640), `isTablet` (< 1024),
  `isDesktop` (≥ 1024);
- `src/hooks/use-mobile.tsx` → `useIsMobile()` (< 640), usado por telas como o
  `ProjectsKanban`.

**Não declare outro número de breakpoint em lugar nenhum do TypeScript.** O
motivo é concreto: o app chegou a ter **640 e 768** competindo pela mesma ideia
de "é celular". Na faixa de 640 a 767 px o `MainLayout` (640) e o `Sidebar`
(768) discordavam, e a gaveta ficava presa aberta, com o fundo preto, sem
fechar. A correção foi fazer o `use-mobile.tsx` importar de `breakpoints.ts`.

**E os dois têm de concordar no PRIMEIRO render, não só no número.** O
`use-mobile.tsx` começava em `undefined` (que vira `false`) e só acertava no
efeito; o `useWindowSize` sempre leu a largura no inicializador. Enquanto o
`MainLayout` usou o primeiro, ninguém notava — passou a usar o segundo e o
quadro 1 de todo carregamento frio no celular ficou incoerente: o layout já era
de celular, mas o `Sidebar` ainda se achava desktop e desenhava a gaveta
`fixed w-64` **por cima** do conteúdo, sem deslocá-lo. Hoje os dois leem a
largura no inicializador. Hook de largura que comece em `undefined` é armadilha.

Para decidir colunas numa grade, use `gradeColapsavel(width, n)` com o `width`
do `useWindowSize()`. Seis grades rígidas de 3–4 colunas — que no celular
viravam colunas de ~90 px — passaram a usá-lo: `ProjectModal` (os cartões-resumo
da parte financeira), `TaskDialog`, `NewRevisionDialog` e três em `src/pages/admin/Reports.tsx`.
Em `Reports`, o destaque da primeira coluna (`1.2fr`) só vale no desktop.

### Barra inferior

`src/components/layout/BottomNav.tsx`, extraída do `MainLayout`. Aparece só
abaixo de 640 px; o conteúdo ganha `pb-20` para não ficar sob a barra. É atalho,
**não substituto**: o menu completo continua na gaveta lateral.

| Papel | Atalhos |
|---|---|
| `admin`, `staff` | Projetos (`/projects`) · Tarefas (`/tasks`) · Avisos (`/ludmilla`) · Perfil (`/profile`) |
| `company` | Projetos (`/company/projects`) · Novo (`/new-project`) · Financeiro (`/company/financial`) · Perfil (`/profile`) |

- Alvo de toque mínimo de 44 px (`min-h-[44px]`; com a barra em `h-16` cada
  botão já tem ~63 px, o `44` é o piso garantido).
- **"Avisos" é a Ludmilla**, que só existe para a equipe do tenant GD Manager
  (`is_library`). Para quem não a tem (`useLudmillaDisponivel()` falso), o
  atalho **some** — a barra mostra 3 itens, em vez de um botão que não leva a
  lugar nenhum. A versão anterior tinha "Avisos" desabilitado apontando para
  `/notifications`, rota que nunca existiu.
- Nenhum item fica desabilitado.

### Lista em cartões

`ListaEmCartoes` recebe `itens` (cada um com `titulo`, `selo` opcional, `campos`
e `aoAbrir` opcional), um texto `vazio` e `children`.

> **Armadilha: o que estiver dentro de `children` SOME no celular.**
> Abaixo de 640 px o componente renderiza os cartões e **ignora** `children`. Se
> a busca, o filtro ou o botão "Novo projeto" estiverem dentro do componente,
> o celular fica sem eles. Em `CompanyProjects.tsx` a busca e o "Novo Projeto"
> ficam **no cabeçalho, fora** do `ListaEmCartoes`, por isso. Ação, filtro e botão
> vão sempre fora.

Outros detalhes que já deram problema:

- Cartão **com** `aoAbrir` vira `<button type="button">` (focável; o `type`
  evita enviar o formulário pai, porque o padrão do `button` é `submit`).
  **Sem** `aoAbrir` vira `<div>`, sem foco nem papel de botão.
- O conteúdo do cartão usa `<span>`, não `<div>`/`<p>`: conteúdo de `button` tem
  de ser de frase.
- A cor do selo precisa ser **hex de 6 dígitos**: a borda é a mesma cor com
  `33` anexado.
- `cartaoDeProjeto` pula a potência quando é 0 ou ausente, em vez de mostrar
  "0 kWp" de projeto sem equipamento. O nome da etapa vem da tela
  (`rotuloDaEtapa`), porque é o nome da **coluna do Kanban** (o admin renomeia;
  a empresa pode ter modelo próprio).
- **Acoplamento com `src/components/ui/badge.tsx`:** a tradução variante → hex
  (`COR_DA_VARIANTE`, em `cartaoDeProjeto.ts`) **espelha** as cores de texto
  das variantes `pending`, `analysis`, `progress` e `approved` do `Badge`. O
  Tailwind exige a classe escrita por extenso lá, então não dá para ler de
  volta. **Se mudar a cor de uma variante no `badge.tsx`, mude em
  `cartaoDeProjeto.ts` também.** O teste confere o contraste (AA) de todas, não
  a igualdade com o badge. Os tons são os escuros de propósito: selo é texto
  sobre branco, e os tons vivos do quadro ficam abaixo de 4,5:1 nesse fundo.

## Onde o padrão está aplicado

| Tela | O que mudou no celular |
|---|---|
| `MainLayout` | Usa o `BottomNav` extraído. |
| `CompanyProjects` (`/company/projects`) | **Cartões** de projeto (`ListaEmCartoes` + `cartaoDeProjeto`). Não tem filtro de etapa, então o celular mostra **todos** os projetos da empresa, com a etapa no selo. De 640 px para cima, o quadro de colunas de sempre. |
| `ProjectsKanban` | **Lista própria** (decisão 1). Só importa `statusVariants`. |
| `ProjectModal` | Tela cheia no celular, **cabeçalho fixo** (`position: sticky`), ações do cabeçalho quebram para baixo do título, barra de abas que rola de lado (rótulos curtos: "Geral", "Notif.", "Assin."), botão **Fechar** no estado de carregamento. Os cartões-resumo da parte financeira usam `gradeColapsavel`. A aba de documentos mantém o mestre-detalhe (decisão 1). |
| `TaskDialog`, `NewRevisionDialog`, `Reports` | Só as grades colapsáveis. `Reports` **não** virou cartões. |

No `ProjectModal`, três coisas que custaram descobrir:

- **`position: sticky` não gruda dentro de caixa com `overflow: hidden`**: a
  caixa vira o contexto de rolagem. A moldura do modal usa `overflow: 'clip'`
  no celular (corta igual, sem criar contexto de rolagem) e fica sem padding.
- **O modal cobre a tela inteira no celular, sem moldura para tocar e fechar.**
  Projeto apagado, ou escondido por RLS, deixava a pessoa presa no spinner. Por
  isso o botão "Fechar" no carregamento (o estado "Projeto não atribuído a
  você" já tinha o seu).
- As abas **não** ganharam `minHeight: 44` inline: a regra global de CSS já dá
  48 px (ver [Armadilhas](#armadilhas)), e um inline de 44 **venceria** a folha e
  pioraria.

## PWA

Plugin `vite-plugin-pwa`, configurado em `vite.config.ts`. Modo `generateSW`
(o plugin gera o `sw.js`).

- **Manifesto:** nome "GD Manager Energy", `short_name` "GD Manager",
  `display: standalone`, `theme_color` `#F5A800`, `lang: pt-BR`, `start_url: /`.
  O `index.html` ganhou `theme-color` e as metas de web app (Android e iOS).
- **Ícones:** `public/icone-192.png` e `public/icone-512.png`; o de 512 também
  serve como `maskable`. A logo ocupa **80% do lado**, a zona segura do
  `maskable`: o que passa disso pode ser cortado pelo recorte que o sistema
  aplica ao ícone. A logo de origem é pequena (187×188 px), então no ícone de
  512 ela é ampliada.
- **Precache só da casca** (`globPatterns`: js, css, html, ico, png, svg,
  woff2). Medido no build de 15/10/2026: **16 entradas, ~4,3 MiB** num
  checkout limpo. Cuidado ao conferir: `globPatterns` pega **qualquer** `.html`
  de `public/`, então um rascunho solto ali entra no precache e muda a conta
  (foi o que aconteceu com um `_medida-card.html` não rastreado, que rendia uma
  17ª entrada só nas máquinas que o tinham).
- **`maximumFileSizeToCacheInBytes` = 4 MiB.** O chunk principal tem ~3,6 MB e o
  limite padrão do workbox é 2 MiB. Sem o ajuste, o arquivo mais importante
  ficaria **fora** do precache, com um mero aviso no build.
- **`globIgnores` tira a família de PDF** (`html2pdf`, `pdf`, `jspdf`,
  `html2canvas`, `purify` e `index.es-*` — este último é o canvg, 147 KiB, que
  só o `jspdf` importa e que escapou na primeira volta; ~1,9 MB no total), que
  só carrega quando alguém **gera
  documento** — e aí há rede. Precachear tudo seriam ~6 MB na primeira visita,
  num celular com plano de dados. O `pdf.worker.min-*.mjs` (~1,2 MB) já fica
  fora porque `.mjs` não está nos `globPatterns`.
- **Atualização:** `registerType: 'prompt'` (decisão 3). O `sw.js` só faz
  `skipWaiting` quando o usuário clica em "Atualizar".
- **`registerSW` está em `src/main.tsx`**, com import estático do `sonner` (que
  já está no pacote principal; o import dinâmico não separaria nada e só geraria
  aviso no build).

O service worker **não é registrado no `npm run dev`** (o plugin não liga o SW
em desenvolvimento). Para testar PWA, use `npm run build` e `npm run preview`.

## O que não existe, e pendências

**Não foi feito** (a spec §3 previa algumas destas; não documente como entregue):

- **Cartões na aba de documentos** do `ProjectModal` — cancelado de propósito
  (decisão 1).
- **Tela de novo projeto refeita** para celular (passos empilhados, campos de
  44 px, teclado por campo). Segue como era.
- **Ludmilla/avisos em cartões.** Segue como era.
- **Telas administrativas, console do master (`/painel`) e relatórios.** Só as
  grades de `Reports` colapsam; as tabelas dessas telas continuam como eram.
- **As demais telas com `<table>`** e as páginas que a spec mediu sem nenhum
  tratamento (Tarefas, E-mails, Perfil, Cadastro, Landing, Index, NotFound,
  ProjectModalPage, PublicFormSuccess) **não foram tocadas**. Herdam o padrão
  quando forem mexidas.
- **Convite de instalação próprio.** Só existe o que o navegador oferece sozinho.

**Pendências (feito pela metade ou sabido e não resolvido):**

- **Aba corrente visível no modal — pela metade.** O cabeçalho gruda e as abas
  rolam, mas **a aba ativa não é trazida para dentro da vista** quando o modal
  abre numa aba da direita (por exemplo "Assinaturas"). Quem abre o projeto
  nessa aba não vê qual está ativa, até rolar a barra. Falta um
  `scrollIntoView` (ou equivalente) no botão da aba ativa; hoje não há nenhum
  no arquivo.
- **O que ninguém viu rodando:** o botão de instalar do Chrome e a abertura
  "sem barra" do app instalado, o aviso "Nova versão disponível" (exige duas
  versões publicadas em sequência) e o carregamento sem rede.
- **Nginx sem regra para `sw.js` e `manifest.webmanifest`.** O Chrome já ignora
  o cache HTTP para o script do service worker, então não trava, mas vale
  `Cache-Control: no-cache` neles (ver
  [`nginx-cache-headers.yml`](../../../.github/workflows/nginx-cache-headers.yml),
  que hoje só trata o `index.html`).
- **A barra inferior nasce com 3 itens e ganha o 4º** (Avisos) quando o tenant
  carrega, porque `useLudmillaDisponivel()` depende de dado assíncrono. É um
  salto de layout por sessão.
- **Em 640–767 px o app passa a se comportar como tela larga.** Com o limiar
  unificado em 640, o `DocumentUploadField` perde os atalhos de câmera/galeria e
  as prévias nessa faixa (ex.: iPad mini em pé, 744 px). O upload segue
  funcionando. Se incomodar, o conserto é o campo usar `isTablet` para a câmera.
- **`statusVariants` mora em `src/mobile/` mas não é específico de celular**;
  `src/lib/statusMapping.ts` seria o lugar natural numa refatoração futura.
- Num projeto sem titular e sem título, o título do cartão repete o campo
  "Código". Um projeto com status fora do modelo da empresa recebe o rótulo de
  fábrica no cartão e o da coluna no desktop.

## Construído diferente da spec

A spec desenha o alvo; estes pontos divergem e esta doc segue o código:

- **Barra da empresa: Financeiro, não Documentos.** A spec previa "Projetos ·
  Novo projeto · Documentos · Perfil". Não existe rota de documentos fora do
  modal do projeto (`src/App.tsx`), então o atalho aponta para
  `/company/financial`. O ícone `documentos` existe no mapa do `BottomNav`, sem
  uso.
- **"Avisos" do gestor leva à Ludmilla** (`/ludmilla`), não a uma tela geral de
  avisos, e some para quem não tem a Ludmilla.
- **`start_url` é `/`** para todos, não por papel.
- **Documentos não viraram cartões** (spec §3): decisão 1.
- **Ludmilla/avisos e novo projeto não foram refeitos** (spec §3): seguem como
  eram.
- **A "aba corrente visível" do modal ficou pela metade** (spec §2): ver
  pendências.
- **`use-mobile.tsx` passou de 768 para 640.** A spec não previa mexer nele: só
  citava o 640 do `useWindowSize`. Foi o que acabou com a gaveta travada entre
  640 e 767 px.
- **O convite de instalação "uma vez, dispensável"** não foi feito.

## Como conferir uma tela em 390 px

Tela se confere no navegador — o `vitest` não tem DOM.

1. Suba o servidor de desenvolvimento: entrada **`Vite Dev Server`** do
   `.claude/launch.json` (`npm run dev`, porta **5173**).
2. Ponha o viewport em **390 px** de largura (altura 844, por exemplo): modo de
   dispositivo do DevTools, ou `resize_window` no painel do Claude. Recarregue
   depois de trocar, para os testes de largura no carregamento rodarem de novo.
3. Responda às três perguntas:

   - **Sobra rolagem lateral?** No console, tem de dar `false`:
     ```js
     document.documentElement.scrollWidth > document.documentElement.clientWidth
     ```
   - **Algum alvo de toque abaixo de 44 px?** Lista o que é botão ou link visível
     e baixo demais:
     ```js
     [...document.querySelectorAll('button, a, [role=button]')]
       .filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && r.height < 44; })
     ```
     A regra global de CSS já dá 48 px a esses elementos abaixo de 768 px; o que
     aparecer aqui costuma ser um `minHeight` inline menor vencendo a folha.
   - **A 1280 px ficou igual ao que era?** O padrão é aditivo e só age abaixo
     de 640 px, mas confira: volte o viewport a 1280 px e compare a tela com a
     produção (que roda a `main`). Kanban, modal, documentos e relatórios têm de
     estar iguais.

4. Para PWA (manifesto, service worker, cache): `npm run build` e
   `npm run preview` (porta **4173**), e então DevTools → Application. O
   `dist/` tem de ter `manifest.webmanifest` e `sw.js`.

Antes de entregar qualquer mudança, o baseline da casa: `npx tsc --noEmit -p
tsconfig.app.json` em **65** erros, `npx vitest run` verde e `npm run build`.

## Armadilhas

- **`children` do `ListaEmCartoes` somem no celular.** Busca, filtro e botão de
  ação ficam fora do componente. Ver [Lista em cartões](#lista-em-cartões).
- **Dois limiares de celular convivem, em camadas diferentes.** O TypeScript
  usa 640 (`breakpoints.ts`). O CSS global de `src/index.css` usa
  `@media (max-width: 767px)`, e as classes do Tailwind seguem o padrão dele
  (`sm:` = 640, `md:` = 768). Entre 640 e 767 px as camadas discordam. Esse
  bloco do CSS faz três coisas abaixo de 768 px: `min-height: 48px` em
  `button`, `a`, `[role="button"]` e `label[for]`; fonte de 16 px em `input`,
  `textarea` e `select` (evita o zoom automático do iOS ao focar); e diálogos
  Radix viram folha subindo da base da tela. **Um `minHeight` inline menor vence
  a folha** — por isso não se põe `minHeight: 44` inline onde a folha já dá 48.
- **`position: sticky` + `overflow: hidden` não gruda.** Use `overflow: clip`
  no ancestral (ver `ProjectModal`).
- **`index.html` precacheado: o Nginx deixa de mandar na versão.** O
  [`nginx-cache-headers.yml`](../../../.github/workflows/nginx-cache-headers.yml)
  existe porque o `index.html` sem `Cache-Control` já fez publicações "não
  chegarem" ao usuário (set/2026). Com o service worker, depois da primeira
  visita quem decide é o aviso "Nova versão disponível": o usuário só troca de
  versão ao clicar. Publicou e "não chegou" para alguém? Pergunte se a pessoa
  viu e clicou no aviso.
- **Qualquer `.html` em `public/` entra no precache**, porque `globPatterns` tem
  `**/*.html`. Rascunho commitado ali vira parte da casca do PWA.
- **Dado nunca é cacheado.** Quem for tentado a adicionar `runtimeCaching` para
  "ajudar sem rede" está desfazendo a decisão 2 — releia o porquê antes.
- **Mudar a cor de uma variante do `Badge` exige mudar `cartaoDeProjeto.ts`.**
  O teste não pega a divergência.
- **Grade nova com 3–4 colunas fixas e sem `gradeColapsavel`** volta ao problema
  de colunas de ~90 px no celular. Foi assim que as seis primeiras nasceram.

## Arquivos

| O quê | Onde |
|---|---|
| Padrão | `src/mobile/` (`breakpoints`, `resumoDeCartao`, `atalhos`, `cartaoDeProjeto`, `ListaEmCartoes`) |
| Barra inferior | `src/components/layout/BottomNav.tsx`; usada em `src/components/layout/MainLayout.tsx` |
| Hooks de largura | `src/hooks/useWindowSize.ts`, `src/hooks/use-mobile.tsx` |
| Uso dos cartões | `src/pages/company/CompanyProjects.tsx` |
| Modal em tela cheia | `src/components/projects/ProjectModal.tsx` |
| PWA | `vite.config.ts`, `src/main.tsx`, `index.html`, `public/icone-192.png`, `public/icone-512.png` |
| Regras globais de toque (CSS) | `src/index.css` (bloco `@media (max-width: 767px)`) |

Relacionado: [Projetos](../projects/overview.md) · [Homologação](../homologation/overview.md)
· [Ludmilla](../integrations/ludmilla.md) · [Arquitetura](../../project/architecture.md).
