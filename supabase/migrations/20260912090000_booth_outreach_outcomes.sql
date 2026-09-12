-- Booth outcomes for the renewal contact log.
--
-- The board now divides up two kinds of call, not one. A partner who has
-- already renewed but holds no booth at the conference currently on sale is
-- still work — just a different ask — and the existing outcome vocabulary
-- could not record how it went: "Says they'll renew" and "Not renewing" are
-- the wrong sentences for a booth conversation, and forcing one of them into
-- the record would be writing an interpretation nobody said.
--
-- Additive only. Every existing value stays legal and no stored row changes
-- meaning, so this is safe to apply before the code that can write the new
-- values ships.
--
-- The log stays one table keyed to (organization, renewal_year). Which kind of
-- call a row describes is answerable from the outcome itself, and splitting the
-- table would mean a director's history with a partner lived in two places.

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
    -- Either conversation
    'undecided'::text,
    'no_response'::text,
    'other'::text
  ]));

comment on column public.renewal_contact_log.outcome is
  'What the person said. Renewal asks use renewing/not_renewing; booth asks use booking_booth/not_exhibiting; undecided/no_response/other apply to both.';
