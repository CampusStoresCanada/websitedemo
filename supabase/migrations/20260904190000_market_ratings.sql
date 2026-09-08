-- A partner's verdict on the stores in Your Market.
--
-- ── Two axes, never one scale ───────────────────────────────────────────────
--
-- ⛔ "Currently doing business together" is a FACT, not a grade, and it means two
-- opposite things at once: the strongest evidence the engine was right, and a
-- suggestion that is useless to show. Collapsed onto a quality scale, both
-- signals are lost. Same distinction as rating-is-not-the-checkbox on Partner
-- Asks, sharper here: an existing customer is the best label and the worst
-- recommendation on the page.
--
-- ⛔ The three fit values are each defined by a DECISION — would approach / right
-- fit wrong time / not a fit — because a scale whose points have no shared
-- meaning ("two thumbs" vs "one thumb") drifts between raters and fills its
-- middle with hedging.
--
-- ── Append-only ─────────────────────────────────────────────────────────────
--
-- No unique constraint on (partner, member, axis) on purpose: a changed mind is
-- a NEW row. How often a partner flips, and after how long, is worth more than
-- the current value alone. Newest row wins at read time.
--
-- ⚠️ Claims decay, at rates that differ by claim — see lib/match/rating-standing.ts.
-- A verdict with no expiry becomes permanent, because re-confirming it is nobody's
-- job, and a partner who loses an account will never think to come back and
-- un-tick it.
--
-- ── ⛔ COMMERCIALLY SENSITIVE ───────────────────────────────────────────────
--
-- `is_customer` rows are a vendor's customer list. Readable by that partner's own
-- org admins and by CSC admins — nobody else, ever. RLS is on with no policy, so
-- nothing reaches this through a session client; authorization lives in
-- lib/actions/market-ratings.ts, which is the only door.

create table if not exists public.market_ratings (
  id uuid primary key default gen_random_uuid(),

  -- Whose market this is: the partner doing the rating.
  partner_org_id uuid not null references public.organizations (id) on delete cascade,
  -- The store being rated.
  member_org_id  uuid not null references public.organizations (id) on delete cascade,

  axis  text not null check (axis in ('fit', 'relationship')),
  value text not null,

  -- ⛔ Provenance at write time. A verdict is about what the engine said THAT
  -- night at THAT position; without these, a later re-rank would reattribute an
  -- old judgement to a new opinion and credit the engine for a call it never made.
  run_id uuid references public.match_runs (id) on delete set null,
  rank_at_rating integer,

  rated_by uuid references public.contacts (id) on delete set null,
  rated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- ⚠️ The pairing is enforced here rather than trusted from the caller, so a fit
  -- verdict can never be stored as a relationship claim — which would silently
  -- suppress a store from prospecting on the strength of "not a fit".
  constraint market_ratings_axis_value check (
    (axis = 'fit' and value in ('would_approach', 'wrong_time', 'not_a_fit'))
    or (axis = 'relationship' and value in ('is_customer', 'not_customer'))
  )
);

-- The read the panel makes: one partner's verdicts, newest first.
create index if not exists market_ratings_by_pair
  on public.market_ratings (partner_org_id, member_org_id, rated_at desc);

-- The read an evaluation makes: how did one run's rankings fare.
create index if not exists market_ratings_by_run
  on public.market_ratings (run_id) where run_id is not null;

alter table public.market_ratings enable row level security;

comment on table public.market_ratings is
  'A partner rating the stores in Your Market. Append-only; newest row per (pair, axis) wins, and claims decay per lib/match/rating-standing.ts. Commercially sensitive: is_customer is a vendor customer list. Service-role only; authorization in lib/actions/market-ratings.ts.';

-- ── Who is actually making the claim ────────────────────────────────────────
--
-- ⛔ `rated_by` alone is not enough, and the gap is silent. It resolves a contact
-- AT THE PARTNER ORG, which is right for a partner's own admin and null for CSC
-- staff — who have no contact row there. So every CSC rating stored as an
-- anonymous row indistinguishable from the partner's own.
--
-- That distinction is the whole value of the table. A partner saying "already a
-- customer" is ground truth about their own book of business; CSC staff saying it
-- is an educated guess. An evaluation that cannot separate them is measuring its
-- own assumptions.
alter table public.market_ratings
  add column if not exists rated_as text
    check (rated_as in ('org_admin', 'csc_admin')),
  -- Always set, unlike rated_by: the acting login, whoever they are.
  add column if not exists rated_by_profile uuid;

comment on column public.market_ratings.rated_as is
  'Who made this claim: the partner''s own admin, or CSC staff on their behalf. A partner saying "already a customer" is ground truth; CSC guessing is an opinion, and an evaluation that cannot tell them apart is measuring the wrong thing.';

comment on column public.market_ratings.rated_by_profile is
  'The acting login. Always set, unlike rated_by — a CSC admin has no contact row at the partner org, so contact-scoped attribution silently loses them.';
