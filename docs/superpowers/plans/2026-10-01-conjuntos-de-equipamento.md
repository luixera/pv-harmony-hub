# Conjuntos de equipamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um projeto pode ter N **conjuntos** (um inversor com os módulos dele), e tudo que hoje lê um par único — telas, motor, unifilar, formulários, Bidu — passa a trabalhar com a lista, sem quebrar os projetos de um conjunto só.

**Architecture:** Tabela nova `project_equipment_sets` (uma linha por conjunto). `project_equipment` continua existindo como **resumo derivado**, preenchido por gatilho (principal = maior potência; quantidades e potência total = soma) — é o que mantém os 23 consumidores atuais funcionando. Quem precisa do detalhe lê a tabela nova.

**Tech Stack:** Postgres (Supabase, RLS RESTRICTIVE por tenant, RPC `SECURITY DEFINER`), React 18 + TypeScript, React Query, vitest (`npm test`), Deno (edge functions).

**Spec:** `docs/superpowers/specs/2026-10-01-conjuntos-de-equipamento-design.md`

## Global Constraints

- **Isolamento de tenant é inegociável**: `project_equipment_sets` leva `tenant_id` e política RESTRICTIVE, como as demais tabelas de negócio.
- **Verificação antes de concluir** (regra da casa): `npx tsc --noEmit -p tsconfig.app.json` com **baseline de 65 erros** (queda grande = falha de parse, não melhoria) e `npm run build`. Banco por `npx -y supabase db query --linked -f arquivo.sql`; RLS testada com impersonação dentro de `begin; … rollback;`.
- **Comunicação e identificadores em português** (o módulo já é assim).
- **Projeto de um conjunto não pode mudar de comportamento**: mesmo resumo, mesmo unifilar, mesmos formulários. Cada tarefa que mexe em consumidor tem um teste de regressão de um conjunto.
- **Vínculo com o catálogo** segue a regra de 25/09 (`src/utils/equipmentMatch.ts`): só vale enquanto o modelo bater.
- **CEMIG**: campos de modelo/marca/potência nominal/quantidade unem os conjuntos com `" + "`; campos de TOTAL continuam número somado (decisão do usuário, 01/10/2026).

---

### Task 1: Banco — tabela de conjuntos, gatilho do resumo e migração dos projetos atuais

**Files:**
- Create: `supabase/migrations/20261001100000_conjuntos_equipamento.sql`
- Test: `docs/superpowers/plans/_scratch` não; o teste roda por `npx -y supabase db query --linked -f <arquivo temporário>` (padrão da casa)

**Interfaces:**
- Consumes: nada.
- Produces: tabela `public.project_equipment_sets` (colunas abaixo); função `public.fn_sync_project_equipment_resumo()`; gatilho `trg_equipment_sets_resumo`; função `public.conjuntos_do_projeto(p_project_id UUID)` que devolve as linhas ordenadas.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20261001100000_conjuntos_equipamento.sql
-- CONJUNTOS DE EQUIPAMENTO — um inversor com os módulos dele (01/10/2026).
-- Ampliação/retificação deixam o projeto com 2 modelos; `project_equipment`
-- só cabia um par. Agora cada conjunto é uma linha aqui e `project_equipment`
-- vira RESUMO mantido por gatilho (os 23 consumidores de hoje continuam).

CREATE TABLE IF NOT EXISTS public.project_equipment_sets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem               SMALLINT NOT NULL DEFAULT 1 CHECK (ordem BETWEEN 1 AND 20),
  inverter_brand      TEXT,
  inverter_model      TEXT,
  inverter_power      NUMERIC,
  inverter_quantity   INTEGER,
  inverter_catalog_id UUID REFERENCES public.equipment_catalog(id) ON DELETE SET NULL,
  module_brand        TEXT,
  module_model        TEXT,
  module_power        NUMERIC,
  module_quantity     INTEGER,
  module_catalog_id   UUID REFERENCES public.equipment_catalog(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, ordem)
);
CREATE INDEX IF NOT EXISTS idx_equipment_sets_projeto ON public.project_equipment_sets (project_id, ordem);

ALTER TABLE public.project_equipment_sets ENABLE ROW LEVEL SECURITY;

-- RLS: as MESMAS 9 políticas de `project_equipment` (conferidas em 01/10/2026
-- com pg_policy). Copiar menos do que isso quebra casos reais: o formulário
-- PÚBLICO grava como `anon`, a empresa precisa ver o próprio equipamento e o
-- projetista com acesso restrito só vê o que lhe foi atribuído.
DROP POLICY IF EXISTS tenant_isolation ON public.project_equipment_sets;
CREATE POLICY tenant_isolation ON public.project_equipment_sets AS RESTRICTIVE FOR ALL
  TO authenticated USING (public.project_in_user_tenant(project_id));

CREATE POLICY "Admin can view all equipment sets" ON public.project_equipment_sets FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.user_role));

CREATE POLICY "Admin/Staff can insert equipment sets" ON public.project_equipment_sets FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.user_role) OR public.has_role(auth.uid(), 'staff'::public.user_role));

CREATE POLICY "Admin/Staff can update equipment sets" ON public.project_equipment_sets FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.user_role) OR public.has_role(auth.uid(), 'staff'::public.user_role));

CREATE POLICY "Admin/Staff can delete equipment sets" ON public.project_equipment_sets FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.user_role) OR public.has_role(auth.uid(), 'staff'::public.user_role));

-- o formulário público grava SEM login; só em projeto que nasceu dele
CREATE POLICY "Anonymous can insert equipment sets for public form" ON public.project_equipment_sets FOR INSERT
  TO anon WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.source = 'public_form'::public.project_source));

CREATE POLICY "Company can insert own equipment sets" ON public.project_equipment_sets FOR INSERT
  TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.company_id = public.get_user_company_id(auth.uid())));

CREATE POLICY "Company can view own equipment sets" ON public.project_equipment_sets FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.company_id = public.get_user_company_id(auth.uid())));

CREATE POLICY "Staff with global access can view all equipment sets" ON public.project_equipment_sets FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'staff'::public.user_role)
    AND (SELECT staff_access_mode FROM public.profiles WHERE id = auth.uid()) = 'global'::public.staff_access_mode);

CREATE POLICY "Staff with restricted access can view assigned equipment sets" ON public.project_equipment_sets FOR SELECT
  TO authenticated USING (
    (public.has_role(auth.uid(), 'staff'::public.user_role)
      AND (SELECT staff_access_mode FROM public.profiles WHERE id = auth.uid()) = 'assigned_only'::public.staff_access_mode
      AND EXISTS (SELECT 1 FROM public.project_assignments a WHERE a.project_id = project_equipment_sets.project_id AND a.staff_user_id = auth.uid()))
    OR public.staff_ligado_ao_projeto(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_equipment_sets_updated_at ON public.project_equipment_sets;
CREATE TRIGGER update_equipment_sets_updated_at
  BEFORE UPDATE ON public.project_equipment_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/**
 * Recalcula o RESUMO em `project_equipment` a partir dos conjuntos.
 * Principal = maior (inverter_power × inverter_quantity); empate pela ordem.
 * Quantidades = soma; total_installed_power = min(Σ módulos kWp, Σ inversores kW),
 * a mesma regra de hoje.
 */
CREATE OR REPLACE FUNCTION public.fn_sync_project_equipment_resumo()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _proj UUID; _p RECORD; _tot RECORD;
BEGIN
  _proj := COALESCE(NEW.project_id, OLD.project_id);

  SELECT * INTO _p FROM public.project_equipment_sets s
   WHERE s.project_id = _proj
   ORDER BY COALESCE(s.inverter_power, 0) * COALESCE(s.inverter_quantity, 0) DESC, s.ordem
   LIMIT 1;

  SELECT COALESCE(SUM(COALESCE(s.inverter_quantity, 0)), 0) AS inv_qtd,
         COALESCE(SUM(COALESCE(s.module_quantity, 0)), 0)   AS mod_qtd,
         COALESCE(SUM(COALESCE(s.inverter_power, 0) * COALESCE(s.inverter_quantity, 0)), 0) AS inv_kw,
         COALESCE(SUM(COALESCE(s.module_power, 0) * COALESCE(s.module_quantity, 0)), 0) / 1000.0 AS mod_kwp
    INTO _tot
    FROM public.project_equipment_sets s WHERE s.project_id = _proj;

  IF _p.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE public.project_equipment e
     SET inverter_brand = _p.inverter_brand,
         inverter_model = _p.inverter_model,
         inverter_power = _p.inverter_power,
         inverter_catalog_id = _p.inverter_catalog_id,
         module_brand = _p.module_brand,
         module_model = _p.module_model,
         module_power = _p.module_power,
         module_catalog_id = _p.module_catalog_id,
         inverter_quantity = _tot.inv_qtd,
         module_quantity = _tot.mod_qtd,
         total_installed_power = CASE
           WHEN _tot.inv_kw > 0 AND _tot.mod_kwp > 0 THEN LEAST(_tot.inv_kw, _tot.mod_kwp)
           ELSE GREATEST(_tot.inv_kw, _tot.mod_kwp) END
   WHERE e.project_id = _proj;

  IF NOT FOUND THEN
    INSERT INTO public.project_equipment
      (project_id, inverter_brand, inverter_model, inverter_power, inverter_quantity, inverter_catalog_id,
       module_brand, module_model, module_power, module_quantity, module_catalog_id, total_installed_power)
    VALUES (_proj, _p.inverter_brand, _p.inverter_model, _p.inverter_power, _tot.inv_qtd, _p.inverter_catalog_id,
            _p.module_brand, _p.module_model, _p.module_power, _tot.mod_qtd, _p.module_catalog_id,
            CASE WHEN _tot.inv_kw > 0 AND _tot.mod_kwp > 0 THEN LEAST(_tot.inv_kw, _tot.mod_kwp)
                 ELSE GREATEST(_tot.inv_kw, _tot.mod_kwp) END);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_equipment_sets_resumo ON public.project_equipment_sets;
CREATE TRIGGER trg_equipment_sets_resumo
  AFTER INSERT OR UPDATE OR DELETE ON public.project_equipment_sets
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_project_equipment_resumo();

/** Os conjuntos de um projeto, em ordem. Leitura do front e das edge functions. */
CREATE OR REPLACE FUNCTION public.conjuntos_do_projeto(p_project_id UUID)
RETURNS SETOF public.project_equipment_sets
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT * FROM public.project_equipment_sets WHERE project_id = p_project_id ORDER BY ordem;
$$;

-- ── Migração: cada projeto de hoje vira o conjunto 1 ────────────────────────
INSERT INTO public.project_equipment_sets
  (project_id, tenant_id, ordem, inverter_brand, inverter_model, inverter_power, inverter_quantity,
   inverter_catalog_id, module_brand, module_model, module_power, module_quantity, module_catalog_id)
SELECT e.project_id, p.tenant_id, 1, e.inverter_brand, e.inverter_model, e.inverter_power, e.inverter_quantity,
       e.inverter_catalog_id, e.module_brand, e.module_model, e.module_power, e.module_quantity, e.module_catalog_id
  FROM public.project_equipment e
  JOIN public.projects p ON p.id = e.project_id
 WHERE NOT EXISTS (SELECT 1 FROM public.project_equipment_sets s WHERE s.project_id = e.project_id);
```

- [ ] **Step 2: Aplicar e conferir que a migração não mudou nenhum resumo**

Rodar:
```bash
npx -y supabase db query --linked -f supabase/migrations/20261001100000_conjuntos_equipamento.sql
```
Depois, num arquivo temporário (`$TMP/conf.sql`):
```sql
select count(*) as projetos_com_conjunto from public.project_equipment_sets;
select count(*) as resumos_divergentes
from public.project_equipment e
join public.project_equipment_sets s on s.project_id = e.project_id and s.ordem = 1
where e.inverter_model is distinct from s.inverter_model
   or e.module_model   is distinct from s.module_model
   or e.inverter_quantity is distinct from s.inverter_quantity
   or e.module_quantity   is distinct from s.module_quantity;
```
Esperado: `projetos_com_conjunto` = número de linhas de `project_equipment`; `resumos_divergentes` = **0**.

- [ ] **Step 3: Teste por impersonação (gatilho + isolamento)**

Arquivo temporário `$TMP/test_conjuntos.sql`:
```sql
begin;
create temp table _r (teste text, resultado text);
grant all on _r to authenticated, service_role;
create temp table _ids as
select (select id from public.tenants where is_library limit 1) as gd,
       (select p.id from public.profiles p join public.tenants t on t.id=p.tenant_id where t.is_library and p.role='admin' limit 1) as admin_gd,
       (select p.id from public.profiles p join public.tenants t on t.id=p.tenant_id where not t.is_library and p.role='admin' limit 1) as admin_outro,
       (select pr.id from public.projects pr join public.tenants t on t.id=pr.tenant_id where t.is_library and not pr.is_deleted order by pr.created_at desc limit 1) as projeto;
grant select on _ids to authenticated, service_role;

-- 1) segundo conjunto: resumo soma e principal é o de maior potência
update public.project_equipment_sets set inverter_brand='SUNGROW', inverter_model='SG7.5RS-L', inverter_power=7.5,
       inverter_quantity=1, module_brand='ERA', module_model='ERA-RC66HD 610M', module_power=610, module_quantity=16
 where project_id=(select projeto from _ids) and ordem=1;
insert into public.project_equipment_sets (project_id, tenant_id, ordem, inverter_brand, inverter_model, inverter_power,
       inverter_quantity, module_brand, module_model, module_power, module_quantity)
select projeto, gd, 2, 'GROWATT', 'NEO 2250M-X2', 2.25, 1, 'GOKIN', 'GK-4-66HTBD-610M-F', 610, 4 from _ids;
insert into _r select '1 resumo: modelo principal', inverter_model from public.project_equipment where project_id=(select projeto from _ids);
insert into _r select '1b resumo: quantidades somadas', inverter_quantity::text || ' inv / ' || module_quantity::text || ' mod'
  from public.project_equipment where project_id=(select projeto from _ids);
insert into _r select '1c potencia total (min entre somas)', total_installed_power::text
  from public.project_equipment where project_id=(select projeto from _ids);

-- 2) remover o conjunto 2 devolve o resumo de um conjunto
delete from public.project_equipment_sets where project_id=(select projeto from _ids) and ordem=2;
insert into _r select '2 resumo apos remover', inverter_quantity::text || ' inv / ' || module_quantity::text || ' mod'
  from public.project_equipment where project_id=(select projeto from _ids);

-- 3) outro tenant não vê os conjuntos
select set_config('request.jwt.claims', json_build_object('sub', admin_outro, 'role','authenticated')::text, true) from _ids;
set local role authenticated;
insert into _r select '3 outro tenant ve conjuntos', count(*)::text from public.project_equipment_sets where project_id=(select projeto from _ids);
reset role;

-- 4) a equipe do tenant vê
select set_config('request.jwt.claims', json_build_object('sub', admin_gd, 'role','authenticated')::text, true) from _ids;
set local role authenticated;
insert into _r select '4 equipe ve conjuntos', count(*)::text from public.conjuntos_do_projeto((select projeto from _ids));
reset role;

select * from _r order by teste;
rollback;
```
Rodar: `npx -y supabase db query --linked -f $TMP/test_conjuntos.sql`
Esperado: `1 resumo: modelo principal` = `SG7.5RS-L`; `1b` = `2 inv / 20 mod`; `1c` = `9.75`; `2 resumo apos remover` = `1 inv / 16 mod`; `3 outro tenant ve conjuntos` = `0`; `4 equipe ve conjuntos` = `1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261001100000_conjuntos_equipamento.sql
git commit -m "feat(equipamentos): tabela de conjuntos, gatilho do resumo e migracao

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Leitura e escrita dos conjuntos no front (hook + tipos)

**Files:**
- Create: `src/hooks/useEquipmentSets.ts`
- Create: `src/hooks/useEquipmentSets.test.ts`
- Modify: `src/hooks/useProjects.ts` (acrescentar `equipmentSets` ao `ProjectWithDetails`, carregando junto do projeto)

**Interfaces:**
- Consumes: tabela `project_equipment_sets` (Task 1).
- Produces:
  - `export interface ConjuntoEquipamento { id?: string; ordem: number; inverter_brand: string; inverter_model: string; inverter_power: number | null; inverter_quantity: number | null; inverter_catalog_id: string | null; module_brand: string; module_model: string; module_power: number | null; module_quantity: number | null; module_catalog_id: string | null }`
  - `export function conjuntoVazio(ordem: number): ConjuntoEquipamento`
  - `export function totaisDosConjuntos(c: ConjuntoEquipamento[]): { inversoresKw: number; modulosKwp: number; totalKwp: number; qtdInversores: number; qtdModulos: number }`
  - `export function conjuntoPrincipal(c: ConjuntoEquipamento[]): ConjuntoEquipamento | null`
  - `export function useEquipmentSets(projectId?: string)` (React Query, `queryKey: ['equipment-sets', projectId]`)
  - `export function useSalvarConjuntos()` (mutation: apaga os que sumiram, grava os demais por `ordem`)

- [ ] **Step 1: Escrever os testes das funções puras**

```ts
// src/hooks/useEquipmentSets.test.ts
import { describe, expect, it } from 'vitest';
import { conjuntoPrincipal, conjuntoVazio, totaisDosConjuntos, type ConjuntoEquipamento } from './useEquipmentSets';

const c = (o: Partial<ConjuntoEquipamento>): ConjuntoEquipamento => ({ ...conjuntoVazio(1), ...o });

describe('totaisDosConjuntos', () => {
  it('soma potências e quantidades dos conjuntos (não multiplica o principal)', () => {
    const t = totaisDosConjuntos([
      c({ ordem: 1, inverter_power: 7.5, inverter_quantity: 1, module_power: 610, module_quantity: 16 }),
      c({ ordem: 2, inverter_power: 2.25, inverter_quantity: 1, module_power: 610, module_quantity: 4 }),
    ]);
    expect(t.inversoresKw).toBeCloseTo(9.75, 2);
    expect(t.modulosKwp).toBeCloseTo(12.2, 2);
    expect(t.totalKwp).toBeCloseTo(9.75, 2);   // menor entre os dois
    expect(t.qtdInversores).toBe(2);
    expect(t.qtdModulos).toBe(20);
  });

  it('um conjunto só: mesmo resultado de hoje', () => {
    const t = totaisDosConjuntos([c({ inverter_power: 5, inverter_quantity: 2, module_power: 550, module_quantity: 20 })]);
    expect(t.inversoresKw).toBe(10);
    expect(t.qtdInversores).toBe(2);
    expect(t.totalKwp).toBeCloseTo(10, 2);
  });

  it('lista vazia não quebra', () => {
    expect(totaisDosConjuntos([]).totalKwp).toBe(0);
  });
});

describe('conjuntoPrincipal', () => {
  it('é o de maior potência de inversores; empate fica com a menor ordem', () => {
    const lista = [
      c({ ordem: 1, inverter_model: 'A', inverter_power: 2.25, inverter_quantity: 1 }),
      c({ ordem: 2, inverter_model: 'B', inverter_power: 7.5, inverter_quantity: 1 }),
    ];
    expect(conjuntoPrincipal(lista)?.inverter_model).toBe('B');
    const empate = [c({ ordem: 1, inverter_model: 'X', inverter_power: 5, inverter_quantity: 1 }),
                    c({ ordem: 2, inverter_model: 'Y', inverter_power: 5, inverter_quantity: 1 })];
    expect(conjuntoPrincipal(empate)?.inverter_model).toBe('X');
  });
  it('lista vazia devolve null', () => { expect(conjuntoPrincipal([])).toBeNull(); });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/hooks/useEquipmentSets.test.ts`
Expected: FAIL — "Failed to resolve import './useEquipmentSets'".

- [ ] **Step 3: Escrever o hook**

```ts
// src/hooks/useEquipmentSets.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * CONJUNTOS DE EQUIPAMENTO — um inversor com os módulos dele.
 * Ampliação e retificação deixam o projeto com 2 modelos; cada um é um
 * conjunto. `project_equipment` continua como resumo (gatilho no banco).
 */
export interface ConjuntoEquipamento {
  id?: string;
  ordem: number;
  inverter_brand: string;
  inverter_model: string;
  inverter_power: number | null;
  inverter_quantity: number | null;
  inverter_catalog_id: string | null;
  module_brand: string;
  module_model: string;
  module_power: number | null;
  module_quantity: number | null;
  module_catalog_id: string | null;
}

export const conjuntoVazio = (ordem: number): ConjuntoEquipamento => ({
  ordem, inverter_brand: '', inverter_model: '', inverter_power: null, inverter_quantity: null,
  inverter_catalog_id: null, module_brand: '', module_model: '', module_power: null,
  module_quantity: null, module_catalog_id: null,
});

const num = (v: number | null | undefined) => Number(v ?? 0) || 0;

/** Somas do projeto. NUNCA "potência do principal × quantidade total" — ver spec. */
export function totaisDosConjuntos(c: ConjuntoEquipamento[]) {
  const inversoresKw = c.reduce((a, x) => a + num(x.inverter_power) * num(x.inverter_quantity), 0);
  const modulosKwp = c.reduce((a, x) => a + num(x.module_power) * num(x.module_quantity), 0) / 1000;
  const qtdInversores = c.reduce((a, x) => a + num(x.inverter_quantity), 0);
  const qtdModulos = c.reduce((a, x) => a + num(x.module_quantity), 0);
  const totalKwp = inversoresKw > 0 && modulosKwp > 0 ? Math.min(inversoresKw, modulosKwp) : Math.max(inversoresKw, modulosKwp);
  return { inversoresKw, modulosKwp, totalKwp, qtdInversores, qtdModulos };
}

/** O conjunto que representa o projeto nos campos únicos (maior potência; empate pela ordem). */
export function conjuntoPrincipal(c: ConjuntoEquipamento[]): ConjuntoEquipamento | null {
  if (c.length === 0) return null;
  return [...c].sort((a, b) =>
    (num(b.inverter_power) * num(b.inverter_quantity)) - (num(a.inverter_power) * num(a.inverter_quantity))
    || a.ordem - b.ordem)[0];
}

export function useEquipmentSets(projectId?: string) {
  return useQuery({
    queryKey: ['equipment-sets', projectId],
    queryFn: async (): Promise<ConjuntoEquipamento[]> => {
      const { data, error } = await supabase
        .from('project_equipment_sets' as never)
        .select('*').eq('project_id', projectId as string).order('ordem');
      if (error) throw error;
      return (data ?? []) as ConjuntoEquipamento[];
    },
    enabled: !!projectId,
  });
}

/** Grava a lista inteira: remove o que sumiu, grava o resto por ordem. */
export function useSalvarConjuntos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, tenantId, conjuntos }: { projectId: string; tenantId: string; conjuntos: ConjuntoEquipamento[] }) => {
      const comOrdem = conjuntos.map((c, i) => ({ ...c, ordem: i + 1 }));
      const { error: errDel } = await supabase.from('project_equipment_sets' as never)
        .delete().eq('project_id', projectId).gt('ordem', comOrdem.length);
      if (errDel) throw errDel;
      for (const c of comOrdem) {
        const { error } = await supabase.from('project_equipment_sets' as never).upsert({
          project_id: projectId, tenant_id: tenantId, ...c, id: undefined,
        } as never, { onConflict: 'project_id,ordem' } as never);
        if (error) throw error;
      }
    },
    onSuccess: (_d, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['equipment-sets', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'], exact: false });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/hooks/useEquipmentSets.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Carregar os conjuntos junto do projeto**

Em `src/hooks/useProjects.ts`, no `useProject(id)` (a consulta que hoje busca `project_equipment` em `.maybeSingle()`, por volta da linha 182), acrescentar a busca dos conjuntos e devolvê-los em `equipmentSets`:

```ts
// junto das outras consultas em paralelo
supabase.from('project_equipment_sets').select('*').eq('project_id', id).order('ordem'),
```
e no objeto devolvido:
```ts
equipmentSets: (equipmentSetsRes.data ?? []) as unknown as ConjuntoEquipamento[],
```
Acrescentar ao tipo `ProjectWithDetails`:
```ts
  /** Conjuntos (inversor + módulos dele). Um projeto simples tem um só. */
  equipmentSets?: ConjuntoEquipamento[];
```

- [ ] **Step 6: Verificar tipos e commitar**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → **65**
```bash
git add src/hooks/useEquipmentSets.ts src/hooks/useEquipmentSets.test.ts src/hooks/useProjects.ts
git commit -m "feat(equipamentos): hook dos conjuntos (leitura, gravacao e totais)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Componente `ConjuntosEquipamento` e as três telas

**Files:**
- Create: `src/components/equipment/ConjuntosEquipamento.tsx`
- Modify: `src/pages/NewProject.tsx:671-684` (insert do equipamento) e a etapa "Equipamentos"
- Modify: `src/pages/PublicProjectForm.tsx:326-337` (insert do equipamento) e o passo de equipamentos
- Modify: `src/components/projects/ProjectModal.tsx` (bloco `EquipmentBlock` em modo leitura e edição)

**Interfaces:**
- Consumes: `ConjuntoEquipamento`, `conjuntoVazio`, `totaisDosConjuntos`, `useSalvarConjuntos` (Task 2); `EquipmentBrandCombobox`, `EquipmentModelCombobox` (já existem).
- Produces: `export function ConjuntosEquipamento({ conjuntos, onChange, somenteLeitura }: { conjuntos: ConjuntoEquipamento[]; onChange: (c: ConjuntoEquipamento[]) => void; somenteLeitura?: boolean })`.

- [ ] **Step 1: Escrever o componente**

```tsx
// src/components/equipment/ConjuntosEquipamento.tsx
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EquipmentBrandCombobox } from './EquipmentBrandCombobox';
import { EquipmentModelCombobox } from './EquipmentModelCombobox';
import { conjuntoVazio, totaisDosConjuntos, type ConjuntoEquipamento } from '@/hooks/useEquipmentSets';

/**
 * Lista de CONJUNTOS (inversor + os módulos dele). Com um conjunto, a tela é
 * a de sempre; "Adicionar conjunto" é o que atende ampliação/retificação.
 * Usado no novo projeto, no modal e no formulário público.
 */
export function ConjuntosEquipamento({ conjuntos, onChange, somenteLeitura }: {
  conjuntos: ConjuntoEquipamento[];
  onChange: (c: ConjuntoEquipamento[]) => void;
  somenteLeitura?: boolean;
}) {
  const lista = conjuntos.length > 0 ? conjuntos : [conjuntoVazio(1)];
  const t = totaisDosConjuntos(lista);
  const mudar = (i: number, campos: Partial<ConjuntoEquipamento>) =>
    onChange(lista.map((c, k) => (k === i ? { ...c, ...campos } : c)));

  return (
    <div className="space-y-3">
      {lista.map((c, i) => (
        <div key={c.id ?? i} className="rounded-xl border bg-card p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {lista.length > 1 ? `CONJUNTO ${i + 1}` : 'EQUIPAMENTOS'}
            </span>
            {!somenteLeitura && lista.length > 1 && (
              <Button variant="ghost" size="sm" className="ml-auto h-7 px-2"
                onClick={() => onChange(lista.filter((_, k) => k !== i).map((x, k) => ({ ...x, ordem: k + 1 })))}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {(['inverter', 'module'] as const).map(lado => {
              const marca = lado === 'inverter' ? c.inverter_brand : c.module_brand;
              const modelo = lado === 'inverter' ? c.inverter_model : c.module_model;
              const pot = lado === 'inverter' ? c.inverter_power : c.module_power;
              const qtd = lado === 'inverter' ? c.inverter_quantity : c.module_quantity;
              const campo = (n: string) => `${lado}_${n}` as keyof ConjuntoEquipamento;
              return (
                <div key={lado} className="space-y-2">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase">
                    {lado === 'inverter' ? 'Inversor' : 'Módulos'}
                  </p>
                  {somenteLeitura ? (
                    <div className="text-sm">
                      <div className="font-medium">{marca} {modelo}</div>
                      <div className="text-xs text-muted-foreground">
                        {pot ?? '—'} {lado === 'inverter' ? 'kW' : 'Wp'} · {qtd ?? 0} un.
                      </div>
                    </div>
                  ) : (
                    <>
                      <Label className="text-xs">Marca</Label>
                      <EquipmentBrandCombobox
                        type={lado} value={marca}
                        onChange={v => mudar(i, { [campo('brand')]: v } as Partial<ConjuntoEquipamento>)}
                        onTrocarMarca={() => mudar(i, {
                          [campo('model')]: '', [campo('power')]: null, [campo('catalog_id')]: null,
                        } as Partial<ConjuntoEquipamento>)}
                      />
                      <Label className="text-xs">Modelo</Label>
                      <EquipmentModelCombobox
                        type={lado} brand={marca} value={modelo}
                        onType={v => mudar(i, { [campo('model')]: v, [campo('catalog_id')]: null } as Partial<ConjuntoEquipamento>)}
                        onSelect={sel => mudar(i, {
                          [campo('brand')]: sel.brand, [campo('model')]: sel.model,
                          [campo('power')]: sel.power, [campo('catalog_id')]: sel.catalogId ?? null,
                        } as Partial<ConjuntoEquipamento>)}
                        placeholder={marca.trim() ? `Modelos de ${marca.trim()}…` : 'Buscar no catálogo ou digitar…'}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">{lado === 'inverter' ? 'Potência (kW)' : 'Potência (Wp)'}</Label>
                          <Input type="number" value={pot ?? ''}
                            onChange={e => mudar(i, { [campo('power')]: e.target.value === '' ? null : Number(e.target.value) } as Partial<ConjuntoEquipamento>)} />
                        </div>
                        <div>
                          <Label className="text-xs">Quantidade</Label>
                          <Input type="number" value={qtd ?? ''}
                            onChange={e => mudar(i, { [campo('quantity')]: e.target.value === '' ? null : Number(e.target.value) } as Partial<ConjuntoEquipamento>)} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!somenteLeitura && (
        <Button variant="outline" size="sm" className="gap-2"
          onClick={() => onChange([...lista, conjuntoVazio(lista.length + 1)])}>
          <Plus className="w-4 h-4" /> Adicionar conjunto
        </Button>
      )}

      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-900">
        Potência total: {t.totalKwp.toFixed(2)} kWp · {t.qtdModulos} módulos · {t.qtdInversores} inversor{t.qtdInversores === 1 ? '' : 'es'}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Usar no NewProject**

Trocar os campos de equipamento da etapa "Equipamentos" pelo componente, guardando `conjuntos` no estado da página; no envio (linha ~671), **em vez** do insert em `project_equipment`, inserir os conjuntos (o gatilho cria o resumo):

```ts
const { error: setsError } = await supabase.from('project_equipment_sets').insert(
  conjuntos.map((c, i) => upperizeStrings({
    project_id: project.id, tenant_id: tenantId, ordem: i + 1,
    inverter_brand: c.inverter_brand, inverter_model: c.inverter_model,
    inverter_power: c.inverter_power, inverter_quantity: c.inverter_quantity,
    inverter_catalog_id: c.inverter_catalog_id,
    module_brand: c.module_brand, module_model: c.module_model,
    module_power: c.module_power, module_quantity: c.module_quantity,
    module_catalog_id: c.module_catalog_id,
  })),
);
if (setsError) throw setsError;
```

- [ ] **Step 3: Usar no formulário público**

Mesma troca em `src/pages/PublicProjectForm.tsx:326`. O `tenant_id` vem do mesmo lugar que o `project` recém-criado (`project.tenant_id`).

- [ ] **Step 4: Usar no modal**

Em `ProjectModal`, substituir os dois `EquipmentBlock` (inversor e módulos) por um `ConjuntosEquipamento` com `somenteLeitura={!isEditing}`; o estado sai de `form.inverter_*`/`form.module_*` e passa a ser `conjuntos`; o Salvar chama `useSalvarConjuntos()` em vez de mandar equipamento em `updateData` (os campos de equipamento saem do objeto enviado ao `useUpdateProjectData`).

- [ ] **Step 5: Verificar, inclusive a revisão de projeto**

Run: `npm test` → todos passam; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → **65**; `npm run build` → sucesso.

Conferir à mão que o fluxo de **revisão** segue de pé: `NewRevisionDialog`/`useProjectRevisions` tiram uma foto de `project_equipment` (o resumo), que o gatilho mantém — então revisar um projeto com 2 conjuntos continua funcionando, guardando o resumo. **Limitação conhecida e documentada na Task 8:** a revisão guarda o resumo, não os conjuntos; comparar conjunto a conjunto fica para um pedido futuro.

- [ ] **Step 6: Commit**

```bash
git add src/components/equipment/ConjuntosEquipamento.tsx src/pages/NewProject.tsx src/pages/PublicProjectForm.tsx src/components/projects/ProjectModal.tsx
git commit -m "feat(equipamentos): adicionar conjunto no novo projeto, no modal e no formulario publico

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Motor de Engenharia por conjunto

**Files:**
- Create: `src/utils/engineering/conjuntos.ts`
- Create: `src/utils/engineering/conjuntos.test.ts`
- Modify: `src/utils/engineering/templateValues.ts` (aceitar conjuntos)
- Modify: `src/hooks/useValoresDoProjeto.ts` (passar os conjuntos ao motor)

**Interfaces:**
- Consumes: `suggestProjectArrangement(input: ProjectEngineInput, rules: RuleMap): EngineResult`, `InverterSpecs`, `ModuleSpecs`, `EngineAlert` de `src/utils/engineering/rulesEngine.ts`; `ConjuntoEquipamento` (Task 2).
- Produces:
  - `export interface ConjuntoDimensionado { ordem: number; resultado: EngineResult }`
  - `export function dimensionarConjuntos(conjuntos: EntradaConjunto[], rules: RuleMap): { porConjunto: ConjuntoDimensionado[]; alertas: EngineAlert[]; totalInversoresKw: number; totalModulos: number }`
  - `export interface EntradaConjunto { ordem: number; totalModules: number; moduleSpecs: ModuleSpecs; inverters: InverterSpecs[] }`

- [ ] **Step 1: Escrever o teste**

```ts
// src/utils/engineering/conjuntos.test.ts
import { describe, expect, it } from 'vitest';
import { dimensionarConjuntos } from './conjuntos';
import type { RuleMap } from './rulesEngine';

const REGRAS: RuleMap = {} as RuleMap; // sem regras do banco: o motor usa os padrões

describe('dimensionarConjuntos', () => {
  it('dimensiona cada conjunto com o SEU inversor e os SEUS módulos', () => {
    const r = dimensionarConjuntos([
      { ordem: 1, totalModules: 16, moduleSpecs: { powerW: 610, vocV: 41.5, vmpV: 34.5, iscA: 18.6, impA: 17.7 },
        inverters: [{ powerKw: 7.5, mpptCount: 2, stringsPerMppt: 1, mpptVminV: 40, mpptVmaxV: 560, maxDcVoltageV: 600, maxMpptCurrentA: 20, maxAcCurrentA: 32, acPhases: 1 }] },
      { ordem: 2, totalModules: 4, moduleSpecs: { powerW: 610, vocV: 41.5, vmpV: 34.5, iscA: 18.6, impA: 17.7 },
        inverters: [{ powerKw: 2.25, mpptCount: 4, stringsPerMppt: 1, mpptVminV: 16, mpptVmaxV: 55, maxDcVoltageV: 60, maxMpptCurrentA: 18, maxAcCurrentA: 11.4, acPhases: 1 }] },
    ], REGRAS);

    expect(r.porConjunto).toHaveLength(2);
    expect(r.porConjunto[0].ordem).toBe(1);
    expect(r.totalInversoresKw).toBeCloseTo(9.75, 2);
    expect(r.totalModulos).toBe(20);
  });

  it('o alerta diz de qual conjunto é', () => {
    const r = dimensionarConjuntos([
      { ordem: 1, totalModules: 16, moduleSpecs: { powerW: 610 }, inverters: [{ powerKw: 7.5 }] },
      { ordem: 2, totalModules: 0, moduleSpecs: { powerW: 610 }, inverters: [{ powerKw: 2.25 }] },
    ], REGRAS);
    const doDois = r.alertas.filter(a => a.message.startsWith('Conjunto 2:'));
    expect(doDois.length).toBeGreaterThan(0);
  });

  it('um conjunto só: o alerta NÃO ganha prefixo (projeto simples não muda)', () => {
    const r = dimensionarConjuntos([
      { ordem: 1, totalModules: 0, moduleSpecs: { powerW: 610 }, inverters: [{ powerKw: 7.5 }] },
    ], REGRAS);
    expect(r.alertas.every(a => !a.message.startsWith('Conjunto'))).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/utils/engineering/conjuntos.test.ts`
Expected: FAIL — "Failed to resolve import './conjuntos'".

- [ ] **Step 3: Implementar**

```ts
// src/utils/engineering/conjuntos.ts
import { suggestProjectArrangement, type EngineAlert, type EngineResult, type InverterSpecs, type ModuleSpecs, type RuleMap } from './rulesEngine';

/**
 * Dimensionamento com MAIS DE UM conjunto (inversor + módulos dele).
 *
 * Cada conjunto é dimensionado por si: a janela de string sai do datasheet
 * DAQUELE inversor com AQUELE módulo — média entre modelos diferentes não
 * existe em projeto elétrico. O motor de um conjunto continua sendo o mesmo
 * `suggestProjectArrangement`; aqui só se roda uma vez por conjunto e se
 * junta o resultado.
 */
export interface EntradaConjunto {
  ordem: number;
  totalModules: number;
  moduleSpecs: ModuleSpecs;
  /** Um item por inversor físico do conjunto (repetir quando forem iguais). */
  inverters: InverterSpecs[];
}

export interface ConjuntoDimensionado { ordem: number; resultado: EngineResult }

export function dimensionarConjuntos(conjuntos: EntradaConjunto[], rules: RuleMap) {
  const varios = conjuntos.length > 1;
  const porConjunto: ConjuntoDimensionado[] = [];
  const alertas: EngineAlert[] = [];

  for (const c of conjuntos) {
    const resultado = suggestProjectArrangement(
      { totalModules: c.totalModules, moduleSpecs: c.moduleSpecs, inverters: c.inverters }, rules);
    porConjunto.push({ ordem: c.ordem, resultado });
    for (const a of resultado.alerts) {
      alertas.push(varios ? { ...a, message: `Conjunto ${c.ordem}: ${a.message}` } : a);
    }
  }

  const totalInversoresKw = conjuntos.reduce(
    (a, c) => a + c.inverters.reduce((s, i) => s + (i.powerKw ?? 0), 0), 0);
  const totalModulos = conjuntos.reduce((a, c) => a + c.totalModules, 0);

  return { porConjunto, alertas, totalInversoresKw, totalModulos };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/utils/engineering/conjuntos.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Ligar em `engineeringTemplateValues`**

Acrescentar a `EngineeringTemplateInput` (em `src/utils/engineering/templateValues.ts:19-25`) o campo opcional:
```ts
  /** Conjuntos do projeto (quando há mais de um modelo). Vence os campos acima. */
  conjuntos?: EntradaConjunto[] | null;
```
No corpo, quando `input.conjuntos?.length` for maior que 1, usar `dimensionarConjuntos` e montar `arranjo_strings` com uma linha por conjunto (`Conjunto 1: 2 strings de 8`); com 0 ou 1 conjunto, manter exatamente o caminho de hoje.

Em `src/hooks/useValoresDoProjeto.ts`, montar `conjuntos` a partir de `project.equipmentSets` (Task 2) e passar para `engineeringTemplateValues`.

- [ ] **Step 6: Verificar e commitar**

Run: `npm test` (todos), `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → **65**
```bash
git add src/utils/engineering/conjuntos.ts src/utils/engineering/conjuntos.test.ts src/utils/engineering/templateValues.ts src/hooks/useValoresDoProjeto.ts
git commit -m "feat(motor): dimensionamento por conjunto (janela de string do inversor e modulo de cada um)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Unifilar — um ramal por conjunto

**Files:**
- Modify: `src/components/projects/UnifilarTab.tsx:293` (`projectInverters`), `:385-420` (entrada do motor), `:560-620` (legendas, `suggestBreakerPlan`, tabela de dados técnicos)
- Modify: `src/utils/cadEngine/editableLayout.ts` (legenda por ramal)

**Interfaces:**
- Consumes: `dimensionarConjuntos` (Task 4); `ConjuntoEquipamento`, `totaisDosConjuntos` (Task 2); `multiplyInverterBranches`, `inverterCountOf`, `suggestBreakerPlan` (já existem).
- Produces: nenhuma função nova exportada — a mudança é interna à montagem da cena.

- [ ] **Step 1: Trocar a contagem única pela lista de ramais**

Hoje tudo nasce de uma contagem só (`UnifilarTab.tsx:293`):
```ts
const projectInverters = Math.max(1, Number(project.equipment?.inverter_quantity ?? 1) || 1);
```
Passar a derivar a lista dos conjuntos, mantendo o comportamento atual quando há um conjunto:
```ts
/** Um item por inversor FÍSICO, carregando a identidade do conjunto dele. */
const ramaisDoProjeto = useMemo(() => {
  const sets = project.equipmentSets ?? [];
  if (sets.length === 0) {
    const n = Math.max(1, Number(project.equipment?.inverter_quantity ?? 1) || 1);
    return Array.from({ length: n }, () => ({
      conjunto: 1,
      inverterModel: project.equipment?.inverter_model ?? '',
      inverterBrand: project.equipment?.inverter_brand ?? '',
      inverterPowerKw: Number(project.equipment?.inverter_power ?? 0) || undefined,
      moduleModel: project.equipment?.module_model ?? '',
      modules: Math.max(0, Number(project.equipment?.module_quantity ?? 0) || 0),
    }));
  }
  return sets.flatMap(s => Array.from({ length: Math.max(1, Number(s.inverter_quantity ?? 1) || 1) }, (_, k, arr) => ({
    conjunto: s.ordem,
    inverterModel: s.inverter_model, inverterBrand: s.inverter_brand,
    inverterPowerKw: Number(s.inverter_power ?? 0) || undefined,
    moduleModel: s.module_model,
    // os módulos do conjunto divididos entre os inversores iguais dele
    modules: Math.floor(Number(s.module_quantity ?? 0) / arr.length) + (k < Number(s.module_quantity ?? 0) % arr.length ? 1 : 0),
  })));
}, [project.equipmentSets, project.equipment]);
const projectInverters = ramaisDoProjeto.length;
```
Com isso `projectInverters` continua existindo (todos os usos atuais seguem válidos) e cada ramal passa a saber de qual conjunto é.

- [ ] **Step 2: Legendas por ramal e disjuntor geral pela soma**

Em `UnifilarTab.tsx:567`, a legenda do bloco FV deixa de repetir o mesmo modelo:
```ts
const pvLegends = ramaisDoProjeto.map(r => [r.moduleModel].filter(Boolean));
```
e a do inversor (por volta de `:607`) passa a listar por conjunto:
```ts
['Inversores', ramaisDoProjeto.map(r => `${r.inverterBrand} ${r.inverterModel}${r.inverterPowerKw ? ` (${r.inverterPowerKw} kW)` : ''}`).join(' · ')],
```
Em `suggestBreakerPlan` (`:585`), trocar `Array.from({ length: projectInverters }, () => ({ ...invSpecs, powerKw }))` por um item por ramal, cada um com as specs do SEU inversor (buscadas no catálogo por `acharNoCatalogo`, como já é feito hoje para o inversor único). O disjuntor geral continua opcional e somando as correntes — agora de inversores diferentes.

- [ ] **Step 3: Conferir na tela**

Abrir um projeto com 2 conjuntos (criado na Task 3), gerar o unifilar e verificar: 2 ramais, cada um com o seu modelo na legenda, mesmo barramento, e o aviso de cada conjunto identificado. Projeto de um conjunto: cena idêntica à de antes.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/UnifilarTab.tsx src/utils/cadEngine/editableLayout.ts
git commit -m "feat(unifilar): um ramal por conjunto, com o modelo de cada um na legenda

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentos — CEMIG com " + ", Local e data, e o memorial

**Files:**
- Modify: `src/utils/formFill/cemigForm.ts` (valores e mapa de células)
- Modify: `src/utils/formFill/cemigForm.test.ts` (testes contra o modelo real)
- Modify: `src/utils/projectValues.ts` (totais pela soma dos conjuntos; tag nova `equipamentos_lista`)

**Interfaces:**
- Consumes: `ConjuntoEquipamento`, `totaisDosConjuntos`, `conjuntoPrincipal` (Task 2).
- Produces:
  - `export const MODO_MULTI_CONJUNTO: 'soma' = 'soma'` e `export const JUNTOR_CONJUNTOS = ' + '` em `cemigForm.ts`
  - `export function juntarConjuntos(valores: (string | number | null | undefined)[]): string`

- [ ] **Step 1: Escrever os testes**

```ts
// acrescentar em src/utils/formFill/cemigForm.test.ts
import { juntarConjuntos } from './cemigForm';

describe('CEMIG com mais de um conjunto', () => {
  it('une modelo, marca, potência e quantidade com " + " (regra do usuário, 01/10/2026)', () => {
    expect(juntarConjuntos(['ERA-RC66HD 610M', 'GK-4-66HTBD-610M-F'])).toBe('ERA-RC66HD 610M + GK-4-66HTBD-610M-F');
    expect(juntarConjuntos([610, 610])).toBe('610 + 610');
    expect(juntarConjuntos([16, 4])).toBe('16 + 4');
  });

  it('um conjunto só sai sem o " + " (projeto simples não muda)', () => {
    expect(juntarConjuntos(['SG7.5RS-L'])).toBe('SG7.5RS-L');
  });

  it('ignora vazio em vez de deixar " + " solto', () => {
    expect(juntarConjuntos(['SG7.5RS-L', '', null])).toBe('SG7.5RS-L');
  });

  it('Local e data sai com a cidade do projeto (C234)', () => {
    const g = gerar({});   // helper que já existe no arquivo
    expect(celula(g.bytes, 'C234')).toMatch(/UBERABA-MG, \d{1,2} DE [A-ZÇ]+ DE \d{4}/);
  });

  it('totais continuam número somado, não texto com " + "', () => {
    const g = gerar({});
    expect(celula(g.bytes, 'AI116')).not.toContain('+');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/utils/formFill/cemigForm.test.ts`
Expected: FAIL — `juntarConjuntos` não existe.

- [ ] **Step 3: Implementar em `cemigForm.ts`**

```ts
/**
 * Com mais de um conjunto, a CEMIG recebe os valores na MESMA célula unidos
 * por " + " (regra do usuário, 01/10/2026 — a nota da planilha sugere "/";
 * trocar aqui é mudar um caractere). Campos de TOTAL continuam número somado:
 * é o que a planilha confere.
 */
export const JUNTOR_CONJUNTOS = ' + ';

export function juntarConjuntos(valores: (string | number | null | undefined)[]): string {
  return valores
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(v => v !== '')
    .join(JUNTOR_CONJUNTOS);
}
```
Em `valoresFormularioCemig`, quando houver conjuntos, montar `cemig_modelo_modulo`, `cemig_marca_modulo`, `cemig_pot_modulo`, `cemig_qtd_modulos` (e os equivalentes do inversor) com `juntarConjuntos`, e os totais com as somas. Acrescentar ao mapa `FORMULARIO_CEMIG` as células `C234`, `C252` e `C294` com a chave `cemig_local_data`, e em `valoresFormularioCemig`:
```ts
    // "Local e data" da assinatura: cidade do projeto + hoje por extenso
    cemig_local_data: [
      [v.endereco_cidade, v.endereco_estado].filter(Boolean).join('-'),
      new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase(),
    ].filter(Boolean).join(', '),
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/utils/formFill/cemigForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Totais e lista no memorial (`projectValues.ts`)**

`potencia_inversores`, `potencia_total`, `qtd_modulos` e `area_ocupada` passam a sair de `totaisDosConjuntos(project.equipmentSets)` quando houver conjuntos (hoje usam `inverterTotalPower(power, qty)`, que multiplica). Acrescentar a tag `equipamentos_lista` ao catálogo `TEMPLATE_VARIABLES` ("Lista dos conjuntos, um por linha", exemplo `1× SUNGROW SG7.5RS-L + 16× ERA 610 W`) e preenchê-la com uma linha por conjunto — é onde os conjuntos não-principais aparecem no memorial.

- [ ] **Step 6: Verificar e commitar**

Run: `npm test`; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → **65**; `npm run build`.
```bash
git add src/utils/formFill/cemigForm.ts src/utils/formFill/cemigForm.test.ts src/utils/projectValues.ts
git commit -m "feat(documentos): CEMIG com conjuntos unidos por +, Local e data pela cidade, totais somados

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Engenheiro Bidu conhece os conjuntos

**Files:**
- Modify: `supabase/functions/bidu-chat/index.ts` (contexto do projeto)
- Modify: `src/utils/bidu/proporRespostasCemig.ts` (potência somada)
- Create: `supabase/migrations/20261001140000_bidu_habilidade_conjuntos.sql` (habilidade semeada)

**Interfaces:**
- Consumes: `project_equipment_sets` (Task 1), `totaisDosConjuntos` (Task 2).
- Produces: habilidade em `bidu_skills` com título "Projetos com mais de um conjunto".

- [ ] **Step 1: Contexto do Bidu com os conjuntos**

Na montagem do contexto do projeto (`bidu-chat/index.ts`), buscar `project_equipment_sets` e escrever uma linha por conjunto; com um conjunto, manter o texto de hoje.

- [ ] **Step 2: Potência somada na proposta da CEMIG**

Em `proporRespostasCemig.ts`, `ContextoProjetoCemig.potenciaKw` passa a receber a soma dos conjuntos (quem chama é `BiduPanel`, que já calcula do `project.equipment`; passar a usar `totaisDosConjuntos(project.equipmentSets)` quando houver).

- [ ] **Step 3: Semear a habilidade**

```sql
-- supabase/migrations/20261001140000_bidu_habilidade_conjuntos.sql
INSERT INTO public.bidu_skills (tenant_id, titulo, instrucao, created_by)
SELECT t.id, 'Projetos com mais de um conjunto',
  'Quando o projeto tem mais de um conjunto (inversor + módulos dele), os campos únicos do formulário da CEMIG recebem os valores dos conjuntos unidos por " + " na mesma célula (modelo, marca, potência nominal e quantidade). Os campos de TOTAL (potência total dos módulos e dos inversores, potência ativa, área) continuam número somado. ENEL e memorial levam o conjunto principal, e o memorial lista todos.',
  '00000000-b1d0-4000-8000-000000000001'
FROM public.tenants t WHERE t.is_library
  AND NOT EXISTS (SELECT 1 FROM public.bidu_skills s WHERE s.tenant_id = t.id AND s.titulo = 'Projetos com mais de um conjunto');
```

- [ ] **Step 4: Verificar e commitar**

Aplicar a migração (`npx -y supabase db query --linked -f …`), publicar a função (`npx -y supabase functions deploy bidu-chat --project-ref yqsqrdndvsnhbsoaoilf`), rodar `npm test`.
```bash
git add supabase/functions/bidu-chat/index.ts src/utils/bidu/proporRespostasCemig.ts supabase/migrations/20261001140000_bidu_habilidade_conjuntos.sql
git commit -m "feat(bidu): conhece os conjuntos do projeto e a regra do + na CEMIG

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação, memória e aceite

**Files:**
- Modify: `docs/modules/projects/overview.md`, `docs/modules/engineering/overview.md`, `docs/modules/homologation/formulario-cemig.md`
- Modify: memória `equipment-catalog.md` e `engineering-rules-engine.md`

- [ ] **Step 1: Documentar** o modelo (conjuntos + resumo derivado), a regra do " + " na CEMIG, o "Local e data" e o dimensionamento por conjunto.
- [ ] **Step 2: Aceite com o usuário** — criar um projeto de teste com 2 conjuntos, gerar formulário CEMIG, unifilar e pacote, e conferir: totais somados, " + " nos campos de modelo/marca, cidade no "Local e data", 2 ramais no unifilar.
- [ ] **Step 3: Commit e push.**
