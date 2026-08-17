-- Release the remaining structural dependencies on `people` so the table can
-- be renamed (and later dropped) without cascading into live data.

-- activities: 374 rows, zero code reads or writes it — it seeds a future
-- feature. Drop only the FK constraint; the person_id column and its values
-- stay so nothing is destroyed and the ids remain remappable later.
alter table public.activities drop constraint if exists activities_person_id_fkey;

-- Unused view over people — no application consumer (only the generated types
-- reference the name).
drop view if exists public.person_activity_summary;

-- conference_people.canonical_person_id is superseded by contact_id (backfilled
-- above). Drop the FK so `people` is free; keep the column for one release as a
-- breadcrumb, to be dropped with the table.
alter table public.conference_people drop constraint if exists conference_people_canonical_person_id_fkey;

-- Dead FK columns: three of these tables are empty, two have person_id 100%
-- null while contact_id carries the live data.
alter table public.survey_invitations drop column if exists person_id;
alter table public.survey_responses  drop column if exists person_id;
alter table public.person_tags       drop constraint if exists person_tags_person_id_fkey;
alter table public.posts             drop constraint if exists posts_author_id_fkey;
alter table public.users             drop constraint if exists users_person_id_fkey;
