# Glossário do Domínio

- **Tenant** — empresa assinante da plataforma (cliente do SaaS). Isola todos os
  dados. Ex.: BELLATI, CALZETTA, Projeto Energia.
- **Master** — GD Manager, operador da plataforma. Administra tenants via
  `/painel`. Cria os presets (biblioteca) que os tenants reaproveitam.
- **Empresa (company)** — integrador/cliente que envia projetos para um tenant.
  Todo projeto pertence a uma empresa. Tem link público de formulário.
- **Titular** — dono da unidade consumidora (UC) do projeto (pessoa física ou
  jurídica). Não é um usuário do sistema.
- **Projetista (staff)** — colaborador do tenant que toca os projetos no Kanban.
- **Homologação** — processo de aprovação do projeto FV junto à concessionária.
- **Concessionária** — distribuidora de energia (CPFL, etc.). Tem regras de
  padrão de entrada e templates de documentos.
- **Padrão de entrada** — categoria elétrica (por fase + disjuntor) que define
  bitola de cabo, etc. Configurável por concessionária
  (`concessionaire_entry_rules`).
- **UC** — Unidade Consumidora (número da instalação na concessionária).
- **kWp** — potência instalada (pico) do sistema fotovoltaico.
- **INMETRO / Datasheet / AFCI** — documentos do equipamento. AFCI é da **marca**
  do inversor (herdado entre modelos da mesma marca).
- **Catálogo de equipamentos** — biblioteca central compartilhada de inversores e
  módulos, com seus documentos.
- **Pacote do Projetista / Instalador** — ZIP com resumo + documentos do projeto
  + INMETRO/datasheet/AFCI + templates preenchidos.
- **Template** — documento `.docx` da concessionária com tags `{variavel}` que o
  sistema preenche com dados do projeto.
- **Claudinho** — assistente que lê e-mails das concessionárias (Gmail), casa ao
  projeto pelo protocolo e sugere a etapa. Não altera o projeto sozinho.
- **Protocolo** — número do processo na concessionária (`project_protocols`).
- **Geração compartilhada** — projeto com unidades beneficiárias além da
  geradora (`energy_bill_beneficiaries`).
- **Padrão de entrada / Kanban** — o Kanban é o fluxo de etapas do projeto.
- **Preset / Biblioteca** — conjunto pré-configurado (concessionárias, regras,
  pacote, templates) que o GD Manager mantém e os tenants importam.
