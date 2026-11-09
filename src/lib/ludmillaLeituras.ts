/**
 * AS LEITURAS DA LUDMILLA — funções puras, sem React.
 *
 * Spec §4.2 ("Leituras: uma linha por concessionária acompanhada"), §4.6 (a lista vazia diz quando
 * é a próxima leitura) e o recado (quanto ela leu desde a última visita — decisão 7 do plano).
 */
import type { PortalAccount } from '@/hooks/useLudmilla';
import { saudeDaConta, type EstadoDaEstacao } from '@/lib/ludmillaPainel';
import { palavraDaSaude } from '@/components/ludmilla/topo/saude';
import type { LeituraDaConta } from '@/lib/ludmillaRecado';
import {
  DIA_MS, HORA_MS, diaDaSemana, diaEMes, diaEmBrasilia, emBrasilia, horaEMinuto, inicioDoDia,
} from '@/lib/ludmillaTempo';

export interface LinhaDeLeitura { id: string; nome: string; texto: string; alerta: boolean }

/** Decisão 17: a hora (ou a data) da última leitura; "espera o código"; senão a palavra da saúde. */
export function linhasDeLeitura(contas: PortalAccount[], o: {
  nomeDaConta: (id: string) => string;
  estacaoDe: (c: PortalAccount) => EstadoDaEstacao | null;
  caixaPronta: boolean | null;
  captchas: { account_id: string }[];
  agora: number;
}): LinhaDeLeitura[] {
  const esperando = new Set(o.captchas.map(c => c.account_id));
  return contas
    .map((c): LinhaDeLeitura => {
      const nome = o.nomeDaConta(c.id) || c.connector.toUpperCase();
      if (esperando.has(c.id)) return { id: c.id, nome, texto: 'espera o código', alerta: true };
      const saude = saudeDaConta(c, { estacao: o.estacaoDe(c), caixaPronta: o.caixaPronta, agora: o.agora });
      if (saude.tom === 'ok' && c.ultima_varredura_em) {
        const t = Date.parse(c.ultima_varredura_em);
        return { id: c.id, nome, texto: diaEmBrasilia(t) === diaEmBrasilia(o.agora) ? horaEMinuto(t) : diaEMes(t), alerta: false };
      }
      return { id: c.id, nome, texto: palavraDaSaude(saude) ?? 'nunca lida', alerta: true };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Os horários dela, em hora de Brasília (decisão 18). Portal: crons `ludmilla-08h` e `ludmilla-17h`,
 * todo dia. E-mail pelos remetentes (ENEL): cron `ludmilla-enel-email`, de hora em hora das 8h às 18h,
 * seg–sex. E-mail pelo protocolo no assunto (EDP): só pelo "Ler agora". Mudou um cron, mude aqui.
 */
export const HORAS_DO_PORTAL: readonly number[] = [8, 17];
export const HORAS_DO_EMAIL: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export interface ProximaLeitura { nome: string; quando: number }

function proximaDaConta(c: PortalAccount, agora: number): number | null {
  // o agendador (`ludmilla_agendar_varreduras`) só enfileira conta de portal com login guardado
  const horas = c.acompanhamento === 'portal' ? (c.login ? HORAS_DO_PORTAL : null)
    : c.identificacao === 'remetente' ? HORAS_DO_EMAIL
    : null;
  if (!horas) return null;
  const soDiaUtil = c.acompanhamento === 'email';
  for (let d = 0; d < 8; d++) {
    const dia = inicioDoDia(agora) + d * DIA_MS;
    const semana = emBrasilia(dia).getUTCDay();
    if (soDiaUtil && (semana === 0 || semana === 6)) continue;
    for (const h of horas) {
      const t = dia + h * HORA_MS;
      if (t > agora) return t;
    }
  }
  return null;
}

export function proximaLeitura(contas: PortalAccount[], nomeDaConta: (id: string) => string, agora: number): ProximaLeitura | null {
  let melhor: ProximaLeitura | null = null;
  for (const c of contas) {
    if (!c.enabled) continue;
    const quando = proximaDaConta(c, agora);
    if (quando === null) continue;
    const nome = nomeDaConta(c.id) || c.connector.toUpperCase();
    if (!melhor || quando < melhor.quando || (quando === melhor.quando && nome.localeCompare(melhor.nome, 'pt-BR') < 0)) {
      melhor = { nome, quando };
    }
  }
  return melhor;
}

export function fraseDaProximaLeitura(p: ProximaLeitura | null, agora: number): string | null {
  if (!p) return null;
  const dias = diaEmBrasilia(p.quando) - diaEmBrasilia(agora);
  const hora = horaEMinuto(p.quando);
  const quando = dias === 0 ? `às ${hora}` : dias === 1 ? `amanhã às ${hora}` : `${diaDaSemana(p.quando)} às ${hora}`;
  return `A próxima leitura da ${p.nome} é ${quando}.`;
}

/** Spec §4.6: "Nada aqui agora. A próxima leitura da ENEL é às 09:00. Se chegar algo, …" (o título vem à parte). */
export function textoDaListaVazia(proxima: string | null): string {
  return `${proxima ? `${proxima} ` : ''}Se chegar algo, eu coloco aqui e aviso no sino.`;
}

export interface RunDeLeitura { account_id: string; protocolos_lidos: number | null }
export interface SomaDeLeituras { protocolos: Record<string, number>; emails: Record<string, number> }

/**
 * Portal: o MAIOR número de protocolos de uma varredura desde então (as duas varreduras do dia leem
 * os mesmos protocolos; somar dobraria). E-mail: quantos e-mails ela registrou, já contados.
 */
export function somarLeituras(runs: RunDeLeitura[], emails: Record<string, number>): SomaDeLeituras {
  const protocolos: Record<string, number> = {};
  for (const r of runs) {
    const n = Number(r.protocolos_lidos ?? 0);
    if (Number.isFinite(n) && n > (protocolos[r.account_id] ?? 0)) protocolos[r.account_id] = n;
  }
  return { protocolos, emails: { ...emails } };
}

export function leiturasDasContas(contas: PortalAccount[], nomeDaConta: (id: string) => string, soma: SomaDeLeituras): LeituraDaConta[] {
  return contas
    .filter(c => c.enabled)
    .map((c): LeituraDaConta => ({
      nome: nomeDaConta(c.id) || c.connector.toUpperCase(),
      meio: c.acompanhamento === 'email' ? 'email' : 'portal',
      emails: c.acompanhamento === 'email' ? soma.emails[c.id] ?? 0 : null,
      protocolos: c.acompanhamento === 'email' ? null : soma.protocolos[c.id] ?? 0,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
