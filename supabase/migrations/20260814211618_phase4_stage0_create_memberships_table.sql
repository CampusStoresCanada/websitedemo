-- Phase 4 Stage 0: memberships as its own entity (additive, no drops)
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  person_id uuid references profiles(id),
  check ((organization_id is not null) <> (person_id is not null)),

  program_key text not null,
  status org_membership_status not null,
  status_changed_at timestamptz,
  fte numeric,
  is_cancoll_member boolean not null default false,
  cancoll_tier text,
  expires_at date,
  grace_period_started_at timestamptz,
  locked_at timestamptz,
  canceled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memberships_organization_id_idx on memberships(organization_id);
create index if not exists memberships_person_id_idx on memberships(person_id);

comment on table memberships is 'Phase 4: membership as its own entity, distinct from organizations/people. organizations remains the write authority through Stage 0-2; this table is kept in sync by a mirror in transition_membership_state() and by approveApplication().';
