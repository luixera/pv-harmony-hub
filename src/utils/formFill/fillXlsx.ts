import PizZip from 'pizzip';

/**
 * PREENCHEDOR DE PLANILHA (.xlsx) — escreve valores em células do modelo.
 *
 * O formulário "Dados para registro da central geradora" da ENEL é uma
 * planilha: rótulo na coluna B, valor na coluna C. Não dá para tratar como
 * .docx (o motor de templates atual) nem como PDF.
 *
 * A gravação é feita como **inline string** (`t="inlineStr"`), não mexendo na
 * tabela de textos compartilhados: assim um valor novo nunca corrompe o índice
 * de outra célula — que é o jeito clássico de quebrar um xlsx editando na mão.
 *
 * O modelo é preservado inteiro (formatação, mesclagens, abas); só o conteúdo
 * das células indicadas muda.
 */

const escapar = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface CelulaPlanilha {
  /** Referência da célula, ex.: "C11". */
  celula: string;
  /** Chave da variável do projeto. */
  chave: string;
}

export interface MapaPlanilha {
  nome: string;
  /** Caminho da aba dentro do .xlsx. Padrão: primeira planilha. */
  planilha?: string;
  celulas: CelulaPlanilha[];
}

/** Escreve os valores no modelo e devolve o .xlsx resultante. */
export function preencherXlsx(
  modelo: ArrayBuffer | Uint8Array,
  mapa: MapaPlanilha,
  valores: Record<string, string>,
): Uint8Array {
  const zip = new PizZip(modelo as ArrayBuffer);
  const caminho = mapa.planilha ?? 'xl/worksheets/sheet1.xml';
  const arquivo = zip.file(caminho);
  if (!arquivo) throw new Error(`Planilha ${caminho} não encontrada no modelo`);
  let xml = arquivo.asText();

  for (const { celula, chave } of mapa.celulas) {
    const valor = (valores[chave] ?? '').trim();
    if (!valor) continue;
    const conteudo = `<is><t xml:space="preserve">${escapar(valor)}</t></is>`;

    // 1) célula já existe (com ou sem conteúdo) → troca tipo e corpo,
    //    preservando o estilo `s="..."` para não perder a formatação
    const existente = new RegExp(`<c r="${celula}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
    if (existente.test(xml)) {
      xml = xml.replace(existente, (_m, attrs: string) => {
        const estilo = /s="\d+"/.exec(attrs)?.[0] ?? '';
        return `<c r="${celula}" ${estilo} t="inlineStr">${conteudo}</c>`;
      });
      continue;
    }

    // 2) célula não existe → insere na linha certa, em ordem de coluna
    const linha = /\d+$/.exec(celula)?.[0];
    const coluna = celula.replace(/\d+$/, '');
    if (!linha) continue;
    const alvo = new RegExp(`(<row r="${linha}"[^>]*>)([\\s\\S]*?)(</row>)`);
    if (alvo.test(xml)) {
      xml = xml.replace(alvo, (_m, abre: string, corpo: string, fecha: string) => {
        const nova = `<c r="${celula}" t="inlineStr">${conteudo}</c>`;
        // insere antes da primeira célula de coluna "maior" que esta
        const partes = corpo.split(/(?=<c r=")/);
        const idx = partes.findIndex(p => {
          const c = /<c r="([A-Z]+)\d+"/.exec(p)?.[1];
          return c != null && c.length >= coluna.length && c > coluna;
        });
        if (idx === -1) return abre + corpo + nova + fecha;
        partes.splice(idx, 0, nova);
        return abre + partes.join('') + fecha;
      });
    }
  }

  zip.file(caminho, xml);
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Formulário "Dados para registro da central geradora" — ENEL. */
export const REGISTRO_CENTRAL_ENEL: MapaPlanilha = {
  nome: 'ENEL — Dados para registro da central geradora (MMGD)',
  celulas: [
    // Responsável técnico
    { celula: 'C2', chave: 'empresa_nome' },
    { celula: 'C3', chave: 'rt_nome' },
    { celula: 'C4', chave: 'rt_art' },
    { celula: 'C5', chave: 'rt_registro_conselho' },
    { celula: 'C6', chave: 'rt_titulo' },
    { celula: 'C7', chave: 'rt_telefone' },
    { celula: 'C8', chave: 'rt_email' },
    // Unidade consumidora
    { celula: 'C10', chave: 'tipo_solicitacao_planilha' },
    { celula: 'C11', chave: 'titular' },
    { celula: 'C12', chave: 'uc' },
    { celula: 'C13', chave: 'classe' },
    { celula: 'C14', chave: 'grupo' },
    { celula: 'C15', chave: 'disjuntor' },
    { celula: 'C16', chave: 'tensao_conexao' },
    { celula: 'C17', chave: 'cpf_cnpj' },
    { celula: 'C18', chave: 'logradouro_completo' },
    { celula: 'C19', chave: 'cep' },
    { celula: 'C20', chave: 'municipio_uf' },
    { celula: 'C21', chave: 'telefone' },
    { celula: 'C22', chave: 'email' },
    // Geração solar
    { celula: 'C24', chave: 'mod_quantidade' },
    { celula: 'C25', chave: 'mod_fabricante' },
    { celula: 'C26', chave: 'mod_modelo' },
    { celula: 'C27', chave: 'area_arranjos' },
    { celula: 'C28', chave: 'inv_quantidade' },
    { celula: 'C29', chave: 'inv_fabricante' },
    { celula: 'C30', chave: 'inv_modelo' },
    { celula: 'C31', chave: 'potencia_modulos_kw' },
    { celula: 'C32', chave: 'potencia_inversores_kw' },
    { celula: 'C33', chave: 'data_conexao' },
  ],
};
