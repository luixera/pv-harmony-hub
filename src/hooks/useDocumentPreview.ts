import { useState } from 'react';
import { toast } from 'sonner';

export type PreviewStep = 'idle' | 'loading' | 'preview' | 'error';

export interface DocumentPreviewState {
  step: PreviewStep;
  htmlContent: string;
  docxBlob: Blob | null;
  errorMessage: string | null;
  isEditing: boolean;
}

const INITIAL_STATE: DocumentPreviewState = {
  step: 'idle',
  htmlContent: '',
  docxBlob: null,
  errorMessage: null,
  isEditing: true,
};

export function useDocumentPreview() {
  const [state, setState] = useState<DocumentPreviewState>(INITIAL_STATE);

  /** Convert a filled .docx Blob → HTML via mammoth and enter preview mode */
  const generatePreview = async (filledDocxBlob: Blob) => {
    setState(prev => ({ ...prev, step: 'loading', errorMessage: null }));

    try {
      const arrayBuffer = await filledDocxBlob.arrayBuffer();

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
        htmlContent: result.value,
        docxBlob: filledDocxBlob,
        isEditing: true,
      }));
    } catch (error: unknown) {
      console.error('Erro ao gerar prévia:', error);
      setState(prev => ({
        ...prev,
        step: 'error',
        docxBlob: filledDocxBlob, // keep blob so fallback download still works
        errorMessage:
          'Não foi possível gerar a prévia. ' +
          'Tente baixar o documento diretamente.',
      }));
    }
  };

  /** Download the original filled .docx */
  const downloadDocx = (fileName: string) => {
    if (!state.docxBlob) return;
    const url = URL.createObjectURL(state.docxBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Generate and download a PDF from the (possibly edited) HTML preview */
  const downloadPdf = async (fileName: string, htmlElement: HTMLElement) => {
    try {
      // Hide watermark before capture
      const watermark = htmlElement.querySelector<HTMLElement>('[data-watermark]');
      if (watermark) watermark.style.display = 'none';

      const html2pdf = (await import('html2pdf.js')).default;
      const opt = {
        margin: [15, 15, 15, 15],
        filename: `${fileName}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      };

      await html2pdf().set(opt).from(htmlElement).save();

      if (watermark) watermark.style.display = '';
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      toast.error('Erro ao gerar PDF');
    }
  };

  const setEditing = (value: boolean) =>
    setState(prev => ({ ...prev, isEditing: value }));

  const reset = () => setState(INITIAL_STATE);

  return {
    ...state,
    generatePreview,
    downloadDocx,
    downloadPdf,
    setEditing,
    reset,
  };
}
