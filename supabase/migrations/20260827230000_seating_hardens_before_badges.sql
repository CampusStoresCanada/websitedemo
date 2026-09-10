-- Seating must harden a week before badges print.
--
-- Steve, 2026-08-27: "make it a week prior. I know that is going to be a pain,
-- but otherwise I am going to be sending crap badges that are going to reprint
-- and there's nothing I can do about it."
--
-- Before this, "Assign your booth staff" inherited 11 January — the same day as
-- "Check your badge details are right" AND the pre-print run, despite being the
-- prerequisite for both. A person cannot check a badge for a seat their org has
-- not given them.
--
-- The week is the person's window to look at what prints. It is tight on
-- purpose: the alternative is badges printed from stale names and reprinted at
-- the desk, which is a cost with no remedy once the run has gone.
update conference_checklist_tasks set
  deadline_at = '2027-01-04',
  hardens_because = 'badges print from whoever is named — anyone seated after this gets a reprint at the desk instead of a badge in the box'
where name in ('Assign your booth staff', 'Assign your social event tickets');
