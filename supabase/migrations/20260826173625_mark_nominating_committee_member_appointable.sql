-- The elections thread added `nominating_committee_member` as the appointment
-- route for the Nominating Committee, minutes before `appointable` existed.
-- Its own comment says exactly what it is for — "the appointment route: a
-- non-office role_key, same capability" — so it is appointable, and without
-- this flag /admin/access would not offer it and the board could not appoint
-- the extra members the by-law allows.
update public.governance_role_capabilities
set appointable = true
where role_key = 'nominating_committee_member';
