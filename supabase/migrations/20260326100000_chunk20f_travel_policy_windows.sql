-- Chunk 20F: Travel policy window keys + retention purge parity fixes.
--
-- 1. Seed travel window policy keys (arrival/departure day buffers).
-- 2. Replace run_travel_retention_purge() to also purge:
--    - road_origin_address (was missing from SET clause)
--    - imported travel fields (arrival/departure_flight_details, hotel_name, hotel_confirmation_code)
--    - matching conference_people rows (retention parity with conference_registrations)
--
-- Idempotent: policy keys insert only if missing; function uses CREATE OR REPLACE.

------------------------------------------------------------------------
-- 1. Travel window policy keys
------------------------------------------------------------------------

with defaults as (
  select *
  from (
    values
      ('conference.travel_arrival_min_days_before_start', 'scheduling',
        'Travel Arrival Window (days before start)',
        'How many days before conference start an arrival is allowed. Arrivals earlier than this require an exception.',
        'integer', '2'::jsonb, '{"minimum":0,"maximum":14}'::jsonb, false, 200),
      ('conference.travel_departure_max_days_after_end', 'scheduling',
        'Travel Departure Window (days after end)',
        'How many days after conference end a departure is allowed. Departures later than this require an exception.',
        'integer', '1'::jsonb, '{"minimum":0,"maximum":14}'::jsonb, false, 210),
      ('conference.travel_extra_nights_bill_to_attendee', 'scheduling',
        'Extra Night Cost to Attendee',
        'Whether extra-window hotel nights are billed to the attendee rather than the organization.',
        'boolean', 'true'::jsonb, null::jsonb, false, 220),
      ('conference.travel_exception_requires_admin_approval', 'scheduling',
        'Travel Exception Requires Admin Approval',
        'Whether out-of-window travel requests must be approved by an admin before submission.',
        'boolean', 'true'::jsonb, null::jsonb, false, 230)
  ) as t(policy_key, category, label, description, value_type, value_json, validation_schema, is_high_risk, display_order)
)
insert into public.policy_values (
  policy_set_id, key, category, label, description, type,
  value_json, validation_schema, is_high_risk, display_order
)
select
  ps.id, d.policy_key, d.category, d.label, d.description, d.value_type,
  d.value_json, d.validation_schema, d.is_high_risk, d.display_order
from public.policy_sets ps
cross join defaults d
where not exists (
  select 1
  from public.policy_values pv
  where pv.policy_set_id = ps.id
    and pv.key = d.policy_key
);

------------------------------------------------------------------------
-- 2. Replace retention purge RPC — add missing fields + conference_people
------------------------------------------------------------------------

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
  v_reg_purged integer := 0;
  v_people_purged integer := 0;
  v_records_purged integer := 0;
  v_retention_job_id uuid;
begin
  -- Purge conference_registrations (personal + imported travel fields)
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
      arrival_flight_details = null,
      departure_flight_details = null,
      hotel_name = null,
      hotel_confirmation_code = null,
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
        or arrival_flight_details is not null
        or departure_flight_details is not null
        or hotel_name is not null
        or hotel_confirmation_code is not null
      )
    returning id
  )
  select count(*)::integer into v_reg_purged from updated;

  -- Purge conference_people (retention parity)
  with people_updated as (
    update public.conference_people
    set
      legal_name = null,
      preferred_departure_airport = null,
      road_origin_address = null,
      seat_preference = null,
      mobile_phone = null,
      emergency_contact_name = null,
      emergency_contact_phone = null,
      arrival_flight_details = null,
      departure_flight_details = null,
      hotel_name = null,
      hotel_confirmation_code = null,
      dietary_restrictions = null,
      accessibility_needs = null,
      updated_at = now()
    where conference_id = p_conference_id
      and (
        legal_name is not null
        or preferred_departure_airport is not null
        or road_origin_address is not null
        or seat_preference is not null
        or mobile_phone is not null
        or emergency_contact_name is not null
        or emergency_contact_phone is not null
        or arrival_flight_details is not null
        or departure_flight_details is not null
        or hotel_name is not null
        or hotel_confirmation_code is not null
        or dietary_restrictions is not null
        or accessibility_needs is not null
      )
    returning id
  )
  select count(*)::integer into v_people_purged from people_updated;

  v_records_purged := v_reg_purged + v_people_purged;

  insert into public.retention_jobs (
    job_type, conference_id, policy_set_id, cutoff_at,
    records_purged, fields_purged, status, error_details
  )
  values (
    'travel_purge', p_conference_id, p_policy_set_id, p_cutoff_at,
    v_records_purged, coalesce(p_fields, '{}'::text[]),
    'completed', null
  )
  returning id into v_retention_job_id;

  return query select v_records_purged, v_retention_job_id;
end;
$$;
