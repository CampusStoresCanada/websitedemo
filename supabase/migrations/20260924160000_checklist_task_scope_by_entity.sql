-- Ask only the orgs holding THIS thing.
--
-- 20260916130000 gave a task `scope_entity_kind`, which answers "whoever has a
-- booth". It cannot answer "whoever bought the Hot Products Care Package":
-- that entity's kind is `item`, shared with folding tables and chairs, so
-- scoping by kind would ask every exhibitor to ship a care package they never
-- bought. Same failure the kind column was added to fix, one grain finer.
--
-- The two are AND-ed, so a task can say "a booth" or "this exact thing" or both.
--
-- `entity_purchased` already reads entity_balances for one entity id, but that
-- is a CHECK — "have you done it" — and this is a SCOPE — "should we ask you".
-- Different questions: a scoped-out task must not appear at all, whereas a
-- failed check appears as outstanding.

alter table conference_checklist_tasks
  add column if not exists scope_entity_id uuid references conference_entities(id) on delete set null;

comment on column conference_checklist_tasks.scope_entity_id is
  'Show this task only to orgs holding this specific entity (bought, or granted '
  'by an includes ref). AND-ed with scope_entity_kind. Null = no entity restriction.';

create index if not exists conference_checklist_tasks_scope_entity_id_idx
  on conference_checklist_tasks (scope_entity_id)
  where scope_entity_id is not null;
