# Homologação — Regras de Negócio

## Máquina de estados (status do projeto)
Códigos e rótulos (`src/lib/statusMapping.ts`):

| Código | Rótulo |
|---|---|
| `pending` | Projetos Recebidos |
| `analysis` | Em Análise |
| `documentation` | Documentação |
| `approval` | Aguardando Aprovação |
| `approved` | Aprovado |
| `pendencia` | Pendência |
| `vistoria_solicitada` | Vistoria Solicitada |
| `completed` | Concluído |

- **RN-HOM-01** — Fluxo típico: `pending → analysis → documentation → approval →
  approved → completed`. `pendencia` e `vistoria_solicitada` são desvios que
  podem ocorrer a partir da análise/documentação.
- **RN-HOM-02** — Toda mudança de etapa grava em `project_history` com o autor.
- **RN-HOM-03** — O Kanban é configurável por `kanban_models`/`kanban_columns`;
  uma empresa pode ter modelo próprio (`company_kanban_model`).
- **RN-HOM-04** — Cada etapa pode ter um checklist (`stage_checklists`) exigido
  para avançar.
- **RN-HOM-05** — Concessionária tem **regras de padrão de entrada**
  (`concessionaire_entry_rules`): categoria por fase + disjuntor, com colunas
  customizáveis (ex.: "Demanda"). Essas colunas viram **variáveis de template**
  conhecidas. A regra vale para qualquer concessionária.
- **RN-HOM-06** — Templates são `.docx` por concessionária
  (`concessionaire_templates`); ao subir versão de mesmo nome, o sistema pergunta
  se exclui a antiga.
- **RN-HOM-07** — Protocolo (`project_protocols`) identifica o processo na
  concessionária e é a chave usada pelo Claudinho para casar e-mails.
- **RN-HOM-08** — Biblioteca: o GD Manager mantém concessionárias/regras/pacote/
  templates de referência; tenants importam (cópia no cadastro) e recebem aviso
  de atualização com reimport seletivo.
