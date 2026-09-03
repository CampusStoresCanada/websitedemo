-- What the engine suggested for a member's question, and what a human did next.
--
-- ── Why this table is the point ─────────────────────────────────────────────
--
-- This site runs several small recommendation engines and none of them can be
-- told whether they work. Partner Asks is the one surface where the whole loop
-- closes on live data:
--
--   shown     the engine put these candidates in front of an admin
--   chosen    the admin picked a subset            ← a human judging our list
--   replied   some of those answered the question  ← the outcome
--
-- shown ⊇ chosen ⊇ replied, and each narrowing is a labelled fact we could
-- never otherwise obtain. The conference gives us the same loop 151 days from
-- now; this one is available today.
--
-- ⛔ THE MOST VALUABLE ROW IS THE ONE WE DID NOT RECOMMEND. An admin adding a
-- candidate the engine never surfaced is a labelled MISS — the engine was wrong
-- and a human corrected it in public. Those rows are worth more than every hit,
-- so this table holds them as first-class rather than only recording our own
-- suggestions and how they fared.

create table if not exists public.ask_recommendations (
  id uuid primary key default gen_random_uuid(),

  -- The Circle post being answered. Not an FK: Circle owns those ids and a post
  -- can be deleted there while our record of what we recommended stays true.
  ask_ref text not null,

  -- Which match run produced this. Null when a human added the candidate.
  run_id uuid references public.match_runs (id) on delete set null,

  candidate_org_id uuid not null references public.organizations (id) on delete cascade,
  -- The person worth contacting, when the engine has a view. Null = org-grain.
  candidate_contact_id uuid references public.contacts (id) on delete set null,

  -- ⛔ Recorded at WRITE time, never derived later. Whether the engine
  -- recommended this candidate is a fact about the moment the admin was looking
  -- at the screen. Re-running the engine tomorrow must not retroactively turn a
  -- human's correction into something we take credit for — the same trap as
  -- deriving scheduled-vs-organic from a schedule that moves.
  recommended boolean not null,
  -- Position in the list the admin saw. Null when not recommended.
  rank integer,
  -- Raw cosine. Null when not recommended.
  similarity numeric,
  -- The single act that best matched, quoted — why this candidate was surfaced.
  reason text,

  -- ── what the human did ──────────────────────────────────────────────────
  selected_at timestamptz,
  selected_by uuid references public.contacts (id) on delete set null,

  -- ── what happened ───────────────────────────────────────────────────────
  -- Derived from Circle: did anyone at this org comment on the ask afterwards.
  -- Filled by the nightly job, never by the surface.
  replied_at timestamptz,

  created_at timestamptz not null default now(),

  -- One row per candidate per ask. Re-running the engine updates rather than
  -- stacking, and a human's selection lands on the same row as the suggestion.
  constraint ask_recommendations_unique unique (ask_ref, candidate_org_id, candidate_contact_id),

  -- ⚠️ A recommendation carries its rank and score; a human addition does not.
  -- Enforced so the two can never be confused when the loop is scored.
  constraint ask_recommendations_shape check (
    (recommended and rank is not null and similarity is not null)
    or (not recommended and rank is null and similarity is null)
  )
);

-- The read the surface makes: this ask's candidates, best first.
create index if not exists ask_recommendations_by_ask
  on public.ask_recommendations (ask_ref, rank);

-- The read the evaluation makes: everything we showed in one run.
create index if not exists ask_recommendations_by_run
  on public.ask_recommendations (run_id) where run_id is not null;

-- ⛔ RLS on with no policy — service-role only, like the rest of the signal
-- spine. This records what an engine guessed and what a named admin decided;
-- it is operational judgement, not member-facing data, and nothing reaches it
-- through a session client.
alter table public.ask_recommendations enable row level security;

comment on table public.ask_recommendations is
  'Partner Asks: what the match engine surfaced, what the admin chose, who replied. The feedback loop for the recommender. Service-role only.';

comment on column public.ask_recommendations.recommended is
  'Recorded at write time. False = a human added a candidate the engine missed, which is the most informative row here.';
