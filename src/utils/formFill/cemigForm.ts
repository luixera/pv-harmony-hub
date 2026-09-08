import { MapaPlanilha } from './fillXlsx';

/**
 * FORMULÁRIO MicroGD DA CEMIG — mapa de células e adaptação dos valores.
 *
 * Levantado por comparação a partir de um formulário PREENCHIDO À MÃO de um
 * projeto real e aceito (PRJ-07728), do jeito que funcionou na ENEL. O mapa
 * completo, com as pendências e as listas suspensas, está em
 * `docs/modules/homologation/formulario-cemig.md`.
 *
 * Duas perguntas o cadastro não responde e são feitas na hora de gerar:
 * o FAST TRACK e o tipo de solicitação (decisão do usuário, set/2026).
 */

/** As quatro opções da lista `Tipos Solicitações` (aba Dados do modelo). */
export const TIPOS_SOLICITACAO_CEMIG = [
  'Conexão de GD em Unidade Consumidora Existente COM Alteração de Potência Disponibilizada',
  'Conexão de GD em Unidade Consumidora Existente SEM Alteração de Potência Disponibilizada',
  'GD Existente COM Alteração de Potência Ativa Instalada Total',
  'Ligação de Nova Unidade Consumidora COM Geração Distribuída',
] as const;

/** Faixas de validação da planilha (aba Dados). Fora delas o formulário volta. */
const FAIXAS_UTM: Record<string, { eMin: number; eMax: number; nMin: number; nMax: number }> = {
  '22': { eMin: 487307, eMax: 833012, nMin: 7733378, nMax: 7981566 },
  '23': { eMin: 161564, eMax: 840139, nMin: 7460145, nMax: 8435094 },
  '24': { eMin: 164869, eMax: 417150, nMin: 7673180, nMax: 8336360 },
};

export interface RespostasCemig {
  /** `AL12` — enquadramento no inciso III do art. 73-A. */
  fastTrack: 'Sim' | 'Não';
  /** `I41` — uma das quatro opções acima. */
  tipoSolicitacao: string;
  /** `O14` — o empreendimento será "Grid Zero"? */
  gridZero: 'Sim' | 'Não';
}

/** Só os dígitos — a planilha recebe CPF, CEP e telefone sem máscara. */
const digitos = (v: string) => (v ?? '').replace(/\D/g, '');

/**
 * Número puro, do jeito que a célula espera (sem "A", sem "kW", sem "m²").
 *
 * O ponto é ambíguo e isso já quebrou o teste: em "7.796.195,00 m" ele é
 * separador de milhar, em "7.5 kW" é decimal. A vírgula desempata — havendo
 * vírgula, os pontos são milhar; não havendo, o ponto é decimal. No fim
 * `Number` derruba o zero inútil ("812186.00" → "812186").
 */
const numero = (v: string) => {
  const bruto = (v ?? '').trim();
  const limpo = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : bruto;
  const m = /-?\d+(?:\.\d+)?/.exec(limpo);
  if (!m) return '';
  const n = Number(m[0]);
  return Number.isFinite(n) ? String(n) : m[0];
};

/** `monofasico` → `Monopolar`, e assim por diante (lista da aba Dados). */
export function tipoDisjuntorCemig(faseCrua: string): string {
  const f = (faseCrua ?? '').toLowerCase();
  if (f.includes('tri')) return 'Tripolar';
  if (f.includes('bi')) return 'Bipolar';
  if (f.includes('mono')) return 'Monopolar';
  return '';
}

/**
 * Confere a coordenada contra a faixa do fuso. Devolve o aviso quando estiver
 * fora — a planilha da CEMIG valida isso e devolve o formulário reprovado, e
 * é melhor descobrir aqui do que na devolutiva.
 */
export function conferirUtmCemig(fuso: string, leste: string, norte: string): string | null {
  const faixa = FAIXAS_UTM[fuso];
  if (!faixa) {
    return fuso
      ? `O fuso ${fuso} não está nas faixas aceitas pela CEMIG (22, 23 ou 24). Confira as coordenadas do projeto.`
      : 'O projeto está sem coordenadas — a CEMIG exige a localização em UTM.';
  }
  const e = Number(leste), n = Number(norte);
  if (!Number.isFinite(e) || !Number.isFinite(n)) return 'Não consegui converter as coordenadas do projeto para UTM.';
  if (e < faixa.eMin || e > faixa.eMax) {
    return `A coordenada E (${e}) está fora da faixa do fuso ${fuso} `
      + `(${faixa.eMin}–${faixa.eMax}) e a CEMIG recusa o formulário. Confira as coordenadas do projeto.`;
  }
  if (n < faixa.nMin || n > faixa.nMax) {
    return `A coordenada N (${n}) está fora da faixa do fuso ${fuso} `
      + `(${faixa.nMin}–${faixa.nMax}) e a CEMIG recusa o formulário. Confira as coordenadas do projeto.`;
  }
  return null;
}

/**
 * Adapta as variáveis do projeto ao que CADA célula da CEMIG espera.
 *
 * O catálogo geral formata para leitura humana ("63A", "7.796.195,00 m",
 * "23K"); a planilha quer o número cru. Por isso esta camada existe.
 */
export function valoresFormularioCemig(
  v: Record<string, string>,
  respostas: RespostasCemig,
): Record<string, string> {
  // utm_fuso vem como "22K" (fuso + faixa); a célula quer só o número.
  const fuso = (v.utm_fuso ?? '').replace(/[^\d]/g, '');
  const leste = numero(v.utm_longitude ?? '');
  const norte = numero(v.utm_latitude ?? '');

  return {
    ...v,
    cemig_uc: digitos(v.numero_uc || v.uc || ''),
    cemig_cpf: digitos(v.cpf_cnpj ?? ''),
    cemig_cep: digitos(v.endereco_cep ?? ''),
    cemig_telefone: digitos(v.telefone_titular ?? ''),
    cemig_grupo: 'B',
    cemig_fuso: fuso,
    cemig_leste: leste,
    cemig_norte: norte,
    cemig_fast_track: respostas.fastTrack,
    cemig_grid_zero: respostas.gridZero,
    cemig_tipo_solicitacao: respostas.tipoSolicitacao,
    cemig_tipo_edificacao: 'Edificação Individual',
    cemig_tipo_disjuntor: tipoDisjuntorCemig(v.fase ?? ''),
    cemig_disjuntor: numero(v.disjuntor ?? ''),
    cemig_tensao: '127/220',
    cemig_nao: 'Não',
    cemig_fonte: 'Solar',
    cemig_tipo_geracao: 'Empregando conversor eletrônico/inversor',
    cemig_modalidade: 'Autoconsumo local',
    cemig_qtd_creditos: '1',
    // A potência ativa total é o MENOR entre módulos e inversores (nota 15 do
    // próprio formulário) — é o que `geracao_estimada` já usa como base.
    cemig_potencia_ativa: numero(v.potencia_inversores || v.potencia_total || ''),
    cemig_pot_modulo: numero(v.potencia_modulo ?? ''),
    cemig_pot_inversor: numero(v.potencia_inversor ?? ''),
    cemig_pot_total_modulos: numero(v.potencia_total ?? ''),
    cemig_pot_total_inversores: numero(v.potencia_inversores ?? ''),
    cemig_area: numero(v.area_ocupada ?? ''),
  };
}

/**
 * Mapa de células da aba `Formulário`.
 *
 * NÃO escrevemos em `AD28`: é uma célula preenchida sem rótulo em lugar
 * nenhum da linha, quase certamente controle interno da planilha. Escrever
 * num controle desconhecido é o tipo de coisa que quebra a validação.
 */
export const FORMULARIO_CEMIG: MapaPlanilha = {
  nome: 'Formulário MicroGD CEMIG',
  planilha: 'xl/worksheets/sheet1.xml',
  celulas: [
    // 1 — Identificação da UC
    { celula: 'J12',  chave: 'cemig_uc' },
    { celula: 'AL12', chave: 'cemig_fast_track' },
    { celula: 'O14',  chave: 'cemig_grid_zero' },
    { celula: 'N16',  chave: 'nome_titular' },
    { celula: 'E18',  chave: 'cemig_grupo' },
    { celula: 'AC18', chave: 'cemig_cpf' },
    { celula: 'G20',  chave: 'endereco_rua' },
    { celula: 'AI20', chave: 'endereco_numero' },
    { celula: 'AR20', chave: 'endereco_complemento' },
    { celula: 'E22',  chave: 'endereco_bairro' },
    { celula: 'T22',  chave: 'endereco_cidade' },
    { celula: 'AN22', chave: 'endereco_estado' },
    { celula: 'AS22', chave: 'cemig_cep' },
    { celula: 'O24',  chave: 'cemig_telefone' },
    { celula: 'Y24',  chave: 'email_titular' },

    // 2 — Dados da UC
    { celula: 'V29',  chave: 'cemig_fuso' },
    { celula: 'AC29', chave: 'cemig_leste' },
    { celula: 'AL29', chave: 'cemig_norte' },
    { celula: 'AD33', chave: 'cemig_nao' },   // motor gerador de emergência
    { celula: 'I41',  chave: 'cemig_tipo_solicitacao' },
    { celula: 'I43',  chave: 'cemig_tipo_edificacao' },
    { celula: 'AB47', chave: 'cemig_tipo_disjuntor' },
    { celula: 'AH47', chave: 'cemig_disjuntor' },
    { celula: 'AB49', chave: 'cemig_tipo_disjuntor' },
    { celula: 'AH49', chave: 'cemig_disjuntor' },
    { celula: 'L55',  chave: 'cemig_tensao' },
    { celula: 'R57',  chave: 'cemig_nao' },   // mudança de local do padrão
    { celula: 'AD59', chave: 'cemig_nao' },   // padrão a menos de 30 m do poste
    { celula: 'AF61', chave: 'cemig_nao' },   // telhado arrendado

    // 4 — Dados da geração
    { celula: 'L95',   chave: 'cemig_fonte' },
    { celula: 'AT95',  chave: 'cemig_potencia_ativa' },
    { celula: 'H98',   chave: 'cemig_tipo_geracao' },
    { celula: 'L100',  chave: 'cemig_modalidade' },
    { celula: 'AS100', chave: 'cemig_qtd_creditos' },
    { celula: 'L108',  chave: 'modelo_modulo' },
    { celula: 'AI108', chave: 'modelo_inversor' },
    { celula: 'L110',  chave: 'marca_modulo' },
    { celula: 'AI110', chave: 'marca_inversor' },
    { celula: 'L112',  chave: 'cemig_pot_modulo' },
    { celula: 'AI112', chave: 'cemig_pot_inversor' },
    { celula: 'L114',  chave: 'qtd_modulos' },
    { celula: 'AI114', chave: 'qtd_inversores' },
    { celula: 'L116',  chave: 'cemig_pot_total_modulos' },
    { celula: 'AI116', chave: 'cemig_pot_total_inversores' },
    { celula: 'L118',  chave: 'cemig_area' },

    // 5 — Armazenamento
    { celula: 'R134', chave: 'cemig_nao' },
  ],
};
