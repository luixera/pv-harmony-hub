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
- **RN-HOM-05a** — A categoria do projeto é **derivada** (fase + disjuntor) por
  `matchEntryRule`, mas pode ser **definida à mão** em
  `project_general_data.entry_rule_id` — caso do **aumento de carga** junto com
  o projeto solar (a UC sai de 63A bifásico e vai para 80A trifásico, e é a
  categoria nova que vale). Todo consumidor usa `resolveEntryRule`
  (escolhida > automática): modal do projeto, diagrama unifilar, geração de
  documentos e pacote do instalador. Nulo = automática; regra apagada da
  concessionária → volta sozinho para a automática.
- **RN-HOM-05b** — A tela nunca esconde classificação aproximada: sem
  concessionária, sem regras cadastradas, sem fase, sem disjuntor e disjuntor
  acima da maior categoria da fase são ditos explicitamente. Com categoria
  escolhida à mão, mostra também o que a automática diria.
- **RN-HOM-05c** — A **empresa integradora pede a vistoria** pelo modal do
  projeto, e o botão só libera com o projeto na etapa **Aprovado**. O pedido
  cria tarefa (prazo 3 dias, prioridade alta) para **o admin do tenant e para
  o projetista responsável**, avisa os dois no sino e registra em comentários
  e histórico. **Não move o card** — quem muda a etapa é a equipe. Um pedido
  em aberto por vez (`tasks.origin = 'vistoria_request'`). Tudo decidido no
  servidor pela RPC `solicitar_vistoria` (SECURITY DEFINER), porque a empresa
  não tem nem deve ter permissão para criar tarefa para outra pessoa;
  `vistoria_status` informa a tela, já que a empresa não enxerga as tarefas
  dos outros.
- **RN-HOM-06** — Templates são `.docx` por concessionária
  (`concessionaire_templates`); ao subir versão de mesmo nome, o sistema pergunta
  se exclui a antiga.
- **RN-HOM-07** — Protocolo (`project_protocols`) identifica o processo na
  concessionária e é a chave usada pelo Claudinho para casar e-mails.
- **RN-HOM-08** — Biblioteca: o GD Manager mantém concessionárias/regras/pacote/
  templates de referência; tenants importam (cópia no cadastro) e recebem aviso
  de atualização com reimport seletivo.
