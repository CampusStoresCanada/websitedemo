-- A human saying whether a ranking was any good.
--
-- ── Why this is a separate table ────────────────────────────────────────────
--
-- ⛔ NOT columns on `ask_recommendations`. That table is the ENGINE'S output: it
-- is upserted every night and its stale rows are retracted, so a judgement
-- living there would be destroyed by the next run that happened to re-rank. The
-- engine owns its opinions; a human's verdict on those opinions is a different
-- kind of fact with a different lifetime, and the job must not be able to erase
-- it. Same reason a human's correction INSERTs rather than upserts.
--
-- ── Why it is worth having at all ──────────────────────────────────────────
--
-- The send loop only ever labels the partners we EMAIL — the silent ones. The
-- ten-odd candidates per ask who are already active in Circle get ranked and
-- then filtered out, judged by nobody, even though they are exactly the
-- candidates a human can assess instantly. This captures that for free, with no
-- email involved:
--
--     shown → chosen → replied     costs an email and a wait
--     shown → judged               costs one click
--
-- ⚠️ EVALUATION DATA, not a training input, and not a score. Nothing in the
-- ranking path may read this table. The engine must never eat its own output,
-- and a verdict on the engine's output is exactly that once it is fed back —
-- the ranking would start agreeing with whatever it was last told, and the
-- agreement would look like accuracy. See project_unified_match_engine.

create table if not exists public.ask_judgements (
  id uuid primary key default gen_random_uuid(),

  -- What was judged. Not FK'd to ask_recommendations: that row may be retracted
  -- when the candidate drops out of the top set, and the judgement stays true
  -- about the ranking it was made against.
  ask_ref text not null,
  candidate_org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_contact_id uuid references public.contacts (id) on delete set null,

  -- ⛔ Which ranking was being judged, captured at write time. A verdict is about
  -- what the engine said THAT night at THAT position. Without these, a later
  -- re-rank would silently reattribute an old judgement to a new opinion, and the
  -- evaluation would credit the engine for a call it never made.
  run_id uuid references public.match_runs (id) on delete set null,
  rank_at_judgement integer,

  -- 'good'  — this partner could genuinely answer this question
  -- 'bad'   — wrong; the engine misread the question or the partner
  -- 'unsure'— deliberately available, so a hesitant human is not forced into a
  --           confident answer that the evaluation would then treat as certain
  verdict text not null check (verdict in ('good', 'bad', 'unsure')),

  judged_by uuid references public.contacts (id) on delete set null,
  judged_at timestamptz not null default now(),

  -- ⚠️ Append-only. A changed mind is a NEW row, not an edit: how often a verdict
  -- flips, and after how long, is itself worth knowing, and an UPDATE would erase
  -- exactly that. Readers take the most recent row per candidate.
  created_at timestamptz not null default now()
);

-- The read a screen makes: every verdict for one ask, newest first.
create index if not exists ask_judgements_by_ask
  on public.ask_judgements (ask_ref, judged_at desc);

-- The read an evaluation makes: how did one run's rankings fare.
create index if not exists ask_judgements_by_run
  on public.ask_judgements (run_id) where run_id is not null;

-- ⛔ RLS on with no policy — service-role only, like the rest of the signal
-- spine. This is a named person's judgement of a colleague-facing suggestion;
-- nothing reaches it through a session client.
alter table public.ask_judgements enable row level security;

comment on table public.ask_judgements is
  'Human verdicts on engine rankings. Append-only; latest row per candidate wins. Evaluation data only — never read by the ranking path. Service-role only.';
