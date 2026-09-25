# Módulo: Projetos

## Objetivo
Núcleo do sistema. Um **projeto** é uma solicitação de homologação de um sistema
fotovoltaico: titular, endereço, unidade consumidora, equipamentos, documentos e
o andamento pelas etapas até a aprovação.

## Funcionalidades
- Criação por formulário interno (`/new-project`) e público (`/public-form/:token`).
- Modal do projeto (`ProjectModal`) — dados gerais, equipamentos, documentos,
  histórico, financeiro, comentários, tarefas, revisões, protocolos.
- Equipamentos com combobox do catálogo (filtra por marca) e cadastro rápido.
- Geração de documentos (templates .docx) e Pacote do Projetista (ZIP).
- Revisões do projeto (quando reprovado) — `project_revisions`.
- Atribuição de projetistas (`project_assignments`).
- Mapa de projetos (`/projects-map`).

## Banco
Principais: `projects`, `project_general_data`, `project_equipment`,
`documents`, `project_history`, `project_assignments`, `project_protocols`,
`project_revisions` (+ `revision_general_data`, `revision_equipment`),
`project_financials`, `comments`, `tasks`. Ver [database.md](database.md).

## Hooks
`useProjects`, `useProjectRevisions`, `useProjectAssignments`,
`useProjectProtocol`, `useDocuments`, `useComments`, `useHistory`,
`useStageChecklists`, `useTasks`, `useInstallerPackage`.

## Telas
`/projects` (Kanban), `/company/projects`, `/project/:id`, `/new-project`,
`/projects-map`.

## Permissões
admin/staff (conforme `staff_access_mode`); company vê os próprios.

## Regras / fluxos / API
Ver [business-rules.md](business-rules.md) · [flow.md](flow.md) ·
[api.md](api.md). Etapas em [homologation](../homologation/overview.md).

## Marca e modelo em lista condicional (24/09/2026)

Pedido do usuário: ao trocar o equipamento de um projeto, escolher a **marca**
numa lista e ver em **modelo** só os modelos daquela marca — para inversor e
para módulos.

Como estava: o campo **Modelo** já era combobox do catálogo filtrado pela marca
(`EquipmentModelCombobox`, `brand={...}`) tanto no NewProject quanto no modal
do projeto; a **Marca** era texto livre nos dois. O formulário **público**
segue manual de propósito (decisão antiga: a empresa cliente não cadastra
catálogo).

O que mudou: `EquipmentBrandCombobox` — marca como lista do catálogo
compartilhado, com busca, contagem de modelos por marca e digitação livre
(o catálogo não é exaustivo: marca nova não trava o projeto, só avisa que está
fora do catálogo). Escolher OUTRA marca limpa modelo e potência, porque eram do
fabricante anterior — e a lista de modelos já abre certa. Usado no
`ProjectModal` (bloco de equipamentos em edição) e no `NewProject`; o modo
"Preencher manualmente" continua devolvendo os campos de texto.

A regra das listas virou função pura em `src/components/equipment/catalogoFiltros.ts`
(`marcasDoCatalogo`, `filtrarMarcas`, `modelosDaMarca`), usada pelos dois
comboboxes e coberta por 11 testes (vitest): marca repetida com caixa/espaço
diferentes conta uma vez só, ordem pt-BR, marca fora do catálogo volta a listar
tudo em vez de lista vazia. Catálogo hoje: 20 marcas/73 modelos de inversor,
22/41 de módulo.

## Vínculo com o catálogo — pacote do instalador saía com o equipamento antigo (25/09/2026)

**Incidente (grave).** O projetista trocou o equipamento no modal e o **pacote
do instalador** veio com INMETRO/datasheet do equipamento ANTIGO.

**Causa-raiz.** `project_equipment.inverter_catalog_id`/`module_catalog_id` é o
vínculo com o item do catálogo, gravado quando se escolhe no combobox. O modal
atualizava marca/modelo/potência e **nunca tocava no vínculo** — que continuava
apontando para o equipamento anterior. O `installerPackage.resolveEquipmentDoc`
busca o documento **pelo vínculo primeiro** e só cai para marca+modelo se o
item vinculado não tiver aquele documento: com o vínculo velho apontando para
um item COM INMETRO, o pacote levava o documento errado sem nenhum aviso.
É o mesmo defeito que o Motor de Engenharia teve em ago/2026 (PRJ-49561) e que
na época foi corrigido só na aba Unifilar.

**Correção em três camadas:**

1. **Regra única** (`src/utils/equipmentMatch.ts`): `vinculoAindaVale(item,
   modelo)` e `acharNoCatalogo(itens, id, marca, modelo)` — o vínculo só vale
   enquanto o MODELO bater com o que está escrito no projeto (comparação
   ignorando caixa, espaço e pontuação: "HMS-1875DW-4T" = "HMS-1875DW4T");
   senão casa por marca+modelo, e o modelo sozinho é o último recurso. A aba
   Unifilar passou a importar daqui (a cópia local saiu) e o pacote do
   instalador passou a usar a mesma checagem antes de aceitar o vínculo.
2. **Origem** (`ProjectModal`): o vínculo entra no formulário e acompanha o
   equipamento — escolher no combobox grava o `catalog_id`; digitar o modelo à
   mão ou trocar a marca limpa; o Salvar envia os dois campos (`null` quando
   vazio). `upperizeStrings` já ignora chaves `*_id`.
3. **Dados** (`20260925100000_corrige_vinculo_catalogo.sql`): reaponta os
   vínculos que não correspondiam mais ao equipamento e apaga (NULL) o que não
   existe no catálogo. Corrigiu **4 projetos**: PRJ-46742 (inversor e módulo),
   PRJ-65110, PRJ-81556 e PRJ-89660 — todos voltaram a apontar para o item
   certo, com INMETRO.

11 testes novos cobrem a regra, incluindo o caso do incidente (vínculo
HOYMILES com o projeto já em SUNGROW) e o do WEG M030 → M060.
