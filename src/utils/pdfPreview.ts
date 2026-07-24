import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Renderiza a 1ª página de um PDF como imagem (data URL JPEG) no navegador,
 * via pdfjs-dist — usado pra colocar o PDF original importado como **fundo de
 * referência** (underlay) no editor de diagramas: o usuário confere/traça por
 * cima do original. A lib é importada dinamicamente pra não entrar no bundle
 * principal (só quem importa PDF paga o peso dela).
 *
 * Retorna `null` em qualquer falha (PDF cifrado, corrompido etc.) — o
 * underlay é um extra, nunca deve travar a importação em si.
 */
export async function renderPdfFirstPageToDataUrl(file: File, maxWidthPx = 1600): Promise<string | null> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, maxWidthPx / base.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff'; // PDFs podem ter fundo transparente — JPEG não tem alfa
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    void doc.cleanup();
    return dataUrl;
  } catch (e) {
    console.error('renderPdfFirstPageToDataUrl', e);
    return null;
  }
}
