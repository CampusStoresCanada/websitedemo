-- Prospect calls join the same contact log as renewal and booth calls.
--
-- Same reasoning as 20260912090000_booth_outreach_outcomes: what a call was
-- about is answerable from its outcome, and a second table would split one
-- organization's history across two places. A prospect who joins keeps the
-- record of how they were recruited.
--
-- Widens the check only; no existing row changes.

alter table public.renewal_contact_log
  drop constraint if exists renewal_contact_log_outcome_check;

alter table public.renewal_contact_log
  add constraint renewal_contact_log_outcome_check
  check (outcome = any (array[
    -- Renewal conversation
    'renewing'::text,
    'not_renewing'::text,
    -- Booth conversation
    'booking_booth'::text,
    'not_exhibiting'::text,
    -- Prospect conversation
    'joining'::text,
    'not_interested'::text,
    -- Any conversation
    'undecided'::text,
    'no_response'::text,
    'other'::text
  ]));

comment on column public.renewal_contact_log.outcome is
  'What the person said. Renewal asks use renewing/not_renewing; booth asks use booking_booth/not_exhibiting; prospect asks use joining/not_interested; undecided/no_response/other apply to all.';
