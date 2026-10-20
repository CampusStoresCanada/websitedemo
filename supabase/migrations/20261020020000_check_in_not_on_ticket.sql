-- A door scan of someone whose access does not reach the event.
--
-- The event door (lib/conference/door.ts) lets them in and invoices: enforcement
-- is off by default (check-in model, 2026-09-08). The row records that they
-- were in the room without the event on their ticket, so the desk can offer
-- the sale and the attendance count still includes them.
-- Widening only: every existing row still satisfies the new rule.
alter table public.conference_check_in_events
  drop constraint if exists conference_check_in_events_result_state_check;

alter table public.conference_check_in_events
  add constraint conference_check_in_events_result_state_check
  check (result_state = any (array[
    'valid'::text, 'already_checked_in'::text, 'invalid_token'::text,
    'revoked_token'::text, 'not_found'::text, 'legal_not_accepted'::text,
    'not_valid_today'::text, 'not_on_ticket'::text
  ]));
