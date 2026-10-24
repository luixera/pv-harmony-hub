import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FiltroDaCaixa, SituacaoDoFiltro, TipoDoFiltro } from '@/lib/ludmillaCaixa';

const SITUACOES: [SituacaoDoFiltro, string][] = [
  ['pendente', 'Pendentes'], ['aplicada', 'Aplicadas'], ['ignorada', 'Ignoradas'], ['todas', 'Todas'],
];
const TIPOS: [TipoDoFiltro, string][] = [
  ['etapa', 'Mudar etapa'], ['protocolo', 'Gravar protocolo'], ['bloqueado', 'Bloqueados'], ['afazer', 'A fazer'],
];

/** Busca, situação (uma) e tipos (vários: qualquer um deles) — spec §3.2. */
export function FiltrosDaCaixa({ filtro, onFiltro }: { filtro: FiltroDaCaixa; onFiltro: (f: FiltroDaCaixa) => void }) {
  const alternar = (t: TipoDoFiltro) => onFiltro({
    ...filtro, tipos: filtro.tipos.includes(t) ? filtro.tipos.filter(x => x !== t) : [...filtro.tipos, t],
  });
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search" value={filtro.busca} onChange={e => onFiltro({ ...filtro, busca: e.target.value })}
          placeholder="Buscar projeto, titular, empresa ou protocolo" aria-label="Buscar" className="pl-8"
        />
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {SITUACOES.map(([v, r]) => (
          <Button key={v} size="sm" className="shrink-0" variant={filtro.situacao === v ? 'default' : 'ghost'}
            aria-pressed={filtro.situacao === v} onClick={() => onFiltro({ ...filtro, situacao: v })}>{r}</Button>
        ))}
        <span className="mx-1 hidden w-px self-stretch bg-border sm:block" aria-hidden />
        {TIPOS.map(([v, r]) => (
          <Button key={v} size="sm" className="shrink-0" variant={filtro.tipos.includes(v) ? 'secondary' : 'outline'}
            aria-pressed={filtro.tipos.includes(v)} onClick={() => alternar(v)}>{r}</Button>
        ))}
      </div>
    </div>
  );
}
