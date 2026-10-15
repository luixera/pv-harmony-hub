import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/hooks/useProjects';
import { useCompanyKanbanModel } from '@/hooks/useKanbanConfig';
import { ReadOnlyKanbanBoard, EmptyBoard } from '@/components/kanban/ReadOnlyKanbanBoard';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { ListaEmCartoes } from '@/mobile/ListaEmCartoes';
import { cartaoDeProjeto } from '@/mobile/cartaoDeProjeto';
import { projectStatusLabel } from '@/lib/statusMapping';
import { Loader2, Plus, Search } from 'lucide-react';

/**
 * "Meus Projetos" da empresa integradora — quadro Kanban somente leitura.
 *
 * Decisões do usuário (set/2026): o quadro entra aqui e o Dashboard continua
 * com os cartões de resumo; a empresa NÃO arrasta o card (quem move o projeto
 * é a equipe — arrastar gravaria histórico e dispararia as tarefas
 * automáticas). Clicar no card abre o mesmo modal do admin/projetista, com
 * menos abas.
 *
 * As colunas saem do modelo de Kanban da empresa, não de uma lista fixa: o
 * cliente acompanha exatamente o fluxo que a equipe configurou.
 */
export default function CompanyProjects() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: todos = [], isLoading } = useProjects();
  const { data: modelo, isLoading: carregandoModelo } = useCompanyKanbanModel(user?.companyId);
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const daEmpresa = todos.filter(p => p.company_id === user?.companyId);

  const termo = busca.trim().toLowerCase();
  const projetos = termo
    ? daEmpresa.filter(p =>
        p.code?.toLowerCase().includes(termo) ||
        p.generalData?.holder_name?.toLowerCase().includes(termo) ||
        p.generalData?.uc_number?.toLowerCase().includes(termo) ||
        p.protocol_number?.toLowerCase().includes(termo) ||
        p.generalData?.city?.toLowerCase().includes(termo))
    : daEmpresa;

  const colunas = modelo?.columns ?? [];

  // Cartões do celular (abaixo de 640 px o quadro de colunas não aparece). Esta
  // tela não tem filtro de etapa, então o celular mostra TODOS os projetos da
  // empresa, com a etapa no selo. O nome da etapa é o da coluna do modelo da
  // empresa (o mesmo do quadro); etapa fora do modelo cai no nome de fábrica.
  const rotuloDaEtapa = (status: string) =>
    colunas.find(c => c.status_key === status)?.status_label ?? projectStatusLabel(status);
  const itensMobile = projetos.map(p => cartaoDeProjeto(p, rotuloDaEtapa, setModalProjectId));

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Meus Projetos</h1>
            <p className="text-muted-foreground">
              Acompanhe em que etapa está cada projeto que você enviou
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar projeto, titular, UC..."
                className="pl-9 w-full sm:w-64"
              />
            </div>
            <Button variant="cta" onClick={() => navigate('/new-project')}>
              <Plus className="w-4 h-4" /> Novo Projeto
            </Button>
          </div>
        </div>

        {isLoading || carregandoModelo ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : daEmpresa.length === 0 ? (
          <EmptyBoard
            acao={
              <Button variant="cta" onClick={() => navigate('/new-project')}>
                <Plus className="w-4 h-4" /> Enviar o primeiro projeto
              </Button>
            }
          />
        ) : (
          <>
            {termo && (
              <p className="text-xs text-muted-foreground">
                {projetos.length} de {daEmpresa.length} projeto(s) para “{busca.trim()}”
              </p>
            )}
            {/* Abaixo de 640 px, cartões; de 640 px para cima, o quadro de sempre.
                A busca e o "Novo Projeto" ficam no cabeçalho, fora daqui: no celular
                o `children` do ListaEmCartoes não é renderizado. */}
            <ListaEmCartoes itens={itensMobile} vazio="Nenhum projeto encontrado.">
              {colunas.length === 0 ? (
                /* Sem modelo de Kanban não há quadro para montar. Isso é limitação do
                   DESKTOP: o cartão do celular não precisa das colunas (a etapa cai no
                   nome de fábrica), então ele continua mostrando os projetos. */
                <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
                  O quadro ainda não foi configurado. Fale com a equipe responsável pela homologação.
                </div>
              ) : (
                <ReadOnlyKanbanBoard
                  projects={projetos}
                  columns={colunas}
                  onOpenProject={setModalProjectId}
                />
              )}
            </ListaEmCartoes>
          </>
        )}
      </div>

      {modalProjectId && (
        <ProjectModal projectId={modalProjectId} onClose={() => setModalProjectId(null)} />
      )}
    </MainLayout>
  );
}
