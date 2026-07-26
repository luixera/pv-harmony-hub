import { ComponentKind, Primitive } from './types';

/**
 * Símbolos elétricos (alpha, inspirados em IEC 60617 — inversor com onda
 * senoidal, disjuntor com traço de abertura, medidor circular com "M").
 * Aproximados de propósito: serão recalibrados quando houver diagramas
 * unifilares reais da GD Manager para referência (combinado com o usuário).
 *
 * Convenção local: origem no canto superior-esquerdo do bloco (0,0),
 * Y crescendo para baixo (mesma convenção de SVG/PDF — não é a convenção
 * CAD tradicional Y-up; suficiente enquanto não há exportador DXF).
 * Caixa padrão: 24×20 mm.
 */

const W = 24, H = 20;

export const SYMBOL_BBOX = { w: W, h: H };

/** Nome curto por tipo — usado na paleta "adicionar componente" e nos rótulos automáticos. */
export const KIND_LABEL: Record<ComponentKind, string> = {
  'pv-array': 'Módulos',
  inverter: 'Inversor',
  breaker: 'Disjuntor Bipolar',
  meter: 'Medidor Convencional',
  'utility-grid': 'Rede',
  dps: 'DPS',
  fuse: 'Fusível',
  ground: 'Aterramento',
  'distribution-panel': 'Quadro de Distribuição',
  'meter-bidirectional': 'Medidor Bidirecional',
  'dc-switch': 'Chave CC',
  'breaker-tripolar': 'Disjuntor Tripolar',
  'warning-sign': 'Placa de Advertência',
  'warning-sign-enel': 'Placa de Advertência (ENEL)',
};

/**
 * Descrição por tipo pra tabela de LEGENDA automática da folha (mesmo padrão
 * das legendas de unifilares reais — ex.: o diagrama ENEL usado como
 * referência). Mais longa que o `KIND_LABEL` (nome curto da paleta).
 */
export const KIND_LEGEND: Record<ComponentKind, string> = {
  'pv-array': 'ARRANJO DE MÓDULOS FOTOVOLTAICOS',
  inverter: 'INVERSOR FOTOVOLTAICO',
  breaker: 'DISJUNTOR BIPOLAR',
  'breaker-tripolar': 'DISJUNTOR TRIPOLAR',
  'dc-switch': 'CHAVE CC',
  meter: 'MEDIDOR DE ENERGIA CONVENCIONAL',
  'meter-bidirectional': 'MEDIDOR DE ENERGIA BIDIRECIONAL',
  'utility-grid': 'REDE DA CONCESSIONÁRIA',
  dps: 'DPS (PROTEÇÃO CONTRA SURTO)',
  fuse: 'FUSÍVEL',
  ground: 'ATERRAMENTO',
  'distribution-panel': 'QUADRO DE DISTRIBUIÇÃO',
  'warning-sign': 'PLACA DE GERAÇÃO PRÓPRIA',
  'warning-sign-enel': 'PLACA RETORNO GERADOR (ENEL)',
};

/**
 * Recuo (mm) entre a borda da caixa (bbox 24×20) e onde o traço visual do
 * símbolo realmente termina — cada símbolo abaixo foi desenhado com uma
 * margem própria (ex.: o medidor é um círculo de raio 8 centrado em (12,10),
 * então sua borda real fica a 4mm da caixa; os demais usam stubs a 2mm).
 * `edgePoint()` (editableLayout.ts) subtrai isso pra o condutor encostar
 * exatamente na ponta do traço do símbolo, não numa borda "vazia" da caixa.
 */
export const CONNECTION_INSET: Record<ComponentKind, number> = {
  'pv-array': 2,
  inverter: 2,
  breaker: 2,
  meter: 4,
  'utility-grid': 4,
  dps: 2,
  fuse: 2,
  ground: 2,
  'distribution-panel': 2,
  'meter-bidirectional': 3,
  'dc-switch': 2,
  'breaker-tripolar': 2,
  'warning-sign': 2,
  'warning-sign-enel': 2,
};

/**
 * Porta de conexão de um símbolo: um ponto NOMEADO da geometria onde um
 * condutor pode encostar com precisão (em vez de mirar "a borda mais
 * próxima da caixa"). Coordenadas locais do bloco (mesma convenção dos
 * `SYMBOL_DEFS`: origem no canto superior-esquerdo, caixa 24×20) —
 * `portPagePosition()` (editableLayout.ts) converte pra página aplicando
 * escala e rotação na mesma ordem do `blockTransform()`.
 */
export interface SymbolPort {
  id: string;
  /** Nome curto exibido na UI (tooltip da bolinha de porta, lista de ligações). */
  name: string;
  x: number;
  y: number;
}

/**
 * Portas por símbolo — calibradas contra a geometria real de cada
 * `SYMBOL_DEFS` (a porta fica na PONTA do traço desenhado, não na borda da
 * caixa). Componentes em série ganham entrada/saída; o inversor distingue
 * lado CC e lado CA; DPS e aterramento conectam só por cima (derivação).
 */
export const SYMBOL_PORTS: Record<ComponentKind, SymbolPort[]> = {
  'pv-array': [
    { id: 'esq', name: 'Esquerda', x: 2, y: H / 2 },
    { id: 'dir', name: 'Direita', x: W - 2, y: H / 2 },
    { id: 'topo', name: 'Topo', x: W / 2, y: 3 },
    { id: 'base', name: 'Base', x: W / 2, y: H - 3 },
  ],
  inverter: [
    { id: 'cc', name: 'CC', x: 2, y: H / 2 },
    { id: 'ca', name: 'CA', x: W - 2, y: H / 2 },
    { id: 'topo', name: 'Topo', x: W / 2, y: 2 },
    { id: 'base', name: 'Base', x: W / 2, y: H - 2 },
  ],
  breaker: [
    { id: 'entrada', name: 'Entrada', x: 2, y: H / 2 },
    { id: 'saida', name: 'Saída', x: W - 2, y: H / 2 },
  ],
  'breaker-tripolar': [
    { id: 'entrada', name: 'Entrada', x: 2, y: H / 2 },
    { id: 'saida', name: 'Saída', x: W - 2, y: H / 2 },
  ],
  'dc-switch': [
    { id: 'entrada', name: 'Entrada', x: 2, y: H / 2 },
    { id: 'saida', name: 'Saída', x: W - 2, y: H / 2 },
  ],
  fuse: [
    { id: 'entrada', name: 'Entrada', x: 2, y: H / 2 },
    { id: 'saida', name: 'Saída', x: W - 2, y: H / 2 },
  ],
  meter: [
    { id: 'esq', name: 'Esquerda', x: 4, y: H / 2 },
    { id: 'dir', name: 'Direita', x: W - 4, y: H / 2 },
    { id: 'topo', name: 'Topo', x: W / 2, y: 2 },
    { id: 'base', name: 'Base', x: W / 2, y: H - 2 },
  ],
  'meter-bidirectional': [
    { id: 'esq', name: 'Esquerda', x: 4, y: H / 2 },
    { id: 'dir', name: 'Direita', x: W - 4, y: H / 2 },
    { id: 'topo', name: 'Topo', x: W / 2, y: H / 2 - 6 },
    { id: 'base', name: 'Base', x: W / 2, y: H / 2 + 6 },
  ],
  'utility-grid': [
    { id: 'esq', name: 'Esquerda', x: 4, y: H / 2 },
    { id: 'dir', name: 'Direita', x: W - 4, y: H / 2 },
  ],
  dps: [
    { id: 'topo', name: 'Entrada', x: W / 2, y: 2 },
  ],
  ground: [
    { id: 'topo', name: 'Entrada', x: W / 2, y: 2 },
  ],
  'distribution-panel': [
    { id: 'entrada', name: 'Entrada', x: 2, y: H / 2 },
    { id: 'saida', name: 'Saída', x: W - 2, y: H / 2 },
  ],
  // placas de sinalização — sem ligação elétrica (ficam afixadas no padrão de entrada)
  'warning-sign': [],
  'warning-sign-enel': [],
};

export const SYMBOL_DEFS: Record<ComponentKind, Primitive[]> = {
  'pv-array': [
    // Módulo/arranjo FV — caixa com o triângulo de FONTE apontando pro lado
    // da saída (modelo escolhido pelo usuário, jul/2026, a partir do desenho
    // real que ele mandou; substituiu a caixa hachurada).
    { kind: 'rect', x: 2, y: 3, w: W - 4, h: H - 6 },
    { kind: 'polyline', points: [{ x: W - 2, y: 3 }, { x: 13, y: H / 2 }, { x: W - 2, y: H - 3 }] },
  ],
  // Inversor — caixa dividida pela DIAGONAL: lado CC (cima/esquerda) com os
  // dois traços de corrente contínua, lado CA (baixo/direita) com a senoide.
  // Também veio do desenho real enviado pelo usuário (jul/2026).
  inverter: [
    { kind: 'rect', x: 2, y: 2, w: W - 4, h: H - 4 },
    { kind: 'line', a: { x: 2, y: H - 2 }, b: { x: W - 2, y: 2 } },
    // lado CC: dois traços verticais paralelos
    { kind: 'line', a: { x: 7.5, y: 5 }, b: { x: 7.5, y: 9.5 } },
    { kind: 'line', a: { x: 9.5, y: 5 }, b: { x: 9.5, y: 9.5 } },
    // lado CA: senoide de um período
    {
      kind: 'polyline',
      points: [
        { x: 12.5, y: 15 }, { x: 13.4, y: 13.6 }, { x: 14.5, y: 13 }, { x: 15.6, y: 13.6 },
        { x: 16.5, y: 15 }, { x: 17.4, y: 16.4 }, { x: 18.5, y: 17 }, { x: 19.6, y: 16.4 },
        { x: 20.5, y: 15 },
      ],
    },
  ],
  // Chave HORIZONTAL — todo o resto do unifilar flui da esquerda p/ direita,
  // então o traço de abertura tem que ficar no sentido do condutor, não
  // atravessado (era o bug: a versão anterior desenhava a chave na vertical).
  breaker: [
    { kind: 'line', a: { x: 2, y: H / 2 }, b: { x: W / 2 - 4, y: H / 2 } },
    { kind: 'circle', center: { x: W / 2 - 4, y: H / 2 }, radius: 1 },
    { kind: 'line', a: { x: W / 2 - 4, y: H / 2 }, b: { x: W / 2 + 4, y: H / 2 - 7 } },
    { kind: 'circle', center: { x: W / 2 + 4, y: H / 2 }, radius: 1 },
    { kind: 'line', a: { x: W / 2 + 4, y: H / 2 }, b: { x: W - 2, y: H / 2 } },
  ],
  meter: [
    { kind: 'circle', center: { x: W / 2, y: H / 2 }, radius: 8 },
    { kind: 'text', at: { x: W / 2, y: H / 2 + 3 }, value: 'M', size: 8, anchor: 'middle', weight: 'bold' },
  ],
  // Rede da concessionária — POSTE de distribuição (pedido do usuário: um
  // símbolo que se leia na hora como "rede da concessionária", em vez da
  // hachura genérica de antes): ramal de ligação entrando pela esquerda,
  // poste, cruzeta com três isoladores e a base engastada.
  'utility-grid': [
    { kind: 'line', a: { x: 4, y: H / 2 }, b: { x: 13, y: H / 2 } },   // ramal de ligação
    { kind: 'line', a: { x: 13, y: 3 }, b: { x: 13, y: H - 2 } },      // poste
    { kind: 'line', a: { x: 7, y: 6 }, b: { x: 21, y: 6 } },           // cruzeta
    { kind: 'line', a: { x: 8, y: 4 }, b: { x: 8, y: 6 } },            // isolador 1
    { kind: 'line', a: { x: 14, y: 4 }, b: { x: 14, y: 6 } },          // isolador 2
    { kind: 'line', a: { x: 20, y: 4 }, b: { x: 20, y: 6 } },          // isolador 3
    { kind: 'circle', center: { x: 8, y: 3.4 }, radius: 0.8 },
    { kind: 'circle', center: { x: 14, y: 3.4 }, radius: 0.8 },
    { kind: 'circle', center: { x: 20, y: 3.4 }, radius: 0.8 },
    { kind: 'line', a: { x: 10, y: H - 2 }, b: { x: 16, y: H - 2 } },  // base
    { kind: 'line', a: { x: 13, y: 6 }, b: { x: 13, y: 3 } },
  ],
  // DPS (dispositivo de proteção contra surtos): desenhado no eixo VERTICAL —
  // é um componente de derivação (liga do condutor para o terra), não um
  // componente em série no fluxo horizontal como os demais. Conecta por cima
  // (entrada, ligado ao condutor) e o traço de terra embaixo é só indicativo
  // (não precisa ligação — a "conexão" real de terra não faz parte do MVP).
  dps: [
    { kind: 'line', a: { x: W / 2, y: 2 }, b: { x: W / 2, y: 6 } },
    { kind: 'rect', x: W / 2 - 4, y: 6, w: 8, h: 7 },
    { kind: 'line', a: { x: W / 2 - 2, y: 7.5 }, b: { x: W / 2 + 2, y: 11.5 } },
    {
      kind: 'polyline',
      points: [
        { x: W / 2 + 0.4, y: 10 },
        { x: W / 2 + 2, y: 11.5 },
        { x: W / 2 + 0.3, y: 12.3 },
      ],
    },
    { kind: 'line', a: { x: W / 2, y: 13 }, b: { x: W / 2, y: 15.5 } },
    { kind: 'line', a: { x: W / 2 - 3, y: 15.5 }, b: { x: W / 2 + 3, y: 15.5 } },
    { kind: 'line', a: { x: W / 2 - 2, y: 17 }, b: { x: W / 2 + 2, y: 17 } },
    { kind: 'line', a: { x: W / 2 - 1, y: 18.5 }, b: { x: W / 2 + 1, y: 18.5 } },
  ],
  // Fusível — corpo retangular no meio do condutor horizontal.
  fuse: [
    { kind: 'line', a: { x: 2, y: H / 2 }, b: { x: W / 2 - 4, y: H / 2 } },
    { kind: 'rect', x: W / 2 - 4, y: H / 2 - 3, w: 8, h: 6 },
    { kind: 'line', a: { x: W / 2 + 4, y: H / 2 }, b: { x: W - 2, y: H / 2 } },
  ],
  // Aterramento — mesmo símbolo de terra usado na base do DPS, agora como
  // componente próprio (para representar um terra que não é o do DPS,
  // ex.: BEP/malha de aterramento). Conecta só por cima.
  ground: [
    { kind: 'line', a: { x: W / 2, y: 2 }, b: { x: W / 2, y: 10 } },
    { kind: 'line', a: { x: W / 2 - 4, y: 10 }, b: { x: W / 2 + 4, y: 10 } },
    { kind: 'line', a: { x: W / 2 - 2.5, y: 12.5 }, b: { x: W / 2 + 2.5, y: 12.5 } },
    { kind: 'line', a: { x: W / 2 - 1, y: 15 }, b: { x: W / 2 + 1, y: 15 } },
  ],
  // Quadro de distribuição (QDC/QG) — caixa com divisórias sugerindo circuitos internos.
  'distribution-panel': [
    { kind: 'line', a: { x: 2, y: H / 2 }, b: { x: 5, y: H / 2 } },
    { kind: 'rect', x: 5, y: 3, w: 14, h: 14 },
    { kind: 'line', a: { x: 8, y: 6 }, b: { x: 8, y: 17 } },
    { kind: 'line', a: { x: 12, y: 6 }, b: { x: 12, y: 17 } },
    { kind: 'line', a: { x: 16, y: 6 }, b: { x: 16, y: 17 } },
    { kind: 'line', a: { x: 19, y: H / 2 }, b: { x: 22, y: H / 2 } },
  ],
  // Medidor bidirecional (kWh) — caixa retangular (vs. o círculo do medidor
  // convencional), calibrado pela legenda de um unifilar real (ENEL): é o
  // símbolo efetivamente usado no corpo do diagrama (medição bidirecional
  // kW/kWh/kVarh), o "M" circular fica reservado ao medidor convencional.
  'meter-bidirectional': [
    { kind: 'rect', x: W / 2 - 8, y: H / 2 - 6, w: 16, h: 12 },
    { kind: 'text', at: { x: W / 2, y: H / 2 + 2.5 }, value: 'kWh', size: 5, anchor: 'middle', weight: 'bold' },
    { kind: 'line', a: { x: W / 2 - 6, y: H / 2 - 4 }, b: { x: W / 2 - 3, y: H / 2 - 4 } },
    { kind: 'line', a: { x: W / 2 + 3, y: H / 2 - 4 }, b: { x: W / 2 + 6, y: H / 2 - 4 } },
  ],
  // Chave CC — desconector de corrente contínua: lâmina diagonal simples entre
  // dois contatos, sem a marca de disparo do disjuntor (diferença visual
  // intencional entre os dois, como na legenda de referência).
  'dc-switch': [
    { kind: 'line', a: { x: 2, y: H / 2 }, b: { x: W / 2 - 4, y: H / 2 } },
    { kind: 'circle', center: { x: W / 2 - 4, y: H / 2 }, radius: 1 },
    { kind: 'line', a: { x: W / 2 - 4, y: H / 2 }, b: { x: W / 2 + 4, y: H / 2 - 7 } },
    { kind: 'circle', center: { x: W / 2 + 4, y: H / 2 }, radius: 1 },
    { kind: 'line', a: { x: W / 2 + 4, y: H / 2 }, b: { x: W - 2, y: H / 2 } },
  ],
  // Disjuntor tripolar — mesmo glifo do bipolar (`breaker`), com um traço a
  // mais atravessando a lâmina pra indicar o 3º polo.
  'breaker-tripolar': [
    { kind: 'line', a: { x: 2, y: H / 2 }, b: { x: W / 2 - 4, y: H / 2 } },
    { kind: 'circle', center: { x: W / 2 - 4, y: H / 2 }, radius: 1 },
    { kind: 'line', a: { x: W / 2 - 4, y: H / 2 }, b: { x: W / 2 + 4, y: H / 2 - 7 } },
    { kind: 'circle', center: { x: W / 2 + 4, y: H / 2 }, radius: 1 },
    { kind: 'line', a: { x: W / 2 + 4, y: H / 2 }, b: { x: W - 2, y: H / 2 } },
    { kind: 'line', a: { x: W / 2 - 1, y: H / 2 + 2.5 }, b: { x: W / 2 + 3, y: H / 2 - 4.5 } },
  ],
  // Placa de advertência amarela — CPFL e demais concessionárias (calibrada
  // pela foto real enviada pelo usuário): faixa "CUIDADO" no topo e os
  // dizeres "RISCO DE CHOQUE ELÉTRICO / GERAÇÃO PRÓPRIA". Sem ligação elétrica.
  'warning-sign': [
    { kind: 'rect', x: 2.5, y: 1, w: W - 5, h: H - 2 },
    // faixa do cabeçalho (na placa real é preta com letras amarelas)
    { kind: 'rect', x: 4, y: 2.5, w: W - 8, h: 4 },
    { kind: 'text', at: { x: W / 2, y: 5.7 }, value: 'CUIDADO', size: 2.6, anchor: 'middle', weight: 'bold' },
    { kind: 'text', at: { x: W / 2, y: 10.4 }, value: 'RISCO DE CHOQUE', size: 1.7, anchor: 'middle', weight: 'bold' },
    { kind: 'text', at: { x: W / 2, y: 12.8 }, value: 'ELÉTRICO', size: 1.7, anchor: 'middle', weight: 'bold' },
    { kind: 'text', at: { x: W / 2, y: 16.4 }, value: 'GERAÇÃO PRÓPRIA', size: 1.7, anchor: 'middle', weight: 'bold' },
  ],
  // Placa de aviso da ENEL (calibrada pela foto real): cabeçalho "AVISO",
  // raio de choque à esquerda, "RISCO DE CHOQUE ELÉTRICO" e a faixa
  // "RETORNO GERADOR DE ENERGIA" embaixo. Sem ligação elétrica.
  'warning-sign-enel': [
    { kind: 'rect', x: 2.5, y: 1, w: W - 5, h: H - 2 },
    { kind: 'text', at: { x: W / 2, y: 4.3 }, value: 'AVISO', size: 2.4, anchor: 'middle', weight: 'bold' },
    { kind: 'line', a: { x: 2.5, y: 5.4 }, b: { x: W - 2.5, y: 5.4 } },
    // raio (seta de descarga) à esquerda
    { kind: 'polyline', points: [{ x: 7.5, y: 6.8 }, { x: 5.2, y: 10.6 }, { x: 6.6, y: 10.6 }, { x: 4.8, y: 13.6 }] },
    { kind: 'polyline', points: [{ x: 4.8, y: 13.6 }, { x: 5, y: 12.2 }, { x: 6.1, y: 13 }, { x: 4.8, y: 13.6 }] },
    { kind: 'text', at: { x: 14.8, y: 8.6 }, value: 'RISCO DE', size: 1.7, anchor: 'middle', weight: 'bold' },
    { kind: 'text', at: { x: 14.8, y: 11 }, value: 'CHOQUE', size: 1.7, anchor: 'middle', weight: 'bold' },
    { kind: 'text', at: { x: 14.8, y: 13.4 }, value: 'ELÉTRICO', size: 1.7, anchor: 'middle', weight: 'bold' },
    { kind: 'line', a: { x: 2.5, y: 14.6 }, b: { x: W - 2.5, y: 14.6 } },
    { kind: 'text', at: { x: W / 2, y: 16.4 }, value: 'RETORNO GERADOR', size: 1.5, anchor: 'middle', weight: 'bold' },
    { kind: 'text', at: { x: W / 2, y: 18.2 }, value: 'DE ENERGIA', size: 1.5, anchor: 'middle', weight: 'bold' },
  ],
};
