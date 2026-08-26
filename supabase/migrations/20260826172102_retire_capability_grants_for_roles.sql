-- Retire per-person capability grants in favour of roles.
--
-- `capability_grants` was the original model: give a named person a capability
-- for a date range. It was superseded by role-derived capabilities, because a
-- console attached to Sean has to become the next secretary's console the day
-- the office changes hands, and a grant written to a person never does.
--
-- The migration was only half done. Resolution moved to
-- governance_role_assignments ⋈ governance_role_capabilities — neither
-- has_capability() nor current_capabilities() nor capability_contributions
-- mentions capability_grants — but the WRITE path stayed. /admin/access and
-- lib/actions/capability-grants.ts still issued grants, reported success, and
-- changed nothing. A control that lies is worse than a missing one.
--
-- There was exactly one live grant, and it was real intent: Stephen Thomas as
-- 2026 benchmarking committee lead. Converting it rather than dropping it —
-- deleting would be deciding he is not the lead, which is not a decision a
-- migration gets to make.

insert into public.governance_role_capabilities (role_key, capability, can_delegate)
values ('benchmarking_committee_lead', 'benchmarking.committee_lead', true)
on conflict (role_key, capability) do nothing;

insert into public.governance_role_assignments
  (body_id, person_profile_id, role_key, term_start, term_end, appointing_resolution, counts_toward_cap)
select
  (select id from public.governance_bodies where key = 'benchmarking_committee'),
  g.subject_id,
  'benchmarking_committee_lead',
  g.starts_at::date,
  g.ends_at::date,
  coalesce(g.reason, 'Converted from a capability grant, 2026-08-26.'),
  false
from public.capability_grants g
where g.revoked_at is null
  and g.capability = 'benchmarking.committee_lead'
  and (g.ends_at is null or g.ends_at > now())
  and not exists (
    select 1 from public.governance_role_assignments ra
    where ra.person_profile_id = g.subject_id
      and ra.role_key = 'benchmarking_committee_lead'
  );
