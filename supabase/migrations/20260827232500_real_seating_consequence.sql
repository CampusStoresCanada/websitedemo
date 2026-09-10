-- The real cost of not seating staff: nobody can find them.
--
-- Steve, 2026-08-27: "the cost is that they aren't listed for our members to
-- find. Which like...that's on them. They don't have to do it, it is just a
-- pain in my ass and I will resent them."
--
-- Printing was the smaller half and I had led with it. An unnamed seat produces
-- no conference_people row at all, so that person cannot appear in the printed
-- directory's people section or in the map's person search, whatever they later
-- consent to. Naming is necessary before consent is even a question.
--
-- Stated as a consequence, not a scolding. It IS their choice; the copy's job
-- is making sure it is an informed one.
update conference_checklist_tasks set
  hardens_because = 'anyone you have not named is not in the attendee list members use to find who to meet — and their badge is printed on site rather than in advance'
where name = 'Assign your booth staff';

-- Different thing entirely, and it was sharing the badge wording by accident:
-- an event ticket with no holder is an unusable seat and a wrong catering count.
update conference_checklist_tasks set
  hardens_because = 'tickets with nobody on them cannot be used, and the catering and door lists are built from these names'
where name = 'Assign your social event tickets';
