import { useState } from 'react';
import { toast } from 'sonner';
import { generateDocxFromTemplate } from '@/utils/docxGenerator';

export type PreviewStep = 'idle' | 'loading' | 'preview' | 'error';

export interface DocumentPreviewState {
  step: PreviewStep;
  /** Raw HTML produced by mammoth — rendered as-is, no span injection */
  htmlContent: string;
  /** The .docx blob delivered to mammoth (filled for Type A, original for Type B) */
  docxBlob: Blob | null;
  errorMessage: string | null;
  isEditing: boolean;
  /**
   * true  → Type B: form template without tags (CPFL, CEMIG, ENEL…)
   * false → Type A: template with {{tags}} filled by Docxtemplater
   */
  isFormTemplate: boolean;
  /** Original template data values — kept for Type A DOCX re-generation */
  templateValues: Record<string, string>;
  /** Raw template ArrayBuffer — kept for Type A DOCX re-generation */
  templateBuffer: ArrayBuffer | null;
}

const INITIAL_STATE: DocumentPreviewState = {
  step: 'idle',
  htmlContent: '',
  docxBlob: null,
  errorMessage: null,
  isEditing: true,
  isFormTemplate: false,
  templateValues: {},
  templateBuffer: null,
};

export function useDocumentPreview() {
  const [state, setState] = useState<DocumentPreviewState>(INITIAL_STATE);

  /**
   * Convert a .docx Blob → HTML via mammoth and enter the preview step.
   *
   * @param docxBlob        The .docx to render (filled for Type A, original for Type B).
   * @param values          Template tag values (Type A only; empty for Type B).
   * @param templateBuffer  Original template ArrayBuffer (kept for DOCX re-generation).
   * @param isFormTemplate  Pass `true` for Type B templates that have no {{tags}}.
   */
  const generatePreview = async (
    docxBlob: Blob,
    values: Record<string, string> = {},
    templateBuffer: ArrayBuffer | null = null,
    isFormTemplate = false,
  ) => {
    setState(prev => ({ ...prev, step: 'loading', errorMessage: null }));

    try {
      const arrayBuffer = await docxBlob.arrayBuffer();

      // Dynamic import keeps mammoth out of the initial bundle
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml(
        { arrayBuffer },
        {
          styleMap: [
            "p[style-name='Heading 1'] => h1",
            "p[style-name='Heading 2'] => h2",
            "b => strong",
            "i => em",
          ],
        },
      );

      setState(prev => ({
        ...prev,
        step: 'preview',
        // HTML is rendered exactly as mammoth produces it — no span injection
        htmlContent: result.value,
        docxBlob,
        isEditing: true,
        isFormTemplate,
        templateValues: { ...values },
        templateBuffer,
      }));
    } catch (error: unknown) {
      console.error('Erro ao gerar prévia:', error);
      setState(prev => ({
        ...prev,
        step: 'error',
        docxBlob,
        templateBuffer,
        isFormTemplate,
        errorMessage:
          'Não foi possível gerar a prévia. ' +
          'Tente baixar o documento diretamente.',
      }));
    }
  };

  /** Download the stored .docx blob without any re-processing */
  const downloadDocx = (fileName: string) => {
    if (!state.docxBlob) return;
    const url = URL.createObjectURL(state.docxBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Download a .docx applying the correct strategy per template type:
   * - Type B (form template):  download the original blob unchanged.
   * - Type A (tagged template): re-generate from the original template buffer
   *   using the stored template values, producing a clean filled document.
   */
  const downloadDocxWithEdits = async (fileName: string) => {
    // Type B or no buffer available → download as-is
    if (state.isFormTemplate || !state.templateBuffer) {
      downloadDocx(fileName);
      return;
    }

    // Type A → re-generate from original template with stored values
    try {
      const blob = await generateDocxFromTemplate(
        state.templateBuffer,
        state.templateValues,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao gerar DOCX:', err);
      toast.error('Erro ao gerar .DOCX. Baixando versão original…');
      downloadDocx(fileName);
    }
  };

  /** Replace only the rendered HTML (used by the debounced reactive preview) */
  const updateHtml = (newHtml: string) =>
    setState(prev => ({ ...prev, htmlContent: newHtml }));

  const setIsFormTemplate = (value: boolean) =>
    setState(prev => ({ ...prev, isFormTemplate: value }));

  const setEditing = (value: boolean) =>
    setState(prev => ({ ...prev, isEditing: value }));

  const reset = () => setState(INITIAL_STATE);

  return {
    ...state,
    generatePreview,
    updateHtml,
    downloadDocx,
    downloadDocxWithEdits,
    setIsFormTemplate,
    setEditing,
    reset,
  };
}
