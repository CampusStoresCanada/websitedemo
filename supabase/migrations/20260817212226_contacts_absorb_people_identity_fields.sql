-- Retire the `people` table: move the identity fields the app actually reads
-- onto `contacts`, which is the record the app writes and the fresher of the
-- two in every measured conflict (45/45 by updated_at).
--
-- Additive only. Nothing dropped or renamed here.

-- 1. Name parts. Badge printing and conference registration read first/last
--    as distinct values; deriving them by splitting `contacts.name` is lossy
--    on middle initials, multi-word surnames and suffixes.
alter table public.contacts add column if not exists first_name text;
alter table public.contacts add column if not exists last_name  text;

-- 2. Tenant. `people` carries this and `contacts` does not; the deployable-
--    template work needs it on whichever table survives.
alter table public.contacts add column if not exists tenant_id uuid;

-- 3. Structural link from the conference graph to contacts, replacing
--    conference_people.canonical_person_id.
alter table public.conference_people
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists idx_conference_people_contact_id
  on public.conference_people(contact_id);

create index if not exists idx_contacts_tenant_id
  on public.contacts(tenant_id) where tenant_id is not null;
