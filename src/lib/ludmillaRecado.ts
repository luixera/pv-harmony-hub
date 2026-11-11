/**
 * O RECADO, O DIÁRIO E O QUE ELA FEZ SOZINHA — funções puras, sem React.
 *
 * Spec §4.2 (o recado do dia, "montado a partir dos números, sem IA"), §4.3 (Fiz sozinha, Diário)
 * e §9.2 (na entrega 2, "Fiz sozinha" é o que ela já faz hoje). A voz é a dela, em primeira pessoa.
 */
import type { RegistroLudmilla } from '@/hooks/useLudmilla';
import { juntarComE } from '@/lib/ludmillaCarteira';
import {
  DIA_MS, HORA_MS, diaDaSemana, diaEMes, diaEmBrasilia, emBrasilia, horaEMinuto, inicioDoDia, maiuscula, saudacaoDaHora,
} from '@/lib/ludmillaTempo';

/** A última leitura do dia: a ENEL, de hora em hora até as 18h (cron `ludmilla-enel-email`). */
export const HORA_DA_ULTIMA_LEITURA = 18;
/** O recado nunca olha mais de 7 dias para trás. */
export const MAXIMO_DO_DESDE_MS = 7 * DIA_MS;

/** 18:00 de Brasília do último dia útil antes de hoje (segunda → sexta). Feriado não conta. */
export function ultimaLeituraDoDiaUtilAnterior(agora: number): number {
  let dia = inicioDoDia(agora) - DIA_MS;
  while ([0, 6].includes(emBrasilia(dia).getUTCDay())) dia -= DIA_MS;
  return dia + HORA_DA_ULTIMA_LEITURA * HORA_MS;
}

/** Decisão 6 do plano: a última visita guardada; sem ela, a última leitura do dia útil anterior. */
export function desdeDoRecado(anterior: string | null, agora: number): number {
  const t = anterior ? Date.parse(anterior) : Number.NaN;
  const base = Number.isFinite(t) && t < agora ? t : ultimaLeituraDoDiaUtilAnterior(agora);
  return Math.max(base, agora - MAXIMO_DO_DESDE_MS);
}

export function rotuloDoDesde(desde: number, agora: number): string {
  const dias = diaEmBrasilia(agora) - diaEmBrasilia(desde);
  if (dias <= 0) return `Desde as ${horaEMinuto(desde)}`;
  if (dias === 1) return 'Desde ontem';
  if (dias < 7) return `Desde ${diaDaSemana(desde)}`;
  return `Desde ${diaEMes(desde)}`;
}

export const chaveDaVisita = (userId: string) => `ludmilla:ultima-visita:${userId}`;

/** O localStorage pode não existir ou recusar (modo privado, cota): nunca derruba a página. */
export function lerVisita(armazem: Pick<Storage, 'getItem'> | null | undefined, userId: string): string | null {
  try {
    return armazem?.getItem(chaveDaVisita(userId)) ?? null;
  } catch {
    return null;
  }
}

export function gravarVisita(armazem: Pick<Storage, 'setItem'> | null | undefined, userId: string, iso: string): void {
  try {
    armazem?.setItem(chaveDaVisita(userId), iso);
  } catch {
    // sem onde guardar, o próximo recado cai na última leitura do dia útil anterior
  }
}

/** O que ela leu numa conta desde então (decisão 7): e-mails por e-mail, protocolos por portal. */
export interface LeituraDaConta { nome: string; meio: 'email' | 'portal'; emails: number | null; protocolos: number | null }

const quantos = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

export function fraseDasLeituras(leituras: LeituraDaConta[]): string | null {
  const partes = leituras.flatMap(l => {
    if (l.meio === 'email') return l.emails ? [`${quantos(l.emails, 'e-mail', 'e-mails')} da ${l.nome}`] : [];
    return l.protocolos ? [`${quantos(l.protocolos, 'protocolo', 'protocolos')} da ${l.nome}`] : [];
  });
  return partes.length > 0 ? `li ${juntarComE(partes)}` : null;
}

export interface EntradaDoRecado {
  agora: number;
  desde: number;
  /** null = a contagem falhou (a tela não pode dizer "não li nada") */
  leituras: LeituraDaConta[] | null;
  fizSozinha: number;
  /** a fila de todos; `null` = a fila não carregou, então a tela não pode dizer "não separei nada" */
  separei: number | null;
  paraAgora: number;
  semDono: number;
}

export interface RecadoDoDia {
  /** "Segunda, 9/11, 08:15" */
  data: string;
  /** o recado inteiro (coluna da esquerda, menu do celular, painel do Diário) */
  texto: string;
  /** a linha do celular */
  curto: string;
}

export function recadoDoDia(e: EntradaDoRecado): RecadoDoDia {
  const oi = saudacaoDaHora(e.agora);
  const desde = rotuloDoDesde(e.desde, e.agora);
  const lido = e.leituras === null
    ? `${desde}, não consegui contar o que li.`
    : `${desde} ${fraseDasLeituras(e.leituras) ?? 'não li nada novo'}.`;
  const sozinha = e.fizSozinha > 0 ? ` Fiz ${quantos(e.fizSozinha, 'coisa', 'coisas')} sozinha.` : '';
  const semDono = e.semDono > 0 ? `; ${e.semDono === 1 ? '1 está' : `${e.semDono} estão`} sem dono` : '';
  const separei = e.separei === null
    ? ' Não consegui carregar a fila de decisões.'
    : e.separei > 0
      ? ` Separei ${quantos(e.separei, 'coisa', 'coisas')} para vocês${semDono}.`
      : ' Não separei nada para vocês.';
  return {
    data: `${maiuscula(diaDaSemana(e.agora))}, ${diaEMes(e.agora)}, ${horaEMinuto(e.agora)}`,
    texto: `${oi}. ${lido}${sozinha}${separei}`,
    curto: e.separei === null
      ? `${oi}. Não consegui carregar a fila.`
      : e.separei > 0
        ? `${oi}. Separei ${quantos(e.separei, 'coisa', 'coisas')}; ${e.paraAgora} para agora.`
        : `${oi}. Nada para decidir agora.`,
  };
}

export interface FeitoSozinha { quando: string; texto: string; projectId: string | null }

function textoDoFeito(e: RegistroLudmilla): string {
  const projeto = e.projeto ?? 'projeto';
  if (e.acao === 'anexo') {
    const arquivo = (e.detalhe ?? '').split(' · ')[0]?.trim();
    return arquivo ? `Anexei ${arquivo} ao ${projeto}.` : `Anexei um documento da concessionária ao ${projeto}.`;
  }
  return e.detalhe
    ? `Pus o parecer da concessionária no card do ${projeto} (${e.detalhe}).`
    : `Pus o parecer da concessionária no card do ${projeto}.`;
}

/** Decisão 7: o que ela já faz sozinha hoje — anexo conferido no card e parecer no card. Sem Desfazer. */
export function fezSozinha(registro: RegistroLudmilla[], desde: number): FeitoSozinha[] {
  return registro
    .filter(e => e.ator === 'ludmilla'
      && ((e.acao === 'anexo' && e.situacao === 'ok') || e.acao === 'parecer')
      && Date.parse(e.quando) >= desde)
    .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando))
    .map(e => ({ quando: e.quando, projectId: e.project_id, texto: textoDoFeito(e) }));
}

/** O que a frase precisa de uma linha de `ludmilla_registro` ou de `ludmilla_linha_do_tempo`. */
export type EventoParaFrase = Pick<RegistroLudmilla, 'ator' | 'quem' | 'titulo' | 'detalhe' | 'situacao' | 'projeto'> & { acao: string };

/** Os títulos de `ludmilla_registro` (migração 20261026120000) na voz dela. Mudou o título lá, mude aqui. */
const NA_VOZ_DELA: [string, string][] = [
  ['Varredura no portal ', 'Li o portal '],
  ['Leitura dos e-mails da ', 'Li os e-mails da '],
  ['Cobrança à ', 'Mandei a cobrança à '],
  ['Criação de projeto no portal ', 'Criei um projeto no portal '],
  ['Teste de acesso ao portal ', 'Testei o acesso ao portal '],
  ['Descoberta das telas do portal ', 'Conheci as telas do portal '],
  ['Mudança no portal: ', 'Vi uma mudança: '],
  ['E-mail lido: ', 'Li o e-mail: '],
  ['Anexo da concessionária no card', 'Anexei o documento da concessionária no card'],
  ['Anexo bloqueado (titular/UC não conferem)', 'Não anexei um documento: o titular ou a UC não conferem'],
  ['Anexo falhou', 'Não consegui anexar um documento'],
  ['Anexo pendente', 'Deixei um documento para anexar depois'],
  ['Parecer da concessionária no card', 'Pus o parecer da concessionária no card'],
  ['Pediu o código da imagem', 'Pedi o código da imagem'],
  ['Tarefa encerrada: ', 'Encerrei a tarefa: '],
];

const DA_EQUIPE: Record<string, string> = {
  aplicada: 'aplicou a recomendação',
  ignorada: 'ignorou a recomendação',
  captcha_respondido: 'digitou o código da imagem',
  afazer_feito: 'marcou como feito',
};

export function fraseDoRegistro(e: EventoParaFrase): string {
  const doProjeto = e.projeto && !e.titulo.includes(e.projeto) ? ` (${e.projeto})` : '';
  if (e.ator === 'equipe') {
    const quem = e.quem?.trim() || 'Alguém da equipe';
    if (e.acao === 'tarefa_encerrada') return `${quem} encerrou a tarefa: ${e.titulo.replace(/^Tarefa encerrada:\s*/, '')}${doProjeto}`;
    const verbo = DA_EQUIPE[e.acao];
    return verbo ? `${quem} ${verbo}${doProjeto}` : `${quem}: ${e.titulo}${doProjeto}`;
  }
  if (e.acao === 'visita' && e.situacao === 'erro') return `Não consegui: ${e.titulo}${doProjeto}`;
  const troca = NA_VOZ_DELA.find(([de]) => e.titulo.startsWith(de));
  return `${troca ? troca[1] + e.titulo.slice(troca[0].length) : e.titulo}${doProjeto}`;
}

export interface LinhaDoDiario {
  chave: string;
  hora: string;
  deLa: boolean;
  quem: string;
  texto: string;
  detalhe: string | null;
  erro: boolean;
}
export interface DiaDoDiario { rotulo: string; itens: LinhaDoDiario[] }

/** "Hoje, segunda 9/11" · "Ontem, domingo 8/11" · "Sexta, 6/11". */
export function rotuloDoDia(ms: number, agora: number): string {
  const d = diaEmBrasilia(agora) - diaEmBrasilia(ms);
  if (d === 0) return `Hoje, ${diaDaSemana(ms)} ${diaEMes(ms)}`;
  if (d === 1) return `Ontem, ${diaDaSemana(ms)} ${diaEMes(ms)}`;
  return `${maiuscula(diaDaSemana(ms))}, ${diaEMes(ms)}`;
}

/** O registro por dia de Brasília, o mais novo primeiro (spec §4.3, "Diário"). */
export function diarioPorDia(registro: RegistroLudmilla[], agora: number): DiaDoDiario[] {
  const dias: DiaDoDiario[] = [];
  let diaAtual: number | null = null;
  const ordenado = registro
    .filter(e => Number.isFinite(Date.parse(e.quando)))
    .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
  ordenado.forEach((e, i) => {
    const ms = Date.parse(e.quando);
    const dia = diaEmBrasilia(ms);
    if (dia !== diaAtual) {
      dias.push({ rotulo: rotuloDoDia(ms, agora), itens: [] });
      diaAtual = dia;
    }
    dias[dias.length - 1].itens.push({
      chave: `${e.quando}-${i}`,
      hora: horaEMinuto(ms),
      deLa: e.ator === 'ludmilla',
      quem: e.ator === 'ludmilla' ? 'Ludmilla' : (e.quem?.trim() || 'Equipe'),
      texto: fraseDoRegistro(e),
      detalhe: e.detalhe?.trim() || null,
      erro: e.situacao === 'erro',
    });
  });
  return dias;
}
