-- Association elections: governance bodies, nominations, ballots, tabulation.
--
-- Generalized deliberately. CSC is the first tenant, not the shape: every rule
-- that could be amended by a future by-law (seat count, term length, consecutive
-- term cap, the 120/90/60/30-day countbacks, how many co-signers a nomination
-- needs, who may vote) lives in `elections.config` as a snapshotted jsonb blob
-- resolved from the policy engine, never as a constant in code or a CHECK here.
--
-- The snapshot is the whole point. CSC is redrafting By-Law No. 1. When the new
-- text lands it becomes a new published policy set; elections already run stay
-- pinned to the config they opened under, so a result from 2027 still re-tallies
-- under the 2027 rules rather than silently acquiring 2029's.
--
-- Terminology note: By-Law No. 1 (2014) Part III S2(b) gives the vote to a single
-- "Primary Store Contact" per Member Store. That term is deprecated in practice
-- and the practice is not going back -- member stores have insisted on multiple
-- administrators, several current directors among them. So the electorate here is
-- org admins, plural, and the constraint that actually matters is enforced where
-- it belongs: ONE ballot per institution, co-editable by any of its admins.
-- `config.electorate_rule` records which rule an election ran under.

-- ---------------------------------------------------------------------------
-- Institution type -- for the nominating committee's representation lens.
-- Nullable override only. The derived guess (from the org name) is computed at
-- read time by lib/elections/representation.ts, so no guessed value is ever
-- written over real records; this column holds ONLY what a human confirmed.
-- Mirrors the existing fte_is_manual_override convention on this table.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists institution_type text
    check (institution_type in ('university','college','polytechnic','institute','other'));

comment on column public.organizations.institution_type is
  'Human-confirmed institution type. NULL means "use the name-derived guess" -- see lib/elections/representation.ts deriveInstitutionType(). Never auto-backfilled.';


-- ---------------------------------------------------------------------------
-- Governance bodies and who sits on them
-- ---------------------------------------------------------------------------
create table if not exists public.governance_bodies (
  id                    uuid primary key default gen_random_uuid(),
  key                   text not null unique,
  name                  text not null,

  -- Null where the body has no fixed size (a committee). For the CSC board the
  -- Articles fix this at 9; By-Law Part IV S1 expects the number to be set by
  -- Ordinary Resolution of the members within the Articles' min/max.
  seat_count            integer,
  term_length_years     integer,
  -- By-Law Part IV S2 caps directors at three consecutive terms. NULL = no cap.
  max_consecutive_terms integer,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.governance_role_assignments (
  id                uuid primary key default gen_random_uuid(),
  body_id           uuid not null references public.governance_bodies(id) on delete cascade,

  -- Identity anchor is the profile where one exists, because a contact row is
  -- keyed (person, org) and a director who changes employers gets a NEW contact
  -- row -- which would silently reset their consecutive-term count. Historical
  -- entries for people long gone may carry only a contact.
  person_profile_id uuid references public.profiles(id),
  person_contact_id uuid references public.contacts(id),
  constraint governance_role_has_a_person
    check (person_profile_id is not null or person_contact_id is not null),

  -- The store they served from, as at the time of service.
  organization_id   uuid references public.organizations(id),

  role_key          text not null,
  -- Which numbered seat, where a body staggers its terms. Null for committees.
  seat_key          text,

  term_start        date not null,
  term_end          date,
  -- True where this term counts toward a consecutive-term cap. A mid-term
  -- appointment to a vacancy (Part IV S3) is a judgement call, so it is a
  -- stored fact rather than something derived from the dates.
  counts_toward_cap boolean not null default true,

  elected_at_election_id uuid,
  appointing_resolution  text,
  notes                  text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists governance_role_body_idx
  on public.governance_role_assignments(body_id, term_start desc);
create index if not exists governance_role_profile_idx
  on public.governance_role_assignments(person_profile_id) where person_profile_id is not null;
create index if not exists governance_role_current_idx
  on public.governance_role_assignments(body_id, role_key) where term_end is null;

comment on table public.governance_role_assignments is
  'Term history for every governance seat and office. Replaces reading officer titles out of site_content.subtitle, which is a public CMS field and cannot authorize anything. Consecutive-term eligibility (By-Law Part IV S2) is counted from these rows -- there is no other source.';


-- ---------------------------------------------------------------------------
-- The election itself
-- ---------------------------------------------------------------------------
create table if not exists public.elections (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  body_id             uuid not null references public.governance_bodies(id),
  cycle_year          integer not null,

  agm_date            date not null,
  -- Derived from agm_date via the countbacks in config, then STORED, so that
  -- moving the AGM later cannot retroactively reopen a window that has closed.
  nominations_open_at  date not null,
  nominations_close_at date not null,
  ballots_open_at      date not null,
  ballots_close_at     date not null,

  seats_available     integer not null check (seats_available > 0),

  -- Full ElectionsConfig snapshot. The rule in force when this election opened.
  config              jsonb not null,
  policy_set_id       uuid,

  status              text not null default 'draft'
                      check (status in ('draft','nominating','nominations_closed',
                                        'balloting','sealed','certified','cancelled')),
  -- Resolved at the nomination close: an election happens only if there are
  -- more validated nominees than seats. Otherwise the slate is acclaimed.
  outcome             text check (outcome in ('acclaimed','balloted')),

  sealed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists elections_body_cycle_idx on public.elections(body_id, cycle_year desc);

comment on column public.elections.config is
  'Snapshotted ElectionsConfig. Never read live config to interpret a past election -- CSC is redrafting its by-laws and a re-tally must use the rule that was actually in force.';


create table if not exists public.election_seats (
  id                     uuid primary key default gen_random_uuid(),
  election_id            uuid not null references public.elections(id) on delete cascade,
  seat_key               text not null,
  incumbent_profile_id   uuid references public.profiles(id),
  incumbent_contact_id   uuid references public.contacts(id),
  incumbent_organization_id uuid references public.organizations(id),
  unique (election_id, seat_key)
);


-- Per-organization eligibility verdict. Written by a re-runnable evaluation so
-- "why wasn't my store on the list" is always answerable with a reason, rather
-- than a member silently vanishing from an audience query.
create table if not exists public.election_eligibility (
  id              uuid primary key default gen_random_uuid(),
  election_id     uuid not null references public.elections(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  is_eligible     boolean not null,
  reason_code     text not null,
  reason          text not null,
  rule_key        text not null,
  facts           jsonb,
  evaluated_at    timestamptz not null default now(),
  unique (election_id, organization_id)
);

create index if not exists election_eligibility_election_idx
  on public.election_eligibility(election_id, is_eligible);


-- ---------------------------------------------------------------------------
-- Nominations
-- ---------------------------------------------------------------------------
create table if not exists public.nominations (
  id                      uuid primary key default gen_random_uuid(),
  election_id             uuid not null references public.elections(id) on delete cascade,

  nominee_contact_id      uuid not null references public.contacts(id),
  nominee_profile_id      uuid references public.profiles(id),
  nominee_organization_id uuid not null references public.organizations(id),

  -- A nominating-committee nomination needs no co-signers; a member-sourced one
  -- does (By-Law Part V S2(c)).
  source                  text not null check (source in ('nominating_committee','member')),
  nominated_by_contact_id uuid references public.contacts(id),

  -- Unguessable, per the board_action_items / board_votes convention.
  accept_token            text not null unique,

  bio                     text,
  platform                text,

  candidate_accepted_at   timestamptz,
  candidate_declined_at   timestamptz,

  -- By-Law Part V S2(d): the candidate's Member Store must permit them to serve.
  -- Distinct from the candidate's own acceptance -- two consents, not one.
  store_permission_granted_at         timestamptz,
  store_permission_granted_by_contact_id uuid references public.contacts(id),

  withdrawn_at            timestamptz,
  withdrawn_reason        text,
  -- The nominating committee may ASK a nominee to withdraw (to improve the
  -- slate's representation), but only the nominee may actually withdraw.
  withdrawal_requested_at timestamptz,
  withdrawal_requested_by uuid references public.profiles(id),

  status                  text not null default 'proposed'
                          check (status in ('proposed','accepted','validated',
                                            'declined','withdrawn','ineligible')),
  -- Snapshot of every eligibility check and its verdict at validation time.
  eligibility             jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists nominations_election_status_idx
  on public.nominations(election_id, status);
create unique index if not exists nominations_one_live_per_person_per_election
  on public.nominations(election_id, nominee_contact_id)
  where status not in ('declined','withdrawn','ineligible');

comment on column public.nominations.withdrawal_requested_at is
  'The nominating committee can request a withdrawal to improve slate representation; only the nominee can act on it. Recorded so that a request is never mistaken for a withdrawal.';


create table if not exists public.nomination_cosignatures (
  id              uuid primary key default gen_random_uuid(),
  nomination_id   uuid not null references public.nominations(id) on delete cascade,

  -- The signature belongs to the INSTITUTION, not the individual: By-Law Part V
  -- S2(c) wants two distinct member stores standing behind a nomination. The
  -- unique constraint below is what makes "two" mean two stores rather than two
  -- colleagues at one store.
  organization_id uuid not null references public.organizations(id),
  contact_id      uuid not null references public.contacts(id),
  profile_id      uuid references public.profiles(id),

  sign_token      text not null unique,
  signed_at       timestamptz,
  revoked_at      timestamptz,

  created_at      timestamptz not null default now(),
  unique (nomination_id, organization_id)
);

create index if not exists nomination_cosignatures_nomination_idx
  on public.nomination_cosignatures(nomination_id) where revoked_at is null;


-- ---------------------------------------------------------------------------
-- Ballots
--
-- One ballot per institution, co-editable by any of that institution's admins
-- until the close. `organization_id` is present WHILE OPEN because both the
-- one-per-institution rule and the co-editing depend on it; the seal strips it.
-- ---------------------------------------------------------------------------
create table if not exists public.election_ballots (
  id                       uuid primary key default gen_random_uuid(),
  election_id              uuid not null references public.elections(id) on delete cascade,
  organization_id          uuid not null references public.organizations(id) on delete cascade,

  abstain                  boolean not null default false,

  first_cast_at            timestamptz not null default now(),
  last_edited_at           timestamptz not null default now(),
  last_edited_by_profile_id uuid references public.profiles(id),
  edit_count               integer not null default 0,

  sealed_at                timestamptz,
  unique (election_id, organization_id)
);

create table if not exists public.election_ballot_selections (
  id            uuid primary key default gen_random_uuid(),
  ballot_id     uuid not null references public.election_ballots(id) on delete cascade,
  nomination_id uuid not null references public.nominations(id),
  unique (ballot_id, nomination_id)
);


-- Survives the seal. This is the audit roll: that a store voted, never how.
create table if not exists public.election_participation (
  id                  uuid primary key default gen_random_uuid(),
  election_id         uuid not null references public.elections(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  first_cast_at       timestamptz not null,
  last_edited_at      timestamptz not null,
  edit_count          integer not null default 0,
  cast_by_profile_ids uuid[] not null default '{}',
  abstained           boolean not null default false,
  unique (election_id, organization_id)
);


-- Created only by the seal step, in randomized order, with no organization
-- reference. After sealing nobody -- scrutineer included -- can attribute a
-- ballot to a store. This is practical anonymity enforced by schema and access
-- control, not cryptographic anonymity.
create table if not exists public.election_ballots_sealed (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references public.elections(id) on delete cascade,
  seal_order    integer not null,
  abstain       boolean not null default false,
  selections    uuid[] not null default '{}',
  unique (election_id, seal_order)
);

comment on table public.election_ballots_sealed is
  'Anonymous ballots, randomized at seal. Reconciles against election_participation by COUNT only. Sealing is irreversible and destroys attribution by design.';


create table if not exists public.election_results (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references public.elections(id) on delete cascade,
  nomination_id uuid not null references public.nominations(id),
  votes         integer not null,
  rank          integer not null,
  elected       boolean not null default false,
  unique (election_id, nomination_id)
);


create table if not exists public.election_certifications (
  id                     uuid primary key default gen_random_uuid(),
  election_id            uuid not null unique references public.elections(id) on delete cascade,

  scrutineer_contact_id  uuid references public.contacts(id),
  appointed_by_profile_id uuid references public.profiles(id),

  ballots_returned       integer not null,
  ballots_sealed         integer not null,
  reconciled             boolean not null,

  -- Software never breaks a tie. It stops here and names the candidates.
  tie_at_cutoff          boolean not null default false,
  tie_candidates         uuid[] not null default '{}',
  tie_resolution_method  text check (tie_resolution_method in ('refer_to_agm','board_appoints','other')),
  tie_resolution_note    text,
  tie_resolved_by_profile_id uuid references public.profiles(id),
  tie_resolved_at        timestamptz,

  certified_by_profile_id uuid references public.profiles(id),
  certified_at           timestamptz,
  created_at             timestamptz not null default now()
);

comment on table public.election_certifications is
  'Certification is BLOCKED while tie_at_cutoff is true and no resolution is recorded. By-Law No. 1 prescribes no candidate tie-break; the resolution and its authority must be entered by a human.';


-- ---------------------------------------------------------------------------
-- RLS: everything server-side, matching the board_votes precedent. Ballot
-- secrecy is not something to leave to a policy expression.
-- ---------------------------------------------------------------------------
alter table public.governance_bodies            enable row level security;
alter table public.governance_role_assignments  enable row level security;
alter table public.elections                    enable row level security;
alter table public.election_seats               enable row level security;
alter table public.election_eligibility         enable row level security;
alter table public.nominations                  enable row level security;
alter table public.nomination_cosignatures      enable row level security;
alter table public.election_ballots             enable row level security;
alter table public.election_ballot_selections   enable row level security;
alter table public.election_participation       enable row level security;
alter table public.election_ballots_sealed      enable row level security;
alter table public.election_results             enable row level security;
alter table public.election_certifications      enable row level security;

revoke all on public.governance_bodies,
              public.governance_role_assignments,
              public.elections,
              public.election_seats,
              public.election_eligibility,
              public.nominations,
              public.nomination_cosignatures,
              public.election_ballots,
              public.election_ballot_selections,
              public.election_participation,
              public.election_ballots_sealed,
              public.election_results,
              public.election_certifications
  from anon, authenticated;

grant select, insert, update, delete on
              public.governance_bodies,
              public.governance_role_assignments,
              public.elections,
              public.election_seats,
              public.election_eligibility,
              public.nominations,
              public.nomination_cosignatures,
              public.election_ballots,
              public.election_ballot_selections,
              public.election_participation,
              public.election_ballots_sealed,
              public.election_results,
              public.election_certifications
  to service_role;
