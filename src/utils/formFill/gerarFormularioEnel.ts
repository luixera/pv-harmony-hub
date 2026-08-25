import { preencherPdf } from './fillPdf';
import { preencherXlsx, REGISTRO_CENTRAL_ENEL } from './fillXlsx';
import { ANEXO1_ENEL, ANEXO4_ENEL, valoresFormularioEnel } from './enelForms';

/**
 * Liga o template escolhido na tela ao preenchedor certo.
 *
 * O reconhecimento é pelo NOME do arquivo no bucket, porque é o que o
 * `seed-enel-forms` grava (`{carimbo}_ANEXO_1_SOLICITACAO_ACESSO.pdf`). Um
 * PDF ou .xlsx sem mapa cadastrado devolve `null` — a tela avisa em vez de
 * entregar um arquivo em branco fingindo que deu certo.
 */

const PDF_MIME = 'application/pdf';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface FormularioGerado {
  bytes: Uint8Array;
  nomeArquivo: string;
  mime: string;
  rotulo: string;
}

export async function gerarFormularioEnel(
  modelo: ArrayBuffer,
  nomeTemplate: string,
  valoresDoProjeto: Record<string, string>,
): Promise<FormularioGerado | null> {
  const nome = nomeTemplate.toUpperCase();
  const v = valoresFormularioEnel(valoresDoProjeto);
  const sufixo = (valoresDoProjeto.codigo_projeto || 'projeto').replace(/[^\w-]/g, '');

  if (nome.includes('ANEXO_1')) {
    return {
      bytes: await preencherPdf(modelo, ANEXO1_ENEL, v),
      nomeArquivo: `ANEXO_1_ENEL_${sufixo}.pdf`,
      mime: PDF_MIME,
      rotulo: 'Anexo 1',
    };
  }
  if (nome.includes('ANEXO_4')) {
    return {
      bytes: await preencherPdf(modelo, ANEXO4_ENEL, v),
      nomeArquivo: `ANEXO_4_ENEL_${sufixo}.pdf`,
      mime: PDF_MIME,
      rotulo: 'Anexo 4',
    };
  }
  // ATENÇÃO: casa SÓ o formulário de registro da ENEL.
  //
  // Aqui havia um pega-tudo (`|| nome.endsWith('.XLSX')`) que mandava QUALQUER
  // planilha para o mapa da ENEL. Com o formulário da CEMIG anexado, o sistema
  // escrevia os valores nas células da ENEL — que na planilha da CEMIG caem em
  // lugares sem relação — e o arquivo saía com aparência de "não preenchido"
  // (relato do usuário, ago/2026). Planilha sem mapa agora devolve `null`, e a
  // tela avisa em vez de entregar um arquivo errado.
  if (nome.includes('FORMULARIO_REGISTRO') || nome.includes('REGISTRO_CENTRAL')) {
    return {
      bytes: preencherXlsx(modelo, REGISTRO_CENTRAL_ENEL, v),
      nomeArquivo: `FORMULARIO_REGISTRO_ENEL_${sufixo}.xlsx`,
      mime: XLSX_MIME,
      rotulo: 'Formulário de registro',
    };
  }
  return null;
}

/** Dispara o download no navegador a partir dos bytes gerados. */
export function baixarArquivo(bytes: Uint8Array, nomeArquivo: string, mime: string) {
  // cópia para um ArrayBuffer próprio: o Blob não aceita a view do Uint8Array
  // quando ela aponta para um buffer compartilhado
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 60s: revogar na hora corta downloads grandes em alguns navegadores
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
