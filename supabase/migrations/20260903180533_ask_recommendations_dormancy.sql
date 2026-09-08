-- Silence, stored beside the score as a fact.
--
-- ⛔ Deliberately NOT folded into `similarity`. If dormancy moved the score,
-- "they are quiet" and "they are a good fit" would be the same number and no
-- screen could say which it was reacting to. The engine ranks; the surface
-- filters. Same split as blackouts, the new-partner spotlight, and top choices.

alter table public.ask_recommendations
  add column if not exists candidate_last_spoke_at timestamptz,
  add column if not exists answered_this_ask boolean not null default false;

comment on column public.ask_recommendations.candidate_last_spoke_at is
  'When this candidate last posted or commented anywhere in Circle. NULL = never, which is the whole point: 70 of 80 partners have never spoken. Stored as a FACT, not a score — the surface decides what to do with silence.';

comment on column public.ask_recommendations.answered_this_ask is
  'They already replied to this question. Emailing them "go answer this" is noise.';
