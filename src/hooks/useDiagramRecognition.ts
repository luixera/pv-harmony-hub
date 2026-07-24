import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ComponentKind } from '@/utils/cadEngine/types';

export interface RecognizedComponent {
  id: string;
  kind: ComponentKind;
  label: string;
  stage?: number;
  branch?: boolean;
  /** Posição normalizada 0–100 no documento original (quando a IA conseguiu estimar). */
  x?: number;
  y?: number;
}

export interface RecognizedConnection {
  from: string;
  to: string;
  /** Especificação do condutor escrita no trecho (ex.: "2#6mm² + #6mm²"). */
  label?: string;
}

export interface RecognizedGroup {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RecognizeResult {
  components: RecognizedComponent[];
  connections: RecognizedConnection[];
  groups: RecognizedGroup[];
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
 * IA de visão, não um parser determinístico). Devolve topologia aproximada:
 * quais componentes existem, em que ponto do fluxo principal cada um fica
 * (`stage`) e se é uma derivação (`branch`) — nunca posição/rotação exata em
 * mm. A cena inicial (`buildSceneFromRecognition`/`layoutFromRecognition`)
 * já sai parecida com um unifilar de verdade (fileira principal + derivações
 * empilhadas), mas ainda precisa de revisão no editor.
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
        groups: data.groups ?? [],
        warnings: data.warnings ?? [],
      };
    },
  });
}
