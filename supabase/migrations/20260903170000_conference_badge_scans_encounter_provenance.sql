-- Was this scan engineered by us, or did these two find each other?
--
-- A scan inside a meeting the solver booked is close to NO evidence of a good
-- match: the solver seats groups of up to four against an occupancy objective,
-- so some of those people shared a table because the table had a spare chair.
-- The match-scoring work will EXCLUDE those from training rather than discount
-- them. An organic scan — a booth, a hallway, the bar, nobody scheduled it — is
-- independent evidence of affinity and the most valuable outcome data this
-- system produces.
--
-- ⛔ NOT NULL with NO DEFAULT. A default is silently wrong the first time
-- someone wires a scanner inside a scheduled meeting, and by then the rows are
-- unfixable. The writer must answer.
--
-- ⛔ Set at SCAN TIME, never derived afterwards. Schedules MUTATE: they belong
-- to a scheduler_run, a new run can be promoted mid-conference, and swaps
-- rewrite the active run's rows in place. Derived later, a scan that was
-- organic on Tuesday reads as scheduled on Wednesday and nothing errors when it
-- flips.
alter table conference_badge_scans
  add column if not exists encounter text not null
    check (encounter in ('scheduled', 'organic'));

-- The run in effect when the judgement was made — recorded for BOTH outcomes,
-- not only 'scheduled'. Null means no run was active at scan time (today that
-- is every scan: schedules has 0 rows). Keeping it for 'organic' is what makes
-- organic a checkable claim rather than an assertion: you can go back to the
-- exact schedule that existed and confirm the pair really was not in it.
alter table conference_badge_scans
  add column if not exists scheduler_run_id uuid references scheduler_runs(id);

create index if not exists conference_badge_scans_encounter_idx
  on conference_badge_scans (conference_id, encounter);
