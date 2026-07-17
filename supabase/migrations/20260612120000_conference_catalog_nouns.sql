-- Conference v2 Phase 1: promote schedule "nouns" out of
-- conference_schedule_modules.config_json into first-class tables so that
-- product grants (Phase 2) can reference them by FK.
-- See docs/CONFERENCE_V2_BLUEPRINT.md.
--
-- Additive only: the wizard's config_json remains untouched and authoritative
-- for the legacy UI until Phase 5. Backfill is idempotent (on conflict / not
-- exists guards) so this migration can be re-run safely.

-- ─────────────────────────────────────────────────────────────────────────────
-- conference_days — one row per calendar day of the conference
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.conference_days (
  id             uuid        primary key default gen_random_uuid(),
  conference_id  uuid        not null references public.conference_instances(id) on delete cascade,
  date           date        not null,
  day_profile    text        not null default 'full_day'
                   check (day_profile in ('full_day', 'half_day', 'travel', 'other')),
  label          text,
  sort           integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (conference_id, date)
);

comment on table public.conference_days is
  'Stage 1 catalog: each calendar day of a conference. Grant scopes (day_access) reference these rows.';

create index if not exists idx_conference_days_conference
  on public.conference_days(conference_id, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- conference_offsite_events — promoted from offsite module config_json
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.conference_offsite_events (
  id                           uuid        primary key default gen_random_uuid(),
  conference_id                uuid        not null references public.conference_instances(id) on delete cascade,
  -- id the wizard assigned inside config_json (e.g. 'offsite-1'); kept for
  -- reconciliation with legacy JSON until Phase 5 removes it
  legacy_key                   text,
  title                        text        not null,
  date                         date,
  start_time                   time,
  end_time                     time,

  google_place_id              text,
  venue_name                   text,
  venue_address                text,

  travel_mode                  text
                                 check (travel_mode is null or travel_mode in ('walk', 'shuttle', 'bus', 'own_transport')),
  travel_time_minutes          integer,
  departure_time               time,
  return_time                  time,
  meeting_point                text,

  includes_meal                boolean     not null default false,
  meal_type                    text
                                 check (meal_type is null or meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'custom')),
  meal_custom_label            text,

  audience_registration_types  text[]      not null default '{}',
  capacity                     integer,
  waitlist_enabled             boolean     not null default false,

  is_sponsored                 boolean     not null default false,
  sponsor_name                 text,
  sponsor_tier                 text,
  sponsorship_activation_notes text,

  waiver_required              boolean     not null default false,
  accessibility_notes          text,
  emergency_contact            text,
  contingency_plan             text,

  linked_product_id            uuid        references public.conference_products(id) on delete set null,
  status                       text        not null default 'planned'
                                 check (status in ('planned', 'confirmed', 'canceled')),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  unique (conference_id, legacy_key)
);

comment on table public.conference_offsite_events is
  'Stage 1 catalog: offsite events. Grant scopes (offsite_seat) reference these rows.';

create index if not exists idx_conference_offsite_events_conference
  on public.conference_offsite_events(conference_id, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- conference_meal_services — one row per meal/snack service per day
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.conference_meal_services (
  id                uuid        primary key default gen_random_uuid(),
  conference_id     uuid        not null references public.conference_instances(id) on delete cascade,
  day_id            uuid        not null references public.conference_days(id) on delete cascade,
  service           text        not null
                      check (service in ('breakfast', 'lunch', 'dinner', 'snack', 'custom')),
  label             text,
  start_time        time,
  duration_minutes  integer,
  capacity          integer,
  sort              integer     not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.conference_meal_services is
  'Stage 1 catalog: meal/snack services per conference day. Grant scopes (meal_access) reference these rows.';

-- breakfast/lunch/dinner/custom are singletons per day; snacks may repeat
create unique index if not exists uniq_conference_meal_services_day_service
  on public.conference_meal_services(day_id, service)
  where service <> 'snack';

create index if not exists idx_conference_meal_services_conference
  on public.conference_meal_services(conference_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- conference_education_sessions — sessions (or TBD day blocks) per day
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.conference_education_sessions (
  id             uuid        primary key default gen_random_uuid(),
  conference_id  uuid        not null references public.conference_instances(id) on delete cascade,
  day_id         uuid        references public.conference_days(id) on delete set null,
  stream         text,
  title          text        not null,
  start_time     time,
  end_time       time,
  capacity       integer,
  status         text        not null default 'planned'
                   check (status in ('planned', 'tbd', 'confirmed', 'canceled')),
  sort           integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.conference_education_sessions is
  'Stage 1 catalog: education sessions. Rows with status=tbd are day-level placeholders from the legacy wizard config.';

create index if not exists idx_conference_education_sessions_conference
  on public.conference_education_sessions(conference_id);

create index if not exists idx_conference_education_sessions_day
  on public.conference_education_sessions(day_id)
  where day_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — authenticated read, admin write (house pattern)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conference_days enable row level security;
alter table public.conference_offsite_events enable row level security;
alter table public.conference_meal_services enable row level security;
alter table public.conference_education_sessions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'conference_days',
    'conference_offsite_events',
    'conference_meal_services',
    'conference_education_sessions'
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
           exists (
             select 1 from public.profiles
             where id = auth.uid() and global_role in (''admin'', ''super_admin'')
           )
         ) with check (
           exists (
             select 1 from public.profiles
             where id = auth.uid() and global_role in (''admin'', ''super_admin'')
           )
         )',
        t || '_admin_all', t
      );
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 1: conference_days from instance dates + registration_ops
--             config_json.conference_day_profiles (sparse map; default full_day)
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.conference_days (conference_id, date, day_profile, sort)
select
  c.id,
  d.day::date,
  case
    when ro.config_json->'conference_day_profiles'->>(d.day::date)::text
         in ('full_day', 'half_day', 'travel', 'other')
    then ro.config_json->'conference_day_profiles'->>(d.day::date)::text
    else 'full_day'
  end,
  (row_number() over (partition by c.id order by d.day))::integer - 1
from public.conference_instances c
cross join lateral generate_series(
  c.start_date::timestamp, c.end_date::timestamp, interval '1 day'
) as d(day)
left join public.conference_schedule_modules ro
  on ro.conference_id = c.id and ro.module_key = 'registration_ops'
where c.start_date is not null and c.end_date is not null
on conflict (conference_id, date) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 2: conference_offsite_events from offsite module config_json
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.conference_offsite_events (
  conference_id, legacy_key, title, date, start_time, end_time,
  google_place_id, venue_name, venue_address,
  travel_mode, travel_time_minutes, departure_time, return_time, meeting_point,
  includes_meal, meal_type, meal_custom_label,
  audience_registration_types, capacity, waitlist_enabled,
  is_sponsored, sponsor_name, sponsor_tier, sponsorship_activation_notes,
  waiver_required, accessibility_notes, emergency_contact, contingency_plan,
  linked_product_id, status
)
select
  c.id,
  coalesce(nullif(e.value->>'id', ''), gen_random_uuid()::text),
  coalesce(nullif(e.value->>'title', ''), 'Untitled offsite event'),
  nullif(e.value->>'date', '')::date,
  nullif(e.value->>'start_time', '')::time,
  nullif(e.value->>'end_time', '')::time,
  nullif(e.value->>'google_place_id', ''),
  nullif(e.value->>'venue_name', ''),
  nullif(e.value->>'venue_address', ''),
  case when e.value->>'travel_mode' in ('walk', 'shuttle', 'bus', 'own_transport')
       then e.value->>'travel_mode' end,
  nullif(e.value->>'travel_time_minutes', '')::integer,
  nullif(e.value->>'departure_time', '')::time,
  nullif(e.value->>'return_time', '')::time,
  nullif(e.value->>'meeting_point', ''),
  coalesce((e.value->>'includes_meal')::boolean, false),
  case when e.value->>'meal_type' in ('breakfast', 'lunch', 'dinner', 'snack', 'custom')
       then e.value->>'meal_type' end,
  nullif(e.value->>'meal_custom_label', ''),
  coalesce(
    (select array_agg(t) from jsonb_array_elements_text(e.value->'audience_registration_types') t),
    '{}'
  ),
  nullif(e.value->>'capacity', '')::integer,
  coalesce((e.value->>'waitlist_enabled')::boolean, false),
  coalesce((e.value->>'is_sponsored')::boolean, false),
  nullif(e.value->>'sponsor_name', ''),
  nullif(e.value->>'sponsor_tier', ''),
  nullif(e.value->>'sponsorship_activation_notes', ''),
  coalesce((e.value->>'waiver_required')::boolean, false),
  nullif(e.value->>'accessibility_notes', ''),
  nullif(e.value->>'emergency_contact', ''),
  nullif(e.value->>'contingency_plan', ''),
  p.id,
  'planned'
from public.conference_schedule_modules m
join public.conference_instances c on c.id = m.conference_id
cross join lateral jsonb_array_elements(
  coalesce(m.config_json->'offsite_events', '[]'::jsonb)
) as e(value)
left join public.conference_products p
  on p.conference_id = c.id
 and p.id::text = nullif(e.value->>'linked_product_id', '')
where m.module_key = 'offsite'
on conflict (conference_id, legacy_key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 3: conference_meal_services from meals module
--             config_json.meal_day_settings
-- ─────────────────────────────────────────────────────────────────────────────

-- breakfast / lunch / dinner singletons
insert into public.conference_meal_services
  (conference_id, day_id, service, start_time, duration_minutes)
select
  c.id,
  d.id,
  svc.name,
  nullif(s.value->>(svc.name || '_time'), '')::time,
  nullif(s.value->>(svc.name || '_duration_minutes'), '')::integer
from public.conference_schedule_modules m
join public.conference_instances c on c.id = m.conference_id
cross join lateral jsonb_each(coalesce(m.config_json->'meal_day_settings', '{}'::jsonb)) as s(date_key, value)
join public.conference_days d on d.conference_id = c.id and d.date = s.date_key::date
cross join lateral (values ('breakfast'), ('lunch'), ('dinner')) as svc(name)
where m.module_key = 'meals'
  and coalesce((s.value->>svc.name)::boolean, false)
on conflict do nothing;

-- custom service (singleton per day when enabled)
insert into public.conference_meal_services
  (conference_id, day_id, service, label, start_time, duration_minutes)
select
  c.id,
  d.id,
  'custom',
  nullif(s.value->>'custom_label', ''),
  nullif(s.value->>'custom_time', '')::time,
  nullif(s.value->>'custom_duration_minutes', '')::integer
from public.conference_schedule_modules m
join public.conference_instances c on c.id = m.conference_id
cross join lateral jsonb_each(coalesce(m.config_json->'meal_day_settings', '{}'::jsonb)) as s(date_key, value)
join public.conference_days d on d.conference_id = c.id and d.date = s.date_key::date
where m.module_key = 'meals'
  and coalesce((s.value->>'custom_enabled')::boolean, false)
on conflict do nothing;

-- snack breaks (repeatable per day; guarded for idempotency)
insert into public.conference_meal_services
  (conference_id, day_id, service, start_time, duration_minutes, sort)
select
  c.id,
  d.id,
  'snack',
  nullif(b.value->>'start_time', '')::time,
  nullif(b.value->>'duration_minutes', '')::integer,
  b.ordinality::integer - 1
from public.conference_schedule_modules m
join public.conference_instances c on c.id = m.conference_id
cross join lateral jsonb_each(coalesce(m.config_json->'meal_day_settings', '{}'::jsonb)) as s(date_key, value)
join public.conference_days d on d.conference_id = c.id and d.date = s.date_key::date
cross join lateral jsonb_array_elements(coalesce(s.value->'snack_breaks', '[]'::jsonb))
  with ordinality as b(value, ordinality)
where m.module_key = 'meals'
  and not exists (
    select 1 from public.conference_meal_services existing
    where existing.day_id = d.id and existing.service = 'snack'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 4: conference_education_sessions — one TBD day block per
--             configured education day (no real session records exist yet)
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.conference_education_sessions
  (conference_id, day_id, title, start_time, end_time, status, sort)
select
  c.id,
  d.id,
  'Education block',
  nullif(m.config_json->'education_day_settings'->dd.value->>'start_time', '')::time,
  nullif(m.config_json->'education_day_settings'->dd.value->>'end_time', '')::time,
  'tbd',
  dd.ordinality::integer - 1
from public.conference_schedule_modules m
join public.conference_instances c on c.id = m.conference_id
cross join lateral jsonb_array_elements_text(coalesce(m.config_json->'education_days', '[]'::jsonb))
  with ordinality as dd(value, ordinality)
join public.conference_days d on d.conference_id = c.id and d.date = dd.value::date
where m.module_key = 'education'
  and not exists (
    select 1 from public.conference_education_sessions existing
    where existing.conference_id = c.id
  );
