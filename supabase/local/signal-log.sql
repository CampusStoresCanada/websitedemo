-- The raw behavioural log. Runs on the M1 Mac Studio, NOT on Supabase.
--
-- This is the irreplaceable half of the system. Scores recompute in
-- milliseconds; an act cannot be re-observed. Everything here is person-level,
-- which is precisely why it lives on owned hardware that is mirrored locally,
-- onsite and to an encrypted offsite copy, rather than in a cloud database.
--
--   psql "$LOCAL_DATABASE_URL" -f supabase/local/signal-log.sql
--
-- Nothing in Supabase reads these tables. The nightly job drains
-- public.signal_inbox into signal_events, resolves, rolls up, scores, and pushes
-- ONLY derived output back — rollups and match_edges, both org-grained.

create table if not exists signal_events (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null,

  source           text not null
                   check (source in ('website','circle','email','conference','print')),

  verb             text not null
                   check (verb in (
                     -- Deliberate statements of preference
                     'refused','preferred','selected','rejected',
                     -- Things people did
                     'searched','filtered','viewed','clicked',
                     'posted','commented','joined','rsvped',
                     'attended','opened','scanned')),

  -- ⚠️ Implicit and explicit must NEVER be averaged. A meeting that merely got
  -- scheduled is implicit; a declared refusal is explicit and enormously
  -- stronger. Both rollups key on these so the two cannot share a bucket.
  stance           text not null check (stance in ('implicit','explicit')),
  polarity         text not null check (polarity in ('positive','negative')),

  -- ⛔ NULLABLE. An unattributed act is still an act: a human searched for
  -- something while signed out, and "how many people wanted this" is answerable
  -- without knowing who they were. Rollups skip rows with no actor, so these
  -- cost the scoring nothing and are the least sensitive rows here.
  actor_org_id     uuid,
  -- The sensitive half. Nulled by the retention pass once the event stops
  -- scoring — see lib/signals/retention.ts. Drop the person before the text.
  actor_contact_id uuid,

  object_type      text,
  object_org_id    uuid,
  object_ref       text,

  -- ⛔ The act, not the interpretation. An event whose words resolve to nothing
  -- is KEPT: nine of twelve realistic campus-store queries resolve to nothing
  -- today, and demand with no category yet is the most useful thing we collect.
  raw_text         text,

  terms            text[] not null default '{}',
  term_source      text check (term_source in ('exact','synonym','space','category','semantic')),
  -- Which vocabulary produced `terms`. Adding one synonym should retroactively
  -- improve every event that word ever appeared in; without this, re-resolution
  -- is archaeology instead of a nightly pass.
  resolver_version text,

  weight           numeric not null default 1 check (weight >= 0),
  dedupe_key       text unique,
  created_at       timestamptz not null default now(),

  -- An org acting on itself is not an affinity.
  constraint signal_events_not_self check (object_org_id is null or object_org_id <> actor_org_id),
  -- Nothing to score now and nothing to re-resolve later is telemetry, not signal.
  constraint signal_events_has_content
    check (array_length(terms, 1) > 0 or object_org_id is not null or nullif(btrim(raw_text), '') is not null)
);

create index if not exists signal_events_actor_idx     on signal_events (actor_org_id, occurred_at desc);
create index if not exists signal_events_object_idx    on signal_events (object_org_id, occurred_at desc);
create index if not exists signal_events_terms_idx     on signal_events using gin (terms);
create index if not exists signal_events_stale_idx     on signal_events (resolver_version) where raw_text is not null;
create index if not exists signal_events_retention_idx on signal_events (verb, occurred_at);

-- What we SHOWED, as opposed to what a person did.
--
-- ⛔ The engine must never eat its own output. A meeting the solver created is
-- evidence of the solver, not of affinity — it belongs here, and only the human
-- act that follows (a swap, a kept slot, a typed reason) belongs in
-- signal_events. Aggregates over this table answer "you appeared in 12
-- recommendations, shown to 8 stores"; the individual rows never surface.
create table if not exists recommendation_impressions (
  id                uuid primary key default gen_random_uuid(),
  match_run_id      uuid,
  surface           text not null,
  direction         text,
  subject_org_id    uuid,
  candidate_org_id  uuid not null,
  -- Enables "shown to 8 stores" without ever naming anyone.
  viewer_contact_id uuid,
  rank              integer,
  score             numeric,
  -- Without these you learn "Login was picked once"; with them you learn "Login
  -- is right for notebooks". Expensive to add later.
  context_terms     text[] not null default '{}',
  shown_at          timestamptz not null default now(),
  dedupe_key        text unique
);

create index if not exists rec_impressions_candidate_idx on recommendation_impressions (candidate_org_id, shown_at desc);
create index if not exists rec_impressions_subject_idx   on recommendation_impressions (subject_org_id, shown_at desc);

-- Where the last drain got to, so a run that dies mid-flight resumes rather
-- than restarting or skipping.
create table if not exists drain_watermarks (
  source        text primary key,
  last_drained_at timestamptz,
  last_cursor   text,
  updated_at    timestamptz not null default now()
);
