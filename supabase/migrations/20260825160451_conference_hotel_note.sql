-- A free-text note under the hotel rates.
--
-- Real room-block details carry facts that aren't a rate: what the rates
-- exclude (HST), parking, which nights the block actually covers, and who to
-- contact to book outside it. Forcing those into rate labels makes the rate
-- list unreadable, and giving each its own column guesses wrong about the
-- next hotel's quirks. One note the admin writes covers all of them.
--
-- Plain text, not HTML — it is rendered as React nodes with emails and URLs
-- linkified, so nothing admin-entered is ever injected as markup.

alter table public.conference_instances
  add column if not exists hotel_note text;

comment on column public.conference_instances.hotel_note is
  'Free-text note shown under the hotel rates — tax treatment, parking, block dates, who to contact for stays outside the block. Plain text; rendered with emails/URLs linkified.';
