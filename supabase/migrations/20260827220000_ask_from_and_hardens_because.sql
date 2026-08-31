-- A due date is not a cue to start asking.
--
-- Steve, 2026-08-27: "the due date isn't when we should start reminding
-- people....its when the results become a bigger pain in the ass to change. We
-- want that stuff to lead in, not be fall out. We want them to do that
-- tomorrow, not in January."
--
-- The whole reminder model was deadline-anchored: checkpoints are
-- days_before_deadline, per checklist, so every nudge is fallout from a date by
-- construction. The Exhibitor checkpoints fire 27 Nov, 21 Dec and 4 Jan. Nothing
-- in the system could ask tomorrow.
--
-- It showed. "Assign your booth staff" and "Check your badge details are right"
-- both landed on 11 January — the same day as each other AND as the pre-print
-- run — even though the first is a prerequisite for the second. 150 registration
-- seats are sold across 34 orgs; 2 are named. Nobody can check a badge for a
-- person their org never seated.
alter table conference_checklist_tasks
  add column if not exists ask_from date,
  add column if not exists hardens_because text;

comment on column conference_checklist_tasks.ask_from is
  'When we START asking. Independent of deadline_at, which is when the thing '
  'gets painful to change. NULL means ask as soon as the checklist is active.';

comment on column conference_checklist_tasks.deadline_at is
  'When this HARDENS — the point after which changing it costs someone real '
  'effort or money. Not the date to start asking; see ask_from. NULL inherits '
  'the checklist''s date.';

comment on column conference_checklist_tasks.hardens_because is
  'What actually changes at deadline_at, in the reader''s terms — "badges go '
  'to print", "pre-show pricing ends". A date with no consequence attached '
  'reads as arbitrary and invites deferral.';

update conference_checklist_tasks set
  ask_from = current_date,
  hardens_because = 'your staff need time to check their own badge details before the print run'
where name in ('Assign your booth staff', 'Assign your social event tickets')
  and ask_from is null;

update conference_checklist_tasks set
  hardens_because = 'badges go to print, and anyone unnamed collects theirs at the registration desk'
where name = 'Check your badge details are right' and hardens_because is null;

update conference_checklist_tasks set
  hardens_because = 'the advance rate ends and on-site rates apply — about 15% more'
where name = 'Order power and AV from Encore' and hardens_because is null;

update conference_checklist_tasks set
  hardens_because = 'pre-show discount pricing ends and standard rates apply'
where name = 'Place your Stronco order' and hardens_because is null;

update conference_checklist_tasks set
  hardens_because = 'our room block at the Hilton Airport closes'
where name = 'Book your hotel room' and hardens_because is null;
