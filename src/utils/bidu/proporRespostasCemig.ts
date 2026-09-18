import { TIPOS_SOLICITACAO_CEMIG, type RespostasCemig } from '@/utils/formFill/cemigForm';

/**
 * O BIDU PROPÕE as três respostas do Formulário MicroGD da CEMIG que o
 * cadastro do projeto não tem (FAST TRACK, Grid Zero, tipo de solicitação).
 * A pessoa confirma ou ajusta — decisão do usuário, 17/09/2026.
 *
 * Prioridade, da mais forte para a mais fraca:
 *  1. o que a pessoa disse na conversa ("com fast track sim");
 *  2. as habilidades ensinadas ao Bidu ("na CEMIG, FAST TRACK = Sim até 10 kW");
 *  3. o cadastro do projeto (categoria do padrão escolhida à mão = provável
 *     aumento de carga; texto falando em "UC nova" ou "ampliação");
 *  4. o padrão mais comum.
 *
 * É tudo determinístico: nada aqui passa pelo modelo de linguagem. O Bidu
 * não inventa resposta — quando não tem base, diz que não tem e pede ensino.
 */

export type Confianca = 'alta' | 'media' | 'baixa';

export interface PropostaCampo<T> {
  valor: T;
  /** por que o Bidu propôs isto — vai para a tela, ao lado do campo */
  motivo: string;
  confianca: Confianca;
}

export interface PropostaCemig {
  fastTrack: PropostaCampo<'Sim' | 'Não'>;
  gridZero: PropostaCampo<'Sim' | 'Não'>;
  tipoSolicitacao: PropostaCampo<string>;
}

export interface HabilidadeBidu {
  titulo: string;
  instrucao: string;
}

export interface ContextoProjetoCemig {
  /** potência ativa instalada (kW) — o menor entre módulos e inversores */
  potenciaKw: number | null;
  /** a categoria do padrão de entrada foi escolhida à mão (entry_rule_id) */
  categoriaEscolhidaManual: boolean;
  /** título + observações do projeto, para achar "UC nova", "ampliação"… */
  textoLivre: string;
}

/** O que a pessoa disse na conversa; o tipo pode vir como nº (1–4) ou trecho do nome. */
export interface RespostasInformadas {
  fastTrack?: 'Sim' | 'Não' | string;
  gridZero?: 'Sim' | 'Não' | string;
  tipoSolicitacao?: number | string;
}

const [COM_ALTERACAO, SEM_ALTERACAO, GD_EXISTENTE, NOVA_UC] = TIPOS_SOLICITACAO_CEMIG;

/** Limite do inciso III do art. 73-A, como está escrito no aviso B96 do formulário da CEMIG (Rev. N4). */
const FAST_TRACK_KW_MAX_FORMULARIO = 7.5;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "sim"/"não" (ou yes/no, true/false) → 'Sim' | 'Não' | null */
function simNao(v: unknown): 'Sim' | 'Não' | null {
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  const t = semAcento(String(v ?? '')).trim();
  if (/^(sim|s|yes|y|true|1)$/.test(t)) return 'Sim';
  if (/^(nao|n|no|false|0)$/.test(t)) return 'Não';
  return null;
}

/** Tipo de solicitação a partir de nº (1–4) ou de um trecho do nome. */
export function resolverTipoSolicitacao(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 1 && n <= 4) return TIPOS_SOLICITACAO_CEMIG[n - 1];
  const t = semAcento(String(v));
  if (/(nova|ligacao nova|uc nova)/.test(t) && /(uc|unidade|ligacao)/.test(t)) return NOVA_UC;
  if (/gd existente|ampliacao|acrescimo|potencia ativa instalada/.test(t)) return GD_EXISTENTE;
  if (/sem altera/.test(t)) return SEM_ALTERACAO;
  if (/com altera|aumento de carga|aumento da carga/.test(t)) return COM_ALTERACAO;
  const exato = TIPOS_SOLICITACAO_CEMIG.find(op => semAcento(op) === t);
  return exato ?? null;
}

/** Habilidades que falam do assunto (pelo título ou pela instrução). */
const sobre = (habilidades: HabilidadeBidu[], re: RegExp) =>
  habilidades.filter(h => re.test(semAcento(`${h.titulo} ${h.instrucao}`)));

/** Decisão Sim/Não escrita numa habilidade: "sempre Não", "marque sim", "= Sim"… */
function decisaoSimNao(texto: string): 'Sim' | 'Não' | null {
  const t = semAcento(texto);
  const nao = /(nunca|sempre nao|= ?nao|:\s*nao|marque nao|marcar nao|responda nao|\bnao\b\s*$)/.test(t);
  const sim = /(sempre sim|= ?sim|:\s*sim|marque sim|marcar sim|responda sim|\be sim\b|\bsim\b)/.test(t);
  if (nao && !sim) return 'Não';
  if (sim && !nao) return 'Sim';
  if (sim && nao) return /nunca|sempre nao/.test(t) ? 'Não' : 'Sim';
  return null;
}

/** "até 10 kW" / "até 10kW" / "abaixo de 10 kw" → 10 */
function limiteKw(texto: string): number | null {
  const m = /(?:ate|abaixo de|menor(?:es)? (?:que|de)|<=?)\s*(\d+(?:[.,]\d+)?)\s*kwp?\b/.exec(semAcento(texto));
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function proporRespostasCemig(
  ctx: ContextoProjetoCemig,
  habilidades: HabilidadeBidu[],
  informado: RespostasInformadas = {},
): PropostaCemig {
  const texto = semAcento(ctx.textoLivre ?? '');

  // ── FAST TRACK ─────────────────────────────────────────────────────────────
  // Padrão = a regra escrita no próprio formulário da CEMIG (aviso B96, aparece
  // quando AL12 = Sim): "inciso III do art. 73-A: potência ≤ 7,5 kW e
  // modalidade autoconsumo local" — e a modalidade nós sempre preenchemos
  // como autoconsumo local. Uma habilidade ensinada vence este padrão.
  let fastTrack: PropostaCampo<'Sim' | 'Não'> = ctx.potenciaKw == null
    ? {
        valor: 'Não', confianca: 'baixa',
        motivo: 'O formulário da CEMIG enquadra no FAST TRACK até 7,5 kW em autoconsumo local, mas o projeto está sem potência cadastrada.',
      }
    : {
        valor: ctx.potenciaKw <= FAST_TRACK_KW_MAX_FORMULARIO ? 'Sim' : 'Não', confianca: 'media',
        motivo: `Regra do próprio formulário da CEMIG (inciso III do art. 73-A): FAST TRACK até 7,5 kW em autoconsumo local — o projeto tem ${ctx.potenciaKw} kW. Se a regra de vocês for outra, ensine no chat.`,
      };
  const hFast = sobre(habilidades, /fast\s*-?\s*track/);
  if (hFast.length > 0) {
    const h = hFast[hFast.length - 1];
    const limite = limiteKw(h.instrucao);
    const decisao = decisaoSimNao(h.instrucao);
    if (limite != null && ctx.potenciaKw != null) {
      const dentro = ctx.potenciaKw <= limite;
      fastTrack = {
        valor: dentro ? 'Sim' : 'Não', confianca: 'alta',
        motivo: `Habilidade "${h.titulo}": FAST TRACK até ${limite} kW — o projeto tem ${ctx.potenciaKw} kW.`,
      };
    } else if (limite != null && ctx.potenciaKw == null) {
      fastTrack = { valor: 'Não', confianca: 'baixa', motivo: `Habilidade "${h.titulo}" depende da potência (até ${limite} kW), e o projeto está sem potência cadastrada.` };
    } else if (decisao) {
      fastTrack = { valor: decisao, confianca: 'alta', motivo: `Habilidade "${h.titulo}": ${decisao}.` };
    }
  }

  // ── Grid Zero ──────────────────────────────────────────────────────────────
  let gridZero: PropostaCampo<'Sim' | 'Não'> = {
    valor: 'Não', confianca: 'media',
    motivo: 'Padrão: o projeto injeta na rede. Grid Zero só quando a UC não pode exportar energia.',
  };
  const hGrid = sobre(habilidades, /grid\s*-?\s*zero/);
  if (hGrid.length > 0) {
    const h = hGrid[hGrid.length - 1];
    const decisao = decisaoSimNao(h.instrucao);
    if (decisao) gridZero = { valor: decisao, confianca: 'alta', motivo: `Habilidade "${h.titulo}": ${decisao}.` };
  }

  // ── Tipo de solicitação ────────────────────────────────────────────────────
  let tipoSolicitacao: PropostaCampo<string> = {
    valor: SEM_ALTERACAO, confianca: 'media',
    motivo: 'O mais comum: UC existente, sem mexer no padrão de entrada.',
  };
  if (ctx.categoriaEscolhidaManual) {
    tipoSolicitacao = {
      valor: COM_ALTERACAO, confianca: 'media',
      motivo: 'A categoria do padrão de entrada foi escolhida à mão — costuma ser aumento de carga junto com o solar.',
    };
  }
  if (/gd existente|ampliacao|acrescimo/.test(texto)) {
    tipoSolicitacao = { valor: GD_EXISTENTE, confianca: 'alta', motivo: 'O projeto fala em GD existente / ampliação.' };
  }
  if (/(uc nova|nova uc|unidade nova|ligacao nova|nova ligacao|em construcao)/.test(texto)) {
    tipoSolicitacao = { valor: NOVA_UC, confianca: 'alta', motivo: 'O projeto fala em UC nova / ligação nova.' };
  }
  const hTipo = sobre(habilidades, /tipo de solicitacao|solicitacao padrao|tipo da solicitacao/);
  if (hTipo.length > 0) {
    const h = hTipo[hTipo.length - 1];
    const valor = resolverTipoSolicitacao(h.instrucao);
    if (valor) tipoSolicitacao = { valor, confianca: 'alta', motivo: `Habilidade "${h.titulo}".` };
  }

  // ── O que a pessoa disse agora vence tudo ──────────────────────────────────
  const ftInformado = simNao(informado.fastTrack);
  if (informado.fastTrack != null && ftInformado) fastTrack = { valor: ftInformado, confianca: 'alta', motivo: 'Você informou na conversa.' };
  const gzInformado = simNao(informado.gridZero);
  if (informado.gridZero != null && gzInformado) gridZero = { valor: gzInformado, confianca: 'alta', motivo: 'Você informou na conversa.' };
  const tipoInformado = resolverTipoSolicitacao(informado.tipoSolicitacao);
  if (tipoInformado) tipoSolicitacao = { valor: tipoInformado, confianca: 'alta', motivo: 'Você informou na conversa.' };

  return { fastTrack, gridZero, tipoSolicitacao };
}

/** Só os valores — o que `gerarFormularioCemig` consome. */
export function respostasDaProposta(p: PropostaCemig): RespostasCemig {
  return { fastTrack: p.fastTrack.valor, gridZero: p.gridZero.valor, tipoSolicitacao: p.tipoSolicitacao.valor };
}
