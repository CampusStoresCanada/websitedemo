-- WHERE A PICK CAME FROM. Requested by the match-engine session, 2026-09-02.
--
-- ⛔ Without this the corpus is permanently ambiguous. If we suggest partner P
-- to member M, M picks P off that list, and P's Top-5-ness then raises the M↔P
-- score, the engine has learned from its own output — it converges on whatever
-- it already believed, confidently, and the failure is invisible once it starts.
-- A pick typed in cold is independent evidence; a pick off our own suggestions
-- is confirmation of us. Nothing can tell them apart after the fact.
--
-- This is the same rule as "the engine must never eat its own output", applied
-- one level earlier: at the point the act is RECORDED, not the point it is read.
--
-- Free today (0 rows) and impossible later, which is why it goes in now rather
-- than when a suggested list actually exists.
alter table public.conference_top_choices
  add column if not exists chosen_from text;

alter table public.conference_top_choices
  drop constraint if exists conference_top_choices_chosen_from_check;

-- Three named sources rather than free text, because the whole value is being
-- able to split them reliably. 'search' and 'browse' are both cold; they are
-- kept apart anyway so a later question about discovery has an answer.
alter table public.conference_top_choices
  add constraint conference_top_choices_chosen_from_check
  check (chosen_from is null or chosen_from in ('suggested', 'search', 'browse'));

comment on column public.conference_top_choices.chosen_from is
  'Where the pick came from. ''suggested'' = off a list WE ranked; ''search''/''browse'' = the person found it themselves. The load-bearing split is suggested vs everything else: a pick off our own suggestions is confirmation of the recommender, not independent evidence, and feeding it back as affinity is how a recommender converges on what it already believed. Null only for rows written before this column existed (there are none).';
