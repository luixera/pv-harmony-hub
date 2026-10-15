# ADR 0010 — WebGL (deck.gl) para as camadas densas do mapa de rede

**Status**: aceito · **Data**: out/2026

## Contexto

O mapa de capacidade de rede (spec
[2026-10-10-capacidade-rede-design.md](../superpowers/specs/2026-10-10-capacidade-rede-design.md),
§11 e §12) mostra, numa vista de 1920×1080 sobre Campinas, até 3.000 células
ou 4.000 trafos e até 600 alimentadores de MT em 22 mil partes de linha. As
duas primeiras versões usaram o que o Google Maps oferece: `<Marker>` React
(v1) e `google.maps.Data` (v2). As duas desenham em DOM/SVG — um elemento por
marcador, um `<path>` por parte de linha — e as duas travaram ao arrastar
(medido em 13 e 15/10/2026: 1.500 marcadores refeitos por render na v1; 40 a
120 mil `<path>` movidos por arrasto na v2).

A alternativa de só reduzir o dado (menos células, menos alimentadores) foi
medida e não basta: no zoom 12 Campinas tem 2.071 células de 1,4 km e 600
alimentadores; abaixo disso a tela deixa de informar.

## Decisão

1. **As camadas de dado do mapa são desenhadas em WebGL com `deck.gl` 9.4**
   (`@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/google-maps`), via
   `GoogleMapsOverlay` sobre o mapa raster do Google. O mapa, a busca (Places)
   e o loader continuam no `@react-google-maps/api`.
2. **Carregado por `import()` só nesta tela** (`rede/useDeck.ts`): o resto do
   SPA não paga pelo WebGL.
3. **A montagem das camadas é uma função pura** (`rede/camadas.ts`) que recebe
   as classes do deck por parâmetro e é testada com fábricas falsas. Os ícones
   vêm de um atlas desenhado em canvas (`rede/atlas.ts`) com as mesmas formas
   da legenda — a regra "cor nunca sozinha" se mantém.
4. O servidor continua decidindo a amostra (`rede_amostra`): WebGL desenha
   muito, mas a rede não transporta muito. O teto é 4.000 pontos ou 3.000
   células por caixa.

## Consequências

- Mais uma dependência grande (deck.gl + luma.gl + loaders.gl + math.gl),
  isolada num chunk próprio. Procurado no registro de skills
  (`npx skills find deck.gl`): nada pronto; a biblioteca é a referência da área.
- Picking (hover e clique) é do deck, não do Google: os eventos saem das
  camadas (`onHover`, `onClick`) e a seleção é uma camada própria por cima,
  não um `overrideStyle`.
- Os módulos `google.maps.Data` da v2 (`useCamadaVetorial`) saíram. Os estilos
  da v2 (`rede/estilos.ts`) ficam como fonte das cores, formas e larguras.
- Se um dia o mapa migrar para o modo vetorial do Google (`mapId`), o deck
  entra interleaved sem mudar as camadas.
