# Roadmap, Pendências e Débitos Técnicos

## Pendências externas (config, não código)
- **Maps Static API** (Google Cloud): habilitar no mesmo projeto da
  `VITE_GOOGLE_MAPS_API_KEY` para a **planta de localização** do diagrama
  unifilar funcionar (o Maps JavaScript API já está ativo; a Static é uma
  API separada). Console → APIs e serviços → Biblioteca → "Maps Static API"
  → Ativar. Sem isso o sistema avisa o motivo e segue sem a planta.
- **Resend**: configurar `RESEND_API_KEY`, domínio verificado e `NOTIFY_FROM`
  para as automações de e-mail realmente enviarem.
- **Proteção de senha vazada** no Supabase Auth: habilitar no painel.
- **Listagem pública de buckets** `avatars`/`tenant-logos`: revisar.

## Tarefas de produto em aberto (do backlog de sessão)
- **Diagrama unifilar — evoluir do alpha**: hoje tem edição manual completa —
  arrastar de qualquer ponto do símbolo, girar, **redimensionar**, ligar com
  derivações (`ConnectionEndpoint` symbol/point — uma linha sempre termina
  num componente ou em cima de outra linha, nunca solta no vazio, por pedido
  do usuário) que **grudam pixel-a-pixel** no componente/linha mais perto
  (`CONNECTION_INSET` + `findNearestSymbol`/`nearestPointOnPolyline`),
  selecionar e arrastar uma
  linha inteira como bloco, excluir com Delete, 12 símbolos calibrados por
  dois diagramas reais (ENEL) — disjuntor bipolar/tripolar, chave CC, medidor
  convencional/bidirecional, DPS, fusível, aterramento, quadro de
  distribuição —, componentes/fotos/textos adicionáveis livremente (só
  visual, sem tocar no cadastro do projeto), texto e legenda com tags do
  projeto (mesmo catálogo dos templates .docx). **Motor de templates** tem
  aba própria (`/admin/diagram-templates`, editor reaproveitado —
  `DiagramEditor.tsx` —, persistido em `diagram_templates` no banco), acesso
  por papel (admin/staff) em vez de só master, ainda restrito à GD Manager
  (`tenants.is_library`), e **"Importar de PDF"** com reconhecimento por IA
  (`diagram-recognize`): posições normalizadas 0–100 preservando a
  disposição espacial do original, grupos, bitolas por trecho, e o PDF
  original como fundo esmaecido de conferência no editor (nunca exportado).
  A folha exportada tem legenda automática, carimbo completo (resp.
  técnico/ART/revisão editáveis com tags), caixas de agrupamento e bitola
  por ligação — ver [modules/diagrams](../modules/diagrams/overview.md) e
  [ADR 0006](../adr/0006-cad-engine-alpha.md). **Plano de 4 fases da revisão
  (10ª rodada) todo entregue**: A folha profissional, B UX do editor
  (undo/redo Ctrl+Z, zoom/pan, painel de propriedades, multi-seleção,
  Ctrl+D), C reconhecimento fiel + underlay, D ciclo fechado (diagrama do
  projeto em `project_diagrams` no banco + importar modelo no modal com
  sugestão por concessionária). **11ª rodada: engenheiro revisor de IA**
  (`diagram-review`, Opus + adaptive thinking): 2ª passada automática na
  importação + botão "Revisão do engenheiro" no editor de modelos — compara
  o original com o redesenho (imagem + JSON) usando checklist de engenharia
  e devolve o diagrama corrigido + notas. **12ª rodada: motor dinâmico em 4
  fases** — (1) conexões vivas: portas nomeadas por símbolo, derivação
  formal que acompanha a linha-mãe, nós de junção (•); (2) desenho
  inteligente: encaixe ortogonal com prévia elástica, roteamento com desvio
  de símbolos, guias de alinhamento, arrastar segmento individual; (3)
  figuras de anotação (retângulo/elipse/divisória/seta), grupos com estilo
  e "arrastar conteúdo junto", frente/trás; (4) modos Selecionar×Ligar +
  menu de contexto. **13ª rodada**: Fase E (soltar componente em série NO
  FIO divide a ligação; remover refaz; condutores CA/CC/terra com cor e
  legenda), botão "Organizar" (alinha fileiras/colunas + re-roteia),
  exportador **DXF** R12 com camadas, template paramétrico (casamento por
  concessionária + nº de inversores; multiplicar ramal FV automaticamente)
  e reconhecimento que aprende (`diagram_ai_lessons`: correções do revisor
  viram lições nos prompts). Próximos: validador elétrico local em tempo
  real (checklist do engenheiro sem IA); calibrar com unifilares de outras
  concessionárias; liberar pra todos os tenants (RLS pronto — decisão de
  produto pendente); motor de layout automático completo; BESS/múltiplos
  inversores oficiais no cadastro.
- **Motor de Engenharia (Rules Engine)** 🟡 Fase 1 ✅ (jul/2026): regras de
  dimensionamento centralizadas no banco (12 grupos, editáveis com
  histórico na aba "Regras de Engenharia"), motor puro que sugere arranjos
  de strings/distribuição entre inversores/DC-AC com ≥2 opções explicadas e
  alertas que nunca bloqueiam, painel "Usar esta" no projeto gerando o
  diagrama. **Fase 2 ✅** (jul/2026): liga/desliga por função (interruptor
  por grupo) e por regra; dimensionamento elétrico simplificado (queda de
  tensão NBR 5410, bitolas CC/CA, disjuntor, aterramento) no painel do
  projeto; form de datasheet estruturado (tech_specs) no cadastro de
  Equipamentos. **Topologia multi-arranjo ✅** (jul/2026): "Usar esta"
  gera 1 disjuntor por arranjo + junção em nó + disjuntor geral opcional
  (regra) + DPS pós-junção + cargas do local de referência, cena 100%
  editável (`suppressedIds` permite remover até componentes fixos do
  cadastro). **Padrão de entrada + auto-reorganização ✅** (jul/2026):
  bloco PADRÃO DE ENTRADA no diagrama (disjuntor do padrão com dados das
  regras da concessionária + medidor + DPS em paralelo + placa de
  advertência com a FOTO REAL); >3 arranjos comprimem espaçamento e
  reduzem escala dos ramais (A4 sempre). **Validador elétrico local ✅ +
  memoriais ENEL/EDP ✅** (jul/2026): checklist em tempo real no diagrama
  do projeto (sem IA, nunca bloqueia) e os 2 memoriais recriados como
  templates com tags de engenharia (`docs/modelos-memoriais/`; SEM lista
  de materiais — concessionárias não exigem). **Fase 3 (restante)**:
  microinversores completos, memorial de cálculo, assistente. Ver
  [modules/engineering](../modules/engineering/overview.md) e
  [ADR 0007](../adr/0007-engineering-rules-engine.md).
- **Extrato "Agentes de IA" no console master** ✅ (jul/2026): saldo estimado
  (recargas lançadas − custo por tokens reais), gasto por agente/tenant/dia,
  projeção de duração do saldo e alerta de reabastecimento. Futuro possível:
  puxar custo oficial da Admin API da Anthropic em vez do cálculo local.
- **Templates de outras concessionárias em .pdf/.xls**: hoje o motor só aceita
  `.docx`. Avaliar suporte a PDF com formulário (AcroForm) e a `.xlsx`.
- **Catálogo de equipamentos no formulário público**: o combobox não aparece no
  form público (catálogo só é legível por autenticado). Precisa de RPC que
  devolva marca/modelo/potência validando o token — sem expor o catálogo todo.
- **Validação de dígito verificador** de CPF/CNPJ (hoje só valida tamanho).

## Assinatura digital
Módulo [signatures](../modules/signatures/overview.md) — Fase 1, só GD Manager.
**Primeiro passo pendente: o [aceite ponta a ponta](../modules/signatures/aceite.md)**
(nada foi deployado nem rodado ainda; a tela autenticada nunca foi vista).

**Fora de escopo, por decisão:**
- **Gov.br** — não há API pública para assinar em nome de terceiro.
- **Certificado A3** (token/cartão) — exige a máquina física; o robô roda na VPS.
- **Cosign** (mais de uma assinatura no mesmo PDF); por isso o assinado nasce
  sem a marca `assinavel_id`.
- **Carimbo do tempo de ACT** (pago). Hoje a assinatura é `adbe.pkcs7.detached`,
  **não PAdES-Baseline**. Se o passo "validar em `validar.iti.gov.br`" do aceite
  rejeitar essa forma, este é o caminho — e vira decisão de custo e de produto.
- Validação de assinatura de terceiros em documentos recebidos.

**Previsto na spec e não construído:**
- **Documento gerado pelo Bidu/template como assinável.** A coluna
  `concessionaire_templates.assinavel_id` existe sem uso, e `bidu_anexar_documento`
  não ganhou `p_assinavel_id`. Hoje o gerado é baixado e enviado de novo pela aba
  Assinaturas. `documento_marcar_assinavel` e o caminho `documentId` do hook
  `usePedirAssinatura` já existem para esse dia; falta a tela chamá-los (e,
  então, decidir se a função deve distinguir gerado de anexo qualquer — hoje,
  com tipos `ambos`, qualquer anexo do projeto pode receber a marca por chamada
  direta; a UI não expõe e as barreiras seguintes são o "está certo" e a triagem).
- **Tela do catálogo** de documentos assináveis (hoje só `catalogo_assinavel_salvar`).
- Aviso na tela quando alguém tenta marcar um dos **45 documentos antigos** que
  nunca poderão ser marcados (38 `public/…` e 7 com nome fora do padrão).

**Dívidas que importam:**
- **`npm ci` do instalador roda como root com a service role ainda no ambiente**
  (o `unset` vem depois): script de `postinstall` de qualquer dependência herda a
  chave que decifra a senha do certificado. Correção de uma linha:
  `env -u SUPABASE_SERVICE_ROLE_KEY npm ci …`. A Ludmilla tem o mesmo padrão
  (e ainda passa a chave na linha de comando do `ssh`).
- **A assinatura não é verificada de verdade.** `assinar()` confere prefixo,
  `/ByteRange` e `/Contents` preenchido, mas não valida o digest do CMS. Dá para
  fazer com `node:crypto` — **não com `node-forge`** (ver
  [RN-ASS-22](../modules/signatures/business-rules.md)).
- **O admin recebe o CPF completo do titular pela rede** (a tela mascara). Só
  grant de coluna ou RPC já mascarada resolve; o staff já não o recebe.
- **Trocar o certificado deixa a senha antiga no Vault e o `.pfx` antigo no
  bucket** — sem uso e inalcançáveis por `authenticated`, mas sem limpeza.
- **Tempo:** o banco compara a validade com a data em UTC (entre 21h e 0h de
  Brasília no último dia ele já recusa), e a estampa leva a data do *preparo*.
- **Sem Zé ligado no tenant** a pendência de exceção abre sem avisar ninguém e
  expira recusando em 24 h.
- **`assinatura_recusar` (pela tela) não comenta no card nem escreve no
  histórico**, ao contrário da recusa do robô.
- **A situação `assinando` não é reclamável e não tem timeout**; o worker nunca
  a grava, então o risco não se materializa — manter assim.
- **Estampa opaca** pode cobrir um carimbo do canto inferior direito; `MediaBox`
  com origem ≠ 0, `CropBox`, `/Rotate` e página estreita (A6) não são tratados.
- **A migração `20261003140000` tem timestamp anterior** a migrações da Ludmilla
  (`20261005*`+): um `supabase db push` pode exigir `--include-all` (a casa
  aplica com `db query --linked`, que não passa por isso).
- Faltam índices nas FKs `assinaturas.document_id`/`.assinavel_id`/`.certificado_id`
  e `documents.assinavel_id`; `REVOKE` não cobriu `TRUNCATE`/`REFERENCES`/`TRIGGER`
  (PostgREST não os expõe — endurecimento, não regressão).
- Resquício do termo "PAdES" em dois comentários de `worker/assinador/src`.

## Módulos planejados (ainda não implementados)
- **Marketplace** — ver [modules/marketplace](../modules/marketplace/overview.md).
- **BESS (armazenamento/baterias)** — ver [modules/bess](../modules/bess/overview.md).
- **Mercado Livre de energia** — ver [modules/market-free](../modules/market-free/overview.md).
- **Automação WhatsApp** (Evolution API na VPS): motor de regras
  evento→WhatsApp por tenant. Decidido, a implementar.

## Débitos técnicos conhecidos
- **Tipos gerados do Supabase defasados** (~65 erros de tipo pré-existentes):
  regenerar `src/integrations/supabase/types.ts` resolveria em massa. Exige
  login na CLI do Supabase.
- **`tsconfig.json` raiz não checa nada** (`files: []`); usar sempre
  `tsconfig.app.json`. Risco de falso "ok" no typecheck.
- **Deploy de edge functions é lista manual** no workflow — fácil esquecer de
  publicar função nova. Caso real: a `assinatura-triagem` **não está em
  nenhum workflow** (o deploy dela é manual, no [aceite](../modules/signatures/aceite.md)),
  e o job de funções do `deploy.yml` tem `continue-on-error`: uma falha ali
  não derruba o deploy e passa em silêncio.
- **Estilo misto** inline vs shadcn/ui em telas legadas.
- **Convenção de faixa de preço** (`tiered_flat`): no limite exato, vale a faixa
  que termina nele — documentado, mas pode confundir.

## Riscos
- Instabilidade da VPS HostGator (já houve quedas com rsync cancelado e SSH
  fora). Monitorar; considerar migração/redundância.
- **Logo em PDF**: SVG não é desenhado pelo jsPDF (ignorado em silêncio). Usar
  PNG/JPG.
