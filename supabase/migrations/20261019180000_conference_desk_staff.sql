-- Conference desk staff: per-conference appointments, and individual org links
-- that end on a date.
--
-- ⛔ Additive only. Two nullable columns, one new body, one new appointable
-- role, and the who-holds-what view re-created with one column appended. No
-- existing row changes meaning: a NULL conference_id is every appointment that
-- exists today, and a NULL expires_at is every org link that exists today.

-- 1. An appointment can belong to ONE conference. Volunteers and temps are
--    appointed per conference, optionally for specific days; NULL is the
--    governance appointments that already exist (benchmarking, elections).
alter table public.governance_role_assignments
  add column if not exists conference_id uuid
    references public.conference_instances(id) on delete cascade;

create index if not exists governance_role_assignments_conference_id_idx
  on public.governance_role_assignments (conference_id)
  where conference_id is not null;

-- 2. A person's link to an organisation can end. An organisation's membership
--    already expires (memberships.expires_at); a PERSON's link never did, so a
--    temp added to the staff organisation, or a store employee who left, stayed
--    linked for good. NULL = follows the organisation, which is today's rule.
--    ⛔ Exclusive, like governance_role_assignments.term_end: the link is off
--    from the start of this date.
alter table public.user_organizations
  add column if not exists expires_at date;

-- 3. The appointment itself: a body to hold it and an appointable role that
--    carries the capability, so it is granted on the Access page like every
--    other appointment.
insert into public.governance_bodies (key, name)
values ('conference_operations', 'Conference Operations')
on conflict (key) do nothing;

insert into public.governance_role_capabilities (role_key, capability, appointable, can_delegate)
values ('conference_desk_staff', 'conference.desk_staff', true, false)
on conflict (role_key, capability) do nothing;

-- 4. The reader. Same query, conference_id appended at the end (the only
--    change CREATE OR REPLACE VIEW permits), options and grants restated so
--    nothing about who can read it moves.
create or replace view public.capability_contributions
with (security_invoker = on) as
 select ra.id as assignment_id,
    ra.person_profile_id as subject_id,
    coalesce(p.display_name, c.name) as display_name,
    rc.capability,
    ra.role_key,
    rc.appointable,
    gb.name as body_name,
    coalesce(ra.appointing_resolution, ra.notes) as reason,
    ra.term_start,
    ra.term_end,
    ra.term_start <= current_date and (ra.term_end is null or ra.term_end > current_date) as is_active,
    ra.conference_id
   from public.governance_role_assignments ra
     join public.governance_role_capabilities rc on rc.role_key = ra.role_key
     left join public.governance_bodies gb on gb.id = ra.body_id
     left join public.profiles p on p.id = ra.person_profile_id
     left join public.contacts c on c.id = ra.person_contact_id;

revoke all on public.capability_contributions from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger
  on public.capability_contributions to service_role;
