import { preencherXlsx } from './fillXlsx';
import {
  FORMULARIO_CEMIG, valoresFormularioCemig, conferirUtmCemig, RespostasCemig,
} from './cemigForm';
import type { FormularioGerado } from './gerarFormularioEnel';

/**
 * Formulário MicroGD da CEMIG — do modelo ao arquivo preenchido.
 *
 * O reconhecimento é pelo NOME do arquivo, como na ENEL. Nada de pega-tudo por
 * extensão: já houve o caso de a planilha da CEMIG cair no mapa da ENEL e sair
 * com os valores em células sem relação (ago/2026).
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** É o formulário da CEMIG? */
export function ehFormularioCemig(nomeTemplate: string): boolean {
  const nome = nomeTemplate.toUpperCase();
  return nome.includes('MICROGD') || (nome.includes('CEMIG') && nome.endsWith('.XLSX'));
}

export interface ResultadoCemig extends FormularioGerado {
  /** Avisos que não impedem gerar, mas o projetista precisa ver. */
  avisos: string[];
}

export function gerarFormularioCemig(
  modelo: ArrayBuffer,
  valoresDoProjeto: Record<string, string>,
  respostas: RespostasCemig,
): ResultadoCemig {
  const v = valoresFormularioCemig(valoresDoProjeto, respostas);
  const avisos: string[] = [];

  // A planilha valida a coordenada contra a faixa do fuso e devolve o
  // formulário reprovado. Melhor descobrir aqui do que na devolutiva.
  const problemaUtm = conferirUtmCemig(v.cemig_fuso, v.cemig_leste, v.cemig_norte);
  if (problemaUtm) avisos.push(problemaUtm);

  // Campos que a CEMIG marca com asterisco: sem eles o formulário volta.
  const obrigatorios: [string, string][] = [
    ['nome_titular', 'titular'],
    ['cemig_cpf', 'CPF/CNPJ'],
    ['cemig_uc', 'número da UC'],
    ['endereco_rua', 'logradouro'],
    ['endereco_cidade', 'município'],
    ['cemig_telefone', 'celular'],
    ['email_titular', 'e-mail'],
  ];
  const faltando = obrigatorios.filter(([k]) => !(v[k] ?? '').trim()).map(([, r]) => r);
  if (faltando.length > 0) {
    avisos.push(`Sem preencher no cadastro do projeto: ${faltando.join(', ')}. `
      + 'A CEMIG marca esses campos como obrigatórios.');
  }

  const sufixo = (valoresDoProjeto.codigo_projeto || 'projeto').replace(/[^\w-]/g, '');
  return {
    bytes: preencherXlsx(modelo, FORMULARIO_CEMIG, v),
    nomeArquivo: `FORMULARIO_MICROGD_CEMIG_${sufixo}.xlsx`,
    mime: XLSX_MIME,
    rotulo: 'Formulário MicroGD',
    avisos,
  };
}
