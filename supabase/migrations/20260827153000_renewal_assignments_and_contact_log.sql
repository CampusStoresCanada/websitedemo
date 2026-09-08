-- Who owns the conversation with each organization about renewing, and what
-- was actually said.
--
-- The renewal reminder cron already chases everybody by email. What it cannot
-- do is hear a member say "we nearly left over the Circle migration" — and that
-- sentence is worth more next August than any paid/unpaid flag. These two
-- tables exist to capture it.
--
-- Scoped to (organization, renewal_year), never to a contact. A renewal
-- conversation belongs to the STORE across whoever happens to answer the phone;
-- people move between member institutions and a narrative attached to a person
-- would walk out of the door with them. It is also why this is not
-- contacts.notes — that column is per person, and per-person notes carry
-- consent implications that an internal renewal record does not.
--
-- Cycle-scoped so a year's story stays a year's story. Reading last year's
-- narrative is a deliberate act (query the prior renewal_year), not something
-- that silently bleeds into this year's call list.

create table if not exists public.renewal_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- Cycle-start year PLUS ONE, matching renewal_events.renewal_year and
  -- lib/renewal/season.ts. A Sept 2026 → Aug 2027 cycle is 2027.
  renewal_year     integer not null,
  assigned_to      uuid references public.profiles(id) on delete set null,
  assigned_by      uuid references public.profiles(id) on delete set null,
  assigned_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One owner per org per cycle. Shared ownership is how a call ends up made
  -- twice or not at all.
  unique (organization_id, renewal_year)
);

create index if not exists renewal_assignments_assignee_idx
  on public.renewal_assignments(assigned_to, renewal_year);
create index if not exists renewal_assignments_year_idx
  on public.renewal_assignments(renewal_year);

comment on table public.renewal_assignments is
  'One owner per (organization, renewal cycle) for personal renewal outreach. Coverage — how many outstanding orgs are assigned and contacted — is the board-facing measure, since it is the part the board controls.';

create table if not exists public.renewal_contact_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  renewal_year     integer not null,
  contacted_at     timestamptz not null default now(),
  contacted_by     uuid references public.profiles(id) on delete set null,
  -- How the contact happened. 'email' here means a PERSONAL email someone sat
  -- down and wrote, not the automated reminder series — those are already
  -- recorded as renewal_events and must not be conflated with human contact,
  -- or coverage becomes 100% the moment the cron runs.
  channel          text not null check (channel in ('call', 'email', 'in_person', 'text', 'other')),
  -- Where the conversation left things. Deliberately coarse: the value of this
  -- table is the note, and a long picklist just invites mis-filing.
  outcome          text not null check (outcome in ('renewing', 'undecided', 'not_renewing', 'no_response', 'other')),
  note             text,
  created_at       timestamptz not null default now()
);

create index if not exists renewal_contact_log_org_year_idx
  on public.renewal_contact_log(organization_id, renewal_year, contacted_at desc);
create index if not exists renewal_contact_log_year_idx
  on public.renewal_contact_log(renewal_year, contacted_at desc);

comment on table public.renewal_contact_log is
  'What was actually said, per organization per renewal cycle. Append-only by intent: a second conversation is a second row, so the arc of a renewal stays legible rather than being overwritten by its latest state.';

alter table public.renewal_assignments  enable row level security;
alter table public.renewal_contact_log  enable row level security;

-- All access is server-side through createAdminClient, matching board_votes.
-- Granting to `authenticated` without a matching policy returns zero rows with
-- a null error — a write that reports success and does nothing — so the grant
-- is withheld rather than half-made.
revoke all on public.renewal_assignments from anon, authenticated;
revoke all on public.renewal_contact_log from anon, authenticated;
grant select, insert, update, delete on public.renewal_assignments to service_role;
grant select, insert, update, delete on public.renewal_contact_log to service_role;
