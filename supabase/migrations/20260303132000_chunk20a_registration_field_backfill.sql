-- Chunk 20A follow-up: ensure conference_registrations has canonical ops/travel fields.
-- Idempotent-safe patch for environments with partial 20A application.

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

