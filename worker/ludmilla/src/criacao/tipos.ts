/** O que o formulário "60 - Microgeração Distribuída BT" da CPFL pede, já resolvido pelo banco. */
export interface DadosCriacaoCpfl {
  project_id: string;
  tenant_id: string;
  run_id: string;
  uc_number: string;
  coordinates: string;
  customer_name: string;
  customer_cpf: string;
  customer_email: string;
  customer_phone: string;
  project_title: string;
  is_rural: boolean;
  concessionaire: string;
  entry_phase: string | null;
  entry_breaker: string | null;
  modulo: { fabricante: string; modelo: string; quantidade: number; potencia_wp: number } | null;
  inversor: { fabricante: string; modelo: string; quantidade: number; potencia_kw: number } | null;
  /** padrão de entrada resolvido como no front (regra escolhida à mão > automática) */
  padrao: { categoria: string; num_fases: number | null; bitola: string | null; disjuntor: number | null; caixa: string | null; demanda_kw: string | null } | null;
  /**
   * Derivado no banco (v3, 22/10/2026): 'autoconsumo_remoto' se o projeto tem
   * beneficiárias, 'geracao_local' se não. Escolhido no portal PELO RÓTULO
   * (nunca pelo código numérico — regra aprendida a ferro em 16/09).
   */
  sistema_compensacao: 'autoconsumo_remoto' | 'geracao_local';
  /** Beneficiárias na ordem de cadastro: UC só dígitos e percentual (4 casas). A geradora fica com o resto. */
  beneficiarias: { uc: string; percentual: number }[];
  /** Respostas autônomas às escolhas do formulário; chave ausente = AUTONOMIA_PADRAO. */
  autonomia: Record<string, string>;
}

/** Como o portal rotula cada sistema de compensação (select "Sistema de Compensação", 21/10/2026). */
export const ROTULO_COMPENSACAO: Record<DadosCriacaoCpfl['sistema_compensacao'], string> = {
  autoconsumo_remoto: 'Microgeração Distribuída Caracterizada Como Autoconsumo Remoto',
  geracao_local:      'Microgeração Distribuída Com Geração Local',
};

/** O que a Ludmilla responde sozinha num projeto de GD comum (roteiro de 17/09/2026). */
export const AUTONOMIA_PADRAO: Record<string, string> = {
  opcao_orcamento:          'conexao',   // Orçamento de Conexão (não o Estimado)
  mais_de_um_medidor:       'nao',
  ramal_subterraneo:        'nao',
  medicao_no_poste:         'nao',
  mudanca_ponto_entrega:    'nao',
  extensao_fase:            'nao',
  alteracao_carga:          'nao',
  // Desde 22/10/2026 o sistema de compensação vem de `dados.sistema_compensacao`
  // (derivado das beneficiárias). Esta chave só vale se o front mandar
  // explicitamente em run.dados.autonomia — e aí é um rótulo ou código.
  sistema_compensacao:      '',
  outorga_registro:         'nao',
  padrao_entrada:           '2761',      // categoria – GED 13
  tipo_atendimento:         '2866',      // aéreo
  fonte_geradora:           '2721',      // ENERGIA SOLAR (bloco do projeto)
  fonte_geradora_geracao:   '651',       // ENERGIA SOLAR (bloco de geração)
  autoriza_documentos:      'sim',
  contagem_prazo_vistoria:  'sim',
  dias_para_ligacao:        '30',        // data prevista = hoje + N dias
  m2_por_modulo:            '3',         // área dos arranjos = módulos × N m²
};

/** Chaves de autonomia que respondem perguntas que só aparecem às vezes. */
export const PERGUNTAS_CONDICIONAIS = {
  ja_possui_projeto_aprovado: 'Já possui projeto aprovado?',
  uc_medidor_vizinho:         'Unidade Consumidora ou Medidor do Vizinho?',
} as const;

/** O mesmo User-Agent do contexto Playwright da varredura (index.ts → novoContexto). */
export const USER_AGENT_LUDMILLA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
