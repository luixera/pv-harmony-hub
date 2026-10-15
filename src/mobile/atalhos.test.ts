import { describe, it, expect } from 'vitest';
import { atalhosDaBarra } from './atalhos';

const ROTAS_REAIS = [
  '/projects', '/tasks', '/ludmilla', '/profile', '/new-project',
  '/company/projects', '/company/financial',
];

describe('atalhosDaBarra', () => {
  it('admin: projetos, tarefas, avisos e perfil', () => {
    expect(atalhosDaBarra('admin').map(a => a.caminho))
      .toEqual(['/projects', '/tasks', '/ludmilla', '/profile']);
  });

  it('empresa: projetos, novo projeto, financeiro e perfil', () => {
    expect(atalhosDaBarra('company').map(a => a.caminho))
      .toEqual(['/company/projects', '/new-project', '/company/financial', '/profile']);
  });

  it('projetista não recebe "novo projeto" (a rota é de admin e empresa)', () => {
    expect(atalhosDaBarra('staff').map(a => a.caminho)).not.toContain('/new-project');
  });

  it('são sempre quatro, e nunca repetem', () => {
    for (const papel of ['admin', 'staff', 'company'] as const) {
      const caminhos = atalhosDaBarra(papel).map(a => a.caminho);
      expect(caminhos).toHaveLength(4);
      expect(new Set(caminhos).size).toBe(4);
    }
  });

  it('todo atalho aponta para rota que existe de verdade', () => {
    for (const papel of ['admin', 'staff', 'company'] as const) {
      for (const a of atalhosDaBarra(papel)) expect(ROTAS_REAIS).toContain(a.caminho);
    }
  });

  it('sem papel, nenhum atalho (melhor nada do que menu errado)', () => {
    expect(atalhosDaBarra(undefined)).toEqual([]);
  });
});
