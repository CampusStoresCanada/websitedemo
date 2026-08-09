-- The existing policy checked auth.jwt() ->> 'organization_id', a JWT claim
-- this app has never set — the real membership model is the
-- user_organizations join table (many-to-many), so the policy silently
-- denied every authenticated read, always. Replaces it with the real check:
-- can read a contact if you have an ACTIVE membership in that contact's org.
drop policy if exists "Users can read their organization's contacts" on contacts;

create policy "Users can read their organization's contacts"
on contacts
for select
to authenticated
using (
  organization_id in (
    select organization_id from user_organizations
    where user_id = auth.uid() and status = 'active'
  )
);
