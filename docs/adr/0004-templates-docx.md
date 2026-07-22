# ADR 0004 — Templates de documento apenas em `.docx`

**Status:** Aceito

## Contexto
As concessionárias exigem anexos preenchidos. Precisávamos preencher
automaticamente mantendo a formatação oficial.

## Decisão
O motor de templates aceita **apenas `.docx`** (docxtemplater + PizZip). O
`.docx` é um ZIP de XML: dá para achar `{tag}` no texto e substituir preservando
a formatação. Tags fragmentadas pelo Word (runs `<w:t>`) são consolidadas antes.

## Consequências
- PDF e XLS não são aceitos como template (PDF é formato de saída sem "campos",
  exceto AcroForm; `.xls` binário é custoso). Ver roadmap.
- O usuário converte outros formatos para `.docx` no Word/Google Docs.
- Variáveis centralizadas em `src/utils/projectValues.ts`; editor de template com
  raio-X de tags, prévia (mammoth) e correção.
