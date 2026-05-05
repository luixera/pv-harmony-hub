import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KanbanModel } from '@/hooks/useKanbanConfig';
import { Flag, CheckCircle } from 'lucide-react';

interface KanbanPreviewProps {
  model: KanbanModel;
}

export function KanbanPreview({ model }: KanbanPreviewProps) {
  const columns = model.columns || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview do Kanban</CardTitle>
        <CardDescription>Visualização de como o Kanban aparecerá</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-64">
              {/* Column Header */}
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-3 h-3 rounded-full ${column.color}`} />
                <span className="font-semibold text-foreground">{column.status_label}</span>
                <Badge variant="secondary" className="ml-auto text-xs">0</Badge>
              </div>

              {/* Column Content */}
              <div className="bg-muted/30 rounded-lg p-3 min-h-[200px] border border-dashed border-border">
                {/* Sample Card */}
                <div className="bg-card rounded-lg p-3 shadow-sm border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-primary">PRJ-001</span>
                    <Badge variant="secondary" className="text-[10px]">Exemplo</Badge>
                  </div>
                  <p className="text-sm font-medium text-card-foreground">
                    Projeto Exemplo
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cidade, Estado
                  </p>
                </div>

                {/* Indicators */}
                <div className="flex flex-wrap gap-1 mt-3">
                  {column.is_initial && (
                    <Badge variant="outline" className="text-[10px]">
                      <Flag className="w-3 h-3 mr-1" />
                      Início
                    </Badge>
                  )}
                  {column.is_final && (
                    <Badge variant="outline" className="text-[10px]">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Final
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}

          {columns.length === 0 && (
            <div className="w-full text-center py-12 text-muted-foreground">
              Adicione colunas para visualizar o preview
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
