-- Phase 4 Stage 0 fix: memberships had zero grants for anon/authenticated and RLS
-- disabled -- the embedded PostgREST join added to guards.ts/AuthProvider.tsx's
-- queries would fail for any real client. Mirror organizations' exact posture:
-- public read (organizations.membership_status was already fully public-readable,
-- so this isn't a new exposure), service_role-only writes.
alter table memberships enable row level security;

create policy "Allow public read access on memberships"
  on memberships for select
  to public
  using (true);

create policy "Service role has full access to memberships"
  on memberships for all
  to service_role
  using (true);

grant select on memberships to anon, authenticated;
