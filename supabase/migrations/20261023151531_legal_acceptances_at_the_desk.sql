-- Agreements accepted at the check-in desk (Stephen, 2026-10-23).
--
-- Scanning a badge whose holder still owes agreements shows them on the desk;
-- they read and accept there, then are checked in. "If we haven't gotten them
-- to do it by the time they are at the door, that is our last shot."
--
-- An acceptance was keyed to a LOGIN (user_id NOT NULL), so anyone without one
-- (a name-only walk-up, the second person on a shared inbox, an invitee who
-- never signed up) could never accept. It is now recordable for the PERSON
-- (their contact), and says how it was taken and who handed the device over.
-- Additive: every existing row is a self acceptance with a login, unchanged.

alter table public.legal_acceptances
  alter column user_id drop not null,
  add column if not exists contact_id uuid references public.contacts(id),
  add column if not exists accepted_via text not null default 'self'
    check (accepted_via in ('self', 'desk')),
  add column if not exists recorded_by uuid references public.profiles(id);

alter table public.legal_acceptances
  drop constraint if exists legal_acceptances_has_someone,
  add constraint legal_acceptances_has_someone check (user_id is not null or contact_id is not null);

create unique index if not exists legal_acceptances_contact_version_idx
  on public.legal_acceptances (contact_id, legal_version_id)
  where contact_id is not null;

comment on column public.legal_acceptances.contact_id is
  'The person who accepted, when recorded for a person rather than a login (e.g. at the check-in desk).';
comment on column public.legal_acceptances.accepted_via is
  'self = the person accepted on their own account; desk = accepted on the check-in desk''s device.';
comment on column public.legal_acceptances.recorded_by is
  'For a desk acceptance: the staff member whose desk it was.';
