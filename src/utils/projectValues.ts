import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ProjectWithDetails } from '@/hooks/useProjects';

/** Catálogo ÚNICO das variáveis suportadas nos templates .docx.
 *  Mantenha alinhado com as chaves retornadas por buildProjectValues. */
export interface TemplateVariable {
  key: string;
  desc: string;
  category: string;
  example: string;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // Projeto
  { key: 'codigo_projeto',    desc: 'Código do projeto',                 category: 'Projeto',      example: 'GD-2026-0042' },
  { key: 'empresa',           desc: 'Nome da empresa integradora',       category: 'Projeto',      example: 'SOLAR TECH LTDA' },
  { key: 'concessionaria',    desc: 'Nome da concessionária',            category: 'Projeto',      example: 'CPFL PAULISTA' },
  { key: 'data_criacao',      desc: 'Data de criação do projeto',        category: 'Projeto',      example: '10/07/2026' },
  // Titular
  { key: 'nome_titular',      desc: 'Nome do titular da UC',             category: 'Titular',      example: 'JOÃO DA SILVA' },
  { key: 'cpf_cnpj',          desc: 'CPF/CNPJ do titular',               category: 'Titular',      example: '123.456.789-00' },
  { key: 'email_titular',     desc: 'E-mail do titular',                 category: 'Titular',      example: 'joao@email.com' },
  { key: 'telefone_titular',  desc: 'Telefone do titular',               category: 'Titular',      example: '(19) 99999-8888' },
  // Endereço & UC
  { key: 'endereco',            desc: 'Endereço completo (junção de todas as partes)', category: 'Endereço e UC', example: 'RUA DAS FLORES, Nº 123, APTO 52, CENTRO, CAMPINAS/SP, CEP: 13000-000' },
  { key: 'endereco_rua',        desc: 'Logradouro (só a rua/avenida)',   category: 'Endereço e UC', example: 'RUA DAS FLORES' },
  { key: 'endereco_numero',     desc: 'Número',                          category: 'Endereço e UC', example: '123' },
  { key: 'endereco_complemento',desc: 'Complemento (apto, bloco, casa…)',category: 'Endereço e UC', example: 'APTO 52' },
  { key: 'endereco_bairro',     desc: 'Bairro',                          category: 'Endereço e UC', example: 'CENTRO' },
  { key: 'endereco_cep',        desc: 'CEP',                             category: 'Endereço e UC', example: '13000-000' },
  { key: 'endereco_cidade',     desc: 'Cidade',                          category: 'Endereço e UC', example: 'CAMPINAS' },
  { key: 'endereco_estado',     desc: 'Estado (UF)',                     category: 'Endereço e UC', example: 'SP' },
  { key: 'cidade',            desc: 'Cidade — alias de {endereco_cidade}', category: 'Endereço e UC', example: 'CAMPINAS' },
  { key: 'estado',            desc: 'Estado (UF) — alias de {endereco_estado}', category: 'Endereço e UC', example: 'SP' },
  { key: 'uf',                desc: 'Estado (UF) — alias de {estado}',   category: 'Endereço e UC', example: 'SP' },
  { key: 'cep',               desc: 'CEP — alias de {endereco_cep}',     category: 'Endereço e UC', example: '13000-000' },
  { key: 'bairro',            desc: 'Bairro — alias de {endereco_bairro}', category: 'Endereço e UC', example: 'CENTRO' },
  { key: 'numero',            desc: 'Número — alias de {endereco_numero}', category: 'Endereço e UC', example: '123' },
  { key: 'complemento',       desc: 'Complemento — alias de {endereco_complemento}', category: 'Endereço e UC', example: 'APTO 52' },
  { key: 'endereco_completo', desc: 'Endereço completo — alias de {endereco}', category: 'Endereço e UC', example: 'RUA DAS FLORES, Nº 123, APTO 52, CENTRO, CAMPINAS/SP, CEP: 13000-000' },
  { key: 'coordenadas',       desc: 'Coordenadas geográficas (como digitadas)', category: 'Endereço e UC', example: '-22.9099, -47.0626' },
  { key: 'latitude',          desc: 'Latitude (grau decimal)',           category: 'Endereço e UC', example: '-22.9099' },
  { key: 'longitude',         desc: 'Longitude (grau decimal)',          category: 'Endereço e UC', example: '-47.0626' },
  { key: 'latitude_gms',      desc: 'Latitude em SIRGAS 2000 (grau/min/seg)',  category: 'Endereço e UC', example: '22°54\'35.6"S' },
  { key: 'longitude_gms',     desc: 'Longitude em SIRGAS 2000 (grau/min/seg)', category: 'Endereço e UC', example: '47°03\'45.4"O' },
  { key: 'utm_fuso',          desc: 'UTM — fuso com a faixa',            category: 'Endereço e UC', example: '23K' },
  { key: 'utm_latitude',      desc: 'UTM — latitude (coordenada N, norte)', category: 'Endereço e UC', example: '7.465.123,45 m' },
  { key: 'utm_longitude',     desc: 'UTM — longitude (coordenada E, leste)', category: 'Endereço e UC', example: '287.456,78 m' },
  { key: 'utm_hemisferio',    desc: 'UTM — hemisfério (N ou S)',         category: 'Endereço e UC', example: 'S' },
  { key: 'coordenadas_utm',   desc: 'UTM completo numa linha só',        category: 'Endereço e UC', example: '23K 287.456,78 m E, 7.465.123,45 m N' },
  { key: 'rural',             desc: 'Área rural? (Sim/Não)',             category: 'Endereço e UC', example: 'Não' },
  { key: 'uc',                desc: 'Número da UC',                      category: 'Endereço e UC', example: '4001234567' },
  { key: 'numero_uc',         desc: 'Número da UC — alias de {uc}',      category: 'Endereço e UC', example: '4001234567' },
  // Instalação
  { key: 'disjuntor',         desc: 'Corrente do disjuntor',             category: 'Instalação',   example: '63A' },
  { key: 'fase',              desc: 'Tipo de fase',                      category: 'Instalação',   example: 'Bifásico' },
  { key: 'tipo_fase',         desc: 'Tipo de fase — alias de {fase}',    category: 'Instalação',   example: 'Bifásico' },
  // Equipamentos
  { key: 'marca_inversor',    desc: 'Marca do inversor',                 category: 'Equipamentos', example: 'GROWATT' },
  { key: 'modelo_inversor',   desc: 'Modelo do inversor',                category: 'Equipamentos', example: 'MIN 5000TL-X' },
  { key: 'potencia_inversor', desc: 'Potência do inversor',              category: 'Equipamentos', example: '5 kW' },
  { key: 'qtd_inversores',    desc: 'Quantidade de inversores',          category: 'Equipamentos', example: '1' },
  { key: 'potencia_inversores', desc: 'Potência total dos inversores (potência × qtd)', category: 'Equipamentos', example: '10 kW' },
  { key: 'marca_modulo',      desc: 'Marca dos módulos',                 category: 'Equipamentos', example: 'CANADIAN SOLAR' },
  { key: 'modelo_modulo',     desc: 'Modelo dos módulos',                category: 'Equipamentos', example: 'CS7L-600MS' },
  { key: 'potencia_modulo',   desc: 'Potência dos módulos',              category: 'Equipamentos', example: '600 Wp' },
  { key: 'qtd_modulos',       desc: 'Quantidade de módulos',             category: 'Equipamentos', example: '10' },
  { key: 'area_ocupada',      desc: 'Área ocupada pelos módulos (qtd × 3 m²)', category: 'Equipamentos', example: '30 m²' },
  { key: 'potencia_total',    desc: 'Potência total instalada',          category: 'Equipamentos', example: '6 kWp' },
  { key: 'geracao_estimada',  desc: 'Geração média mensal prevista (menor potência entre módulos e inversores × 120)', category: 'Equipamentos', example: '720 kWh' },
  { key: 'geracao_estimada_kwh', desc: 'Geração média mensal prevista — só o número', category: 'Equipamentos', example: '720' },
  { key: 'inmetro_modulo',    desc: 'Nº do registro INMETRO do módulo (vem do Catálogo)',   category: 'Equipamentos', example: '008649/2024' },
  { key: 'inmetro_inversor',  desc: 'Nº do registro INMETRO do inversor (vem do Catálogo)', category: 'Equipamentos', example: '004521/2023' },
  { key: 'kwp',               desc: 'Potência total (só o número)',      category: 'Equipamentos', example: '6' },
  // Padrão de entrada (regras da concessionária, resolvidas por fase + disjuntor)
  { key: 'categoria_padrao',  desc: 'Categoria do padrão de entrada',    category: 'Padrão de entrada', example: 'B1' },
  { key: 'num_fases_padrao',  desc: 'Nº de fases do padrão',             category: 'Padrão de entrada', example: '2' },
  { key: 'bitola_cabo',       desc: 'Bitola dos cabos de entrada',       category: 'Padrão de entrada', example: '16 mm²' },
  { key: 'disjuntor_padrao',  desc: 'Disjuntor de entrada do padrão',    category: 'Padrão de entrada', example: '63A' },
  { key: 'classe_padrao',     desc: 'Classe do padrão de entrada',       category: 'Padrão de entrada', example: 'BIFÁSICO' },
  { key: 'caixa_medicao',     desc: 'Caixa de medição',                  category: 'Padrão de entrada', example: 'TIPO II' },
  // Datas
  // Engenharia (Motor) — calculadas pelo Rules Engine na hora de gerar o
  // documento (engineeringTemplateValues); sem dados/regra, resolvem vazias.
  { key: 'arranjo_strings',        desc: 'Arranjo dos painéis por inversor/MPPT (multilinha)', category: 'Engenharia (Motor)', example: 'Inversor 1:\n    2 strings de 10 módulos ligadas ao MPPT1;\nTotal: 40 módulos – 2 inversores.' },
  { key: 'arranjo_strings_resumo', desc: 'Arranjo dos painéis em uma linha', category: 'Engenharia (Motor)', example: '2 strings × 10 módulos' },
  { key: 'bitola_cc',              desc: 'Bitola CC sugerida (string→inversor)', category: 'Engenharia (Motor)', example: '6 mm²' },
  { key: 'bitola_ca',              desc: 'Bitola CA sugerida (inversor→quadro)', category: 'Engenharia (Motor)', example: '6 mm²' },
  { key: 'queda_tensao_cc',        desc: 'Queda de tensão CC estimada',          category: 'Engenharia (Motor)', example: '1,20%' },
  { key: 'queda_tensao_ca',        desc: 'Queda de tensão CA estimada',          category: 'Engenharia (Motor)', example: '2,10%' },
  { key: 'disjuntor_ca',           desc: 'Disjuntor CA sugerido por inversor',   category: 'Engenharia (Motor)', example: '32A' },
  { key: 'disjuntor_geral_ca',     desc: 'Disjuntor geral CA sugerido (todos os arranjos)', category: 'Engenharia (Motor)', example: '63A' },
  { key: 'bitola_aterramento',     desc: 'Bitola do condutor de aterramento',    category: 'Engenharia (Motor)', example: '6 mm²' },

  { key: 'data',              desc: 'Data de hoje',                      category: 'Datas',        example: '15/07/2026' },
  { key: 'data_emissao',      desc: 'Data de emissão (hoje)',            category: 'Datas',        example: '15/07/2026' },
  { key: 'data_atual',        desc: 'Data atual — alias de {data}',      category: 'Datas',        example: '15/07/2026' },
  { key: 'data_mais_30',      desc: 'Data de hoje + 30 dias',            category: 'Datas',        example: '14/08/2026' },
];

export const KNOWN_TEMPLATE_KEYS = new Set(TEMPLATE_VARIABLES.map(v => v.key));

/** Valores fictícios para o "Testar preenchimento" (sem precisar de projeto real). */
export function buildSampleValues(): Record<string, string> {
  const today = format(new Date(), 'dd/MM/yyyy', { locale: ptBR });
  const values: Record<string, string> = {};
  for (const v of TEMPLATE_VARIABLES) values[v.key] = v.example;
  values.data = today;
  values.data_emissao = today;
  values.data_atual = today;
  return values;
}

/** Resolve tags `{chave}` num texto livre usando o mesmo catálogo dos templates
 *  .docx (`buildProjectValues`) — usado no diagrama unifilar (textos soltos e
 *  legendas de componentes). Tag desconhecida fica como está (não quebra o
 *  texto, só não substitui). */
export function resolveProjectTags(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    const v = values[key];
    return v !== undefined ? v : match;
  });
}

/** Distância de Levenshtein simples (para sugerir a tag correta). */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

/** Sugere a variável conhecida mais parecida com uma tag desconhecida (ou null). */
export function suggestTemplateKey(unknown: string): string | null {
  const u = unknown.toLowerCase();
  let best: string | null = null;
  let bestScore = Infinity;
  for (const v of TEMPLATE_VARIABLES) {
    const k = v.key.toLowerCase();
    // substring direta conta como forte candidata
    const dist = k.includes(u) || u.includes(k) ? 1 : levenshtein(u, k);
    if (dist < bestScore) { bestScore = dist; best = v.key; }
  }
  // só sugere se for razoavelmente próximo
  return best && bestScore <= Math.max(2, Math.floor(unknown.length * 0.4)) ? best : null;
}

// ── Helpers de cálculo (compartilhados entre os dois montadores de valores) ───

/** Data de hoje + N dias, no formato dd/MM/yyyy. */
export function datePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return format(d, 'dd/MM/yyyy', { locale: ptBR });
}

/** Soma da potência dos inversores = potência × quantidade (ex.: "10 kW"). */
export function inverterTotalPower(power: number | null | undefined, qty: number | null | undefined): string {
  const p = Number(power), q = Number(qty);
  if (!p || !q) return '';
  const total = p * q;
  return `${Number.isInteger(total) ? total : total.toFixed(2)} kW`;
}

/** Área ocupada aproximada pelos módulos = qtd de módulos × 3 m² (ex.: "30 m²"). */
export function moduleOccupiedArea(qty: number | null | undefined): string {
  const q = Number(qty);
  if (!q) return '';
  const area = q * 3;
  return `${Number.isInteger(area) ? area : area.toFixed(2)} m²`;
}

/** Converte um grau decimal em Graus/Minutos/Segundos (SIRGAS 2000). */
export function decimalToDMS(dec: number, kind: 'lat' | 'lon'): string {
  if (!isFinite(dec)) return '';
  const hemi = kind === 'lat' ? (dec >= 0 ? 'N' : 'S') : (dec >= 0 ? 'L' : 'O');
  const abs = Math.abs(dec);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}°${String(m).padStart(2, '0')}'${s.padStart(4, '0')}"${hemi}`;
}

/** Extrai latitude/longitude decimais de uma string livre ("-22.9, -47.06"). */
export function parseCoordinates(raw: string | null | undefined): { lat: number | null; lon: number | null } {
  if (!raw) return { lat: null, lon: null };
  const nums = raw.match(/-?\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 2) return { lat: null, lon: null };
  const lat = parseFloat(nums[0].replace(',', '.'));
  const lon = parseFloat(nums[1].replace(',', '.'));
  return { lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null };
}

/**
 * Converte grau decimal em UTM (SIRGAS 2000 / WGS 84 — mesmo elipsoide na
 * prática, diferença abaixo de 1 m).
 *
 * Algumas concessionárias pedem a localização em UTM nos formulários, e o
 * cadastro só guarda grau decimal. Converter aqui evita o projetista ter de
 * recorrer a site externo e digitar de novo — que é onde o erro entra.
 *
 * Devolve `null` fora da faixa em que o UTM é definido (|lat| > 84).
 */
export interface UtmCoordinate {
  /** Fuso com a letra da faixa, como aparece nos formulários: "23K". */
  zone: string;
  /** Número do fuso, sem a letra. */
  zoneNumber: number;
  /** 'N' ou 'S'. */
  hemisphere: 'N' | 'S';
  /** Metros a leste (E). */
  easting: number;
  /** Metros ao norte (N). */
  northing: number;
}

export function decimalToUTM(lat: number, lon: number): UtmCoordinate | null {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 84) return null;

  const a = 6378137;                 // semieixo maior (GRS80/WGS84)
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;          // primeira excentricidade ao quadrado
  const e4 = e2 * e2, e6 = e4 * e2;
  const ep2 = e2 / (1 - e2);         // segunda excentricidade
  const k0 = 0.9996;                 // fator de escala do UTM

  const zoneNumber = Math.floor((lon + 180) / 6) + 1;
  const lambda0 = ((zoneNumber - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;

  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), tanPhi = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * (lambda - lambda0);

  const M = a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi)
  );

  const easting = k0 * N * (
    A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120
  ) + 500000;

  let northing = k0 * (M + N * tanPhi * (
    A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720
  ));
  // no hemisfério sul o UTM soma 10.000 km para não trabalhar com negativo
  if (lat < 0) northing += 10000000;

  // letra da faixa de latitude (padrão MGRS), de 80°S a 84°N em passos de 8°
  const letras = 'CDEFGHJKLMNPQRSTUVWX';
  const indice = Math.floor((lat + 80) / 8);
  const letra = letras[Math.min(Math.max(indice, 0), letras.length - 1)];

  return {
    zone: `${zoneNumber}${letra}`,
    zoneNumber,
    hemisphere: lat < 0 ? 'S' : 'N',
    easting: Math.round(easting * 100) / 100,
    northing: Math.round(northing * 100) / 100,
  };
}

/**
 * GERAÇÃO ESTIMADA — média mensal prevista, em kWh.
 *
 * Regra do usuário (ago/2026): pega a MENOR potência entre o conjunto de
 * módulos (kWp) e o de inversores (kW) e multiplica por 120.
 *
 * Usar a menor das duas é o que evita prometer o que o sistema não entrega:
 * com 12 kWp de módulos e 8 kW de inversor, quem limita a geração é o
 * inversor; no caso oposto, quem limita são os módulos.
 */
export function estimatedGenerationValues(e: {
  module_power?: number | null;
  module_quantity?: number | null;
  inverter_power?: number | null;
  inverter_quantity?: number | null;
  total_installed_power?: number | null;
}): Record<string, string> {
  const kwpModulos = e.module_power && e.module_quantity
    ? (Number(e.module_power) * Number(e.module_quantity)) / 1000
    : Number(e.total_installed_power ?? 0);
  const kwInversores = e.inverter_power
    ? Number(e.inverter_power) * Number(e.inverter_quantity ?? 1)
    : 0;

  // sem um dos dois lados não há o que comparar: usa o que existir
  const base = kwpModulos > 0 && kwInversores > 0
    ? Math.min(kwpModulos, kwInversores)
    : (kwpModulos || kwInversores);
  if (!base || !isFinite(base)) return { geracao_estimada: '', geracao_estimada_kwh: '' };

  const kwh = base * 120;
  const formatado = kwh.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return {
    geracao_estimada: `${formatado} kWh`,
    geracao_estimada_kwh: formatado,
  };
}

/** Variáveis derivadas de coordenadas (decimais + SIRGAS/DMS + UTM). */
export function coordinateValues(raw: string | null | undefined): Record<string, string> {
  const { lat, lon } = parseCoordinates(raw);
  const utm = lat != null && lon != null ? decimalToUTM(lat, lon) : null;
  const metros = (v: number) => v.toFixed(2).replace('.', ',');

  return {
    latitude:      lat != null ? String(lat) : '',
    longitude:     lon != null ? String(lon) : '',
    latitude_gms:  lat != null ? decimalToDMS(lat, 'lat') : '',
    longitude_gms: lon != null ? decimalToDMS(lon, 'lon') : '',
    // UTM em tags SEPARADAS, como a concessionária pede no formulário.
    // "latitude"/"longitude" em UTM são, tecnicamente, N (norte) e E (leste) —
    // os nomes seguem o que aparece nos formulários, e a descrição no catálogo
    // de variáveis deixa a equivalência explícita.
    utm_fuso:      utm ? utm.zone : '',
    utm_latitude:  utm ? `${metros(utm.northing)} m` : '',
    utm_longitude: utm ? `${metros(utm.easting)} m` : '',
    utm_hemisferio: utm ? utm.hemisphere : '',
    coordenadas_utm: utm
      ? `${utm.zone} ${metros(utm.easting)} m E, ${metros(utm.northing)} m N`
      : '',
  };
}

/** Partes do endereço, como ficam guardadas em project_general_data. */
export interface AddressParts {
  address?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  neighborhood?: string | null;
  cep?: string | null;
  city?: string | null;
  state?: string | null;
}

/** Monta o endereço completo a partir das partes separadas.
 *  Usado tanto na tag {endereco} quanto onde o endereço é exibido de uma vez
 *  só (PDF resumo, e-mails), já que a coluna `address` agora guarda apenas o
 *  logradouro. Partes vazias simplesmente não aparecem. */
export function formatFullAddress(a: AddressParts): string {
  const cidadeUf = [a.city, a.state].filter(Boolean).join('/');
  return [
    a.address,
    a.address_number && `Nº ${a.address_number}`,
    a.address_complement,
    a.neighborhood,
    cidadeUf,
    a.cep && `CEP: ${a.cep}`,
  ].filter(Boolean).join(', ');
}

/** Dados de uma revisão podem substituir os do projeto na geração do documento. */
export interface ProjectValueOverrides {
  generalData?: Partial<NonNullable<ProjectWithDetails['generalData']>> | null;
  equipment?: Partial<NonNullable<ProjectWithDetails['equipment']>> | null;
}

/** Mapa de tags → valores do projeto, usado para preencher templates .docx.
 *  Esta é a ÚNICA fonte dessas tags: tanto "Gerar documento" quanto o pacote do
 *  projetista passam por aqui, para que uma variável nova apareça nos dois. */
export function buildProjectValues(
  project: ProjectWithDetails,
  overrides?: ProjectValueOverrides,
): Record<string, string> {
  // As colunas do endereço são mais novas que os tipos gerados do Supabase,
  // por isso o cruzamento com AddressParts.
  const g = (overrides?.generalData ?? project.generalData ?? {}) as NonNullable<ProjectWithDetails['generalData']> & AddressParts;
  const e = (overrides?.equipment ?? project.equipment ?? {}) as NonNullable<ProjectWithDetails['equipment']>;
  const today = format(new Date(), 'dd/MM/yyyy', { locale: ptBR });

  const endereco = formatFullAddress(g as AddressParts);

  return {
    codigo_projeto:    project.code ?? '',
    empresa:           project.companyName ?? '',
    concessionaria:    project.concessionaireName ?? g.utility_company ?? '',
    nome_titular:      g.holder_name ?? '',
    cpf_cnpj:          g.holder_cpf_cnpj ?? '',
    email_titular:     g.holder_email ?? '',
    telefone_titular:  g.holder_phone ?? '',
    // Endereço: {endereco} é a junção; cada parte também tem sua própria tag.
    endereco,
    endereco_completo:      endereco,
    endereco_rua:           g.address ?? '',
    endereco_numero:        g.address_number ?? '',
    endereco_complemento:   g.address_complement ?? '',
    endereco_bairro:        g.neighborhood ?? '',
    endereco_cep:           g.cep ?? '',
    endereco_cidade:        g.city ?? '',
    endereco_estado:        g.state ?? '',
    numero:            g.address_number ?? '',
    complemento:       g.address_complement ?? '',
    bairro:            g.neighborhood ?? '',
    cidade:            g.city ?? '',
    estado:            g.state ?? '',
    uf:                g.state ?? '',
    cep:               g.cep ?? '',
    uc:                g.uc_number ?? '',
    numero_uc:         g.uc_number ?? '',
    disjuntor:         g.circuit_breaker_current ?? '',
    fase:              g.phase_type ?? '',
    tipo_fase:         g.phase_type ?? '',
    rural:             g.is_rural ? 'Sim' : 'Não',
    coordenadas:       g.coordinates ?? '',
    ...coordinateValues(g.coordinates),
    marca_inversor:    e.inverter_brand ?? '',
    modelo_inversor:   e.inverter_model ?? '',
    potencia_inversor: e.inverter_power != null ? `${e.inverter_power} kW` : '',
    qtd_inversores:    String(e.inverter_quantity ?? ''),
    potencia_inversores: inverterTotalPower(e.inverter_power, e.inverter_quantity),
    marca_modulo:      e.module_brand ?? '',
    modelo_modulo:     e.module_model ?? '',
    potencia_modulo:   e.module_power != null ? `${e.module_power} Wp` : '',
    qtd_modulos:       String(e.module_quantity ?? ''),
    area_ocupada:      moduleOccupiedArea(e.module_quantity),
    potencia_total:    e.total_installed_power != null ? `${e.total_installed_power} kWp` : '',
    kwp:               String(e.total_installed_power ?? ''),
    ...estimatedGenerationValues(e),
    data:              today,
    data_emissao:      today,
    data_atual:        today,
    data_mais_30:      datePlusDays(30),
    data_criacao:      project.created_at ? format(new Date(project.created_at), 'dd/MM/yyyy', { locale: ptBR }) : today,
  };
}
