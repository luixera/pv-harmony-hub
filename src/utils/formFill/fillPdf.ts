import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * PREENCHEDOR DE FORMULÁRIO EM PDF — escreve texto por cima do PDF original.
 *
 * Os anexos da ENEL (1 e 4) **não têm campos preenchíveis**: são PDFs
 * achatados. Recriá-los como .docx daria um documento parecido, não igual —
 * e o analista da distribuidora recebe o formulário DELA. Então a saída é
 * escrever nas coordenadas certas sobre o arquivo original, que segue intacto.
 *
 * A coordenada de cada campo sai dos próprios rótulos do PDF (extraídos com
 * pdfjs), não de medição à mão: o valor vai à direita do rótulo, na mesma
 * linha de base. Ver `docs/modules/reports/formularios-pdf.md`.
 *
 * ATENÇÃO ao eixo Y: no PDF a origem é o canto INFERIOR esquerdo e o Y cresce
 * para cima — as coordenadas aqui são as mesmas que o pdfjs devolve, sem
 * inversão.
 */

export interface CampoTexto {
  /** Chave da variável do projeto (ex.: `titular`, `uc`). */
  chave: string;
  x: number;
  y: number;
  /** Página (1 = primeira). Padrão: 1. */
  pagina?: number;
  /** Corpo da fonte em pt. Padrão: 9. */
  tamanho?: number;
  /** Largura máxima em pt — o texto encolhe até caber (nunca transborda). */
  larguraMax?: number;
  /** `start` (padrão) escreve à direita da coordenada; `middle` centraliza. */
  ancora?: 'start' | 'middle';
}

export interface CampoMarca {
  /** Qual valor lógico esta marca representa (ex.: `trifasica`). */
  quando: string;
  /** Variável consultada para decidir (ex.: `tipo_conexao`). */
  chave: string;
  x: number;
  y: number;
  pagina?: number;
  tamanho?: number;
}

export interface MapaFormulario {
  nome: string;
  campos: CampoTexto[];
  marcas: CampoMarca[];
}

/** Remove acento e caixa — para comparar o valor do projeto com `quando`. */
function normalizar(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Escreve os valores sobre o PDF e devolve os bytes do resultado.
 *
 * Campo sem valor é PULADO (não escreve string vazia nem "undefined"): o
 * formulário sai com a lacuna em branco, como se ninguém tivesse preenchido —
 * que é melhor do que sujar o documento com lixo.
 */
export async function preencherPdf(
  pdfOriginal: ArrayBuffer | Uint8Array,
  mapa: MapaFormulario,
  valores: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfOriginal);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = doc.getPages();
  const preto = rgb(0.08, 0.08, 0.08);

  for (const campo of mapa.campos) {
    const valor = (valores[campo.chave] ?? '').trim();
    if (!valor) continue;
    const pagina = paginas[(campo.pagina ?? 1) - 1];
    if (!pagina) continue;

    let tamanho = campo.tamanho ?? 9;
    // encolhe até caber na largura disponível — em formulário, texto que
    // invade a célula vizinha é pior do que texto pequeno
    if (campo.larguraMax) {
      while (tamanho > 5 && fonte.widthOfTextAtSize(valor, tamanho) > campo.larguraMax) {
        tamanho -= 0.5;
      }
    }
    const largura = fonte.widthOfTextAtSize(valor, tamanho);
    pagina.drawText(valor, {
      x: campo.ancora === 'middle' ? campo.x - largura / 2 : campo.x,
      y: campo.y,
      size: tamanho,
      font: fonte,
      color: preto,
    });
  }

  for (const marca of mapa.marcas) {
    const valor = normalizar(valores[marca.chave] ?? '');
    if (!valor || valor !== normalizar(marca.quando)) continue;
    const pagina = paginas[(marca.pagina ?? 1) - 1];
    if (!pagina) continue;
    pagina.drawText('X', {
      x: marca.x, y: marca.y, size: marca.tamanho ?? 9, font: fonte, color: preto,
    });
  }

  return doc.save();
}
