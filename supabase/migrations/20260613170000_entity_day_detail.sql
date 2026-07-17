-- v3 catalog proof — Day as a referenceable entity (the "backward reference").
--
-- The conference already KNOWS its dates (conference_instances.start_date/end_date).
-- A Day is just an entity of kind 'day' carrying that date, so a Session's "when"
-- can REFERENCE a day instead of starting blank. This is reference-or-create
-- rolling backward: we seed days from what we already know, you pick one.
--
-- Still part of the isolated proof thread (adopt-or-discard).

create table if not exists public.entity_day (
  entity_id uuid primary key references public.conference_entities(id) on delete cascade,
  date      date not null
);

alter table public.entity_day enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_day' and policyname='entity_day_authenticated_read') then
    execute 'create policy entity_day_authenticated_read on public.entity_day for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_day' and policyname='entity_day_admin_all') then
    execute 'create policy entity_day_admin_all on public.entity_day for all using (
        exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
      ) with check (
        exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
      )';
  end if;
end $$;
