# Roadmap, Pendências e Débitos Técnicos

## Pendências externas (config, não código)
- **Resend**: configurar `RESEND_API_KEY`, domínio verificado e `NOTIFY_FROM`
  para as automações de e-mail realmente enviarem.
- **Proteção de senha vazada** no Supabase Auth: habilitar no painel.
- **Listagem pública de buckets** `avatars`/`tenant-logos`: revisar.

## Tarefas de produto em aberto (do backlog de sessão)
- **Diagrama unifilar — evoluir do alpha**: hoje tem edição manual completa —
  arrastar de qualquer ponto do símbolo, girar, **redimensionar**, ligar com
  derivações e linhas soltas (`ConnectionEndpoint` symbol/point) que **grudam
  pixel-a-pixel** no componente/linha mais perto (`CONNECTION_INSET` +
  `findNearestSymbol`/`nearestPointOnPolyline`), selecionar e arrastar uma
  linha inteira como bloco, excluir com Delete, 9 símbolos (disjuntor
  corrigido, DPS/fusível/aterramento/quadro de distribuição novos),
  componentes/fotos/textos adicionáveis livremente (só visual, sem tocar no
  cadastro do projeto), texto e legenda com tags do projeto (mesmo catálogo
  dos templates .docx). **Motor de templates** ganhou aba própria
  (`/admin/diagram-templates`, editor reaproveitado — `DiagramEditor.tsx` —,
  persistido em `diagram_templates` no banco), acesso por papel
  (admin/staff) em vez de só master, ainda restrito à GD Manager
  (`tenants.is_library`) — ver [modules/diagrams](../modules/diagrams/overview.md)
  e [ADR 0006](../adr/0006-cad-engine-alpha.md). Próximos passos, em ordem
  sugerida: (1) **importar um modelo salvo dentro do modal do projeto** —
  falta decidir com o usuário como ele escolhe qual (manual, por
  concessionária, por critério paramétrico) antes de construir; (2)
  **reconhecimento automático a partir de um PDF enviado** (pedido do
  usuário, decidido como iniciativa própria e dedicada — precisa de IA de
  visão, não de um parser determinístico); (3) calibrar símbolos com mais
  unifilares reais; (4) liberar o motor de templates para todos os tenants
  (RLS já pronto); (5) motor de layout automático (grafo + roteador com
  detecção de cruzamento); (6) exportador DXF; (7) suportar BESS/múltiplos
  inversores/geração compartilhada oficialmente no cadastro (hoje só dá pra
  representar visualmente, avulso).
- **Templates de outras concessionárias em .pdf/.xls**: hoje o motor só aceita
  `.docx`. Avaliar suporte a PDF com formulário (AcroForm) e a `.xlsx`.
- **Catálogo de equipamentos no formulário público**: o combobox não aparece no
  form público (catálogo só é legível por autenticado). Precisa de RPC que
  devolva marca/modelo/potência validando o token — sem expor o catálogo todo.
- **Validação de dígito verificador** de CPF/CNPJ (hoje só valida tamanho).

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
  publicar função nova.
- **Estilo misto** inline vs shadcn/ui em telas legadas.
- **Convenção de faixa de preço** (`tiered_flat`): no limite exato, vale a faixa
  que termina nele — documentado, mas pode confundir.

## Riscos
- Instabilidade da VPS HostGator (já houve quedas com rsync cancelado e SSH
  fora). Monitorar; considerar migração/redundância.
- **Logo em PDF**: SVG não é desenhado pelo jsPDF (ignorado em silêncio). Usar
  PNG/JPG.
