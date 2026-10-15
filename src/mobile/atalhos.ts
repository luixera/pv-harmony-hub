/**
 * Os quatro destinos da barra inferior, por papel.
 *
 * Quatro porque é o que cabe no polegar sem virar menu. O resto continua na
 * gaveta lateral — a barra é atalho, não substituto. Todo caminho aqui tem de
 * existir em `src/App.tsx`: a versão anterior tinha "Avisos" desabilitado
 * apontando para `/notifications`, que nunca existiu.
 */
export type PapelDoUsuario = 'admin' | 'staff' | 'company';

export interface Atalho {
  /** nome do ícone, resolvido por quem renderiza */
  chave: string;
  rotulo: string;
  caminho: string;
}

export function atalhosDaBarra(papel: PapelDoUsuario | undefined): Atalho[] {
  if (papel === 'company') {
    return [
      { chave: 'projetos', rotulo: 'Projetos', caminho: '/company/projects' },
      { chave: 'novo', rotulo: 'Novo', caminho: '/new-project' },
      { chave: 'financeiro', rotulo: 'Financeiro', caminho: '/company/financial' },
      { chave: 'perfil', rotulo: 'Perfil', caminho: '/profile' },
    ];
  }
  if (papel === 'admin' || papel === 'staff') {
    return [
      { chave: 'projetos', rotulo: 'Projetos', caminho: '/projects' },
      { chave: 'tarefas', rotulo: 'Tarefas', caminho: '/tasks' },
      { chave: 'avisos', rotulo: 'Avisos', caminho: '/ludmilla' },
      { chave: 'perfil', rotulo: 'Perfil', caminho: '/profile' },
    ];
  }
  return [];
}
