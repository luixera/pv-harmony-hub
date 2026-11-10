import { AvisoDeFalha } from '@/components/ludmilla/mundo/pecas';
import { LinhaDaCarteira, type DadosDaLinha } from './LinhaDaCarteira';

/** A carteira num filtro, na ordem de `ordenarCarteira` (quem chama já filtrou e ordenou). */
export function ListaDaCarteira({ linhas, aberta, onAbrir, erro, buscando, onTentar }: {
  linhas: DadosDaLinha[];
  aberta: string | null;
  onAbrir: (projectId: string) => void;
  erro: string | null;
  buscando: boolean;
  onTentar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5" data-lista="carteira">
      {erro !== null && <AvisoDeFalha oQue="a carteira" detalhe={erro || null} buscando={buscando} onTentar={onTentar} />}
      {linhas.map(l => (
        <LinhaDaCarteira key={l.projectId} dados={l} aberta={l.projectId === aberta} onAbrir={() => onAbrir(l.projectId)} />
      ))}
      {linhas.length === 0 && erro === null && <p className="m-0 text-sm text-lm-suave">Nenhum projeto neste filtro.</p>}
    </div>
  );
}
