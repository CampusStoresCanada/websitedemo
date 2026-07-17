-- addConferenceAttendee() (v3 seat-assignment attendee creation) inserts
-- source_type = 'manual', but the original CHECK constraint on
-- conference_people never included 'manual' in its allowed values. Every
-- call to addConferenceAttendee() has therefore always failed with a
-- check-constraint violation. This adds 'manual' as a fourth legitimate
-- source_type, alongside the existing registration/staff/entitlement rows.

alter table public.conference_people
  drop constraint conference_people_source_type_check;

alter table public.conference_people
  add constraint conference_people_source_type_check
  check (source_type in ('registration', 'staff', 'entitlement', 'manual'));
