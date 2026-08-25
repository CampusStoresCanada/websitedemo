-- Close anon read on memberships and surveys.
--
-- memberships carried 203 rows including arrears state, readable by anyone
-- holding the publishable key — which ships in the client bundle, so "anyone".
-- The replacement is the house pattern: a member reads their own org's row,
-- an admin reads all, everything else goes through the service role.
--
-- surveys is a legacy generic-forms table. Nothing in the app reads it (the
-- benchmarking cycle uses benchmarking_surveys, which is untouched here), and
-- its only policy tested status = 'active', a status this codebase never sets.
-- Revoking it outright is safe; if it is ever revived it needs a real policy.

-- memberships -------------------------------------------------------------
drop policy if exists "Allow public read access on memberships" on public.memberships;
revoke select on public.memberships from anon;

drop policy if exists "memberships_own_org_select" on public.memberships;
create policy "memberships_own_org_select" on public.memberships
  for select to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
      where uo.organization_id = memberships.organization_id
        and uo.user_id = auth.uid()
        and uo.status = 'active'
    )
  );

drop policy if exists "memberships_admin_select" on public.memberships;
create policy "memberships_admin_select" on public.memberships
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role = any (array['admin', 'super_admin'])
    )
  );

-- surveys (legacy, unreferenced) -------------------------------------------
revoke select on public.surveys from anon;
revoke select on public.surveys from authenticated;
