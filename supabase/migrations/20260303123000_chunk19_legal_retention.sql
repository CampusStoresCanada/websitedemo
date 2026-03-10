-- Chunk 19: Legal retention job tracking + purge helper RPC.

create table if not exists public.retention_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'travel_purge' check (job_type in ('travel_purge')),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  policy_set_id uuid null references public.policy_sets(id) on delete set null,
  cutoff_at timestamptz not null,
  records_purged integer not null default 0 check (records_purged >= 0),
  fields_purged text[] not null default '{}'::text[],
  status text not null check (status in ('completed', 'failed')),
  executed_at timestamptz not null default now(),
  error_details text null
);

create index if not exists idx_retention_jobs_conference_executed
  on public.retention_jobs(conference_id, executed_at desc);

create index if not exists idx_retention_jobs_status_executed
  on public.retention_jobs(status, executed_at desc);

create index if not exists idx_retention_jobs_job_type_executed
  on public.retention_jobs(job_type, executed_at desc);

create or replace function public.run_travel_retention_purge(
  p_conference_id uuid,
  p_policy_set_id uuid,
  p_cutoff_at timestamptz,
  p_fields text[]
)
returns table (records_purged integer, retention_job_id uuid)
language plpgsql
as $$
declare
  v_records_purged integer := 0;
  v_retention_job_id uuid;
begin
  with updated as (
    update public.conference_registrations
    set
      legal_name = null,
      date_of_birth = null,
      preferred_departure_airport = null,
      nexus_trusted_traveler = null,
      seat_preference = null,
      emergency_contact_name = null,
      emergency_contact_phone = null,
      gender = null,
      mobile_phone = null,
      updated_at = now()
    where conference_id = p_conference_id
      and (
        legal_name is not null
        or date_of_birth is not null
        or preferred_departure_airport is not null
        or nexus_trusted_traveler is not null
        or seat_preference is not null
        or emergency_contact_name is not null
        or emergency_contact_phone is not null
        or gender is not null
        or mobile_phone is not null
      )
    returning id
  )
  select count(*)::integer into v_records_purged
  from updated;

  insert into public.retention_jobs (
    job_type,
    conference_id,
    policy_set_id,
    cutoff_at,
    records_purged,
    fields_purged,
    status,
    error_details
  )
  values (
    'travel_purge',
    p_conference_id,
    p_policy_set_id,
    p_cutoff_at,
    v_records_purged,
    coalesce(p_fields, '{}'::text[]),
    'completed',
    null
  )
  returning id into v_retention_job_id;

  return query
  select v_records_purged, v_retention_job_id;
end;
$$;

grant execute on function public.run_travel_retention_purge(uuid, uuid, timestamptz, text[]) to authenticated;

alter table public.retention_jobs enable row level security;

grant select, insert on public.retention_jobs to authenticated;

drop policy if exists retention_jobs_admin_read on public.retention_jobs;
create policy retention_jobs_admin_read
  on public.retention_jobs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists retention_jobs_admin_insert on public.retention_jobs;
create policy retention_jobs_admin_insert
  on public.retention_jobs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );
