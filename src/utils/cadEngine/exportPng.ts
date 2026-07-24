import { Scene } from './types';
import { sceneToSvg } from './exportSvg';

/**
 * Renderiza uma `Scene` como imagem JPEG (data URL) no navegador — usado pra
 * mostrar ao revisor de IA (`diagram-review`) como o NOSSO redesenho ficou,
 * lado a lado com o documento original. SVG → <img> → canvas → JPEG; data
 * URLs embutidas (fotos) não "sujam" o canvas, então o toDataURL funciona.
 * Retorna `null` em falha — o render é um extra da revisão, nunca trava nada.
 */
export async function sceneToJpegDataUrl(scene: Scene, widthPx = 1400): Promise<string | null> {
  try {
    const svg = sceneToSvg(scene);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG não carregou como imagem'));
      img.src = url;
    });
    const heightPx = Math.round(widthPx * (scene.paper.heightMm / scene.paper.widthMm));
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (e) {
    console.error('sceneToJpegDataUrl', e);
    return null;
  }
}
