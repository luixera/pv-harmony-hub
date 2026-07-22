# Módulo: BESS (Armazenamento / Baterias)

**Estado: ⛔ Não implementado — planejado.**

Não existe suporte a **BESS** (Battery Energy Storage System) no sistema atual.
O cadastro de equipamentos cobre **inversores** e **módulos**; não há entidade
de bateria/armazenamento.

## Ideia (a definir)
Suportar projetos com armazenamento: cadastro de baterias no catálogo, cálculo
de autonomia, documentos específicos e possível impacto na homologação.

## Base existente
- **Catálogo de equipamentos** (`equipment_catalog`) — extensível a um novo
  `type` (ex.: `battery`) com seus documentos.
- Estrutura de `project_equipment` (hoje inversor/módulo).

## Próximos passos
- Definir requisitos regulatórios e de cálculo com o cliente.
- ADR quando houver decisão arquitetural.

> Não documentar regras aqui até existir implementação.
