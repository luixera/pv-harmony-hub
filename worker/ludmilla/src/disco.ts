import { statfs } from 'node:fs/promises';

/**
 * Quanto disco a máquina tem. Serve ao painel de monitoramento e, depois, à
 * checagem de espaço antes de uma importação grande da BDGD.
 *
 * A aritmética fica em `medidaDe`, separada da leitura do sistema de
 * arquivos, porque é ela que tem como errar — e assim dá para testar sem
 * depender do disco de quem roda o teste.
 */

export interface MedidaDisco {
  totalBytes: number;
  usadoBytes: number;
  livreBytes: number;
  /** Percentual usado, uma casa decimal. */
  ocupacaoPct: number;
}

/** `bavail` e não `bfree`: o espaço reservado ao root não é nosso. */
export function medidaDe(st: { bsize: number; blocks: number; bavail: number }): MedidaDisco {
  const totalBytes = st.bsize * st.blocks;
  const livreBytes = st.bsize * st.bavail;
  const usadoBytes = totalBytes - livreBytes;
  const ocupacaoPct = totalBytes > 0
    ? Math.round((usadoBytes / totalBytes) * 1000) / 10
    : 0;
  return { totalBytes, usadoBytes, livreBytes, ocupacaoPct };
}

export async function lerDisco(caminho = '/'): Promise<MedidaDisco> {
  const st = await statfs(caminho);
  return medidaDe({
    bsize: Number(st.bsize),
    blocks: Number(st.blocks),
    bavail: Number(st.bavail),
  });
}
