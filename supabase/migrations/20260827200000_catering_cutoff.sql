-- Dietary counts are due before registration closes, not with it.
--
-- The obligation engine mapped meal_access's dietary requirement to the
-- `registration_close` symbol, because that was the only symbol with a date
-- behind it. For CSC 2027 that rendered "by 31 January" — thirteen days after
-- the caterer actually needs the numbers. A deadline that is wrong in the
-- generous direction is worse than none: people plan to it.
--
-- Steve, 2026-08-27: "Dietary restrictions are needed by January 18th, 2027 for
-- this conference, or ASAP there after." The second half matters — this is a
-- soft cutoff. A late answer is still useful and still gets passed to the
-- caterer, so the UI says so rather than implying the door has closed.
alter table conference_instances
  add column if not exists catering_cutoff date;

comment on column conference_instances.catering_cutoff is
  'Date the caterer needs final dietary counts. Soft: late answers are still '
  'useful and still passed on, which is why the UI says "or as soon as you can '
  'after". Distinct from registration_close — catering locks earlier.';

update conference_instances
set catering_cutoff = '2027-01-18'
where year = 2027 and edition_code = '99' and catering_cutoff is null;
