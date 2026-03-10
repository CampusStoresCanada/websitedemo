-- Chunk 17: Membership pricing assessments

create table if not exists public.membership_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_set_id uuid not null references public.policy_sets(id) on delete restrict,
  billing_cycle_year integer not null,
  pricing_mode text not null,
  metric_key text not null,
  metric_value numeric null,
  computed_amount_cents integer not null,
  assessment_status text not null default 'computed'
    check (assessment_status in ('computed', 'fallback_used', 'manual_required', 'manual_override')),
  fallback_reason_code text null,
  explanation text not null,
  input_snapshot jsonb not null default '{}'::jsonb,
  is_manual_override boolean not null default false,
  override_reason text null,
  override_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_membership_assessments_org
  on public.membership_assessments(organization_id);

create unique index if not exists idx_membership_assessments_org_policy_cycle
  on public.membership_assessments(organization_id, policy_set_id, billing_cycle_year);

alter table public.membership_assessments enable row level security;

drop policy if exists "membership_assessments_read_admin" on public.membership_assessments;
create policy "membership_assessments_read_admin"
  on public.membership_assessments
  for select
  using (true);

drop policy if exists "membership_assessments_block_direct_write" on public.membership_assessments;
create policy "membership_assessments_block_direct_write"
  on public.membership_assessments
  for all
  using (false)
  with check (false);
