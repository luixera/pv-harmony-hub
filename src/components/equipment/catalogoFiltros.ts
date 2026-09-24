import type { EquipmentCatalogItem } from '@/hooks/useEquipmentCatalog';

/**
 * O par condicional MARCA → MODELO do catálogo, em funções puras (a lista que
 * os dois comboboxes mostram). Fica fora dos componentes para poder ser
 * testado: é regra de negócio pequena, mas é ela que decide o que o projetista
 * vê ao trocar um equipamento.
 */

export interface MarcaDoCatalogo {
  nome: string;
  modelos: number;
}

/** Marcas distintas (sem repetir por diferença de caixa/espaço), em ordem, com quantos modelos cada uma tem. */
export function marcasDoCatalogo(itens: Pick<EquipmentCatalogItem, 'brand'>[]): MarcaDoCatalogo[] {
  const porChave = new Map<string, MarcaDoCatalogo>();
  for (const i of itens) {
    const nome = (i.brand ?? '').trim();
    if (!nome) continue;
    const chave = nome.toLowerCase();
    const atual = porChave.get(chave);
    if (atual) atual.modelos++;
    else porChave.set(chave, { nome, modelos: 1 });
  }
  return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Filtra as marcas pelo que foi digitado (sem diferenciar maiúsculas). */
export function filtrarMarcas(marcas: MarcaDoCatalogo[], texto: string): MarcaDoCatalogo[] {
  const q = (texto ?? '').trim().toLowerCase();
  return q ? marcas.filter(m => m.nome.toLowerCase().includes(q)) : marcas;
}

/**
 * Modelos que o campo Modelo deve mostrar para a marca escolhida.
 *
 * Regra que já valia no combobox de modelo e continua valendo: marca escolhida
 * → só os modelos dela; marca sem nenhum modelo no catálogo → volta a listar
 * tudo, para ninguém encarar uma lista vazia sem explicação.
 */
export function modelosDaMarca<T extends Pick<EquipmentCatalogItem, 'brand'>>(
  itens: T[], marca: string | undefined,
): { lista: T[]; filtradoPorMarca: boolean } {
  const m = (marca ?? '').trim().toLowerCase();
  if (!m) return { lista: itens, filtradoPorMarca: false };
  const daMarca = itens.filter(i => (i.brand ?? '').trim().toLowerCase() === m);
  return daMarca.length > 0
    ? { lista: daMarca, filtradoPorMarca: true }
    : { lista: itens, filtradoPorMarca: false };
}
