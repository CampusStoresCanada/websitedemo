-- A scan row said WHO scanned WHOM but not where it went, so the four
-- directions were indistinguishable after the fact: a lead capture, a Circle
-- introduction and an org lookup all looked identical. The destination is part
-- of the act — it is what the scanner's device was actually sent to — so it is
-- recorded here rather than re-derived later from org types that may since have
-- changed.
alter table conference_badge_scans
  add column if not exists outcome text;

alter table conference_badge_scans
  drop constraint if exists conference_badge_scans_outcome_check;

alter table conference_badge_scans
  add constraint conference_badge_scans_outcome_check
  check (outcome is null or outcome in ('self', 'org', 'circle', 'disclosure'));

create index if not exists conference_badge_scans_outcome_idx
  on conference_badge_scans (conference_id, outcome);
