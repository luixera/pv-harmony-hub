/**
 * VÍNCULO COM O CATÁLOGO — a regra única de "qual item do catálogo é o
 * equipamento deste projeto".
 *
 * O projeto guarda `inverter_catalog_id`/`module_catalog_id` quando o
 * equipamento foi escolhido num combobox. Trocar o equipamento depois (no
 * modal, na conferência) muda marca/modelo — e o vínculo continua apontando
 * para o ANTIGO. Confiar nele às cegas já causou dois estragos:
 *
 *  - ago/2026: o motor dimensionou com a ficha do inversor errado (PRJ-49561:
 *    texto SUNGROW SG7.5RS-L, vínculo GROWATT NEO 2250M-X2);
 *  - set/2026: o **pacote do instalador** saiu com INMETRO/datasheet do
 *    equipamento antigo depois de a troca ser feita no modal.
 *
 * Por isso: o vínculo só vale enquanto BATER com o que está escrito no
 * projeto; não batendo, casa-se por marca+modelo. A comparação ignora caixa,
 * espaços e pontuação — o mesmo equipamento aparece como "HMS-1875DW-4T" e
 * "HMS-1875DW4T", "SOFAR 7,5KTLM" e "SOFAR 7.5KTLM".
 */

export interface ItemCatalogoMin {
  id: string;
  brand: string | null;
  model: string | null;
}

/** Só letras e números, minúsculo: é assim que dois nomes do mesmo equipamento se encontram. */
export const chaveEquip = (t?: string | null): string =>
  String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * O item do catálogo ainda é o equipamento escrito no projeto?
 *
 * Decide pelo MODELO (a marca varia demais: "Growatt" × "GROWATT NEW ENERGY").
 * Sem modelo no projeto não há como desmentir o vínculo — ele é mantido.
 */
export function vinculoAindaVale(
  item: Pick<ItemCatalogoMin, 'brand' | 'model'> | null | undefined,
  modeloDoProjeto?: string | null,
): boolean {
  if (!item) return false;
  const alvo = chaveEquip(modeloDoProjeto);
  if (!alvo) return true;
  return chaveEquip(item.model) === alvo;
}

/**
 * Acha o equipamento no catálogo: pelo vínculo (se ainda valer) e, senão, por
 * marca+modelo; o modelo sozinho é o último recurso.
 */
export function acharNoCatalogo<T extends ItemCatalogoMin>(
  itens: T[], id?: string | null, marca?: string | null, modelo?: string | null,
): T | null {
  const mo = chaveEquip(modelo);
  const ma = chaveEquip(marca);

  if (id) {
    const porId = itens.find(i => i.id === id);
    if (porId && vinculoAindaVale(porId, modelo)) return porId;
  }
  if (!mo) return null;
  return itens.find(i => chaveEquip(i.model) === mo && chaveEquip(i.brand) === ma)
      ?? itens.find(i => chaveEquip(i.model) === mo)
      ?? null;
}
