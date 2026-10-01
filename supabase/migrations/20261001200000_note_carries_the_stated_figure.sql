-- A note can now carry the figure it is about, not only prose about it.
--
-- Wherever the survey CALCULATES a number, a store may state a different one
-- and say why. The why is the thing that has to travel: it is published in the
-- appendices beside the figure, which benchmarking_notes already does through
-- its secretary and respondent decisions. What it could not do was hold the
-- number, so an override had nowhere to live except a free-text sentence
-- nobody could total.
--
-- ⛔ BOTH values are kept. computed_value is what the survey worked out from
-- the answers; stated_value is what the store says it actually is. Storing only
-- the override would make a correction indistinguishable from an original
-- answer, and the committee's whole job on a flagged figure is to see the
-- difference and rule on it.
--
-- Nullable, because the overwhelming majority of notes are prose about a figure
-- rather than a replacement for one.

alter table public.benchmarking_notes
  add column if not exists stated_value   numeric,
  add column if not exists computed_value numeric;

comment on column public.benchmarking_notes.stated_value is
  'What the store says the figure is, when overriding a calculated one. Null for an ordinary explanatory note.';
comment on column public.benchmarking_notes.computed_value is
  'What the survey calculated at the moment of the override, kept so the difference stays visible.';
