-- Chunk 14: Harden RLS on swap tables — replace broad using(true) with user-scoped policies.

-- Drop the overly-broad policies created in the base swap migration.
drop policy if exists swap_requests_read_authenticated on public.swap_requests;
drop policy if exists swap_cap_increase_read_authenticated on public.swap_cap_increase_requests;

-- Swap requests: users can only read their own (via delegate registration ownership).
create policy "Users can read own swap requests"
  on public.swap_requests
  for select
  to authenticated
  using (
    delegate_registration_id in (
      select id from public.conference_registrations
      where user_id = auth.uid()
    )
  );

-- Cap increase requests: users can only read their own.
create policy "Users can read own cap increase requests"
  on public.swap_cap_increase_requests
  for select
  to authenticated
  using (
    delegate_registration_id in (
      select id from public.conference_registrations
      where user_id = auth.uid()
    )
  );
