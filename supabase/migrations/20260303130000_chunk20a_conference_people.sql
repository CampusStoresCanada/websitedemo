-- Chunk 20A: canonical conference people data layer.
-- Backend-first schema for war room / my-conference / badge + travel ops.

alter table public.conference_registrations
  add column if not exists conference_entitlement_id uuid references public.conference_order_items(id) on delete set null,
  add column if not exists entitlement_type text,
  add column if not exists entitlement_status text
    check (entitlement_status in ('active', 'refunded', 'voided')),
  add column if not exists assignment_status text not null default 'assigned'
    check (assignment_status in ('unassigned', 'assigned', 'pending_user_activation', 'reassigned', 'canceled')),
  add column if not exists assigned_email_snapshot text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references public.profiles(id),
  add column if not exists reassigned_from_user_id uuid references public.profiles(id),
  add column if not exists assignment_cutoff_at timestamptz,
  add column if not exists travel_mode text check (travel_mode in ('flight', 'road')),
  add column if not exists road_origin_address text,
  add column if not exists arrival_flight_details text,
  add column if not exists departure_flight_details text,
  add column if not exists hotel_name text,
  add column if not exists hotel_confirmation_code text,
  add column if not exists badge_print_status text not null default 'not_printed'
    check (badge_print_status in ('not_printed', 'printed', 'reprinted')),
  add column if not exists badge_printed_at timestamptz,
  add column if not exists badge_reprint_count integer not null default 0 check (badge_reprint_count >= 0),
  add column if not exists checked_in_at timestamptz,
  add column if not exists check_in_source text check (check_in_source in ('badge_pickup', 'manual')),
  add column if not exists admin_notes text,
  add column if not exists data_quality_flags text[] not null default '{}'::text[],
  add column if not exists travel_import_run_id uuid,
  add column if not exists travel_import_row_ref text;

create index if not exists idx_conf_reg_entitlement
  on public.conference_registrations(conference_entitlement_id);
create index if not exists idx_conf_reg_assignment_status
  on public.conference_registrations(conference_id, assignment_status);

create table if not exists public.conference_people (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  registration_id uuid references public.conference_registrations(id) on delete set null,
  conference_staff_id uuid references public.conference_staff(id) on delete set null,
  source_type text not null check (source_type in ('registration', 'staff', 'entitlement')),
  source_id uuid not null,
  person_kind text not null check (person_kind in ('delegate', 'exhibitor', 'staff', 'observer', 'unassigned')),
  display_name text,
  legal_name text,
  role_title text,
  contact_email text,
  conference_entitlement_id uuid references public.conference_order_items(id) on delete set null,
  entitlement_type text,
  entitlement_status text check (entitlement_status in ('active', 'refunded', 'voided')),
  assignment_status text not null default 'assigned'
    check (assignment_status in ('unassigned', 'assigned', 'pending_user_activation', 'reassigned', 'canceled')),
  assigned_email_snapshot text,
  assigned_at timestamptz,
  assigned_by uuid references public.profiles(id),
  reassigned_from_user_id uuid references public.profiles(id),
  assignment_cutoff_at timestamptz,
  schedule_scope text not null default 'person' check (schedule_scope in ('person', 'organization')),
  schedule_registration_id uuid references public.conference_registrations(id) on delete set null,
  schedule_run_id uuid references public.scheduler_runs(id) on delete set null,
  travel_mode text check (travel_mode in ('flight', 'road')),
  road_origin_address text,
  arrival_flight_details text,
  departure_flight_details text,
  hotel_name text,
  hotel_confirmation_code text,
  seat_preference text,
  preferred_departure_airport text,
  dietary_restrictions text,
  accessibility_needs text,
  mobile_phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  badge_print_status text not null default 'not_printed'
    check (badge_print_status in ('not_printed', 'printed', 'reprinted')),
  badge_printed_at timestamptz,
  badge_reprint_count integer not null default 0 check (badge_reprint_count >= 0),
  checked_in_at timestamptz,
  check_in_source text check (check_in_source in ('badge_pickup', 'manual')),
  admin_notes text,
  data_quality_flags text[] not null default '{}'::text[],
  retention_sensitive_fields text[] not null default array[
    'legal_name',
    'preferred_departure_airport',
    'seat_preference',
    'mobile_phone',
    'emergency_contact_name',
    'emergency_contact_phone',
    'road_origin_address'
  ]::text[],
  travel_import_run_id uuid,
  travel_import_row_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conference_id, source_type, source_id)
);

create index if not exists idx_conference_people_conf
  on public.conference_people(conference_id, person_kind, assignment_status);
create index if not exists idx_conference_people_org
  on public.conference_people(organization_id, conference_id);
create index if not exists idx_conference_people_user
  on public.conference_people(user_id, conference_id);
create index if not exists idx_conference_people_entitlement
  on public.conference_people(conference_entitlement_id);

alter table public.conference_people enable row level security;

grant select on public.conference_people to authenticated;
grant insert, update, delete on public.conference_people to authenticated;

drop policy if exists conference_people_select_scoped on public.conference_people;
create policy conference_people_select_scoped
  on public.conference_people
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
    or exists (
      select 1
      from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = conference_people.organization_id
        and uo.status = 'active'
    )
  );

drop policy if exists conference_people_admin_write on public.conference_people;
create policy conference_people_admin_write
  on public.conference_people
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

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
      road_origin_address = null,
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
        or road_origin_address is not null
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
