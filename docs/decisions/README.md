# Decisões de Produto

Registro de decisões de produto/UX (não arquiteturais — essas ficam em
[../adr](../adr/README.md)). Decisões tomadas com o cliente.

## Log

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
