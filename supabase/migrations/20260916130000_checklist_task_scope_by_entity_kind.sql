-- The scope belongs on the TASK, not the checklist.
--
-- 20260916120000 put scope_entity_kind='booth' on the Exhibitor checklist. That
-- is too blunt: the checklist is mixed. Of its six org tasks, only two are
-- genuinely about having a booth —
--
--   Order power and AV from Encore   self_reported   ← booth
--   Place your Stronco order         self_reported   ← booth
--   Assign your booth staff          seat_assigned   ← self-scoping
--   Assign your social event tickets seat_assigned   ← self-scoping
--   Complete conference payment      payment_complete← every attending org
--   Accept partner legal agreement   legal_document_accepted ← tier-aware
--
-- The checks already carry their own scope: `seat_assigned` returns done when
-- the org holds nothing of that kind, and `legal_document_accepted` resolves
-- the documents by conference tier. Only the two `self_reported` ones ask a
-- human a question that has no meaning without a booth — a self-report has
-- nothing to read, so nothing can scope it but a declared scope.
--
-- Scoping the whole checklist to booths would have stopped the 11 member stores
-- attending CSC 2027 being reminded to PAY, which is the opposite of the bug.

alter table conference_checklist_tasks
  add column if not exists scope_entity_kind text;

comment on column conference_checklist_tasks.scope_entity_kind is
  'Show this task only to orgs holding an entity of this kind (e.g. ''booth''). '
  'Null = ask whoever the checklist reaches. For self_reported tasks, which have '
  'nothing to read and so cannot scope themselves.';

update conference_checklist_tasks t
   set scope_entity_kind = 'booth',
       updated_at = now()
  from conference_checklists c
 where c.id = t.checklist_id
   and c.name = 'Exhibitor'
   and t.check_type = 'self_reported'
   and t.scope_entity_kind is null;

-- And hand the checklist back its full population.
update conference_checklists
   set scope_entity_kind = null,
       updated_at = now()
 where name = 'Exhibitor';
