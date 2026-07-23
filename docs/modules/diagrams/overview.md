# Módulo: Diagramas

**Estado: 🟡 Alpha interno** — visível só para o **master**, operando sobre os
projetos do próprio tenant do master (GD Manager). Não disponível para os
demais tenants ainda.

## Duas interpretações (contexto histórico)
Este item da estrutura padrão tinha duas leituras possíveis:
1. Diagramas de arquitetura/fluxo (documentação) — já cobertos por Mermaid nos
   `.md` deste repositório.
2. **Diagrama unifilar elétrico do projeto** (feature de produto) — é este que
   está descrito abaixo.

## Objetivo
Gerar o **diagrama unifilar** (esquema elétrico simplificado: geração →
conversão → proteção → medição → rede) a partir dos dados já cadastrados do
projeto, como uma cartilha adicional exportável em SVG/PDF.

## Arquitetura
Existe uma proposta completa (motor de layout automático, roteamento
ortogonal, biblioteca de símbolos versionada, exportador DXF, editor visual
drag-and-drop) em `DIAGRAMA UNIFILAR/cad-engine-arquitetura.md`, fora do
repositório do app. O que está implementado hoje é uma **fatia vertical**
dessa proposta, para validar a qualidade visual antes de investir no motor
completo:

| Peça da proposta | Nesta fatia |
|---|---|
| Pacote isolado `packages/cad-engine/` (monorepo) | Módulo comum em `src/utils/cadEngine/` — este repo não é monorepo |
| Motor de layout automático (grafo, ranking, roteador ortogonal) | **Layout fixo**: componentes em fileira única, ordem pré-definida, linhas retas |
| Biblioteca de símbolos declarativa versionada | 5 símbolos fixos (`symbols.ts`), aproximados de IEC 60617 |
| Exportadores SVG / PDF / DXF / PNG via IR neutra | **SVG e PDF**, ambos consumindo a mesma `Scene` (IR já segue o princípio D1 da proposta: um exportador novo não toca em layout/símbolos) |
| JSON Técnico completo (grafo elétrico genérico) | `TechnicalJsonMvp`: cadeia fixa PV → Inversor → Disjuntor → Medidor → Rede, montada a partir de `project_equipment`/`project_general_data` do próprio projeto |

## Arquivos
- `src/utils/cadEngine/types.ts` — `TechnicalJsonMvp` + Scene IR (subconjunto de D1).
- `src/utils/cadEngine/symbols.ts` — definições geométricas dos 5 símbolos.
- `src/utils/cadEngine/buildTechnicalJson.ts` — projeto → JSON técnico (reaproveita `buildProjectValues`).
- `src/utils/cadEngine/layout.ts` — JSON técnico → `Scene` (layout fixo, sem roteador).
- `src/utils/cadEngine/exportSvg.ts` / `exportPdf.ts` — `Scene` → SVG / PDF (PDF via `jspdf`, já usado em `resumoPdf.ts` — nenhuma dependência nova).
- `src/components/projects/UnifilarTab.tsx` — prévia + botões de download.

## Permissões
Aba "Unifilar" no `ProjectModal`, gateada por `user?.isMaster` no front. Como o
master, no app normal, só vê o próprio tenant (ADR 0005 — sem bypass de RLS), e
o tenant do master é a GD Manager, o gate por `isMaster` já restringe
naturalmente a escala inicial pedida ("apenas master, empresa GD Manager") sem
precisar de RLS/RPC nova — os dados consumidos (`project_equipment`,
`project_general_data`) já são os do próprio projeto aberto no modal.

## Fluxo
```mermaid
flowchart LR
  Proj[Projeto aberto no modal] --> Build[buildTechnicalJsonFromProject]
  Build --> Layout[buildUnifilarScene - layout fixo]
  Layout --> Scene[(Scene IR)]
  Scene --> Svg[sceneToSvg - prévia na tela]
  Scene --> Pdf[sceneToPdfBlob - download]
```

## Limitações desta fatia (deliberadas)
- Só a cadeia PV→Inversor→Disjuntor→Medidor→Rede — sem BESS, sem múltiplos
  inversores/QDCs, sem geração compartilhada.
- Layout fixo em fileira única — não é o motor de grafo/roteador da proposta.
- Símbolos aproximados; **pendente calibrar** com unifilares reais aprovados da
  GD Manager (combinado com o usuário — ele vai enviar exemplos).
- Sem exportador DXF, sem editor de layout manual, sem templates reutilizáveis.
- Nada é persistido — o diagrama é recalculado a cada abertura da aba.
- Só o master vê; outros tenants não têm acesso ainda.

## Melhorias futuras
Ver a proposta completa em `DIAGRAMA UNIFILAR/cad-engine-arquitetura.md` para o
plano em etapas (motor de layout automático, roteamento, DXF, templates
reutilizáveis, editor visual, regras por concessionária, liberação para
outros tenants). Ver também [ADR 0006](../../adr/0006-cad-engine-alpha.md).
