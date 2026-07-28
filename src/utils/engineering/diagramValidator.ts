import {
  ConnectionEndpoint, DiagramSceneState, ManualConnection, PlacedSymbol,
  computeAllConnectionPoints,
} from '@/utils/cadEngine/editableLayout';
import { WARNING_PLATE_ENEL, WARNING_PLATE_GENERIC } from '@/utils/cadEngine/warningPlates';
import { RuleMap, isGroupEnabled } from './rulesEngine';

/**
 * VALIDADOR ELÉTRICO LOCAL — o checklist do engenheiro em tempo real, sem IA
 * e sem custo por uso. Lê a CENA do diagrama + as regras de engenharia do
 * banco e devolve verificações no espírito do módulo: **nunca bloqueia** —
 * no máximo alerta âmbar com a sugestão de correção, em português simples.
 *
 * É um módulo-ponte (como o UnifilarTab): consome o cadEngine E o
 * rulesEngine; o rulesEngine continua sem saber que o desenho existe.
 */

export interface DiagramCheck {
  id: string;
  /** O que foi verificado, em linguagem de checklist ("Disjuntor por arranjo"). */
  label: string;
  status: 'ok' | 'warning' | 'info';
  /** Detalhe quando não passou (o que exatamente está faltando/errado). */
  detail?: string;
  /** O que fazer a respeito. */
  suggestion?: string;
}

export interface DiagramValidation {
  checks: DiagramCheck[];
  okCount: number;
  warningCount: number;
  infoCount: number;
  /** true = interruptor do grupo Alertas está desligado (tudo silenciado). */
  silenced: boolean;
}

const METER_KINDS = new Set(['meter', 'meter-bidirectional']);
const BREAKER_KINDS = new Set(['breaker', 'breaker-tripolar', 'fuse']);
const PLATE_HREFS = new Set([WARNING_PLATE_GENERIC.href, WARNING_PLATE_ENEL.href]);

/** Símbolos que uma ponta de ligação encosta (derivação formal segue a linha-mãe). */
function endpointSymbols(e: ConnectionEndpoint, byConnId: Map<string, ManualConnection>, depth = 0): string[] {
  if (depth > 8) return []; // ciclo de derivações — computeAllConnectionPoints já descarta
  if (e.kind === 'symbol' || e.kind === 'port') return [e.id];
  if (e.kind === 'line') {
    const parent = byConnId.get(e.connId);
    if (!parent) return [];
    return [
      ...endpointSymbols(parent.from, byConnId, depth + 1),
      ...endpointSymbols(parent.to, byConnId, depth + 1),
    ];
  }
  return [];
}

export function validateDiagram(state: DiagramSceneState, rules: RuleMap): DiagramValidation {
  const checks: DiagramCheck[] = [];
  const silenced = !isGroupEnabled(rules, 'alerts');
  const protectionsOn = isGroupEnabled(rules, 'protections');
  const groundingOn = isGroupEnabled(rules, 'grounding');

  const placements = state.placements;
  const byId = new Map(placements.map(p => [p.id, p]));
  const byConnId = new Map(state.connections.map(c => [c.id, c]));

  // grafo elétrico simplificado: aresta entre todos os símbolos que uma
  // ligação (ou a linha-mãe da derivação) encosta
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const c of state.connections) {
    const fromIds = endpointSymbols(c.from, byConnId).filter(id => byId.has(id));
    const toIds = endpointSymbols(c.to, byConnId).filter(id => byId.has(id));
    for (const a of fromIds) for (const b of toIds) link(a, b);
  }
  const neighbors = (id: string) => adj.get(id) ?? new Set<string>();

  const ofKind = (pred: (p: PlacedSymbol) => boolean) => placements.filter(pred);
  // microinversor conta como inversor em TODAS as checagens (proteção entre
  // ele e o medidor, condutor CC do lado dos módulos, etc.)
  const inverters = ofKind(p => p.kind === 'inverter' || p.kind === 'microinverter');
  const meters = ofKind(p => METER_KINDS.has(p.kind));
  const dpsList = ofKind(p => p.kind === 'dps');

  const push = (c: DiagramCheck) => checks.push(c);

  // ── 1. Um disjuntor CA entre CADA inversor e o medidor ────────────────────
  if (protectionsOn && inverters.length > 0 && meters.length > 0) {
    const meterIds = new Set(meters.map(m => m.id));
    const offenders: string[] = [];
    for (const inv of inverters) {
      // BFS a partir do inversor SEM atravessar disjuntores/fusíveis — se o
      // medidor ainda for alcançável, existe um caminho sem proteção
      const seen = new Set<string>([inv.id]);
      const queue = [inv.id];
      let reachesMeterUnprotected = false;
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const nb of neighbors(cur)) {
          if (seen.has(nb)) continue;
          if (meterIds.has(nb)) { reachesMeterUnprotected = true; break; }
          const kind = byId.get(nb)?.kind ?? '';
          if (BREAKER_KINDS.has(kind)) continue; // proteção no caminho — não expande
          seen.add(nb);
          queue.push(nb);
        }
        if (reachesMeterUnprotected) break;
      }
      if (reachesMeterUnprotected) offenders.push(inv.label || inv.id);
    }
    push(offenders.length === 0
      ? { id: 'breaker-per-inverter', label: 'Disjuntor CA por arranjo/inversor', status: 'ok' }
      : {
          id: 'breaker-per-inverter', label: 'Disjuntor CA por arranjo/inversor', status: 'warning',
          detail: `Sem disjuntor no caminho até o medidor: ${offenders.join(', ')}.`,
          suggestion: 'Cada arranjo precisa do próprio disjuntor CA antes da junção (boas práticas + exigência das concessionárias).',
        });
  }

  // ── 2. DPS no lado CA ─────────────────────────────────────────────────────
  if (protectionsOn) {
    const connectedDps = dpsList.filter(d => neighbors(d.id).size > 0);
    push(connectedDps.length > 0
      ? { id: 'dps-present', label: 'DPS conectado no lado CA', status: 'ok' }
      : {
          id: 'dps-present', label: 'DPS conectado no lado CA', status: 'warning',
          detail: dpsList.length > 0 ? 'Há DPS no desenho, mas sem ligação.' : 'Nenhum DPS no diagrama.',
          suggestion: 'Derive um DPS em paralelo do barramento CA depois da junção dos arranjos.',
        });

    // ── 3. DPS no padrão de entrada (junto ao medidor) ──────────────────────
    if (meters.length > 0) {
      const meterIds = new Set(meters.map(m => m.id));
      const nearMeter = (d: PlacedSymbol) => {
        for (const nb of neighbors(d.id)) {
          if (meterIds.has(nb)) return true;
          // DPS pendurado no trecho disjuntor→medidor: vizinho é o disjuntor do padrão
          if (BREAKER_KINDS.has(byId.get(nb)?.kind ?? '') && [...neighbors(nb)].some(x => meterIds.has(x))) return true;
        }
        return false;
      };
      push(dpsList.some(nearMeter)
        ? { id: 'dps-entry', label: 'DPS no padrão de entrada', status: 'ok' }
        : {
            id: 'dps-entry', label: 'DPS no padrão de entrada', status: 'warning',
            detail: 'Nenhum DPS em paralelo ao disjuntor do padrão.',
            suggestion: 'As concessionárias vêm exigindo DPS também no padrão de entrada — derive um DPS do trecho disjuntor do padrão → medidor.',
          });
    }
  }

  // ── 4. Medição e rede ─────────────────────────────────────────────────────
  push(meters.length > 0
    ? { id: 'meter', label: 'Medidor presente', status: 'ok' }
    : { id: 'meter', label: 'Medidor presente', status: 'warning', detail: 'Sem medidor no diagrama.', suggestion: 'Adicione o medidor bidirecional no padrão de entrada.' });
  push(placements.some(p => p.kind === 'utility-grid')
    ? { id: 'grid', label: 'Rede da concessionária presente', status: 'ok' }
    : { id: 'grid', label: 'Rede da concessionária presente', status: 'info', detail: 'Sem o símbolo da rede.', suggestion: 'Finalize o diagrama com o símbolo da rede depois do medidor.' });

  // ── 5. Placa de advertência de geração própria ────────────────────────────
  const hasPlate = (state.photos ?? []).some(ph => PLATE_HREFS.has(ph.href))
    || placements.some(p => p.kind === 'warning-sign' || p.kind === 'warning-sign-enel');
  push(hasPlate
    ? { id: 'plate', label: 'Placa de advertência de geração própria', status: 'ok' }
    : { id: 'plate', label: 'Placa de advertência de geração própria', status: 'info', detail: 'A placa não está no diagrama.', suggestion: 'Inclua a placa no bloco do padrão de entrada (o layout automático já a posiciona).' });

  // ── 6. Trechos FV→inversor marcados como CC ───────────────────────────────
  const misTyped = state.connections.filter(c => {
    const fromIds = endpointSymbols(c.from, byConnId);
    const toIds = endpointSymbols(c.to, byConnId);
    const kinds = new Set([...fromIds, ...toIds].map(id => byId.get(id)?.kind));
    return kinds.has('pv-array') && (kinds.has('inverter') || kinds.has('microinverter')) && c.conductor !== 'dc';
  });
  push(misTyped.length === 0
    ? { id: 'dc-conductor', label: 'Trechos FV→inversor como condutor CC', status: 'ok' }
    : { id: 'dc-conductor', label: 'Trechos FV→inversor como condutor CC', status: 'info', detail: `${misTyped.length} trecho(s) FV→inversor sem o tipo CC.`, suggestion: 'Selecione a ligação e mude o condutor para CC — muda a cor e entra certo na legenda.' });

  // ── 7. Ligações quebradas / em ciclo ──────────────────────────────────────
  const resolved = computeAllConnectionPoints(state.connections, byId);
  const broken = state.connections.filter(c => !resolved.has(c.id));
  push(broken.length === 0
    ? { id: 'broken', label: 'Todas as ligações resolvem', status: 'ok' }
    : { id: 'broken', label: 'Todas as ligações resolvem', status: 'warning', detail: `${broken.length} ligação(ões) com ponta solta em componente removido ou derivação em ciclo.`, suggestion: 'Apague ou religue as ligações quebradas (elas não são desenhadas).' });

  // ── 8. Componentes isolados ───────────────────────────────────────────────
  const isolated = placements.filter(p =>
    neighbors(p.id).size === 0 && p.kind !== 'warning-sign' && p.kind !== 'warning-sign-enel');
  push(isolated.length === 0
    ? { id: 'isolated', label: 'Nenhum componente solto', status: 'ok' }
    : { id: 'isolated', label: 'Nenhum componente solto', status: 'info', detail: `Sem ligação: ${isolated.map(p => p.label || p.kind).slice(0, 4).join(', ')}${isolated.length > 4 ? '…' : ''}.`, suggestion: 'Ligue (ou remova) os componentes soltos antes de protocolar.' });

  // ── 9. Aterramento ────────────────────────────────────────────────────────
  if (groundingOn) {
    // vale como indicação: símbolo de terra, condutor de terra OU a declaração
    // de equipotencialização (BEP) em legenda/nota — é assim que o desenho
    // informa que padrão, neutro e malha da edificação estão interligados
    const mentionsBep = (s: string) => /\bbep\b|equipotencial/i.test(s);
    const hasGround = placements.some(p => p.kind === 'ground')
      || state.connections.some(c => c.conductor === 'ground')
      || placements.some(p => p.legend?.some(mentionsBep))
      || (state.texts ?? []).some(t => mentionsBep(t.value));
    push(hasGround
      ? { id: 'ground', label: 'Aterramento / equipotencialização indicados', status: 'ok' }
      : {
          id: 'ground', label: 'Aterramento / equipotencialização indicados', status: 'info',
          detail: 'Sem símbolo de terra, condutor de terra ou nota de equipotencialização.',
          suggestion: 'Indique o aterramento — símbolo, condutor tipo terra ou a nota de que padrão, neutro e malha da edificação estão equipotencializados no BEP.',
        });
  }

  // Interruptor do grupo Alertas desligado = silencia avisos (vira tudo ok/observação)
  const final = silenced ? checks.filter(c => c.status === 'ok') : checks;
  return {
    checks: final,
    okCount: final.filter(c => c.status === 'ok').length,
    warningCount: final.filter(c => c.status === 'warning').length,
    infoCount: final.filter(c => c.status === 'info').length,
    silenced,
  };
}
