-- The Supabase half of the match engine.
--
-- ── Where things live ───────────────────────────────────────────────────────
--
-- The RAW behavioural log does NOT live here. `signal_events` and
-- `recommendation_impressions` are person-level, and they live in local Postgres
-- on the M1 Mac Studio (see supabase/local/signal-log.sql), which is backed up
-- three ways. Person-level data on owned hardware is a stronger position than
-- RLS-with-no-policy in a cloud database, and far easier to write a notice about.
--
-- Supabase holds three things and nothing else:
--
--   signal_inbox     a WRITE-ONLY queue. The one thing Vercel can reach, because
--                    a serverless function cannot push to a machine on a LAN.
--                    The Mac drains it nightly and empties it. It never grows.
--   *_rollup         org-grained derived signal, pushed back by the Mac.
--                    No contact column exists, so person-level detail has
--                    nowhere to leak to.
--   match_runs/edges the engine's output, which is what the website reads.
--
-- ── ⛔ A score may never decide who meets whom ──────────────────────────────
--
-- A refusal is a human relationship fact that no algorithm can infer. Nothing in
-- match_edges enforces anything: consumers filter on the declared refusal
-- itself, before and independently of any score.

-- ── The inbox ───────────────────────────────────────────────────────────────

create table if not exists public.signal_inbox (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),

  -- 'signal'     — a person did something
  -- 'impression' — we showed them a ranked candidate
  kind             text not null check (kind in ('signal','impression')),

  -- ⛔ SERVER-ATTRIBUTED, NEVER taken from a request body.
  --
  -- Columns rather than payload fields on purpose: they are the security-relevant
  -- part, they are what an audit would ask about, and a foreign key means a
  -- forged org id cannot even be stored. The write path derives them from the
  -- session (lib/signals/inbox.ts) — if a caller could supply them, anyone could
  -- forge "Algonquin searched for X".
  actor_org_id     uuid references public.organizations(id) on delete cascade,
  actor_contact_id uuid references public.contacts(id) on delete set null,

  -- Idempotency at the DOOR, so a retried request, a double-fired effect or a
  -- replayed webhook cannot enqueue the same act twice.
  -- ⚠️ Keyed on the ACT, never the object: `circle:like:{post}:{member}`, not
  -- `circle:post:{id}`. Keying on the object is how a system stops noticing that
  -- likes kept accruing for months.
  dedupe_key       text unique,

  -- The act itself, unresolved. Resolution to taxonomy terms happens on the Mac,
  -- where the resolver version is authoritative and can be re-run over history.
  -- Resolving at the edge would bake today's vocabulary into the record.
  payload          jsonb not null,

  -- ── Drain bookkeeping ────────────────────────────────────────────────────
  --
  -- If nothing fires, rows accumulate and the queue waits. The Mac can be asleep
  -- for a week and nothing is lost — that is designed, not a failure mode.
  --
  -- ⛔ A DRAINED ROW IS DELETED, NOT MARKED.
  --
  -- This is a security property, not tidiness. Against an attacker holding a
  -- stolen credential, the question is "how much does one connection get them",
  -- and the answer must be *one drain interval of traffic*, not the entire
  -- behavioural history of every member. A `drained_at` column that leaves rows
  -- in place would quietly turn a transient queue into a second permanent copy
  -- of the log — in the cloud, which is exactly where we decided it should not
  -- live. The durable copy is on the Mac; this is a letterbox.
  --
  -- `claimed_by` is also a TRIPWIRE: the drain writes a known machine
  -- identifier, so a value nobody recognises means a second party is draining.
  claimed_at       timestamptz,
  claimed_by       text
);

-- The drain's working index: oldest first. Every row present is pending, because
-- drained rows are gone.
create index if not exists signal_inbox_pending_idx
  on public.signal_inbox (received_at);

-- Stale-claim detection and the tripwire.
create index if not exists signal_inbox_claimed_idx
  on public.signal_inbox (claimed_at, claimed_by);

-- An audit trail of drains that holds NO signal — just who drained, when, and
-- how much. Enough to prove the pipeline ran and to spot an unexpected drainer,
-- without becoming the copy of the log we just moved off the cloud.
create table if not exists public.signal_inbox_drains (
  id           uuid primary key default gen_random_uuid(),
  drained_at   timestamptz not null default now(),
  claimed_by   text not null,
  row_count    integer not null,
  oldest_row_at timestamptz,
  newest_row_at timestamptz
);

create index if not exists signal_inbox_drains_recent_idx
  on public.signal_inbox_drains (drained_at desc);

-- ── ⛔ NO CLAIM FUNCTION, DELIBERATELY ──────────────────────────────────────
--
-- An earlier draft shipped `claim_signal_inbox()` as SECURITY DEFINER. That is
-- the wrong shape and it is worth writing down why, because six functions in
-- this database already have it and it is the live exfiltration pattern here:
--
--   SECURITY DEFINER runs as the owner and therefore BYPASSES RLS, and every
--   function in `public` is exposed by PostgREST as /rest/v1/rpc/<name>. So the
--   moment EXECUTE reaches `authenticated` — a convenience GRANT in some future
--   migration is all it takes — any logged-in user can call it and receive
--   actor_org_id, actor_contact_id and raw_text for EVERY organisation. It also
--   sets claimed_at, so the same call denies the real drain its rows for an hour.
--
-- Revoking EXECUTE would have worked until someone ran
-- `grant execute on all functions in schema public to authenticated`, and then
-- it would have failed silently and permanently.
--
-- The drain does not need it. The Mac connects over direct Postgres as a
-- least-privilege role and runs the claim itself:
--
--   -- claim
--   update signal_inbox
--      set claimed_at = now(), claimed_by = $1
--    where id in (select id from signal_inbox
--                  where claimed_at is null or claimed_at < now() - interval '1 hour'
--                  order by received_at limit $2
--                  for update skip locked)
--   returning *;
--   -- ...copy into the local log, then, in the same transaction as the local commit:
--   delete from signal_inbox where id = any($3);
--   insert into signal_inbox_drains (claimed_by, row_count, oldest_row_at, newest_row_at) ...
--
-- Same atomicity, same skip-locked semantics, no RLS bypass, and no RPC endpoint
-- for anyone to find.
--
-- ⚠️ That role must NOT be service_role. Service role bypasses RLS on everything
-- and would put a full-database credential on a desktop machine. It needs
-- exactly:
--   grant select, update (claimed_at, claimed_by), delete on signal_inbox to csc_drain;
--   grant insert on signal_inbox_drains to csc_drain;
--   grant select, insert, update, delete on signal_term_rollup, signal_affinity_rollup to csc_drain;
--   grant select, insert, update on match_runs, match_edges to csc_drain;
--   grant select on organizations, contacts to csc_drain;
-- and nothing else. A compromised Mac then cannot read invoices, benchmarking,
-- ballots or anything else.

-- ── Derived signal, pushed back by the Mac ──────────────────────────────────
--
-- ⚠️ Org-grained by construction. There is deliberately NO contact column: the
-- person-level detail exists only in the local log, so nothing downstream has
-- anywhere to put it even by accident.

create table if not exists public.signal_term_rollup (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  term             text not null,
  term_source      text not null,
  -- ⚠️ Part of the key. Explicit and implicit must never share a bucket: a store
  -- can browse a vendor often AND have refused them, and netting those into one
  -- number destroys both facts.
  stance           text not null default 'implicit' check (stance in ('implicit','explicit')),
  polarity         text not null default 'positive' check (polarity in ('positive','negative')),
  weight           numeric not null,
  event_count      integer not null,
  -- A count, never an identity. Enough to say "8 stores", never who.
  actor_count      integer not null default 0,
  first_seen_at    timestamptz,
  last_seen_at     timestamptz,
  computed_at      timestamptz not null default now(),
  primary key (organization_id, term, term_source, stance, polarity)
);

create table if not exists public.signal_affinity_rollup (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  object_org_id    uuid not null references public.organizations(id) on delete cascade,
  stance           text not null default 'implicit' check (stance in ('implicit','explicit')),
  polarity         text not null default 'positive' check (polarity in ('positive','negative')),
  weight           numeric not null,
  event_count      integer not null,
  actor_count      integer not null default 0,
  last_seen_at     timestamptz,
  computed_at      timestamptz not null default now(),
  primary key (organization_id, object_org_id, stance, polarity),
  constraint signal_affinity_not_self check (organization_id <> object_org_id)
);

create index if not exists signal_term_rollup_term_idx
  on public.signal_term_rollup (term, weight desc);
create index if not exists signal_affinity_object_idx
  on public.signal_affinity_rollup (object_org_id, weight desc);

-- ── Engine output ───────────────────────────────────────────────────────────

create table if not exists public.match_runs (
  id                    uuid primary key default gen_random_uuid(),
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  status                text not null default 'running'
                        check (status in ('running','complete','failed','promoted','superseded')),

  -- Weights are DATA, snapshotted per run, so any historical score can be
  -- explained by the weights that actually produced it rather than by whatever
  -- the code happens to say today.
  weights               jsonb not null,

  -- ⚠️ Vectors are only comparable within one model. Recording which one produced
  -- the run is what stops a Voyage edge being compared against a local one.
  embedding_model       text,
  -- The vocabulary the terms were resolved under, so a run can be reproduced.
  resolver_version      text,

  counts                jsonb,
  notes                 text,
  promoted_at           timestamptz,
  promoted_by           uuid references public.profiles(id)
);

-- Exactly one promoted run at a time: the website reads "the current answer",
-- and two of those is not a state anyone should have to reason about.
create unique index if not exists match_runs_single_promoted_idx
  on public.match_runs ((status = 'promoted')) where status = 'promoted';

create table if not exists public.match_edges (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.match_runs(id) on delete cascade,

  direction        text not null
                   check (direction in ('member_to_partner','partner_to_member',
                                        'member_to_member','partner_to_partner')),

  subject_org_id   uuid not null references public.organizations(id) on delete cascade,
  candidate_org_id uuid not null references public.organizations(id) on delete cascade,

  -- `ranking` from the engine — fit quality discounted by how much we actually
  -- know. ⚠️ NOT the raw score: a pair matching on one axis and silent on every
  -- other scores 100, so sorting on that puts the orgs we know nothing about on
  -- top. See matchTotal() in lib/match/score.ts.
  total            numeric not null,
  score            numeric not null,
  confidence       numeric not null,
  rank             integer not null,

  breakdown        jsonb not null,

  -- ⛔ SPLIT ON PURPOSE. `reasons` holds ONLY what may be shown; anything the
  -- subject hid behind a `show_*` visibility toggle goes in `reasons_withheld`.
  --
  -- The earlier shape kept both in one array behind a `citable` flag, which
  -- meant the protection was a function call (citableReasons) that nothing
  -- enforced — one `select reasons` in one component and a match explanation
  -- discloses exactly what a member set a toggle to conceal. Splitting makes the
  -- default path safe by construction, the same way the rollups have no contact
  -- column rather than a rule about not selecting it.
  reasons          jsonb not null,
  reasons_withheld jsonb not null default '[]'::jsonb,

  created_at       timestamptz not null default now(),
  unique (run_id, direction, subject_org_id, candidate_org_id),
  constraint match_edges_not_self check (subject_org_id <> candidate_org_id)
);

create index if not exists match_edges_lookup_idx
  on public.match_edges (run_id, direction, subject_org_id, rank);
create index if not exists match_edges_candidate_idx
  on public.match_edges (run_id, direction, candidate_org_id);

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- RLS on, NO POLICY, on purpose. A GRANT without a policy yields zero rows and
-- no error — normally a footgun, here exactly the intent. Every one of these is
-- service-role only until a specific surface needs it, so exposure is a decision
-- rather than a default.

alter table public.signal_inbox           enable row level security;
alter table public.signal_inbox_drains    enable row level security;
alter table public.signal_term_rollup     enable row level security;
alter table public.signal_affinity_rollup enable row level security;
alter table public.match_runs             enable row level security;
alter table public.match_edges            enable row level security;

-- ⚠️ RLS is the control, but it is one toggle. An explicit revoke means that if
-- RLS is ever disabled on one of these — by a migration, by a restore, by
-- someone debugging — the grants still block anon and authenticated instead of
-- the table becoming world-readable the moment the toggle flips.
revoke all on public.signal_inbox           from anon, authenticated;
revoke all on public.signal_inbox_drains    from anon, authenticated;
revoke all on public.signal_term_rollup     from anon, authenticated;
revoke all on public.signal_affinity_rollup from anon, authenticated;
revoke all on public.match_runs             from anon, authenticated;
revoke all on public.match_edges            from anon, authenticated;

comment on table public.signal_inbox is
  'Transient write-only queue from the app to the local match engine. SERVICE ROLE ONLY. Drained rows are DELETED, not marked — a stolen credential must yield one drain interval, not the whole history. actor_org_id/actor_contact_id are server-attributed and must never be accepted from a request body. Rows accumulate safely when nothing drains.';
comment on table public.match_edges is
  'Engine output. `total` is ranking (fit discounted by confidence), never the raw score. Nothing here enforces anything — declared refusals are applied by consumers, independently.';
