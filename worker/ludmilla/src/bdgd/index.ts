import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { supabase, reportarDisco } from '../fila.js';
import { acharItem, baixarEExtrair } from './catalogo.js';
import { extrair } from './extrair.js';
import { lerCsv, montarTrafos, enviarEmLotes } from './carregar.js';

/**
 * Ingestão da BDGD de uma distribuidora, ponta a ponta.
 *
 * Roda FORA do laço da Ludmilla (`npm run bdgd`), porque é um trabalho de
 * minutos que não pode travar o robô dos portais. O disco é reportado em cada
 * etapa com `reportarDisco('ingestao', etapa)` — a função já existe do plano
 * do painel de armazenamento, e o `'ingestao'` já estava previsto nela.
 *
 * A auditoria em `rede_importacao` não é enfeite: é dela que a tela tira o
 * rótulo de data-base e idade do dado, que é a principal proteção contra a
 * leitura otimista do semáforo (opção B da spec).
 */
export async function ingerir(sigla: string): Promise<void> {
  const sb = supabase();
  const item = await acharItem(sigla);
  console.log(`[bdgd] ${item.sigla} · data-base ${item.dataBase} · ${(item.bytesZip / 1024 ** 3).toFixed(2)} GB`);

  // A BDGD é ANUAL (data-base 31/12, publicada no meio do ano seguinte). Rodar
  // isto por cron mensal só faz sentido se o caminho comum for sair sem fazer
  // nada: baixar 1,2 GB para reimportar o que já está carregado é desperdício
  // de banda, de disco e de tempo da VPS.
  const { data: atual } = await sb.from('rede_distribuidora')
    .select('data_base').eq('sigla', item.sigla).maybeSingle();
  if (atual?.data_base === item.dataBase) {
    console.log(`[bdgd] ${item.sigla} ja esta na data-base ${item.dataBase}; nada a fazer.`);
    return;
  }

  // A distribuidora precisa existir antes da importação apontar para ela.
  const { data: dist, error: eDist } = await sb
    .from('rede_distribuidora')
    .upsert({ sigla: item.sigla, nome: item.sigla.replace(/_/g, ' '),
              codigo_aneel: item.codigoAneel, uf: 'SP', data_base: item.dataBase },
            { onConflict: 'sigla' })
    .select('id').single();
  if (eDist || !dist) throw new Error(`Nao consegui registrar a distribuidora: ${eDist?.message}`);

  const { data: imp, error: eImp } = await sb
    .from('rede_importacao')
    .insert({ distribuidora_id: dist.id, data_base: item.dataBase,
              arquivo_origem: item.titulo, etapa: 'baixando', situacao: 'rodando' })
    .select('id').single();
  if (eImp || !imp) throw new Error(`Nao consegui abrir a importacao: ${eImp?.message}`);

  const dir = join(tmpdir(), `bdgd-${item.sigla}-${imp.id}`);
  const marcar = async (etapa: string) => {
    await sb.from('rede_importacao').update({ etapa }).eq('id', imp.id);
    await reportarDisco('ingestao', etapa);
  };

  try {
    await marcar('baixando');
    const gdb = await baixarEExtrair(item, dir);

    await marcar('extraindo');
    const { data: jan } = await sb.rpc('rede_janela_geracao' as never);
    const janela = Array.isArray(jan) && jan[0]
      ? { inicio: Number(jan[0].inicio), fim: Number(jan[0].fim) }
      : { inicio: 9, fim: 15 };
    const csv = await extrair(gdb, join(dir, 'csv'), janela);

    await marcar('carregando');
    const subs = lerCsv(await readFile(csv.subestacoes, 'utf8')).map(s => ({
      importacao_id: imp.id, codigo: s.COD_ID, nome: s.NOME || null,
      lng: Number(s.lng), lat: Number(s.lat),
    }));
    const cargaPorAlim = new Map(lerCsv(await readFile(csv.cargaAlim, 'utf8'))
      .map(x => [x.alimentador, x.carga_min_diurna_kw]));
    const gdPorAlim = new Map(lerCsv(await readFile(csv.gdAlim, 'utf8'))
      .map(x => [x.alimentador, x.gd_kw]));
    const n2 = (v: string | undefined) => {
      if (v === undefined || v.trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    const alims = lerCsv(await readFile(csv.alimentadores, 'utf8')).map(a => ({
      importacao_id: imp.id, codigo: a.COD_ID, subestacao_codigo: a.SUB || null,
      // tensao_kv fica nula de proposito: TEN_NOM e codigo de dominio, nao kV.
      tensao_kv: null,
      carga_min_diurna_kw: n2(cargaPorAlim.get(a.COD_ID)),
      // GD ausente e zero de verdade: ninguem conectou nada neste alimentador.
      gd_conectada_kw: n2(gdPorAlim.get(a.COD_ID)) ?? 0,
    }));
    const trafos = montarTrafos(
      lerCsv(await readFile(csv.trafos, 'utf8')),
      lerCsv(await readFile(csv.carga, 'utf8')),
      lerCsv(await readFile(csv.gd, 'utf8')),
    ).map(t => ({ importacao_id: imp.id, ...t }));

    console.log(`[bdgd] ${subs.length} subestacoes · ${alims.length} alimentadores · ${trafos.length} trafos`);
    await enviarEmLotes('rede_stg_subestacao', subs);
    await enviarEmLotes('rede_stg_alimentador', alims);
    await enviarEmLotes('rede_stg_transformador', trafos);

    await marcar('promovendo');
    const { data: prom, error: eProm } = await sb
      .rpc('rede_importacao_promover' as never, { p_importacao_id: imp.id } as never);
    if (eProm) throw new Error(`Promocao falhou: ${eProm.message}`);
    console.log('[bdgd] promovido:', prom);

    // A faxina do staging e nossa, nao da funcao de promocao: ela garante que
    // o mapa nunca fica meio-carregado, e isso ja aconteceu. Se um destes
    // deletes falhar, as linhas ficam orfas e inofensivas — o ON DELETE
    // CASCADE as leva quando a importacao for removida.
    for (const t of ['rede_stg_transformador', 'rede_stg_alimentador', 'rede_stg_subestacao']) {
      const { error } = await sb.from(t).delete().eq('importacao_id', imp.id);
      if (error) console.warn(`[bdgd] staging ${t} nao limpou: ${error.message}`);
    }

    // O veredito e derivado, nunca importado: recalcular fecha a ingestao.
    await marcar('recalculando');
    const { data: semaforo } = await sb.rpc('grid_capacity_recalcular' as never);
    const { data: celulas } = await sb.rpc('rede_celula_recalcular' as never);
    console.log('[bdgd] semaforo:', semaforo, '| celulas:', celulas);

    await reportarDisco('ingestao', 'concluida');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('rede_importacao')
      .update({ situacao: 'falhou', erro: msg, concluido_em: new Date().toISOString() })
      .eq('id', imp.id);
    throw e;
  } finally {
    // O extraído são gigabytes: sai do disco mesmo quando a ingestão falha.
    await rm(dir, { recursive: true, force: true });
    await reportarDisco('ingestao', 'limpeza');
  }
}

const sigla = process.argv[2];
if (!sigla) {
  console.error('uso: npm run bdgd -- CPFL_Piratininga');
  process.exit(1);
}
ingerir(sigla).then(
  () => { console.log('[bdgd] fim'); process.exit(0); },
  e => { console.error('[bdgd] falhou:', e); process.exit(1); },
);
