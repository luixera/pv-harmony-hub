# GD Manager no celular — padrão mobile + PWA (plano de implementação)

> **Para quem executa:** usar `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans`, tarefa a tarefa. Os passos usam caixas (`- [ ]`).

**Goal:** fazer o GD Manager ser bom de usar no celular — padrão mobile único nas telas
do gestor e da empresa integradora — e instalável como PWA.

**Architecture:** um módulo de padrão (`src/mobile/`) que as telas consomem, em vez de
cada tela resolver do seu jeito. A lógica pura (colunas por largura, resumo do cartão,
atalhos por papel) fica em arquivos testáveis sem DOM; os componentes só a consomem.
O PWA entra por `vite-plugin-pwa`, sem service worker escrito à mão.

**Tech Stack:** React 18 · TypeScript · Vite 5 · vitest (environment `node`, sem DOM) ·
Tailwind + estilos inline (padrão da casa) · `vite-plugin-pwa`.

**Spec:** `docs/superpowers/specs/2026-10-15-gd-mobile-pwa-design.md`

## Global Constraints

- Baseline de tipos: `npx tsc --noEmit -p tsconfig.app.json` tem de continuar em **65
  erros**. Queda grande = falha de parse, não melhoria.
- `npm run build` tem de passar ao fim de cada tarefa.
- Testes: `npx vitest run`. O vitest roda com `environment: 'node'` — **não há DOM**.
  Só lógica pura é testada em unidade; tela se confere no navegador.
- Breakpoint é só o de `src/hooks/useWindowSize.ts`: `isMobile < 640`, `isTablet < 1024`.
  Não criar `@media` novo competindo com ele.
- Comunicação e nomes de código em português, como o resto do repositório.
- Commit ao fim de cada tarefa, com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Nada de fila de escrita offline (decisão do usuário, registrada na spec).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/mobile/breakpoints.ts` (criar) | fonte única dos limites e helpers de colapso de grade |
| `src/mobile/breakpoints.test.ts` (criar) | testes do acima |
| `src/mobile/resumoDeCartao.ts` (criar) | escolhe os ≤3 campos de apoio do cartão |
| `src/mobile/resumoDeCartao.test.ts` (criar) | testes do acima |
| `src/mobile/atalhos.ts` (criar) | os 4 atalhos da barra inferior por papel |
| `src/mobile/atalhos.test.ts` (criar) | testes do acima |
| `src/mobile/ListaEmCartoes.tsx` (criar) | componente que troca tabela/coluna por cartões |
| `src/components/layout/BottomNav.tsx` (criar) | extraído de `MainLayout.tsx:17-60`, passa a usar `atalhos.ts` |
| `src/components/layout/MainLayout.tsx` (modificar) | importa o `BottomNav` extraído |
| `vite.config.ts` (modificar) | `vite-plugin-pwa` |
| `public/icone-192.png`, `public/icone-512.png` (criar) | ícones do app |
| `index.html` (modificar) | `theme-color` e `apple-mobile-web-app-*` |

---

### Task 1: Fonte única dos limites

**Files:**
- Create: `src/mobile/breakpoints.ts`
- Test: `src/mobile/breakpoints.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `LARGURA_MOBILE = 640`, `LARGURA_TABLET = 1024`,
  `colunasPorLargura(largura: number, desejadas: number): number`,
  `gradeColapsavel(largura: number, desejadas: number): string`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { LARGURA_MOBILE, colunasPorLargura, gradeColapsavel } from './breakpoints';

describe('colunasPorLargura', () => {
  it('no celular tudo vira uma coluna', () => {
    expect(colunasPorLargura(390, 4)).toBe(1);
    expect(colunasPorLargura(639, 3)).toBe(1);
  });

  it('no tablet corta pela metade, no mínimo duas', () => {
    expect(colunasPorLargura(800, 4)).toBe(2);
    expect(colunasPorLargura(800, 3)).toBe(2);
  });

  it('no desktop respeita o que a tela pediu', () => {
    expect(colunasPorLargura(1280, 4)).toBe(4);
  });

  it('nunca devolve menos de uma coluna', () => {
    expect(colunasPorLargura(1280, 0)).toBe(1);
    expect(colunasPorLargura(390, -2)).toBe(1);
  });

  it('o limite do celular é 640 e ele NÃO conta como celular', () => {
    expect(LARGURA_MOBILE).toBe(640);
    expect(colunasPorLargura(640, 2)).toBe(2);
  });
});

describe('gradeColapsavel', () => {
  it('devolve o valor de gridTemplateColumns pronto', () => {
    expect(gradeColapsavel(390, 3)).toBe('1fr');
    expect(gradeColapsavel(1280, 3)).toBe('repeat(3, minmax(0, 1fr))');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/mobile/breakpoints.test.ts`
Expected: FAIL — `Failed to load url ./breakpoints`

- [ ] **Step 3: Implementar**

```ts
/**
 * Os limites de tela do GD Manager, num lugar só.
 *
 * `useWindowSize` já definia 640/1024; estes valores são os mesmos, exportados
 * para quem precisa decidir layout sem ser componente. Antes disto cada tela
 * escolhia seu número de colunas na mão, e seis grades de 3–4 colunas sequer
 * olhavam o tamanho da tela (ProjectModal, TaskDialog, NewRevisionDialog,
 * Reports) — no celular viravam colunas de ~90 px.
 */
export const LARGURA_MOBILE = 640;
export const LARGURA_TABLET = 1024;

/** Quantas colunas cabem de verdade nesta largura. */
export function colunasPorLargura(largura: number, desejadas: number): number {
  const pedido = Math.max(1, Math.floor(desejadas) || 1);
  if (largura < LARGURA_MOBILE) return 1;
  if (largura < LARGURA_TABLET) return Math.max(2, Math.ceil(pedido / 2));
  return pedido;
}

/** O mesmo, já no formato que o `gridTemplateColumns` espera. */
export function gradeColapsavel(largura: number, desejadas: number): string {
  const n = colunasPorLargura(largura, desejadas);
  return n === 1 ? '1fr' : `repeat(${n}, minmax(0, 1fr))`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/mobile/breakpoints.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add src/mobile/breakpoints.ts src/mobile/breakpoints.test.ts
git commit -m "feat(mobile): fonte unica dos limites de tela e colapso de grade"
```

---

### Task 2: Resumo do cartão

**Files:**
- Create: `src/mobile/resumoDeCartao.ts`
- Test: `src/mobile/resumoDeCartao.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `type CampoDeCartao = { rotulo: string; valor: string | null | undefined }`,
  `resumoDeCartao(campos: CampoDeCartao[], max?: number): { rotulo: string; valor: string }[]`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { resumoDeCartao } from './resumoDeCartao';

const campos = [
  { rotulo: 'Código', valor: 'PRJ-81492' },
  { rotulo: 'Concessionária', valor: 'CPFL' },
  { rotulo: 'Potência', valor: '4,96 kWp' },
  { rotulo: 'Cidade', valor: 'São José do Rio Preto' },
];

describe('resumoDeCartao', () => {
  it('fica com os três primeiros, na ordem recebida', () => {
    expect(resumoDeCartao(campos).map(c => c.rotulo)).toEqual(['Código', 'Concessionária', 'Potência']);
  });

  it('pula campo vazio em vez de mostrar rótulo solto', () => {
    const r = resumoDeCartao([
      { rotulo: 'Código', valor: 'PRJ-1' },
      { rotulo: 'UC', valor: '' },
      { rotulo: 'Concessionária', valor: null },
      { rotulo: 'Potência', valor: '  ' },
      { rotulo: 'Cidade', valor: 'Campinas' },
    ]);
    expect(r).toEqual([
      { rotulo: 'Código', valor: 'PRJ-1' },
      { rotulo: 'Cidade', valor: 'Campinas' },
    ]);
  });

  it('normaliza espaços do valor', () => {
    expect(resumoDeCartao([{ rotulo: 'X', valor: '  a   b  ' }])[0].valor).toBe('a b');
  });

  it('aceita outro teto', () => {
    expect(resumoDeCartao(campos, 2)).toHaveLength(2);
    expect(resumoDeCartao(campos, 0)).toHaveLength(0);
  });

  it('lista vazia não quebra', () => {
    expect(resumoDeCartao([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/mobile/resumoDeCartao.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

```ts
/**
 * Os campos de apoio que cabem num cartão de celular.
 *
 * Um cartão mostra titular, selo de etapa e no MÁXIMO três campos — quem
 * precisa do resto abre o item. Campo sem valor é pulado: rótulo solto com
 * espaço em branco ao lado é o que faz a lista parecer quebrada.
 */
export interface CampoDeCartao {
  rotulo: string;
  valor: string | null | undefined;
}

export function resumoDeCartao(
  campos: CampoDeCartao[],
  max = 3,
): { rotulo: string; valor: string }[] {
  if (max <= 0) return [];
  const cheios: { rotulo: string; valor: string }[] = [];
  for (const c of campos) {
    const valor = String(c.valor ?? '').replace(/\s+/g, ' ').trim();
    if (!valor) continue;
    cheios.push({ rotulo: c.rotulo, valor });
    if (cheios.length === max) break;
  }
  return cheios;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/mobile/resumoDeCartao.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/mobile/resumoDeCartao.ts src/mobile/resumoDeCartao.test.ts
git commit -m "feat(mobile): resumo de cartao com no maximo tres campos cheios"
```

---

### Task 3: Atalhos da barra inferior por papel

**Files:**
- Create: `src/mobile/atalhos.ts`
- Test: `src/mobile/atalhos.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `type PapelDoUsuario = 'admin' | 'staff' | 'company'`,
  `type Atalho = { chave: string; rotulo: string; caminho: string }`,
  `atalhosDaBarra(papel: PapelDoUsuario | undefined): Atalho[]`.

**Contexto (ler antes):** a barra já existe em `src/components/layout/MainLayout.tsx:17-60`,
mas "Avisos" está `disabled: true` apontando para `/notifications`, **rota que não existe
em `src/App.tsx`**. As rotas reais são `/projects`, `/tasks`, `/ludmilla`, `/profile`,
`/new-project`, `/company/projects`, `/company/financial`. Nenhum atalho pode apontar
para rota inexistente.

- [ ] **Step 1: Escrever o teste que falha**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/mobile/atalhos.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/mobile/atalhos.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add src/mobile/atalhos.ts src/mobile/atalhos.test.ts
git commit -m "feat(mobile): atalhos da barra inferior por papel, sem rota inexistente"
```

---

### Task 4: Extrair a barra inferior e ligá-la nos atalhos

**Files:**
- Create: `src/components/layout/BottomNav.tsx`
- Modify: `src/components/layout/MainLayout.tsx` (remover `BottomNav` local das linhas
  17-60 e importar o novo; manter `{isMobile && <BottomNav />}` da linha 94 e o `pb-20`)

**Interfaces:**
- Consumes: `atalhosDaBarra`, `Atalho`, `PapelDoUsuario` da Task 3.
- Produces: `export function BottomNav(): JSX.Element | null`.

**Por que agora:** a barra existe mas aponta para rota morta; esta tarefa troca a lista
local pela função testada, sem mexer no visual (as classes continuam as mesmas).

- [ ] **Step 1: Criar o componente**

```tsx
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, DollarSign, FolderOpen, Kanban, PlusCircle, User, CheckSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { atalhosDaBarra, type PapelDoUsuario } from '@/mobile/atalhos';

/** Ícone por chave do atalho — a lógica de QUAIS atalhos vive em `mobile/atalhos.ts`. */
const ICONE = {
  projetos: Kanban,
  tarefas: CheckSquare,
  avisos: Bell,
  perfil: User,
  novo: PlusCircle,
  financeiro: DollarSign,
  documentos: FolderOpen,
} as const;

/**
 * Barra de atalhos do celular. Alvo de toque de 44 px (antes era 32) e nenhum
 * item desabilitado: atalho que não leva a lugar nenhum é ruído.
 */
export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const itens = atalhosDaBarra(user?.role as PapelDoUsuario | undefined);
  if (itens.length === 0) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-sidebar border-t border-sidebar-border flex items-stretch h-16 safe-area-bottom">
      {itens.map(item => {
        const Icone = ICONE[item.chave as keyof typeof ICONE] ?? Kanban;
        const ativo = location.pathname === item.caminho;
        return (
          <button
            key={item.caminho}
            onClick={() => navigate(item.caminho)}
            aria-label={item.rotulo}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] text-[11px] transition-colors',
              ativo ? 'text-sidebar-primary' : 'text-sidebar-foreground/60',
            )}
          >
            <Icone size={20} />
            {item.rotulo}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Trocar no MainLayout**

Apagar a função `BottomNav` local (`src/components/layout/MainLayout.tsx:17-60`) e os
imports de ícones que só ela usava. Acrescentar no topo:

```tsx
import { BottomNav } from '@/components/layout/BottomNav';
```

A linha 94 (`{isMobile && <BottomNav />}`) e o `pb-20` da linha 86 **ficam como estão**.

- [ ] **Step 3: Conferir tipos e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: `65`

Run: `npm run build`
Expected: `✓ built`

- [ ] **Step 4: Conferir na tela**

Subir o preview (`preview_start` com `Vite Dev Server`), emular 390 px de largura e
confirmar: quatro atalhos, nenhum apagado, o atalho da tela corrente destacado, e tocar
em "Tarefas" leva a `/tasks`.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/BottomNav.tsx src/components/layout/MainLayout.tsx
git commit -m "feat(mobile): barra inferior extraida, com destinos reais e toque de 44px"
```

---

### Task 5: Lista em cartões

**Files:**
- Create: `src/mobile/ListaEmCartoes.tsx`

**Interfaces:**
- Consumes: `resumoDeCartao`, `CampoDeCartao` (Task 2); `LARGURA_MOBILE` (Task 1);
  `useWindowSize` de `@/hooks/useWindowSize`.
- Produces:
  `export interface ItemDeCartao { id: string; titulo: string; selo?: { texto: string; cor: string }; campos: CampoDeCartao[]; aoAbrir?: () => void }`
  `export function ListaEmCartoes(props: { itens: ItemDeCartao[]; vazio?: string; children?: React.ReactNode }): JSX.Element`

**Comportamento:** abaixo de `LARGURA_MOBILE` renderiza os cartões; de 640 px para cima
renderiza `children` (a tabela ou o Kanban que a tela já tem). Assim nenhuma tela perde
o layout de desktop.

- [ ] **Step 1: Criar o componente**

```tsx
import type React from 'react';
import { useWindowSize } from '@/hooks/useWindowSize';
import { resumoDeCartao, type CampoDeCartao } from '@/mobile/resumoDeCartao';

export interface ItemDeCartao {
  id: string;
  titulo: string;
  selo?: { texto: string; cor: string };
  campos: CampoDeCartao[];
  aoAbrir?: () => void;
}

/**
 * No celular, lista vira CARTÃO; de 640 px para cima, a tela mostra o que já
 * mostrava (`children`). Tabela de 10 colunas em 390 px ou rola de lado ou
 * corta — foi o que o usuário viu no extrato financeiro.
 */
export function ListaEmCartoes({
  itens, vazio = 'Nada por aqui.', children,
}: { itens: ItemDeCartao[]; vazio?: string; children?: React.ReactNode }) {
  const { isMobile } = useWindowSize();
  if (!isMobile) return <>{children}</>;

  if (itens.length === 0) {
    return <p style={{ fontSize: 13, color: '#888', padding: '16px 4px', margin: 0 }}>{vazio}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {itens.map(item => (
        <button
          key={item.id}
          onClick={item.aoAbrir}
          style={{
            textAlign: 'left', minHeight: 44, width: '100%', cursor: item.aoAbrir ? 'pointer' : 'default',
            background: '#fff', border: '0.5px solid #E6E6E6', borderRadius: 12, padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{item.titulo}</span>
            {item.selo && (
              <span style={{ fontSize: 11, fontWeight: 600, color: item.selo.cor, border: `1px solid ${item.selo.cor}33`, borderRadius: 8, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                {item.selo.texto}
              </span>
            )}
          </div>
          {resumoDeCartao(item.campos).map(c => (
            <p key={c.rotulo} style={{ fontSize: 12, color: '#666', margin: '2px 0 0' }}>
              <span style={{ color: '#999' }}>{c.rotulo}: </span>{c.valor}
            </p>
          ))}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Conferir tipos e build**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`
Run: `npm run build` → `✓ built`

- [ ] **Step 3: Commit**

```bash
git add src/mobile/ListaEmCartoes.tsx
git commit -m "feat(mobile): componente de lista em cartoes para telas estreitas"
```

---

### Task 6: Colapsar as seis grades rígidas

**Files:**
- Modify: `src/components/projects/ProjectModal.tsx:1818`
- Modify: `src/components/tasks/TaskDialog.tsx:203`
- Modify: `src/components/revisions/NewRevisionDialog.tsx:258`
- Modify: `src/pages/admin/Reports.tsx:254`, `:313`, `:390`

**Interfaces:**
- Consumes: `gradeColapsavel` (Task 1), `useWindowSize`.
- Produces: nada novo.

**Como:** em cada arquivo, garantir que existe `const { width } = useWindowSize();` no
componente (vários já têm `isMobile` — acrescentar `width` à desestruturação) e trocar o
valor fixo. Exemplo em `TaskDialog.tsx:203`:

```tsx
// antes
gridTemplateColumns: 'repeat(4, 1fr)'
// depois
gridTemplateColumns: gradeColapsavel(width, 4)
```

Mapa exato: `ProjectModal:1818` `'1fr 1fr 1fr'` → `gradeColapsavel(width, 3)` ·
`TaskDialog:203` `'repeat(4, 1fr)'` → `gradeColapsavel(width, 4)` ·
`NewRevisionDialog:258` `'repeat(3, minmax(0, 1fr))'` → `gradeColapsavel(width, 3)` ·
`Reports:254` `'1.2fr 1fr 1fr 1fr'` → `gradeColapsavel(width, 4)` ·
`Reports:313` `'repeat(4, 1fr)'` → `gradeColapsavel(width, 4)` ·
`Reports:390` `'1fr 1fr 1fr'` → `gradeColapsavel(width, 3)`.

- [ ] **Step 1: Trocar as seis, uma por vez**

Depois de cada troca: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65`.

- [ ] **Step 2: Conferir que não sobrou nenhuma**

Run: `grep -rnE "gridTemplateColumns: '[^']*(repeat\([3-9]|1fr 1fr 1fr)" src --include=*.tsx | grep -v isMobile`
Expected: nenhuma linha.

- [ ] **Step 3: Build e conferência nas duas larguras**

Run: `npm run build` → `✓ built`
Na tela: a 390 px as grades ficam em uma coluna; a 1280 px continuam como eram.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/ProjectModal.tsx src/components/tasks/TaskDialog.tsx src/components/revisions/NewRevisionDialog.tsx src/pages/admin/Reports.tsx
git commit -m "fix(mobile): seis grades rigidas passam a colapsar em telas estreitas"
```

---

### Task 7: Projetos em cartões no celular

**Files:**
- Modify: `src/pages/ProjectsKanban.tsx`
- Modify: `src/pages/CompanyProjects.tsx`

**Interfaces:**
- Consumes: `ListaEmCartoes`, `ItemDeCartao` (Task 5).
- Produces: nada novo.

**Como:** envolver o bloco de colunas do Kanban com `<ListaEmCartoes itens={...}>` e
deixar o Kanban atual como `children` (ele continua valendo no desktop). O `itens` sai
dos projetos já carregados: `titulo` = titular, `selo` = etapa com a cor que a tela já
usa, `campos` = código, concessionária e potência.

- [ ] **Step 1: Montar os itens em `ProjectsKanban.tsx`**

```tsx
const itensMobile: ItemDeCartao[] = projetosFiltrados.map(p => ({
  id: p.id,
  titulo: p.generalData?.holder_name ?? p.title ?? p.code,
  selo: { texto: rotuloDaEtapa(p.status), cor: corDaEtapa(p.status) },
  campos: [
    { rotulo: 'Código', valor: p.code },
    { rotulo: 'Concessionária', valor: (p as any).concessionaireName },
    { rotulo: 'Potência', valor: p.equipment?.total_installed_power ? `${p.equipment.total_installed_power} kWp` : null },
  ],
  aoAbrir: () => abrirProjeto(p.id),
}));
```

Usar os nomes que o arquivo já tem para a lista filtrada, o rótulo/cor de etapa e a
função de abrir o modal — **não inventar**: conferir antes com
`grep -n "status\|abrir\|filtrad" src/pages/ProjectsKanban.tsx`.

- [ ] **Step 2: Envolver o Kanban**

```tsx
<ListaEmCartoes itens={itensMobile} vazio="Nenhum projeto nesta etapa.">
  {/* o Kanban de colunas que já existe, inalterado */}
</ListaEmCartoes>
```

- [ ] **Step 3: Repetir em `CompanyProjects.tsx`** com os campos da empresa.

- [ ] **Step 4: tsc, build e tela**

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65` ·
`npm run build` → `✓ built` · a 390 px: cartões, sem rolagem lateral; a 1280 px: Kanban igual.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectsKanban.tsx src/pages/CompanyProjects.tsx
git commit -m "feat(mobile): lista de projetos em cartoes no celular"
```

---

### Task 8: Modal do projeto em tela cheia no celular

**Files:**
- Modify: `src/components/projects/ProjectModal.tsx`

**Interfaces:**
- Consumes: `useWindowSize` (já usado no arquivo, 21 vezes).
- Produces: nada novo.

**Contexto:** o modal já trata celular em vários pontos (`maxWidth: isMobile ? '100%' : 900`,
`borderRadius: isMobile ? 0 : 14`, `height: isMobile ? '100%' : undefined`). O que falta é
o que a spec §2 pede: **cabeçalho fixo** e **abas roláveis**, para a pessoa não perder a
navegação ao descer o conteúdo.

- [ ] **Step 1: Ler o que já existe antes de mexer**

Run: `grep -n "isMobile" src/components/projects/ProjectModal.tsx | head -25`
Objetivo: localizar o contêiner do cabeçalho e a faixa de abas (perto de `TABS`), para
alterar só esses dois e não reescrever a tela.

- [ ] **Step 2: Fixar o cabeçalho no celular**

No contêiner do cabeçalho (o que tem o código do projeto e o botão de fechar):

```tsx
style={{ ...(isMobile ? { position: 'sticky', top: 0, zIndex: 5 } : {}), /* estilos que já existem */ }}
```

- [ ] **Step 3: Abas roláveis no celular**

No contêiner da faixa de abas:

```tsx
style={{ ...(isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'], flexWrap: 'nowrap' } : {}), /* estilos que já existem */ }}
```

Cada aba recebe `whiteSpace: 'nowrap'` e `minHeight: 44`.

- [ ] **Step 4: tsc, build e tela**

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65` ·
`npm run build` → `✓ built` · a 390 px: o cabeçalho fica visível ao rolar e as abas
deslizam na horizontal; a 1280 px o modal é **igual ao que era**.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects/ProjectModal.tsx
git commit -m "feat(mobile): modal do projeto com cabecalho fixo e abas rolaveis no celular"
```

---

### Task 9: Documentos em cartões — CANCELADA na execução

> **Não executada (15/10/2026).** A aba de documentos do `ProjectModal`
> (`TabDocuments`, dentro do próprio arquivo, não num componente separado como
> este plano supunha) **já fazia mestre-detalhe** no celular: lista → prévia com
> botão de voltar, linhas de 48 px, rótulo do tipo em vez do nome do arquivo.
> Envolver isso em `ListaEmCartoes` apagaria a prévia. Vale aqui a regra que a
> Task 7 ensinou: o padrão serve onde não há nada; onde já existe algo melhor,
> o padrão não entra. Os passos abaixo ficam como registro do que se pensou.

**Files:**
- Modify: a aba de documentos do projeto — localizar com
  `grep -rln "document_type\|Documentos" src/components/projects/*.tsx | head`

**Interfaces:**
- Consumes: `ListaEmCartoes`, `ItemDeCartao` (Task 5).
- Produces: nada novo.

- [ ] **Step 1: Achar a lista de documentos**

Run: `grep -rn "document_type" src/components/projects/*.tsx | head -8`
Objetivo: achar o componente que lista os documentos do projeto e o nome da variável
com a lista já carregada.

- [ ] **Step 2: Montar os itens**

```tsx
const itensMobile: ItemDeCartao[] = documentos.map(d => ({
  id: d.id,
  titulo: d.file_name,
  campos: [
    { rotulo: 'Tipo', valor: rotuloDoTipo(d.document_type) },
    { rotulo: 'Enviado', valor: new Date(d.created_at).toLocaleDateString('pt-BR') },
  ],
  aoAbrir: () => abrirDocumento(d),
}));
```

Usar os nomes reais do arquivo (o rótulo do tipo e a função de abrir já existem) —
conferir no Step 1, não inventar.

- [ ] **Step 3: Envolver a lista atual**

```tsx
<ListaEmCartoes itens={itensMobile} vazio="Nenhum documento anexado.">
  {/* a lista/tabela de documentos que já existe, inalterada */}
</ListaEmCartoes>
```

- [ ] **Step 4: tsc, build e tela**

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → `65` ·
`npm run build` → `✓ built` · a 390 px: cartões com nome e tipo, alvo de toque grande;
a 1280 px: lista igual à de hoje.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects
git commit -m "feat(mobile): documentos do projeto em cartoes no celular"
```

---

### Task 10: PWA — instalável, com cache do shell

**Files:**
- Modify: `vite.config.ts`
- Modify: `index.html`
- Create: `public/icone-192.png`, `public/icone-512.png` (derivar de `public/logo.png`)
- Modify: `package.json` (dependência)

**Interfaces:**
- Consumes: nada.
- Produces: `manifest.webmanifest` e service worker gerados no build.

- [ ] **Step 1: Instalar o plugin**

```bash
npm i -D vite-plugin-pwa
```

- [ ] **Step 2: Configurar no `vite.config.ts`**

```ts
import { VitePWA } from 'vite-plugin-pwa';

// dentro de plugins: [...]
VitePWA({
  registerType: 'prompt',
  includeAssets: ['favicon.ico', 'icone-192.png', 'icone-512.png'],
  manifest: {
    name: 'GD Manager Energy',
    short_name: 'GD Manager',
    description: 'Homologação de projetos fotovoltaicos',
    theme_color: '#F5A800',
    background_color: '#ffffff',
    display: 'standalone',
    start_url: '/',
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    // só o shell: dados continuam vindo da rede (sem fila de escrita offline)
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    navigateFallbackDenylist: [/^\/functions\//],
    runtimeCaching: [],
  },
}),
```

`registerType: 'prompt'` é deliberado: com `autoUpdate` o usuário pode ficar preso numa
versão velha sem saber. O aviso de nova versão entra no Step 4.

- [ ] **Step 3: Meta tags no `index.html`**

```html
<meta name="theme-color" content="#F5A800" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="GD Manager" />
```

- [ ] **Step 4: Aviso de nova versão**

Em `src/main.tsx`, registrar e avisar quando houver atualização:

```tsx
import { registerSW } from 'virtual:pwa-register';

const atualizar = registerSW({
  onNeedRefresh() {
    // o toast da casa é o `sonner`, já usado em todo o app
    import('sonner').then(({ toast }) => {
      toast('Nova versão disponível', {
        action: { label: 'Atualizar', onClick: () => atualizar(true) },
        duration: Infinity,
      });
    });
  },
});
```

- [ ] **Step 5: Gerar os ícones**

A partir de `public/logo.png`, gerar 192×192 e 512×512 em `public/`. Conferir que os dois
arquivos existem e têm o tamanho certo antes de seguir.

- [ ] **Step 6: Build e conferência**

Run: `npm run build`
Expected: `✓ built`, e `dist/manifest.webmanifest` + `dist/sw.js` presentes:

```bash
ls dist/manifest.webmanifest dist/sw.js
```

Na tela (preview ou produção, em 390 px): o navegador oferece instalar; instalado, abre
sem a barra do navegador.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts index.html src/main.tsx public/icone-192.png public/icone-512.png package.json package-lock.json
git commit -m "feat(pwa): GD Manager instalavel, com cache do shell e aviso de nova versao"
```

---

### Task 11: Documentação e memória

**Files:**
- Modify: `docs/project/architecture.md` (seção do front)
- Modify: `CLAUDE.md` (tabela de módulos)
- Create: `docs/modules/mobile/overview.md`

- [ ] **Step 1: Escrever `docs/modules/mobile/overview.md`**

Conteúdo mínimo: o padrão (`src/mobile/`), o que cada arquivo faz, a regra de que
`useWindowSize` é a única fonte de breakpoint, a decisão de não ter fila de escrita
offline e por quê, e como conferir uma tela em 390 px.

- [ ] **Step 2: Linha na tabela de módulos do `CLAUDE.md`**

```markdown
| Mobile / PWA | 🟡 Fase 1 — padrão + telas do gestor e da empresa | [modules/mobile](docs/modules/mobile/overview.md) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/modules/mobile/overview.md docs/project/architecture.md CLAUDE.md
git commit -m "docs(mobile): padrao mobile e PWA no indice e no modulo proprio"
```

---

## Verificação final (antes de dizer que acabou)

- [ ] `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → **65**
- [ ] `npx vitest run` → tudo verde, com os ~17 testes novos das Tasks 1-3
- [ ] `npm run build` → `✓ built`, com `dist/manifest.webmanifest` e `dist/sw.js`
- [ ] Em 390 px: barra inferior com 4 atalhos vivos, projetos em cartões, nenhuma
      rolagem lateral, grades em uma coluna
- [ ] Em 390 px: modal com cabeçalho fixo e abas deslizando (documentos seguem
      em mestre-detalhe, que é o que já havia — ver Task 9)
- [ ] Em 1280 px: Kanban, modal, documentos e relatórios **iguais ao que eram**
- [ ] `docs/modules/mobile/overview.md` e o ADR 0011 descrevem o que ficou de pé
- [ ] `git log --oneline` mostra os commits no `main`
