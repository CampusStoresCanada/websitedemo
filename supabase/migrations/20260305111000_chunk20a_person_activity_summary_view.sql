-- Person-centric longitudinal summary for bidirectional querying.

create or replace view public.person_activity_summary as
with conference_rollup as (
  select
    cp.canonical_person_id as person_id,
    count(*)::integer as conference_participations_count,
    count(*) filter (where cp.checked_in_at is not null)::integer as conference_checkins_count,
    max(cp.checked_in_at) as last_conference_checkin_at,
    max(cp.updated_at) as last_conference_activity_at
  from public.conference_people cp
  where cp.canonical_person_id is not null
    and cp.assignment_status <> 'canceled'
  group by cp.canonical_person_id
),
registration_rollup as (
  select
    cp.canonical_person_id as person_id,
    bool_or(cr.status in ('submitted', 'confirmed')) as has_completed_conference_registration
  from public.conference_people cp
  join public.conference_registrations cr on cr.id = cp.registration_id
  where cp.canonical_person_id is not null
  group by cp.canonical_person_id
)
select
  p.id as person_id,
  coalesce(c.conference_participations_count, 0) as conference_participations_count,
  coalesce(c.conference_checkins_count, 0) as conference_checkins_count,
  coalesce(r.has_completed_conference_registration, false) as has_completed_conference_registration,
  c.last_conference_checkin_at,
  c.last_conference_activity_at
from public.people p
left join conference_rollup c on c.person_id = p.id
left join registration_rollup r on r.person_id = p.id;

grant select on public.person_activity_summary to authenticated;
