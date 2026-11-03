-- A staff ruling on one element of someone's assigned schedule.
--
-- CANCOLL's MOU (8.6) needs three outcomes per element, not two: attended,
-- delegate absent, and EXCUSED, when the partner or CSC did not show. Scans
-- can only say "attended". A ruling is one more row in the same record the
-- check-in cards and the door already write, so attendance stays one table:
-- confirmed_by = 'staff', who ruled (checked_in_by), on whom (person_id), on
-- which meeting (schedule_id) or event (entity_id). The latest ruling wins
-- over scans. A cancelled meeting needs no ruling: its schedule row says so.
--
-- Additive: every existing row has no ruling and is confirmed by nobody, the
-- attendee or the exhibitor, so it passes both checks unchanged.

alter table public.conference_check_in_events
  drop constraint conference_check_in_events_confirmed_by_check,
  add constraint conference_check_in_events_confirmed_by_check
    check (confirmed_by is null or confirmed_by in ('attendee', 'exhibitor', 'staff')),
  add column ruling text,
  add column ruling_note text,
  add constraint conference_check_in_events_ruling_check check (
    (ruling is null and confirmed_by is distinct from 'staff')
    or (
      ruling in ('attended', 'absent', 'excused')
      and confirmed_by = 'staff'
      and checked_in_by is not null
      and person_id is not null
      and (schedule_id is not null or entity_id is not null)
    )
  );

comment on column public.conference_check_in_events.ruling is
  'A staff ruling on one element of someone''s assigned schedule (a meeting, or an event such as the CANCOLL AGM). The latest ruling wins over scans. Excused = the partner or CSC did not show (CANCOLL MOU 8.6).';
