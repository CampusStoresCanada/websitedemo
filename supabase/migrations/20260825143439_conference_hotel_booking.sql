-- Hotel booking details for a conference instance.
--
-- The public "Where you'll be staying" widget (components/conference/HotelInfo.tsx)
-- carried a hardcoded nightly rate and a "booking link will be live soon" note.
-- These columns move that copy into data an admin can edit, so the link can go
-- live mid-cycle without a deploy.
--
-- Deliberately NOT part of the draft-locked conference detail fields
-- (CONFERENCE_UPDATE_FIELDS in lib/actions/conference.ts): venue, dates and tax
-- are decisions that should freeze once a conference leaves draft, whereas the
-- room block link, its rates and its cutoff all change while the conference is
-- live and on sale. Edited through lib/actions/manage-conference-hotel.ts, the
-- same way `documents` is.

alter table public.conference_instances
  add column if not exists hotel_booking_url text,
  add column if not exists hotel_booking_cutoff date,
  add column if not exists hotel_rates jsonb not null default '[]'::jsonb;

comment on column public.conference_instances.hotel_booking_url is
  'Room-block booking link. NULL means "not live yet" — the public widget shows a check-back note instead of a button.';
comment on column public.conference_instances.hotel_booking_cutoff is
  'Last date the room-block rate can be booked. Past this date the public widget stops promoting the rate.';
comment on column public.conference_instances.hotel_rates is
  'Array of {id, label, rate_cents, note?} — one row per room type, rendered in display order.';
