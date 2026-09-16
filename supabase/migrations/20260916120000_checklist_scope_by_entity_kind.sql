-- A checklist about booths has to be able to say "whoever holds a booth".
--
-- scope_entity_id names ONE entity, and booths are 60 individually numbered
-- ones across two archetypes — so the column could not express the scope the
-- Exhibitor checklist actually has. With it left null, scoping fell back to
-- "every org with any entity_balance", which on 2026-09-16 put 11 member stores
-- and 1 staff org — none of them holding a booth — into the population for
-- "Order power and AV from Encore" and "Place your Stronco order".
--
-- scope_entity_kind is the missing grain: the scope is a CLASS of thing held,
-- not a particular one. The two are AND-ed when both are set, so narrowing to a
-- single entity still works.

alter table conference_checklists
  add column if not exists scope_entity_kind text;

comment on column conference_checklists.scope_entity_kind is
  'Scope this checklist to orgs holding any entity of this kind (e.g. ''booth''). '
  'AND-ed with scope_entity_id when both are set. Null = no kind restriction.';

-- The Exhibitor checklist is about exhibiting: power, AV, freight, booth staff.
update conference_checklists
   set scope_entity_kind = 'booth',
       updated_at = now()
 where name = 'Exhibitor'
   and scope_entity_kind is null;
