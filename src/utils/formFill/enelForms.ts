import { MapaFormulario } from './fillPdf';

/**
 * Mapas de coordenadas dos formulários da ENEL (Anexo 1 e Anexo 4).
 *
 * As posições NÃO foram medidas à mão: saíram dos próprios rótulos do PDF,
 * extraídos com pdfjs (`x + largura do rótulo + folga`, mesma linha de base).
 * O que sobrou de manual foram as caixas de seleção e as células das tabelas,
 * que não têm rótulo terminado em dois-pontos.
 *
 * Eixo Y do PDF: origem no canto INFERIOR esquerdo, cresce para cima.
 *
 * Ao trocar a versão do formulário, REGERAR o mapa em vez de corrigir número
 * a número — o script está em `scripts/mapear-formulario.mjs`.
 */

/** Anexo 1 — Formulário de solicitação de acesso (595,3 × 841,9 pt). */
export const ANEXO1_ENEL: MapaFormulario = {
  nome: 'ENEL — Anexo 1 (Solicitação de Acesso)',
  campos: [
    // 1 – Identificação da Unidade Consumidora
    { chave: 'uc', x: 99.1, y: 758.6, larguraMax: 196 },
    { chave: 'classe', x: 338.2, y: 758.6, larguraMax: 200 },
    { chave: 'titular', x: 97.1, y: 744.7, larguraMax: 455 },
    { chave: 'logradouro', x: 74.5, y: 730.8, larguraMax: 222 },
    { chave: 'numero', x: 322.1, y: 730.8, larguraMax: 85 },
    { chave: 'cep', x: 437.0, y: 730.8, larguraMax: 115 },
    { chave: 'bairro', x: 66.5, y: 716.9, larguraMax: 230 },
    { chave: 'cidade', x: 341.1, y: 716.9, larguraMax: 210 },
    { chave: 'email', x: 67.1, y: 702.9, larguraMax: 480 },
    // o "(" e o ")" do DDD já estão impressos: o valor entra depois do ")"
    { chave: 'telefone', x: 107.0, y: 689.0, larguraMax: 190 },
    { chave: 'celular', x: 366.0, y: 689.0, larguraMax: 185 },
    { chave: 'cpf_cnpj', x: 82.2, y: 675.1, larguraMax: 460 },
    // 2 – Dados da Unidade Consumidora
    { chave: 'potencia_disponibilizada', x: 144.8, y: 647.3, larguraMax: 150 },
    { chave: 'tensao_atendimento', x: 432.0, y: 647.3, larguraMax: 118 },
    // 3 – Dados da Geração
    { chave: 'potencia_geracao_kw', x: 196.5, y: 550.1, larguraMax: 340 },
    // 6 – Solicitante
    { chave: 'solicitante_nome', x: 146.3, y: 205.9, larguraMax: 400 },
    { chave: 'solicitante_telefone', x: 78.4, y: 192.5, larguraMax: 400 },
    { chave: 'solicitante_email', x: 67.1, y: 179.1, larguraMax: 400 },
  ],
  marcas: [
    // Tipo de conexão — a caixa fica à ESQUERDA do texto da opção
    { chave: 'tipo_conexao', quando: 'monofasica', x: 182.0, y: 632.3 },
    { chave: 'tipo_conexao', quando: 'bifasica', x: 291.0, y: 632.3 },
    { chave: 'tipo_conexao', quando: 'trifasica', x: 432.0, y: 633.3 },
    // Tipo de solicitação (3 linhas)
    { chave: 'tipo_solicitacao', quando: 'nova', x: 40.0, y: 604.9 },
    { chave: 'tipo_solicitacao', quando: 'existente_sem_aumento', x: 40.0, y: 591.4 },
    { chave: 'tipo_solicitacao', quando: 'existente_com_aumento', x: 40.0, y: 578.0 },
    // Fonte de geração
    { chave: 'fonte_geracao', quando: 'hidraulica', x: 20.0, y: 522.2 },
    { chave: 'fonte_geracao', quando: 'solar', x: 123.5, y: 523.3 },
    { chave: 'fonte_geracao', quando: 'eolica', x: 207.5, y: 522.2 },
    { chave: 'fonte_geracao', quando: 'biomassa', x: 291.0, y: 522.2 },
    { chave: 'fonte_geracao', quando: 'cogeracao', x: 400.8, y: 522.2 },
  ],
};

/** Anexo 4 — Dados da unidade acessante (595 × 842 pt). */
export const ANEXO4_ENEL: MapaFormulario = {
  nome: 'ENEL — Anexo 4 (Dados da Unidade Acessante)',
  campos: [
    // 1 – Identificação do Consumidor
    { chave: 'titular', x: 215.6, y: 703.5, larguraMax: 330 },
    { chave: 'logradouro', x: 161.2, y: 689.6, larguraMax: 245 },
    { chave: 'numero', x: 413.8, y: 689.6, larguraMax: 45 },
    { chave: 'cep', x: 466.0, y: 689.6, larguraMax: 80 },
    { chave: 'bairro', x: 153.1, y: 675.7, larguraMax: 225 },
    { chave: 'cidade', x: 388.0, y: 675.7, larguraMax: 160 },
    { chave: 'email', x: 153.7, y: 661.7, larguraMax: 390 },
    { chave: 'telefone', x: 193.0, y: 647.7, larguraMax: 165 },
    { chave: 'celular', x: 390.0, y: 647.7, larguraMax: 155 },
    { chave: 'cpf_cnpj', x: 168.8, y: 633.8, larguraMax: 375 },
    // 2 – Representante Técnico
    { chave: 'rt_nome', x: 191.8, y: 606.0, larguraMax: 350 },
    { chave: 'rt_logradouro', x: 161.2, y: 592.1, larguraMax: 245 },
    { chave: 'rt_numero', x: 413.8, y: 592.1, larguraMax: 45 },
    { chave: 'rt_cep', x: 466.0, y: 592.1, larguraMax: 80 },
    { chave: 'rt_bairro', x: 153.1, y: 578.1, larguraMax: 225 },
    { chave: 'rt_cidade', x: 388.0, y: 578.1, larguraMax: 160 },
    { chave: 'rt_email', x: 153.7, y: 564.2, larguraMax: 390 },
    { chave: 'rt_telefone', x: 193.0, y: 550.3, larguraMax: 165 },
    { chave: 'rt_celular', x: 390.0, y: 550.3, larguraMax: 155 },
    { chave: 'rt_cpf_cnpj', x: 168.8, y: 536.4, larguraMax: 375 },
    // 3 – Dados da geração: potência ao lado da caixa marcada
    { chave: 'potencia_geracao_kw', x: 206.0, y: 495.1, larguraMax: 30 },
    // Localização geográfica
    { chave: 'endereco_completo', x: 168.0, y: 369.9, larguraMax: 375 },
    { chave: 'latitude', x: 162.6, y: 356.4, larguraMax: 120 },
    { chave: 'longitude', x: 342.0, y: 356.4, larguraMax: 155 },
    { chave: 'elevacao', x: 509.1, y: 356.4, larguraMax: 35 },
    // Tabela do inversor (linha de dados logo abaixo do cabeçalho)
    { chave: 'inv_fabricante', x: 172.0, y: 286.3, tamanho: 7, larguraMax: 58 },
    { chave: 'inv_modelo', x: 232.0, y: 286.3, tamanho: 7, larguraMax: 46 },
    { chave: 'inv_potencia_kw', x: 285.0, y: 286.3, tamanho: 7, larguraMax: 38 },
    { chave: 'inv_fator_potencia', x: 333.0, y: 286.3, tamanho: 7, larguraMax: 42 },
    { chave: 'inv_faixa_tensao', x: 381.0, y: 286.3, tamanho: 6, larguraMax: 100 },
    { chave: 'inv_faixa_frequencia', x: 487.0, y: 286.3, tamanho: 6, larguraMax: 58 },
    // Tabela dos módulos
    { chave: 'mod_subpaineis', x: 200.0, y: 215.3, tamanho: 7, larguraMax: 50 },
    { chave: 'mod_quantidade', x: 272.0, y: 215.3, tamanho: 7, larguraMax: 46 },
    { chave: 'mod_modelo', x: 320.0, y: 215.3, tamanho: 6, larguraMax: 66 },
    { chave: 'mod_potencia_unitaria_kw', x: 405.0, y: 215.3, tamanho: 7, larguraMax: 58 },
    { chave: 'mod_potencia_total_kw', x: 490.0, y: 215.3, tamanho: 7, larguraMax: 58 },
  ],
  marcas: [
    // Micro (≤75kW) ou minigeração — a caixa é o "[ ]" já impresso
    { chave: 'porte_geracao', quando: 'micro', x: 192.0, y: 495.1 },
    { chave: 'porte_geracao', quando: 'mini', x: 431.0, y: 495.1 },
    // Fonte
    { chave: 'fonte_geracao', quando: 'hidraulica', x: 172.0, y: 427.7 },
    { chave: 'fonte_geracao', quando: 'solar', x: 278.0, y: 427.7 },
    { chave: 'fonte_geracao', quando: 'eolica', x: 410.0, y: 427.7 },
    { chave: 'fonte_geracao', quando: 'biomassa', x: 522.0, y: 427.7 },
    { chave: 'fonte_geracao', quando: 'cogeracao', x: 227.0, y: 414.3 },
    // Tensão de conexão
    { chave: 'tensao_conexao', quando: '120/208V', x: 268.0, y: 397.8 },
    { chave: 'tensao_conexao', quando: '127/220V', x: 336.0, y: 397.8 },
    { chave: 'tensao_conexao', quando: '120/240V', x: 404.0, y: 397.8 },
    { chave: 'tensao_conexao', quando: '13,8kV', x: 461.0, y: 397.8 },
  ],
};

/**
 * De-para entre as VARIÁVEIS DO PROJETO (as mesmas tags `{chave}` usadas nos
 * templates .docx) e os campos dos formulários da ENEL.
 *
 * Existe para os mapas acima ficarem legíveis — cada campo do PDF tem o nome
 * do que ele é no formulário, não o nome da variável interna — e para derivar
 * as escolhas que o formulário pede em caixinha (fonte, porte, tipo de
 * conexão), que não são campos do projeto e sim conclusões sobre ele.
 */
export function valoresFormularioEnel(v: Record<string, string>): Record<string, string> {
  const num = (s?: string) => Number(String(s ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const potenciaKwp = num(v.potencia_total || v.kwp);
  const fases = (v.tipo_fase || v.fase || '').toLowerCase();

  return {
    // ── identificação ──────────────────────────────────────────────────────
    uc: v.uc || v.numero_uc || '',
    titular: v.nome_titular || '',
    cpf_cnpj: v.cpf_cnpj || '',
    classe: v.classe_padrao || '',
    logradouro: v.endereco_rua || v.endereco || '',
    numero: v.endereco_numero || '',
    cep: v.endereco_cep || v.cep || '',
    bairro: v.endereco_bairro || v.bairro || '',
    cidade: [v.endereco_cidade || v.cidade, v.endereco_estado || v.uf].filter(Boolean).join('/'),
    email: v.email_titular || '',
    telefone: v.telefone_titular || '',
    endereco_completo: v.endereco_completo || v.endereco || '',
    latitude: v.latitude_gms || v.latitude || '',
    longitude: v.longitude_gms || v.longitude || '',
    // Fixa por decisão do usuário (ago/2026): a ENEL pede a elevação e o
    // cadastro não tem esse dado; 870 m é o valor adotado.
    elevacao: '870',

    // ── unidade consumidora ────────────────────────────────────────────────
    potencia_disponibilizada: v.disjuntor_padrao || v.disjuntor || '',
    tensao_atendimento: v.tensao_conexao || '',
    tensao_conexao: v.tensao_conexao || '',
    // monofásico/bifásico/trifásico → a opção marcada no formulário
    tipo_conexao: /tri/.test(fases) ? 'trifasica' : /bi/.test(fases) ? 'bifasica' : 'monofasica',
    // conexão em UC existente é o caso comum; obra nova é a exceção
    tipo_solicitacao: 'existente_sem_aumento',

    // ── geração ────────────────────────────────────────────────────────────
    potencia_geracao_kw: v.potencia_total || '',
    fonte_geracao: 'solar',
    // a ENEL separa em micro (≤75 kW) e minigeração
    porte_geracao: potenciaKwp > 75 ? 'mini' : 'micro',

    // ── responsável técnico / solicitante ──────────────────────────────────
    rt_nome: v.responsavel_tecnico || '',
    solicitante_nome: v.responsavel_tecnico || v.empresa || '',
    solicitante_email: v.email_titular || '',
    solicitante_telefone: v.telefone_titular || '',

    // ── equipamentos (tabelas do Anexo 4) ──────────────────────────────────
    inv_fabricante: v.marca_inversor || '',
    inv_modelo: v.modelo_inversor || '',
    inv_potencia_kw: v.potencia_inversor || '',
    mod_quantidade: v.qtd_modulos || '',
    mod_modelo: v.modelo_modulo || '',
    mod_potencia_unitaria_kw: v.potencia_modulo ? (num(v.potencia_modulo) / 1000).toFixed(3) : '',
    mod_potencia_total_kw: v.potencia_total || '',

    // ── planilha de registro ───────────────────────────────────────────────
    empresa_nome: v.empresa || '',
    grupo: 'B',
    disjuntor: v.disjuntor_padrao || v.disjuntor || '',
    logradouro_completo: v.endereco || '',
    municipio_uf: [v.endereco_cidade || v.cidade, v.endereco_estado || v.uf].filter(Boolean).join('-'),
    tipo_solicitacao_planilha: 'Nova',
    mod_fabricante: v.marca_modulo || '',
    area_arranjos: v.area_ocupada || '',
    inv_quantidade: v.qtd_inversores || '',
    potencia_modulos_kw: v.potencia_total || '',
    potencia_inversores_kw: v.potencia_inversores || v.potencia_inversor || '',
    data_conexao: v.data || v.data_atual || '',
  };
}
