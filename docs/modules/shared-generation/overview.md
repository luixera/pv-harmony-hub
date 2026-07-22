# Módulo: Geração Compartilhada

**Estado: 🟡 Parcial** — suportado como parte de Projetos, sem tela dedicada.

## Objetivo
Permitir projetos de **geração compartilhada / autoconsumo remoto**: uma unidade
**geradora** e uma ou mais unidades **beneficiárias** que recebem os créditos.

## Onde vive hoje
- Campo `project_general_data.has_beneficiaries` (booleano).
- Documentos: `document_type` `energy_bill_generator` (conta da geradora) e
  `energy_bill_beneficiaries` (contas das beneficiárias).
- No formulário: checkbox "Existem unidades beneficiárias?" habilita o upload
  múltiplo das contas.

## Regras de negócio
- **RN-SG-01** — Quando há beneficiárias, o formulário exige as contas de energia
  das beneficiárias.
- **RN-SG-02** — A conta da geradora é sempre exigida.

## Limitações
- Não há entidade estruturada por beneficiária (nome, UC, % de rateio) — hoje é
  tratado por anexos. Estruturar é uma melhoria futura.

## Melhorias futuras
- Tabela de beneficiárias com rateio percentual e validação da soma.
- Variáveis de template por beneficiária.
