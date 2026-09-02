import { MapPin, Hash, FolderOpen } from 'lucide-react';
import { KanbanColumn } from '@/hooks/useKanbanConfig';
import { ProjectWithDetails } from '@/hooks/useProjects';

/**
 * Quadro Kanban SOMENTE LEITURA — o que a empresa integradora vê dos próprios
 * projetos (e o que o admin vê em "Ver como empresa").
 *
 * Por que não é o `ProjectsKanban`: aquele carrega arrastar-e-soltar, menu de
 * card com arquivar, atribuição de projetista, diálogo de protocolo e selos
 * internos ("dias parado", "sem valor"). Reaproveitá-lo exigiria desligar cada
 * uma dessas coisas para a empresa, e bastaria esquecer uma para vazar função
 * interna. Aqui não existe o que desligar.
 *
 * As colunas vêm do modelo de Kanban da empresa (ver `useCompanyKanbanModel`),
 * nunca de uma lista fixa: o que o cliente enxerga é o mesmo fluxo que a
 * equipe configurou.
 */
export function ReadOnlyKanbanBoard({
  projects,
  columns,
  onOpenProject,
}: {
  projects: ProjectWithDetails[];
  columns: KanbanColumn[];
  onOpenProject: (projectId: string) => void;
}) {
  // Projeto cujo status não existe mais no modelo não pode sumir da tela: cai
  // na primeira coluna, para o cliente nunca "perder" um projeto.
  const chaves = new Set(columns.map(c => c.status_key));
  const daColuna = (chave: string, indice: number) =>
    projects.filter(p =>
      p.status === chave || (indice === 0 && !chaves.has(p.status as string)),
    );

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((coluna, i) => {
        const doGrupo = daColuna(coluna.status_key, i);
        return (
          <div key={coluna.id} className="flex-shrink-0 w-[280px]">
            <div className="flex items-center gap-2 mb-3 px-1">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: coluna.color || '#CBD5E1' }}
              />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
                {coluna.status_label}
              </h3>
              <span className="ml-auto text-[11px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {doGrupo.length}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {doGrupo.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-8 text-center text-[11px] text-muted-foreground">
                  Nenhum projeto
                </div>
              ) : (
                doGrupo.map(projeto => (
                  <button
                    key={projeto.id}
                    onClick={() => onOpenProject(projeto.id)}
                    className="text-left bg-card rounded-xl border border-border p-3 hover:border-primary/50 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono text-primary">{projeto.code}</span>
                      {projeto.concessionaireName && (
                        <span
                          style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                            background: 'rgba(245,168,0,0.12)', color: '#8A5300',
                            border: '0.5px solid rgba(245,168,0,0.35)',
                            whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis',
                          }}
                        >
                          {projeto.concessionaireName}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-medium text-card-foreground leading-snug mb-2 line-clamp-2">
                      {projeto.generalData?.holder_name || projeto.title}
                    </p>

                    {(projeto.generalData?.city || projeto.generalData?.state) && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {projeto.generalData?.city}{projeto.generalData?.state ? `/${projeto.generalData.state}` : ''}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-border/50 text-[11px] text-muted-foreground">
                      <span>{projeto.equipment?.total_installed_power || 0} kWp</span>
                      <span>{projeto.equipment?.module_quantity || 0} módulos</span>
                    </div>

                    {projeto.protocol_number && (
                      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/50">
                        <Hash size={10} className="text-[#378ADD]" />
                        <span className="text-[10px] text-muted-foreground truncate">
                          {projeto.protocol_number}
                        </span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Estado vazio do quadro — nenhum projeto ainda. */
export function EmptyBoard({ acao }: { acao?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <FolderOpen className="w-10 h-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Nenhum projeto por aqui ainda.</p>
      {acao}
    </div>
  );
}
