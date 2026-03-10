-- Chunk 13: Scheduling Engine (backend-first core)
-- Forward-only, idempotent-safe DDL.

create extension if not exists pgcrypto;

create table if not exists public.conference_suites (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  suite_number integer not null check (suite_number > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (conference_id, suite_number)
);

create table if not exists public.scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  policy_set_id uuid not null references public.policy_sets(id),
  run_seed integer not null,
  run_mode text not null default 'draft'
    check (run_mode in ('draft','active','archived')),
  status text not null default 'running'
    check (status in ('running','completed','failed','infeasible')),
  total_delegates integer,
  total_exhibitors integer,
  total_meetings_created integer,
  constraint_violations jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  run_by uuid references public.profiles(id),
  activated_at timestamptz,
  activated_by uuid references public.profiles(id),
  metadata jsonb,
  unique (conference_id, policy_set_id, run_seed)
);

create unique index if not exists idx_scheduler_runs_one_active
  on public.scheduler_runs(conference_id)
  where run_mode = 'active';

create unique index if not exists idx_scheduler_runs_one_running
  on public.scheduler_runs(conference_id)
  where status = 'running';

create table if not exists public.meeting_slots (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  slot_number integer not null check (slot_number > 0),
  start_time time not null,
  end_time time not null,
  suite_id uuid not null references public.conference_suites(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (conference_id, day_number, slot_number, suite_id)
);

create table if not exists public.match_scores (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  scheduler_run_id uuid not null references public.scheduler_runs(id) on delete cascade,
  delegate_registration_id uuid not null references public.conference_registrations(id) on delete cascade,
  exhibitor_registration_id uuid not null references public.conference_registrations(id) on delete cascade,
  total_score numeric not null,
  score_breakdown jsonb not null,
  match_reasons text[] not null default '{}',
  is_blackout boolean not null default false,
  is_top_5 boolean not null default false,
  created_at timestamptz not null default now(),
  unique (scheduler_run_id, delegate_registration_id, exhibitor_registration_id)
);

create index if not exists idx_match_scores_run
  on public.match_scores(scheduler_run_id);
create index if not exists idx_match_scores_delegate
  on public.match_scores(delegate_registration_id);
create index if not exists idx_match_scores_exhibitor
  on public.match_scores(exhibitor_registration_id);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  scheduler_run_id uuid not null references public.scheduler_runs(id) on delete cascade,
  meeting_slot_id uuid not null references public.meeting_slots(id) on delete cascade,
  exhibitor_registration_id uuid not null references public.conference_registrations(id) on delete cascade,
  delegate_registration_ids uuid[] not null,
  match_score_ids uuid[],
  status text not null default 'scheduled'
    check (status in ('scheduled','swapped','canceled')),
  created_at timestamptz not null default now(),
  check (array_length(delegate_registration_ids, 1) between 1 and 10),
  unique (scheduler_run_id, meeting_slot_id, exhibitor_registration_id)
);

create index if not exists idx_schedules_run
  on public.schedules(scheduler_run_id);
create index if not exists idx_schedules_exhibitor
  on public.schedules(exhibitor_registration_id);

alter table public.conference_suites enable row level security;
alter table public.meeting_slots enable row level security;
alter table public.scheduler_runs enable row level security;
alter table public.match_scores enable row level security;
alter table public.schedules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conference_suites' and policyname = 'conference_suites_read_authenticated'
  ) then
    create policy conference_suites_read_authenticated
      on public.conference_suites
      for select
      to authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_slots' and policyname = 'meeting_slots_read_authenticated'
  ) then
    create policy meeting_slots_read_authenticated
      on public.meeting_slots
      for select
      to authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'scheduler_runs' and policyname = 'scheduler_runs_read_authenticated'
  ) then
    create policy scheduler_runs_read_authenticated
      on public.scheduler_runs
      for select
      to authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'match_scores' and policyname = 'match_scores_read_authenticated'
  ) then
    create policy match_scores_read_authenticated
      on public.match_scores
      for select
      to authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'schedules' and policyname = 'schedules_read_authenticated'
  ) then
    create policy schedules_read_authenticated
      on public.schedules
      for select
      to authenticated
      using (true);
  end if;
end
$$;

create or replace function public.promote_scheduler_run(
  p_conference_id uuid,
  p_run_id uuid,
  p_activated_by uuid default null
)
returns public.scheduler_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  target_run public.scheduler_runs%rowtype;
begin
  select *
  into target_run
  from public.scheduler_runs
  where id = p_run_id
    and conference_id = p_conference_id
  for update;

  if not found then
    raise exception 'SCHEDULER_RUN_NOT_FOUND';
  end if;

  if target_run.status <> 'completed' then
    raise exception 'SCHEDULER_RUN_NOT_COMPLETED';
  end if;

  if target_run.run_mode <> 'draft' then
    raise exception 'SCHEDULER_RUN_NOT_DRAFT';
  end if;

  update public.scheduler_runs
  set run_mode = 'archived'
  where conference_id = p_conference_id
    and run_mode = 'active'
    and id <> p_run_id;

  update public.scheduler_runs
  set run_mode = 'active',
      activated_at = now(),
      activated_by = coalesce(p_activated_by, activated_by)
  where id = p_run_id
  returning * into target_run;

  return target_run;
end;
$$;
