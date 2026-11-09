# Ludmilla, entrega 2 — a página nova ("Conta de luz", estrutura A) — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** trocar a `/ludmilla` inteira pela estrutura A no mundo "Conta de luz" — faixa petróleo, coluna da esquerda (recado, Para decidir com "Fila de", Carteira, Comigo, Leituras), lista no meio e detalhe/ficha/painel à direita, e uma coluna por vez no celular — lendo o que a entrega 1 pôs no banco, sem mexer no banco.

**Arquitetura:** toda regra nova vira função pura em `src/lib/` com vitest antes do código (grupo e dono de cada item, prazo, texto em primeira pessoa, recado, barras do histórico, filtros e ordem da carteira, leituras, próximo passo). Os dados chegam por três hooks novos (`useLudmillaPagina.ts`) sobre as RPCs da entrega 1 e as consultas que a página já faz. A tela é uma casca de apresentação (`PaginaDaLudmilla`) que recebe tudo por props e render props — o que lê banco fica do lado de fora, e o harness passa dublês. O detalhe de decisão é o `DetalheDaDecisao` de hoje, com edições pontuais (títulos em primeira pessoa e duas props novas: `topo` e `historico`). Os tokens do mundo ficam escopados: cores `lm-*` no Tailwind e uma classe `.ludmilla-mundo` que redefine as variáveis do shadcn só dentro da página.

**Tech Stack:** React 18 + TypeScript + Vite, TailwindCSS + shadcn/ui (Sheet, Button, Select, Textarea), React Query 5, sonner 1.7, Supabase JS (RPC e PostgREST), vitest 2 (ambiente `node`).

**Spec:** `docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md` (§2–§6 e §9, entrega 2). Mockup aprovado (referência de layout, textos, tokens e comportamento; NÃO é código a copiar): `C:\Users\luiza\AppData\Local\Temp\claude\eae21381ca6475d8\14363274-6942-4702-b992-e5bb0f8086db\scratchpad\ludmilla-mockup\project\` — `LudmillaA.dc.html` (computador), `CelularLista.dc.html`, `CelularDetalhe.dc.html`, `CelularMenu.dc.html` (celular) e `Mundo.dc.html` (o mundo visual).

## Pendências de banco

**Nenhuma.** Esta entrega não precisa de migração. Três coisas que precisariam de consulta ou coluna nova ficaram FORA de propósito (ver "Fora da entrega 2"): "Passar para outra pessoa" (coluna de dono escolhido em `portal_updates`/`portal_afazeres`), a barra extra da troca do medidor da ENEL (consulta da aprovação da vistoria até a troca feita) e a "certeza" da sugestão (não existe dado de certeza no banco).

## Global Constraints

Valem para TODA tarefa, além do que ela pede.

- **Só a `/ludmilla` muda.** "Só a página `/ludmilla` usa este mundo. O menu lateral e o resto do GD Manager não mudam." (spec §3). O robô, o casamento de e-mails, as regras de recomendação, a cobrança e o pedido da troca, o Kanban, o modal do projeto, o contador da barra lateral e os outros tenants não mudam (spec §8).
- **Quem vê:** a página continua só para `useLudmillaDisponivel()` (admin/staff de tenant `is_library`). Não mudar permissão, rota, `ProtectedRoute` nem RLS.
- **Banco:** nenhuma migração, nenhuma RPC criada ou alterada. PROIBIDO rodar `npx supabase db query` (com ou sem `--yes`) e `db push`. A tela lê só o que já existe: `ludmilla_carteira()`, `ludmilla_normais()`, `ludmilla_registro()`, `ludmilla_linha_do_tempo()`, `portal_updates`, `portal_afazeres`, `portal_sync_runs`, `portal_email_mensagens`, `portal_captchas`, `portal_accounts` (todas já liberadas para a equipe).
- **Cores (spec §3, literais):** papel `#FFFFFF` (fundo), petróleo `#0F3D4C` (texto e faixa do topo), sol `#F2B705` (ação principal, item ativo, "agora"), caixa `#E7EEF0` (coluna da esquerda, painéis, campos), alerta `#C2410C` (além do normal), barra neutra `#9FB8C0`, texto secundário `#3E5F6A`. "Texto sobre sol é petróleo." Ajuste deste plano (decisão 1): texto em alerta SOBRE caixa usa `#8F2F09` — o `#C2410C` dá 4,41:1 sobre `#E7EEF0`.
- **Tipo:** "Public Sans (Google Fonts), números tabulares em toda a página; rótulos pequenos em caixa normal, como os campos da fatura" (spec §3). A fonte é carregada SÓ pela página (`useFonteDaLudmilla`); o Inter global não muda. O CSP (só relatório) já permite `fonts.googleapis.com` (style-src) e `fonts.gstatic.com` (font-src) — `.github/workflows/nginx-cache-headers.yml`, `CSP_VALOR`.
- **Voz:** "Primeira pessoa, como colega, em toda a página" (spec §2).
- **Com quem está a bola (spec §6.4):** no banco `nos` | `concessionaria` | `cliente`; na tela "Com a gente" | "Com a concessionária" | "Com a empresa" (o mockup diz "Com o cliente": vale a decisão de 09/11).
- **Comportamentos que ficam (spec §4.5):** Desfazer em 8 s antes da MESMA RPC de hoje (`ESPERA_DO_DESFAZER_MS`, `useFilaDeDecisoes`, `useAcoesDaCaixa` — nunca as mutações diretas); depois de decidir, o detalhe passa ao próximo item; o contador da barra lateral (`useContadorDaLudmilla`) continua; o CAPTCHA da Elektro continua como alerta urgente acima de tudo.
- **Nunca:** e-mail à concessionária sem o clique de alguém; a Ludmilla resolver CAPTCHA; nada fora do tenant GD Manager.
- **Acessibilidade:** contraste ≥ 4,5:1 em todo texto; botões de verdade (`<button>`); foco visível (contorno petróleo de 2 px com folga de 2 px; branco sobre a faixa petróleo — decisão 2); no celular toques ≥ 44 px (o `src/index.css` já dá `min-height: 48px` a todo botão abaixo de 767 px — nunca pôr altura menor inline); sem rolagem lateral; `prefers-reduced-motion` respeitado nos esqueletos (`motion-reduce:animate-none`).
- **Tokens escopados:** cores `lm-*` e fonte `font-lm` acrescentadas ao Tailwind (nenhuma chave existente muda); as variáveis do shadcn só são redefinidas dentro de `.ludmilla-mundo`. Nenhum token global do GD muda.
- **TDD:** lógica pura em `src/lib/` (ou `.ts` puro ao lado do componente, como `decidir/altura.ts`) com vitest ANTES do código: teste vermelho → código → verde → commit. Componentes finos.
- **Identificadores em português**, como o módulo já faz.
- **Fuso:** Brasília é UTC−3 fixo (sem horário de verão desde 2019). Dia, hora e dia da semana saem de `src/lib/ludmillaTempo.ts`.
- **Verificação de toda tarefa:** antes de mexer, `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → **65** (uma QUEDA grande = falha de parse, não melhoria); no fim, o mesmo 65, `npm run build` sem erro e os testes da tarefa verdes (`npx vitest run <arquivos>`; a suíte toda é `npm test` = `vitest run`).
- **Prova na tela:** harness com dados inventados e dublês, nunca com senha nem sessão de verdade, em 1440 × 900 e 390 × 844 no navegador do Claude. Harness apagado ANTES do commit e NUNCA commitado (`git status --short` não pode listar `harness*`).
- **Commits:** `git add <caminhos>` e depois `git commit -F "$RASCUNHO/msg-e2-tN.txt" -- <caminhos>`. A mensagem vai num arquivo escrito com a ferramenta Write (o heredoc do bash desta máquina come a linha em branco), com linha em branco depois do título e terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Conferir com `git show --stat HEAD`. Nunca `git stash` puro (a pilha é compartilhada entre worktrees).
- **`$RASCUNHO`** = o diretório de rascunho (scratchpad) da SUA sessão, fora do repositório. Os comandos rodam da raiz do repositório, no Git Bash.
- **Celular:** `useWindowSize()` — `isMobile` < 640 px (fonte única: `src/mobile/breakpoints.ts`). `position: sticky` não gruda dentro de `overflow: hidden`: rodapé fixo do detalhe é flex de coluna (como hoje). A barra de atalhos do app (`BottomNav`) continua.

## Fora da entrega 2

- As quatro chaves de autonomia, "Fiz sozinha" com Desfazer e o ADR 0013 (entrega 4). Aqui "Fiz sozinha" lista o que ela JÁ faz sozinha hoje, sem Desfazer.
- O resumo da manhã por WhatsApp/e-mail (entrega 5). O Diário mostra à direita o recado do dia por inteiro.
- O item `parado` na fila e o avaliador diário (entrega 3).
- "Passar para outra pessoa" (precisa de coluna nova): o link NÃO aparece.
- A barra extra da troca do medidor da ENEL (precisa de consulta nova): as barras são só as etapas do Kanban.
- O avatar definitivo (entrega 6): entra o SVG provisório do mockup.

## Decisões tomadas além da spec (revisar com o usuário)

1. **Contraste do alerta sobre a caixa.** `#C2410C` sobre `#E7EEF0` dá 4,41:1 (abaixo de 4,5). Na coluna da esquerda (número "Parados além do normal", leituras que pedem alguém) o texto em alerta usa `#8F2F09` (6,9:1), o mesmo do chip vermelho do mockup. Sobre o papel branco o `#C2410C` fica (5,2:1).
2. **Foco.** O mockup usa contorno sol sobre branco (1,8:1, quase invisível). O foco é petróleo (11,7:1) com folga de 2 px; sobre a faixa petróleo, branco.
3. **CAPTCHA** fica só como o alerta urgente acima de tudo (§4.5). Não vira cartão nem entra na contagem de "Agora" (§6.1): não é item da fila e não tem decisão por RPC.
4. **Grupo de cada item (§6.1)** — o que a spec não cobre: "hoje" = mesmo dia em Brasília; vistoria aprovada vai para Agora com 7 dias inteiros (`>= 7`); troca que falhou e e-mail que voltou são Agora; recomendação SEM etapa (só gravar protocolo, sem sugestão) e documento travado são Quando puder (travado vence: mesmo com etapa, é Quando puder, porque não tem Aplicar); o A fazer genérico (`aviso`) é Quando puder.
5. **Dono (§6.2):** vem de `donos` da linha da carteira pelo `project_id` do item. Item sem projeto, ou de projeto fora da carteira (arquivado, concluído), é "Sem dono". O projetista (staff) abre na própria fila mesmo sem vínculo (aparece um botão com o nome dele); o admin abre em Todos.
6. **"Desde" do recado (§4.2):** guardado por usuário no `localStorage` (`ludmilla:ultima-visita:<id>`, leitura e gravação em try/catch). Sem registro (ou registro inválido/no futuro), vale 18:00 de Brasília do último dia útil anterior (a última leitura da ENEL; sem feriados). Nunca mais de 7 dias para trás. O valor é lido UMA vez ao abrir a página e a visita é gravada logo em seguida.
7. **Números do recado:** e-mails = quantas linhas `portal_email_mensagens` a conta ganhou desde então; protocolos = o MAIOR `protocolos_lidos` de uma varredura `ok` desde então (somar contaria duas vezes os mesmos protocolos das duas varreduras do dia). "Fiz N coisas sozinha" = linhas do registro da Ludmilla desde então com `anexo` ok OU `parecer` (pareceres também vão sozinhos ao card hoje). "Separei N" = a fila de todos, sem o filtro de dono. Se a contagem falhar, o recado diz "não consegui contar o que li" em vez de "não li nada".
8. **Barras (§6.3):** as colunas do Kanban na ordem do tenant (`useStatusOrder`; sem ele, `VALID_PROJECT_STATUSES`), sem `completed`. Mostra as etapas já visitadas e, do caminho principal, as que vêm depois da última visitada; os desvios (`pendencia`, `vistoria_sem_protocolo`, `vistoria_reprovada`) só aparecem se visitados. Estadas repetidas numa etapa somam; a etapa ATUAL mostra só a estada de agora (`dias_na_etapa` da carteira, o mesmo número do texto e do alerta). Só a barra atual muda de cor (sol, ou sol até o traço e alerta acima); as passadas ficam neutras com o traço do normal, como no mockup.
9. **Dias inteiros:** a tela mostra `floor(dias)` e decide "além do normal" com o MESMO número (`floor(dias) > normal`) — senão sairia "7 dias, o normal é até 7" em alerta. O filtro "Parados além do normal" usa a mesma regra.
10. **O normal em palavras:** `medido` → "o normal na ENEL SP é até 7" (no cartão, "o normal é até 7"); `geral` → "o normal estimado é até 7" (spec §11); `coluna` → "o prazo do Kanban é 7"; sem normal → "ainda sem normal medido". Etapa com rótulo começando por "Em " vira "em Análise" (nunca "em Em Análise").
11. **Ordem da carteira (spec §4.3, corrigida na revisão):** primeiro os além do normal (pela regra da tela, decisão 9), do maior atraso para o menor; depois todos os outros pelo tempo na etapa, do maior para o menor; empate pelo código. A RPC ordena diferente entre os sem atraso (pelo atraso); `ordenarCarteira` refaz a ordem no cliente e vale a da spec.
12. **"O que eu sugiro" sem a certeza.** Não há dado de certeza no banco; inventar uma escala seria dizer o que não se sabe. Fica o "achado pelo protocolo/pela UC/pelo nome do titular" que o detalhe já mostra no "Quem".
13. **Botão principal do cartão:** decide direto só quando a decisão de hoje não pede revisão — Aplicar habilitado ("Mover para Aprovado", "Gravar o protocolo", "Mover e gravar o protocolo") e "Marcar como feito". Cobrança, pedido da troca ("Revisar e enviar"), documento travado e item sem projeto ("Abrir para decidir") abrem o detalhe.
14. **Três modos de tela:** ≥ 1280 px três colunas; 960–1279 px coluna da esquerda + lista, com detalhe e ficha numa folha lateral; < 960 px uma coluna por vez (spec §5). A spec só desenha computador e celular. O "duas" começa em 960 (e não em 640) porque o menu do GD (256 px) já aparece a partir de 640: em 640 a lista ficaria com ~76 px (640 − 256 − 48 de respiro − 260 da esquerda); em 960, ~396 px. Entre 640 e 959 a página usa a mesma tela de uma coluna do celular, ao lado do menu do GD.
15. **Saem da página:** a busca, os filtros por situação/tipo e o chip por concessionária da aba Decidir (a spec não tem; o histórico do que foi decidido está no Diário), o botão "Acessos aos portais" do cabeçalho (cada conta de portal tem "Acesso ao portal") e as abas.
16. **Ajustes nesta entrega:** no meio, "O que eu faço sozinha" (só leitura: anexar documento conferido = faço sozinha; o resto = passa pela fila), a linha fixa do e-mail à concessionária e "Como eu te aviso" (sino e número no menu; o resumo da manhã ainda não está ligado). À direita, "Onde eu leio": os alertas das contas, os cartões das contas de hoje (`CartaoDaConta`, com "Verificar agora" renomeado "Ler agora"), as criações na CPFL e "Ainda não acompanho …" calculado (concessionárias da carteira sem conta).
17. **Leituras (coluna da esquerda):** hora da última leitura se foi hoje, senão a data; "espera o código" quando há CAPTCHA aguardando; senão a palavra da saúde de hoje (`palavraDaSaude`), e "nunca lida" quando ela não leu ainda.
18. **Próxima leitura (lista vazia):** dos crons de hoje — portal 08:00 e 17:00 todo dia (`ludmilla-08h`, `ludmilla-17h`); e-mail pelos remetentes (ENEL) de hora em hora das 08:00 às 18:00, seg–sex (`ludmilla-enel-email`); e-mail pelo protocolo no assunto (EDP) só pelo "Ler agora". Mudou um cron, mude `HORAS_DO_PORTAL`/`HORAS_DO_EMAIL`.
19. **A faixa petróleo encosta no menu do GD:** a página cancela o respiro do `MainLayout` dos quatro lados (`-mx-4 -mt-4 md:-mx-6 md:-mt-6`; embaixo `-mb-4 md:-mb-6`, e no celular `-mb-20` com `pb-20` por dentro, por causa da `BottomNav`) e pinta o papel branco até o fim da janela, sem faixa cinza embaixo.
20. **"O que eu li por último" da ficha** = `ludmilla_linha_do_tempo` do projeto, só os eventos da Ludmilla, os 5 mais novos, em primeira pessoa.
21. **O aviso com Desfazer** continua o `toast` global (sonner, no alto da tela, estilo do GD): ele mora fora da página. O menu aberto do seletor de etapa do detalhe (`SelectContent`, num portal do Radix) também fica no estilo do GD, pelo mesmo motivo.
22. **Vistoria aprovada (§6.1):** a spec põe em "Esta semana" a vistoria aprovada "com o pedido da troca liberado". O item da fila não traz `liberado`; o plano agrupa toda `vistoria_aprovada` pela idade (decisão 4) e o cartão abre o detalhe, que mostra se o pedido está liberado.
23. **Carteira carregando ou com falha:** a fila mostra "carregando" ou o aviso de falha (com "Tentar de novo" para as duas consultas), nunca "Nada aqui agora", e o recado não afirma "N sem dono" (spec §4.6).
24. **Recarregar a página zera o "desde":** a visita é gravada a cada abertura (decisão 6, spec §4.2: "última vez que a pessoa abriu a página"); depois de um F5 o recado diz que não leu nada novo.

## Mapa de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `src/lib/ludmillaTempo.ts` (+ `.test.ts`) | 1 | dia, hora, dia da semana e saudação em Brasília |
| `src/lib/ludmillaCarteira.ts` (+ `.test.ts`) | 1 | tipos e leitura das RPCs da entrega 1, filtros, contagem, ordem, "além do normal", textos do tempo, donos, próximo passo, concessionárias não acompanhadas |
| `src/lib/ludmillaBarras.ts` (+ `.test.ts`) | 2 | o histórico em barras (quais etapas, alturas, traço, tom) e a descrição para leitor de tela |
| `src/lib/ludmillaFila.ts` (+ `.test.ts`) | 3 | grupo (§6.1), dono e "Fila de" (§6.2), prazo, título, porquê, botão do cartão |
| `src/lib/ludmillaRecado.ts` (+ `.test.ts`) | 4 | "desde", recado do dia, visita no `localStorage`, Fiz sozinha, Diário em primeira pessoa |
| `src/lib/ludmillaLeituras.ts` (+ `.test.ts`) | 5 | linhas de Leituras, próxima leitura, soma das leituras |
| `src/components/ludmilla/pagina/modo.ts` (+ `.test.ts`) | 5 | três, duas ou uma coluna pela largura |
| `src/hooks/useLudmillaPagina.ts` | 6 | carteira, normais, leituras desde, "desde" do recado |
| `src/hooks/useLudmillaDecidir.ts` | 6 | (edição) decidir também atualiza a carteira |
| `tailwind.config.ts`, `src/index.css` | 7 | tokens `lm-*`, `font-lm`, `.ludmilla-mundo` |
| `src/components/ludmilla/mundo/cores.ts` | 7 | os hex do mundo para `style` |
| `src/components/ludmilla/mundo/useFonteDaLudmilla.ts` | 7 | carrega a Public Sans só na página |
| `src/components/ludmilla/mundo/AvatarDaLudmilla.tsx` | 7 | avatar provisório |
| `src/components/ludmilla/mundo/pecas.tsx` | 7 | Chip, Donos, Esqueleto, AvisoDeFalha |
| `src/components/ludmilla/mundo/HistoricoEmBarras.tsx` | 7 | barras pequena e grande |
| `src/components/ludmilla/decidir/PainelDeDetalhe.tsx` | 8 | (edição) títulos em primeira pessoa, props `topo` e `historico` |
| `src/components/ludmilla/decidir/DetalheConectado.tsx` | 8 | (edição) repassa `topo` e `historico` |
| `src/components/ludmilla/pagina/TopoDaDecisao.tsx` | 8 | chip, dono, ação, projeto e "Abrir o projeto" do detalhe |
| `src/components/ludmilla/pagina/CartaoDaFila.tsx`, `ListaDaFila.tsx` | 9 | o cartão completo e a lista da fila |
| `src/components/ludmilla/pagina/LinhaDaCarteira.tsx`, `ListaDaCarteira.tsx`, `FichaDoProjeto.tsx`, `FichaConectada.tsx` | 10 | a carteira e a ficha da Ludmilla |
| `src/components/ludmilla/pagina/FizSozinha.tsx`, `Diario.tsx`, `AjustesDaLudmilla.tsx`, `OndeEuLeio.tsx` | 11 | as vistas Comigo e Ajustes |
| `src/components/ludmilla/abas/CartaoDaConta.tsx` | 11 | (edição) "Verificar agora" → "Ler agora" |
| `src/components/ludmilla/pagina/FaixaDaLudmilla.tsx`, `FaixaDoCelular.tsx`, `ColunaDaEsquerda.tsx`, `FolhaDaLudmilla.tsx` | 12 | navegação |
| `src/components/ludmilla/pagina/useEscolhaEDecisao.ts`, `PaginaDaLudmilla.tsx` | 13 | a casca: vista, seleção, decisão, três modos |
| `src/lib/ludmillaPagina.fixtures.ts` | 13 | dados inventados para o harness (o app nunca importa) |
| `src/pages/Ludmilla.tsx` | 14 | reescrita: liga hooks à casca |
| apagados: `decidir/{AbaDecidir,AbaDecidirConectada,CaixaDeDecisoes,FiltrosDaCaixa,LinhaDaCaixa}.tsx`, `topo/{BarraDeAbas,FaixaDeSaude}.tsx`, `topo/abas.ts`, `abas/{AbaConcessionarias,RegistroDaLudmilla}.tsx` | 14 | o que a página nova substitui |
| `docs/modules/integrations/ludmilla.md`, `docs/project/roadmap.md`, `CLAUDE.md` | 14 | documentação |

**Reaproveitado sem mudar:** `ludmillaCaixa.ts` (itens, ordem, próxima, seleção, ocultos), `ludmillaPainel.ts` (ações, textos da decisão, saúde e alertas das contas), `ludmillaFilaDeDecisoes.ts` + `useFilaDeDecisoes.ts` (Desfazer de 8 s), `useCaixaDaLudmilla.ts` (itens e contador), `useLudmillaDecidir.ts` (ações e consultas do detalhe), `decidir/altura.ts` (altura das colunas), `decidir/rascunhosDaCobranca.ts`, `topo/saude.ts`, `topo/AlertasDasContas.tsx`, `abas/CartaoCaptcha.tsx`, `abas/CriacoesCpfl.tsx`, `MensagensEmail.tsx`, `RegrasEmail.tsx`.

**`PainelDeDetalhe.tsx` (547 linhas)** não é reescrito: a Task 8 faz edições pontuais (títulos e duas props). Dividir o arquivo em seções exigiria reproduzir 550 linhas sem ganho para esta entrega.

---

### Task 1: O relógio de Brasília e a carteira (lógica pura)

**Files:**
- Create: `src/lib/ludmillaTempo.ts`
- Create: `src/lib/ludmillaCarteira.ts`
- Test: `src/lib/ludmillaTempo.test.ts`, `src/lib/ludmillaCarteira.test.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores. Formato das RPCs da entrega 1 (migrações `20261108200000_ludmilla_medir.sql` e `20261109120000_ludmilla_carteira_aprovado.sql`): `ludmilla_carteira()` → `project_id, code, titular, empresa, company_id, concessionaria, concessionaire_id, status, na_etapa_desde, dias_na_etapa, normal_dias, normal_fonte, atraso_dias, com_quem, donos jsonb [{id,nome}], historico jsonb [{etapa,dias,atual}], na_fila`; `ludmilla_normais()` → `concessionaire_id, etapa, normal_dias, amostra, fonte`.
- Produces (`ludmillaTempo.ts`): `DIA_MS`, `HORA_MS`, `DESLOCAMENTO_DE_BRASILIA_MS`, `emBrasilia(ms): Date`, `diaEmBrasilia(ms): number`, `diasEntre(iso: string | null | undefined, agora: number): number`, `inicioDoDia(ms): number`, `horaEMinuto(ms): string`, `diaEMes(ms): string`, `quandoCurto(ms, agora): string`, `DIAS_DA_SEMANA`, `diaDaSemana(ms): string`, `maiuscula(s): string`, `saudacaoDaHora(ms): 'Bom dia' | 'Boa tarde' | 'Boa noite'`.
- Produces (`ludmillaCarteira.ts`): tipos `ComQuem`, `FonteDoNormal`, `DonoDoProjeto {id; nome}`, `PassagemDoHistorico {etapa; dias; atual}`, `LinhaDaCarteira`, `NormalDaEtapa`, `FiltroDaCarteira = 'parados' | ComQuem | 'todos'`, `TempoDaLinha {dias; em; normalCurto; normalLongo; alerta}`; funções `linhaDaRpc(r)`, `normalDaRpc(r)`, `normaisDaConcessionaria(normais, concessionaireId): Map<string, NormalDaEtapa>`, `diasInteiros(d)`, `alemDoNormal(dias, normal)`, `ROTULO_COM_QUEM`, `FILTROS_DA_CARTEIRA`, `casaFiltroDaCarteira(l, f)`, `ordenarCarteira(linhas)`, `filtrarCarteira(linhas, f)`, `contarCarteira(linhas): Record<FiltroDaCarteira, number>`, `textoDosDias(d)`, `textoDoNormal(normal, fonte, concessionaria, curto?)`, `emEtapa(rotulo)`, `tempoDaLinha(l, rotuloEtapa)`, `donosPorProjetoDe(linhas): Map<string, DonoDoProjeto[]>`, `projetistasDaCarteira(linhas): DonoDoProjeto[]`, `juntarComE(partes)`, `proximoPasso(l, rotuloEtapa)`, `naoAcompanhadas(linhas, idsAcompanhados): string[]`, `fraseDasNaoAcompanhadas(nomes): string | null`.

- [ ] **Step 1: Medir o baseline do tsc**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: `65`. Se der outro número, PARE e avise: a árvore não está no estado que este plano supõe.

- [ ] **Step 2: Escrever o teste do relógio**

Crie `src/lib/ludmillaTempo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  diaDaSemana, diaEMes, diaEmBrasilia, diasEntre, horaEMinuto, inicioDoDia, maiuscula, quandoCurto, saudacaoDaHora,
} from './ludmillaTempo';

/** Segunda, 9/11/2026, 08:15 de Brasília. */
const SEG = Date.parse('2026-11-09T11:15:00Z');

describe('o dia em Brasília', () => {
  it('vira à meia-noite de Brasília, não à de Greenwich', () => {
    expect(diaEmBrasilia(Date.parse('2026-11-10T02:59:00Z'))).toBe(diaEmBrasilia(SEG));
    expect(diaEmBrasilia(Date.parse('2026-11-10T03:00:00Z'))).toBe(diaEmBrasilia(SEG) + 1);
  });

  it('conta dias de calendário', () => {
    expect(diasEntre('2026-11-09T10:00:00Z', SEG)).toBe(0);
    expect(diasEntre('2026-11-09T02:00:00Z', SEG)).toBe(1); // 23:00 de domingo
    expect(diasEntre('2026-11-06T20:00:00Z', SEG)).toBe(3);
    expect(diasEntre('lixo', SEG)).toBe(0);
    expect(diasEntre(null, SEG)).toBe(0);
  });

  it('começa às 00:00 de Brasília', () => {
    expect(inicioDoDia(SEG)).toBe(Date.parse('2026-11-09T03:00:00Z'));
  });
});

describe('como a fatura escreve', () => {
  it('hora, data, dia da semana', () => {
    expect(horaEMinuto(SEG)).toBe('08:15');
    expect(diaEMes(SEG)).toBe('9/11');
    expect(diaDaSemana(SEG)).toBe('segunda');
    expect(diaDaSemana(Date.parse('2026-11-06T20:00:00Z'))).toBe('sexta');
    expect(maiuscula('segunda')).toBe('Segunda');
    expect(maiuscula('')).toBe('');
  });

  it('quandoCurto: só a hora se foi hoje', () => {
    expect(quandoCurto(Date.parse('2026-11-09T11:02:00Z'), SEG)).toBe('08:02');
    expect(quandoCurto(Date.parse('2026-11-06T20:40:00Z'), SEG)).toBe('6/11 17:40');
  });

  it('a saudação pela hora de Brasília', () => {
    expect(saudacaoDaHora(Date.parse('2026-11-09T14:59:00Z'))).toBe('Bom dia');
    expect(saudacaoDaHora(Date.parse('2026-11-09T15:00:00Z'))).toBe('Boa tarde');
    expect(saudacaoDaHora(Date.parse('2026-11-09T21:00:00Z'))).toBe('Boa noite');
    expect(saudacaoDaHora(Date.parse('2026-11-09T02:00:00Z'))).toBe('Boa noite');
  });
});
```

- [ ] **Step 3: Escrever o teste da carteira**

Crie `src/lib/ludmillaCarteira.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FILTROS_DA_CARTEIRA, alemDoNormal, contarCarteira, diasInteiros, donosPorProjetoDe, emEtapa, filtrarCarteira,
  fraseDasNaoAcompanhadas, juntarComE, linhaDaRpc, naoAcompanhadas, normalDaRpc, normaisDaConcessionaria, ordenarCarteira,
  projetistasDaCarteira, proximoPasso, tempoDaLinha, textoDoNormal, textoDosDias, type LinhaDaCarteira, type NormalDaEtapa,
} from './ludmillaCarteira';

const ROTULOS: Record<string, string> = {
  pending: 'Projetos Recebidos', analysis: 'Em Análise', documentation: 'Documentação', approved: 'Aprovado',
  pendencia: 'Pendência', aguardando_instalacao: 'Aguardando Instalação', vistoria_solicitada: 'Vistoria Solicitada',
};
const rotulo = (s: string) => ROTULOS[s] ?? s;
const ANA = { id: 'pessoa-ana', nome: 'Ana Lima' };
const BRUNO = { id: 'pessoa-bruno', nome: 'Bruno Costa' };

const linha = (x: Partial<LinhaDaCarteira> = {}): LinhaDaCarteira => ({
  projectId: 'p-1', codigo: 'PRJ-1', titular: 'Marta', empresa: 'Solar Alfa', companyId: 'emp-1',
  concessionaria: 'CPFL Paulista', concessionaireId: 'conc-cpfl', status: 'analysis', naEtapaDesde: '2026-11-01T12:00:00Z',
  diasNaEtapa: 3, normalDias: 5, normalFonte: 'medido', atrasoDias: -2, comQuem: 'nos', donos: [], historico: [], naFila: false,
  ...x,
});

describe('linhaDaRpc', () => {
  it('lê a linha da RPC e aceita número como texto', () => {
    const l = linhaDaRpc({
      project_id: 'p-1', code: 'PRJ-10001', titular: 'Marta Ribeiro Campos', empresa: 'Solar Alfa', company_id: 'emp-alfa',
      concessionaria: 'CPFL Paulista', concessionaire_id: 'conc-cpfl', status: 'analysis', na_etapa_desde: '2026-10-10T12:00:00Z',
      dias_na_etapa: '12.5', normal_dias: 8, normal_fonte: 'medido', atraso_dias: 4.5, com_quem: 'concessionaria',
      donos: [{ id: 'pessoa-ana', nome: 'Ana Lima' }, { id: null, nome: 'sem id' }],
      historico: [{ etapa: 'pending', dias: 3, atual: false }, { etapa: 'analysis', dias: '12.5', atual: true }, { dias: 2 }],
      na_fila: true,
    });
    expect(l).toEqual({
      projectId: 'p-1', codigo: 'PRJ-10001', titular: 'Marta Ribeiro Campos', empresa: 'Solar Alfa', companyId: 'emp-alfa',
      concessionaria: 'CPFL Paulista', concessionaireId: 'conc-cpfl', status: 'analysis', naEtapaDesde: '2026-10-10T12:00:00Z',
      diasNaEtapa: 12.5, normalDias: 8, normalFonte: 'medido', atrasoDias: 4.5, comQuem: 'concessionaria',
      donos: [{ id: 'pessoa-ana', nome: 'Ana Lima' }],
      historico: [{ etapa: 'pending', dias: 3, atual: false }, { etapa: 'analysis', dias: 12.5, atual: true }],
      naFila: true,
    });
  });

  it('valores fora do esperado viram o padrão seguro', () => {
    const l = linhaDaRpc({
      project_id: 'p-2', code: null, status: 'approved', dias_na_etapa: null, normal_dias: null, normal_fonte: 'outra',
      atraso_dias: null, com_quem: 'ninguem', donos: null, historico: 'x', na_fila: null,
    });
    expect(l.codigo).toBe('—');
    expect(l.diasNaEtapa).toBe(0);
    expect(l.normalDias).toBeNull();
    expect(l.normalFonte).toBeNull();
    expect(l.comQuem).toBe('nos');
    expect(l.donos).toEqual([]);
    expect(l.historico).toEqual([]);
    expect(l.naFila).toBe(false);
  });
});

describe('normalDaRpc e normaisDaConcessionaria', () => {
  const normais: NormalDaEtapa[] = [
    normalDaRpc({ concessionaire_id: 'conc-cpfl', etapa: 'analysis', normal_dias: 8, amostra: 9, fonte: 'medido' }),
    normalDaRpc({ concessionaire_id: 'conc-enel', etapa: 'analysis', normal_dias: 2, amostra: 12, fonte: 'medido' }),
    normalDaRpc({ concessionaire_id: null, etapa: 'analysis', normal_dias: 5, amostra: 0, fonte: 'coluna' }),
  ];

  it('lê a linha', () => {
    expect(normais[0]).toEqual({ concessionaireId: 'conc-cpfl', etapa: 'analysis', normalDias: 8, amostra: 9, fonte: 'medido' });
  });

  it('separa por concessionária; projeto sem concessionária casa com a linha sem concessionária', () => {
    expect(normaisDaConcessionaria(normais, 'conc-enel').get('analysis')?.normalDias).toBe(2);
    expect(normaisDaConcessionaria(normais, null).get('analysis')?.normalDias).toBe(5);
    expect(normaisDaConcessionaria(normais, 'conc-edp').size).toBe(0);
  });
});

describe('além do normal', () => {
  it('usa os dias inteiros que a tela mostra', () => {
    expect(diasInteiros(7.9)).toBe(7);
    expect(diasInteiros(-1)).toBe(0);
    expect(alemDoNormal(7.9, 7)).toBe(false);
    expect(alemDoNormal(8, 7)).toBe(true);
    expect(alemDoNormal(400, null)).toBe(false);
  });
});

describe('filtros, contagem e ordem da carteira', () => {
  const L1 = linha({ projectId: 'p-1', codigo: 'PRJ-1', comQuem: 'concessionaria', diasNaEtapa: 12.5, normalDias: 8, atrasoDias: 4.5 });
  const L2 = linha({ projectId: 'p-2', codigo: 'PRJ-2', comQuem: 'nos', diasNaEtapa: 3, normalDias: 5, atrasoDias: -2 });
  const L3 = linha({ projectId: 'p-3', codigo: 'PRJ-3', comQuem: 'cliente', diasNaEtapa: 30, normalDias: null, atrasoDias: null });
  const L4 = linha({ projectId: 'p-4', codigo: 'PRJ-4', comQuem: 'nos', diasNaEtapa: 7.9, normalDias: 7, atrasoDias: 0.9 });
  const L5 = linha({ projectId: 'p-5', codigo: 'PRJ-5', comQuem: 'nos', diasNaEtapa: 8, normalDias: 7, atrasoDias: 1 });
  const todas = [L1, L2, L3, L4, L5];

  it('conta cada filtro, com os rótulos da tela', () => {
    expect(contarCarteira(todas)).toEqual({ parados: 2, nos: 3, concessionaria: 1, cliente: 1, todos: 5 });
    expect(FILTROS_DA_CARTEIRA.map(f => f.rotulo)).toEqual([
      'Parados além do normal', 'Com a gente', 'Com a concessionária', 'Com a empresa', 'Todos os projetos',
    ]);
  });

  it('parados = além do normal pela regra da tela', () => {
    expect(filtrarCarteira(todas, 'parados').map(l => l.projectId)).toEqual(['p-1', 'p-5']);
  });

  it('a ordem da spec: além do normal primeiro (maior atraso), depois os outros pelo tempo, empate pelo código', () => {
    const a = linha({ projectId: 'a', codigo: 'PRJ-A', normalDias: 7, atrasoDias: 5, diasNaEtapa: 12 });
    const b = linha({ projectId: 'b', codigo: 'PRJ-B', normalDias: 5, atrasoDias: -2, diasNaEtapa: 3 });
    const c = linha({ projectId: 'c', codigo: 'PRJ-C', normalDias: null, atrasoDias: null, diasNaEtapa: 40 });
    const d = linha({ projectId: 'd', codigo: 'PRJ-D', normalDias: 15, atrasoDias: 5, diasNaEtapa: 20 });
    const e = linha({ projectId: 'e', codigo: 'PRJ-E', normalDias: null, atrasoDias: null, diasNaEtapa: 10 });
    const f = linha({ projectId: 'f', codigo: 'PRJ-0', normalDias: null, atrasoDias: null, diasNaEtapa: 10 });
    expect(ordenarCarteira([a, b, c, d, e, f]).map(l => l.projectId)).toEqual(['d', 'a', 'c', 'f', 'e', 'b']);
  });

  it('7,4 dias com normal 7 não conta como além do normal na ordem (mesma regra da tela)', () => {
    const quase = linha({ projectId: 'q', codigo: 'PRJ-Q', normalDias: 7, atrasoDias: 0.4, diasNaEtapa: 7.4 });
    const longo = linha({ projectId: 'l', codigo: 'PRJ-L', normalDias: null, atrasoDias: null, diasNaEtapa: 30 });
    expect(ordenarCarteira([quase, longo]).map(l => l.projectId)).toEqual(['l', 'q']);
  });
});

describe('o tempo em palavras', () => {
  it('dias', () => {
    expect(textoDosDias(1.9)).toBe('1 dia');
    expect(textoDosDias(0.2)).toBe('0 dias');
    expect(textoDosDias(14.3)).toBe('14 dias');
  });

  it('o normal por fonte', () => {
    expect(textoDoNormal(7, 'medido', 'ENEL SP')).toBe('o normal na ENEL SP é até 7');
    expect(textoDoNormal(7, 'medido', 'ENEL SP', true)).toBe('o normal é até 7');
    expect(textoDoNormal(7, 'geral', 'ENEL SP')).toBe('o normal estimado é até 7');
    expect(textoDoNormal(10, 'coluna', 'ENEL SP')).toBe('o prazo do Kanban é 10');
    expect(textoDoNormal(null, null, 'ENEL SP')).toBe('ainda sem normal medido');
  });

  it('a etapa sem "em Em"', () => {
    expect(emEtapa('Em Análise')).toBe('em Análise');
    expect(emEtapa('Aprovado')).toBe('em Aprovado');
  });

  it('tempoDaLinha junta tudo e decide o alerta', () => {
    expect(tempoDaLinha(linha({ status: 'analysis', diasNaEtapa: 12.5, normalDias: 8, concessionaria: 'ENEL SP' }), rotulo)).toEqual({
      dias: '12 dias', em: 'em Análise', normalCurto: 'o normal é até 8', normalLongo: 'o normal na ENEL SP é até 8', alerta: true,
    });
  });
});

describe('donos', () => {
  const linhas = [linha({ projectId: 'p-1', donos: [BRUNO, ANA] }), linha({ projectId: 'p-2', donos: [ANA] }), linha({ projectId: 'p-3', donos: [] })];

  it('por projeto', () => {
    const m = donosPorProjetoDe(linhas);
    expect(m.get('p-2')).toEqual([ANA]);
    expect(m.get('p-3')).toEqual([]);
    expect(m.get('p-9')).toBeUndefined();
  });

  it('os projetistas, um de cada, pelo nome', () => {
    expect(projetistasDaCarteira(linhas)).toEqual([ANA, BRUNO]);
  });
});

describe('proximoPasso', () => {
  it('item na fila manda para a fila', () => {
    expect(proximoPasso(linha({ naFila: true }), rotulo)).toBe('Tem item esperando decisão na fila. Abra o item para decidir.');
  });

  it('com a concessionária', () => {
    expect(proximoPasso(linha({ comQuem: 'concessionaria', diasNaEtapa: 12.5, normalDias: 8 }), rotulo))
      .toBe('Esperar a CPFL Paulista. Passou 4 dias do normal em Análise.');
    expect(proximoPasso(linha({ comQuem: 'concessionaria', diasNaEtapa: 3, normalDias: 8 }), rotulo))
      .toBe('Nada a fazer agora: está com a CPFL Paulista, dentro do normal.');
  });

  it('com a empresa', () => {
    expect(proximoPasso(linha({ comQuem: 'cliente', status: 'pendencia', diasNaEtapa: 19.2 }), rotulo))
      .toBe('Cobrar a empresa: a CPFL Paulista pediu um ajuste há 19 dias.');
    expect(proximoPasso(linha({ comQuem: 'cliente', status: 'approved' }), rotulo))
      .toBe('A empresa está instalando. Quando ela pedir a vistoria pelo painel, a bola volta para a gente.');
  });

  it('com a gente', () => {
    expect(proximoPasso(linha({ comQuem: 'nos', status: 'approved' }), rotulo))
      .toBe('A empresa já pediu a vistoria pelo painel: falta pedir a vistoria na CPFL Paulista.');
    expect(proximoPasso(linha({ comQuem: 'nos', status: 'documentation', diasNaEtapa: 3, normalDias: 5 }), rotulo))
      .toBe('É com a gente: 3 dias em Documentação.');
    expect(proximoPasso(linha({ comQuem: 'nos', status: 'documentation', diasNaEtapa: 9, normalDias: 5 }), rotulo))
      .toBe('É com a gente, e já são 9 dias em Documentação, além do normal.');
  });
});

describe('concessionárias não acompanhadas', () => {
  it('as da carteira sem conta, pelo nome', () => {
    const linhas = [
      linha({ concessionaireId: 'conc-cpfl', concessionaria: 'CPFL Paulista' }),
      linha({ concessionaireId: 'conc-energisa', concessionaria: 'Energisa' }),
      linha({ concessionaireId: 'conc-cemig', concessionaria: 'CEMIG' }),
      linha({ concessionaireId: 'conc-cemig', concessionaria: 'CEMIG' }),
      linha({ concessionaireId: null, concessionaria: null }),
    ];
    const nomes = naoAcompanhadas(linhas, ['conc-cpfl', null]);
    expect(nomes).toEqual(['CEMIG', 'Energisa']);
    expect(fraseDasNaoAcompanhadas(nomes)).toBe('Ainda não acompanho CEMIG e Energisa.');
    expect(fraseDasNaoAcompanhadas([])).toBeNull();
  });

  it('juntarComE', () => {
    expect(juntarComE([])).toBe('');
    expect(juntarComE(['a'])).toBe('a');
    expect(juntarComE(['a', 'b', 'c'])).toBe('a, b e c');
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run src/lib/ludmillaTempo.test.ts src/lib/ludmillaCarteira.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaTempo"` e `"./ludmillaCarteira"`.

- [ ] **Step 5: Escrever `src/lib/ludmillaTempo.ts`**

```ts
/**
 * O RELÓGIO DA LUDMILLA — funções puras, sem React.
 *
 * Brasília não tem horário de verão desde 2019: é UTC−3 o ano todo. O dia, a hora e o dia da semana
 * da página (o "chegou hoje" da fila, o "desde sexta" do recado, os dias do Diário, a próxima
 * leitura) saem daqui, sem depender do fuso do computador de quem abre a página nem do `Intl`.
 */

export const DIA_MS = 86_400_000;
export const HORA_MS = 3_600_000;
export const DESLOCAMENTO_DE_BRASILIA_MS = -3 * HORA_MS;

const p2 = (n: number) => String(n).padStart(2, '0');

/** A hora de parede de Brasília num Date "em UTC": leia com getUTC*. */
export function emBrasilia(ms: number): Date {
  return new Date(ms + DESLOCAMENTO_DE_BRASILIA_MS);
}

/** O número do dia em Brasília: dois instantes do mesmo dia de Brasília dão o mesmo número. */
export function diaEmBrasilia(ms: number): number {
  return Math.floor((ms + DESLOCAMENTO_DE_BRASILIA_MS) / DIA_MS);
}

/** Dias de calendário (Brasília) entre `iso` e `agora`: 0 = hoje, 1 = ontem. Data ilegível = 0. */
export function diasEntre(iso: string | null | undefined, agora: number): number {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? diaEmBrasilia(agora) - diaEmBrasilia(t) : 0;
}

/** 00:00 de Brasília do dia de `ms`, como instante. */
export function inicioDoDia(ms: number): number {
  return diaEmBrasilia(ms) * DIA_MS - DESLOCAMENTO_DE_BRASILIA_MS;
}

export function horaEMinuto(ms: number): string {
  const d = emBrasilia(ms);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** "9/11", como a fatura escreve. */
export function diaEMes(ms: number): string {
  const d = emBrasilia(ms);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** "08:02" se foi hoje; "6/11 17:40" se foi antes. */
export function quandoCurto(ms: number, agora: number): string {
  return diaEmBrasilia(ms) === diaEmBrasilia(agora) ? horaEMinuto(ms) : `${diaEMes(ms)} ${horaEMinuto(ms)}`;
}

export const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

export function diaDaSemana(ms: number): (typeof DIAS_DA_SEMANA)[number] {
  return DIAS_DA_SEMANA[emBrasilia(ms).getUTCDay()];
}

export function maiuscula(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function saudacaoDaHora(ms: number): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const h = emBrasilia(ms).getUTCHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
```

- [ ] **Step 6: Escrever `src/lib/ludmillaCarteira.ts`**

```ts
/**
 * A CARTEIRA DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md §4.3 (a lista), §4.4 (a
 * ficha), §6.3 (tempo e normal) e §6.4 (com quem está). Os dados vêm de `ludmilla_carteira()` e
 * `ludmilla_normais()` (entrega 1): aqui eles viram o formato da tela, e moram as regras de
 * filtro, contagem, ordem, "além do normal", os textos do tempo e o próximo passo.
 */

export type ComQuem = 'nos' | 'concessionaria' | 'cliente';
export type FonteDoNormal = 'medido' | 'geral' | 'coluna';

export interface DonoDoProjeto { id: string; nome: string }
export interface PassagemDoHistorico { etapa: string; dias: number; atual: boolean }

export interface LinhaDaCarteira {
  projectId: string;
  codigo: string;
  titular: string | null;
  empresa: string | null;
  companyId: string | null;
  concessionaria: string | null;
  concessionaireId: string | null;
  status: string;
  naEtapaDesde: string | null;
  diasNaEtapa: number;
  normalDias: number | null;
  normalFonte: FonteDoNormal | null;
  atrasoDias: number | null;
  comQuem: ComQuem;
  donos: DonoDoProjeto[];
  historico: PassagemDoHistorico[];
  naFila: boolean;
}

export interface NormalDaEtapa {
  concessionaireId: string | null;
  etapa: string;
  normalDias: number | null;
  amostra: number;
  fonte: FonteDoNormal | null;
}

type Bruto = Record<string, unknown>;

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
const COM_QUEM: readonly ComQuem[] = ['nos', 'concessionaria', 'cliente'];
const FONTES: readonly FonteDoNormal[] = ['medido', 'geral', 'coluna'];
const fonteDoNormal = (v: unknown): FonteDoNormal | null => (FONTES.includes(v as FonteDoNormal) ? (v as FonteDoNormal) : null);

/** Uma linha de `ludmilla_carteira()`. O PostgREST manda `numeric` como número; texto também é aceito. */
export function linhaDaRpc(r: Bruto): LinhaDaCarteira {
  const donos = Array.isArray(r.donos) ? r.donos : [];
  const historico = Array.isArray(r.historico) ? r.historico : [];
  return {
    projectId: String(r.project_id ?? ''),
    codigo: texto(r.code) ?? '—',
    titular: texto(r.titular),
    empresa: texto(r.empresa),
    companyId: texto(r.company_id),
    concessionaria: texto(r.concessionaria),
    concessionaireId: texto(r.concessionaire_id),
    status: texto(r.status) ?? '',
    naEtapaDesde: texto(r.na_etapa_desde),
    diasNaEtapa: numero(r.dias_na_etapa) ?? 0,
    normalDias: numero(r.normal_dias),
    normalFonte: fonteDoNormal(r.normal_fonte),
    atrasoDias: numero(r.atraso_dias),
    comQuem: COM_QUEM.includes(r.com_quem as ComQuem) ? (r.com_quem as ComQuem) : 'nos',
    donos: donos.flatMap((d): DonoDoProjeto[] => {
      const o = (d ?? {}) as Bruto;
      const id = texto(o.id);
      return id ? [{ id, nome: texto(o.nome) ?? 'Sem nome' }] : [];
    }),
    historico: historico.flatMap((h): PassagemDoHistorico[] => {
      const o = (h ?? {}) as Bruto;
      const etapa = texto(o.etapa);
      return etapa ? [{ etapa, dias: numero(o.dias) ?? 0, atual: o.atual === true }] : [];
    }),
    naFila: r.na_fila === true,
  };
}

/** Uma linha de `ludmilla_normais()`. */
export function normalDaRpc(r: Bruto): NormalDaEtapa {
  return {
    concessionaireId: texto(r.concessionaire_id),
    etapa: texto(r.etapa) ?? '',
    normalDias: numero(r.normal_dias),
    amostra: numero(r.amostra) ?? 0,
    fonte: fonteDoNormal(r.fonte),
  };
}

/**
 * Os normais de UMA concessionária, por etapa. Projeto sem concessionária casa com a linha sem
 * concessionária (o `IS NOT DISTINCT FROM` de `ludmilla_carteira`).
 */
export function normaisDaConcessionaria(normais: NormalDaEtapa[], concessionaireId: string | null): Map<string, NormalDaEtapa> {
  return new Map(normais.filter(n => n.concessionaireId === concessionaireId).map(n => [n.etapa, n]));
}

/**
 * Os dias que a tela mostra ("14 dias") e o número com que ela decide o alerta: o MESMO. Com o
 * decimal do banco, 7,4 dias contra um normal de 7 sairia "7 dias, o normal é até 7" em alerta.
 */
export function diasInteiros(dias: number): number {
  return Math.max(0, Math.floor(dias));
}

/** Parado além do normal (spec §6.3): dias na etapa maior que o normal. Sem normal, nunca. */
export function alemDoNormal(dias: number, normal: number | null): boolean {
  return normal !== null && diasInteiros(dias) > normal;
}

/** No banco `cliente`; na tela, "Com a empresa" (a empresa cliente — decisão de 09/11/2026). */
export const ROTULO_COM_QUEM: Record<ComQuem, string> = {
  nos: 'Com a gente', concessionaria: 'Com a concessionária', cliente: 'Com a empresa',
};

export type FiltroDaCarteira = 'parados' | ComQuem | 'todos';

export const FILTROS_DA_CARTEIRA: { valor: FiltroDaCarteira; rotulo: string }[] = [
  { valor: 'parados', rotulo: 'Parados além do normal' },
  { valor: 'nos', rotulo: ROTULO_COM_QUEM.nos },
  { valor: 'concessionaria', rotulo: ROTULO_COM_QUEM.concessionaria },
  { valor: 'cliente', rotulo: ROTULO_COM_QUEM.cliente },
  { valor: 'todos', rotulo: 'Todos os projetos' },
];

export function casaFiltroDaCarteira(l: LinhaDaCarteira, f: FiltroDaCarteira): boolean {
  if (f === 'todos') return true;
  if (f === 'parados') return alemDoNormal(l.diasNaEtapa, l.normalDias);
  return l.comQuem === f;
}

/**
 * A ordem da spec §4.3: "mais passado do normal primeiro; depois os sem atraso, pelo tempo".
 * "Além do normal" é a regra da tela (`alemDoNormal`, dias inteiros); entre eles, maior atraso
 * primeiro; todos os outros (sem atraso ou sem normal) pelo tempo na etapa; empate pelo código.
 * A RPC ordena diferente entre os sem atraso; esta função é quem vale (decisão 11 do plano).
 */
export function ordenarCarteira(linhas: LinhaDaCarteira[]): LinhaDaCarteira[] {
  const atrasada = (l: LinhaDaCarteira) => alemDoNormal(l.diasNaEtapa, l.normalDias);
  return [...linhas].sort((a, b) => {
    const xa = atrasada(a);
    const xb = atrasada(b);
    if (xa !== xb) return xa ? -1 : 1;
    if (xa && xb && (a.atrasoDias ?? 0) !== (b.atrasoDias ?? 0)) return (b.atrasoDias ?? 0) - (a.atrasoDias ?? 0);
    return (b.diasNaEtapa - a.diasNaEtapa) || a.codigo.localeCompare(b.codigo, 'pt-BR');
  });
}

export function filtrarCarteira(linhas: LinhaDaCarteira[], f: FiltroDaCarteira): LinhaDaCarteira[] {
  return ordenarCarteira(linhas.filter(l => casaFiltroDaCarteira(l, f)));
}

export function contarCarteira(linhas: LinhaDaCarteira[]): Record<FiltroDaCarteira, number> {
  const n: Record<FiltroDaCarteira, number> = { parados: 0, nos: 0, concessionaria: 0, cliente: 0, todos: 0 };
  for (const l of linhas) for (const f of FILTROS_DA_CARTEIRA) if (casaFiltroDaCarteira(l, f.valor)) n[f.valor]++;
  return n;
}

export function textoDosDias(dias: number): string {
  const n = diasInteiros(dias);
  return n === 1 ? '1 dia' : `${n} dias`;
}

/**
 * "O normal" em palavras. `medido` = mediana da concessionária; `geral` = mediana de todas
 * ("estimado", spec §11); `coluna` = o prazo da coluna do Kanban. `curto` tira o nome da
 * concessionária (o cartão já diz qual é).
 */
export function textoDoNormal(normal: number | null, fonte: FonteDoNormal | null, concessionaria: string | null, curto = false): string {
  if (normal === null) return 'ainda sem normal medido';
  if (fonte === 'geral') return `o normal estimado é até ${normal}`;
  if (fonte === 'coluna') return `o prazo do Kanban é ${normal}`;
  return curto || !concessionaria ? `o normal é até ${normal}` : `o normal na ${concessionaria} é até ${normal}`;
}

/** "em Aprovado"; rótulo que já começa com "Em" vira "em Análise", nunca "em Em Análise". */
export function emEtapa(rotulo: string): string {
  return /^em\s+/i.test(rotulo) ? `em ${rotulo.replace(/^em\s+/i, '')}` : `em ${rotulo}`;
}

export interface TempoDaLinha {
  /** "14 dias" */
  dias: string;
  /** "em Aprovado" */
  em: string;
  /** "o normal é até 7" (cartão, linha da carteira) */
  normalCurto: string;
  /** "o normal na ENEL SP é até 7" (detalhe, ficha) */
  normalLongo: string;
  alerta: boolean;
}

export function tempoDaLinha(l: LinhaDaCarteira, rotuloEtapa: (s: string) => string): TempoDaLinha {
  return {
    dias: textoDosDias(l.diasNaEtapa),
    em: emEtapa(rotuloEtapa(l.status)),
    normalCurto: textoDoNormal(l.normalDias, l.normalFonte, l.concessionaria, true),
    normalLongo: textoDoNormal(l.normalDias, l.normalFonte, l.concessionaria),
    alerta: alemDoNormal(l.diasNaEtapa, l.normalDias),
  };
}

/** De quem é cada projeto (spec §6.2): os projetistas ligados à empresa (`staff_companies`). */
export function donosPorProjetoDe(linhas: LinhaDaCarteira[]): Map<string, DonoDoProjeto[]> {
  return new Map(linhas.map(l => [l.projectId, l.donos]));
}

/** Os projetistas da carteira, um de cada, pelo nome — os botões de "Fila de". */
export function projetistasDaCarteira(linhas: LinhaDaCarteira[]): DonoDoProjeto[] {
  const porId = new Map<string, DonoDoProjeto>();
  for (const l of linhas) for (const d of l.donos) if (!porId.has(d.id)) porId.set(d.id, d);
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "a, b e c". */
export function juntarComE(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/**
 * O próximo passo da ficha (spec §4.4), pela bola (§6.4) e pelo tempo. Só descreve: a ficha não
 * cria tarefa nem manda nada (isso é das entregas 3 e 4).
 */
export function proximoPasso(l: LinhaDaCarteira, rotuloEtapa: (s: string) => string): string {
  const conc = l.concessionaria ?? 'concessionária';
  const naEtapa = emEtapa(rotuloEtapa(l.status));
  const dias = textoDosDias(l.diasNaEtapa);
  const alem = alemDoNormal(l.diasNaEtapa, l.normalDias);
  if (l.naFila) return 'Tem item esperando decisão na fila. Abra o item para decidir.';
  if (l.comQuem === 'concessionaria') {
    return alem && l.normalDias !== null
      ? `Esperar a ${conc}. Passou ${textoDosDias(diasInteiros(l.diasNaEtapa) - l.normalDias)} do normal ${naEtapa}.`
      : `Nada a fazer agora: está com a ${conc}, dentro do normal.`;
  }
  if (l.comQuem === 'cliente') {
    if (l.status === 'pendencia') return `Cobrar a empresa: a ${conc} pediu um ajuste há ${dias}.`;
    if (l.status === 'approved' || l.status === 'aguardando_instalacao') {
      return 'A empresa está instalando. Quando ela pedir a vistoria pelo painel, a bola volta para a gente.';
    }
    return `Está com a empresa há ${dias}.`;
  }
  if (l.status === 'approved') return `A empresa já pediu a vistoria pelo painel: falta pedir a vistoria na ${conc}.`;
  return alem ? `É com a gente, e já são ${dias} ${naEtapa}, além do normal.` : `É com a gente: ${dias} ${naEtapa}.`;
}

/** As concessionárias da carteira sem conta da Ludmilla (spec §4.4: "Ainda não acompanho …"). */
export function naoAcompanhadas(linhas: LinhaDaCarteira[], acompanhadas: (string | null)[]): string[] {
  const ids = new Set(acompanhadas.filter((x): x is string => !!x));
  const nomes = new Set<string>();
  for (const l of linhas) {
    if (l.concessionaireId && l.concessionaria && !ids.has(l.concessionaireId)) nomes.add(l.concessionaria);
  }
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function fraseDasNaoAcompanhadas(nomes: string[]): string | null {
  return nomes.length === 0 ? null : `Ainda não acompanho ${juntarComE(nomes)}.`;
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run src/lib/ludmillaTempo.test.ts src/lib/ludmillaCarteira.test.ts`
Expected: PASS, nenhum `failed`.

- [ ] **Step 8: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → termina sem erro.

- [ ] **Step 9: Commit**

Escreva com a ferramenta Write `$RASCUNHO/msg-e2-t1.txt`:

```
feat(ludmilla): relógio de Brasília e carteira na tela (entrega 2, página)

Funções puras para a página nova: dia/hora/saudação em Brasília (UTC-3
fixo) e a carteira lida de ludmilla_carteira()/ludmilla_normais() da
entrega 1 — filtros, contagem, ordem da spec (além do normal primeiro,
depois pelo tempo na etapa), "além do normal" pelos dias
inteiros, textos do normal, donos, próximo passo e as concessionárias
ainda não acompanhadas.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaTempo.ts src/lib/ludmillaTempo.test.ts src/lib/ludmillaCarteira.ts src/lib/ludmillaCarteira.test.ts
git commit -F "$RASCUNHO/msg-e2-t1.txt" -- src/lib/ludmillaTempo.ts src/lib/ludmillaTempo.test.ts src/lib/ludmillaCarteira.ts src/lib/ludmillaCarteira.test.ts
git show --stat HEAD
```

---

### Task 2: O histórico em barras (lógica pura)

**Files:**
- Create: `src/lib/ludmillaBarras.ts`
- Test: `src/lib/ludmillaBarras.test.ts`

**Interfaces:**
- Consumes: `alemDoNormal`, `diasInteiros`, `NormalDaEtapa`, `PassagemDoHistorico` (Task 1); `VALID_PROJECT_STATUSES` (`src/lib/statusMapping.ts`).
- Produces: `DESVIOS: readonly string[]`, `ORDEM_PADRAO: readonly string[]`, `FOLGA_DO_GRAFICO = 1.15`, `TomDaBarra = 'passada' | 'atual' | 'alem' | 'futura'`, `Barra {etapa; rotulo; dias: number | null; normal: number | null; tom; alturaPct: number; normalPct: number | null; cortePct: number | null}`, `EntradaDasBarras {historico; status; diasNaEtapa; ordem: readonly string[]; normais: Map<string, NormalDaEtapa>; rotuloEtapa: (s: string) => string}`, `barrasDoHistorico(e: EntradaDasBarras): Barra[]`, `descricaoDasBarras(barras: Barra[]): string`.

- [ ] **Step 1: Escrever o teste**

Crie `src/lib/ludmillaBarras.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { barrasDoHistorico, descricaoDasBarras, ORDEM_PADRAO, type EntradaDasBarras } from './ludmillaBarras';
import type { NormalDaEtapa } from './ludmillaCarteira';

const ROTULOS: Record<string, string> = {
  pending: 'Projetos Recebidos', analysis: 'Em Análise', documentation: 'Documentação', approval: 'Aguardando Aprovação',
  approved: 'Aprovado', pendencia: 'Pendência', vistoria_solicitada: 'Vistoria Solicitada',
  aguardando_instalacao: 'Aguardando Instalação', etapa_nova: 'Etapa Nova',
};
const rotuloEtapa = (s: string) => ROTULOS[s] ?? s;
const normal = (etapa: string, normalDias: number): [string, NormalDaEtapa] =>
  [etapa, { concessionaireId: 'conc-cpfl', etapa, normalDias, amostra: 9, fonte: 'medido' }];
const NORMAIS = new Map([normal('pending', 2), normal('analysis', 8), normal('documentation', 5)]);

const entrada = (x: Partial<EntradaDasBarras>): EntradaDasBarras => ({
  historico: [], status: 'analysis', diasNaEtapa: 0, ordem: [], normais: NORMAIS, rotuloEtapa, ...x,
});

describe('barrasDoHistorico', () => {
  const comum = entrada({
    historico: [
      { etapa: 'pending', dias: 3, atual: false },
      { etapa: 'analysis', dias: 10, atual: false },
      { etapa: 'documentation', dias: 4, atual: true },
    ],
    status: 'documentation', diasNaEtapa: 4.2,
  });

  it('passadas, a atual e as que ainda vêm do caminho principal, sem desvios nem Concluído', () => {
    const b = barrasDoHistorico(comum);
    expect(b.map(x => x.etapa)).toEqual([
      'pending', 'analysis', 'documentation', 'approval', 'approved', 'vistoria_solicitada', 'aguardando_instalacao',
    ]);
    expect(b.map(x => x.tom)).toEqual(['passada', 'passada', 'atual', 'futura', 'futura', 'futura', 'futura']);
    expect(ORDEM_PADRAO).not.toContain('completed');
  });

  it('alturas e traço na escala do maior valor com folga de 15%', () => {
    const [pending, analysis, documentation, approval] = barrasDoHistorico(comum);
    expect(analysis).toMatchObject({ dias: 10, normal: 8, alturaPct: 87, normalPct: 69.6, cortePct: null, rotulo: 'Em Análise' });
    expect(pending).toMatchObject({ dias: 3, normal: 2, alturaPct: 26.1, normalPct: 17.4 });
    expect(documentation).toMatchObject({ dias: 4, normal: 5, alturaPct: 36.5, normalPct: 43.5, tom: 'atual' });
    expect(approval).toMatchObject({ dias: null, normal: null, alturaPct: 0, normalPct: null, cortePct: null });
  });

  it('a atual além do normal fica em alerta, com o corte no traço', () => {
    const doc = barrasDoHistorico({ ...comum, diasNaEtapa: 9.6 }).find(x => x.etapa === 'documentation')!;
    expect(doc).toMatchObject({ tom: 'alem', dias: 9, alturaPct: 83.5, cortePct: 52.1 });
  });

  it('estadas repetidas somam; desvio aparece só se visitado; a atual conta só a estada de agora', () => {
    const b = barrasDoHistorico(entrada({
      historico: [
        { etapa: 'analysis', dias: 3, atual: false },
        { etapa: 'pendencia', dias: 6, atual: false },
        { etapa: 'analysis', dias: 4, atual: false },
        { etapa: 'documentation', dias: 1, atual: false },
        { etapa: 'documentation', dias: 2, atual: true },
      ],
      status: 'documentation', diasNaEtapa: 2,
    }));
    expect(b.map(x => x.etapa)).toEqual([
      'analysis', 'documentation', 'approval', 'approved', 'pendencia', 'vistoria_solicitada', 'aguardando_instalacao',
    ]);
    expect(b.find(x => x.etapa === 'analysis')!.dias).toBe(7);
    expect(b.find(x => x.etapa === 'documentation')!.dias).toBe(2);
    expect(b.find(x => x.etapa === 'pendencia')!.tom).toBe('passada');
  });

  it('a atual num desvio: o caminho continua depois da última etapa do caminho principal', () => {
    const b = barrasDoHistorico(entrada({
      historico: [{ etapa: 'analysis', dias: 5, atual: false }, { etapa: 'pendencia', dias: 2, atual: true }],
      status: 'pendencia', diasNaEtapa: 2.3,
    }));
    expect(b.map(x => x.etapa)).toEqual([
      'analysis', 'documentation', 'approval', 'approved', 'pendencia', 'vistoria_solicitada', 'aguardando_instalacao',
    ]);
    expect(b.find(x => x.etapa === 'pendencia')).toMatchObject({ tom: 'atual', normal: null, normalPct: null });
  });

  it('segue a ordem do Kanban do tenant; etapa fora dela vai para o fim', () => {
    const b = barrasDoHistorico(entrada({
      historico: [{ etapa: 'analysis', dias: 2, atual: false }, { etapa: 'etapa_nova', dias: 3, atual: true }],
      status: 'etapa_nova', diasNaEtapa: 3, ordem: ['pending', 'analysis', 'documentation', 'completed'],
    }));
    expect(b.map(x => x.etapa)).toEqual(['analysis', 'documentation', 'etapa_nova']);
    expect(b[2]).toMatchObject({ tom: 'atual', rotulo: 'Etapa Nova' });
  });

  it('sem normal não há traço nem alerta', () => {
    const [b] = barrasDoHistorico(entrada({ status: 'analysis', diasNaEtapa: 50, normais: new Map(), ordem: ['analysis'] }));
    expect(b).toMatchObject({ tom: 'atual', dias: 50, normal: null, normalPct: null, cortePct: null });
  });

  it('a descrição para o leitor de tela', () => {
    const texto = descricaoDasBarras(barrasDoHistorico({ ...comum, diasNaEtapa: 9.6 }));
    expect(texto.startsWith('Projetos Recebidos: 3 dias, normal até 2. Em Análise: 10 dias, normal até 8. ')).toBe(true);
    expect(texto).toContain('Documentação: 9 dias, etapa atual, normal até 5, além do normal.');
    expect(texto).toContain('Aguardando Aprovação: ainda não.');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/ludmillaBarras.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaBarras"`.

- [ ] **Step 3: Escrever `src/lib/ludmillaBarras.ts`**

```ts
import { alemDoNormal, diasInteiros, type NormalDaEtapa, type PassagemDoHistorico } from '@/lib/ludmillaCarteira';
import { VALID_PROJECT_STATUSES } from '@/lib/statusMapping';

/**
 * O HISTÓRICO EM BARRAS — função pura, sem React (spec §3, "o traço marcante", e §6.3).
 *
 * Como o consumo dos últimos meses na conta de luz: uma barra por etapa com os dias que o projeto
 * passou nela, um traço no normal daquela concessionária, a etapa atual em sol e, além do normal,
 * em alerta. As barras seguem as colunas do Kanban pelas quais o projeto passou ou ainda vai
 * passar (decisão 8 do plano).
 */

/** Etapas fora do caminho principal: só viram barra quando o projeto passou por elas. */
export const DESVIOS: readonly string[] = ['pendencia', 'vistoria_sem_protocolo', 'vistoria_reprovada'];
/** A ordem quando o Kanban do tenant ainda não carregou. `completed` nunca vira barra. */
export const ORDEM_PADRAO: readonly string[] = VALID_PROJECT_STATUSES.filter(s => s !== 'completed');
/** Folga em cima da barra mais alta: o número dela cabe no gráfico. */
export const FOLGA_DO_GRAFICO = 1.15;

export type TomDaBarra = 'passada' | 'atual' | 'alem' | 'futura';

export interface Barra {
  etapa: string;
  rotulo: string;
  /** dias inteiros; null = ainda não passou por ela */
  dias: number | null;
  /** o normal desta etapa nesta concessionária; null = sem traço */
  normal: number | null;
  tom: TomDaBarra;
  /** altura da barra, em % da altura do gráfico */
  alturaPct: number;
  /** onde fica o traço do normal, em % da altura do gráfico */
  normalPct: number | null;
  /** na barra em alerta: até onde (% da própria barra) ela é sol; acima disso, alerta */
  cortePct: number | null;
}

export interface EntradaDasBarras {
  historico: PassagemDoHistorico[];
  status: string;
  /** a estada de agora, de `ludmilla_carteira().dias_na_etapa` (o mesmo número do texto e do alerta) */
  diasNaEtapa: number;
  /** as colunas do Kanban do tenant, em ordem; vazio = ORDEM_PADRAO */
  ordem: readonly string[];
  /** os normais da concessionária do projeto (`normaisDaConcessionaria`) */
  normais: Map<string, NormalDaEtapa>;
  rotuloEtapa: (s: string) => string;
}

const umDecimal = (x: number) => Math.round(x * 10) / 10;

export function barrasDoHistorico(e: EntradaDasBarras): Barra[] {
  const ordem = (e.ordem.length > 0 ? e.ordem : ORDEM_PADRAO).filter(s => s !== 'completed');
  const ehDesvio = (s: string) => DESVIOS.includes(s);

  // estadas fechadas somadas por etapa; a etapa ATUAL conta só a estada de agora
  const dias = new Map<string, number>();
  for (const p of e.historico) {
    if (p.etapa === 'completed' || p.etapa === e.status) continue;
    dias.set(p.etapa, (dias.get(p.etapa) ?? 0) + Math.max(0, p.dias));
  }
  if (e.status && e.status !== 'completed') dias.set(e.status, Math.max(0, e.diasNaEtapa));

  const posicao = (s: string) => ordem.indexOf(s);
  const visitadas = [...dias.keys()];
  const ultimaDoCaminho = Math.max(-1, ...visitadas.filter(s => !ehDesvio(s)).map(posicao));
  const etapas = [
    ...ordem.filter(s => dias.has(s) || (!ehDesvio(s) && posicao(s) > ultimaDoCaminho)),
    ...visitadas.filter(s => posicao(s) < 0),
  ];

  const normalDe = (s: string) => e.normais.get(s)?.normalDias ?? null;
  const maior = Math.max(1, ...etapas.flatMap(s => (dias.has(s) ? [dias.get(s)!, normalDe(s) ?? 0] : [])));
  const escala = maior * FOLGA_DO_GRAFICO;

  return etapas.map((s): Barra => {
    const d = dias.has(s) ? dias.get(s)! : null;
    const normal = d === null ? null : normalDe(s);
    const atual = s === e.status;
    const alem = atual && d !== null && alemDoNormal(d, normal);
    return {
      etapa: s,
      rotulo: e.rotuloEtapa(s),
      dias: d === null ? null : diasInteiros(d),
      normal,
      tom: d === null ? 'futura' : alem ? 'alem' : atual ? 'atual' : 'passada',
      alturaPct: d === null ? 0 : umDecimal((d / escala) * 100),
      normalPct: normal === null ? null : umDecimal((normal / escala) * 100),
      cortePct: alem && normal !== null && d !== null && d > 0 ? umDecimal((normal / d) * 100) : null,
    };
  });
}

/** O gráfico em palavras, para o leitor de tela (o desenho fica `aria-hidden`). */
export function descricaoDasBarras(barras: Barra[]): string {
  if (barras.length === 0) return 'Sem histórico de etapas.';
  return `${barras.map(b => {
    if (b.dias === null) return `${b.rotulo}: ainda não`;
    const agora = b.tom === 'atual' || b.tom === 'alem' ? ', etapa atual' : '';
    const normal = b.normal === null ? '' : `, normal até ${b.normal}`;
    const alem = b.tom === 'alem' ? ', além do normal' : '';
    return `${b.rotulo}: ${b.dias === 1 ? '1 dia' : `${b.dias} dias`}${agora}${normal}${alem}`;
  }).join('. ')}.`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/ludmillaBarras.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 6: Commit**

`$RASCUNHO/msg-e2-t2.txt` (Write):

```
feat(ludmilla): histórico em barras por etapa (entrega 2, página)

O traço marcante do mundo "Conta de luz": uma barra por etapa do Kanban
pela qual o projeto passou ou vai passar, o traço no normal da
concessionária, a atual em sol ou em alerta acima do normal, e a mesma
informação em texto para o leitor de tela.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaBarras.ts src/lib/ludmillaBarras.test.ts
git commit -F "$RASCUNHO/msg-e2-t2.txt" -- src/lib/ludmillaBarras.ts src/lib/ludmillaBarras.test.ts
git show --stat HEAD
```

---

### Task 3: A fila — grupos, dono, prazo, título, porquê e botão (lógica pura)

**Files:**
- Create: `src/lib/ludmillaFila.ts`
- Test: `src/lib/ludmillaFila.test.ts`

**Interfaces:**
- Consumes: `ItemDaCaixa`, `itensDaCaixa`, `ordenarItens`, `cartaoBloqueado`, `Afazer` (`src/lib/ludmillaCaixa.ts`); `acoesDoItem`, `AcaoDaDecisao` (`src/lib/ludmillaPainel.ts`); `dataBr`, `notaNaTela` (`src/lib/ludmillaCobranca.ts`); `DonoDoProjeto` (Task 1); `diasEntre` (Task 1). Fixtures: `src/lib/ludmillaCaixa.fixtures.ts`, `src/lib/ludmillaCobranca.fixtures.ts`.
- Produces: `GrupoDaFila = 'agora' | 'semana' | 'depois'`, `GRUPOS_DA_FILA: {valor; rotulo; dica}[]`, `DIAS_ATE_A_VISTORIA_VIRAR_AGORA = 7`, `grupoDoItem(item, agora)`, `FiltroDeDono = string`, `TODOS = 'todos'`, `SEM_DONO = 'sem'`, `donosDoItem(item, donosPorProjeto)`, `casaDono(donos, filtro)`, `FilaPorGrupo = Record<GrupoDaFila, ItemDaCaixa[]>`, `OpcoesDaFila {ocultos; agora; donosPorProjeto}`, `filaPorGrupo(itens, o & {dono})`, `resumoDaFila(itens, o): {total; agora; semDono}`, `UsuarioDaPagina {id; role; name?}`, `filaInicial(usuario)`, `primeiroNome(nome)`, `opcoesDeDono(projetistas, usuario): {valor; rotulo}[]`, `textoDoFiltroDeDono(dono, opcoes)`, `TomDoPrazo = 'alerta' | 'sol' | 'caixa'`, `prazoDoItem(item, agora): {texto; tom}`, `tituloDoItem(item, rotuloEtapa)`, `linhaDoProjeto(item, comEmpresa?)`, `porqueDoItem(item)`, `BotaoDoCartao = {tipo:'decidir'; acao; rotulo} | {tipo:'abrir'; rotulo}`, `botaoDoCartao(item, rotuloEtapa)`.

- [ ] **Step 1: Escrever o teste**

Crie `src/lib/ludmillaFila.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PortalUpdate } from '@/hooks/useLudmilla';
import { itensDaCaixa, type Afazer, type ItemDaCaixa } from './ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, AGORA, CONTAS_DE_EXEMPLO, F_DEVOLUCAO, F_VISTORIA, U_CPFL, UPDATES_DE_EXEMPLO,
  nomeDaContaDeExemplo, rotuloDeExemplo,
} from './ludmillaCaixa.fixtures';
import { COBRANCA_BASE, F_COBRANCA, F_COBRANCA_SEGUNDA } from './ludmillaCobranca.fixtures';
import {
  SEM_DONO, TODOS, botaoDoCartao, casaDono, filaInicial, filaPorGrupo, grupoDoItem, linhaDoProjeto, opcoesDeDono,
  porqueDoItem, prazoDoItem, primeiroNome, resumoDaFila, textoDoFiltroDeDono, tituloDoItem,
} from './ludmillaFila';

// AGORA (fixtures) = 22/10/2026 12:00 UTC = 09:00 de quinta em Brasília
const ANA = { id: 'pessoa-ana', nome: 'Ana Lima' };
const BRUNO = { id: 'pessoa-bruno', nome: 'Bruno Costa' };

const U_HOJE: PortalUpdate = { ...U_CPFL, id: 'u-hoje', detectado_em: '2026-10-22T10:30:00Z' };
const U_ONTEM_A_NOITE: PortalUpdate = { ...U_CPFL, id: 'u-noite', detectado_em: '2026-10-22T02:00:00Z' }; // 23:00 de 21/10
const U_SO_PROTOCOLO: PortalUpdate = { ...U_CPFL, id: 'u-proto', recomendacao: null, atualizar_protocolo: true };
const F_VISTORIA_7: Afazer = { ...F_VISTORIA, id: 'f-vist-7', criado_em: '2026-10-15T12:00:00Z' };
const F_VISTORIA_6: Afazer = { ...F_VISTORIA, id: 'f-vist-6', criado_em: '2026-10-16T12:00:00Z' };
const F_AVISO: Afazer = { ...F_DEVOLUCAO, id: 'f-aviso', tipo: 'aviso', titulo: '📡 Conferir a carta da ENEL', mensagem: '' };
const F_COBRANCA_VENCIDA: Afazer = { ...F_COBRANCA, id: 'f-cob-venc', cobranca: { ...COBRANCA_BASE, vence_em: '2026-10-20T14:00:00Z' } };

const montar = (updates: PortalUpdate[] = UPDATES_DE_EXEMPLO, afazeres: Afazer[] = AFAZERES_DE_EXEMPLO): ItemDaCaixa[] =>
  itensDaCaixa({ updates, afazeres, contas: CONTAS_DE_EXEMPLO, nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo });
const TODOS_OS_ITENS = montar(
  [...UPDATES_DE_EXEMPLO, U_HOJE, U_ONTEM_A_NOITE, U_SO_PROTOCOLO],
  [...AFAZERES_DE_EXEMPLO, F_VISTORIA_7, F_VISTORIA_6, F_AVISO, F_COBRANCA, F_COBRANCA_SEGUNDA, F_COBRANCA_VENCIDA],
);
const item = (chave: string): ItemDaCaixa => {
  const i = TODOS_OS_ITENS.find(x => x.chave === chave);
  if (!i) throw new Error(`a fixture não tem ${chave}`);
  return i;
};
const DONOS = new Map([['p-1', [ANA]], ['p-2', [BRUNO]], ['p-3', [ANA, BRUNO]]]);

describe('grupoDoItem (spec §6.1)', () => {
  it('Agora: cobrança, troca que falhou, e-mail que voltou e recomendação de etapa de hoje', () => {
    expect(grupoDoItem(item('f:f-cob'), AGORA)).toBe('agora');
    expect(grupoDoItem(item('f:f-feito'), AGORA)).toBe('agora'); // troca_falhou
    expect(grupoDoItem(item('f:f-devolucao'), AGORA)).toBe('agora');
    expect(grupoDoItem(item('u:u-hoje'), AGORA)).toBe('agora');
  });

  it('Esta semana: recomendação de etapa de dias anteriores (o dia é o de Brasília)', () => {
    expect(grupoDoItem(item('u:u-cpfl'), AGORA)).toBe('semana');
    expect(grupoDoItem(item('u:u-noite'), AGORA)).toBe('semana');
  });

  it('vistoria aprovada: Esta semana até 6 dias, Agora a partir de 7', () => {
    expect(grupoDoItem(item('f:f-vistoria'), AGORA)).toBe('semana');
    expect(grupoDoItem(item('f:f-vist-6'), AGORA)).toBe('semana');
    expect(grupoDoItem(item('f:f-vist-7'), AGORA)).toBe('agora');
  });

  it('Quando puder: documento travado, só protocolo, sem sugestão e aviso', () => {
    expect(grupoDoItem(item('u:u-enel-bloq'), AGORA)).toBe('depois');
    expect(grupoDoItem(item('u:u-proto'), AGORA)).toBe('depois');
    expect(grupoDoItem(item('u:u-cpfl-sem'), AGORA)).toBe('depois');
    expect(grupoDoItem(item('f:f-aviso'), AGORA)).toBe('depois');
  });
});

describe('a fila por grupo, com o dono (spec §6.2)', () => {
  const pendentes = montar();
  const base = { ocultos: new Set<string>(), agora: AGORA, donosPorProjeto: DONOS };

  it('Todos: só o que espera decisão, mais antigo primeiro em cada grupo', () => {
    const g = filaPorGrupo(pendentes, { ...base, dono: TODOS });
    expect(g.agora.map(i => i.chave)).toEqual(['f:f-devolucao']);
    expect(g.semana.map(i => i.chave)).toEqual(['f:f-vistoria', 'u:u-cpfl', 'u:u-enel-troca', 'u:u-edp']);
    expect(g.depois.map(i => i.chave)).toEqual(['u:u-enel-bloq', 'u:u-cpfl-sem']);
  });

  it('a fila de um projetista; com vários ligados, o item conta na de cada um', () => {
    const a = filaPorGrupo(pendentes, { ...base, dono: ANA.id });
    expect([...a.agora, ...a.semana, ...a.depois].map(i => i.chave)).toEqual(['u:u-cpfl', 'u:u-enel-bloq']);
    const b = filaPorGrupo(pendentes, { ...base, dono: BRUNO.id });
    expect([...b.agora, ...b.semana, ...b.depois].map(i => i.chave)).toEqual(['u:u-enel-troca', 'u:u-enel-bloq']);
  });

  it('Sem dono: sem projeto, ou projeto sem projetista ligado', () => {
    const g = filaPorGrupo(pendentes, { ...base, dono: SEM_DONO });
    expect([...g.agora, ...g.semana, ...g.depois].map(i => i.chave)).toEqual(['f:f-devolucao', 'f:f-vistoria', 'u:u-edp', 'u:u-cpfl-sem']);
  });

  it('o que espera o Desfazer não aparece', () => {
    const g = filaPorGrupo(pendentes, { ...base, ocultos: new Set(['u:u-cpfl']), dono: TODOS });
    expect(g.semana.map(i => i.chave)).not.toContain('u:u-cpfl');
  });

  it('o resumo do recado conta a fila de todos', () => {
    expect(resumoDaFila(pendentes, base)).toEqual({ total: 7, agora: 1, semDono: 4 });
  });

  it('casaDono', () => {
    expect(casaDono([], TODOS)).toBe(true);
    expect(casaDono([], SEM_DONO)).toBe(true);
    expect(casaDono([ANA], SEM_DONO)).toBe(false);
    expect(casaDono([ANA, BRUNO], BRUNO.id)).toBe(true);
    expect(casaDono([ANA], BRUNO.id)).toBe(false);
  });
});

describe('quem abre em qual fila', () => {
  it('o projetista na própria; o gestor em Todos', () => {
    expect(filaInicial({ id: ANA.id, role: 'staff' })).toBe(ANA.id);
    expect(filaInicial({ id: 'chefe', role: 'admin' })).toBe(TODOS);
    expect(filaInicial(null)).toBe(TODOS);
  });

  it('os botões de "Fila de": quem abriu entra mesmo sem vínculo', () => {
    expect(opcoesDeDono([ANA, BRUNO], { id: 'chefe', role: 'admin' })).toEqual([
      { valor: TODOS, rotulo: 'Todos' }, { valor: ANA.id, rotulo: 'Ana' },
      { valor: BRUNO.id, rotulo: 'Bruno' }, { valor: SEM_DONO, rotulo: 'Sem dono' },
    ]);
    expect(opcoesDeDono([BRUNO], { id: 'pessoa-carla', role: 'staff', name: 'Carla Dias' }).map(o => o.rotulo))
      .toEqual(['Todos', 'Bruno', 'Carla', 'Sem dono']);
  });

  it('o texto do celular', () => {
    const opcoes = opcoesDeDono([ANA, BRUNO], null);
    expect(textoDoFiltroDeDono(TODOS, opcoes)).toBe('Fila de todos. Para ver só a sua, abra o menu.');
    expect(textoDoFiltroDeDono(ANA.id, opcoes)).toBe('Fila de Ana. Para mudar, abra o menu.');
    expect(textoDoFiltroDeDono(SEM_DONO, opcoes)).toBe('Só o que está sem dono. Para mudar, abra o menu.');
    expect(primeiroNome('  Bruno Costa ')).toBe('Bruno');
  });
});

describe('prazoDoItem', () => {
  it('cobrança vencida e e-mail que voltou ficam em alerta', () => {
    expect(prazoDoItem(item('f:f-cob-venc'), AGORA)).toEqual({ texto: 'venceu há 2 dias', tom: 'alerta' });
    expect(prazoDoItem(item('f:f-devolucao'), AGORA)).toEqual({ texto: 'voltou hoje', tom: 'alerta' });
  });

  it('recomendação de hoje, de ontem e de antes, em sol', () => {
    expect(prazoDoItem(item('u:u-hoje'), AGORA)).toEqual({ texto: 'chegou hoje', tom: 'sol' });
    expect(prazoDoItem(item('u:u-enel-troca'), AGORA)).toEqual({ texto: 'chegou ontem', tom: 'sol' });
    expect(prazoDoItem(item('u:u-cpfl'), AGORA)).toEqual({ texto: 'chegou há 2 dias', tom: 'sol' });
  });

  it('vistoria: sol na semana, alerta quando vira Agora', () => {
    expect(prazoDoItem(item('f:f-vistoria'), AGORA)).toEqual({ texto: 'aprovada há 2 dias', tom: 'sol' });
    expect(prazoDoItem(item('f:f-vist-7'), AGORA)).toEqual({ texto: 'aprovada há 7 dias', tom: 'alerta' });
  });

  it('Quando puder fica na caixa', () => {
    expect(prazoDoItem(item('u:u-enel-bloq'), AGORA)).toEqual({ texto: 'chegou há 3 dias', tom: 'caixa' });
  });
});

describe('tituloDoItem: a ação como título', () => {
  it('recomendações', () => {
    expect(tituloDoItem(item('u:u-cpfl'), rotuloDeExemplo)).toBe('Mover para Aprovado');
    expect(tituloDoItem(item('u:u-enel-troca'), rotuloDeExemplo)).toBe('Mover para Aprovado e gravar o protocolo');
    expect(tituloDoItem(item('u:u-proto'), rotuloDeExemplo)).toBe('Gravar o protocolo');
    expect(tituloDoItem(item('u:u-enel-bloq'), rotuloDeExemplo)).toBe('Decidir sobre um documento que travei');
    expect(tituloDoItem(item('u:u-cpfl-sem'), rotuloDeExemplo)).toBe('Ver o que chegou');
  });

  it('A fazer', () => {
    expect(tituloDoItem(item('f:f-cob'), rotuloDeExemplo)).toBe('Cobrar a troca do relógio');
    expect(tituloDoItem(item('f:f-vistoria'), rotuloDeExemplo)).toBe('Pedir a troca do relógio');
    expect(tituloDoItem(item('f:f-devolucao'), rotuloDeExemplo)).toBe('Conferir o e-mail que voltou');
    expect(tituloDoItem(item('f:f-feito'), rotuloDeExemplo)).toBe('Ver a troca do relógio que não aconteceu');
    expect(tituloDoItem(item('f:f-aviso'), rotuloDeExemplo)).toBe('Conferir a carta da ENEL');
  });

  it('a linha do projeto', () => {
    expect(linhaDoProjeto(item('u:u-cpfl'))).toBe('PRJ-10001, Marta Ribeiro Campos, CPFL Paulista');
    expect(linhaDoProjeto(item('u:u-cpfl'), true)).toBe('PRJ-10001, Marta Ribeiro Campos, Solar Alfa, CPFL Paulista');
    expect(linhaDoProjeto(item('f:f-devolucao'))).toBe('Sem projeto casado, ENEL SP');
  });
});

describe('porqueDoItem: em primeira pessoa', () => {
  it('portal e e-mail', () => {
    expect(porqueDoItem(item('u:u-cpfl'))).toBe('Vi no portal da CPFL Paulista que mudou de “Em Andamento” para “Aprovado”.');
    expect(porqueDoItem(item('u:u-edp'))).toBe('Li um e-mail da EDP São Paulo: Parecer favorável.');
  });

  it('documento travado', () => {
    expect(porqueDoItem(item('u:u-enel-bloq')))
      .toBe('Não anexei: o documento é de "Carlos Souza" e o projeto é de "Ana Paula Reis".');
  });

  it('cobrança: a nota como a ENEL escreve, e quantas vezes já cobramos', () => {
    expect(porqueDoItem(item('f:f-cob')))
      .toBe('Vi que a ENEL SP abriu a nota 70700000123 em 01/10/2026 e ainda não trocou o relógio. Ninguém cobrou desta nota ainda.');
    expect(porqueDoItem(item('f:f-cob-2a')))
      .toBe('Vi que a ENEL SP abriu a nota 70700000123 em 01/10/2026 e ainda não trocou o relógio. Já cobramos 1 vez.');
  });

  it('vistoria aprovada e os outros A fazer', () => {
    expect(porqueDoItem(item('f:f-vistoria'))).toBe('Vi que a vistoria foi aprovada em 20/10/2026 e ninguém pediu a troca ainda.');
    expect(porqueDoItem(item('f:f-devolucao'))).toBe('Um dos destinatários de um e-mail não recebeu a mensagem (devolução do servidor).');
    expect(porqueDoItem(item('f:f-aviso'))).toBe('Conferir a carta da ENEL.');
  });
});

describe('botaoDoCartao (decisão 13)', () => {
  it('decide direto só o que não pede revisão', () => {
    expect(botaoDoCartao(item('u:u-cpfl'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'aplicar', rotulo: 'Mover para Aprovado' });
    expect(botaoDoCartao(item('u:u-enel-troca'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'aplicar', rotulo: 'Mover e gravar o protocolo' });
    expect(botaoDoCartao(item('u:u-proto'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'aplicar', rotulo: 'Gravar o protocolo' });
    expect(botaoDoCartao(item('f:f-devolucao'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'feito', rotulo: 'Marcar como feito' });
  });

  it('o resto abre o detalhe', () => {
    expect(botaoDoCartao(item('f:f-cob'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Revisar e enviar' });
    expect(botaoDoCartao(item('f:f-vistoria'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Revisar e enviar' });
    expect(botaoDoCartao(item('u:u-enel-bloq'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Abrir para decidir' });
    expect(botaoDoCartao(item('u:u-cpfl-sem'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Abrir para decidir' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/ludmillaFila.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaFila"`.

- [ ] **Step 3: Escrever `src/lib/ludmillaFila.ts`**

```ts
/**
 * A FILA DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md §4.3 (o cartão completo),
 * §6.1 (em que grupo cai cada item) e §6.2 (de quem é cada item). Os itens são os de sempre
 * (`ItemDaCaixa`: recomendações + A fazer); aqui se decide o grupo, o dono, o prazo, o título, o
 * porquê em primeira pessoa e o que o botão do cartão faz.
 */
import { cartaoBloqueado, ordenarItens, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import type { DonoDoProjeto } from '@/lib/ludmillaCarteira';
// `dataBr` (dd/mm/aaaa no fuso de Brasília) é a MESMA data que vai no e-mail da cobrança: o porquê
// do cartão cita a nota igual ao e-mail. Exceção aceita à regra "dia e hora saem de ludmillaTempo".
import { dataBr, notaNaTela } from '@/lib/ludmillaCobranca';
import { acoesDoItem, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import { diasEntre } from '@/lib/ludmillaTempo';

export type GrupoDaFila = 'agora' | 'semana' | 'depois';

export const GRUPOS_DA_FILA: { valor: GrupoDaFila; rotulo: string; dica: string }[] = [
  { valor: 'agora', rotulo: 'Agora', dica: 'prazo vencido ou novidade de hoje' },
  { valor: 'semana', rotulo: 'Esta semana', dica: 'antes que vire atraso' },
  { valor: 'depois', rotulo: 'Quando puder', dica: 'sem prazo, mas esperando alguém' },
];

/** Vistoria aprovada sem o pedido da troca vai de "Esta semana" para "Agora" com 7 dias (spec §6.1). */
export const DIAS_ATE_A_VISTORIA_VIRAR_AGORA = 7;

/** Decisão 4 do plano: "hoje" é o dia de Brasília; travado vence a etapa; sem etapa é Quando puder. */
export function grupoDoItem(item: ItemDaCaixa, agora: number): GrupoDaFila {
  const f = item.afazer;
  if (f) {
    if (f.tipo === 'cobrar_troca' || f.tipo === 'troca_falhou' || f.tipo === 'devolucao') return 'agora';
    if (f.tipo === 'vistoria_aprovada') {
      return diasEntre(f.criado_em, agora) >= DIAS_ATE_A_VISTORIA_VIRAR_AGORA ? 'agora' : 'semana';
    }
    return 'depois';
  }
  const u = item.update;
  if (!u || cartaoBloqueado(u) || !u.recomendacao) return 'depois';
  return diasEntre(u.detectado_em, agora) === 0 ? 'agora' : 'semana';
}

/** `TODOS`, `SEM_DONO` ou o id de um projetista. */
export type FiltroDeDono = string;
export const TODOS = 'todos';
export const SEM_DONO = 'sem';

export function donosDoItem(item: ItemDaCaixa, donosPorProjeto: Map<string, DonoDoProjeto[]>): DonoDoProjeto[] {
  return item.projectId ? donosPorProjeto.get(item.projectId) ?? [] : [];
}

/** Vários projetistas ligados: o item conta na fila de cada um (spec §6.2). */
export function casaDono(donos: DonoDoProjeto[], filtro: FiltroDeDono): boolean {
  if (filtro === TODOS) return true;
  if (filtro === SEM_DONO) return donos.length === 0;
  return donos.some(d => d.id === filtro);
}

export type FilaPorGrupo = Record<GrupoDaFila, ItemDaCaixa[]>;

export interface OpcoesDaFila {
  /** decisões esperando o Desfazer (`useFilaDeDecisoes`) */
  ocultos: ReadonlySet<string>;
  agora: number;
  donosPorProjeto: Map<string, DonoDoProjeto[]>;
}

/** Só o que espera decisão, do dono escolhido; mais antigo primeiro dentro do grupo (spec §6.1). */
export function filaPorGrupo(itens: ItemDaCaixa[], o: OpcoesDaFila & { dono: FiltroDeDono }): FilaPorGrupo {
  const g: FilaPorGrupo = { agora: [], semana: [], depois: [] };
  const pendentes = itens.filter(i => i.situacao === 'pendente' && !o.ocultos.has(i.chave)
    && casaDono(donosDoItem(i, o.donosPorProjeto), o.dono));
  for (const i of ordenarItens(pendentes)) g[grupoDoItem(i, o.agora)].push(i);
  return g;
}

/** Os números do recado: a fila de todos, o que é para agora e o que ficou sem dono. */
export function resumoDaFila(itens: ItemDaCaixa[], o: OpcoesDaFila): { total: number; agora: number; semDono: number } {
  const g = filaPorGrupo(itens, { ...o, dono: TODOS });
  const todos = [...g.agora, ...g.semana, ...g.depois];
  return {
    total: todos.length,
    agora: g.agora.length,
    semDono: todos.filter(i => donosDoItem(i, o.donosPorProjeto).length === 0).length,
  };
}

export interface UsuarioDaPagina { id: string; role: string; name?: string | null }

/** O projetista abre na fila dele; o gestor, em Todos (spec §6.2). */
export function filaInicial(usuario: UsuarioDaPagina | null): FiltroDeDono {
  return usuario?.role === 'staff' ? usuario.id : TODOS;
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome;
}

/** Os botões de "Fila de": Todos, cada projetista (quem abriu entra mesmo sem vínculo) e Sem dono. */
export function opcoesDeDono(projetistas: DonoDoProjeto[], usuario: UsuarioDaPagina | null): { valor: FiltroDeDono; rotulo: string }[] {
  const lista = [...projetistas];
  if (usuario?.role === 'staff' && !lista.some(p => p.id === usuario.id)) {
    lista.push({ id: usuario.id, nome: usuario.name?.trim() || 'Você' });
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  return [
    { valor: TODOS, rotulo: 'Todos' },
    ...lista.map(p => ({ valor: p.id, rotulo: primeiroNome(p.nome) })),
    { valor: SEM_DONO, rotulo: 'Sem dono' },
  ];
}

/** A linha do celular embaixo dos grupos (mockup "CelularLista"). */
export function textoDoFiltroDeDono(dono: FiltroDeDono, opcoes: { valor: FiltroDeDono; rotulo: string }[]): string {
  if (dono === TODOS) return 'Fila de todos. Para ver só a sua, abra o menu.';
  if (dono === SEM_DONO) return 'Só o que está sem dono. Para mudar, abra o menu.';
  return `Fila de ${opcoes.find(o => o.valor === dono)?.rotulo ?? 'alguém'}. Para mudar, abra o menu.`;
}

export type TomDoPrazo = 'alerta' | 'sol' | 'caixa';

function haQuantosDias(verbo: string, iso: string, agora: number): string {
  const d = Math.max(0, diasEntre(iso, agora));
  return d === 0 ? `${verbo} hoje` : d === 1 ? `${verbo} ontem` : `${verbo} há ${d} dias`;
}

/** O chip do prazo (mockup: "venceu há 2 dias", "chegou hoje", "aprovada há 4 dias"). */
export function prazoDoItem(item: ItemDaCaixa, agora: number): { texto: string; tom: TomDoPrazo } {
  const f = item.afazer;
  const grupo = grupoDoItem(item, agora);
  if (f?.tipo === 'cobrar_troca') return { texto: haQuantosDias('venceu', f.cobranca?.vence_em ?? f.criado_em, agora), tom: 'alerta' };
  if (f?.tipo === 'devolucao') return { texto: haQuantosDias('voltou', f.criado_em, agora), tom: 'alerta' };
  if (f?.tipo === 'troca_falhou') return { texto: haQuantosDias('chegou', f.criado_em, agora), tom: 'alerta' };
  if (f?.tipo === 'vistoria_aprovada') {
    return { texto: haQuantosDias('aprovada', f.criado_em, agora), tom: grupo === 'agora' ? 'alerta' : 'sol' };
  }
  return { texto: haQuantosDias('chegou', item.quando, agora), tom: grupo === 'depois' ? 'caixa' : 'sol' };
}

const semEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();
const limpo = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const comPonto = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** A ação como título do cartão (spec §4.3: "Cobrar a troca do relógio"). */
export function tituloDoItem(item: ItemDaCaixa, rotuloEtapa: (s: string) => string): string {
  const f = item.afazer;
  if (f) {
    switch (f.tipo) {
      case 'cobrar_troca': return 'Cobrar a troca do relógio';
      case 'vistoria_aprovada': return 'Pedir a troca do relógio';
      case 'troca_falhou': return 'Ver a troca do relógio que não aconteceu';
      case 'devolucao': return 'Conferir o e-mail que voltou';
      default: return semEmoji(f.titulo) || 'Ver o aviso';
    }
  }
  const u = item.update;
  if (!u) return 'Ver o que chegou';
  if (cartaoBloqueado(u)) return 'Decidir sobre um documento que travei';
  if (u.recomendacao && u.atualizar_protocolo) return `Mover para ${rotuloEtapa(u.recomendacao)} e gravar o protocolo`;
  if (u.recomendacao) return `Mover para ${rotuloEtapa(u.recomendacao)}`;
  if (u.atualizar_protocolo) return 'Gravar o protocolo';
  return 'Ver o que chegou';
}

/** "PRJ-2187, Marina Duarte, ENEL SP" (no detalhe, com a empresa). */
export function linhaDoProjeto(item: ItemDaCaixa, comEmpresa = false): string {
  return [item.codigo ?? 'Sem projeto casado', item.titular, comEmpresa ? item.empresa : null, item.concessionaria]
    .filter((x): x is string => !!x)
    .join(', ');
}

/** O porquê em primeira pessoa ("Vi que…"), só com o que o item já traz. */
export function porqueDoItem(item: ItemDaCaixa): string {
  const conc = item.concessionaria || 'concessionária';
  const f = item.afazer;
  if (f?.tipo === 'cobrar_troca') {
    const c = f.cobranca;
    if (!c) return 'Vi que a troca do relógio passou do prazo.';
    const base = `Vi que a ${conc} abriu a nota ${notaNaTela(c.nota_servico) ?? 'sem número'} em ${dataBr(c.data_nota)} e ainda não trocou o relógio.`;
    return c.enviadas > 0
      ? `${base} Já cobramos ${c.enviadas === 1 ? '1 vez' : `${c.enviadas} vezes`}.`
      : `${base} Ninguém cobrou desta nota ainda.`;
  }
  if (f?.tipo === 'vistoria_aprovada') return `Vi que a vistoria foi aprovada em ${dataBr(f.criado_em)} e ninguém pediu a troca ainda.`;
  if (f) return comPonto(limpo(f.mensagem) ?? (semEmoji(f.titulo) || 'Pede alguém da equipe'));
  const u = item.update;
  if (!u) return '';
  const r = (u.raw ?? {}) as Record<string, unknown>;
  if (cartaoBloqueado(u)) {
    const motivo = (limpo(r.motivo) ?? '').replace(/^não anexei\s*·\s*/i, '');
    return motivo ? `Não anexei: ${comPonto(motivo)}` : 'Não anexei o documento: o titular não confere.';
  }
  if (item.meio === 'email') {
    const resumo = limpo(r.resumo) ?? limpo(r.assunto);
    return resumo ? `Li um e-mail da ${conc}: ${comPonto(resumo)}` : `Li um e-mail da ${conc}.`;
  }
  const de = limpo(u.status_anterior);
  return de
    ? `Vi no portal da ${conc} que mudou de “${de}” para “${u.status_portal}”.`
    : `Vi no portal da ${conc} a situação “${u.status_portal}”.`;
}

export type BotaoDoCartao =
  | { tipo: 'decidir'; acao: AcaoDaDecisao; rotulo: string }
  | { tipo: 'abrir'; rotulo: string };

/** Decisão 13 do plano: o botão decide direto só o que não pede revisão; o resto abre o detalhe. */
export function botaoDoCartao(item: ItemDaCaixa, rotuloEtapa: (s: string) => string): BotaoDoCartao {
  const f = item.afazer;
  if (f?.tipo === 'cobrar_troca' || f?.tipo === 'vistoria_aprovada') return { tipo: 'abrir', rotulo: 'Revisar e enviar' };
  if (f) return { tipo: 'decidir', acao: 'feito', rotulo: 'Marcar como feito' };
  const u = item.update;
  if (!u || cartaoBloqueado(u)) return { tipo: 'abrir', rotulo: 'Abrir para decidir' };
  const { principal } = acoesDoItem(item, null);
  if (principal?.acao !== 'aplicar' || !principal.habilitada) return { tipo: 'abrir', rotulo: 'Abrir para decidir' };
  const rotulo = !u.recomendacao ? 'Gravar o protocolo'
    : u.atualizar_protocolo ? 'Mover e gravar o protocolo'
    : `Mover para ${rotuloEtapa(u.recomendacao)}`;
  return { tipo: 'decidir', acao: 'aplicar', rotulo };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/ludmillaFila.test.ts`
Expected: PASS. Se `cobrancaAfazer` (fixture) não preencher `cobranca`, o teste da cobrança acusa: confira `src/lib/ludmillaCobranca.fixtures.ts` (linhas 26–34) e ajuste só o TESTE para montar `cobranca: { ...COBRANCA_BASE }`, nunca a função.

- [ ] **Step 5: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 6: Commit**

`$RASCUNHO/msg-e2-t3.txt` (Write):

```
feat(ludmilla): fila por grupo e por dono, em primeira pessoa (entrega 2, página)

Agora / Esta semana / Quando puder pela regra 6.1, "Fila de" pelo vínculo
projetista-empresa (6.2, vários donos contam na fila de cada um; sem
vínculo = Sem dono), o chip do prazo, a ação como título, o porquê em
primeira pessoa e o que o botão do cartão faz.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaFila.ts src/lib/ludmillaFila.test.ts
git commit -F "$RASCUNHO/msg-e2-t3.txt" -- src/lib/ludmillaFila.ts src/lib/ludmillaFila.test.ts
git show --stat HEAD
```

---

### Task 4: O recado do dia, o Diário e o "Fiz sozinha" (lógica pura)

**Files:**
- Create: `src/lib/ludmillaRecado.ts`
- Test: `src/lib/ludmillaRecado.test.ts`

**Interfaces:**
- Consumes: `RegistroLudmilla` (tipo, `src/hooks/useLudmilla.ts`); `juntarComE` (Task 1); `DIA_MS`, `HORA_MS`, `diaDaSemana`, `diaEMes`, `diaEmBrasilia`, `emBrasilia`, `horaEMinuto`, `inicioDoDia`, `maiuscula`, `saudacaoDaHora` (Task 1).
- Produces: `HORA_DA_ULTIMA_LEITURA = 18`, `MAXIMO_DO_DESDE_MS`, `ultimaLeituraDoDiaUtilAnterior(agora)`, `desdeDoRecado(anterior: string | null, agora): number`, `rotuloDoDesde(desde, agora)`, `chaveDaVisita(userId)`, `lerVisita(armazem, userId): string | null`, `gravarVisita(armazem, userId, iso): void`, `LeituraDaConta {nome; meio: 'email' | 'portal'; emails: number | null; protocolos: number | null}`, `fraseDasLeituras(leituras): string | null`, `EntradaDoRecado`, `RecadoDoDia {data; texto; curto}`, `recadoDoDia(e)`, `FeitoSozinha {quando; texto; projectId}`, `fezSozinha(registro, desde)`, `EventoParaFrase`, `fraseDoRegistro(e)`, `LinhaDoDiario {chave; hora; deLa; quem; texto; detalhe; erro}`, `DiaDoDiario {rotulo; itens}`, `rotuloDoDia(ms, agora)`, `diarioPorDia(registro, agora)`.

- [ ] **Step 1: Escrever o teste**

Crie `src/lib/ludmillaRecado.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RegistroLudmilla } from '@/hooks/useLudmilla';
import {
  chaveDaVisita, desdeDoRecado, diarioPorDia, fezSozinha, fraseDasLeituras, fraseDoRegistro, gravarVisita, lerVisita,
  recadoDoDia, rotuloDoDesde, ultimaLeituraDoDiaUtilAnterior, type LeituraDaConta,
} from './ludmillaRecado';

/** Segunda, 9/11/2026, 08:15 de Brasília. */
const SEG = Date.parse('2026-11-09T11:15:00Z');
/** Sexta, 6/11/2026, 18:00 de Brasília. */
const SEXTA_18H = Date.parse('2026-11-06T21:00:00Z');

const ev = (x: Partial<RegistroLudmilla> & Pick<RegistroLudmilla, 'quando' | 'acao' | 'titulo'>): RegistroLudmilla => ({
  ator: 'ludmilla', quem: 'Ludmilla', detalhe: null, situacao: 'ok', project_id: null, projeto: null, protocolo: null, ...x,
});

describe('desde quando (decisão 6)', () => {
  it('a última leitura do dia útil anterior pula o fim de semana', () => {
    expect(ultimaLeituraDoDiaUtilAnterior(SEG)).toBe(SEXTA_18H);
    expect(ultimaLeituraDoDiaUtilAnterior(Date.parse('2026-11-10T12:00:00Z'))).toBe(Date.parse('2026-11-09T21:00:00Z'));
    expect(ultimaLeituraDoDiaUtilAnterior(Date.parse('2026-11-08T15:00:00Z'))).toBe(SEXTA_18H);
  });

  it('a visita guardada vale; sem ela, inválida ou no futuro, a última leitura; nunca mais de 7 dias', () => {
    expect(desdeDoRecado('2026-11-09T10:00:00Z', SEG)).toBe(Date.parse('2026-11-09T10:00:00Z'));
    expect(desdeDoRecado(null, SEG)).toBe(SEXTA_18H);
    expect(desdeDoRecado('lixo', SEG)).toBe(SEXTA_18H);
    expect(desdeDoRecado('2026-11-09T12:00:00Z', SEG)).toBe(SEXTA_18H);
    expect(desdeDoRecado('2026-10-20T10:00:00Z', SEG)).toBe(SEG - 7 * 86_400_000);
  });

  it('o rótulo', () => {
    expect(rotuloDoDesde(Date.parse('2026-11-09T10:40:00Z'), SEG)).toBe('Desde as 07:40');
    expect(rotuloDoDesde(Date.parse('2026-11-08T20:00:00Z'), SEG)).toBe('Desde ontem');
    expect(rotuloDoDesde(SEXTA_18H, SEG)).toBe('Desde sexta');
    expect(rotuloDoDesde(Date.parse('2026-10-31T12:00:00Z'), SEG)).toBe('Desde 31/10');
  });
});

describe('a visita no localStorage', () => {
  it('guarda e lê por usuário', () => {
    const guardado = new Map<string, string>();
    const armazem = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => { guardado.set(k, v); } };
    gravarVisita(armazem, 'u1', '2026-11-09T11:00:00Z');
    expect(lerVisita(armazem, 'u1')).toBe('2026-11-09T11:00:00Z');
    expect(lerVisita(armazem, 'u2')).toBeNull();
    expect(chaveDaVisita('u1')).toBe('ludmilla:ultima-visita:u1');
  });

  it('armazém que recusa ou não existe nunca derruba a página', () => {
    const quebrado = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('cota'); },
    };
    expect(lerVisita(quebrado, 'u1')).toBeNull();
    expect(() => gravarVisita(quebrado, 'u1', 'x')).not.toThrow();
    expect(lerVisita(null, 'u1')).toBeNull();
  });
});

describe('o recado do dia (spec §4.2)', () => {
  const LEITURAS: LeituraDaConta[] = [
    { nome: 'ENEL', meio: 'email', emails: 38, protocolos: null },
    { nome: 'CPFL', meio: 'portal', emails: null, protocolos: 199 },
    { nome: 'EDP', meio: 'email', emails: 0, protocolos: null },
  ];

  it('a frase das leituras pula quem não leu nada', () => {
    expect(fraseDasLeituras(LEITURAS)).toBe('li 38 e-mails da ENEL e 199 protocolos da CPFL');
    expect(fraseDasLeituras([{ nome: 'ENEL', meio: 'email', emails: 1, protocolos: null }])).toBe('li 1 e-mail da ENEL');
    expect(fraseDasLeituras([])).toBeNull();
  });

  it('o recado do mockup', () => {
    const r = recadoDoDia({ agora: SEG, desde: SEXTA_18H, leituras: LEITURAS, fizSozinha: 2, separei: 5, paraAgora: 2, semDono: 0 });
    expect(r.data).toBe('Segunda, 9/11, 08:15');
    expect(r.texto).toBe('Bom dia. Desde sexta li 38 e-mails da ENEL e 199 protocolos da CPFL. Fiz 2 coisas sozinha. Separei 5 coisas para vocês.');
    expect(r.curto).toBe('Bom dia. Separei 5 coisas; 2 para agora.');
  });

  it('sem nada', () => {
    const tarde = Date.parse('2026-11-09T18:00:00Z');
    const r = recadoDoDia({ agora: tarde, desde: Date.parse('2026-11-09T17:00:00Z'), leituras: [], fizSozinha: 0, separei: 0, paraAgora: 0, semDono: 0 });
    expect(r.texto).toBe('Boa tarde. Desde as 14:00 não li nada novo. Não separei nada para vocês.');
    expect(r.curto).toBe('Boa tarde. Nada para decidir agora.');
  });

  it('contagem que falhou não vira "não li nada"; sem dono vai no recado', () => {
    const r = recadoDoDia({
      agora: SEG, desde: Date.parse('2026-11-08T20:00:00Z'), leituras: null, fizSozinha: 1, separei: 1, paraAgora: 0, semDono: 1,
    });
    expect(r.texto).toBe('Bom dia. Desde ontem, não consegui contar o que li. Fiz 1 coisa sozinha. Separei 1 coisa para vocês; 1 está sem dono.');
    expect(r.curto).toBe('Bom dia. Separei 1 coisa; 0 para agora.');
    const varios = recadoDoDia({ agora: SEG, desde: SEXTA_18H, leituras: [], fizSozinha: 0, separei: 4, paraAgora: 1, semDono: 2 });
    expect(varios.texto).toContain('Separei 4 coisas para vocês; 2 estão sem dono.');
  });
});

describe('fezSozinha (entrega 2: o que ela já faz hoje)', () => {
  it('anexos conferidos e pareceres no card, desde então, o mais novo primeiro', () => {
    const registro = [
      ev({ quando: '2026-11-09T11:01:00Z', acao: 'anexo', titulo: 'Anexo da concessionária no card',
        detalhe: 'parecer.pdf · protocolo 4500 · conferido por cpf', project_id: 'p-8840', projeto: 'PRJ-8840' }),
      ev({ quando: '2026-11-08T12:00:00Z', acao: 'parecer', titulo: 'Parecer da concessionária no card',
        detalhe: 'Análise técnica · APROVADO · protocolo 7001', project_id: 'p-1', projeto: 'PRJ-1' }),
      ev({ quando: '2026-11-08T12:30:00Z', acao: 'anexo', titulo: 'Anexo bloqueado (titular/UC não conferem)', situacao: 'aviso', projeto: 'PRJ-2' }),
      ev({ quando: '2026-11-09T11:02:00Z', acao: 'visita', titulo: 'Varredura no portal CPFL Paulista' }),
      ev({ quando: '2026-11-09T10:00:00Z', ator: 'equipe', quem: 'Bia', acao: 'aplicada', titulo: 'Recomendação aplicada' }),
      ev({ quando: '2026-11-05T12:00:00Z', acao: 'anexo', titulo: 'Anexo da concessionária no card', detalhe: 'velho.pdf', projeto: 'PRJ-9' }),
    ];
    expect(fezSozinha(registro, SEXTA_18H)).toEqual([
      { quando: '2026-11-09T11:01:00Z', projectId: 'p-8840', texto: 'Anexei parecer.pdf ao PRJ-8840.' },
      { quando: '2026-11-08T12:00:00Z', projectId: 'p-1',
        texto: 'Pus o parecer da concessionária no card do PRJ-1 (Análise técnica · APROVADO · protocolo 7001).' },
    ]);
  });
});

describe('o Diário em primeira pessoa', () => {
  it('as frases dela', () => {
    expect(fraseDoRegistro(ev({ quando: '', acao: 'visita', titulo: 'Varredura no portal CPFL Paulista' }))).toBe('Li o portal CPFL Paulista');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'visita', titulo: 'Leitura dos e-mails da ENEL SP' }))).toBe('Li os e-mails da ENEL SP');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'visita', titulo: 'Varredura no portal Elektro', situacao: 'erro' })))
      .toBe('Não consegui: Varredura no portal Elektro');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'recomendacao', titulo: 'Mudança no portal: Aprovado', projeto: 'PRJ-1' })))
      .toBe('Vi uma mudança: Aprovado (PRJ-1)');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'anexo', titulo: 'Anexo da concessionária no card', projeto: 'PRJ-2' })))
      .toBe('Anexei o documento da concessionária no card (PRJ-2)');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'tarefa_encerrada', titulo: 'Tarefa encerrada: Solicitar vistoria' })))
      .toBe('Encerrei a tarefa: Solicitar vistoria');
    expect(fraseDoRegistro({ ator: 'ludmilla', quem: 'Ludmilla', acao: 'afazer', titulo: 'Vistoria aprovada', detalhe: null, situacao: 'ok', projeto: null }))
      .toBe('Vistoria aprovada');
  });

  it('as frases da equipe', () => {
    expect(fraseDoRegistro(ev({ quando: '', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada', titulo: 'Recomendação aplicada', projeto: 'PRJ-3' })))
      .toBe('Bia Souza aplicou a recomendação (PRJ-3)');
    expect(fraseDoRegistro(ev({ quando: '', ator: 'equipe', quem: null, acao: 'captcha_respondido', titulo: 'Código da imagem respondido (Elektro)' })))
      .toBe('Alguém da equipe digitou o código da imagem');
  });

  it('agrupa por dia de Brasília, o mais novo primeiro', () => {
    const dias = diarioPorDia([
      ev({ quando: '2026-11-09T11:00:00Z', acao: 'visita', titulo: 'Leitura dos e-mails da ENEL SP', detalhe: '12 projetos conferidos' }),
      ev({ quando: '2026-11-09T11:02:00Z', acao: 'visita', titulo: 'Varredura no portal CPFL Paulista', detalhe: '199 protocolos lidos' }),
      ev({ quando: '2026-11-08T15:00:00Z', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada', titulo: 'Recomendação aplicada', projeto: 'PRJ-3' }),
      ev({ quando: '2026-11-06T20:40:00Z', acao: 'visita', titulo: 'Varredura no portal Elektro', situacao: 'erro', detalhe: 'sessão expirada' }),
      ev({ quando: 'lixo', acao: 'visita', titulo: 'sem data' }),
    ], SEG);
    expect(dias.map(d => d.rotulo)).toEqual(['Hoje, segunda 9/11', 'Ontem, domingo 8/11', 'Sexta, 6/11']);
    expect(dias[0].itens.map(i => [i.hora, i.texto])).toEqual([['08:02', 'Li o portal CPFL Paulista'], ['08:00', 'Li os e-mails da ENEL SP']]);
    expect(dias[1].itens[0]).toMatchObject({ deLa: false, quem: 'Bia Souza', texto: 'Bia Souza aplicou a recomendação (PRJ-3)' });
    expect(dias[2].itens[0]).toMatchObject({ deLa: true, quem: 'Ludmilla', erro: true, detalhe: 'sessão expirada' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/ludmillaRecado.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaRecado"`.

- [ ] **Step 3: Escrever `src/lib/ludmillaRecado.ts`**

```ts
/**
 * O RECADO, O DIÁRIO E O QUE ELA FEZ SOZINHA — funções puras, sem React.
 *
 * Spec §4.2 (o recado do dia, "montado a partir dos números, sem IA"), §4.3 (Fiz sozinha, Diário)
 * e §9.2 (na entrega 2, "Fiz sozinha" é o que ela já faz hoje). A voz é a dela, em primeira pessoa.
 */
import type { RegistroLudmilla } from '@/hooks/useLudmilla';
import { juntarComE } from '@/lib/ludmillaCarteira';
import {
  DIA_MS, HORA_MS, diaDaSemana, diaEMes, diaEmBrasilia, emBrasilia, horaEMinuto, inicioDoDia, maiuscula, saudacaoDaHora,
} from '@/lib/ludmillaTempo';

/** A última leitura do dia: a ENEL, de hora em hora até as 18h (cron `ludmilla-enel-email`). */
export const HORA_DA_ULTIMA_LEITURA = 18;
/** O recado nunca olha mais de 7 dias para trás. */
export const MAXIMO_DO_DESDE_MS = 7 * DIA_MS;

/** 18:00 de Brasília do último dia útil antes de hoje (segunda → sexta). Feriado não conta. */
export function ultimaLeituraDoDiaUtilAnterior(agora: number): number {
  let dia = inicioDoDia(agora) - DIA_MS;
  while ([0, 6].includes(emBrasilia(dia).getUTCDay())) dia -= DIA_MS;
  return dia + HORA_DA_ULTIMA_LEITURA * HORA_MS;
}

/** Decisão 6 do plano: a última visita guardada; sem ela, a última leitura do dia útil anterior. */
export function desdeDoRecado(anterior: string | null, agora: number): number {
  const t = anterior ? Date.parse(anterior) : Number.NaN;
  const base = Number.isFinite(t) && t < agora ? t : ultimaLeituraDoDiaUtilAnterior(agora);
  return Math.max(base, agora - MAXIMO_DO_DESDE_MS);
}

export function rotuloDoDesde(desde: number, agora: number): string {
  const dias = diaEmBrasilia(agora) - diaEmBrasilia(desde);
  if (dias <= 0) return `Desde as ${horaEMinuto(desde)}`;
  if (dias === 1) return 'Desde ontem';
  if (dias < 7) return `Desde ${diaDaSemana(desde)}`;
  return `Desde ${diaEMes(desde)}`;
}

export const chaveDaVisita = (userId: string) => `ludmilla:ultima-visita:${userId}`;

/** O localStorage pode não existir ou recusar (modo privado, cota): nunca derruba a página. */
export function lerVisita(armazem: Pick<Storage, 'getItem'> | null | undefined, userId: string): string | null {
  try {
    return armazem?.getItem(chaveDaVisita(userId)) ?? null;
  } catch {
    return null;
  }
}

export function gravarVisita(armazem: Pick<Storage, 'setItem'> | null | undefined, userId: string, iso: string): void {
  try {
    armazem?.setItem(chaveDaVisita(userId), iso);
  } catch {
    // sem onde guardar, o próximo recado cai na última leitura do dia útil anterior
  }
}

/** O que ela leu numa conta desde então (decisão 7): e-mails por e-mail, protocolos por portal. */
export interface LeituraDaConta { nome: string; meio: 'email' | 'portal'; emails: number | null; protocolos: number | null }

const quantos = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

export function fraseDasLeituras(leituras: LeituraDaConta[]): string | null {
  const partes = leituras.flatMap(l => {
    if (l.meio === 'email') return l.emails ? [`${quantos(l.emails, 'e-mail', 'e-mails')} da ${l.nome}`] : [];
    return l.protocolos ? [`${quantos(l.protocolos, 'protocolo', 'protocolos')} da ${l.nome}`] : [];
  });
  return partes.length > 0 ? `li ${juntarComE(partes)}` : null;
}

export interface EntradaDoRecado {
  agora: number;
  desde: number;
  /** null = a contagem falhou (a tela não pode dizer "não li nada") */
  leituras: LeituraDaConta[] | null;
  fizSozinha: number;
  /** a fila de todos */
  separei: number;
  paraAgora: number;
  semDono: number;
}

export interface RecadoDoDia {
  /** "Segunda, 9/11, 08:15" */
  data: string;
  /** o recado inteiro (coluna da esquerda, menu do celular, painel do Diário) */
  texto: string;
  /** a linha do celular */
  curto: string;
}

export function recadoDoDia(e: EntradaDoRecado): RecadoDoDia {
  const oi = saudacaoDaHora(e.agora);
  const desde = rotuloDoDesde(e.desde, e.agora);
  const lido = e.leituras === null
    ? `${desde}, não consegui contar o que li.`
    : `${desde} ${fraseDasLeituras(e.leituras) ?? 'não li nada novo'}.`;
  const sozinha = e.fizSozinha > 0 ? ` Fiz ${quantos(e.fizSozinha, 'coisa', 'coisas')} sozinha.` : '';
  const semDono = e.semDono > 0 ? `; ${e.semDono === 1 ? '1 está' : `${e.semDono} estão`} sem dono` : '';
  const separei = e.separei > 0
    ? ` Separei ${quantos(e.separei, 'coisa', 'coisas')} para vocês${semDono}.`
    : ' Não separei nada para vocês.';
  return {
    data: `${maiuscula(diaDaSemana(e.agora))}, ${diaEMes(e.agora)}, ${horaEMinuto(e.agora)}`,
    texto: `${oi}. ${lido}${sozinha}${separei}`,
    curto: e.separei > 0
      ? `${oi}. Separei ${quantos(e.separei, 'coisa', 'coisas')}; ${e.paraAgora} para agora.`
      : `${oi}. Nada para decidir agora.`,
  };
}

export interface FeitoSozinha { quando: string; texto: string; projectId: string | null }

function textoDoFeito(e: RegistroLudmilla): string {
  const projeto = e.projeto ?? 'projeto';
  if (e.acao === 'anexo') {
    const arquivo = (e.detalhe ?? '').split(' · ')[0]?.trim();
    return arquivo ? `Anexei ${arquivo} ao ${projeto}.` : `Anexei um documento da concessionária ao ${projeto}.`;
  }
  return e.detalhe
    ? `Pus o parecer da concessionária no card do ${projeto} (${e.detalhe}).`
    : `Pus o parecer da concessionária no card do ${projeto}.`;
}

/** Decisão 7: o que ela já faz sozinha hoje — anexo conferido no card e parecer no card. Sem Desfazer. */
export function fezSozinha(registro: RegistroLudmilla[], desde: number): FeitoSozinha[] {
  return registro
    .filter(e => e.ator === 'ludmilla'
      && ((e.acao === 'anexo' && e.situacao === 'ok') || e.acao === 'parecer')
      && Date.parse(e.quando) >= desde)
    .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando))
    .map(e => ({ quando: e.quando, projectId: e.project_id, texto: textoDoFeito(e) }));
}

/** O que a frase precisa de uma linha de `ludmilla_registro` ou de `ludmilla_linha_do_tempo`. */
export type EventoParaFrase = Pick<RegistroLudmilla, 'ator' | 'quem' | 'titulo' | 'detalhe' | 'situacao' | 'projeto'> & { acao: string };

/** Os títulos de `ludmilla_registro` (migração 20261026120000) na voz dela. Mudou o título lá, mude aqui. */
const NA_VOZ_DELA: [string, string][] = [
  ['Varredura no portal ', 'Li o portal '],
  ['Leitura dos e-mails da ', 'Li os e-mails da '],
  ['Cobrança à ', 'Mandei a cobrança à '],
  ['Criação de projeto no portal ', 'Criei um projeto no portal '],
  ['Teste de acesso ao portal ', 'Testei o acesso ao portal '],
  ['Descoberta das telas do portal ', 'Conheci as telas do portal '],
  ['Mudança no portal: ', 'Vi uma mudança: '],
  ['E-mail lido: ', 'Li o e-mail: '],
  ['Anexo da concessionária no card', 'Anexei o documento da concessionária no card'],
  ['Anexo bloqueado (titular/UC não conferem)', 'Não anexei um documento: o titular ou a UC não conferem'],
  ['Anexo falhou', 'Não consegui anexar um documento'],
  ['Anexo pendente', 'Deixei um documento para anexar depois'],
  ['Parecer da concessionária no card', 'Pus o parecer da concessionária no card'],
  ['Pediu o código da imagem', 'Pedi o código da imagem'],
  ['Tarefa encerrada: ', 'Encerrei a tarefa: '],
];

const DA_EQUIPE: Record<string, string> = {
  aplicada: 'aplicou a recomendação',
  ignorada: 'ignorou a recomendação',
  captcha_respondido: 'digitou o código da imagem',
  afazer_feito: 'marcou como feito',
};

export function fraseDoRegistro(e: EventoParaFrase): string {
  const doProjeto = e.projeto && !e.titulo.includes(e.projeto) ? ` (${e.projeto})` : '';
  if (e.ator === 'equipe') {
    const quem = e.quem?.trim() || 'Alguém da equipe';
    if (e.acao === 'tarefa_encerrada') return `${quem} encerrou a tarefa: ${e.titulo.replace(/^Tarefa encerrada:\s*/, '')}${doProjeto}`;
    const verbo = DA_EQUIPE[e.acao];
    return verbo ? `${quem} ${verbo}${doProjeto}` : `${quem}: ${e.titulo}${doProjeto}`;
  }
  if (e.acao === 'visita' && e.situacao === 'erro') return `Não consegui: ${e.titulo}${doProjeto}`;
  const troca = NA_VOZ_DELA.find(([de]) => e.titulo.startsWith(de));
  return `${troca ? troca[1] + e.titulo.slice(troca[0].length) : e.titulo}${doProjeto}`;
}

export interface LinhaDoDiario {
  chave: string;
  hora: string;
  deLa: boolean;
  quem: string;
  texto: string;
  detalhe: string | null;
  erro: boolean;
}
export interface DiaDoDiario { rotulo: string; itens: LinhaDoDiario[] }

/** "Hoje, segunda 9/11" · "Ontem, domingo 8/11" · "Sexta, 6/11". */
export function rotuloDoDia(ms: number, agora: number): string {
  const d = diaEmBrasilia(agora) - diaEmBrasilia(ms);
  if (d === 0) return `Hoje, ${diaDaSemana(ms)} ${diaEMes(ms)}`;
  if (d === 1) return `Ontem, ${diaDaSemana(ms)} ${diaEMes(ms)}`;
  return `${maiuscula(diaDaSemana(ms))}, ${diaEMes(ms)}`;
}

/** O registro por dia de Brasília, o mais novo primeiro (spec §4.3, "Diário"). */
export function diarioPorDia(registro: RegistroLudmilla[], agora: number): DiaDoDiario[] {
  const dias: DiaDoDiario[] = [];
  let diaAtual: number | null = null;
  const ordenado = registro
    .filter(e => Number.isFinite(Date.parse(e.quando)))
    .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
  ordenado.forEach((e, i) => {
    const ms = Date.parse(e.quando);
    const dia = diaEmBrasilia(ms);
    if (dia !== diaAtual) {
      dias.push({ rotulo: rotuloDoDia(ms, agora), itens: [] });
      diaAtual = dia;
    }
    dias[dias.length - 1].itens.push({
      chave: `${e.quando}-${i}`,
      hora: horaEMinuto(ms),
      deLa: e.ator === 'ludmilla',
      quem: e.ator === 'ludmilla' ? 'Ludmilla' : (e.quem?.trim() || 'Equipe'),
      texto: fraseDoRegistro(e),
      detalhe: e.detalhe?.trim() || null,
      erro: e.situacao === 'erro',
    });
  });
  return dias;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/ludmillaRecado.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 6: Commit**

`$RASCUNHO/msg-e2-t4.txt` (Write):

```
feat(ludmilla): recado do dia, Diário e Fiz sozinha em primeira pessoa (entrega 2, página)

O recado montado dos números (spec 4.2), com o "desde" guardado por
usuário no localStorage (try/catch) e, sem ele, a última leitura do dia
útil anterior; o registro por dia na voz dela; e o que ela já faz
sozinha hoje (anexo conferido e parecer no card).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaRecado.ts src/lib/ludmillaRecado.test.ts
git commit -F "$RASCUNHO/msg-e2-t4.txt" -- src/lib/ludmillaRecado.ts src/lib/ludmillaRecado.test.ts
git show --stat HEAD
```

---

### Task 5: Leituras, próxima leitura e o modo da tela (lógica pura)

**Files:**
- Create: `src/lib/ludmillaLeituras.ts`
- Create: `src/components/ludmilla/pagina/modo.ts`
- Test: `src/lib/ludmillaLeituras.test.ts`, `src/components/ludmilla/pagina/modo.test.ts`

**Interfaces:**
- Consumes: `PortalAccount` (tipo, `src/hooks/useLudmilla.ts`); `saudeDaConta`, `EstadoDaEstacao` (`src/lib/ludmillaPainel.ts`); `palavraDaSaude` (`src/components/ludmilla/topo/saude.ts`, puro); `LeituraDaConta` (Task 4); `DIA_MS`, `HORA_MS`, `diaDaSemana`, `diaEMes`, `diaEmBrasilia`, `emBrasilia`, `horaEMinuto`, `inicioDoDia` (Task 1); `LARGURA_MOBILE` (`src/mobile/breakpoints.ts`).
- Produces (`ludmillaLeituras.ts`): `LinhaDeLeitura {id; nome; texto; alerta}`, `linhasDeLeitura(contas, {nomeDaConta; estacaoDe; caixaPronta; captchas; agora}): LinhaDeLeitura[]`, `HORAS_DO_PORTAL`, `HORAS_DO_EMAIL`, `ProximaLeitura {nome; quando}`, `proximaLeitura(contas, nomeDaConta, agora): ProximaLeitura | null`, `fraseDaProximaLeitura(p, agora): string | null`, `textoDaListaVazia(proxima: string | null): string`, `RunDeLeitura {account_id; protocolos_lidos}`, `SomaDeLeituras {protocolos; emails}`, `somarLeituras(runs, emails)`, `leiturasDasContas(contas, nomeDaConta, soma): LeituraDaConta[]`.
- Produces (`modo.ts`): `LARGURA_DUAS_COLUNAS = 960`, `LARGURA_TRES_COLUNAS = 1280`, `ModoDaPagina = 'tres' | 'duas' | 'uma'`, `modoDaPagina(largura)`.

- [ ] **Step 1: Escrever os testes**

Crie `src/lib/ludmillaLeituras.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PortalAccount } from '@/hooks/useLudmilla';
import { AGORA, CONTAS_DE_EXEMPLO, CONTA_CPFL, CONTA_ENEL, nomeDaContaDeExemplo } from './ludmillaCaixa.fixtures';
import {
  fraseDaProximaLeitura, leiturasDasContas, linhasDeLeitura, proximaLeitura, somarLeituras, textoDaListaVazia,
} from './ludmillaLeituras';

// AGORA (fixtures) = quinta, 22/10/2026, 09:00 de Brasília
const estacaoDe = (c: PortalAccount) => (c.modo === 'local' ? { online: true, texto: 'estação online' } : null);
const opcoes = { nomeDaConta: nomeDaContaDeExemplo, estacaoDe, caixaPronta: true, captchas: [], agora: AGORA };

describe('linhasDeLeitura (coluna da esquerda)', () => {
  it('a hora quando leu hoje; a palavra da saúde quando pede alguém; pelo nome', () => {
    expect(linhasDeLeitura(CONTAS_DE_EXEMPLO, opcoes)).toEqual([
      { id: 'conta-cpfl', nome: 'CPFL Paulista', texto: '08:00', alerta: false },
      { id: 'conta-edp', nome: 'EDP São Paulo', texto: 'nunca lida', alerta: true },
      { id: 'conta-elektro', nome: 'Elektro', texto: 'sessão expirada', alerta: true },
      { id: 'conta-enel', nome: 'ENEL SP', texto: '07:30', alerta: false },
    ]);
  });

  it('CAPTCHA aguardando: "espera o código"', () => {
    const l = linhasDeLeitura(CONTAS_DE_EXEMPLO, { ...opcoes, captchas: [{ account_id: 'conta-elektro' }] });
    expect(l.find(x => x.id === 'conta-elektro')).toEqual({ id: 'conta-elektro', nome: 'Elektro', texto: 'espera o código', alerta: true });
  });

  it('lida em outro dia: a data', () => {
    const ontem = { ...CONTA_CPFL, ultima_varredura_em: '2026-10-21T20:00:00Z' };
    expect(linhasDeLeitura([ontem], opcoes)[0]).toMatchObject({ texto: '21/10', alerta: false });
  });
});

describe('a próxima leitura (decisão 18)', () => {
  it('ENEL de hora em hora no expediente; portal às 8h e 17h; EDP só a pedido', () => {
    const p = proximaLeitura(CONTAS_DE_EXEMPLO, nomeDaContaDeExemplo, AGORA);
    expect(p).toEqual({ nome: 'ENEL SP', quando: Date.parse('2026-10-22T13:00:00Z') });
    expect(fraseDaProximaLeitura(p, AGORA)).toBe('A próxima leitura da ENEL SP é às 10:00.');
  });

  it('depois das 18h: amanhã; empate pelo nome', () => {
    const noite = Date.parse('2026-10-22T21:30:00Z');
    const p = proximaLeitura(CONTAS_DE_EXEMPLO, nomeDaContaDeExemplo, noite);
    expect(p).toEqual({ nome: 'CPFL Paulista', quando: Date.parse('2026-10-23T11:00:00Z') });
    expect(fraseDaProximaLeitura(p, noite)).toBe('A próxima leitura da CPFL Paulista é amanhã às 08:00.');
  });

  it('e-mail não lê no fim de semana', () => {
    const sextaNoite = Date.parse('2026-10-23T21:30:00Z');
    const p = proximaLeitura([CONTA_ENEL], nomeDaContaDeExemplo, sextaNoite);
    expect(fraseDaProximaLeitura(p, sextaNoite)).toBe('A próxima leitura da ENEL SP é segunda às 08:00.');
  });

  it('conta desligada não conta; sem nenhuma, sem frase', () => {
    expect(proximaLeitura([{ ...CONTA_ENEL, enabled: false }], nomeDaContaDeExemplo, AGORA)).toBeNull();
    expect(fraseDaProximaLeitura(null, AGORA)).toBeNull();
  });

  it('o texto da lista vazia (spec §4.6)', () => {
    expect(textoDaListaVazia('A próxima leitura da ENEL SP é às 10:00.'))
      .toBe('A próxima leitura da ENEL SP é às 10:00. Se chegar algo, eu coloco aqui e aviso no sino.');
    expect(textoDaListaVazia(null)).toBe('Se chegar algo, eu coloco aqui e aviso no sino.');
  });
});

describe('somarLeituras e leiturasDasContas (decisão 7)', () => {
  it('portal: o maior número de protocolos; e-mail: o que veio contado', () => {
    const soma = somarLeituras([
      { account_id: 'conta-cpfl', protocolos_lidos: 199 },
      { account_id: 'conta-cpfl', protocolos_lidos: 198 },
      { account_id: 'conta-elektro', protocolos_lidos: null },
    ], { 'conta-enel': 38, 'conta-edp': 0 });
    expect(soma).toEqual({ protocolos: { 'conta-cpfl': 199 }, emails: { 'conta-enel': 38, 'conta-edp': 0 } });
    expect(leiturasDasContas(CONTAS_DE_EXEMPLO, nomeDaContaDeExemplo, soma)).toEqual([
      { nome: 'CPFL Paulista', meio: 'portal', emails: null, protocolos: 199 },
      { nome: 'EDP São Paulo', meio: 'email', emails: 0, protocolos: null },
      { nome: 'Elektro', meio: 'portal', emails: null, protocolos: 0 },
      { nome: 'ENEL SP', meio: 'email', emails: 38, protocolos: null },
    ]);
  });
});
```

Crie `src/components/ludmilla/pagina/modo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LARGURA_DUAS_COLUNAS, LARGURA_TRES_COLUNAS, modoDaPagina } from './modo';

describe('modoDaPagina (decisão 14)', () => {
  it('uma coluna no celular e no tablet estreito, duas a partir de 960, três a partir de 1280', () => {
    expect(modoDaPagina(390)).toBe('uma');
    expect(modoDaPagina(639)).toBe('uma');
    // de 640 a 959 o menu do GD (256 px) já aparece: a lista não caberia ao lado da coluna da esquerda
    expect(modoDaPagina(640)).toBe('uma');
    expect(modoDaPagina(959)).toBe('uma');
    expect(modoDaPagina(960)).toBe('duas');
    expect(LARGURA_DUAS_COLUNAS).toBe(960);
    expect(modoDaPagina(LARGURA_TRES_COLUNAS - 1)).toBe('duas');
    expect(modoDaPagina(1280)).toBe('tres');
    expect(modoDaPagina(1440)).toBe('tres');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/ludmillaLeituras.test.ts src/components/ludmilla/pagina/modo.test.ts`
Expected: FAIL — `Failed to resolve import "./ludmillaLeituras"` e `"./modo"`.

- [ ] **Step 3: Escrever `src/lib/ludmillaLeituras.ts`**

```ts
/**
 * AS LEITURAS DA LUDMILLA — funções puras, sem React.
 *
 * Spec §4.2 ("Leituras: uma linha por concessionária acompanhada"), §4.6 (a lista vazia diz quando
 * é a próxima leitura) e o recado (quanto ela leu desde a última visita — decisão 7 do plano).
 */
import type { PortalAccount } from '@/hooks/useLudmilla';
import { saudeDaConta, type EstadoDaEstacao } from '@/lib/ludmillaPainel';
import { palavraDaSaude } from '@/components/ludmilla/topo/saude';
import type { LeituraDaConta } from '@/lib/ludmillaRecado';
import {
  DIA_MS, HORA_MS, diaDaSemana, diaEMes, diaEmBrasilia, emBrasilia, horaEMinuto, inicioDoDia,
} from '@/lib/ludmillaTempo';

export interface LinhaDeLeitura { id: string; nome: string; texto: string; alerta: boolean }

/** Decisão 17: a hora (ou a data) da última leitura; "espera o código"; senão a palavra da saúde. */
export function linhasDeLeitura(contas: PortalAccount[], o: {
  nomeDaConta: (id: string) => string;
  estacaoDe: (c: PortalAccount) => EstadoDaEstacao | null;
  caixaPronta: boolean | null;
  captchas: { account_id: string }[];
  agora: number;
}): LinhaDeLeitura[] {
  const esperando = new Set(o.captchas.map(c => c.account_id));
  return contas
    .map((c): LinhaDeLeitura => {
      const nome = o.nomeDaConta(c.id) || c.connector.toUpperCase();
      if (esperando.has(c.id)) return { id: c.id, nome, texto: 'espera o código', alerta: true };
      const saude = saudeDaConta(c, { estacao: o.estacaoDe(c), caixaPronta: o.caixaPronta, agora: o.agora });
      if (saude.tom === 'ok' && c.ultima_varredura_em) {
        const t = Date.parse(c.ultima_varredura_em);
        return { id: c.id, nome, texto: diaEmBrasilia(t) === diaEmBrasilia(o.agora) ? horaEMinuto(t) : diaEMes(t), alerta: false };
      }
      return { id: c.id, nome, texto: palavraDaSaude(saude) ?? 'nunca lida', alerta: true };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Os horários dela, em hora de Brasília (decisão 18). Portal: crons `ludmilla-08h` e `ludmilla-17h`,
 * todo dia. E-mail pelos remetentes (ENEL): cron `ludmilla-enel-email`, de hora em hora das 8h às 18h,
 * seg–sex. E-mail pelo protocolo no assunto (EDP): só pelo "Ler agora". Mudou um cron, mude aqui.
 */
export const HORAS_DO_PORTAL: readonly number[] = [8, 17];
export const HORAS_DO_EMAIL: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export interface ProximaLeitura { nome: string; quando: number }

function proximaDaConta(c: PortalAccount, agora: number): number | null {
  // o agendador (`ludmilla_agendar_varreduras`) só enfileira conta de portal com login guardado
  const horas = c.acompanhamento === 'portal' ? (c.login ? HORAS_DO_PORTAL : null)
    : c.identificacao === 'remetente' ? HORAS_DO_EMAIL
    : null;
  if (!horas) return null;
  const soDiaUtil = c.acompanhamento === 'email';
  for (let d = 0; d < 8; d++) {
    const dia = inicioDoDia(agora) + d * DIA_MS;
    const semana = emBrasilia(dia).getUTCDay();
    if (soDiaUtil && (semana === 0 || semana === 6)) continue;
    for (const h of horas) {
      const t = dia + h * HORA_MS;
      if (t > agora) return t;
    }
  }
  return null;
}

export function proximaLeitura(contas: PortalAccount[], nomeDaConta: (id: string) => string, agora: number): ProximaLeitura | null {
  let melhor: ProximaLeitura | null = null;
  for (const c of contas) {
    if (!c.enabled) continue;
    const quando = proximaDaConta(c, agora);
    if (quando === null) continue;
    const nome = nomeDaConta(c.id) || c.connector.toUpperCase();
    if (!melhor || quando < melhor.quando || (quando === melhor.quando && nome.localeCompare(melhor.nome, 'pt-BR') < 0)) {
      melhor = { nome, quando };
    }
  }
  return melhor;
}

export function fraseDaProximaLeitura(p: ProximaLeitura | null, agora: number): string | null {
  if (!p) return null;
  const dias = diaEmBrasilia(p.quando) - diaEmBrasilia(agora);
  const hora = horaEMinuto(p.quando);
  const quando = dias === 0 ? `às ${hora}` : dias === 1 ? `amanhã às ${hora}` : `${diaDaSemana(p.quando)} às ${hora}`;
  return `A próxima leitura da ${p.nome} é ${quando}.`;
}

/** Spec §4.6: "Nada aqui agora. A próxima leitura da ENEL é às 09:00. Se chegar algo, …" (o título vem à parte). */
export function textoDaListaVazia(proxima: string | null): string {
  return `${proxima ? `${proxima} ` : ''}Se chegar algo, eu coloco aqui e aviso no sino.`;
}

export interface RunDeLeitura { account_id: string; protocolos_lidos: number | null }
export interface SomaDeLeituras { protocolos: Record<string, number>; emails: Record<string, number> }

/**
 * Portal: o MAIOR número de protocolos de uma varredura desde então (as duas varreduras do dia leem
 * os mesmos protocolos; somar dobraria). E-mail: quantos e-mails ela registrou, já contados.
 */
export function somarLeituras(runs: RunDeLeitura[], emails: Record<string, number>): SomaDeLeituras {
  const protocolos: Record<string, number> = {};
  for (const r of runs) {
    const n = Number(r.protocolos_lidos ?? 0);
    if (Number.isFinite(n) && n > (protocolos[r.account_id] ?? 0)) protocolos[r.account_id] = n;
  }
  return { protocolos, emails: { ...emails } };
}

export function leiturasDasContas(contas: PortalAccount[], nomeDaConta: (id: string) => string, soma: SomaDeLeituras): LeituraDaConta[] {
  return contas
    .filter(c => c.enabled)
    .map((c): LeituraDaConta => ({
      nome: nomeDaConta(c.id) || c.connector.toUpperCase(),
      meio: c.acompanhamento === 'email' ? 'email' : 'portal',
      emails: c.acompanhamento === 'email' ? soma.emails[c.id] ?? 0 : null,
      protocolos: c.acompanhamento === 'email' ? null : soma.protocolos[c.id] ?? 0,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
```

- [ ] **Step 4: Escrever `src/components/ludmilla/pagina/modo.ts`**

```ts
/**
 * A partir daqui as três colunas cabem ao lado do menu do GD (256 px): 1280 − 256 = 1024 px para
 * 260 (esquerda) + lista + 360 (detalhe). Abaixo, a coluna da esquerda e a lista, com o detalhe numa
 * folha; no celular, uma coluna por vez (spec §5). Decisão 14 do plano.
 */
export const LARGURA_TRES_COLUNAS = 1280;

/**
 * O menu do GD (256 px) aparece a partir de 640 px (`LARGURA_MOBILE`); a esquerda + lista só cabem
 * com folga daqui para cima: 960 − 256 − 48 (respiro do MainLayout) − 260 (esquerda) ≈ 396 px de lista.
 * Abaixo, a mesma tela de uma coluna do celular.
 */
export const LARGURA_DUAS_COLUNAS = 960;

export type ModoDaPagina = 'tres' | 'duas' | 'uma';

export function modoDaPagina(largura: number): ModoDaPagina {
  if (largura < LARGURA_DUAS_COLUNAS) return 'uma';
  return largura < LARGURA_TRES_COLUNAS ? 'duas' : 'tres';
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/ludmillaLeituras.test.ts src/components/ludmilla/pagina/modo.test.ts`
Expected: PASS.

- [ ] **Step 6: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 7: Commit**

`$RASCUNHO/msg-e2-t5.txt` (Write):

```
feat(ludmilla): leituras, próxima leitura e modo da tela (entrega 2, página)

Uma linha por conta na coluna da esquerda (hora, "espera o código" ou a
palavra da saúde), a próxima leitura pelos crons de hoje para a lista
vazia, a soma do que ela leu desde a última visita e o modo de três,
duas ou uma coluna pela largura.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaLeituras.ts src/lib/ludmillaLeituras.test.ts src/components/ludmilla/pagina/modo.ts src/components/ludmilla/pagina/modo.test.ts
git commit -F "$RASCUNHO/msg-e2-t5.txt" -- src/lib/ludmillaLeituras.ts src/lib/ludmillaLeituras.test.ts src/components/ludmilla/pagina/modo.ts src/components/ludmilla/pagina/modo.test.ts
git show --stat HEAD
```

---

### Task 6: Os dados da página (hooks)

**Files:**
- Create: `src/hooks/useLudmillaPagina.ts`
- Modify: `src/hooks/useLudmillaDecidir.ts` (função `useAcoesDaCaixa`, bloco `atualizarDetalhe`, linhas ~137–141)
- Modify: `src/hooks/useLudmillaDecidir.test.ts` (linhas 47–48, 67–68, 80–81) e `src/hooks/useLudmillaDecidir.cobranca.test.ts` (linhas 28 e 41): eles CONTAM as invalidações e passam a esperar a nova

**Interfaces:**
- Consumes: `useLudmillaDisponivel`, `PortalAccount` (`src/hooks/useLudmilla.ts`); `linhaDaRpc`, `normalDaRpc`, `LinhaDaCarteira`, `NormalDaEtapa` (Task 1); `somarLeituras`, `RunDeLeitura`, `SomaDeLeituras` (Task 5); `desdeDoRecado`, `lerVisita`, `gravarVisita` (Task 4).
- Produces: `useCarteiraDaLudmilla(): UseQueryResult<LinhaDaCarteira[]>` (chave `['ludmilla-carteira']`), `useNormaisDaLudmilla(): UseQueryResult<NormalDaEtapa[]>` (chave `['ludmilla-normais']`), `useLeiturasDesde(desde: number, contas: PortalAccount[]): UseQueryResult<SomaDeLeituras>`, `useDesdeDoRecado(userId: string | undefined): number`. Decidir na caixa passa a invalidar `['ludmilla-carteira']`.

Sem teste unitário: a casa não testa hooks com Supabase (vitest em `node`); a lógica deles está nas funções puras das Tasks 1, 4 e 5. A prova é o tsc, o build e, na Task 14, a página.

- [ ] **Step 1: Medir o baseline**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Escrever `src/hooks/useLudmillaPagina.ts`**

```ts
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLudmillaDisponivel, type PortalAccount } from '@/hooks/useLudmilla';
import { linhaDaRpc, normalDaRpc, type LinhaDaCarteira, type NormalDaEtapa } from '@/lib/ludmillaCarteira';
import { somarLeituras, type RunDeLeitura, type SomaDeLeituras } from '@/lib/ludmillaLeituras';
import { desdeDoRecado, gravarVisita, lerVisita } from '@/lib/ludmillaRecado';

/**
 * O QUE A PÁGINA NOVA DA LUDMILLA LÊ ALÉM DO QUE JÁ LIA (spec 2026-11-08, entrega 2).
 * As RPCs da entrega 1 (`ludmilla_carteira`, `ludmilla_normais`) e as contagens do recado. Nada
 * aqui grava no banco; tudo passa pela RLS de quem lê. As RPCs não estão nos tipos gerados:
 * `as never`, como o resto da Ludmilla.
 */

/** Os projetos ativos com tempo na etapa, normal, com quem está, donos e histórico. */
export function useCarteiraDaLudmilla() {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['ludmilla-carteira'],
    queryFn: async (): Promise<LinhaDaCarteira[]> => {
      const { data, error } = await supabase.rpc('ludmilla_carteira' as never, {} as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(linhaDaRpc);
    },
    enabled: disponivel,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** O normal de cada concessionária × etapa (muda devagar: meia hora basta). */
export function useNormaisDaLudmilla() {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['ludmilla-normais'],
    queryFn: async (): Promise<NormalDaEtapa[]> => {
      const { data, error } = await supabase.rpc('ludmilla_normais' as never, {} as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(normalDaRpc);
    },
    enabled: disponivel,
    staleTime: 30 * 60_000,
  });
}

/**
 * O que ela leu desde `desde` (decisão 7): as varreduras de portal `ok` (o maior número de protocolos)
 * e quantos e-mails cada conta de e-mail registrou. Uma consulta de contagem por conta de e-mail.
 */
export function useLeiturasDesde(desde: number, contas: PortalAccount[]) {
  const disponivel = useLudmillaDisponivel();
  const comEmail = contas.filter(c => c.acompanhamento === 'email').map(c => c.id).sort();
  const desdeIso = new Date(desde).toISOString();
  return useQuery({
    queryKey: ['ludmilla-leituras-desde', desdeIso, comEmail],
    queryFn: async (): Promise<SomaDeLeituras> => {
      const [runs, ...contagens] = await Promise.all([
        supabase.from('portal_sync_runs' as never).select('account_id, protocolos_lidos')
          .eq('tipo', 'varredura').eq('situacao', 'ok').gte('terminado_em', desdeIso).limit(500),
        ...comEmail.map(id => supabase.from('portal_email_mensagens' as never)
          .select('id', { count: 'exact', head: true }).eq('account_id', id).gte('created_at', desdeIso)),
      ]);
      if (runs.error) throw runs.error;
      const emails: Record<string, number> = {};
      contagens.forEach((r, i) => {
        if (r.error) throw r.error;
        emails[comEmail[i]] = r.count ?? 0;
      });
      return somarLeituras((runs.data ?? []) as unknown as RunDeLeitura[], emails);
    },
    enabled: disponivel && contas.length > 0,
    staleTime: 5 * 60_000,
  });
}

function armazemLocal(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * O "desde" do recado (decisão 6): lido UMA vez ao abrir a página (a última visita guardada) e a
 * visita de agora gravada logo em seguida. Enquanto a página fica aberta, o "desde" não muda.
 */
export function useDesdeDoRecado(userId: string | undefined): number {
  const [desde] = useState(() => desdeDoRecado(userId ? lerVisita(armazemLocal(), userId) : null, Date.now()));
  useEffect(() => {
    if (userId) gravarVisita(armazemLocal(), userId, new Date().toISOString());
  }, [userId]);
  return desde;
}
```

- [ ] **Step 3: Decidir também atualiza a carteira (teste vermelho primeiro)**

Os testes de hoje contam as invalidações de `atualizarDetalhe`; acrescente a nova chave neles ANTES do código.

Em `src/hooks/useLudmillaDecidir.test.ts`, nos TRÊS lugares (linhas 47–48, 67–68 e 80–81; use substituir-todas), troque:

```ts
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou', 'invalidou']);
    expect(chavesInvalidadas()).toEqual(['ludmilla-linha-do-tempo', 'projeto-do-detalhe', 'ludmilla-registro']);
```

por:

```ts
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou', 'invalidou', 'invalidou']);
    expect(chavesInvalidadas()).toEqual(['ludmilla-linha-do-tempo', 'projeto-do-detalhe', 'ludmilla-registro', 'ludmilla-carteira']);
```

Em `src/hooks/useLudmillaDecidir.cobranca.test.ts`, troque:

```ts
const DEPOIS_DE_DECIDIR = ['portal-afazeres', 'ludmilla-linha-do-tempo', 'projeto-do-detalhe', 'ludmilla-registro'];
```

por:

```ts
const DEPOIS_DE_DECIDIR = ['portal-afazeres', 'ludmilla-linha-do-tempo', 'projeto-do-detalhe', 'ludmilla-registro', 'ludmilla-carteira'];
```

e troque:

```ts
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou', 'invalidou', 'invalidou']);
```

por:

```ts
    expect(m.log).toEqual(['gravou', 'invalidou', 'invalidou', 'invalidou', 'invalidou', 'invalidou']);
```

Run: `npx vitest run src/hooks/useLudmillaDecidir.test.ts src/hooks/useLudmillaDecidir.cobranca.test.ts`
Expected: FAIL (5 casos: os três do primeiro arquivo e "enviar"/"dispensar" do segundo — falta `'ludmilla-carteira'`).

Agora o código. Em `src/hooks/useLudmillaDecidir.ts`, dentro de `useAcoesDaCaixa`, troque:

```ts
    const atualizarDetalhe = () => {
      void qc.invalidateQueries({ queryKey: ['ludmilla-linha-do-tempo'] });
      void qc.invalidateQueries({ queryKey: ['projeto-do-detalhe'] });
      void qc.invalidateQueries({ queryKey: ['ludmilla-registro'] });
    };
```

por:

```ts
    const atualizarDetalhe = () => {
      void qc.invalidateQueries({ queryKey: ['ludmilla-linha-do-tempo'] });
      void qc.invalidateQueries({ queryKey: ['projeto-do-detalhe'] });
      void qc.invalidateQueries({ queryKey: ['ludmilla-registro'] });
      // a decisão muda etapa, "com quem está" e "na fila" da carteira (página nova, entrega 2)
      void qc.invalidateQueries({ queryKey: ['ludmilla-carteira'] });
    };
```

- [ ] **Step 4: Rodar os testes que já protegem `useLudmillaDecidir`**

Run: `npx vitest run src/hooks/useLudmillaDecidir.test.ts src/hooks/useLudmillaDecidir.cobranca.test.ts`
Expected: PASS (agora com a 4ª invalidação, `'ludmilla-carteira'`, no fim).

- [ ] **Step 5: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Se subir, o mais provável é a tipagem do `Promise.all` com o PostgREST: troque o destructuring por `const respostas = await Promise.all([...]); const runs = respostas[0]; const contagens = respostas.slice(1);` e rode de novo. Run: `npm run build` → sem erro.

- [ ] **Step 6: Commit**

`$RASCUNHO/msg-e2-t6.txt` (Write):

```
feat(ludmilla): dados da página nova — carteira, normais, leituras (entrega 2, página)

Hooks sobre ludmilla_carteira() e ludmilla_normais() (entrega 1), a
contagem do que ela leu desde a última visita e o "desde" guardado por
usuário. Decidir na caixa passa a atualizar a carteira também.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/hooks/useLudmillaPagina.ts src/hooks/useLudmillaDecidir.ts src/hooks/useLudmillaDecidir.test.ts src/hooks/useLudmillaDecidir.cobranca.test.ts
git commit -F "$RASCUNHO/msg-e2-t6.txt" -- src/hooks/useLudmillaPagina.ts src/hooks/useLudmillaDecidir.ts src/hooks/useLudmillaDecidir.test.ts src/hooks/useLudmillaDecidir.cobranca.test.ts
git show --stat HEAD
```

---

### Task 7: O mundo "Conta de luz" — tokens, fonte, avatar, peças e barras

**Files:**
- Modify: `tailwind.config.ts` (bloco `extend.fontFamily` e `extend.colors`)
- Modify: `src/index.css` (acrescentar no fim)
- Create: `src/components/ludmilla/mundo/cores.ts`
- Create: `src/components/ludmilla/mundo/useFonteDaLudmilla.ts`
- Create: `src/components/ludmilla/mundo/AvatarDaLudmilla.tsx`
- Create: `src/components/ludmilla/mundo/pecas.tsx`
- Create: `src/components/ludmilla/mundo/HistoricoEmBarras.tsx`
- Test (harness, apagar antes do commit): `harness-ludmilla-mundo.html`, `src/harness-ludmilla-mundo.tsx`

**Interfaces:**
- Consumes: `Barra`, `TomDaBarra`, `descricaoDasBarras`, `barrasDoHistorico` (Task 2); `ComQuem`, `DonoDoProjeto`, `normaisDaConcessionaria`, `NormalDaEtapa` (Task 1); `primeiroNome`, `TomDoPrazo` (Task 3); `Button` (`@/components/ui/button`); `cn` (`@/lib/utils`).
- Produces: classes Tailwind `bg-lm-*`/`text-lm-*`/`border-lm-*` com as chaves `papel, petroleo, sol, sol-forte, sol-fundo, sol-texto, caixa, caixa-forte, alerta, alerta-texto, alerta-fundo, barra, suave, borda, linha, ok-fundo, ok-texto, azul-fundo, azul-texto, faixa-borda, faixa-suave`, e `font-lm`; a classe CSS `.ludmilla-mundo` (e `.lm-sobre-petroleo` para o foco branco); `MUNDO` (hex); `useFonteDaLudmilla(): void`; `AvatarDaLudmilla({ tamanho?: number; decorativo?: boolean })`; `TomDoChip = 'alerta' | 'sol' | 'caixa' | 'ok' | 'azul'`, `Chip({ tom, children })`, `Donos({ donos })`, `TOM_DO_PRAZO: Record<TomDoPrazo, TomDoChip>`, `TOM_DO_COM_QUEM: Record<ComQuem, TomDoChip>`, `Esqueleto({ linhas?, rotulo })`, `AvisoDeFalha({ oQue, detalhe?, buscando?, onTentar? })`; `HistoricoPequeno({ barras })`, `HistoricoGrande({ barras, resumo, alerta, concessionaria })`.

- [ ] **Step 1: Medir o baseline**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Escrever o harness (o teste de tela das barras)**

Crie `harness-ludmilla-mundo.html` (raiz do repositório):

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Harness — mundo da Ludmilla</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/harness-ludmilla-mundo.tsx"></script>
  </body>
</html>
```

Crie `src/harness-ludmilla-mundo.tsx`:

```tsx
// HARNESS DO MUNDO DA LUDMILLA — dados inventados, nenhuma rede além da fonte. APAGAR antes do commit.
import '@/index.css';
import { createRoot } from 'react-dom/client';
import { AvatarDaLudmilla } from '@/components/ludmilla/mundo/AvatarDaLudmilla';
import { HistoricoGrande, HistoricoPequeno } from '@/components/ludmilla/mundo/HistoricoEmBarras';
import { AvisoDeFalha, Chip, Donos, Esqueleto } from '@/components/ludmilla/mundo/pecas';
import { useFonteDaLudmilla } from '@/components/ludmilla/mundo/useFonteDaLudmilla';
import { barrasDoHistorico } from '@/lib/ludmillaBarras';
import type { NormalDaEtapa } from '@/lib/ludmillaCarteira';

const rotulo = (s: string) => ({
  pending: 'Projetos Recebidos', analysis: 'Em Análise', documentation: 'Documentação', approval: 'Aguardando Aprovação',
  approved: 'Aprovado', pendencia: 'Pendência', vistoria_solicitada: 'Vistoria Solicitada', aguardando_instalacao: 'Aguardando Instalação',
} as Record<string, string>)[s] ?? s;
const n = (etapa: string, normalDias: number): [string, NormalDaEtapa] =>
  [etapa, { concessionaireId: 'conc-enel', etapa, normalDias, amostra: 9, fonte: 'medido' }];
const NORMAIS = new Map([n('pending', 3), n('analysis', 2), n('documentation', 6), n('approved', 32)]);

const DENTRO = barrasDoHistorico({
  historico: [{ etapa: 'pending', dias: 2, atual: false }, { etapa: 'analysis', dias: 9, atual: false }, { etapa: 'documentation', dias: 4, atual: true }],
  status: 'documentation', diasNaEtapa: 4, ordem: [], normais: NORMAIS, rotuloEtapa: rotulo,
});
const ALEM = barrasDoHistorico({
  historico: [{ etapa: 'analysis', dias: 2, atual: false }, { etapa: 'documentation', dias: 8, atual: false }, { etapa: 'approved', dias: 41, atual: true }],
  status: 'approved', diasNaEtapa: 41.2, ordem: [], normais: NORMAIS, rotuloEtapa: rotulo,
});

function Harness() {
  useFonteDaLudmilla();
  return (
    <div className="ludmilla-mundo mx-auto flex max-w-xl flex-col gap-6 p-6">
      <div className="lm-sobre-petroleo flex items-center gap-3 bg-lm-petroleo p-3 text-white">
        <AvatarDaLudmilla tamanho={40} /><span className="text-lg font-extrabold">Ludmilla</span>
        <button type="button" className="ml-auto rounded-md border-[1.5px] border-lm-faixa-borda px-3 py-1.5 text-[13px] font-bold">Ajustes</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip tom="alerta">venceu há 2 dias</Chip><Chip tom="sol">chegou hoje</Chip><Chip tom="caixa">chegou há 3 dias</Chip>
        <Chip tom="ok">Faço sozinha</Chip><Chip tom="azul">Com a concessionária</Chip>
        <Donos donos={[{ id: 'a', nome: 'Ana Lima' }, { id: 'b', nome: 'Bruno Costa' }]} /><Donos donos={[]} />
      </div>
      <div className="flex items-end gap-6">
        <span data-caso="dentro"><HistoricoPequeno barras={DENTRO} /></span>
        <span data-caso="alem"><HistoricoPequeno barras={ALEM} /></span>
      </div>
      <div data-caso="grande-dentro"><HistoricoGrande barras={DENTRO} resumo="4 dias em Documentação, o normal na ENEL SP é até 6" alerta={false} concessionaria="ENEL SP" /></div>
      <div data-caso="grande-alem"><HistoricoGrande barras={ALEM} resumo="41 dias em Aprovado, o normal na ENEL SP é até 32" alerta concessionaria="ENEL SP" /></div>
      <Esqueleto linhas={2} rotulo="Carregando um exemplo" />
      <AvisoDeFalha oQue="a carteira" detalhe="erro de exemplo" onTentar={() => undefined} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
```

- [ ] **Step 3: Abrir o harness e ver falhar**

Run (em segundo plano): `npx vite --port 5181 --strictPort`
Abra `http://localhost:5181/harness-ludmilla-mundo.html` no navegador do Claude.
Expected: erro do Vite `Failed to resolve import "@/components/ludmilla/mundo/AvatarDaLudmilla"`.

- [ ] **Step 4: Os tokens no Tailwind**

Em `tailwind.config.ts`, troque:

```ts
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
```

por:

```ts
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // só a página da Ludmilla (spec 2026-11-08 §3); carregada por useFonteDaLudmilla
        lm: ['"Public Sans"', 'system-ui', 'sans-serif'],
      },
```

e, no mesmo arquivo, troque:

```ts
        kanban: {
          pending: "hsl(var(--kanban-pending))",
          analysis: "hsl(var(--kanban-analysis))",
          progress: "hsl(var(--kanban-progress))",
          approved: "hsl(var(--kanban-approved))",
          completed: "hsl(var(--kanban-completed))",
        },
```

por:

```ts
        kanban: {
          pending: "hsl(var(--kanban-pending))",
          analysis: "hsl(var(--kanban-analysis))",
          progress: "hsl(var(--kanban-progress))",
          approved: "hsl(var(--kanban-approved))",
          completed: "hsl(var(--kanban-completed))",
        },
        // O mundo "Conta de luz", SÓ da página /ludmilla (spec 2026-11-08 §3). Os mesmos hex de
        // src/components/ludmilla/mundo/cores.ts. Nenhum token do GD muda.
        lm: {
          papel: "#FFFFFF",
          petroleo: "#0F3D4C",
          sol: "#F2B705",
          "sol-forte": "#E0A800",
          "sol-fundo": "#FDF1C7",
          "sol-texto": "#5E4500",
          caixa: "#E7EEF0",
          "caixa-forte": "#D9E4E8",
          alerta: "#C2410C",
          // texto em alerta sobre a caixa: #C2410C dá 4,41:1 sobre #E7EEF0 (plano, decisão 1)
          "alerta-texto": "#8F2F09",
          "alerta-fundo": "#FBE6DC",
          barra: "#9FB8C0",
          suave: "#3E5F6A",
          borda: "#C9D6DA",
          linha: "#E1E9EC",
          "ok-fundo": "#E2F1E6",
          "ok-texto": "#1D5E34",
          "azul-fundo": "#DDEBF2",
          "azul-texto": "#0B4F6C",
          "faixa-borda": "#4F7C8A",
          "faixa-suave": "#CFE0E5",
        },
```

- [ ] **Step 5: A classe `.ludmilla-mundo` no CSS**

Acrescente no FIM de `src/index.css`:

```css
/* ── O mundo "Conta de luz" da página da Ludmilla (spec 2026-11-08 §3) ─────────────────────
   Só vale DENTRO de .ludmilla-mundo: os tokens do GD não mudam. As variáveis do shadcn são
   redefinidas aqui (HSL dos hex da spec) para que Button, Textarea, Select e os cartões
   reaproveitados (contas, regras de e-mail) entrem no mundo sem reescrever cada um.
   Petróleo #0F3D4C = 195 67% 18% · sol #F2B705 = 45 96% 48% · caixa #E7EEF0 = 193 23% 92%
   · texto secundário #3E5F6A = 195 26% 33% · borda #C9D6DA = 194 19% 82%. */
.ludmilla-mundo {
  --background: 0 0% 100%;
  --foreground: 195 67% 18%;
  --card: 0 0% 100%;
  --card-foreground: 195 67% 18%;
  --popover: 0 0% 100%;
  --popover-foreground: 195 67% 18%;
  --primary: 45 96% 48%;
  --primary-foreground: 195 67% 18%;
  --secondary: 193 23% 92%;
  --secondary-foreground: 195 67% 18%;
  --muted: 193 23% 92%;
  --muted-foreground: 195 26% 33%;
  --accent: 193 23% 92%;
  --accent-foreground: 195 67% 18%;
  --border: 194 19% 82%;
  --input: 194 19% 82%;
  --ring: 195 67% 18%;
  background: #ffffff;
  color: #0f3d4c;
  font-family: 'Public Sans', system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
}

/* Foco visível: petróleo sobre o papel (11,7:1); branco sobre a faixa petróleo (plano, decisão 2). */
.ludmilla-mundo :focus-visible {
  outline: 2px solid #0f3d4c;
  outline-offset: 2px;
}
.ludmilla-mundo .lm-sobre-petroleo :focus-visible {
  outline-color: #ffffff;
}
```

- [ ] **Step 6: Escrever `src/components/ludmilla/mundo/cores.ts`**

```ts
/**
 * Os hex do mundo "Conta de luz" (spec 2026-11-08 §3) para o que precisa de cor em `style` (o
 * gradiente da barra em alerta). Os mesmos da chave `lm` de tailwind.config.ts: mudou lá, mude aqui.
 */
export const MUNDO = {
  papel: '#FFFFFF',
  petroleo: '#0F3D4C',
  sol: '#F2B705',
  caixa: '#E7EEF0',
  alerta: '#C2410C',
  barra: '#9FB8C0',
  suave: '#3E5F6A',
} as const;
```

- [ ] **Step 7: Escrever `src/components/ludmilla/mundo/useFonteDaLudmilla.ts`**

```ts
import { useEffect } from 'react';

const ENDERECO = 'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700;800&display=swap';

/**
 * Carrega a Public Sans só quando a página da Ludmilla abre (spec §3): o resto do GD continua no
 * Inter, e quem nunca abre a Ludmilla não baixa a fonte. Uma vez por documento. O CSP (só relatório)
 * já libera fonts.googleapis.com e fonts.gstatic.com (workflow nginx-cache-headers.yml).
 */
export function useFonteDaLudmilla(): void {
  useEffect(() => {
    if (document.head.querySelector('link[data-fonte-da-ludmilla]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ENDERECO;
    link.dataset.fonteDaLudmilla = '';
    document.head.appendChild(link);
  }, []);
}
```

- [ ] **Step 8: Escrever `src/components/ludmilla/mundo/AvatarDaLudmilla.tsx`**

```tsx
/**
 * O avatar PROVISÓRIO da Ludmilla (o do mockup aprovado). A ilustração definitiva é a entrega 6
 * (spec §3): entra como arquivo do projeto, com o mesmo `aria-label`.
 */
export function AvatarDaLudmilla({ tamanho = 40, decorativo = false }: { tamanho?: number; decorativo?: boolean }) {
  return (
    <svg
      width={tamanho} height={tamanho} viewBox="0 0 56 56" className="shrink-0"
      {...(decorativo ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Ludmilla' })}
    >
      <circle cx="28" cy="28" r="28" fill="#F2B705" />
      <path d="M15 28c0-10 6-17 13-17s13 7 13 17c0 5-1 9-3 12H18c-2-3-3-7-3-12z" fill="#0F3D4C" />
      <path d="M9 56c2-10 9-15 19-15s17 5 19 15z" fill="#0F3D4C" />
      <rect x="24.5" y="33" width="7" height="9" rx="3" fill="#C98E6B" />
      <ellipse cx="28" cy="27.5" rx="8.6" ry="10.2" fill="#D9A07C" />
      <path d="M19 25c1.5-7 6.5-10.5 11.5-10.5 4.5 0 7.5 3 8.5 7-5.5 0-10.5-1.2-13.5-4.2-1.8 3.2-3.8 5.8-6.5 7.7z" fill="#0F3D4C" />
      <circle cx="24.7" cy="28.3" r="1.15" fill="#0F3D4C" />
      <circle cx="31.3" cy="28.3" r="1.15" fill="#0F3D4C" />
      <path d="M25.3 32.6c1.6 1.2 3.8 1.2 5.4 0" stroke="#0F3D4C" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 9: Escrever `src/components/ludmilla/mundo/pecas.tsx`**

```tsx
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ComQuem, DonoDoProjeto } from '@/lib/ludmillaCarteira';
import { primeiroNome, type TomDoPrazo } from '@/lib/ludmillaFila';

/** As peças pequenas do mundo "Conta de luz" (mockup: `.chip`, `.who`, o esqueleto e o aviso de falha). */

export type TomDoChip = 'alerta' | 'sol' | 'caixa' | 'ok' | 'azul';

/** Todas as combinações passam 4,5:1 (texto escuro sobre fundo claro). */
const COR_DO_CHIP: Record<TomDoChip, string> = {
  alerta: 'bg-lm-alerta-fundo text-lm-alerta-texto',
  sol: 'bg-lm-sol-fundo text-lm-sol-texto',
  caixa: 'bg-lm-caixa text-lm-petroleo',
  ok: 'bg-lm-ok-fundo text-lm-ok-texto',
  azul: 'bg-lm-azul-fundo text-lm-azul-texto',
};

export const TOM_DO_PRAZO: Record<TomDoPrazo, TomDoChip> = { alerta: 'alerta', sol: 'sol', caixa: 'caixa' };
export const TOM_DO_COM_QUEM: Record<ComQuem, TomDoChip> = { nos: 'sol', concessionaria: 'azul', cliente: 'caixa' };

export function Chip({ tom, children }: { tom: TomDoChip; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold', COR_DO_CHIP[tom])}>
      {children}
    </span>
  );
}

/** O responsável (spec §6.2): a inicial num círculo e o primeiro nome; sem nenhum, "Sem dono" em alerta. */
export function Donos({ donos }: { donos: DonoDoProjeto[] }) {
  if (donos.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-lm-alerta-texto">
        <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-lm-alerta text-[11px] text-white">!</span>
        Sem dono
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold">
      {donos.map(d => (
        <span key={d.id} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-lm-petroleo text-[11px] text-white">
            {primeiroNome(d.nome).charAt(0).toUpperCase()}
          </span>
          {primeiroNome(d.nome)}
        </span>
      ))}
    </span>
  );
}

/** O lugar do que ainda carrega (spec §4.6). Sem animação para quem pediu menos movimento. */
export function Esqueleto({ linhas = 3, rotulo }: { linhas?: number; rotulo: string }) {
  return (
    <div role="status" aria-label={rotulo} className="flex flex-col gap-3">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-lm-caixa motion-reduce:animate-none" />
      ))}
    </div>
  );
}

/** Uma fonte que não carregou: diz o quê, e o resto da página continua (spec §4.6). */
export function AvisoDeFalha({ oQue, detalhe, buscando, onTentar }: {
  oQue: string; detalhe?: string | null; buscando?: boolean; onTentar?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-lm-alerta bg-lm-alerta-fundo p-4 text-sm text-lm-alerta-texto">
      <AlertTriangle size={18} className="shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <b>Não consegui carregar {oQue}.</b> A consulta falhou: isto não quer dizer que não haja nada.
        {detalhe && <span className="mt-0.5 block break-words text-xs">{detalhe}</span>}
      </div>
      {onTentar && (
        <Button type="button" size="sm" variant="outline" className="gap-2" disabled={buscando} onClick={onTentar}>
          {buscando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} Tentar de novo
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Escrever `src/components/ludmilla/mundo/HistoricoEmBarras.tsx`**

```tsx
import { cn } from '@/lib/utils';
import { descricaoDasBarras, type Barra, type TomDaBarra } from '@/lib/ludmillaBarras';
import { MUNDO } from './cores';

/**
 * O HISTÓRICO EM BARRAS, o traço marcante do mundo (spec §3): pequeno no cartão e na linha da
 * carteira, grande no detalhe e na ficha. Só desenha o que `barrasDoHistorico` decidiu; o desenho é
 * `aria-hidden` e o leitor de tela ouve `descricaoDasBarras`.
 */

const COR: Record<TomDaBarra, string> = { passada: MUNDO.barra, atual: MUNDO.sol, alem: MUNDO.alerta, futura: MUNDO.caixa };

/** Na grande, a barra em alerta é sol até o traço e alerta acima dele (mockup "Mundo"). */
function fundoGrande(b: Barra): string {
  if (b.tom === 'alem' && b.cortePct !== null) {
    return `linear-gradient(to top, ${MUNDO.sol} 0 ${b.cortePct}%, ${MUNDO.alerta} ${b.cortePct}% 100%)`;
  }
  return COR[b.tom];
}

export function HistoricoPequeno({ barras }: { barras: Barra[] }) {
  return (
    <span aria-hidden className="flex h-9 shrink-0 items-end gap-[3px]" data-historico="pequeno">
      {barras.map(b => (
        <span
          key={b.etapa} data-barra={b.etapa} data-tom={b.tom} className="block w-[9px] rounded-t-sm"
          style={{ height: b.tom === 'futura' ? '6%' : `${Math.max(6, b.alturaPct)}%`, background: COR[b.tom] }}
        />
      ))}
    </span>
  );
}

export function HistoricoGrande({ barras, resumo, alerta, concessionaria }: {
  barras: Barra[];
  /** "14 dias em Troca, o normal na ENEL SP é até 7" */
  resumo: string;
  alerta: boolean;
  concessionaria: string | null;
}) {
  const colunas = { gridTemplateColumns: `repeat(${Math.max(1, barras.length)}, minmax(0, 1fr))` };
  return (
    <figure className="m-0 flex flex-col gap-1.5 rounded-lg border border-lm-borda px-3.5 py-3" data-historico="grande">
      <figcaption className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[13px]">
        <span className="font-bold">Histórico, em dias</span>
        <span className={cn('font-bold', alerta && 'text-lm-alerta')}>{resumo}</span>
      </figcaption>
      <div aria-hidden className="grid h-[120px] gap-2 border-b-2 border-lm-petroleo px-1" style={colunas}>
        {barras.map(b => {
          const altura = b.tom === 'futura' ? 3 : Math.max(4, b.alturaPct);
          return (
            <div key={b.etapa} className="relative h-full" data-barra={b.etapa} data-tom={b.tom}>
              <span
                className={cn('absolute inset-x-0 text-center text-xs font-bold',
                  b.tom === 'alem' && 'font-extrabold text-lm-alerta', b.tom === 'futura' && 'font-normal text-lm-suave')}
                style={{ bottom: `calc(${altura}% + 2px)` }}
              >
                {b.dias ?? '—'}
              </span>
              <span
                className="absolute bottom-0 left-1/2 block w-[26px] max-w-full -translate-x-1/2 rounded-t-sm"
                style={{ height: `${altura}%`, background: fundoGrande(b) }}
              />
              {b.normalPct !== null && (
                <span
                  data-traco
                  className="absolute left-1/2 block w-[38px] max-w-full -translate-x-1/2 border-t-2 border-lm-petroleo"
                  style={{ bottom: `${b.normalPct}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden className="grid gap-2 text-center text-[11px] font-semibold leading-tight text-lm-suave" style={colunas}>
        {barras.map(b => <span key={b.etapa} className="break-words">{b.rotulo}</span>)}
      </div>
      <p aria-hidden className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-lm-suave">
        <span><span className="mr-1 inline-block w-4 border-t-2 border-lm-petroleo align-middle" />normal{concessionaria ? ` na ${concessionaria}` : ''}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-lm-sol align-middle" />etapa atual</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-lm-alerta align-middle" />além do normal</span>
      </p>
      <p className="sr-only">{descricaoDasBarras(barras)}</p>
    </figure>
  );
}
```

- [ ] **Step 11: Conferir no navegador (1440 × 900)**

Recarregue `http://localhost:5181/harness-ludmilla-mundo.html` com a janela em 1440 × 900. Rode no console da página (ferramenta de JavaScript do navegador) e confira cada resultado:

```js
await document.fonts.ready;
({
  fonte: document.fonts.check('16px "Public Sans"'),                                   // true
  familia: getComputedStyle(document.querySelector('.ludmilla-mundo')).fontFamily,       // começa com "Public Sans"
  link: !!document.querySelector('link[data-fonte-da-ludmilla]'),                         // true
  tonsPequenoAlem: [...document.querySelectorAll('[data-caso="alem"] [data-barra]')].map(b => b.dataset.tom),
  // ["passada","passada","alem","futura","futura"]
  tracos: document.querySelectorAll('[data-caso="grande-alem"] [data-traco]').length,      // 3
  gradiente: getComputedStyle(document.querySelector('[data-caso="grande-alem"] [data-barra="approved"] span:nth-child(2)')).backgroundImage.includes('linear-gradient'), // true
  avatar: document.querySelector('svg[role="img"]')?.getAttribute('aria-label'),          // "Ludmilla"
  primarioNoMundo: getComputedStyle(document.querySelector('.ludmilla-mundo')).getPropertyValue('--primary').trim(), // "45 96% 48%"
})
```

Tire um print e compare com `Mundo.dc.html` (barras, traço, legenda, chips). Pressione Tab até o botão "Ajustes" e até "Tentar de novo": o contorno de foco aparece (branco sobre a faixa, petróleo sobre o papel).

- [ ] **Step 12: Apagar o harness, tsc e build**

Pare o Vite. Apague `harness-ludmilla-mundo.html` e `src/harness-ludmilla-mundo.tsx`.
Run: `git status --short | grep -i harness` → nenhuma linha.
Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 13: Commit**

`$RASCUNHO/msg-e2-t7.txt` (Write):

```
feat(ludmilla): o mundo "Conta de luz" — tokens, fonte, avatar e barras (entrega 2, página)

Cores lm-* e font-lm no Tailwind e a classe .ludmilla-mundo, que redefine
as variáveis do shadcn só dentro da página (nenhum token do GD muda); a
Public Sans carregada só ao abrir a Ludmilla; o avatar provisório; chip,
responsável, esqueleto e aviso de falha; e o histórico em barras pequeno
e grande. Foco petróleo (branco na faixa) e alerta #8F2F09 sobre a caixa
pelo contraste.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add tailwind.config.ts src/index.css src/components/ludmilla/mundo/cores.ts src/components/ludmilla/mundo/useFonteDaLudmilla.ts src/components/ludmilla/mundo/AvatarDaLudmilla.tsx src/components/ludmilla/mundo/pecas.tsx src/components/ludmilla/mundo/HistoricoEmBarras.tsx
git commit -F "$RASCUNHO/msg-e2-t7.txt" -- tailwind.config.ts src/index.css src/components/ludmilla/mundo/cores.ts src/components/ludmilla/mundo/useFonteDaLudmilla.ts src/components/ludmilla/mundo/AvatarDaLudmilla.tsx src/components/ludmilla/mundo/pecas.tsx src/components/ludmilla/mundo/HistoricoEmBarras.tsx
git show --stat HEAD
```

---

### Task 8: O detalhe da decisão na voz dela, com topo e histórico

**Files:**
- Modify: `src/components/ludmilla/decidir/PainelDeDetalhe.tsx` (linhas 46–55, 83, 143, 163, 206/213, 257, 355–372, 448, 453, 466, 486, 533, 536–537)
- Modify: `src/components/ludmilla/decidir/DetalheConectado.tsx` (linhas 1, 13–20, 64–69)
- Create: `src/components/ludmilla/pagina/TopoDaDecisao.tsx`

**Interfaces:**
- Consumes: `Chip`, `Donos`, `TOM_DO_PRAZO` (Task 7); `DonoDoProjeto` (Task 1); `TomDoPrazo` (Task 3).
- Produces: `PropsDoDetalhe` ganha `topo?: ReactNode` (substitui o cabeçalho antigo quando vem) e `historico?: ReactNode` (logo depois do topo); `DetalheConectado` aceita e repassa `topo` e `historico`; `TopoDaDecisao({ prazo: {texto; tom}, donos, titulo, projeto, projectId: string | null, onAbrirProjeto })`. Os títulos das seções ficam "O que eu vi", "O que eu sugiro", "O e-mail que vai sair" e "O que eu registrei neste projeto". O comportamento (botões, Desfazer, textos editáveis, pedido da troca, `data-detalhe`, `data-teste`) NÃO muda.

- [ ] **Step 1: Medir o baseline e rodar os testes de hoje do detalhe**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.
Run: `npx vitest run src/lib/ludmillaPainel.test.ts src/lib/ludmillaPainel.visibilidade.test.ts src/lib/ludmillaPainel.cobranca.test.ts src/lib/ludmillaPainel.pedido.test.ts src/components/ludmilla/decidir/rascunhosDaCobranca.test.ts`
Expected: PASS (é a rede de proteção: nada deles pode mudar).

- [ ] **Step 2: As props novas do detalhe**

Em `src/components/ludmilla/decidir/PainelDeDetalhe.tsx`, troque:

```tsx
  /** a cada tecla no texto da cobrança: quem monta o painel guarda, para a edição sobreviver à saída e à volta da linha */
  onTextoDaCobranca?: (texto: string) => void;
}
```

por:

```tsx
  /** a cada tecla no texto da cobrança: quem monta o painel guarda, para a edição sobreviver à saída e à volta da linha */
  onTextoDaCobranca?: (texto: string) => void;
  /** a página nova (entrega 2): chip, responsável, a ação e o projeto — no lugar do cabeçalho antigo */
  topo?: ReactNode;
  /** a página nova (entrega 2): o histórico em barras, logo abaixo do topo */
  historico?: ReactNode;
}
```

e troque:

```tsx
export function DetalheDaDecisao({ dados, layout, onDecidir, onAbrirProjeto, urlDoDocumento, onTextoDaCobranca }: PropsDoDetalhe) {
```

por:

```tsx
export function DetalheDaDecisao({ dados, layout, onDecidir, onAbrirProjeto, urlDoDocumento, onTextoDaCobranca, topo, historico }: PropsDoDetalhe) {
```

e troque:

```tsx
        {cabecalho}
        {quem}{chegou}{cobranca}{pedido}{documentos}{sugestao}{linha}
```

por:

```tsx
        {topo ?? cabecalho}
        {historico}
        {quem}{chegou}{cobranca}{pedido}{documentos}{sugestao}{linha}
```

- [ ] **Step 3: Os títulos na voz dela e no tipo do mundo**

No mesmo arquivo, troque:

```tsx
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
```

por:

```tsx
      <h3 className="text-sm font-extrabold">{titulo}</h3>
```

Troque `<Secao titulo="O que chegou">` por `<Secao titulo="O que eu vi">`.

Troque TODAS as ocorrências (são duas, com recuos diferentes; use substituir-todas) de `<Secao titulo="O e-mail que vai para a ENEL">` por `<Secao titulo="O e-mail que vai sair">`.

Troque `  const titulo = 'O pedido da troca do relógio';` por `  const titulo = 'O e-mail que vai sair';`.

Troque `<Secao titulo="A sugestão">` por `<Secao titulo="O que eu sugiro">`.

Troque:

```tsx
          {u.project
            ? <>No sistema: <b className="text-foreground">{rotuloEtapa(u.project.status)}</b></>
            : <>Sem projeto casado no sistema</>}
          {u.recomendacao && <> · a Ludmilla sugere <b className="text-foreground">{rotuloEtapa(u.recomendacao)}</b></>}
```

por:

```tsx
          {u.project
            ? <>No sistema está em <b className="text-foreground">{rotuloEtapa(u.project.status)}</b>.</>
            : <>Não achei o projeto no sistema.</>}
          {u.recomendacao && <> Eu sugiro <b className="text-foreground">{rotuloEtapa(u.recomendacao)}</b>.</>}
```

Troque `<span className="text-xs text-emerald-700">recomendação da Ludmilla</span>` por `<span className="text-xs text-emerald-700">o que eu sugeri</span>`.

Troque `<Secao titulo="Este projeto na Ludmilla">` por `<Secao titulo="O que eu registrei neste projeto">`.

Troque `` `lido pela Ludmilla em ${dataCurta(chegou.lidoEm)}` `` por `` `lido por mim em ${dataCurta(chegou.lidoEm)}` `` (linha ~163; o `'lido pela Ludmilla em'` de `src/lib/ludmillaCartao.ts` NÃO muda — é outro texto, com teste).

Troque `Não consegui carregar o que a Ludmilla registrou para este projeto.` por `Não consegui carregar o que eu registrei para este projeto.` (linha ~453).

Troque o comentário `// tabIndex -1: a AbaDecidir põe o foco aqui depois de uma decisão ou de escolher a linha` por `// tabIndex -1: a PaginaDaLudmilla (useEscolhaEDecisao) põe o foco aqui depois de uma decisão ou de escolher o cartão` (linha ~533; a Task 14 procura `AbaDecidir` no `src/` e espera zero linhas).

E, na linha do tempo (o ícone da Ludmilla era `primary`, que no mundo é sol sobre sol claro — contraste baixo), troque:

```tsx
                    : e.ator === 'ludmilla' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
```

por:

```tsx
                    : e.ator === 'ludmilla' ? 'bg-lm-sol-fundo text-lm-sol-texto' : 'bg-emerald-100 text-emerald-700')}>
```

- [ ] **Step 4: O detalhe conectado repassa topo e histórico**

Em `src/components/ludmilla/decidir/DetalheConectado.tsx`, troque `import { useState } from 'react';` por `import { useState, type ReactNode } from 'react';`.

Troque:

```tsx
export function DetalheConectado({ item, layout, etapas, rotuloEtapa, onDecidir, onAbrirProjeto }: {
  item: ItemDaCaixa;
  layout: 'painel' | 'folha';
  etapas: DadosDoDetalhe['etapas'];
  rotuloEtapa: DadosDoDetalhe['rotuloEtapa'];
  onDecidir: (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void;
  onAbrirProjeto: (projectId: string) => void;
}) {
```

por:

```tsx
export function DetalheConectado({ item, layout, etapas, rotuloEtapa, onDecidir, onAbrirProjeto, topo, historico }: {
  item: ItemDaCaixa;
  layout: 'painel' | 'folha';
  etapas: DadosDoDetalhe['etapas'];
  rotuloEtapa: DadosDoDetalhe['rotuloEtapa'];
  onDecidir: (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void;
  onAbrirProjeto: (projectId: string) => void;
  /** a página nova: o topo e o histórico em barras (PaginaDaLudmilla monta) */
  topo?: ReactNode;
  historico?: ReactNode;
}) {
```

e troque:

```tsx
      dados={dados} layout={layout} onDecidir={onDecidir} onAbrirProjeto={onAbrirProjeto} urlDoDocumento={urlDoDocumento}
      onTextoDaCobranca={texto => guardarRascunho(item.chave, texto)}
    />
```

por:

```tsx
      dados={dados} layout={layout} onDecidir={onDecidir} onAbrirProjeto={onAbrirProjeto} urlDoDocumento={urlDoDocumento}
      onTextoDaCobranca={texto => guardarRascunho(item.chave, texto)} topo={topo} historico={historico}
    />
```

- [ ] **Step 5: Escrever `src/components/ludmilla/pagina/TopoDaDecisao.tsx`**

```tsx
import { Chip, Donos, TOM_DO_PRAZO } from '@/components/ludmilla/mundo/pecas';
import type { DonoDoProjeto } from '@/lib/ludmillaCarteira';
import type { TomDoPrazo } from '@/lib/ludmillaFila';

/**
 * O topo do detalhe (spec §4.4): chip do prazo e responsável · a ação como título · projeto, titular,
 * empresa e concessionária · "Abrir o projeto". "Passar para outra pessoa" fica para depois (precisa
 * de coluna nova no banco).
 */
export function TopoDaDecisao({ prazo, donos, titulo, projeto, projectId, onAbrirProjeto }: {
  prazo: { texto: string; tom: TomDoPrazo };
  donos: DonoDoProjeto[];
  titulo: string;
  projeto: string;
  projectId: string | null;
  onAbrirProjeto: (projectId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <Chip tom={TOM_DO_PRAZO[prazo.tom]}>{prazo.texto}</Chip>
        <Donos donos={donos} />
      </span>
      <h2 className="m-0 text-[21px] font-extrabold leading-tight">{titulo}</h2>
      <p className="m-0 text-[13px] text-lm-suave">{projeto}</p>
      {projectId && (
        <button
          type="button" onClick={() => onAbrirProjeto(projectId)}
          className="self-start text-[13px] font-bold underline underline-offset-4 hover:text-lm-alerta"
        >
          Abrir o projeto
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rodar os testes de novo, tsc e build**

Run: o mesmo `npx vitest run …` do Step 1 → PASS.
Run (as edições pegaram — os testes acima não leem este arquivo):

```bash
F=src/components/ludmilla/decidir/PainelDeDetalhe.tsx
grep -c 'titulo="O que eu vi"' $F            # 1
grep -c 'O e-mail que vai sair' $F           # 3 (duas seções e a const do pedido)
grep -c 'titulo="O que eu sugiro"' $F        # 1
grep -c 'o que eu sugeri' $F                 # 1
grep -c 'O que eu registrei neste projeto' $F # 1
grep -c 'topo ?? cabecalho' $F               # 1
grep -c 'lido por mim em' $F                 # 1
grep -cE 'a Ludmilla sugere|recomendação da Ludmilla|o que a Ludmilla registrou|lido pela Ludmilla' $F  # 0
grep -c 'AbaDecidir' $F                      # 0
grep -c 'topo={topo} historico={historico}' src/components/ludmilla/decidir/DetalheConectado.tsx  # 1
```

Se algum número não bater, a troca correspondente não pegou: refaça antes de seguir. (O nome "Ludmilla" continua em comentários e como autor na linha do tempo — `e.ator === 'ludmilla' ? 'Ludmilla' : …` — e isso está certo.)
Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 7: Commit**

`$RASCUNHO/msg-e2-t8.txt` (Write):

```
feat(ludmilla): detalhe da decisão na voz dela, com topo e histórico (entrega 2, página)

O detalhe de hoje (o que chegou, a sugestão, o e-mail editável, os botões
com Desfazer de 8 s) ganha os títulos em primeira pessoa e duas props
para a página nova: o topo (prazo, responsável, a ação, o projeto) e o
histórico em barras. O comportamento não muda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/components/ludmilla/decidir/PainelDeDetalhe.tsx src/components/ludmilla/decidir/DetalheConectado.tsx src/components/ludmilla/pagina/TopoDaDecisao.tsx
git commit -F "$RASCUNHO/msg-e2-t8.txt" -- src/components/ludmilla/decidir/PainelDeDetalhe.tsx src/components/ludmilla/decidir/DetalheConectado.tsx src/components/ludmilla/pagina/TopoDaDecisao.tsx
git show --stat HEAD
```

---

### Task 9: O meio da fila — cartão completo e lista

**Files:**
- Create: `src/components/ludmilla/pagina/CartaoDaFila.tsx`
- Create: `src/components/ludmilla/pagina/ListaDaFila.tsx`

**Interfaces:**
- Consumes: `Barra` (Task 2); `DonoDoProjeto`, `TempoDaLinha` (Task 1); `BotaoDoCartao`, `TomDoPrazo` (Task 3); `Chip`, `Donos`, `TOM_DO_PRAZO`, `Esqueleto`, `AvisoDeFalha` (Task 7); `HistoricoPequeno` (Task 7); `Button`.
- Produces: `DadosDoCartao {chave; titulo; projeto; porque; prazo: {texto; tom}; donos; barras: Barra[] | null; tempo: TempoDaLinha | null; botao: BotaoDoCartao}`, `TempoPequeno({ barras, tempo })`, `CartaoDaFila({ dados, aberto, onAbrir, onBotao })` (atributos de prova: `data-cartao="<chave>"` no cartão e `data-abrir="<chave>"` no botão que abre), `ListaDaFila({ cartoes, aberto, onAbrir(chave), onBotao(chave), carregando, erro, buscando, onTentar, vazio })` (`data-lista="fila"`).

Componentes de apresentação: a prova de tela é a da Task 13 (harness da página inteira). Aqui, tsc e build.

- [ ] **Step 1: Medir o baseline**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Escrever `src/components/ludmilla/pagina/CartaoDaFila.tsx`**

```tsx
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Barra } from '@/lib/ludmillaBarras';
import type { DonoDoProjeto, TempoDaLinha } from '@/lib/ludmillaCarteira';
import type { BotaoDoCartao, TomDoPrazo } from '@/lib/ludmillaFila';
import { HistoricoPequeno } from '@/components/ludmilla/mundo/HistoricoEmBarras';
import { Chip, Donos, TOM_DO_PRAZO } from '@/components/ludmilla/mundo/pecas';

/** Tudo o que o cartão mostra, já decidido pelas funções puras (PaginaDaLudmilla monta). */
export interface DadosDoCartao {
  chave: string;
  titulo: string;
  projeto: string;
  porque: string;
  prazo: { texto: string; tom: TomDoPrazo };
  donos: DonoDoProjeto[];
  /** null = item sem projeto na carteira (sem histórico) */
  barras: Barra[] | null;
  tempo: TempoDaLinha | null;
  botao: BotaoDoCartao;
}

/** O histórico pequeno com "14 dias em Troca / o normal é até 7" (cartão e linha da carteira). */
export function TempoPequeno({ barras, tempo }: { barras: Barra[]; tempo: TempoDaLinha }) {
  return (
    <span className="flex items-end gap-2.5">
      <HistoricoPequeno barras={barras} />
      <span className="text-xs leading-snug">
        <strong className={cn(tempo.alerta && 'text-lm-alerta')}>{tempo.dias}</strong> {tempo.em}
        <br />
        {tempo.normalCurto}
      </span>
    </span>
  );
}

/**
 * O CARTÃO COMPLETO da fila (spec §4.3): prazo, responsável, a ação como título, projeto/titular/
 * concessionária, o porquê em primeira pessoa, o histórico pequeno e o botão principal. Clicar no
 * cartão abre o detalhe; o botão faz a ação (ou abre o detalhe, quando a decisão pede revisão).
 */
export function CartaoDaFila({ dados, aberto, onAbrir, onBotao }: {
  dados: DadosDoCartao; aberto: boolean; onAbrir: () => void; onBotao: () => void;
}) {
  return (
    <article
      data-cartao={dados.chave}
      className={cn('flex flex-col gap-2.5 rounded-lg border bg-white p-4',
        aberto ? 'border-2 border-lm-petroleo p-[15px]' : 'border-lm-borda')}
    >
      <button
        type="button" onClick={onAbrir} data-abrir={dados.chave} aria-current={aberto ? 'true' : undefined}
        className="flex flex-col gap-1.5 rounded text-left"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <Chip tom={TOM_DO_PRAZO[dados.prazo.tom]}>{dados.prazo.texto}</Chip>
          <Donos donos={dados.donos} />
        </span>
        <span className="text-base font-extrabold">{dados.titulo}</span>
        <span className="text-[13px] text-lm-suave">{dados.projeto}</span>
        {dados.porque && <span className="text-sm leading-normal">{dados.porque}</span>}
      </button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {dados.barras && dados.tempo ? <TempoPequeno barras={dados.barras} tempo={dados.tempo} /> : <span />}
        <Button type="button" onClick={onBotao} className="w-full font-bold sm:w-auto">{dados.botao.rotulo}</Button>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Escrever `src/components/ludmilla/pagina/ListaDaFila.tsx`**

```tsx
import { AvisoDeFalha, Esqueleto } from '@/components/ludmilla/mundo/pecas';
import { CartaoDaFila, type DadosDoCartao } from './CartaoDaFila';

/**
 * A lista de um grupo da fila. Carregando: esqueleto. Consulta que falhou NÃO é lista vazia: diz que
 * falhou. Vazia de verdade: a frase da spec §4.6, com a próxima leitura.
 */
export function ListaDaFila({ cartoes, aberto, onAbrir, onBotao, carregando, erro, buscando, onTentar, vazio }: {
  cartoes: DadosDoCartao[];
  aberto: string | null;
  onAbrir: (chave: string) => void;
  onBotao: (chave: string) => void;
  carregando: boolean;
  /** null = sem erro; texto (pode ser vazio) = a consulta falhou */
  erro: string | null;
  buscando: boolean;
  onTentar: () => void;
  /** o texto embaixo de "Nada aqui agora." */
  vazio: string;
}) {
  if (carregando) return <Esqueleto rotulo="Carregando a fila" />;
  return (
    <div className="flex flex-col gap-3" data-lista="fila">
      {erro !== null && <AvisoDeFalha oQue="a fila de decisões" detalhe={erro || null} buscando={buscando} onTentar={onTentar} />}
      {cartoes.map(c => (
        <CartaoDaFila key={c.chave} dados={c} aberto={c.chave === aberto} onAbrir={() => onAbrir(c.chave)} onBotao={() => onBotao(c.chave)} />
      ))}
      {cartoes.length === 0 && erro === null && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-lm-barra px-5 py-7">
          <span className="text-[17px] font-extrabold">Nada aqui agora.</span>
          <span className="text-sm leading-normal text-lm-suave">{vazio}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 5: Commit**

`$RASCUNHO/msg-e2-t9.txt` (Write):

```
feat(ludmilla): cartão completo e lista da fila (entrega 2, página)

O cartão da spec 4.3 (prazo, responsável, a ação como título, o porquê
em primeira pessoa, o histórico pequeno e o botão principal) e a lista
de um grupo, com esqueleto, falha que não finge lista vazia e a frase
de "Nada aqui agora".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/components/ludmilla/pagina/CartaoDaFila.tsx src/components/ludmilla/pagina/ListaDaFila.tsx
git commit -F "$RASCUNHO/msg-e2-t9.txt" -- src/components/ludmilla/pagina/CartaoDaFila.tsx src/components/ludmilla/pagina/ListaDaFila.tsx
git show --stat HEAD
```

---

### Task 10: A carteira e a ficha da Ludmilla

**Files:**
- Create: `src/components/ludmilla/pagina/LinhaDaCarteira.tsx`
- Create: `src/components/ludmilla/pagina/ListaDaCarteira.tsx`
- Create: `src/components/ludmilla/pagina/FichaDoProjeto.tsx`
- Create: `src/components/ludmilla/pagina/FichaConectada.tsx`

**Interfaces:**
- Consumes: `Barra` (Task 2); `ComQuem`, `DonoDoProjeto`, `LinhaDaCarteira`, `TempoDaLinha`, `ROTULO_COM_QUEM` (Task 1); `fraseDoRegistro` (Task 4); `diaEMes` (Task 1); `Chip`, `Donos`, `TOM_DO_COM_QUEM`, `AvisoDeFalha` (Task 7); `TempoPequeno` (Task 9); `EventoDoProjeto` (`src/lib/ludmillaPainel.ts`); `useLinhaDoTempo` (`src/hooks/useLudmillaDecidir.ts`); `Button`.
- Produces: `DadosDaLinha {projectId; codigo; titular; concessionaria; barras: Barra[]; tempo: TempoDaLinha; comQuem; donos}`, `LinhaDaCarteira({ dados, aberta, onAbrir })` (`data-linha-carteira="<projectId>"`), `ListaDaCarteira({ linhas, aberta, onAbrir(projectId), erro, buscando, onTentar })` (`data-lista="carteira"`), `PropsDaFicha {linha; historico: ReactNode; leituras: EventoDoProjeto[] | 'carregando' | 'erro'; proximo: string; onVerNaFila: (() => void) | null; onAbrirProjeto; rotuloEtapa}`, `FichaDoProjeto(p: PropsDaFicha)` (`data-ficha="<projectId>"`), `FichaConectada(p: Omit<PropsDaFicha, 'leituras'>)`.

Nome do componente `LinhaDaCarteira` e do tipo `LinhaDaCarteira` (Task 1) colidem: neste arquivo o tipo da Task 1 é importado como `type LinhaDaCarteira as LinhaDaRpc` quando precisar; o componente só usa `DadosDaLinha`.

- [ ] **Step 1: Medir o baseline**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Escrever `src/components/ludmilla/pagina/LinhaDaCarteira.tsx`**

```tsx
import { cn } from '@/lib/utils';
import type { Barra } from '@/lib/ludmillaBarras';
import { ROTULO_COM_QUEM, type ComQuem, type DonoDoProjeto, type TempoDaLinha } from '@/lib/ludmillaCarteira';
import { Chip, Donos, TOM_DO_COM_QUEM } from '@/components/ludmilla/mundo/pecas';
import { TempoPequeno } from './CartaoDaFila';

export interface DadosDaLinha {
  projectId: string;
  codigo: string;
  titular: string | null;
  concessionaria: string | null;
  barras: Barra[];
  tempo: TempoDaLinha;
  comQuem: ComQuem;
  donos: DonoDoProjeto[];
}

/**
 * Uma linha da carteira (spec §4.3): código e titular, concessionária, histórico pequeno com o
 * tempo e o normal, com quem está e o responsável. Duas colunas em qualquer largura: a lista do meio
 * tem de 380 a 700 px conforme a tela.
 */
export function LinhaDaCarteira({ dados, aberta, onAbrir }: { dados: DadosDaLinha; aberta: boolean; onAbrir: () => void }) {
  return (
    <button
      type="button" onClick={onAbrir} aria-current={aberta ? 'true' : undefined} data-linha-carteira={dados.projectId}
      className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 rounded-lg border bg-white px-3.5 py-3 text-left',
        aberta ? 'border-2 border-lm-petroleo px-[13px] py-[11px]' : 'border-lm-borda')}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-extrabold">{dados.codigo}</span>
        <span className="truncate text-[13px] text-lm-suave">{dados.titular ?? '—'}</span>
      </span>
      <span className="text-right text-[13px] font-semibold">{dados.concessionaria ?? '—'}</span>
      <TempoPequeno barras={dados.barras} tempo={dados.tempo} />
      <span className="flex flex-col items-end gap-1">
        <Chip tom={TOM_DO_COM_QUEM[dados.comQuem]}>{ROTULO_COM_QUEM[dados.comQuem]}</Chip>
        <Donos donos={dados.donos} />
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Escrever `src/components/ludmilla/pagina/ListaDaCarteira.tsx`**

```tsx
import { AvisoDeFalha } from '@/components/ludmilla/mundo/pecas';
import { LinhaDaCarteira, type DadosDaLinha } from './LinhaDaCarteira';

/** A carteira num filtro, na ordem de `ordenarCarteira` (quem chama já filtrou e ordenou). */
export function ListaDaCarteira({ linhas, aberta, onAbrir, erro, buscando, onTentar }: {
  linhas: DadosDaLinha[];
  aberta: string | null;
  onAbrir: (projectId: string) => void;
  erro: string | null;
  buscando: boolean;
  onTentar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5" data-lista="carteira">
      {erro !== null && <AvisoDeFalha oQue="a carteira" detalhe={erro || null} buscando={buscando} onTentar={onTentar} />}
      {linhas.map(l => (
        <LinhaDaCarteira key={l.projectId} dados={l} aberta={l.projectId === aberta} onAbrir={() => onAbrir(l.projectId)} />
      ))}
      {linhas.length === 0 && erro === null && <p className="m-0 text-sm text-lm-suave">Nenhum projeto neste filtro.</p>}
    </div>
  );
}
```

- [ ] **Step 4: Escrever `src/components/ludmilla/pagina/FichaDoProjeto.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ROTULO_COM_QUEM, type LinhaDaCarteira as LinhaDaRpc } from '@/lib/ludmillaCarteira';
import type { EventoDoProjeto } from '@/lib/ludmillaPainel';
import { fraseDoRegistro } from '@/lib/ludmillaRecado';
import { diaEMes } from '@/lib/ludmillaTempo';
import { Chip, Donos, TOM_DO_COM_QUEM } from '@/components/ludmilla/mundo/pecas';

export interface PropsDaFicha {
  linha: LinhaDaRpc;
  /** o histórico em barras grande (PaginaDaLudmilla monta) */
  historico: ReactNode;
  /** `ludmilla_linha_do_tempo` do projeto */
  leituras: EventoDoProjeto[] | 'carregando' | 'erro';
  proximo: string;
  /** null = nada deste projeto na fila */
  onVerNaFila: (() => void) | null;
  onAbrirProjeto: (projectId: string) => void;
  rotuloEtapa: (s: string) => string;
}

/** Quantas leituras dela a ficha mostra (decisão 20). */
const ULTIMAS = 5;

/**
 * A FICHA DA LUDMILLA (spec §4.4): com quem está e responsável · código e titular · empresa,
 * concessionária e etapa · histórico grande · "O que eu li por último" · "O próximo passo" · "Ver na
 * fila" quando há item · "Abrir o projeto" (o modal do GD).
 */
export function FichaDoProjeto({ linha, historico, leituras, proximo, onVerNaFila, onAbrirProjeto, rotuloEtapa }: PropsDaFicha) {
  const ultimas = Array.isArray(leituras)
    ? leituras
      .filter(e => e.ator === 'ludmilla')
      .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando))
      .slice(0, ULTIMAS)
    : [];
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5" data-ficha={linha.projectId}>
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <Chip tom={TOM_DO_COM_QUEM[linha.comQuem]}>{ROTULO_COM_QUEM[linha.comQuem]}</Chip>
          <Donos donos={linha.donos} />
        </span>
        <h2 className="m-0 text-[21px] font-extrabold leading-tight">{linha.codigo}{linha.titular ? `, ${linha.titular}` : ''}</h2>
        <p className="m-0 text-[13px] text-lm-suave">
          {[linha.empresa, linha.concessionaria, `etapa ${rotuloEtapa(linha.status)}`].filter(Boolean).join(', ')}
        </p>
      </div>
      {historico}
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-extrabold">O que eu li por último</h3>
        {leituras === 'carregando' ? (
          <p className="m-0 text-[13px] text-lm-suave">Carregando…</p>
        ) : leituras === 'erro' ? (
          <p className="m-0 text-[13px] text-lm-alerta">Não consegui carregar o que eu registrei deste projeto.</p>
        ) : ultimas.length === 0 ? (
          <p className="m-0 text-[13px] text-lm-suave">Ainda não li nada sobre este projeto.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {ultimas.map((e, i) => (
              <li key={`${e.quando}-${i}`} className="grid grid-cols-[48px_minmax(0,1fr)] gap-2.5 text-[13px] leading-snug">
                <span className="text-lm-suave">{diaEMes(Date.parse(e.quando))}</span>
                {/* a ficha já é do projeto: sem o "(PRJ-…)" no fim de cada frase */}
                <span>{fraseDoRegistro({ ...e, projeto: null })}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-extrabold">O próximo passo</h3>
        <p className="m-0 text-sm leading-normal">{proximo}</p>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        {onVerNaFila && <Button type="button" onClick={onVerNaFila} className="font-bold">Ver na fila</Button>}
        <button type="button" onClick={() => onAbrirProjeto(linha.projectId)} className="text-[13px] font-bold underline underline-offset-4">
          Abrir o projeto
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Escrever `src/components/ludmilla/pagina/FichaConectada.tsx`**

```tsx
import { useLinhaDoTempo } from '@/hooks/useLudmillaDecidir';
import { FichaDoProjeto, type PropsDaFicha } from './FichaDoProjeto';

/** Liga a ficha à linha do tempo do projeto (`ludmilla_linha_do_tempo`, a mesma do detalhe). */
export function FichaConectada(p: Omit<PropsDaFicha, 'leituras'>) {
  const linhaDoTempo = useLinhaDoTempo(p.linha.projectId);
  const leituras: PropsDaFicha['leituras'] = linhaDoTempo.data ?? (linhaDoTempo.isError ? 'erro' : 'carregando');
  return <FichaDoProjeto {...p} leituras={leituras} />;
}
```

- [ ] **Step 6: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 7: Commit**

`$RASCUNHO/msg-e2-t10.txt` (Write):

```
feat(ludmilla): carteira e ficha da Ludmilla (entrega 2, página)

A linha da carteira (código, titular, concessionária, histórico pequeno
com o normal, com quem está e responsável) e a ficha do projeto
(histórico grande, o que ela leu por último em primeira pessoa, o
próximo passo, "Ver na fila" e "Abrir o projeto").

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/components/ludmilla/pagina/LinhaDaCarteira.tsx src/components/ludmilla/pagina/ListaDaCarteira.tsx src/components/ludmilla/pagina/FichaDoProjeto.tsx src/components/ludmilla/pagina/FichaConectada.tsx
git commit -F "$RASCUNHO/msg-e2-t10.txt" -- src/components/ludmilla/pagina/LinhaDaCarteira.tsx src/components/ludmilla/pagina/ListaDaCarteira.tsx src/components/ludmilla/pagina/FichaDoProjeto.tsx src/components/ludmilla/pagina/FichaConectada.tsx
git show --stat HEAD
```

---

### Task 11: Comigo e Ajustes — Fiz sozinha, Diário, Ajustes e "Onde eu leio"

**Files:**
- Create: `src/components/ludmilla/pagina/FizSozinha.tsx`
- Create: `src/components/ludmilla/pagina/Diario.tsx`
- Create: `src/components/ludmilla/pagina/AjustesDaLudmilla.tsx`
- Create: `src/components/ludmilla/pagina/OndeEuLeio.tsx`
- Modify: `src/components/ludmilla/abas/CartaoDaConta.tsx` (linhas 33–34 e 137: "Verificar agora" → "Ler agora")
- Modify: `src/components/ludmilla/MensagensEmail.tsx` (linha 121: "Verificar agora" → "Ler agora", na voz dela), `src/components/ludmilla/abas/CartaoCaptcha.tsx` (linha 31) e `src/components/ludmilla/RegrasEmail.tsx` (linhas 119–120): primeira pessoa (Global "Voz")

**Interfaces:**
- Consumes: `FeitoSozinha`, `DiaDoDiario`, `RecadoDoDia` (Task 4); `quandoCurto` (Task 1); `primeiroNome` (Task 3); `Chip`, `Esqueleto`, `AvisoDeFalha` (Task 7); `CartaoDaConta` (`abas/CartaoDaConta.tsx`), `AbaCriacoesCpfl` (`abas/CriacoesCpfl.tsx`), `AlertasDasContas` (`topo/AlertasDasContas.tsx`); `AgentConfigSafe` (`@/hooks/useAgentConfig`); `PortalAccount`, `PortalRun`, `TipoRun` (`@/hooks/useLudmilla`); `AlertaUrgente` (`@/lib/ludmillaPainel`); `Button`.
- Produces: `FizSozinha({ feitos, rotuloDoDesde, agora, onAbrirProjeto })` (`data-vista="sozinha"`), `ListaDoQueFacoSozinha()`, `PainelDoQueFacoSozinha({ onAjustes })` (`data-painel="sozinha"`), `EstadoDoDiario {carregando; erro: string | null; tentar; podeVerMais; verMais}`, `Diario({ dias, estado })` (`data-vista="diario"`), `PainelDoRecado({ recado: RecadoDoDia | null })` (`data-painel="recado"`), `AjustesDaLudmilla()` (`data-vista="ajustes"`), `PropsDeOndeEuLeio`, `OndeEuLeio(p)` (`data-painel="onde-eu-leio"`).

- [ ] **Step 1: Medir o baseline**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Escrever `src/components/ludmilla/pagina/FizSozinha.tsx`**

```tsx
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FeitoSozinha } from '@/lib/ludmillaRecado';
import { quandoCurto } from '@/lib/ludmillaTempo';
import { Chip } from '@/components/ludmilla/mundo/pecas';

/**
 * O que ela faz sozinha HOJE (entrega 2, sem as chaves): só anexar o documento conferido (e pôr o
 * parecer no card). As outras três chaves da spec §6.5 chegam na entrega 4; até lá, passam pela fila.
 */
const O_QUE_EU_FACO: { nome: string; descricao: string; sozinha: boolean }[] = [
  { nome: 'Anexar documento conferido', descricao: 'Parecer ou Carta com o titular ou a UC conferidos vai direto para o card.', sozinha: true },
  { nome: 'Gravar NT ou protocolo', descricao: 'Vira cartão na fila; alguém aplica.', sozinha: false },
  { nome: 'Mover etapa com prova forte', descricao: 'Vira cartão na fila; alguém aplica.', sozinha: false },
  { nome: 'Criar tarefa para projeto parado', descricao: 'Por enquanto eu mostro os parados na carteira.', sozinha: false },
];

export function ListaDoQueFacoSozinha() {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {O_QUE_EU_FACO.map(c => (
        <li key={c.nome} className="flex items-start justify-between gap-3 border-b border-lm-linha py-3 last:border-b-0">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-bold">{c.nome}</span>
            <span className="text-[13px] leading-snug">{c.descricao}</span>
          </span>
          <Chip tom={c.sozinha ? 'ok' : 'caixa'}>{c.sozinha ? 'Faço sozinha' : 'Pela fila'}</Chip>
        </li>
      ))}
    </ul>
  );
}

/** O meio da vista "Fiz sozinha": o que ela fez desde a última visita, com a hora. Sem Desfazer nesta entrega. */
export function FizSozinha({ feitos, rotuloDoDesde, agora, onAbrirProjeto }: {
  feitos: FeitoSozinha[];
  /** "Desde sexta" */
  rotuloDoDesde: string;
  agora: number;
  onAbrirProjeto: (projectId: string) => void;
}) {
  if (feitos.length === 0) {
    return (
      <p className="m-0 text-sm leading-normal text-lm-suave" data-vista="sozinha">
        {rotuloDoDesde}, não fiz nada sozinha. Por enquanto eu só anexo sozinha o documento que conferi; o resto passa pela fila.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-vista="sozinha">
      {feitos.map((f, i) => (
        <li key={`${f.quando}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-lm-borda bg-white p-4 text-sm leading-normal">
          <Check size={18} strokeWidth={2.6} className="mt-0.5 shrink-0 text-lm-ok-texto" aria-hidden />
          <span className="min-w-0 flex-1"><strong>{quandoCurto(Date.parse(f.quando), agora)}</strong> {f.texto}</span>
          {f.projectId && (
            <button type="button" onClick={() => onAbrirProjeto(f.projectId!)} className="shrink-0 text-[13px] font-bold underline underline-offset-4">
              Abrir
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A direita da vista "Fiz sozinha" (spec §4.4: "as chaves ligadas hoje" e "Mudar nos Ajustes"). */
export function PainelDoQueFacoSozinha({ onAjustes }: { onAjustes: () => void }) {
  return (
    <div className="flex flex-col gap-2.5 p-4 sm:p-5" data-painel="sozinha">
      <h2 className="m-0 text-base font-extrabold">O que eu faço sozinha hoje</h2>
      <ListaDoQueFacoSozinha />
      <Button type="button" variant="outline" className="self-start" onClick={onAjustes}>Ver nos Ajustes</Button>
    </div>
  );
}
```

- [ ] **Step 3: Escrever `src/components/ludmilla/pagina/Diario.tsx`**

```tsx
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { primeiroNome } from '@/lib/ludmillaFila';
import type { DiaDoDiario, RecadoDoDia } from '@/lib/ludmillaRecado';
import { AvisoDeFalha, Chip, Esqueleto } from '@/components/ludmilla/mundo/pecas';

export interface EstadoDoDiario {
  carregando: boolean;
  erro: string | null;
  tentar: () => void;
  /** a consulta trouxe o limite: há mais para trás */
  podeVerMais: boolean;
  verMais: () => void;
}

/** O DIÁRIO (spec §4.3): o registro por dia, em primeira pessoa, marcando o que foi dela e o que foi da equipe. */
export function Diario({ dias, estado }: { dias: DiaDoDiario[]; estado: EstadoDoDiario }) {
  if (estado.carregando) return <Esqueleto rotulo="Carregando o diário" />;
  return (
    <div className="flex flex-col gap-4" data-vista="diario">
      {estado.erro !== null && <AvisoDeFalha oQue="o diário" detalhe={estado.erro || null} onTentar={estado.tentar} />}
      {dias.length === 0 && estado.erro === null && <p className="m-0 text-sm text-lm-suave">Nada registrado ainda.</p>}
      {dias.map(d => (
        <section key={d.rotulo} className="flex flex-col gap-1.5">
          <h2 className="m-0 text-sm font-extrabold">{d.rotulo}</h2>
          <ol className="m-0 list-none border-t-2 border-lm-petroleo p-0">
            {d.itens.map(e => (
              <li key={e.chave} className="grid grid-cols-[44px_84px_minmax(0,1fr)] items-baseline gap-2.5 border-b border-lm-linha py-2.5 text-sm leading-snug">
                <span className="text-[13px] text-lm-suave">{e.hora}</span>
                <span className="justify-self-start"><Chip tom={e.deLa ? 'sol' : 'azul'}>{e.deLa ? 'Ludmilla' : primeiroNome(e.quem)}</Chip></span>
                <span className={cn('min-w-0 break-words', e.erro && 'text-lm-alerta')}>
                  {e.texto}
                  {e.detalhe && <span className="block break-words text-xs text-lm-suave">{e.detalhe}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {estado.podeVerMais && <Button type="button" variant="outline" className="self-start" onClick={estado.verMais}>Ver mais</Button>}
    </div>
  );
}

/** A direita do Diário: o recado do dia inteiro (até a entrega 5 trazer o resumo da manhã). */
export function PainelDoRecado({ recado }: { recado: RecadoDoDia | null }) {
  return (
    <div className="flex flex-col gap-2.5 p-4 sm:p-5" data-painel="recado">
      <h2 className="m-0 text-base font-extrabold">O recado de hoje</h2>
      {recado ? (
        <>
          <span className="text-xs text-lm-suave">{recado.data}</span>
          <p className="m-0 rounded-[4px_10px_10px_10px] border border-lm-borda px-4 py-3.5 text-[13px] leading-relaxed">{recado.texto}</p>
        </>
      ) : (
        <Esqueleto linhas={1} rotulo="Carregando o recado" />
      )}
      <span className="text-xs text-lm-suave">Quando o resumo da manhã estiver ligado, é ele que aparece aqui.</span>
    </div>
  );
}
```

- [ ] **Step 4: Escrever `src/components/ludmilla/pagina/AjustesDaLudmilla.tsx`**

```tsx
import { Lock } from 'lucide-react';
import { ListaDoQueFacoSozinha } from './FizSozinha';

/**
 * O meio dos Ajustes NESTA entrega (decisão 16): sem as chaves (entrega 4) e sem o resumo da manhã
 * (entrega 5). Só leitura: o que ela faz sozinha hoje, a linha fixa do e-mail e como ela avisa.
 */
export function AjustesDaLudmilla() {
  return (
    <div className="flex max-w-[760px] flex-col gap-6" data-vista="ajustes">
      <section className="flex flex-col gap-1">
        <h2 className="m-0 text-base font-extrabold">O que eu faço sozinha</h2>
        <p className="m-0 text-[13px] text-lm-suave">Hoje eu só anexo sozinha o documento que conferi. O resto vira cartão na fila, e alguém decide.</p>
        <ListaDoQueFacoSozinha />
      </section>
      <section className="flex items-start gap-3.5 border-t border-lm-linha pt-4">
        <Lock size={20} className="mt-0.5 shrink-0 text-lm-suave" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[15px] font-bold">Mandar e-mail para a concessionária</h2>
          <p className="m-0 text-[13px] leading-normal">Sem chave: cobrança e pedido de troca sempre saem pelo clique de alguém da equipe.</p>
        </div>
      </section>
      <section className="flex flex-col gap-1 border-t border-lm-linha pt-4">
        <h2 className="m-0 text-base font-extrabold">Como eu te aviso</h2>
        <p className="m-0 text-[13px] leading-normal">
          Pelo sino e pelo número ao lado do meu nome no menu do GD. O resumo da manhã, por WhatsApp e por e-mail, ainda não está ligado.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Escrever `src/components/ludmilla/pagina/OndeEuLeio.tsx`**

```tsx
import { useNavigate } from 'react-router-dom';
import type { AgentConfigSafe } from '@/hooks/useAgentConfig';
import type { PortalAccount, PortalRun, TipoRun } from '@/hooks/useLudmilla';
import type { AlertaUrgente } from '@/lib/ludmillaPainel';
import { CartaoDaConta } from '@/components/ludmilla/abas/CartaoDaConta';
import { AbaCriacoesCpfl } from '@/components/ludmilla/abas/CriacoesCpfl';
import { AlertasDasContas } from '@/components/ludmilla/topo/AlertasDasContas';

export interface PropsDeOndeEuLeio {
  contas: PortalAccount[];
  nomeDaConta: (id: string) => string;
  caixa: AgentConfigSafe | null | undefined;
  /** true = configurada · false = não configurada · null = sem resposta */
  caixaPronta: boolean | null;
  caixaFalhou: boolean;
  agora: number;
  verificando: boolean;
  onVerificar: (accountId: string, tipo: TipoRun) => void;
  alertas: AlertaUrgente[];
  /** "Ainda não acompanho CEMIG e Energisa." ou null */
  naoAcompanhadas: string | null;
  runsCriacao: PortalRun[];
}

/**
 * "ONDE EU LEIO" (spec §4.4, direita dos Ajustes): o que hoje está na aba Concessionárias — os
 * alertas das contas, um cartão por conta (situação, meio, última leitura, Ler agora, Acesso ao
 * portal, regras de e-mail, o que ela leu na caixa), as criações na CPFL e as concessionárias que
 * ela ainda não acompanha. Os cartões são os de hoje (`CartaoDaConta`), sem mudar o que fazem.
 */
export function OndeEuLeio(p: PropsDeOndeEuLeio) {
  const navigate = useNavigate();
  const contas = [...p.contas].sort((a, b) => p.nomeDaConta(a.id).localeCompare(p.nomeDaConta(b.id), 'pt-BR'));
  const temCpfl = p.contas.some(c => c.connector === 'cpfl');
  return (
    <div className="flex flex-col gap-3 p-4 sm:p-5" data-painel="onde-eu-leio">
      <h2 className="m-0 text-base font-extrabold">Onde eu leio</h2>
      <AlertasDasContas alertas={p.alertas} />
      {contas.length === 0 && (
        <p className="m-0 text-sm text-lm-suave">Ainda não tenho nenhuma conta. Em Concessionárias, use o ícone de chave para cadastrar o acesso.</p>
      )}
      {contas.map(c => (
        <CartaoDaConta
          key={c.id} conta={c} nome={p.nomeDaConta(c.id)} caixa={p.caixa} caixaPronta={p.caixaPronta} caixaFalhou={p.caixaFalhou}
          agora={p.agora} verificando={p.verificando} onVerificar={tipo => p.onVerificar(c.id, tipo)}
          onAcessoAoPortal={() => navigate('/admin/energy-concessionaires')}
        />
      ))}
      {temCpfl && <section className="flex flex-col gap-2 pt-2"><AbaCriacoesCpfl runs={p.runsCriacao} /></section>}
      {p.naoAcompanhadas && <p className="m-0 text-[13px] leading-normal text-lm-suave">{p.naoAcompanhadas}</p>}
    </div>
  );
}
```

- [ ] **Step 6: "Verificar agora" vira "Ler agora" nos cartões das contas**

Em `src/components/ludmilla/abas/CartaoDaConta.tsx`, troque:

```tsx
          <RefreshCw size={14} /> Verificar agora
```

por:

```tsx
          <RefreshCw size={14} aria-hidden /> Ler agora
```

e troque:

```tsx
            "Verificar agora" fica desligado — recarregue a página daqui a pouco.
```

por:

```tsx
            "Ler agora" fica desligado — recarregue a página daqui a pouco.
```

Os textos reaproveitados dentro dos cartões também passam à primeira pessoa (Global "Voz"):

- Em `src/components/ludmilla/MensagensEmail.tsx` (linha ~121), troque `Ela ainda não leu a caixa. O primeiro "Verificar agora" é manual e de propósito:{' '}` por `Ainda não li esta caixa. A primeira leitura ("Ler agora") é manual e de propósito:{' '}`.
- Em `src/components/ludmilla/abas/CartaoCaptcha.tsx` (linha ~31), troque `A Ludmilla precisa do código da imagem — {portal}` por `Preciso do código da imagem — {portal}`.
- Em `src/components/ludmilla/RegrasEmail.tsx` (linhas ~119–120), troque:

```tsx
          Nenhuma regra cadastrada. Sem pelo menos uma regra ativa a Ludmilla se recusa a ler a caixa —
          ela não saberia o que é documento e o que é ruído.
```

por:

```tsx
          Nenhuma regra cadastrada. Sem pelo menos uma regra ativa eu não leio a caixa —
          eu não saberia o que é documento e o que é ruído.
```

Confira: `grep -c 'Verificar agora' src/components/ludmilla/abas/CartaoDaConta.tsx src/components/ludmilla/MensagensEmail.tsx` → `0` nos dois; `grep -cE 'A Ludmilla precisa|a Ludmilla se recusa' src/components/ludmilla/abas/CartaoCaptcha.tsx src/components/ludmilla/RegrasEmail.tsx` → `0` nos dois. (Exceção aceita: `ludmillaPainel.ts:191` tem teste e fica como está.)

- [ ] **Step 7: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 8: Commit**

`$RASCUNHO/msg-e2-t11.txt` (Write):

```
feat(ludmilla): Fiz sozinha, Diário, Ajustes e "Onde eu leio" (entrega 2, página)

Fiz sozinha lista o que ela já faz hoje (sem Desfazer nesta entrega); o
Diário é o registro por dia em primeira pessoa, com o recado inteiro à
direita; os Ajustes mostram o que ela faz sozinha, a linha fixa do
e-mail e como ela avisa; "Onde eu leio" reúne os cartões das contas de
hoje (agora com "Ler agora"), os alertas e as criações na CPFL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/components/ludmilla/pagina/FizSozinha.tsx src/components/ludmilla/pagina/Diario.tsx src/components/ludmilla/pagina/AjustesDaLudmilla.tsx src/components/ludmilla/pagina/OndeEuLeio.tsx src/components/ludmilla/abas/CartaoDaConta.tsx src/components/ludmilla/MensagensEmail.tsx src/components/ludmilla/abas/CartaoCaptcha.tsx src/components/ludmilla/RegrasEmail.tsx
git commit -F "$RASCUNHO/msg-e2-t11.txt" -- src/components/ludmilla/pagina/FizSozinha.tsx src/components/ludmilla/pagina/Diario.tsx src/components/ludmilla/pagina/AjustesDaLudmilla.tsx src/components/ludmilla/pagina/OndeEuLeio.tsx src/components/ludmilla/abas/CartaoDaConta.tsx src/components/ludmilla/MensagensEmail.tsx src/components/ludmilla/abas/CartaoCaptcha.tsx src/components/ludmilla/RegrasEmail.tsx
git show --stat HEAD
```

---

### Task 12: A navegação — faixas, coluna da esquerda e folha

**Files:**
- Create: `src/components/ludmilla/pagina/FaixaDaLudmilla.tsx`
- Create: `src/components/ludmilla/pagina/FaixaDoCelular.tsx`
- Create: `src/components/ludmilla/pagina/ColunaDaEsquerda.tsx`
- Create: `src/components/ludmilla/pagina/FolhaDaLudmilla.tsx`

**Interfaces:**
- Consumes: `AvatarDaLudmilla` (Task 7); `RecadoDoDia` (Task 4); `LinhaDeLeitura` (Task 5); `Sheet`, `SheetContent`, `SheetTitle`, `SheetDescription` (`@/components/ui/sheet`); `cn`.
- Produces: `FaixaDaLudmilla({ onAjustes, ajustesAberto })`; `FaixaDoCelular({ onMenu, onAjustes })`; `ItemDeNavegacao {chave; rotulo; n: number | null; alerta?; ativo; onClick}`; `ColunaDaEsquerda({ recado: RecadoDoDia | null, grupos, donos: {valor; rotulo}[], dono, onDono, carteira, comigo, leituras, onLeituras })` (`data-coluna="esquerda"`, cada item `data-nav="<chave>"`, cada botão de dono `data-dono="<valor>"`, o recado `data-recado`); `FolhaDaLudmilla({ aberta, onFechar, lado?: 'left' | 'right', titulo, cabecalho, children, onCloseAutoFocus? })`. Atributos de prova: `data-nav="ajustes"` (engrenagem), `data-nav="menu"` (celular), `data-nav="leituras"`.

- [ ] **Step 1: Medir o baseline**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Escrever `src/components/ludmilla/pagina/FaixaDaLudmilla.tsx`**

```tsx
import { Settings } from 'lucide-react';
import { AvatarDaLudmilla } from '@/components/ludmilla/mundo/AvatarDaLudmilla';

/** A faixa do topo (spec §4.1): avatar, "Ludmilla", "Analista de homologação" e Ajustes. Nada mais. */
export function FaixaDaLudmilla({ onAjustes, ajustesAberto }: { onAjustes: () => void; ajustesAberto: boolean }) {
  return (
    <header className="lm-sobre-petroleo flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-lm-petroleo px-6 py-2.5 text-white">
      <div className="flex items-center gap-3">
        <AvatarDaLudmilla tamanho={40} />
        <div className="flex flex-col">
          <span className="text-lg font-extrabold">Ludmilla</span>
          <span className="text-xs text-lm-faixa-suave">Analista de homologação</span>
        </div>
      </div>
      <button
        type="button" onClick={onAjustes} aria-current={ajustesAberto ? 'true' : undefined} data-nav="ajustes"
        className="flex items-center gap-2 rounded-md border-[1.5px] border-lm-faixa-borda px-3 py-1.5 text-[13px] font-bold text-white hover:bg-white/10"
      >
        <Settings size={16} aria-hidden /> Ajustes
      </button>
    </header>
  );
}
```

- [ ] **Step 3: Escrever `src/components/ludmilla/pagina/FaixaDoCelular.tsx`**

```tsx
import { Menu, Settings } from 'lucide-react';
import { AvatarDaLudmilla } from '@/components/ludmilla/mundo/AvatarDaLudmilla';

/** A faixa do celular (spec §5, mockup "CelularLista"): menu, avatar e engrenagem, com toques de 44 px. */
export function FaixaDoCelular({ onMenu, onAjustes }: { onMenu: () => void; onAjustes: () => void }) {
  return (
    <header className="lm-sobre-petroleo flex items-center gap-2 bg-lm-petroleo px-3 py-2.5 text-white">
      <button
        type="button" aria-label="Abrir o menu da Ludmilla" onClick={onMenu} data-nav="menu"
        className="flex h-11 w-11 items-center justify-center rounded-md"
      >
        <Menu size={22} aria-hidden />
      </button>
      <span className="flex flex-1 items-center gap-2.5">
        <AvatarDaLudmilla tamanho={32} />
        <span className="text-[17px] font-extrabold">Ludmilla</span>
      </span>
      <button
        type="button" aria-label="Ajustes da Ludmilla" onClick={onAjustes} data-nav="ajustes"
        className="flex h-11 w-11 items-center justify-center rounded-md"
      >
        <Settings size={20} aria-hidden />
      </button>
    </header>
  );
}
```

- [ ] **Step 4: Escrever `src/components/ludmilla/pagina/ColunaDaEsquerda.tsx`**

```tsx
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { LinhaDeLeitura } from '@/lib/ludmillaLeituras';
import type { RecadoDoDia } from '@/lib/ludmillaRecado';

export interface ItemDeNavegacao {
  chave: string;
  rotulo: string;
  /** null = sem número (carregando, falhou, ou item sem contagem) */
  n: number | null;
  /** o número em alerta ("Parados além do normal") */
  alerta?: boolean;
  ativo: boolean;
  onClick: () => void;
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="mb-0.5 px-2.5 text-xs font-bold text-lm-suave">{titulo}</span>
      {children}
    </div>
  );
}

/** Um item da navegação: o escolhido fica em sol (spec §4.2). Alerta sobre a caixa é #8F2F09 (decisão 1). */
function ItemNav({ i }: { i: ItemDeNavegacao }) {
  return (
    <button
      type="button" onClick={i.onClick} aria-current={i.ativo ? 'true' : undefined} data-nav={i.chave}
      className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-[7px] text-left text-sm font-semibold',
        i.ativo ? 'bg-lm-sol' : 'hover:bg-lm-caixa-forte')}
    >
      <span>{i.rotulo}</span>
      {i.n !== null && <b className={cn('text-sm tabular-nums', i.alerta && !i.ativo && 'text-lm-alerta-texto')}>{i.n}</b>}
    </button>
  );
}

/**
 * A COLUNA DA ESQUERDA (spec §4.2), a única navegação da página: o recado do dia, Para decidir (com
 * "Fila de"), Carteira, Comigo e Leituras (clicar leva aos Ajustes). No celular ela vira o menu.
 */
export function ColunaDaEsquerda({ recado, grupos, donos, dono, onDono, carteira, comigo, leituras, onLeituras }: {
  /** null = carregando */
  recado: RecadoDoDia | null;
  grupos: ItemDeNavegacao[];
  donos: { valor: string; rotulo: string }[];
  dono: string;
  onDono: (valor: string) => void;
  carteira: ItemDeNavegacao[];
  comigo: ItemDeNavegacao[];
  leituras: LinhaDeLeitura[];
  onLeituras: () => void;
}) {
  const idDaFila = useId();
  return (
    <nav aria-label="Ludmilla" className="flex min-h-full flex-col gap-4 bg-lm-caixa px-3 py-4" data-coluna="esquerda">
      <div className="flex flex-col gap-1.5 rounded-lg bg-white px-3.5 py-3">
        {recado ? (
          <>
            <span className="text-xs font-bold text-lm-suave">{recado.data}</span>
            <p className="m-0 text-sm leading-normal" data-recado>{recado.texto}</p>
          </>
        ) : (
          <div role="status" aria-label="Carregando o recado" className="h-16 animate-pulse rounded bg-lm-caixa motion-reduce:animate-none" />
        )}
      </div>

      <Grupo titulo="Para decidir">
        {grupos.map(i => <ItemNav key={i.chave} i={i} />)}
        <div className="flex flex-wrap items-center gap-1 px-2.5 pt-1.5">
          <span id={idDaFila} className="mr-1 text-xs font-bold text-lm-suave">Fila de</span>
          <div role="group" aria-labelledby={idDaFila} className="flex flex-wrap gap-1">
            {donos.map(d => (
              <button
                key={d.valor} type="button" aria-pressed={d.valor === dono} onClick={() => onDono(d.valor)} data-dono={d.valor}
                className={cn('rounded-md border-[1.5px] px-2 py-1 text-xs font-bold',
                  d.valor === dono ? 'border-lm-petroleo bg-lm-petroleo text-white' : 'border-lm-borda bg-white')}
              >
                {d.rotulo}
              </button>
            ))}
          </div>
        </div>
      </Grupo>

      <Grupo titulo="Carteira">{carteira.map(i => <ItemNav key={i.chave} i={i} />)}</Grupo>
      <Grupo titulo="Comigo">{comigo.map(i => <ItemNav key={i.chave} i={i} />)}</Grupo>

      <button
        type="button" onClick={onLeituras} data-nav="leituras"
        className="flex flex-col gap-1.5 rounded-md px-2.5 py-1.5 text-left hover:bg-lm-caixa-forte"
      >
        <span className="text-xs font-bold text-lm-suave">Leituras</span>
        {leituras.map(l => (
          <span key={l.id} className={cn('flex justify-between gap-2 text-[13px]', l.alerta && 'font-bold text-lm-alerta-texto')}>
            <span>{l.nome}</span>
            <span>{l.texto}</span>
          </span>
        ))}
        <span className="sr-only">Abrir os Ajustes, onde eu leio</span>
      </button>
    </nav>
  );
}
```

- [ ] **Step 5: Escrever `src/components/ludmilla/pagina/FolhaDaLudmilla.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * A folha da Ludmilla: o detalhe e a ficha fora do computador grande, e o menu no celular. Não modal
 * (o aviso com "Desfazer", fora dela, continua clicável — como a folha de hoje). O "X" do Sheet some:
 * quem fecha é o cabeçalho petróleo ("‹ Agora" ou "Fechar"). A classe `.ludmilla-mundo` vai no
 * conteúdo porque o Radix desenha a folha fora da página (portal).
 */
export function FolhaDaLudmilla({ aberta, onFechar, lado = 'right', titulo, cabecalho, children, onCloseAutoFocus }: {
  aberta: boolean;
  onFechar: () => void;
  lado?: 'left' | 'right';
  /** para o leitor de tela */
  titulo: string;
  cabecalho: ReactNode;
  children: ReactNode;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  return (
    <Sheet open={aberta} modal={false} onOpenChange={o => { if (!o) onFechar(); }}>
      <SheetContent
        side={lado}
        className={cn('ludmilla-mundo flex w-full max-w-none flex-col gap-0 p-0 [&>button:last-child]:hidden',
          lado === 'right' ? 'sm:max-w-xl' : 'sm:max-w-sm')}
        onInteractOutside={e => {
          const alvo = e.target as Element | null;
          if (alvo?.closest?.('[data-sonner-toaster]')) e.preventDefault();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetTitle className="sr-only">{titulo}</SheetTitle>
        <SheetDescription className="sr-only">{titulo}</SheetDescription>
        <div className="lm-sobre-petroleo flex shrink-0 items-center justify-between gap-2 bg-lm-petroleo px-3 py-2 text-white">
          {cabecalho}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 6: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 7: Commit**

`$RASCUNHO/msg-e2-t12.txt` (Write):

```
feat(ludmilla): faixa, coluna da esquerda e folha (entrega 2, página)

A faixa petróleo (avatar, nome, "Analista de homologação", Ajustes), a
do celular (menu, avatar, engrenagem, toques de 44 px), a coluna da
esquerda como única navegação (recado, Para decidir com "Fila de",
Carteira, Comigo, Leituras) e a folha não modal para detalhe, ficha e
menu.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/components/ludmilla/pagina/FaixaDaLudmilla.tsx src/components/ludmilla/pagina/FaixaDoCelular.tsx src/components/ludmilla/pagina/ColunaDaEsquerda.tsx src/components/ludmilla/pagina/FolhaDaLudmilla.tsx
git commit -F "$RASCUNHO/msg-e2-t12.txt" -- src/components/ludmilla/pagina/FaixaDaLudmilla.tsx src/components/ludmilla/pagina/FaixaDoCelular.tsx src/components/ludmilla/pagina/ColunaDaEsquerda.tsx src/components/ludmilla/pagina/FolhaDaLudmilla.tsx
git show --stat HEAD
```

---

### Task 13: A casca da página — vista, seleção, decisão e os três modos (com harness e auditoria)

**Files:**
- Create: `src/components/ludmilla/pagina/useEscolhaEDecisao.ts`
- Create: `src/components/ludmilla/pagina/PaginaDaLudmilla.tsx`
- Create: `src/lib/ludmillaPagina.fixtures.ts`
- Create: `src/lib/ludmillaPagina.fixtures.test.ts` (Step 11b: os números do Step 8 sem navegador — é o consumidor que fica das fixtures)
- Test (harness, apagar antes do commit): `harness-ludmilla-e2.html`, `src/harness-ludmilla-e2.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 1–12; `proximaDepoisDe`, `selecaoValida`, `ItemDaCaixa` (`ludmillaCaixa.ts`); `argumentosDaDecisao`, `executarDecisao`, `textoDaDecisao`, `AcaoDaDecisao`, `AcoesDaDecisao`, `oQueChegou`, `ressalvaDoCartao` (`ludmillaPainel.ts`); `useAlturaDaCaixa` (`decidir/altura.ts`); `useFilaDeDecisoes`; `DetalheDaDecisao`; fixtures de `ludmillaCaixa.fixtures.ts` e `ludmillaCobranca.fixtures.ts`; `rascunhoDaCobranca` (`ludmillaCobranca.ts`); `rascunhoDoPedido`, `PedidoTroca` (`ludmillaPedidoTroca.ts`).
- Produces: `useEscolhaEDecisao({ lista, abrirPrimeira, decidir, acoes, rotuloEtapa }): { selecionada: string | null; escolher(chave: string | null): void; decidirItem(item, acao, etapa, texto?): void }`; `VistaDaLudmilla`; `DecidirItem`; `PropsDaPagina` (abaixo); `PaginaDaLudmilla(p: PropsDaPagina)` (`data-modo`, `data-coluna="meio"`, `data-coluna="direita"`). Fixtures: `ANA`, `BRUNO`, `U_HOJE`, `CARTEIRA_DE_EXEMPLO`, `NORMAIS_DE_EXEMPLO`, `REGISTRO_DE_EXEMPLO`, `PEDIDO_DE_EXEMPLO`, `ETAPAS_DO_KANBAN`.

- [ ] **Step 1: Medir o baseline**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Escrever as fixtures da página — `src/lib/ludmillaPagina.fixtures.ts`**

```ts
/**
 * DADOS INVENTADOS para o harness da página nova da Ludmilla (entrega 2). Nenhum nome, protocolo ou
 * número aqui é de verdade. Código do app NUNCA importa este arquivo. "Agora" = AGORA de
 * ludmillaCaixa.fixtures (22/10/2026 09:00 de Brasília, quinta).
 */
import type { PortalUpdate, RegistroLudmilla } from '@/hooks/useLudmilla';
import type { LinhaDaCarteira, NormalDaEtapa } from '@/lib/ludmillaCarteira';
import type { PedidoTroca } from '@/lib/ludmillaPedidoTroca';
import { U_CPFL } from '@/lib/ludmillaCaixa.fixtures';

export const ANA = { id: 'pessoa-ana', nome: 'Ana Lima' };
export const BRUNO = { id: 'pessoa-bruno', nome: 'Bruno Costa' };

/** Uma recomendação de etapa que chegou HOJE (vai para Agora). */
export const U_HOJE: PortalUpdate = {
  ...U_CPFL, id: 'u-hoje', protocolo: '7002222', detectado_em: '2026-10-22T10:30:00Z', project_id: 'p-9',
  project: { ...U_CPFL.project!, id: 'p-9', code: 'PRJ-10009', title: 'Rogério Lins', project_general_data: { holder_name: 'Rogério Lins' } },
};

const linha = (x: Partial<LinhaDaCarteira> & Pick<LinhaDaCarteira, 'projectId' | 'codigo'>): LinhaDaCarteira => ({
  titular: null, empresa: null, companyId: null, concessionaria: 'CPFL Paulista', concessionaireId: 'conc-cpfl',
  status: 'analysis', naEtapaDesde: '2026-10-10T12:00:00Z', diasNaEtapa: 5, normalDias: 8, normalFonte: 'medido',
  atrasoDias: -3, comQuem: 'concessionaria', donos: [], historico: [], naFila: false, ...x,
});

/** p-1…p-4 e p-7 casam com os itens de ludmillaCaixa.fixtures; p-4 e p-7 (Energia Boa) ficam sem dono. */
export const CARTEIRA_DE_EXEMPLO: LinhaDaCarteira[] = [
  linha({ projectId: 'p-1', codigo: 'PRJ-10001', titular: 'Marta Ribeiro Campos', empresa: 'Solar Alfa', status: 'analysis',
    diasNaEtapa: 12.4, normalDias: 8, atrasoDias: 4.4, comQuem: 'nos', naFila: true, donos: [ANA],
    historico: [{ etapa: 'pending', dias: 3, atual: false }, { etapa: 'analysis', dias: 12.4, atual: true }] }),
  linha({ projectId: 'p-2', codigo: 'PRJ-10002', titular: 'João Pedro Lima', empresa: 'Sol Nascente', concessionaria: 'ENEL SP',
    concessionaireId: 'conc-enel', status: 'documentation', diasNaEtapa: 4, normalDias: 6, atrasoDias: -2, comQuem: 'nos', naFila: true,
    donos: [BRUNO], historico: [{ etapa: 'pending', dias: 2, atual: false }, { etapa: 'analysis', dias: 9, atual: false }, { etapa: 'documentation', dias: 4, atual: true }] }),
  linha({ projectId: 'p-3', codigo: 'PRJ-10003', titular: 'Ana Paula Reis', empresa: 'Solar Alfa', concessionaria: 'ENEL SP',
    concessionaireId: 'conc-enel', status: 'analysis', diasNaEtapa: 1, normalDias: 2, atrasoDias: -1, comQuem: 'nos', naFila: true,
    donos: [ANA, BRUNO], historico: [{ etapa: 'analysis', dias: 1, atual: true }] }),
  linha({ projectId: 'p-4', codigo: 'PRJ-10004', titular: 'Rita de Cássia Prado', empresa: 'Energia Boa', concessionaria: 'EDP São Paulo',
    concessionaireId: 'conc-edp', status: 'analysis', diasNaEtapa: 3, normalDias: 8, normalFonte: 'medido', atrasoDias: -5, comQuem: 'nos',
    naFila: true, historico: [{ etapa: 'analysis', dias: 3, atual: true }] }),
  linha({ projectId: 'p-7', codigo: 'PRJ-10007', titular: 'Diego Martins', empresa: 'Energia Boa', concessionaria: 'ENEL SP',
    concessionaireId: 'conc-enel', status: 'approved', diasNaEtapa: 41.2, normalDias: 32, atrasoDias: 9.2, comQuem: 'nos', naFila: true,
    historico: [{ etapa: 'analysis', dias: 2, atual: false }, { etapa: 'documentation', dias: 8, atual: false }, { etapa: 'approved', dias: 41.2, atual: true }] }),
  linha({ projectId: 'p-9', codigo: 'PRJ-10009', titular: 'Rogério Lins', empresa: 'Solar Alfa', status: 'analysis', diasNaEtapa: 18,
    normalDias: 8, atrasoDias: 10, comQuem: 'nos', naFila: true, donos: [ANA], historico: [{ etapa: 'analysis', dias: 18, atual: true }] }),
  linha({ projectId: 'p-11', codigo: 'PRJ-10011', titular: 'Helena Castro', empresa: 'Sol Nascente', status: 'vistoria_solicitada',
    diasNaEtapa: 6, normalDias: 10, atrasoDias: -4, comQuem: 'concessionaria', donos: [BRUNO],
    historico: [{ etapa: 'analysis', dias: 6, atual: false }, { etapa: 'approved', dias: 8, atual: false }, { etapa: 'vistoria_solicitada', dias: 6, atual: true }] }),
  linha({ projectId: 'p-12', codigo: 'PRJ-10012', titular: 'Antônio Freitas', empresa: 'Solar Alfa', status: 'pendencia', diasNaEtapa: 19,
    normalDias: 6, normalFonte: 'geral', atrasoDias: 13, comQuem: 'cliente', donos: [ANA],
    historico: [{ etapa: 'analysis', dias: 10, atual: false }, { etapa: 'pendencia', dias: 19, atual: true }] }),
  linha({ projectId: 'p-13', codigo: 'PRJ-10013', titular: 'Joana Bastos', empresa: 'Brisa Energia', concessionaria: 'Energisa',
    concessionaireId: 'conc-energisa', status: 'analysis', diasNaEtapa: 3, normalDias: null, normalFonte: null, atrasoDias: null,
    comQuem: 'concessionaria' }),
];

const normal = (concessionaireId: string, etapa: string, normalDias: number, fonte: NormalDaEtapa['fonte'] = 'medido'): NormalDaEtapa =>
  ({ concessionaireId, etapa, normalDias, amostra: 7, fonte });

export const NORMAIS_DE_EXEMPLO: NormalDaEtapa[] = ['conc-cpfl', 'conc-enel', 'conc-edp'].flatMap(c => [
  normal(c, 'pending', 3),
  normal(c, 'analysis', c === 'conc-enel' ? 2 : 8),
  normal(c, 'documentation', 6),
  normal(c, 'approved', 32),
  normal(c, 'vistoria_solicitada', 10),
  normal(c, 'pendencia', 6, 'geral'),
]);

const ev = (x: Partial<RegistroLudmilla> & Pick<RegistroLudmilla, 'quando' | 'acao' | 'titulo'>): RegistroLudmilla => ({
  ator: 'ludmilla', quem: 'Ludmilla', detalhe: null, situacao: 'ok', project_id: null, projeto: null, protocolo: null, ...x,
});

export const REGISTRO_DE_EXEMPLO: RegistroLudmilla[] = [
  ev({ quando: '2026-10-22T11:02:00Z', acao: 'visita', quem: 'agendamento', titulo: 'Varredura no portal CPFL Paulista',
    detalhe: '199 protocolos lidos · 1 recomendação(ões)' }),
  ev({ quando: '2026-10-22T11:01:00Z', acao: 'anexo', titulo: 'Anexo da concessionária no card',
    detalhe: 'parecer-7001234.pdf · protocolo 7001234 · conferido por cpf', project_id: 'p-1', projeto: 'PRJ-10001', protocolo: '7001234' }),
  ev({ quando: '2026-10-22T10:30:00Z', acao: 'visita', quem: 'agendamento', titulo: 'Leitura dos e-mails da ENEL SP',
    detalhe: '12 projetos conferidos · 1 documento(s) anexado(s)' }),
  ev({ quando: '2026-10-21T21:00:00Z', acao: 'parecer', titulo: 'Parecer da concessionária no card',
    detalhe: 'Análise técnica · APROVADO · protocolo 7001234', project_id: 'p-1', projeto: 'PRJ-10001' }),
  ev({ quando: '2026-10-21T17:40:00Z', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada', titulo: 'Recomendação aplicada',
    detalhe: 'Protocolo 7005555 · PRJ-10005 → approved', project_id: 'p-5', projeto: 'PRJ-10005' }),
  ev({ quando: '2026-10-20T20:00:00Z', acao: 'visita', quem: 'agendamento', titulo: 'Varredura no portal Elektro', situacao: 'erro',
    detalhe: 'sessão expirada' }),
];

/** O pedido da troca do A fazer de vistoria aprovada (F_VISTORIA), liberado. */
export const PEDIDO_DE_EXEMPLO: PedidoTroca = {
  liberado: true, motivo: null, para: 'canalgd.sp@exemplo.test', assunto: 'TROCA DE RELÓGIO - DIEGO MARTINS - NT 900000777',
  nt: '900000777', titular: 'Diego Martins', aprovacao_em: '2026-10-20T08:00:00Z', ja_pedido_em: null,
  pedido_situacao: null, pedido_erro: null, pedido_texto: null,
};

export const ETAPAS_DO_KANBAN = [
  'pending', 'analysis', 'documentation', 'approval', 'approved', 'pendencia', 'vistoria_solicitada',
  'aguardando_instalacao', 'vistoria_sem_protocolo', 'vistoria_reprovada', 'completed',
];
```

- [ ] **Step 3: Escrever o harness (o teste de tela)**

Crie `harness-ludmilla-e2.html` (raiz):

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Harness — Ludmilla, página nova</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/harness-ludmilla-e2.tsx"></script>
  </body>
</html>
```

Crie `src/harness-ludmilla-e2.tsx`:

```tsx
// HARNESS DA PÁGINA NOVA DA LUDMILLA — dados inventados, nenhuma rede além da fonte. APAGAR antes do commit.
// ?papel=staff abre como a projetista Ana; ?captcha=1 mostra o alerta urgente.
import '@/index.css';
import { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import { DetalheDaDecisao } from '@/components/ludmilla/decidir/PainelDeDetalhe';
import { FichaDoProjeto } from '@/components/ludmilla/pagina/FichaDoProjeto';
import { PaginaDaLudmilla } from '@/components/ludmilla/pagina/PaginaDaLudmilla';
import { modoDaPagina } from '@/components/ludmilla/pagina/modo';
import type { PortalAccount } from '@/hooks/useLudmilla';
import { useFilaDeDecisoes } from '@/hooks/useFilaDeDecisoes';
import { useWindowSize } from '@/hooks/useWindowSize';
import { itensDaCaixa } from '@/lib/ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, AGORA, CONTAS_DE_EXEMPLO, DOCUMENTOS_DE_EXEMPLO, ETAPAS_DE_EXEMPLO, LINHA_DO_TEMPO_DE_EXEMPLO,
  MENSAGEM_DA_TROCA, UPDATES_DE_EXEMPLO, nomeDaContaDeExemplo, rotuloDeExemplo,
} from '@/lib/ludmillaCaixa.fixtures';
import { donosPorProjetoDe, proximoPasso } from '@/lib/ludmillaCarteira';
import { rascunhoDaCobranca } from '@/lib/ludmillaCobranca';
import { F_COBRANCA } from '@/lib/ludmillaCobranca.fixtures';
import { resumoDaFila } from '@/lib/ludmillaFila';
import { fraseDaProximaLeitura, linhasDeLeitura, proximaLeitura, textoDaListaVazia } from '@/lib/ludmillaLeituras';
import { oQueChegou, ressalvaDoCartao, type AcoesDaDecisao } from '@/lib/ludmillaPainel';
import { CARTEIRA_DE_EXEMPLO, ETAPAS_DO_KANBAN, NORMAIS_DE_EXEMPLO, PEDIDO_DE_EXEMPLO, REGISTRO_DE_EXEMPLO, U_HOJE } from '@/lib/ludmillaPagina.fixtures';
import { rascunhoDoPedido } from '@/lib/ludmillaPedidoTroca';
import { diarioPorDia, fezSozinha, recadoDoDia, rotuloDoDesde } from '@/lib/ludmillaRecado';

declare global { interface Window { __decisoes: string[] } }
window.__decisoes = [];
const gravar = (o: string) => { window.__decisoes.push(o); return Promise.resolve(); };
const busca = new URLSearchParams(location.search);
const USUARIO = busca.get('papel') === 'staff'
  ? { id: 'pessoa-ana', role: 'staff', name: 'Ana Lima' }
  : { id: 'chefe', role: 'admin', name: 'Gestor Exemplo' };
const DESDE = Date.parse('2026-10-21T21:00:00Z');
const estacaoDe = (c: PortalAccount) => (c.modo === 'local' ? { online: true, texto: 'estação online' } : null);

function Harness() {
  const { width } = useWindowSize();
  const itens = useMemo(() => itensDaCaixa({
    updates: [...UPDATES_DE_EXEMPLO, U_HOJE], afazeres: [...AFAZERES_DE_EXEMPLO, F_COBRANCA],
    contas: CONTAS_DE_EXEMPLO, nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
  }), []);
  const { ocultos, decidir } = useFilaDeDecisoes(itens);
  const acoes: AcoesDaDecisao = {
    aplicar: (id, etapa) => gravar(`aplicar:${id}:${etapa ?? ''}`),
    ignorar: id => gravar(`ignorar:${id}`),
    feito: id => gravar(`feito:${id}`),
    enviarCobranca: (id, t) => gravar(`cobranca:${id}:${t.length}`),
    dispensarCobranca: id => gravar(`dispensar:${id}`),
    enviarPedido: (id, t) => gravar(`pedido:${id}:${t.length}`),
  };
  const feitos = fezSozinha(REGISTRO_DE_EXEMPLO, DESDE);
  const resumo = resumoDaFila(itens, { ocultos, agora: AGORA, donosPorProjeto: donosPorProjetoDe(CARTEIRA_DE_EXEMPLO) });
  const recado = recadoDoDia({
    agora: AGORA, desde: DESDE, fizSozinha: feitos.length, separei: resumo.total, paraAgora: resumo.agora, semDono: resumo.semDono,
    leituras: [
      { nome: 'ENEL SP', meio: 'email', emails: 12, protocolos: null },
      { nome: 'CPFL Paulista', meio: 'portal', emails: null, protocolos: 199 },
    ],
  });
  const nada = () => undefined;

  return (
    <div className="flex min-h-screen bg-[#F0F0F0]">
      {width >= 640 && <div aria-hidden className="w-64 shrink-0 bg-[#1A1A1A]" />}
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <PaginaDaLudmilla
          modo={modoDaPagina(width)} agora={AGORA} usuario={USUARIO} rotuloEtapa={rotuloDeExemplo} ordemDasEtapas={ETAPAS_DO_KANBAN}
          itens={itens} ocultos={ocultos} decidir={decidir} acoes={acoes}
          fila={{ carregando: false, buscando: false, erro: null, tentar: nada }}
          carteira={CARTEIRA_DE_EXEMPLO} normais={NORMAIS_DE_EXEMPLO}
          estadoDaCarteira={{ carregando: false, buscando: false, erro: null, tentar: nada }}
          recado={recado} feitos={feitos} rotuloDoDesde={rotuloDoDesde(DESDE, AGORA)}
          diario={diarioPorDia(REGISTRO_DE_EXEMPLO, AGORA)}
          estadoDoDiario={{ carregando: false, erro: null, tentar: nada, podeVerMais: false, verMais: nada }}
          leituras={linhasDeLeitura(CONTAS_DE_EXEMPLO, { nomeDaConta: nomeDaContaDeExemplo, estacaoDe, caixaPronta: true, captchas: [], agora: AGORA })}
          textoDaListaVazia={textoDaListaVazia(fraseDaProximaLeitura(proximaLeitura(CONTAS_DE_EXEMPLO, nomeDaContaDeExemplo, AGORA), AGORA))}
          alertaUrgente={busca.get('captcha') ? (
            <div role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              A Ludmilla precisa do código da imagem — Elektro (exemplo)
            </div>
          ) : null}
          detalhe={(item, layout, onDecidir, topo, historico) => {
            const mensagem = item.id === 'u-enel-troca' ? MENSAGEM_DA_TROCA : null;
            const ehPedido = item.afazer?.tipo === 'vistoria_aprovada';
            const cobranca = item.afazer?.cobranca ?? null;
            const texto = ehPedido ? rascunhoDoPedido(PEDIDO_DE_EXEMPLO, new Date(AGORA))
              : cobranca ? rascunhoDaCobranca(cobranca, new Date(AGORA)) : null;
            return (
              <DetalheDaDecisao
                key={item.chave} layout={layout} onDecidir={onDecidir} topo={topo} historico={historico}
                onAbrirProjeto={id => window.__decisoes.push(`abrir:${id}`)}
                urlDoDocumento={async () => 'data:text/plain,documento-de-exemplo'}
                dados={{
                  item,
                  chegou: item.update ? oQueChegou(item.update, mensagem, item.meio) : null,
                  ressalva: item.update ? ressalvaDoCartao(item.update, mensagem) : null,
                  projeto: item.projectId ? { uc: '0123456789', protocoloNoCadastro: item.update?.protocolo_anterior ?? item.protocolo } : null,
                  documentos: item.projectId ? DOCUMENTOS_DE_EXEMPLO : null,
                  linhaDoTempo: item.projectId ? LINHA_DO_TEMPO_DE_EXEMPLO : [],
                  etapas: ETAPAS_DE_EXEMPLO, rotuloEtapa: rotuloDeExemplo,
                  rascunhoDaCobranca: texto, pedido: ehPedido ? PEDIDO_DE_EXEMPLO : null,
                }}
              />
            );
          }}
          ficha={(linha, historico, onVerNaFila) => (
            <FichaDoProjeto
              key={linha.projectId} linha={linha} historico={historico} leituras={LINHA_DO_TEMPO_DE_EXEMPLO}
              proximo={proximoPasso(linha, rotuloDeExemplo)} onVerNaFila={onVerNaFila}
              onAbrirProjeto={id => window.__decisoes.push(`abrir:${id}`)} rotuloEtapa={rotuloDeExemplo}
            />
          )}
          ondeEuLeio={() => <div className="p-5 text-sm" data-painel="onde-eu-leio">Onde eu leio (no app: os cartões das contas)</div>}
          onAbrirProjeto={id => window.__decisoes.push(`abrir:${id}`)}
        />
      </main>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
```

- [ ] **Step 4: Abrir o harness e ver falhar**

Run (em segundo plano): `npx vite --port 5182 --strictPort`
Abra `http://localhost:5182/harness-ludmilla-e2.html` no navegador do Claude.
Expected: erro do Vite `Failed to resolve import "@/components/ludmilla/pagina/PaginaDaLudmilla"`.

- [ ] **Step 5: Escrever `src/components/ludmilla/pagina/useEscolhaEDecisao.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import { proximaDepoisDe, selecaoValida, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import {
  argumentosDaDecisao, executarDecisao, textoDaDecisao, type AcaoDaDecisao, type AcoesDaDecisao,
} from '@/lib/ludmillaPainel';

/** Depois de uma decisão, as que chegarem antes disto são o mesmo gesto repetido (clique duplo), não uma nova. */
const INTERVALO_ENTRE_DECISOES_MS = 700;

/**
 * A COLA DA FILA (spec §4.5): qual item está aberto, decidir e ir ao próximo. É a lógica da antiga
 * aba Decidir, com UMA diferença: o detalhe só passa ao próximo (e recebe o foco) quando a decisão é
 * do item aberto. O id e o texto de cada decisão vêm de `argumentosDaDecisao`/`textoDaDecisao`
 * (com teste), e quem grava é a fila do Desfazer (`decidir` de `useFilaDeDecisoes`, 8 s).
 *
 * O foco vai para o detalhe só a pedido de um gesto (decidir, ou escolher no computador), nunca ao
 * abrir a página. Decidir pelo botão de um cartão que NÃO é o aberto não mexe no aberto.
 */
export function useEscolhaEDecisao(o: {
  lista: ItemDaCaixa[];
  /** computador: o primeiro item já abre ao lado; fora dele nada abre sozinho */
  abrirPrimeira: boolean;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  acoes: AcoesDaDecisao;
  rotuloEtapa: (s: string | null | undefined) => string;
}) {
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const efetiva = selecaoValida(o.lista, selecionada, o.abrirPrimeira);
  const ultimaDecisaoEm = useRef(0);
  const focarDetalhe = useRef(false);

  useEffect(() => {
    if (!focarDetalhe.current) return;
    focarDetalhe.current = false;
    if (!efetiva) return;
    const alvo = [...document.querySelectorAll<HTMLElement>('[data-detalhe]')].find(d => d.dataset.detalhe === efetiva);
    alvo?.focus({ preventScroll: true });
  });

  const escolher = (chave: string | null) => {
    if (chave && o.abrirPrimeira) focarDetalhe.current = true;
    setSelecionada(chave);
  };

  const decidirItem = (item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null, texto?: string) => {
    // Decidido, o painel troca NA HORA para o próximo item com os botões no mesmo lugar: o segundo
    // clique de um clique duplo cairia no item seguinte.
    const agora = Date.now();
    if (agora - ultimaDecisaoEm.current < INTERVALO_ENTRE_DECISOES_MS) return;
    ultimaDecisaoEm.current = agora;
    const chamada = argumentosDaDecisao(item, acao, etapa, texto);
    o.decidir(item.chave, textoDaDecisao(item, acao, etapa, o.rotuloEtapa), () => executarDecisao(o.acoes, chamada));
    if (item.chave === efetiva) {
      focarDetalhe.current = true;
      setSelecionada(proximaDepoisDe(o.lista, item.chave));
    }
  };

  return { selecionada: efetiva, escolher, decidirItem };
}
```

- [ ] **Step 6: Escrever `src/components/ludmilla/pagina/PaginaDaLudmilla.tsx`**

```tsx
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import type { AcaoDaDecisao, AcoesDaDecisao } from '@/lib/ludmillaPainel';
import { barrasDoHistorico, type Barra } from '@/lib/ludmillaBarras';
import {
  FILTROS_DA_CARTEIRA, contarCarteira, donosPorProjetoDe, filtrarCarteira, normaisDaConcessionaria, projetistasDaCarteira,
  tempoDaLinha, type FiltroDaCarteira, type LinhaDaCarteira, type NormalDaEtapa,
} from '@/lib/ludmillaCarteira';
import {
  GRUPOS_DA_FILA, TODOS, botaoDoCartao, donosDoItem, filaInicial, filaPorGrupo, grupoDoItem, linhaDoProjeto, opcoesDeDono,
  porqueDoItem, prazoDoItem, textoDoFiltroDeDono, tituloDoItem, type FiltroDeDono, type GrupoDaFila, type UsuarioDaPagina,
} from '@/lib/ludmillaFila';
import type { LinhaDeLeitura } from '@/lib/ludmillaLeituras';
import type { DiaDoDiario, FeitoSozinha, RecadoDoDia } from '@/lib/ludmillaRecado';
import { useAlturaDaCaixa } from '@/components/ludmilla/decidir/altura';
import { HistoricoGrande } from '@/components/ludmilla/mundo/HistoricoEmBarras';
import { Esqueleto } from '@/components/ludmilla/mundo/pecas';
import { useFonteDaLudmilla } from '@/components/ludmilla/mundo/useFonteDaLudmilla';
import { AjustesDaLudmilla } from './AjustesDaLudmilla';
import type { DadosDoCartao } from './CartaoDaFila';
import { ColunaDaEsquerda, type ItemDeNavegacao } from './ColunaDaEsquerda';
import { Diario, PainelDoRecado, type EstadoDoDiario } from './Diario';
import { FaixaDaLudmilla } from './FaixaDaLudmilla';
import { FaixaDoCelular } from './FaixaDoCelular';
import { FizSozinha, PainelDoQueFacoSozinha } from './FizSozinha';
import { FolhaDaLudmilla } from './FolhaDaLudmilla';
import type { DadosDaLinha } from './LinhaDaCarteira';
import { ListaDaCarteira } from './ListaDaCarteira';
import { ListaDaFila } from './ListaDaFila';
import { TopoDaDecisao } from './TopoDaDecisao';
import type { ModoDaPagina } from './modo';
import { useEscolhaEDecisao } from './useEscolhaEDecisao';

export type VistaDaLudmilla =
  | { tipo: 'decidir'; grupo: GrupoDaFila }
  | { tipo: 'carteira'; filtro: FiltroDaCarteira }
  | { tipo: 'sozinha' }
  | { tipo: 'diario' }
  | { tipo: 'ajustes' };

export type DecidirItem = (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void;

interface EstadoDaConsulta { carregando: boolean; buscando: boolean; erro: string | null; tentar: () => void }

export interface PropsDaPagina {
  modo: ModoDaPagina;
  agora: number;
  usuario: UsuarioDaPagina | null;
  rotuloEtapa: (s: string | null | undefined) => string;
  /** as colunas do Kanban do tenant, em ordem (`useStatusOrder`) */
  ordemDasEtapas: string[];
  itens: ItemDaCaixa[];
  ocultos: ReadonlySet<string>;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  acoes: AcoesDaDecisao;
  fila: EstadoDaConsulta;
  carteira: LinhaDaCarteira[];
  normais: NormalDaEtapa[];
  estadoDaCarteira: EstadoDaConsulta;
  /** null = carregando */
  recado: RecadoDoDia | null;
  feitos: FeitoSozinha[];
  /** "Desde sexta" */
  rotuloDoDesde: string;
  diario: DiaDoDiario[];
  estadoDoDiario: EstadoDoDiario;
  leituras: LinhaDeLeitura[];
  textoDaListaVazia: string;
  /** o código da imagem da Elektro: acima de tudo (spec §4.5) */
  alertaUrgente: ReactNode;
  /** o que lê banco fica do lado de fora: no app `DetalheConectado`, no harness o detalhe com fixtures */
  detalhe: (item: ItemDaCaixa, layout: 'painel' | 'folha', onDecidir: DecidirItem, topo: ReactNode, historico: ReactNode) => ReactNode;
  ficha: (linha: LinhaDaCarteira, historico: ReactNode, onVerNaFila: (() => void) | null) => ReactNode;
  ondeEuLeio: () => ReactNode;
  onAbrirProjeto: (projectId: string) => void;
}

const SEM_ITENS: ItemDaCaixa[] = [];

function tituloDaVista(vista: VistaDaLudmilla, rotuloDoDesde: string): [string, string] {
  switch (vista.tipo) {
    case 'decidir': {
      const g = GRUPOS_DA_FILA.find(x => x.valor === vista.grupo) ?? GRUPOS_DA_FILA[0];
      return [g.rotulo, g.dica];
    }
    case 'carteira':
      return [FILTROS_DA_CARTEIRA.find(f => f.valor === vista.filtro)?.rotulo ?? 'Carteira', 'o mais passado do normal primeiro'];
    case 'sozinha':
      return ['Fiz sozinha', rotuloDoDesde.charAt(0).toLowerCase() + rotuloDoDesde.slice(1)];
    case 'diario':
      return ['Diário', 'o que eu li e fiz, e o que a equipe decidiu'];
    case 'ajustes':
      return ['Ajustes', 'o que eu faço sozinha, como eu aviso e onde eu leio'];
  }
}

function CabecalhoDoMeio({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <h1 className="m-0 text-[22px] font-extrabold">{titulo}</h1>
      <span className="text-[13px] text-lm-suave">{subtitulo}</span>
    </div>
  );
}

/**
 * A PÁGINA NOVA DA LUDMILLA (spec 2026-11-08, estrutura A no mundo "Conta de luz").
 *
 * Três colunas a partir de 1280 px (navegação, lista, detalhe/ficha/painel); de 960 a 1279, a
 * navegação e a lista, com o detalhe numa folha; abaixo de 960, uma coluna por vez (spec §5). Não lê
 * banco: recebe tudo pronto (no app, `pages/Ludmilla.tsx`; no harness, dados inventados).
 */
export function PaginaDaLudmilla(p: PropsDaPagina) {
  useFonteDaLudmilla();
  const [vista, setVista] = useState<VistaDaLudmilla>({ tipo: 'decidir', grupo: 'agora' });
  const [dono, setDono] = useState<FiltroDeDono>(() => filaInicial(p.usuario));
  const [projetoEscolhido, setProjetoEscolhido] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const ladoALado = p.modo === 'tres';
  const { ref: grade, altura } = useAlturaDaCaixa(p.modo !== 'uma');

  const donosPorProjeto = useMemo(() => donosPorProjetoDe(p.carteira), [p.carteira]);
  const linhaPorProjeto = useMemo(() => new Map(p.carteira.map(l => [l.projectId, l])), [p.carteira]);
  const barrasPorProjeto = useMemo(() => new Map<string, Barra[]>(p.carteira.map(l => [l.projectId, barrasDoHistorico({
    historico: l.historico, status: l.status, diasNaEtapa: l.diasNaEtapa, ordem: p.ordemDasEtapas,
    normais: normaisDaConcessionaria(p.normais, l.concessionaireId), rotuloEtapa: p.rotuloEtapa,
  })])), [p.carteira, p.normais, p.ordemDasEtapas, p.rotuloEtapa]);
  const fila = useMemo(
    () => filaPorGrupo(p.itens, { ocultos: p.ocultos, agora: p.agora, donosPorProjeto, dono }),
    [p.itens, p.ocultos, p.agora, donosPorProjeto, dono],
  );
  const contagem = useMemo(() => contarCarteira(p.carteira), [p.carteira]);
  const opcoes = useMemo(() => opcoesDeDono(projetistasDaCarteira(p.carteira), p.usuario), [p.carteira, p.usuario]);

  const lista = vista.tipo === 'decidir' ? fila[vista.grupo] : SEM_ITENS;
  const linhas = useMemo(() => (vista.tipo === 'carteira' ? filtrarCarteira(p.carteira, vista.filtro) : []), [p.carteira, vista]);
  const { selecionada, escolher, decidirItem } = useEscolhaEDecisao({
    lista, abrirPrimeira: ladoALado, decidir: p.decidir, acoes: p.acoes, rotuloEtapa: p.rotuloEtapa,
  });
  const projetoAberto = linhas.some(l => l.projectId === projetoEscolhido)
    ? projetoEscolhido
    : (ladoALado ? linhas[0]?.projectId ?? null : null);
  const itemAberto = lista.find(i => i.chave === selecionada) ?? null;
  const linhaAberta = linhas.find(l => l.projectId === projetoAberto) ?? null;

  const irPara = (v: VistaDaLudmilla) => {
    setVista(v);
    setMenuAberto(false);
    setProjetoEscolhido(null);
    escolher(null);
  };

  const historicoDe = (linha: LinhaDaCarteira | null): ReactNode => {
    if (!linha) return null;
    const t = tempoDaLinha(linha, p.rotuloEtapa);
    return (
      <HistoricoGrande
        barras={barrasPorProjeto.get(linha.projectId) ?? []} resumo={`${t.dias} ${t.em}, ${t.normalLongo}`}
        alerta={t.alerta} concessionaria={linha.concessionaria}
      />
    );
  };

  const cartaoDe = (item: ItemDaCaixa): DadosDoCartao => {
    const linha = item.projectId ? linhaPorProjeto.get(item.projectId) ?? null : null;
    return {
      chave: item.chave,
      titulo: tituloDoItem(item, p.rotuloEtapa),
      projeto: linhaDoProjeto(item),
      porque: porqueDoItem(item),
      prazo: prazoDoItem(item, p.agora),
      donos: donosDoItem(item, donosPorProjeto),
      barras: linha ? barrasPorProjeto.get(linha.projectId) ?? null : null,
      tempo: linha ? tempoDaLinha(linha, p.rotuloEtapa) : null,
      botao: botaoDoCartao(item, p.rotuloEtapa),
    };
  };

  const dadosDaLinha = (l: LinhaDaCarteira): DadosDaLinha => ({
    projectId: l.projectId, codigo: l.codigo, titular: l.titular, concessionaria: l.concessionaria,
    barras: barrasPorProjeto.get(l.projectId) ?? [], tempo: tempoDaLinha(l, p.rotuloEtapa), comQuem: l.comQuem, donos: l.donos,
  });

  /** O botão do cartão: decide direto ou abre o detalhe (decisão 13). */
  const noBotao = (chave: string) => {
    const item = lista.find(i => i.chave === chave);
    if (!item) return;
    const b = botaoDoCartao(item, p.rotuloEtapa);
    if (b.tipo === 'decidir') decidirItem(item, b.acao, null);
    else escolher(item.chave);
  };

  /** "Ver na fila" da ficha: o primeiro item pendente do projeto, no grupo dele, na fila de todos. */
  const verNaFila = (linha: LinhaDaCarteira): (() => void) | null => {
    const item = p.itens.find(i => i.projectId === linha.projectId && i.situacao === 'pendente' && !p.ocultos.has(i.chave));
    if (!item) return null;
    return () => {
      setDono(TODOS);
      setVista({ tipo: 'decidir', grupo: grupoDoItem(item, p.agora) });
      setProjetoEscolhido(null);
      escolher(item.chave);
    };
  };

  const semNumero = (e: EstadoDaConsulta) => e.carregando || e.erro !== null;
  const navGrupos: ItemDeNavegacao[] = GRUPOS_DA_FILA.map(g => ({
    chave: `grupo-${g.valor}`, rotulo: g.rotulo, n: semNumero(p.fila) ? null : fila[g.valor].length,
    ativo: vista.tipo === 'decidir' && vista.grupo === g.valor,
    onClick: () => irPara({ tipo: 'decidir', grupo: g.valor }),
  }));
  const navCarteira: ItemDeNavegacao[] = FILTROS_DA_CARTEIRA.map(f => ({
    chave: `carteira-${f.valor}`, rotulo: f.rotulo, n: semNumero(p.estadoDaCarteira) ? null : contagem[f.valor],
    alerta: f.valor === 'parados', ativo: vista.tipo === 'carteira' && vista.filtro === f.valor,
    onClick: () => irPara({ tipo: 'carteira', filtro: f.valor }),
  }));
  const navComigo: ItemDeNavegacao[] = [
    { chave: 'sozinha', rotulo: 'Fiz sozinha', n: p.feitos.length, ativo: vista.tipo === 'sozinha', onClick: () => irPara({ tipo: 'sozinha' }) },
    { chave: 'diario', rotulo: 'Diário', n: null, ativo: vista.tipo === 'diario', onClick: () => irPara({ tipo: 'diario' }) },
  ];

  const meio = (): ReactNode => {
    switch (vista.tipo) {
      case 'decidir':
        return (
          <ListaDaFila
            cartoes={lista.map(cartaoDe)} aberto={selecionada} onAbrir={chave => escolher(chave)} onBotao={noBotao}
            carregando={p.fila.carregando} erro={p.fila.erro} buscando={p.fila.buscando} onTentar={p.fila.tentar}
            vazio={p.textoDaListaVazia}
          />
        );
      case 'carteira':
        return p.estadoDaCarteira.carregando ? <Esqueleto rotulo="Carregando a carteira" /> : (
          <ListaDaCarteira
            linhas={linhas.map(dadosDaLinha)} aberta={projetoAberto} onAbrir={setProjetoEscolhido}
            erro={p.estadoDaCarteira.erro} buscando={p.estadoDaCarteira.buscando} onTentar={p.estadoDaCarteira.tentar}
          />
        );
      case 'sozinha':
        return <FizSozinha feitos={p.feitos} rotuloDoDesde={p.rotuloDoDesde} agora={p.agora} onAbrirProjeto={p.onAbrirProjeto} />;
      case 'diario':
        return <Diario dias={p.diario} estado={p.estadoDoDiario} />;
      case 'ajustes':
        return <AjustesDaLudmilla />;
    }
  };

  const direita = (layout: 'painel' | 'folha'): ReactNode => {
    switch (vista.tipo) {
      case 'decidir': {
        if (p.fila.carregando) return <div className="p-5"><Esqueleto linhas={2} rotulo="Carregando o detalhe" /></div>;
        if (!itemAberto) return <p className="m-0 p-5 text-sm text-lm-suave">Escolha um cartão.</p>;
        const item = itemAberto;
        const c = cartaoDe(item);
        const linha = item.projectId ? linhaPorProjeto.get(item.projectId) ?? null : null;
        const topo = (
          <TopoDaDecisao
            prazo={c.prazo} donos={c.donos} titulo={c.titulo} projeto={linhaDoProjeto(item, true)}
            projectId={item.projectId} onAbrirProjeto={p.onAbrirProjeto}
          />
        );
        return p.detalhe(item, layout, (acao, etapa, texto) => decidirItem(item, acao, etapa, texto), topo, historicoDe(linha));
      }
      case 'carteira':
        if (p.estadoDaCarteira.carregando) return <div className="p-5"><Esqueleto linhas={2} rotulo="Carregando a ficha" /></div>;
        if (!linhaAberta) return <p className="m-0 p-5 text-sm text-lm-suave">Escolha um projeto.</p>;
        return p.ficha(linhaAberta, historicoDe(linhaAberta), verNaFila(linhaAberta));
      case 'sozinha':
        return <PainelDoQueFacoSozinha onAjustes={() => irPara({ tipo: 'ajustes' })} />;
      case 'diario':
        return <PainelDoRecado recado={p.recado} />;
      case 'ajustes':
        return p.ondeEuLeio();
    }
  };

  // ── a folha (fora das três colunas): detalhe e ficha ──
  const folhaAberta = !ladoALado && ((vista.tipo === 'decidir' && !!itemAberto) || (vista.tipo === 'carteira' && !!linhaAberta));
  const conteudoDaFolha = folhaAberta ? direita('folha') : null;
  // a folha fecha com animação: durante a saída ela continua mostrando o que estava aberto
  const ultimoConteudo = useRef<ReactNode>(null);
  if (conteudoDaFolha) ultimoConteudo.current = conteudoDaFolha;
  // fechada, o foco volta ao cartão (ou à linha) que estava aberto; sem ele, à lista
  const ultimoAberto = useRef<string | null>(null);
  if (vista.tipo === 'decidir' && itemAberto) ultimoAberto.current = `[data-abrir="${itemAberto.chave}"]`;
  if (vista.tipo === 'carteira' && linhaAberta) ultimoAberto.current = `[data-linha-carteira="${linhaAberta.projectId}"]`;
  const fecharFolha = () => {
    if (vista.tipo === 'decidir') escolher(null);
    else setProjetoEscolhido(null);
  };
  const devolverFoco = (e: Event) => {
    const alvo = (ultimoAberto.current ? document.querySelector<HTMLElement>(ultimoAberto.current) : null)
      ?? document.querySelector<HTMLElement>('[data-coluna="meio"]');
    if (alvo) {
      e.preventDefault();
      alvo.focus();
    }
  };
  const voltarPara = vista.tipo === 'carteira'
    ? FILTROS_DA_CARTEIRA.find(f => f.valor === vista.filtro)?.rotulo ?? 'Carteira'
    : vista.tipo === 'decidir'
      ? GRUPOS_DA_FILA.find(g => g.valor === vista.grupo)?.rotulo ?? 'Voltar'
      : 'Voltar';

  const [titulo, subtitulo] = tituloDaVista(vista, p.rotuloDoDesde);
  const painelEmbaixo = !ladoALado && (vista.tipo === 'sozinha' || vista.tipo === 'diario' || vista.tipo === 'ajustes');
  const coluna = (
    <ColunaDaEsquerda
      recado={p.recado} grupos={navGrupos} donos={opcoes} dono={dono}
      onDono={v => { setDono(v); escolher(null); }}
      carteira={navCarteira} comigo={navComigo} leituras={p.leituras} onLeituras={() => irPara({ tipo: 'ajustes' })}
    />
  );

  // a casca cancela o respiro do MainLayout dos 4 lados (no celular o de baixo é o pb-20 da BottomNav:
  // o papel desce por trás dela e o pb-20 volta aqui dentro, para o conteúdo não ficar coberto)
  return (
    <div
      data-modo={p.modo}
      className="ludmilla-mundo -mx-4 -mt-4 -mb-20 flex min-h-[calc(100vh-3.5rem)] flex-col pb-20 sm:-mb-4 sm:pb-0 md:-mx-6 md:-mt-6 md:-mb-6 md:min-h-[calc(100vh-4rem)]"
    >
      {p.alertaUrgente && <div className="flex flex-col gap-2 px-4 py-3 sm:px-6">{p.alertaUrgente}</div>}
      {p.modo === 'uma'
        ? <FaixaDoCelular onMenu={() => setMenuAberto(true)} onAjustes={() => irPara({ tipo: 'ajustes' })} />
        : <FaixaDaLudmilla onAjustes={() => irPara({ tipo: 'ajustes' })} ajustesAberto={vista.tipo === 'ajustes'} />}

      {p.modo === 'uma' ? (
        <section aria-label="Lista" tabIndex={-1} data-coluna="meio" className="flex flex-col gap-3 px-4 pb-6 outline-none">
          <div className="-mx-4 flex items-center justify-between gap-2.5 bg-lm-caixa px-4 py-2.5 text-[13px]">
            <span>{p.recado?.curto ?? 'Carregando o recado…'}</span>
            <button type="button" onClick={() => setMenuAberto(true)} className="shrink-0 whitespace-nowrap font-bold underline underline-offset-4">
              Ler o recado
            </button>
          </div>
          {vista.tipo === 'decidir' && (
            <>
              <div role="group" aria-label="Para decidir" className="flex gap-1.5 overflow-x-auto">
                {navGrupos.map(g => (
                  <button
                    key={g.chave} type="button" aria-pressed={g.ativo} onClick={g.onClick} data-nav={g.chave}
                    className={cn('min-h-11 shrink-0 rounded-md px-3.5 text-sm',
                      g.ativo ? 'bg-lm-sol font-extrabold' : 'border-[1.5px] border-lm-borda bg-white font-bold')}
                  >
                    {g.rotulo}{g.n !== null ? ` ${g.n}` : ''}
                  </button>
                ))}
              </div>
              <p className="m-0 text-xs text-lm-suave">{textoDoFiltroDeDono(dono, opcoes)}</p>
            </>
          )}
          <CabecalhoDoMeio titulo={titulo} subtitulo={subtitulo} />
          {meio()}
          {painelEmbaixo && <div className="-mx-4 border-t border-lm-borda">{direita('painel')}</div>}
        </section>
      ) : (
        <div ref={grade} className="flex min-h-0" style={altura ? { height: altura } : undefined}>
          <div className="w-[260px] shrink-0 overflow-y-auto bg-lm-caixa">{coluna}</div>
          <section
            aria-label="Lista" tabIndex={-1} data-coluna="meio"
            className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-10 pt-4 outline-none"
          >
            <CabecalhoDoMeio titulo={titulo} subtitulo={subtitulo} />
            {meio()}
            {painelEmbaixo && <div className="border-t border-lm-borda">{direita('painel')}</div>}
          </section>
          {ladoALado && (
            <aside
              aria-label="Detalhe" data-coluna="direita"
              className={cn('flex w-[360px] shrink-0 flex-col border-l border-lm-borda 2xl:w-[420px]',
                vista.tipo === 'decidir' ? 'overflow-hidden' : 'overflow-y-auto')}
            >
              {direita('painel')}
            </aside>
          )}
        </div>
      )}

      {!ladoALado && (
        <FolhaDaLudmilla
          aberta={folhaAberta} onFechar={fecharFolha} titulo={voltarPara} onCloseAutoFocus={devolverFoco}
          cabecalho={(
            <button type="button" onClick={fecharFolha} className="flex min-h-11 items-center gap-1.5 pr-2 text-[15px] font-bold text-white">
              <ChevronLeft size={20} aria-hidden /> {voltarPara}
            </button>
          )}
        >
          {conteudoDaFolha ?? ultimoConteudo.current}
        </FolhaDaLudmilla>
      )}
      {p.modo === 'uma' && (
        <FolhaDaLudmilla
          aberta={menuAberto} onFechar={() => setMenuAberto(false)} lado="left" titulo="Menu da Ludmilla"
          cabecalho={(
            <>
              <span className="pl-1 text-[17px] font-extrabold text-white">Ludmilla</span>
              <button type="button" onClick={() => setMenuAberto(false)} className="min-h-11 px-2 text-[15px] font-bold text-white">
                Fechar
              </button>
            </>
          )}
        >
          {coluna}
        </FolhaDaLudmilla>
      )}
    </div>
  );
}
```

- [ ] **Step 7: tsc e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 8: Conferir no navegador — computador (1440 × 900, gestor)**

Recarregue `http://localhost:5182/harness-ludmilla-e2.html` com a janela em 1440 × 900. Rode no console e confira cada valor:

```js
await document.fonts.ready;
const n = sel => document.querySelector(sel)?.textContent?.trim();
({
  modo: document.querySelector('[data-modo]').dataset.modo,                                    // "tres"
  colunas: ['esquerda', 'meio', 'direita'].map(c => !!document.querySelector(`[data-coluna="${c}"]`)), // [true,true,true]
  fonte: document.fonts.check('16px "Public Sans"'),                                          // true
  agora: n('[data-nav="grupo-agora"] b'), semana: n('[data-nav="grupo-semana"] b'), depois: n('[data-nav="grupo-depois"] b'), // "3","4","2"
  cartoesAgora: [...document.querySelectorAll('[data-cartao]')].map(c => c.dataset.cartao).sort(), // ["f:f-cob","f:f-devolucao","u:u-hoje"]
  detalheAberto: document.querySelector('[data-detalhe]')?.dataset.detalhe === document.querySelector('[data-cartao]')?.dataset.cartao, // true
  recado: n('[data-recado]'),
  // "Bom dia. Desde ontem li 12 e-mails da ENEL SP e 199 protocolos da CPFL Paulista. Fiz 2 coisas sozinha. Separei 9 coisas para vocês; 5 estão sem dono."
  parados: n('[data-nav="carteira-parados"] b'), nos: n('[data-nav="carteira-nos"] b'),       // "4","6"
  conc: n('[data-nav="carteira-concessionaria"] b'), empresa: n('[data-nav="carteira-cliente"] b'), todos: n('[data-nav="carteira-todos"] b'), // "2","1","9"
  fizSozinha: n('[data-nav="sozinha"] b'),                                                     // "2"
  leituras: [...document.querySelectorAll('[data-nav="leituras"] > span.flex')].map(s => s.textContent), // CPFL Paulista08:00 · EDP São Paulonunca lida · Elektrosessão expirada · ENEL SP07:30
  barraNoCartao: !!document.querySelector('[data-cartao="u:u-hoje"] [data-historico="pequeno"]'), // true
  semBarraSemProjeto: !document.querySelector('[data-cartao="f:f-devolucao"] [data-historico]'),   // true
  semRolagemLateral: document.documentElement.scrollWidth <= innerWidth,                          // true
})
```

Depois, uma decisão com Desfazer e uma que vai ao banco:

```js
// 1) decidir direto pelo botão do cartão de hoje
document.querySelector('[data-cartao="u:u-hoje"] > div button').click();
[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent);   // contém "PRJ-10009 vai para Aprovado" e "Desfazer"
!!document.querySelector('[data-cartao="u:u-hoje"]');                              // false (saiu da lista)
await new Promise(r => setTimeout(r, 9000)); window.__decisoes;                    // ["aplicar:u-hoje:"]
// 2) decidir e desfazer
document.querySelector('[data-cartao="f:f-devolucao"] > div button').click();     // "Marcar como feito"
[...document.querySelectorAll('[data-sonner-toast] button')].find(b => b.textContent === 'Desfazer').click();
!!document.querySelector('[data-cartao="f:f-devolucao"]');                         // true (voltou)
await new Promise(r => setTimeout(r, 9000)); window.__decisoes;                    // continua ["aplicar:u-hoje:"]
```

Fila de, carteira, ficha, Comigo e Ajustes:

```js
document.querySelector('[data-dono="sem"]').click();
[...document.querySelectorAll('[data-cartao]')].map(c => c.dataset.cartao).sort();  // ["f:f-cob","f:f-devolucao"]
document.querySelector('[data-dono="todos"]').click();
document.querySelector('[data-nav="carteira-parados"]').click();
[...document.querySelectorAll('[data-linha-carteira]')].map(l => l.dataset.linhaCarteira); // ["p-12","p-9","p-7","p-1"]
document.querySelector('[data-ficha]')?.dataset.ficha;                                    // "p-12"
document.querySelector('[data-ficha] [data-historico="grande"] [data-barra="pendencia"]')?.dataset.tom; // "alem"
document.querySelector('[data-linha-carteira="p-1"]').click();
[...document.querySelectorAll('[data-ficha] button')].find(b => b.textContent === 'Ver na fila').click();
document.querySelector('[data-detalhe]')?.dataset.detalhe;                                // "u:u-cpfl"
document.querySelector('[data-nav="diario"]').click();
[...document.querySelectorAll('[data-vista="diario"] h2')].map(h => h.textContent);      // ["Hoje, quinta 22/10","Ontem, quarta 21/10","Terça, 20/10"]
document.querySelector('[data-nav="ajustes"]').click();
!!document.querySelector('[data-vista="ajustes"]') && !!document.querySelector('[data-painel="onde-eu-leio"]'); // true
```

Abra `?captcha=1`: o alerta amarelo aparece ACIMA da faixa petróleo. Abra a vista Agora com um cartão de cobrança: o detalhe mostra "O e-mail que vai sair" com o texto editável e os botões embaixo, à vista sem rolar. Tire prints (fora do repositório, `$RASCUNHO/e2-prints/`) e compare com `LudmillaA.dc.html`.

- [ ] **Step 9: Conferir no navegador — tablet (1100 × 800) e celular (390 × 844, projetista)**

Em 1100 × 800, recarregue: `[data-modo]` = `"duas"`, `[data-coluna="direita"]` não existe, clicar no corpo de um cartão (`[data-abrir]`) abre a folha (`[role="dialog"]`) com o detalhe e o cabeçalho "‹ Agora"; fechar devolve o foco ao cartão (`document.activeElement.dataset.abrir`).

Em 800 × 800 (tablet estreito, menu do GD visível), recarregue: `[data-modo]` = `"uma"` e `document.documentElement.scrollWidth <= window.innerWidth` (sem rolagem lateral).

Em 390 × 844 (preset mobile), abra `?papel=staff` e confira:

```js
({
  modo: document.querySelector('[data-modo]').dataset.modo,                       // "uma"
  semColunaFixa: !document.querySelector('[data-coluna="esquerda"]'),             // true (só no menu)
  curto: document.querySelector('[data-coluna="meio"] > div span')?.textContent,  // "Bom dia. Separei 9 coisas; 3 para agora."
  filaDe: [...document.querySelectorAll('[data-coluna="meio"] p')].map(p => p.textContent).find(t => t.startsWith('Fila de')), // "Fila de Ana. Para mudar, abra o menu."
  cartoes: [...document.querySelectorAll('[data-cartao]')].map(c => c.dataset.cartao), // ["u:u-hoje"]
  toquesPequenos: [...document.querySelectorAll('.ludmilla-mundo button, .ludmilla-mundo a')]
    .filter(b => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map(b => b.textContent.trim()), // []
  semRolagemLateral: document.documentElement.scrollWidth <= innerWidth,          // true
})
```

Toque no corpo do cartão: a folha abre em tela cheia com "‹ Agora" no topo, histórico, "O que eu vi", "O que eu sugiro" e os botões embaixo; `document.querySelector('[data-teste="botoes-da-decisao"]').getBoundingClientRect().bottom <= innerHeight` → `true`. Toque em "Ler o recado": o menu abre com o recado inteiro, "Fila de" e a carteira; tocar em "Parados além do normal" fecha o menu e mostra as linhas. Prints em `$RASCUNHO/e2-prints/`, comparando com `CelularLista`, `CelularDetalhe` e `CelularMenu`.

- [ ] **Step 10: Auditoria de UI e acessibilidade (`web-design-guidelines`)**

Invoque a skill `web-design-guidelines` sobre `src/components/ludmilla/pagina/*.tsx`, `src/components/ludmilla/mundo/*.tsx` e o harness aberto em 1440 e 390. Além do que ela apontar, confira e anote no rascunho (passa/falha):
- contraste de texto ≥ 4,5:1 nos pares usados: petróleo/papel (11,7), petróleo/sol (6,5), `#3E5F6A`/papel (6,9), `#3E5F6A`/caixa (5,9), `#C2410C`/papel (5,2), `#8F2F09`/caixa (6,9), branco/petróleo (11,7), branco/`#C2410C` (5,2), e os cinco chips;
- foco visível com Tab em: itens da navegação, "Fila de", cartão, botão do cartão, linha da carteira, engrenagem (branco sobre petróleo), botões do detalhe;
- `aria-current` no item ativo, `aria-pressed` nos botões de dono e de grupo, um `h1` por vista, `nav` com `aria-label`, o histórico grande com o texto `sr-only`;
- `motion-reduce` nos esqueletos;
- nenhum texto cortado em 390 px (títulos longos quebram; o chip do prazo não sai do cartão).
Cada falha vira correção no arquivo indicado, e os Steps 7–9 rodam de novo até tudo passar.

- [ ] **Step 11: Apagar o harness**

Pare o Vite. Apague `harness-ludmilla-e2.html` e `src/harness-ludmilla-e2.tsx`.
Run: `git status --short | grep -i harness` → nenhuma linha.
Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`. Run: `npm run build` → sem erro.

- [ ] **Step 11b: Os números do Step 8 num teste (sem navegador)**

FAÇA ESTE PASSO ANTES DO STEP 11 (que apaga o harness). Copie do harness o cálculo (as mesmas funções das Tasks 1, 3 e 4, chamadas com os mesmos argumentos que o harness passa à casca: `AGORA`, `DESDE`, os itens de `ludmillaCaixa.fixtures.ts`/`ludmillaCobranca.fixtures.ts`, `CARTEIRA_DE_EXEMPLO`, `NORMAIS_DE_EXEMPLO`, `REGISTRO_DE_EXEMPLO`) para `src/lib/ludmillaPagina.fixtures.test.ts`, em `describe('os números da página com os dados de exemplo (Task 13, Step 8)')`, conferindo exatamente o que o Step 8 conferiu no navegador:

- grupos da fila de todos: Agora 3, Esta semana 4, Quando puder 2; os cartões de Agora, ordenados: `["f:f-cob","f:f-devolucao","u:u-hoje"]`;
- carteira: parados 4, com a gente 6, com a concessionária 2, com a empresa 1, todos 9;
- "Parados além do normal" em ordem: `["p-12","p-9","p-7","p-1"]`;
- fila "Sem dono": `["f:f-cob","f:f-devolucao"]` e o resumo com 5 sem dono;
- Fiz sozinha: 2;
- o recado: `"Bom dia. Desde ontem li 12 e-mails da ENEL SP e 199 protocolos da CPFL Paulista. Fiz 2 coisas sozinha. Separei 9 coisas para vocês; 5 estão sem dono."`;
- os títulos do Diário: `["Hoje, quinta 22/10","Ontem, quarta 21/10","Terça, 20/10"]`.

Só funções puras e fixtures: nada de React, Supabase nem DOM (o vitest roda em `node`). Se algum número sair diferente do Step 8, o harness e o teste divergem: descubra qual dos dois está errado antes de seguir (o navegador já mostrou o valor certo).
Run: `npx vitest run src/lib/ludmillaPagina.fixtures.test.ts` → PASS.

- [ ] **Step 12: Commit**

`$RASCUNHO/msg-e2-t13.txt` (Write; acrescente ao corpo uma linha por correção que a auditoria do Step 10 pediu):

```
feat(ludmilla): a casca da página nova — três colunas, folha e celular (entrega 2, página)

PaginaDaLudmilla junta tudo: a vista escolhida na coluna da esquerda,
a fila por grupo e por dono com cartões completos, a carteira com a
ficha, Fiz sozinha, Diário e Ajustes; o detalhe ao lado a partir de
1280 px, numa folha de 960 a 1279, e uma coluna por vez abaixo de 960.
Decidir continua com o Desfazer de 8 s e vai ao próximo item.
Provado em harness com dados inventados (1440x900, 1100x800, 800x800, 390x844)
e auditado com web-design-guidelines.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/components/ludmilla/pagina/useEscolhaEDecisao.ts src/components/ludmilla/pagina/PaginaDaLudmilla.tsx src/lib/ludmillaPagina.fixtures.ts src/lib/ludmillaPagina.fixtures.test.ts
git commit -F "$RASCUNHO/msg-e2-t13.txt" -- src/components/ludmilla/pagina/useEscolhaEDecisao.ts src/components/ludmilla/pagina/PaginaDaLudmilla.tsx src/lib/ludmillaPagina.fixtures.ts src/lib/ludmillaPagina.fixtures.test.ts
git show --stat HEAD
```

Se a auditoria mudou outros arquivos das Tasks 7–12, acrescente-os ao `git add` e ao `--` do commit.

---

### Task 14: Trocar a página, apagar o que sobrou e documentar

**Files:**
- Modify (reescrita): `src/pages/Ludmilla.tsx`
- Delete: `src/components/ludmilla/decidir/AbaDecidir.tsx`, `src/components/ludmilla/decidir/AbaDecidirConectada.tsx`, `src/components/ludmilla/decidir/CaixaDeDecisoes.tsx`, `src/components/ludmilla/decidir/FiltrosDaCaixa.tsx`, `src/components/ludmilla/decidir/LinhaDaCaixa.tsx`, `src/components/ludmilla/topo/BarraDeAbas.tsx`, `src/components/ludmilla/topo/FaixaDeSaude.tsx`, `src/components/ludmilla/topo/abas.ts`, `src/components/ludmilla/abas/AbaConcessionarias.tsx`, `src/components/ludmilla/abas/RegistroDaLudmilla.tsx`
- Modify: `docs/modules/integrations/ludmilla.md`, `docs/project/roadmap.md`, `CLAUDE.md`
- Fora do repositório: a memória `C:\Users\luiza\.claude\projects\C--Users-luiza-Desktop-DADOS-DESENVOLVIMENTO---GD-MANAGER-ENERGY-pv-harmony-hub-main-pv-harmony-hub-main\memory\ludmilla.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–13; os hooks de hoje (`useCaixaDaLudmilla`, `useFilaDeDecisoes`, `useAcoesDaCaixa`, `usePortalCaptchas`, `useAgentConfig`, `useRunsCriacaoCpfl`, `usePedirRun`, `useRegistroLudmilla`, `useStatusLabel`, `useStatusOrder`, `useAgora`, `useWindowSize`, `useAuth`).
- Produces: a rota `/ludmilla` com a página nova. O contador da barra lateral (`useContadorDaLudmilla` na `Sidebar`) não muda.

- [ ] **Step 1: Medir o baseline e conferir quem usa o que vai ser apagado**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.
Run: `grep -rnE "AbaDecidir|CaixaDeDecisoes|FiltrosDaCaixa|LinhaDaCaixa|BarraDeAbas|FaixaDeSaude|topo/abas|AbaConcessionarias|RegistroDaLudmilla" src --include=*.ts --include=*.tsx`
Expected: só os próprios arquivos a apagar e `src/pages/Ludmilla.tsx`. Se aparecer outro arquivo, PARE e avise: alguém usa a peça e ela não pode sair.

- [ ] **Step 2: Reescrever `src/pages/Ludmilla.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { useAgora } from '@/hooks/useAgora';
import { useCaixaDaLudmilla } from '@/hooks/useCaixaDaLudmilla';
import { useFilaDeDecisoes } from '@/hooks/useFilaDeDecisoes';
import {
  estadoDaEstacao, useLudmillaDisponivel, usePedirRun, usePortalCaptchas, useRegistroLudmilla, useRunsCriacaoCpfl,
  type PortalAccount,
} from '@/hooks/useLudmilla';
import { useAcoesDaCaixa } from '@/hooks/useLudmillaDecidir';
import { useCarteiraDaLudmilla, useDesdeDoRecado, useLeiturasDesde, useNormaisDaLudmilla } from '@/hooks/useLudmillaPagina';
import { useStatusLabel, useStatusOrder } from '@/hooks/useStatusLabel';
import { useWindowSize } from '@/hooks/useWindowSize';
import { mensagemDeErro } from '@/lib/ludmillaCartao';
import { donosPorProjetoDe, fraseDasNaoAcompanhadas, naoAcompanhadas, proximoPasso } from '@/lib/ludmillaCarteira';
import { resumoDaFila } from '@/lib/ludmillaFila';
import { fraseDaProximaLeitura, leiturasDasContas, linhasDeLeitura, proximaLeitura, textoDaListaVazia } from '@/lib/ludmillaLeituras';
import { alertasDasContas } from '@/lib/ludmillaPainel';
import { diarioPorDia, fezSozinha, recadoDoDia, rotuloDoDesde } from '@/lib/ludmillaRecado';
import { CartaoCaptcha } from '@/components/ludmilla/abas/CartaoCaptcha';
import { DetalheConectado } from '@/components/ludmilla/decidir/DetalheConectado';
import { FichaConectada } from '@/components/ludmilla/pagina/FichaConectada';
import { OndeEuLeio } from '@/components/ludmilla/pagina/OndeEuLeio';
import { PaginaDaLudmilla } from '@/components/ludmilla/pagina/PaginaDaLudmilla';
import { modoDaPagina } from '@/components/ludmilla/pagina/modo';

/** O registro do Diário: 120 linhas; "Ver mais" leva a 400 (o teto de `ludmilla_registro` é 500). */
const DIARIO_CURTO = 120;
const DIARIO_LONGO = 400;

/**
 * LUDMILLA — a página nova (spec 2026-11-08, entrega 2): a estrutura A no mundo "Conta de luz".
 *
 * A página só liga os hooks à casca (`PaginaDaLudmilla`), que não lê banco. A Ludmilla continua só
 * sugerindo: quem decide é uma pessoa, pelas MESMAS RPCs de sempre, com o Desfazer de 8 s
 * (`useFilaDeDecisoes` + `useAcoesDaCaixa`). O que é novo vem da entrega 1 (`ludmilla_carteira`,
 * `ludmilla_normais`) e das contagens do recado. Só para a equipe do GD Manager.
 */
export default function Ludmilla() {
  const disponivel = useLudmillaDisponivel();
  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-muted-foreground">A Ludmilla está disponível só para a equipe do GD Manager.</div>
      </MainLayout>
    );
  }
  return (
    <MainLayout>
      <PaginaConectada />
    </MainLayout>
  );
}

function PaginaConectada() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const agora = useAgora(60_000);
  const { width } = useWindowSize();
  const rotulo = useStatusLabel();
  const etapas = useStatusOrder();
  const caixa = useCaixaDaLudmilla('pendente');
  const { ocultos, decidir } = useFilaDeDecisoes(caixa.itens);
  const acoes = useAcoesDaCaixa();
  const carteira = useCarteiraDaLudmilla();
  const normais = useNormaisDaLudmilla();
  const { data: captchas = [] } = usePortalCaptchas();
  // a caixa do agente de e-mails: carregando (ou falhou sem resposta anterior) é null, nunca false
  const { data: agente, isLoading: carregandoAgente, isError: erroDoAgente } = useAgentConfig();
  const semResposta = carregandoAgente || agente === undefined;
  const caixaPronta = semResposta ? null : !!agente?.is_configured && !!agente?.gmail_email;
  const caixaFalhou = semResposta && erroDoAgente;
  const { data: runsCriacao = [] } = useRunsCriacaoCpfl();
  const pedir = usePedirRun();
  const desde = useDesdeDoRecado(user?.id);
  const leiturasDesde = useLeiturasDesde(desde, caixa.contas);
  const [limiteDoDiario, setLimiteDoDiario] = useState(DIARIO_CURTO);
  const registro = useRegistroLudmilla(limiteDoDiario);
  const daLudmilla = useRegistroLudmilla(DIARIO_LONGO, 'ludmilla');

  const linhas = useMemo(() => carteira.data ?? [], [carteira.data]);
  const estacaoDe = (c: PortalAccount) => estadoDaEstacao(c, agora);
  const feitos = useMemo(() => fezSozinha(daLudmilla.data ?? [], desde), [daLudmilla.data, desde]);
  const resumo = resumoDaFila(caixa.itens, { ocultos, agora, donosPorProjeto: donosPorProjetoDe(linhas) });
  const leituras = leiturasDesde.isError
    ? null
    : leiturasDasContas(caixa.contas, caixa.nomeDaConta, leiturasDesde.data ?? { protocolos: {}, emails: {} });
  const recadoCarregando = caixa.carregando || carteira.isLoading || leiturasDesde.isLoading || daLudmilla.isLoading;
  // sem a carteira não sei o dono de nenhum item: não afirmo "N sem dono" (spec §4.6)
  const recado = recadoCarregando ? null : recadoDoDia({
    agora, desde, leituras, fizSozinha: feitos.length, separei: resumo.total, paraAgora: resumo.agora,
    semDono: carteira.isError ? 0 : resumo.semDono,
  });
  // a fila depende da carteira para saber o dono: carregando/falhou é estado da fila, nunca "Nada aqui agora"
  const erroDaFila = caixa.erro ? (mensagemDeErro(caixa.erro) ?? '')
    : carteira.isError ? 'Não consegui carregar os responsáveis de cada projeto.'
    : null;
  const proxima = fraseDaProximaLeitura(proximaLeitura(caixa.contas, caixa.nomeDaConta, agora), agora);
  const nao = fraseDasNaoAcompanhadas(naoAcompanhadas(linhas, caixa.contas.map(c => c.concessionaire_id)));
  const abrirProjeto = (id: string) => navigate(`/project/${id}`);

  return (
    <PaginaDaLudmilla
      modo={modoDaPagina(width)} agora={agora}
      usuario={user ? { id: user.id, role: user.role, name: user.name } : null}
      rotuloEtapa={rotulo} ordemDasEtapas={etapas.map(e => e.key)}
      itens={caixa.itens} ocultos={ocultos} decidir={decidir} acoes={acoes}
      fila={{
        carregando: caixa.carregando || carteira.isLoading, buscando: caixa.buscando,
        erro: erroDaFila, tentar: () => { caixa.tentarDeNovo(); void carteira.refetch(); },
      }}
      carteira={linhas} normais={normais.data ?? []}
      estadoDaCarteira={{
        carregando: carteira.isLoading, buscando: carteira.isFetching,
        erro: carteira.isError ? (mensagemDeErro(carteira.error) ?? '') : null, tentar: () => { void carteira.refetch(); },
      }}
      recado={recado} feitos={feitos} rotuloDoDesde={rotuloDoDesde(desde, agora)}
      diario={diarioPorDia(registro.data ?? [], agora)}
      estadoDoDiario={{
        carregando: registro.isLoading,
        erro: registro.isError ? (mensagemDeErro(registro.error) ?? '') : null,
        tentar: () => { void registro.refetch(); },
        podeVerMais: limiteDoDiario < DIARIO_LONGO && (registro.data?.length ?? 0) >= limiteDoDiario,
        verMais: () => setLimiteDoDiario(DIARIO_LONGO),
      }}
      leituras={linhasDeLeitura(caixa.contas, { nomeDaConta: caixa.nomeDaConta, estacaoDe, caixaPronta, captchas, agora })}
      textoDaListaVazia={textoDaListaVazia(proxima)}
      alertaUrgente={captchas.length > 0
        ? captchas.map(c => <CartaoCaptcha key={c.id} c={c} portal={caixa.nomeDaConta(c.account_id)} />)
        : null}
      detalhe={(item, layout, onDecidir, topo, historico) => (
        // a etapa do detalhe nasce da recomendação: refetch que muda a recomendação recria o detalhe
        <DetalheConectado
          key={`${item.chave}|${item.update?.recomendacao ?? ''}`} item={item} layout={layout} etapas={etapas}
          rotuloEtapa={rotulo} onDecidir={onDecidir} onAbrirProjeto={abrirProjeto} topo={topo} historico={historico}
        />
      )}
      ficha={(linha, historico, onVerNaFila) => (
        <FichaConectada
          key={linha.projectId} linha={linha} historico={historico} proximo={proximoPasso(linha, rotulo)}
          onVerNaFila={onVerNaFila} onAbrirProjeto={abrirProjeto} rotuloEtapa={rotulo}
        />
      )}
      ondeEuLeio={() => (
        <OndeEuLeio
          contas={caixa.contas} nomeDaConta={caixa.nomeDaConta} caixa={agente} caixaPronta={caixaPronta} caixaFalhou={caixaFalhou}
          agora={agora} verificando={pedir.isPending} onVerificar={(accountId, tipo) => pedir.mutate({ accountId, tipo })}
          alertas={alertasDasContas(caixa.contas, caixa.nomeDaConta, caixaPronta, estacaoDe)} naoAcompanhadas={nao}
          runsCriacao={runsCriacao}
        />
      )}
      onAbrirProjeto={abrirProjeto}
    />
  );
}
```

- [ ] **Step 3: Apagar o que a página nova substituiu**

```bash
git rm src/components/ludmilla/decidir/AbaDecidir.tsx src/components/ludmilla/decidir/AbaDecidirConectada.tsx src/components/ludmilla/decidir/CaixaDeDecisoes.tsx src/components/ludmilla/decidir/FiltrosDaCaixa.tsx src/components/ludmilla/decidir/LinhaDaCaixa.tsx src/components/ludmilla/topo/BarraDeAbas.tsx src/components/ludmilla/topo/FaixaDeSaude.tsx src/components/ludmilla/topo/abas.ts src/components/ludmilla/abas/AbaConcessionarias.tsx src/components/ludmilla/abas/RegistroDaLudmilla.tsx
```

Run: o mesmo `grep -rnE …` do Step 1 → nenhuma linha.

- [ ] **Step 4: Verificação completa**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.
Run: `npm test` → a linha `Tests … passed`, nenhum `failed` (inclui os testes novos das Tasks 1–5 e os de sempre da Ludmilla).
Run: `npm run build` → sem erro.
Run: `git status --short | grep -i harness` → nenhuma linha.

- [ ] **Step 5: A documentação do módulo**

Em `docs/modules/integrations/ludmilla.md`, logo abaixo do título `## A página como caixa de decisões (22/10/2026)`, acrescente:

```markdown
> **Substituída em nov/2026 pela página nova** (entrega 2 da repaginação, seção "A página nova" no fim
> deste documento). Ficam valendo daqui: o Desfazer de 8 s, o Aplicar silencioso, o contador da barra
> lateral, a caixa de e-mail `null` enquanto carrega e a altura das colunas (`decidir/altura.ts`). As abas,
> a faixa de saúde, a busca e os filtros saíram.
```

E acrescente no FIM do arquivo:

```markdown
## A página nova: estrutura A no mundo "Conta de luz" (entrega 2 da repaginação, nov/2026)

Spec: `docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md` (mockup aprovado em 08/11,
"v3 — Estrutura A completa"); plano: `docs/superpowers/plans/2026-11-09-ludmilla-e2-pagina.md`. Sem
mudança no banco: a página lê `ludmilla_carteira()` e `ludmilla_normais()` (entrega 1) e o que já lia.

**O mundo.** Só a `/ludmilla` (o menu do GD e o resto do app não mudam). Cores `lm-*` no Tailwind e a
classe `.ludmilla-mundo` (`src/index.css`), que redefine as variáveis do shadcn só dentro da página — os
cartões reaproveitados (contas, regras de e-mail, o detalhe) entram no mundo sem reescrita. Public Sans
carregada só ao abrir a página (`mundo/useFonteDaLudmilla.ts`). Texto em alerta sobre a caixa é `#8F2F09`
(o `#C2410C` da spec dá 4,41:1 ali); foco petróleo, branco na faixa. Avatar provisório (`mundo/AvatarDaLudmilla.tsx`).

**A tela.** Faixa petróleo (avatar, "Ludmilla", "Analista de homologação", Ajustes). Coluna da esquerda,
a única navegação: o recado do dia (montado dos números, sem IA — `ludmillaRecado.ts`), Para decidir
(Agora / Esta semana / Quando puder, com "Fila de"), Carteira (Parados além do normal, Com a gente, Com
a concessionária, Com a empresa, Todos), Comigo (Fiz sozinha, Diário) e Leituras (clicar leva aos
Ajustes). No meio, os cartões completos da fila (prazo, responsável, a ação como título, o porquê em
primeira pessoa, o histórico pequeno, o botão principal), as linhas da carteira, Fiz sozinha, Diário ou
Ajustes. À direita, o detalhe de decisão de sempre (`DetalheDaDecisao`, títulos em primeira pessoa, com
`topo` e `historico`), a ficha do projeto (histórico grande, "O que eu li por último", próximo passo,
"Ver na fila", "Abrir o projeto"), "O que eu faço sozinha hoje", o recado inteiro ou "Onde eu leio" (os
cartões das contas, agora com "Ler agora", as criações na CPFL e "Ainda não acompanho …").
Três colunas a partir de 1280 px; de 960 a 1279, esquerda + lista e o detalhe numa folha; abaixo de 960,
uma coluna por vez (faixa com menu e engrenagem, recado em uma linha, grupos no topo, detalhe e menu em
tela cheia). Componentes em `src/components/ludmilla/{pagina,mundo}/`.

**As regras** (todas puras, com vitest):
- **Grupo** (`ludmillaFila.ts`, spec §6.1): Agora = cobrança da troca, troca que falhou, e-mail que voltou,
  recomendação de etapa de hoje (dia de Brasília), vistoria aprovada com 7 dias ou mais; Esta semana =
  recomendação de dias anteriores, vistoria aprovada com menos de 7 dias; Quando puder = documento
  travado, só gravar protocolo, sem sugestão, aviso. Mais antigo primeiro. O CAPTCHA continua só como o
  alerta acima de tudo.
- **Dono** (§6.2): `donos` da carteira pelo projeto do item; sem projeto ou fora da carteira = Sem dono.
  O projetista abre na própria fila; o gestor em Todos.
- **Recado:** "desde" = a última visita (localStorage `ludmilla:ultima-visita:<id>`, em try/catch) ou
  18:00 do último dia útil; no máximo 7 dias. E-mails = linhas novas em `portal_email_mensagens`;
  protocolos = o maior `protocolos_lidos` de uma varredura `ok`; "Fiz sozinha" = anexo conferido e
  parecer no card (registro); "Separei" = a fila de todos.
- **Barras** (`ludmillaBarras.ts`): as colunas do Kanban, passadas, a atual e as que ainda vêm; desvios
  só se visitados; a atual conta só a estada de agora; traço no normal da concessionária; a atual em sol
  ou, além do normal (dias inteiros > normal), sol até o traço e alerta acima.
- **Carteira** (`ludmillaCarteira.ts`): a ordem da spec §4.3 (além do normal primeiro, do maior atraso
  para o menor; depois todos pelo tempo na etapa); "parado" = dias inteiros > normal; o normal em
  palavras por fonte (`medido`, `geral` = estimado, `coluna` = prazo do Kanban).
- **Botão do cartão:** decide direto só Aplicar habilitado e "Marcar como feito"; cobrança e pedido da
  troca ("Revisar e enviar"), documento travado e sem projeto abrem o detalhe.

**Ficou de fora** (entregas seguintes): as chaves e o Desfazer do "Fiz sozinha" (4), o resumo da manhã
(5), o item `parado` (3), "Passar para outra pessoa" (coluna nova), a barra da troca do medidor da ENEL
(consulta nova) e a certeza da sugestão (não há dado). Saíram da página: as abas, a faixa de saúde, a
busca e os filtros da aba Decidir.

**Prova.** Funções puras com vitest (`ludmillaTempo`, `ludmillaCarteira`, `ludmillaBarras`,
`ludmillaFila`, `ludmillaRecado`, `ludmillaLeituras`, `pagina/modo`). A página foi provada em harness
com dados inventados em 1440 × 900, 1100 × 800 e 390 × 844 e auditada com `web-design-guidelines`
(prints fora do git). **O que NÃO está provado:** a página com os dados reais — abrir `/ludmilla` depois
do deploy, como gestor e como projetista, e conferir o recado, as contagens da carteira contra
`ludmilla_carteira()` e o Desfazer numa decisão de verdade.
```

- [ ] **Step 6: Roadmap e CLAUDE.md**

Em `docs/project/roadmap.md`, troque:

```markdown
- **Ludmilla, a melhor funcionária — repaginação da página: entrega 1 (medir) no ar em
  09/11/2026; falta o plano da entrega 2 (página nova).** Registro das etapas, tempo normal e
  carteira no banco ([plano](../superpowers/plans/2026-11-08-ludmilla-e1-medir.md), 19 provas
  verdes). Antes da entrega 3 (parados), decidir com quem está a bola em "Aprovado".
```

por:

```markdown
- **Ludmilla, a melhor funcionária — repaginação da página: entregas 1 (medir) e 2 (página nova)
  prontas.** Registro das etapas, tempo normal e carteira no banco
  ([plano da 1](../superpowers/plans/2026-11-08-ludmilla-e1-medir.md)); a página nova no mundo "Conta
  de luz" ([plano da 2](../superpowers/plans/2026-11-09-ludmilla-e2-pagina.md)), provada em harness —
  falta conferir com os dados reais depois do deploy. "Com quem está" em Aprovado decidido em 09/11.
  Próxima: entrega 3 (parados).
```

Em `CLAUDE.md`, na linha da Ludmilla da tabela de módulos, troque o trecho:

```
página = caixa de decisões (Decidir + A fazer, Desfazer em 8 s; contas, criações e registro em abas)
```

por:

```
página nova no mundo "Conta de luz" (três colunas: recado, Para decidir por grupo e por dono, carteira com histórico em barras e o normal medido, Fiz sozinha, Diário, Ajustes com as contas; uma coluna por vez no celular; Desfazer em 8 s)
```

- [ ] **Step 7: A memória do módulo (fora do repositório)**

Na memória `ludmilla.md` (caminho em **Files**), acrescente ao fim da linha de resumo, sem apagar nada:
`; página NOVA (entrega 2, nov/2026): estrutura A no mundo "Conta de luz", só na /ludmilla, sem banco novo — regras puras em ludmillaFila/Carteira/Barras/Recado/Leituras, casca PaginaDaLudmilla; tokens só dentro de .ludmilla-mundo; falta conferir com dados reais`. No `MEMORY.md`, na linha da Ludmilla, troque `página nova "caixa de entrada" NO AR 26/10 (Decidir + abas; Desfazer em 8 s)` por `página nova "Conta de luz" (entrega 2, três colunas; Desfazer em 8 s)`.

- [ ] **Step 8: Commit**

`$RASCUNHO/msg-e2-t14.txt` (Write):

```
feat(ludmilla): a /ludmilla vira a página nova "Conta de luz" (entrega 2, página)

pages/Ludmilla.tsx passa a ligar os hooks de sempre e os da entrega 1 à
PaginaDaLudmilla. Saem as abas, a faixa de saúde, a busca e os filtros da
aba Decidir (AbaDecidir, CaixaDeDecisoes, FiltrosDaCaixa, LinhaDaCaixa,
BarraDeAbas, FaixaDeSaude, AbaConcessionarias, RegistroDaLudmilla). As
RPCs, o Desfazer de 8 s e o contador da barra lateral não mudam. Doc do
módulo, roadmap e CLAUDE.md atualizados.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add src/pages/Ludmilla.tsx docs/modules/integrations/ludmilla.md docs/project/roadmap.md CLAUDE.md
git commit -F "$RASCUNHO/msg-e2-t14.txt" -- src/pages/Ludmilla.tsx docs/modules/integrations/ludmilla.md docs/project/roadmap.md CLAUDE.md src/components/ludmilla/decidir/AbaDecidir.tsx src/components/ludmilla/decidir/AbaDecidirConectada.tsx src/components/ludmilla/decidir/CaixaDeDecisoes.tsx src/components/ludmilla/decidir/FiltrosDaCaixa.tsx src/components/ludmilla/decidir/LinhaDaCaixa.tsx src/components/ludmilla/topo/BarraDeAbas.tsx src/components/ludmilla/topo/FaixaDeSaude.tsx src/components/ludmilla/topo/abas.ts src/components/ludmilla/abas/AbaConcessionarias.tsx src/components/ludmilla/abas/RegistroDaLudmilla.tsx
git show --stat HEAD
```

- [ ] **Step 9: Push e conferência com dados reais**

Push pela regra da casa (memória `session-workflow`): empurrar só se a `main` não levar commits de outra frente; se levar, perguntar ao usuário antes. Depois do deploy, abrir `/ludmilla` como gestor e como projetista e conferir: o recado, as contagens da carteira contra o Kanban da mesma conta (sem rodar SQL: esta entrega proíbe `supabase db query`; se uma contagem parecer errada, pedir ao usuário que confira), uma decisão com Desfazer e uma que vai ao banco, a folha no celular. Registrar o resultado no fim da seção nova de `ludmilla.md` (o "O que NÃO está provado" encolhe).

---

## Auto-revisão (feita ao escrever o plano)

**Cobertura da spec (entrega 2):**
- §3 mundo (cores, Public Sans, números tabulares, barras pequena e grande, "Para decidir agora" em sol, avatar com `aria-label`) → Tasks 2, 7, 12.
- §4.1 faixa → Task 12. §4.2 coluna da esquerda (recado sem IA, "desde", grupos com contagem, "Fila de", Carteira, Comigo, Leituras → Ajustes; item escolhido em sol) → Tasks 4, 5, 12, 13.
- §4.3 meio (cartões completos, linhas da carteira na ordem, Fiz sozinha, Diário, Ajustes) → Tasks 3, 9, 10, 11, 13.
- §4.4 direita (detalhe com histórico grande, "O que eu vi", "O que eu sugiro", e-mail editável, ações, "Abrir o projeto"; ficha; painéis de Fiz sozinha, Diário e Ajustes com "Onde eu leio" e "Ainda não acompanho") → Tasks 8, 10, 11, 13. Fora, com motivo: "Passar para outra pessoa", certeza.
- §4.5 (Desfazer 8 s, próximo item, contador, CAPTCHA acima de tudo) → Tasks 6, 13, 14.
- §4.6 (esqueleto, erro por fonte, lista vazia com a frase) → Tasks 5, 7, 9, 10, 11, 13.
- §5 celular (uma coluna por vez, menu em tela cheia, detalhe em tela cheia com botões embaixo, 44 px) → Tasks 12, 13.
- §6.1 → Task 3. §6.2 → Tasks 1, 3, 13 (o "passar para" fora). §6.3 → Tasks 1, 2 (a barra da troca fora). §6.4 → Task 1 (rótulos).
- §9.2 (troca a página inteira; Fiz sozinha sem Desfazer; Ajustes com as contas e os avisos) → Tasks 11, 14.
- §10 (vitest das regras; harness; `web-design-guidelines`; tsc 65 e build; dados reais depois) → todas; Task 13 Steps 8–10; Task 14 Step 9.

**Placeholders:** nenhum "TBD"/"similar à task N"; todo passo de código traz o código. O passo de auditoria (Task 13, Step 10) lista o que conferir e o critério; as correções dependem do que ela achar.

**Consistência de nomes conferida:** `LinhaDaCarteira` (tipo, Task 1) × `LinhaDaCarteira` (componente, Task 10, que importa o tipo como `LinhaDaRpc` onde precisa); `TODOS`/`SEM_DONO`; `DadosDoCartao`, `DadosDaLinha`, `TempoDaLinha`, `PropsDaFicha`, `EstadoDoDiario`, `ItemDeNavegacao`, `PropsDaPagina`, `DecidirItem`; `recado: RecadoDoDia | null` em `ColunaDaEsquerda`, `PainelDoRecado` e `PropsDaPagina`; `leiturasDasContas(…, soma: SomaDeLeituras)` sem `null` (a falha vira `leituras: null` na página).

