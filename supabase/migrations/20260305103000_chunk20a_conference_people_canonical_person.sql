-- Chunk 20A hardening: explicit canonical person linkage on conference_people.

alter table public.conference_people
  add column if not exists canonical_person_id uuid references public.people(id) on delete set null;

create index if not exists idx_conference_people_canonical_person
  on public.conference_people(canonical_person_id);

-- Backfill from user linkage where available.
update public.conference_people cp
set canonical_person_id = u.person_id
from public.users u
where cp.user_id = u.id
  and u.person_id is not null
  and cp.canonical_person_id is distinct from u.person_id;

-- Backfill from organization+email match as a secondary canonical source.
update public.conference_people cp
set canonical_person_id = p.id
from public.people p
where cp.canonical_person_id is null
  and cp.organization_id = p.organization_id
  and (
    (cp.contact_email is not null and lower(trim(cp.contact_email)) = lower(trim(p.primary_email)))
    or (
      cp.assigned_email_snapshot is not null
      and lower(trim(cp.assigned_email_snapshot)) = lower(trim(p.primary_email))
    )
  );
