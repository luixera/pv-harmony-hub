# Projetos — Regras de Negócio

- **RN-PROJ-01** — Todo projeto pertence a uma `company` e a um `tenant`. Código
  do projeto (`projects.code`) é único **por tenant**.
- **RN-PROJ-02** — Dados 1:1 ficam em tabelas satélite: `project_general_data`
  (titular, endereço, UC), `project_equipment` (inversor/módulos),
  `project_financials`.
- **RN-PROJ-03** — Endereço é **quebrado em partes**: `address` (logradouro),
  `address_number`, `address_complement`, `neighborhood`, `cep`, `city`,
  `state`. A tag `{endereco}` é a junção; cada parte tem sua tag. Ver
  [naming-conventions](../../project/naming-conventions.md).
- **RN-PROJ-04** — Valor do projeto é calculado por trigger na criação
  (`fn_set_project_value` → `compute_project_value`) conforme a empresa, e
  continua editável no financeiro.
- **RN-PROJ-05** — Toda mudança de etapa grava em `project_history` com autor
  (`user_id`/`user_name`). O insert **precisa ser aguardado** (supabase-js lazy).
- **RN-PROJ-06** — Staff `assigned_only` só abre projetos atribuídos a ele
  (`project_assignments`); caso contrário vê "Projeto não atribuído a você" e
  gera `forbidden_access`.
- **RN-PROJ-07** — Gerar documento/pacote usa `buildProjectValues` (fonte única).
  Equipamento fora do catálogo pode impedir anexar INMETRO/datasheet — força o
  cadastro no catálogo (com mensagem).
- **RN-PROJ-08** — Coordenadas são guardadas como `"lat, lon"`; o formulário tem
  campos separados de latitude/longitude que compõem essa string.
- **RN-PROJ-09** — Revisão (`project_revisions`): quando reprovado, cria-se uma
  revisão copiando dados gerais/equipamentos para correção.
