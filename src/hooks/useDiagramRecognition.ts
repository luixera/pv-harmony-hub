import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ComponentKind } from '@/utils/cadEngine/types';

export interface RecognizedComponent {
  id: string;
  kind: ComponentKind;
  label: string;
}

export interface RecognizedConnection {
  from: string;
  to: string;
}

interface RecognizeResult {
  components: RecognizedComponent[];
  connections: RecognizedConnection[];
  warnings: string[];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Reconhecimento automático de diagrama unifilar a partir de um PDF/imagem
 * enviado (edge function `diagram-recognize`, mesmo mecanismo do Claudinho —
 * IA de visão, não um parser determinístico). Devolve só topologia (quais
 * componentes existem e como se ligam) — a cena inicial ainda precisa ser
 * revisada no editor (ver `buildSceneFromRecognition`).
 */
export function useDiagramRecognition() {
  return useMutation({
    mutationFn: async (file: File): Promise<RecognizeResult> => {
      const base64 = await fileToBase64(file);
      const mimeType = file.type || 'application/pdf';
      const { data, error } = await supabase.functions.invoke('diagram-recognize', {
        body: { base64, mimeType },
      });
      if (error) throw new Error(error.message || 'Erro ao chamar o reconhecimento');
      if (!data?.ok) throw new Error(data?.error || 'Não foi possível reconhecer o diagrama');
      return {
        components: data.components ?? [],
        connections: data.connections ?? [],
        warnings: data.warnings ?? [],
      };
    },
  });
}
