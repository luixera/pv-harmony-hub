# GD Manager no celular — padrão mobile + PWA

**Data:** 15/10/2026 · **Estado:** desenhado com o usuário, aprovado para virar plano
**Decisões dele nesta conversa:** alvo = **PWA** (não app nativo) · públicos = **gestor
acompanhando** e **empresa integradora** (projetista em campo ficou fora) · abordagem =
**padrão mobile + PWA nas telas desses dois públicos** · navegação = **barra inferior
com 4 atalhos**.

## 1. O problema, medido

O app já é responsivo, mas o responsivo foi feito tela a tela, onde doeu. Não existe
padrão — e é isso que faz a visualização ser ruim no celular.

| Achado (medido em 15/10/2026) | Efeito em 390 px |
|---|---|
| **6 grades rígidas** de 3–4 colunas sem `isMobile`: `ProjectModal:1818`, `TaskDialog:203`, `NewRevisionDialog:258`, `Reports:254/313/390` | colunas de ~90 px, texto ilegível |
| **10 telas com `<table>`** | não cabem; rolam de lado ou cortam |
| **9 páginas sem nenhum tratamento**: Tarefas, E-mails, Perfil, Cadastro, Landing, Index, NotFound, ProjectModalPage, PublicFormSuccess | layout de desktop encolhido |
| `isMobile < 640px` em **13 arquivos**; `ProjectModal` sozinho tem **21** usos | remendo pontual, não padrão |
| Sem `manifest.json`, sem service worker | não instala, não abre em tela cheia, morre sem rede |

## 2. O padrão (o coração desta entrega)

Um módulo que as telas **consomem**, em vez de cada uma resolver do seu jeito.

- **Breakpoint único.** `useWindowSize` já define `isMobile < 640` e `isTablet < 1024`;
  continua sendo a fonte. Nada de `@media` solto competindo com ele.
- **Lista vira cartão.** Abaixo de 640 px, `<table>` dá lugar a cartões empilhados:
  título (titular), um selo de etapa e **no máximo três** campos de apoio. Quem precisa
  do resto abre o item. Vale para projetos, tarefas, documentos e financeiro.
- **Navegação inferior fixa**, 4 atalhos por papel:
  - admin/staff: Projetos · Tarefas · Avisos · Perfil
  - company: Projetos · Novo projeto · Documentos · Perfil
  - o menu completo continua na gaveta lateral; a barra é atalho, não substituto.
- **Toque de 44 px** mínimo em tudo que é clicável (hoje há botões de 32 px).
- **Modal em tela cheia** no celular, com cabeçalho fixo e aba corrente visível —
  o `ProjectModal` já faz parte disso na marra; passa a fazer pelo padrão.
- **Grades colapsam**: as 6 rígidas passam a `1fr` abaixo de 640 px.

## 3. Telas da primeira fase

Só as dos dois públicos escolhidos:

| Tela | O que muda |
|---|---|
| Projetos (Kanban) | colunas viram lista de cartões com filtro de etapa no topo |
| Modal do projeto | tela cheia, abas roláveis, grade de dados em 1 coluna |
| Novo projeto | passos um abaixo do outro, campos de 44 px, teclado certo por campo |
| Documentos | cartões com nome, tipo e ação; upload com alvo grande |
| Ludmilla / avisos | cartões; o cartão de CAPTCHA já nasceu pensado para celular |

Fora desta fase, de propósito: console do master, relatórios, telas administrativas.
Elas herdam o padrão quando forem tocadas.

## 4. PWA

- `manifest.webmanifest`: nome, ícones (192/512 + maskable), `display: standalone`,
  `theme_color` da marca, `start_url` conforme o papel.
- Service worker com **cache do shell** (HTML, JS, CSS, ícones) — abre instantâneo e
  sobrevive a sinal ruim. Dados continuam vindo da rede.
- Convite de instalação discreto, uma vez, dispensável.
- **Sem fila de escrita offline.** O uso é consulta e envio pontual; fila de escrita é
  onde esse tipo de projeto se perde (conflito, duplicata, dado velho aplicado por
  cima). Se um dia o projetista em campo entrar no escopo, aí se discute.

## 5. Testes

- **vitest**: a lógica pura — escolha de colunas por largura, montagem do resumo do
  cartão (quais 3 campos), atalhos por papel.
- **Tela**: conferência no navegador com viewport de celular antes de entregar cada
  tela (medindo largura de conteúdo e rolagem horizontal, como se fez no extrato).
- Baseline da casa: `npx tsc --noEmit -p tsconfig.app.json` em **65** e `npm run build`.

## 6. Riscos

- **Regressão no desktop.** O padrão é aditivo e só age abaixo de 640 px; cada tela
  tocada é conferida nas duas larguras.
- **`ProjectModal` é grande** (21 usos de `isMobile`). Ele entra como consumidor do
  padrão, não como refatoração geral — trocar o que já existe por chamadas ao módulo,
  sem reescrever a tela.
- **Service worker servindo versão velha.** Estratégia de atualização explícita
  (`skipWaiting` + aviso de recarregar), senão o usuário fica preso numa versão antiga.

## 7. Fora de escopo

App nativo (React Native) e a skill `design-mobile-apps`/Sleek: ela desenha telas de app
nativo por um serviço externo pago (`SLEEK_API_KEY`), que exigiria mandar informação do
GD para fora. Não serve para PWA e não será usada nesta entrega.
