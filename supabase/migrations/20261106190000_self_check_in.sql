-- Self check-in (lib/conference/self-check-in.ts): an attendee checks
-- themselves in with their emailed QR, at a kiosk or on their own phone.
--
-- ⛔ NULL is OFF. Every conference keeps NULL until an admin saves settings, so
-- nothing changes for any conference by this migration.
alter table public.conference_instances
  add column if not exists self_check_in jsonb;

comment on column public.conference_instances.self_check_in is
  'Self check-in settings (normalizeSelfCheckIn). NULL = off. {kiosk, phone, ending, bins, note}.';

-- How someone came to be checked in: 'self' is the attendee themselves, at a
-- kiosk or on their phone. The scan event still says how (qr) and which device.
alter table public.conference_people
  drop constraint conference_people_check_in_source_check;
alter table public.conference_people
  add constraint conference_people_check_in_source_check
  check (check_in_source = any (array['badge_pickup', 'manual', 'self']));
