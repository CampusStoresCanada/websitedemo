-- Two things /admin/access needed and did not have.
--
-- 1. The view exposed no assignment id, so nothing could end or extend an
--    appointment. The page fell back to joining capability_grants on
--    `subject_id|capability|starts_at` — but the view has term_start, not
--    starts_at, so both sides of that key were undefined and every row
--    rendered blank with no working revoke.
-- 2. Nothing said WHICH role_key to use when appointing someone to a
--    capability. `secretary` carries four of them ex officio; you do not
--    appoint a person to secretary in order to let them review questions.

alter table public.governance_role_capabilities
  add column if not exists appointable boolean not null default false;

comment on column public.governance_role_capabilities.appointable is
  'True when this role exists to be handed to someone for a term. Ex-officio roles (secretary, president) are false — they come with an office, not an appointment.';

update public.governance_role_capabilities
set appointable = true
where role_key in (
  'benchmarking_reviewer',
  'benchmarking_qa',
  'benchmarking_regional_rep',
  'benchmarking_committee_lead'
);

-- Column order changes, so the view is dropped rather than replaced.
drop view if exists public.capability_contributions;

create view public.capability_contributions
with (security_invoker = on) as
select
  ra.id                                as assignment_id,
  ra.person_profile_id                 as subject_id,
  coalesce(p.display_name, c.name)     as display_name,
  rc.capability,
  ra.role_key,
  rc.appointable,
  gb.name                              as body_name,
  coalesce(ra.appointing_resolution, ra.notes) as reason,
  ra.term_start,
  ra.term_end,
  ra.term_start <= current_date
    and (ra.term_end is null or ra.term_end > current_date) as is_active
from public.governance_role_assignments ra
join public.governance_role_capabilities rc on rc.role_key = ra.role_key
left join public.governance_bodies gb on gb.id = ra.body_id
left join public.profiles p on p.id = ra.person_profile_id
left join public.contacts c on c.id = ra.person_contact_id;

revoke select on public.capability_contributions from anon;
revoke select on public.capability_contributions from authenticated;
