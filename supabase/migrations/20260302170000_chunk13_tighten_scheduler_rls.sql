-- Tighten RLS on scheduler tables.
-- scheduler_runs and match_scores → admin-only reads.
-- schedules → admin + own registration + org_admin for org members + exhibitor self.
-- conference_suites and meeting_slots stay wide-open (non-sensitive infrastructure).

-- ============================================================
-- 1. scheduler_runs: admin-only
-- ============================================================
drop policy if exists scheduler_runs_read_authenticated on public.scheduler_runs;

create policy scheduler_runs_read_admin
  on public.scheduler_runs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

-- ============================================================
-- 2. match_scores: admin-only
-- ============================================================
drop policy if exists match_scores_read_authenticated on public.match_scores;

create policy match_scores_read_admin
  on public.match_scores
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

-- ============================================================
-- 3. schedules: multi-level access
-- ============================================================
drop policy if exists schedules_read_authenticated on public.schedules;

create policy schedules_read_authorized
  on public.schedules
  for select
  to authenticated
  using (
    -- Admin / super_admin: full access
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
    OR
    -- Delegate can see schedules containing their own registration
    exists (
      select 1 from public.conference_registrations cr
      where cr.id = any(schedules.delegate_registration_ids)
        and cr.user_id = auth.uid()
    )
    OR
    -- Exhibitor can see their own assigned meetings
    exists (
      select 1 from public.conference_registrations cr
      where cr.id = schedules.exhibitor_registration_id
        and cr.user_id = auth.uid()
    )
    OR
    -- Org admin can see schedules for members of their org
    -- (covers both delegate and exhibitor sides)
    exists (
      select 1 from public.conference_registrations cr
      join public.user_organizations uo
        on uo.organization_id = cr.organization_id
      where (
              cr.id = any(schedules.delegate_registration_ids)
              or cr.id = schedules.exhibitor_registration_id
            )
        and uo.user_id = auth.uid()
        and uo.role = 'org_admin'
    )
  );
