-- Conference v2 Phase 2: product grants — what a product includes.
-- A grant is grant_type × quantity × scope. Scopes reference Stage 1 catalog
-- rows by FK (conference_days, conference_offsite_events, conference_meal_services,
-- conference_education_sessions) so a product can never include something the
-- conference doesn't have. See docs/CONFERENCE_V2_BLUEPRINT.md.
--
-- Backfill converts only the UNAMBIGUOUS legacy encodings:
--   * booth products (metadata.booth_system) → booth_space + day_access
--     grants derived from metadata.day_pattern
--   * products linked from conference_offsite_events → offsite_seat grants
-- Registration-option entitlements (occupancy modes) are option-level JSON with
-- known orphaned product references; they are NOT auto-converted. The grant
-- coverage report (lib/actions/conference-grants.ts) surfaces them for the
-- Package composer to resolve.

-- ─────────────────────────────────────────────────────────────────────────────
-- product_grants
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.product_grants (
  id                       uuid        primary key default gen_random_uuid(),
  product_id               uuid        not null references public.conference_products(id) on delete cascade,
  grant_type               text        not null check (grant_type in (
                             'booth_space',
                             'badge_seat',
                             'day_access',
                             'offsite_seat',
                             'meal_access',
                             'meeting_access',
                             'education_access'
                           )),
  quantity                 integer     not null default 1 check (quantity > 0),
  -- 'order': quantity is per order line (3 badge seats per booth package).
  -- 'attendee': quantity multiplies per assigned attendee (rarely needed; kept
  -- for parity with the blueprint vocabulary).
  per                      text        not null default 'order' check (per in ('order', 'attendee')),
  -- 'all': the grant covers every current AND future catalog row of its kind
  --        (e.g. meal_access to all meal services). New nouns flow in.
  -- 'selected': covered rows are enumerated in the join tables below.
  scope_mode               text        not null default 'all' check (scope_mode in ('all', 'selected')),
  scope_registration_type  text        check (scope_registration_type is null or scope_registration_type in (
                             'delegate', 'exhibitor', 'observer', 'staff', 'speaker'
                           )),
  scope_booth_id           uuid        references public.conference_booths(id) on delete set null,
  scope_offsite_event_id   uuid        references public.conference_offsite_events(id) on delete cascade,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.product_grants is
  'What a conference product includes: grant_type x quantity x scope. The Package composer is the only writer.';

create index if not exists idx_product_grants_product
  on public.product_grants(product_id);

create index if not exists idx_product_grants_offsite_event
  on public.product_grants(scope_offsite_event_id)
  where scope_offsite_event_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Scope join tables (used when scope_mode = 'selected')
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.product_grant_days (
  grant_id     uuid not null references public.product_grants(id) on delete cascade,
  day_id       uuid not null references public.conference_days(id) on delete cascade,
  access_kind  text not null default 'floor'
                 check (access_kind in ('floor', 'meeting', 'move_in', 'move_out')),
  primary key (grant_id, day_id, access_kind)
);

comment on table public.product_grant_days is
  'Day scope for day_access grants. access_kind distinguishes floor access, meeting-space days, and move-in/out.';

create table if not exists public.product_grant_meals (
  grant_id         uuid not null references public.product_grants(id) on delete cascade,
  meal_service_id  uuid not null references public.conference_meal_services(id) on delete cascade,
  primary key (grant_id, meal_service_id)
);

create table if not exists public.product_grant_sessions (
  grant_id    uuid not null references public.product_grants(id) on delete cascade,
  session_id  uuid not null references public.conference_education_sessions(id) on delete cascade,
  primary key (grant_id, session_id)
);

create index if not exists idx_product_grant_days_day on public.product_grant_days(day_id);
create index if not exists idx_product_grant_meals_service on public.product_grant_meals(meal_service_id);
create index if not exists idx_product_grant_sessions_session on public.product_grant_sessions(session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — authenticated read, admin write (house pattern)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.product_grants enable row level security;
alter table public.product_grant_days enable row level security;
alter table public.product_grant_meals enable row level security;
alter table public.product_grant_sessions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'product_grants',
    'product_grant_days',
    'product_grant_meals',
    'product_grant_sessions'
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
-- Conversion 1: booth products → booth_space grant
-- (metadata.booth_system = true marks the two booth tiers)
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.product_grants (product_id, grant_type, quantity, per, scope_mode, notes)
select p.id, 'booth_space', 1, 'order', 'all',
       'Converted from booth product (metadata.booth_system)'
from public.conference_products p
where coalesce((p.metadata->>'booth_system')::boolean, false)
  and not exists (
    select 1 from public.product_grants g
    where g.product_id = p.id and g.grant_type = 'booth_space'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Conversion 2: booth products → day_access grant from metadata.day_pattern
-- day_pattern: { "YYYY-MM-DD": ["move_in" | "floor" | "meeting" | "move_out", ...] }
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.product_grants (product_id, grant_type, quantity, per, scope_mode, notes)
select p.id, 'day_access', 1, 'order', 'selected',
       'Converted from booth product metadata.day_pattern'
from public.conference_products p
where coalesce((p.metadata->>'booth_system')::boolean, false)
  and jsonb_typeof(p.metadata->'day_pattern') = 'object'
  and not exists (
    select 1 from public.product_grants g
    where g.product_id = p.id and g.grant_type = 'day_access'
  );

insert into public.product_grant_days (grant_id, day_id, access_kind)
select g.id, d.id, kind.value
from public.product_grants g
join public.conference_products p on p.id = g.product_id
cross join lateral jsonb_each(p.metadata->'day_pattern') as dp(date_key, kinds)
join public.conference_days d
  on d.conference_id = p.conference_id and d.date = dp.date_key::date
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(dp.kinds) = 'array' then dp.kinds else '[]'::jsonb end
) as kind(value)
where g.grant_type = 'day_access'
  and g.notes = 'Converted from booth product metadata.day_pattern'
  and kind.value in ('floor', 'meeting', 'move_in', 'move_out')
on conflict (grant_id, day_id, access_kind) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conversion 3: offsite-linked products → offsite_seat grant scoped to the event
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.product_grants
  (product_id, grant_type, quantity, per, scope_mode, scope_offsite_event_id, notes)
select e.linked_product_id, 'offsite_seat', 1, 'order', 'selected', e.id,
       'Converted from offsite event product link'
from public.conference_offsite_events e
where e.linked_product_id is not null
  and not exists (
    select 1 from public.product_grants g
    where g.product_id = e.linked_product_id
      and g.grant_type = 'offsite_seat'
      and g.scope_offsite_event_id = e.id
  );
