-- A deadline belongs to the task, not the list it sits on.
--
-- Found live: every task on the Exhibitor checklist rendered "Closes January
-- 11" because that is the CHECKLIST's date — while the Encore card printed
-- directly beneath said 18 January and Stronco's first date is 30 December.
-- The row header contradicted the supplier facts inside it, on the same screen.
alter table conference_checklist_tasks
  add column if not exists deadline_at date;

comment on column conference_checklist_tasks.deadline_at is
  'This task''s own due date, overriding the checklist''s. Tasks on one list '
  'genuinely differ — Stronco''s pre-show pricing ends 10 Jan, Encore''s '
  'advance rate 18 Jan. NULL means inherit the checklist''s date.';

-- The pre-printed badge run.
--
-- Steve, 2026-08-27: run goes 11 January 2027, and "badge pickup is always at
-- the conference" — so this is SOFT. Missing it means collecting at the
-- registration desk rather than finding your badge in the box, which is worth
-- saying out loud instead of implying a door has closed.
alter table conference_instances
  add column if not exists badge_preprint_at date;

comment on column conference_instances.badge_preprint_at is
  'Day the pre-printed badge run goes. Soft — pickup is always on site, so a '
  'late correction means collecting at the desk. Drives badge_print.';

update conference_instances set badge_preprint_at = '2027-01-11'
where year = 2027 and edition_code = '99' and badge_preprint_at is null;

-- Supplier tasks carry their supplier's date, not the list's.
update conference_checklist_tasks set deadline_at = '2027-01-18'
where name = 'Order power and AV from Encore' and deadline_at is null;
update conference_checklist_tasks set deadline_at = '2027-01-10'
where name = 'Place your Stronco order' and deadline_at is null;

-- Badges are a CHECK, not a collection. Everything on one is already on file;
-- what is needed is someone confirming the spelling of their name, their job
-- title and their organisation before the run.
insert into conference_checklist_tasks
  (checklist_id, name, description, check_type, sort_order, active, audience, deadline_at)
select cl.id,
  'Check your badge details are right',
  'Your badge is printed from what we already hold — the spelling of your name, your job title, and your organisation. Have a look and correct anything that is wrong. The print run goes 11 January; after that you can still fix it, you will just collect your badge at the registration desk rather than finding it in the box.',
  'self_reported', 1, true, 'person', '2027-01-11'
from conference_checklists cl
where cl.name = 'Your Conference'
  and not exists (
    select 1 from conference_checklist_tasks t
    where t.checklist_id = cl.id and t.name = 'Check your badge details are right');
