# Decisões de Produto

Registro de decisões de produto/UX (não arquiteturais — essas ficam em
[../adr](../adr/README.md)). Decisões tomadas com o cliente.

## Log

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
