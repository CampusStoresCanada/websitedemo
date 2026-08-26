-- Two tables were readable by anyone holding the public key.
--
-- The anon key ships in the client bundle by design — it is not a secret, and
-- RLS is the boundary. On these two, RLS said `USING (true)` and SELECT was
-- granted to anon, so the boundary was nothing at all.
--
-- benchmarking:   every member store's COGS, staff costs, rent and net profit.
--                 39 rows, named institutions, no account required.
-- page_snapshots: the whole stored snapshot JSONB, including snapshots whose
--                 expiry had passed and contacts since flagged hidden. Both of
--                 those are enforced in resolveSnapshot() — application code
--                 that a direct API call never runs.
--
-- The drift audit did not catch either: it compares GRANTs against policies for
-- `authenticated` on write verbs, looking for the two to disagree. Here they
-- agreed, on a read verb, for anon. Consistent and wrong.

drop policy if exists "Benchmarking readable by all" on public.benchmarking;
revoke select on public.benchmarking from anon;

drop policy if exists "Org members read own benchmarking" on public.benchmarking;
create policy "Org members read own benchmarking" on public.benchmarking
  for select to authenticated
  using (exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = benchmarking.organization_id
      and uo.user_id = auth.uid()
      and uo.status = 'active'
  ));

-- A share link must still work for someone with no account, but it has to go
-- through resolveSnapshot(), which checks expiry and re-checks withdrawn
-- contacts on the way out. That means the service role reads it, not anon.
drop policy if exists snapshots_select_any on public.page_snapshots;
revoke select on public.page_snapshots from anon;

drop policy if exists snapshots_own_select on public.page_snapshots;
create policy snapshots_own_select on public.page_snapshots
  for select to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin','super_admin')
    )
  );
