-- Let the recipient-confirmation queue actually see contacts.
--
-- contacts RLS previously allowed reads only for organizations you belong to.
-- A rep confirming who runs a store therefore saw an empty contact list and
-- the page told them "nobody on file" — not an error, just a confident false
-- statement about the data. They would have marked every store "I don't know".
--
-- Scoped deliberately: a rep may read contacts only for the stores actually
-- assigned to them in the queue, not for the whole membership.

drop policy if exists contacts_recipient_confirm_read on public.contacts;
create policy contacts_recipient_confirm_read on public.contacts
  for select to authenticated
  using (
    public.has_capability(auth.uid(), 'benchmarking.recipient_confirm')
    and organization_id in (
      select r.organization_id
      from public.benchmarking_recipients r
      where r.assigned_to = auth.uid()
    )
  );

-- Admins already read everything else; contacts was an inconsistent gap.
drop policy if exists contacts_admin_read on public.contacts;
create policy contacts_admin_read on public.contacts
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.global_role in ('admin','super_admin')
  ));
