import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EquipmentType } from '@/hooks/useEquipmentCatalog';

/**
 * Lê os dados técnicos do datasheet (edge function `datasheet-extract`) e
 * devolve o `tech_specs` que o Motor de Engenharia consome.
 *
 * Aceita o arquivo ainda não salvo (o que o usuário acabou de escolher no
 * formulário) OU o caminho do datasheet já guardado no catálogo — que é o caso
 * do projeto pronto, onde o datasheet chegou depois.
 *
 * Nunca grava sozinho: devolve os valores para a tela mostrar e o usuário
 * confirmar. Ler datasheet é palpite informado, não fonte da verdade.
 */

const BUCKET = 'equipment-documents';

export interface DatasheetExtractResult {
  specs: Record<string, number>;
  /** De onde a IA leu — ex.: "tabela STC, coluna 620 Wp". Vai para a tela. */
  coluna?: string;
  warnings: string[];
}

export interface DatasheetExtractInput {
  type: EquipmentType;
  brand?: string;
  model: string;
  /** Wp no módulo, kW no inversor — é o que escolhe a COLUNA num datasheet de família. */
  power?: number | null;
  /** Arquivo recém-escolhido no formulário (tem prioridade). */
  file?: File | null;
  /** Caminho no storage do datasheet já salvo. */
  datasheetPath?: string | null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function useDatasheetExtract() {
  return useMutation({
    mutationFn: async (input: DatasheetExtractInput): Promise<DatasheetExtractResult> => {
      let blob: Blob | null = input.file ?? null;
      let mimeType = input.file?.type || '';

      if (!blob) {
        if (!input.datasheetPath) throw new Error('Nenhum datasheet anexado para ler');
        const { data, error } = await supabase.storage.from(BUCKET).download(input.datasheetPath);
        if (error || !data) throw new Error('Não foi possível baixar o datasheet');
        blob = data;
        // o catálogo converte tudo para PDF ao subir (ver equipmentDocs.ensurePdf)
        mimeType = data.type || 'application/pdf';
      }

      const base64 = await blobToBase64(blob);
      const { data, error } = await supabase.functions.invoke('datasheet-extract', {
        body: {
          base64,
          mimeType: mimeType || 'application/pdf',
          type: input.type,
          brand: input.brand,
          model: input.model,
          power: input.power ?? null,
        },
      });
      if (error) throw new Error(error.message || 'Erro ao chamar a leitura do datasheet');
      if (!data?.ok) {
        const avisos = Array.isArray(data?.warnings) && data.warnings.length > 0
          ? ` (${data.warnings[0]})`
          : '';
        throw new Error((data?.error || 'Não foi possível ler o datasheet') + avisos);
      }
      return {
        specs: (data.specs ?? {}) as Record<string, number>,
        coluna: data.coluna,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      };
    },
  });
}
