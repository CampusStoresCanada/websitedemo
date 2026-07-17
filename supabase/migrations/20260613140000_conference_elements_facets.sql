-- Conference v2 catalog rearchitecture (slice 2a): faceted elements.
--
-- One conference_element is a thing that happens (Meet & Greet, a lunch, a
-- session, a sponsorship). It wears typed FACETS — event / location / meal /
-- education / sponsorable — and a facet's *presence* (a row in its detail
-- table) IS the facet being on. This replaces the separate noun tables
-- (offsite_events / meal_services / education_sessions); a Meet & Greet stops
-- being three disconnected rows and becomes one element with three facets.
--
-- Days stay separate as the time spine (conference_days); elements reference
-- dates. Additive in this slice — the old noun tables are removed in 2b once
-- grants and the editor point at elements.
-- See docs/CONFERENCE_V2_BLUEPRINT.md §6c.

create table if not exists public.conference_elements (
  id             uuid        primary key default gen_random_uuid(),
  conference_id  uuid        not null references public.conference_instances(id) on delete cascade,
  name           text        not null,
  description    text,
  status         text        not null default 'planned'
                   check (status in ('planned', 'tbd', 'confirmed', 'canceled')),
  sort           integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.conference_elements is
  'A faceted conference thing (event/meal/session/sponsorship). Facets are the per-facet detail tables; a row there = that facet is on. Grants scope to these (slice 2b).';

create index if not exists idx_conference_elements_conference
  on public.conference_elements(conference_id);

-- ── Facet detail tables (PK element_id; presence = facet on) ─────────────────

create table if not exists public.element_event_facet (
  element_id   uuid primary key references public.conference_elements(id) on delete cascade,
  date         date,
  start_time   time,
  end_time     time
);

create table if not exists public.element_location_facet (
  element_id           uuid primary key references public.conference_elements(id) on delete cascade,
  venue_name           text,
  venue_address        text,
  google_place_id      text,
  capacity             integer,
  travel_mode          text check (travel_mode is null or travel_mode in ('walk', 'shuttle', 'bus', 'own_transport')),
  travel_time_minutes  integer
);

create table if not exists public.element_meal_facet (
  element_id       uuid primary key references public.conference_elements(id) on delete cascade,
  meal_type        text check (meal_type is null or meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'custom')),
  dietary_capture  boolean not null default false
);

create table if not exists public.element_education_facet (
  element_id  uuid primary key references public.conference_elements(id) on delete cascade,
  stream      text
);

create table if not exists public.element_sponsorable_facet (
  element_id          uuid primary key references public.conference_elements(id) on delete cascade,
  tier                text,
  tied_to_year_round  boolean not null default false,
  notes               text
);

-- ── RLS (house pattern: authenticated read, admin write) ─────────────────────

alter table public.conference_elements enable row level security;
alter table public.element_event_facet enable row level security;
alter table public.element_location_facet enable row level security;
alter table public.element_meal_facet enable row level security;
alter table public.element_education_facet enable row level security;
alter table public.element_sponsorable_facet enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'conference_elements',
    'element_event_facet',
    'element_location_facet',
    'element_meal_facet',
    'element_education_facet',
    'element_sponsorable_facet'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_authenticated_read'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        t || '_authenticated_read', t
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_admin_all'
    ) then
      execute format(
        'create policy %I on public.%I for all using (
           exists (select 1 from public.profiles where id = auth.uid() and global_role in (''admin'', ''super_admin''))
         ) with check (
           exists (select 1 from public.profiles where id = auth.uid() and global_role in (''admin'', ''super_admin''))
         )',
        t || '_admin_all', t
      );
    end if;
  end loop;
end $$;
