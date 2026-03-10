-- Chunk 17 RLS hardening: membership_assessments
-- Replace permissive read policy with scoped authorization.

drop policy if exists "membership_assessments_read_admin" on public.membership_assessments;

create policy "membership_assessments_read_authorized"
  on public.membership_assessments
  for select
  to authenticated
  using (
    -- Global admin/super_admin can read all assessments.
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
    OR
    -- Org admins can read assessments for their active orgs.
    exists (
      select 1
      from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = membership_assessments.organization_id
        and uo.role = 'org_admin'
        and uo.status = 'active'
    )
  );
