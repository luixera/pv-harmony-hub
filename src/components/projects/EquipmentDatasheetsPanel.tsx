import { useState } from 'react';
import { FileText, CheckCircle2, AlertCircle, Loader2, Wand2 } from 'lucide-react';
import { EquipmentCatalogItem, getEquipmentDocUrl, useSaveEquipment } from '@/hooks/useEquipmentCatalog';
import { useDatasheetExtract } from '@/hooks/useDatasheetExtract';

/**
 * Datasheets do projeto, na aba Unifilar: mostra QUAL item do catálogo o motor
 * encontrou pro módulo e pro inversor, quais dados técnicos já estão
 * preenchidos e dá acesso aos documentos (datasheet, INMETRO, AFCI).
 *
 * Existe porque o datasheet costuma chegar DEPOIS do projeto (na conferência),
 * e até então não havia como saber, olhando a aba, se o motor estava usando o
 * datasheet real ou os valores-padrão das regras — o aviso genérico
 * "equipamento sem datasheet completo" não dizia de qual equipamento falava
 * nem o que faltava (pedido do usuário, ago/2026).
 */

/** Campos que o motor usa de cada tipo — o que falta aparece como pendência. */
const CAMPOS: Record<'module' | 'inverter', { chave: string; rotulo: string }[]> = {
  module: [
    { chave: 'voc_v', rotulo: 'Voc' },
    { chave: 'vmp_v', rotulo: 'Vmp' },
    { chave: 'isc_a', rotulo: 'Isc' },
    { chave: 'imp_a', rotulo: 'Imp' },
  ],
  inverter: [
    { chave: 'mppt_count', rotulo: 'MPPTs' },
    { chave: 'strings_per_mppt', rotulo: 'strings/MPPT' },
    { chave: 'mppt_vmin_v', rotulo: 'V mín. MPPT' },
    { chave: 'mppt_vmax_v', rotulo: 'V máx. MPPT' },
    { chave: 'max_dc_voltage_v', rotulo: 'V CC máx.' },
    { chave: 'max_mppt_current_a', rotulo: 'I máx./MPPT' },
    { chave: 'max_ac_current_a', rotulo: 'I CA saída' },
    { chave: 'ac_phases', rotulo: 'fases CA' },
  ],
};

const DOCS: { campo: keyof EquipmentCatalogItem; rotulo: string }[] = [
  { campo: 'datasheet_url', rotulo: 'Datasheet' },
  { campo: 'inmetro_url', rotulo: 'INMETRO' },
  { campo: 'afci_url', rotulo: 'AFCI' },
];

function LinhaEquipamento({
  titulo, tipo, item, descricaoProjeto,
}: {
  titulo: string;
  tipo: 'module' | 'inverter';
  item: EquipmentCatalogItem | null;
  descricaoProjeto: string;
}) {
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [recado, setRecado] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const extrair = useDatasheetExtract();
  const salvar = useSaveEquipment();
  const specs = item?.tech_specs ?? null;
  const preenchidos = CAMPOS[tipo].filter(c => {
    const v = specs?.[c.chave];
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  });
  const faltando = CAMPOS[tipo].filter(c => !preenchidos.includes(c));
  const completo = item != null && faltando.length === 0;

  const abrir = async (caminho: string, rotulo: string) => {
    setAbrindo(rotulo);
    try {
      const url = await getEquipmentDocUrl(caminho);
      if (url) window.open(url, '_blank', 'noopener');
    } finally { setAbrindo(null); }
  };

  /**
   * Lê o datasheet anexado e grava os dados que faltam no catálogo. Fica aqui,
   * e não só no cadastro do equipamento, porque é AQUI que o projetista
   * descobre o que falta — mandá-lo a outra tela para digitar 4 números que já
   * estão no PDF é exatamente o atrito que o motor deveria eliminar.
   *
   * Só COMPLETA: o que já estava preenchido à mão prevalece sobre a leitura.
   */
  const lerDoDatasheet = async () => {
    if (!item?.datasheet_url) return;
    setRecado(null);
    try {
      const r = await extrair.mutateAsync({
        type: tipo,
        brand: item.brand,
        model: item.model,
        power: item.power,
        datasheetPath: item.datasheet_url,
      });
      const mesclado: Record<string, number> = { ...r.specs, ...(item.tech_specs ?? {}) };
      await salvar.mutateAsync({
        id: item.id, type: tipo, brand: item.brand, model: item.model, power: item.power,
        datasheet_url: item.datasheet_url, inmetro_url: item.inmetro_url, afci_url: item.afci_url,
        tech_specs: mesclado,
      });
      const novos = Object.keys(r.specs).filter(k => (item.tech_specs ?? {})[k] == null);
      setRecado({
        tom: 'ok',
        texto: `${novos.length} campo(s) preenchido(s)${r.coluna ? ` — ${r.coluna}` : ''}.`
          + (r.warnings.length > 0 ? ` ⚠ ${r.warnings[0]}` : ''),
      });
    } catch (e) {
      setRecado({ tom: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível ler o datasheet' });
    }
  };
  const lendo = extrair.isPending || salvar.isPending;

  return (
    <div style={{ padding: '7px 0', borderTop: '1px solid #F0F0F0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {completo
          ? <CheckCircle2 size={13} style={{ color: '#0F6E56', flexShrink: 0 }} />
          : <AlertCircle size={13} style={{ color: '#B8860B', flexShrink: 0 }} />}
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#555' }}>{titulo}:</span>
        <span style={{ fontSize: 11.5, color: '#333' }}>
          {item ? `${item.brand} ${item.model}` : (descricaoProjeto || '—')}
        </span>
        {!item && (
          <span style={{ fontSize: 10.5, color: '#B8860B' }}>
            não encontrado no catálogo
          </span>
        )}
      </div>

      {item && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3, paddingLeft: 19 }}>
          <span style={{ fontSize: 10.5, color: completo ? '#0F6E56' : '#777' }}>
            {preenchidos.length} de {CAMPOS[tipo].length} dados técnicos
          </span>
          {faltando.length > 0 && (
            <span style={{ fontSize: 10.5, color: '#B8860B' }}>
              falta: {faltando.map(f => f.rotulo).join(', ')}
            </span>
          )}
          {faltando.length > 0 && item.datasheet_url && (
            <button
              onClick={lerDoDatasheet}
              disabled={lendo}
              title="Lê o datasheet anexado e preenche os dados que faltam"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 5,
                border: '1px solid #C9E3D5', background: '#F1FAF5', color: '#0F6E56',
                fontSize: 10.5, fontWeight: 700, cursor: lendo ? 'default' : 'pointer', opacity: lendo ? 0.6 : 1,
              }}
            >
              {lendo ? <Loader2 size={9} className="animate-spin" /> : <Wand2 size={9} />}
              {lendo ? 'lendo…' : 'preencher pelo datasheet'}
            </button>
          )}
          {DOCS.map(d => {
            const caminho = item[d.campo] as string | null;
            if (!caminho) return null;
            return (
              <button
                key={d.rotulo}
                onClick={() => abrir(caminho, d.rotulo)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 5,
                  border: '1px solid #DDE7F0', background: '#F5F9FC', color: '#185FA5',
                  fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {abrindo === d.rotulo ? <Loader2 size={9} className="animate-spin" /> : <FileText size={9} />}
                {d.rotulo}
              </button>
            );
          })}
        </div>
      )}

      {recado && (
        <p style={{
          fontSize: 10.5, margin: '3px 0 0', paddingLeft: 19,
          color: recado.tom === 'ok' ? '#0F6E56' : '#B3261E',
        }}>
          {recado.texto}
        </p>
      )}
    </div>
  );
}

export function EquipmentDatasheetsPanel({
  moduleItem, inverterItem, moduleLabel, inverterLabel,
}: {
  moduleItem: EquipmentCatalogItem | null;
  inverterItem: EquipmentCatalogItem | null;
  moduleLabel: string;
  inverterLabel: string;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #DDEEE2', borderRadius: 8, padding: '9px 12px' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
        Datasheets usados nas sugestões
      </p>
      <p style={{ fontSize: 10.5, color: '#999', margin: '2px 0 2px' }}>
        Relido do Catálogo de Equipamentos toda vez que esta aba é aberta.
      </p>
      <LinhaEquipamento titulo="Módulo" tipo="module" item={moduleItem} descricaoProjeto={moduleLabel} />
      <LinhaEquipamento titulo="Inversor" tipo="inverter" item={inverterItem} descricaoProjeto={inverterLabel} />
    </div>
  );
}
