-- Conference v3 catalog (proof thread) — kinds, references, sellable capability.
--
-- The model the user reasoned out: everything is an ENTITY of a named KIND;
-- one universal REFERENCE links any entity to any other (with optional quantity
-- + role) — that single thing is composition / "packaging" / grants / who /
-- where; and "sellable" (an Offer) is a CAPABILITY any entity can wear, not a
-- separate kind. See docs/CONFERENCE_V2_BLUEPRINT.md §6d.
--
-- This is an ISOLATED proof — it sits alongside the facet tables (slice 2)
-- without touching them, so it's adopt-or-discard. If adopted, the facet tables
-- and product_grants/etc. are removed and replaced by this.

create table if not exists public.conference_entities (
  id             uuid        primary key default gen_random_uuid(),
  conference_id  uuid        not null references public.conference_instances(id) on delete cascade,
  kind           text        not null check (kind in (
                   'day', 'venue', 'floorplan', 'meal', 'session', 'event',
                   'networking', 'audience', 'booth_category', 'policy'
                 )),
  name           text        not null,
  -- sellable capability (an Offer): present price = for sale
  is_for_sale    boolean     not null default false,
  price_cents    integer,
  currency       text        not null default 'CAD',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.conference_entities is
  'v3 catalog: one entity per thing, typed by kind. Sellable is a capability (is_for_sale + price). See blueprint §6d.';

create index if not exists idx_conference_entities_conf_kind
  on public.conference_entities(conference_id, kind);

-- The ONE universal reference: any entity → any entity, with role + quantity.
-- This is composition, packaging, grants, "who attends", "where", all at once.
create table if not exists public.conference_entity_refs (
  id              uuid        primary key default gen_random_uuid(),
  conference_id   uuid        not null references public.conference_instances(id) on delete cascade,
  from_entity_id  uuid        not null references public.conference_entities(id) on delete cascade,
  to_entity_id    uuid        not null references public.conference_entities(id) on delete cascade,
  role            text        not null,
  quantity        integer,
  created_at      timestamptz not null default now(),
  unique (from_entity_id, to_entity_id, role)
);

create index if not exists idx_entity_refs_from on public.conference_entity_refs(from_entity_id);
create index if not exists idx_entity_refs_to on public.conference_entity_refs(to_entity_id);

-- Per-kind detail (the kind's own attributes / "what do I need to know").
create table if not exists public.entity_session (
  entity_id   uuid primary key references public.conference_entities(id) on delete cascade,
  date        date,
  start_time  time,
  end_time    time,
  purpose     text,
  format      text
);

create table if not exists public.entity_venue (
  entity_id  uuid primary key references public.conference_entities(id) on delete cascade,
  address    text,
  capacity   integer
);

create table if not exists public.entity_audience (
  entity_id    uuid primary key references public.conference_entities(id) on delete cascade,
  description  text
);

-- RLS (house pattern: authenticated read, admin write)
alter table public.conference_entities enable row level security;
alter table public.conference_entity_refs enable row level security;
alter table public.entity_session enable row level security;
alter table public.entity_venue enable row level security;
alter table public.entity_audience enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'conference_entities', 'conference_entity_refs',
    'entity_session', 'entity_venue', 'entity_audience'
  ]
  loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_authenticated_read') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_authenticated_read', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_admin_all') then
      execute format(
        'create policy %I on public.%I for all using (
           exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
         ) with check (
           exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
         )', t||'_admin_all', t);
    end if;
  end loop;
end $$;
