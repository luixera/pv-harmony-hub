import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RecognizedComponent, RecognizedConnection, RecognizedGroup } from '@/hooks/useDiagramRecognition';

export interface ReviewInput {
  /** Página do documento original como data URL (o underlay já renderizado serve). */
  originalDataUrl: string;
  /** Render do nosso redesenho atual (data URL JPEG) — opcional mas recomendado. */
  renderDataUrl?: string | null;
  current: {
    components: unknown[];
    connections: unknown[];
    groups?: unknown[];
  };
}

export interface ReviewResult {
  components: RecognizedComponent[];
  connections: RecognizedConnection[];
  groups: RecognizedGroup[];
  /** O que o engenheiro revisor corrigiu (em português, telegráfico). */
  notes: string[];
}

function splitDataUrl(dataUrl: string): { base64: string; mimeType: string } {
  const m = /^data:([\w/+-]+);base64,(.+)$/.exec(dataUrl);
  if (m) return { mimeType: m[1], base64: m[2] };
  return { mimeType: 'image/jpeg', base64: dataUrl };
}

/**
 * "Engenheiro revisor" de IA (`diagram-review`, Opus + adaptive thinking):
 * compara o documento original com o nosso redesenho e devolve o diagrama
 * corrigido no mesmo schema do reconhecimento, mais as notas do que mudou.
 * Roda como 2ª passada automática da importação de PDF e sob demanda pelo
 * botão "Revisão do engenheiro" no editor de modelos.
 */
export function useDiagramReview() {
  return useMutation({
    mutationFn: async (input: ReviewInput): Promise<ReviewResult> => {
      const { data, error } = await supabase.functions.invoke('diagram-review', {
        body: {
          original: splitDataUrl(input.originalDataUrl),
          render: input.renderDataUrl ? splitDataUrl(input.renderDataUrl) : undefined,
          current: input.current,
        },
      });
      if (error) throw new Error(error.message || 'Erro ao chamar a revisão');
      if (!data?.ok) throw new Error(data?.error || 'A revisão não retornou um resultado válido');
      return {
        components: data.components ?? [],
        connections: data.connections ?? [],
        groups: data.groups ?? [],
        notes: data.notes ?? [],
      };
    },
  });
}
