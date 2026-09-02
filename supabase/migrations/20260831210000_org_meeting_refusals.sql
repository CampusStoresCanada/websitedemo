-- A refusal to meet, between two organizations, that outlives any one event.
--
-- Why this table exists: a blackout is a HUMAN relationship fact — "they failed
-- to deliver fourteen years ago and it cost us money." No matching algorithm can
-- infer it. Until now it lived as a text[] on conference_registrations, which
-- means it was scoped to a single registration for a single conference: a grudge
-- typed in for 2027 was gone for 2028, and if the person forgot to re-type it,
-- the scheduler cheerfully booked the meeting.
--
-- Grain is the ORG PAIR, not the conference. One row survives across years.
--
-- Symmetrical by design: a partner can fire a customer. Either side declaring
-- the other blocks the pair. Enforcement (lib/scheduler/blackout.ts) checks both
-- directions; this table stores one direction per row, so a mutual refusal is
-- two rows and each side can retire its own independently.
create table if not exists public.org_meeting_refusals (
  id uuid primary key default gen_random_uuid(),

  declaring_org_id uuid not null references public.organizations(id) on delete cascade,
  refused_org_id   uuid not null references public.organizations(id) on delete cascade,

  -- Who actually said it. The org admin holds the pen, but the buyer carrying
  -- the history is often not that person, and attribution matters when someone
  -- asks a year later why this meeting never happens.
  declared_by_contact_id uuid references public.contacts(id) on delete set null,
  reason text,

  first_declared_at timestamptz not null default now(),

  -- The annual heartbeat. NULL means never reaffirmed since first declaration.
  --
  -- ⚠️ Reaffirmation does NOT gate enforcement. An unreaffirmed refusal stays in
  -- force; only retired_at turns one off. Lapsing-to-off would mean a refusal
  -- silently becomes permission because nobody clicked a button once a year,
  -- which is the exact failure this table exists to prevent. Stale rows surface
  -- in the pre-run review instead, where a human can retire them deliberately.
  reaffirmed_at timestamptz,

  -- They changed their mind. The ONLY thing that ends enforcement.
  retired_at timestamptz,
  retired_by_contact_id uuid references public.contacts(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint org_meeting_refusals_not_self check (declaring_org_id <> refused_org_id),
  constraint org_meeting_refusals_retired_after_declared
    check (retired_at is null or retired_at >= first_declared_at)
);

-- One live refusal per direction per pair. Retired rows are kept as history, so
-- the partial index lets a retired refusal be re-declared later.
create unique index if not exists org_meeting_refusals_active_pair
  on public.org_meeting_refusals (declaring_org_id, refused_org_id)
  where retired_at is null;

create index if not exists org_meeting_refusals_declaring_active
  on public.org_meeting_refusals (declaring_org_id)
  where retired_at is null;

create index if not exists org_meeting_refusals_refused_active
  on public.org_meeting_refusals (refused_org_id)
  where retired_at is null;

comment on table public.org_meeting_refusals is
  'Standing org-to-org refusals to meet. Grain is the org pair, not the event. Enforcement reads this table directly and never a match score. Reaffirmed annually; only retired_at ends enforcement.';

-- RLS on with no policies: service role only. Every write goes through
-- createAdminClient(). A session client would otherwise get 0 rows and a null
-- error, which reads as success.
alter table public.org_meeting_refusals enable row level security;
