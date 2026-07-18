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
  { key: 'endereco',          desc: 'Endereço (rua e número)',           category: 'Endereço e UC', example: 'RUA DAS FLORES, 123' },
  { key: 'cidade',            desc: 'Cidade',                            category: 'Endereço e UC', example: 'CAMPINAS' },
  { key: 'estado',            desc: 'Estado (UF)',                       category: 'Endereço e UC', example: 'SP' },
  { key: 'uf',                desc: 'Estado (UF) — alias de {estado}',   category: 'Endereço e UC', example: 'SP' },
  { key: 'cep',               desc: 'CEP',                               category: 'Endereço e UC', example: '13000-000' },
  { key: 'endereco_completo', desc: 'Endereço completo (rua, cidade/UF, CEP)', category: 'Endereço e UC', example: 'RUA DAS FLORES, 123, CAMPINAS, SP, CEP: 13000-000' },
  { key: 'coordenadas',       desc: 'Coordenadas geográficas (como digitadas)', category: 'Endereço e UC', example: '-22.9099, -47.0626' },
  { key: 'latitude',          desc: 'Latitude (grau decimal)',           category: 'Endereço e UC', example: '-22.9099' },
  { key: 'longitude',         desc: 'Longitude (grau decimal)',          category: 'Endereço e UC', example: '-47.0626' },
  { key: 'latitude_gms',      desc: 'Latitude em SIRGAS 2000 (grau/min/seg)',  category: 'Endereço e UC', example: '22°54\'35.6"S' },
  { key: 'longitude_gms',     desc: 'Longitude em SIRGAS 2000 (grau/min/seg)', category: 'Endereço e UC', example: '47°03\'45.4"O' },
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
  { key: 'kwp',               desc: 'Potência total (só o número)',      category: 'Equipamentos', example: '6' },
  // Padrão de entrada (regras da concessionária, resolvidas por fase + disjuntor)
  { key: 'categoria_padrao',  desc: 'Categoria do padrão de entrada',    category: 'Padrão de entrada', example: 'B1' },
  { key: 'num_fases_padrao',  desc: 'Nº de fases do padrão',             category: 'Padrão de entrada', example: '2' },
  { key: 'bitola_cabo',       desc: 'Bitola dos cabos de entrada',       category: 'Padrão de entrada', example: '16 mm²' },
  { key: 'disjuntor_padrao',  desc: 'Disjuntor de entrada do padrão',    category: 'Padrão de entrada', example: '63A' },
  { key: 'classe_padrao',     desc: 'Classe do padrão de entrada',       category: 'Padrão de entrada', example: 'BIFÁSICO' },
  { key: 'caixa_medicao',     desc: 'Caixa de medição',                  category: 'Padrão de entrada', example: 'TIPO II' },
  // Datas
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

/** Variáveis derivadas de coordenadas (decimais + SIRGAS/DMS). */
export function coordinateValues(raw: string | null | undefined): Record<string, string> {
  const { lat, lon } = parseCoordinates(raw);
  return {
    latitude:      lat != null ? String(lat) : '',
    longitude:     lon != null ? String(lon) : '',
    latitude_gms:  lat != null ? decimalToDMS(lat, 'lat') : '',
    longitude_gms: lon != null ? decimalToDMS(lon, 'lon') : '',
  };
}

/** Mapa de tags → valores do projeto, usado para preencher templates .docx. */
export function buildProjectValues(project: ProjectWithDetails): Record<string, string> {
  const g = project.generalData ?? ({} as NonNullable<ProjectWithDetails['generalData']>);
  const e = project.equipment ?? ({} as NonNullable<ProjectWithDetails['equipment']>);
  const today = format(new Date(), 'dd/MM/yyyy', { locale: ptBR });

  const endereco_completo = [
    g.address, g.city, g.state, g.cep ? `CEP: ${g.cep}` : '',
  ].filter(Boolean).join(', ');

  return {
    codigo_projeto:    project.code ?? '',
    empresa:           project.companyName ?? '',
    concessionaria:    project.concessionaireName ?? g.utility_company ?? '',
    nome_titular:      g.holder_name ?? '',
    cpf_cnpj:          g.holder_cpf_cnpj ?? '',
    email_titular:     g.holder_email ?? '',
    telefone_titular:  g.holder_phone ?? '',
    endereco:          g.address ?? '',
    cidade:            g.city ?? '',
    estado:            g.state ?? '',
    uf:                g.state ?? '',
    cep:               g.cep ?? '',
    endereco_completo,
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
    data:              today,
    data_emissao:      today,
    data_atual:        today,
    data_mais_30:      datePlusDays(30),
    data_criacao:      project.created_at ? format(new Date(project.created_at), 'dd/MM/yyyy', { locale: ptBR }) : today,
  };
}
