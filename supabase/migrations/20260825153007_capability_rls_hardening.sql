-- Closes two of the three Supabase security-linter ERRORs on the capability
-- tables. Neither was reachable by anon — both were `authenticated:SELECT`
-- with RLS switched off entirely.
--
-- Both are static vocabulary. Nothing personal in either, so the policy is
-- "readable once signed in"; the point is that the linter stops shouting and
-- that a future ALTER cannot quietly widen them.

-- 3 rows: parent capability -> child capability it may issue.
alter table public.capability_delegates enable row level security;
drop policy if exists capability_delegates_read on public.capability_delegates;
create policy capability_delegates_read on public.capability_delegates
  for select to authenticated using (true);

-- 7 rows: governance role_key -> capability it carries.
-- current_capabilities() is SECURITY DEFINER, so the auth guard path in
-- lib/auth/guards.ts is unaffected by turning RLS on here.
alter table public.governance_role_capabilities enable row level security;
drop policy if exists governance_role_capabilities_read on public.governance_role_capabilities;
create policy governance_role_capabilities_read on public.governance_role_capabilities
  for select to authenticated using (true);

-- NOT fixed here: the security_definer_view error on capability_contributions.
--
-- That view no longer reads capability_grants at all — it was redefined to
-- derive capabilities from governance_role_assignments. Setting
-- security_invoker = on makes it fail outright for signed-in users
-- ("permission denied for table governance_role_assignments"), because
-- authenticated has no grant on the governance tables and they carry RLS with
-- no policies. Fixing it properly means deciding who may see the board and
-- committee roster — including appointing_resolution, which the view surfaces
-- as `reason` — and then granting and policying accordingly. That is a
-- governance call, not a lint fix.
