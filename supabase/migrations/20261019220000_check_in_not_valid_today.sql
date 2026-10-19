-- A scan can be refused because the badge does not cover today.
--
-- A Thursday day pass picked up on Tuesday is refused at the desk (Stephen,
-- 2026-10-19) and the refusal is logged like every other scan result.
-- Widening only: every existing row still satisfies the new rule.
alter table public.conference_check_in_events
  drop constraint if exists conference_check_in_events_result_state_check;

alter table public.conference_check_in_events
  add constraint conference_check_in_events_result_state_check
  check (result_state = any (array[
    'valid'::text, 'already_checked_in'::text, 'invalid_token'::text,
    'revoked_token'::text, 'not_found'::text, 'legal_not_accepted'::text,
    'not_valid_today'::text
  ]));
