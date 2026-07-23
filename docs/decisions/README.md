# Decisões de Produto

Registro de decisões de produto/UX (não arquiteturais — essas ficam em
[../adr](../adr/README.md)). Decisões tomadas com o cliente.

## Log

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
