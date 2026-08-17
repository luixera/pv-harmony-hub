-- ═══════════════════════════════════════════════════════════════════════════
-- As etapas novas entram no quadro de TODOS os modelos de Kanban existentes,
-- e a etapa `approval` — que existia no banco mas não aparecia em nenhum
-- quadro — passa a aparecer.
--
-- `stale_days` ganha um valor de partida por etapa: é o prazo que a régua de
-- cobrança vai usar ("aprovado parado há N dias"). Estava em branco em todas
-- as colunas, ou seja, a detecção de parado não tinha o que comparar. Os
-- números abaixo são ponto de partida — o usuário ajusta pela tela.
--
-- Idempotente: só insere o que falta e só define prazo onde ainda é nulo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Reabre espaço na ordem para as etapas novas ─────────────────────────
update public.kanban_columns set order_index = 10 where status_key = 'completed';
update public.kanban_columns set order_index = 7  where status_key = 'vistoria_solicitada';

-- ── 2. Etapas que faltavam no quadro ───────────────────────────────────────
insert into public.kanban_columns
  (kanban_model_id, status_key, status_label, color, order_index,
   is_initial, is_final, is_rejection_stage, triggers_revision, requires_protocol, stale_days)
select m.id, novo.status_key, novo.status_label, novo.color, novo.order_index,
       false, false, novo.is_rejection_stage, false, novo.requires_protocol, novo.stale_days
  from public.kanban_models m
 cross join (values
   -- a etapa de aprovação já existia no enum e não estava em quadro nenhum
   ('approval',               'Aprovação',              'bg-kanban-progress', 4,  false, false, 10),
   -- o buraco do acompanhamento: aprovado, esperando o cliente instalar
   ('aguardando_instalacao',  'Aguardando Instalação',  'bg-kanban-progress', 6,  false, false, 7),
   -- vistoria aberta mas o protocolo não chegou à distribuidora
   ('vistoria_sem_protocolo', 'Vistoria sem Protocolo', 'bg-kanban-pending',  8,  false, true,  3),
   -- vistoria negada: precisa de intervenção, é etapa de reprovação
   ('vistoria_reprovada',     'Vistoria Reprovada',     'bg-kanban-rejected', 9,  true,  false, 2)
 ) as novo(status_key, status_label, color, order_index, is_rejection_stage, requires_protocol, stale_days)
 where not exists (
   select 1 from public.kanban_columns c
    where c.kanban_model_id = m.id and c.status_key = novo.status_key
 );

-- ── 3. Prazos de "parado" nas etapas que já existiam ───────────────────────
update public.kanban_columns set stale_days = v.dias
  from (values
    ('pending', 3), ('documentation', 7), ('analysis', 10),
    ('pendencia', 5), ('approved', 5), ('vistoria_solicitada', 15)
  ) as v(chave, dias)
 where kanban_columns.status_key = v.chave
   and kanban_columns.stale_days is null;

select status_key, status_label, order_index, stale_days, is_rejection_stage
  from public.kanban_columns
 order by kanban_model_id, order_index;
