-- Conference Booths: Physical booth inventory for the trade show floor.
-- Each row is one purchasable booth slot per conference instance.
-- map_cx/map_cy are centre coordinates in the original 1920×1080 SVG viewBox;
-- map_w/map_h are the display dimensions for the overlay rect.
--
-- zone 'connected'  → $6 000 total (includes pre-scheduled meeting day)
-- zone 'standard'   → $4 500 total (trade show floor access only)

-- ─────────────────────────────────────────────────────────────────────────────
-- Booth sale window columns on conference_instances
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conference_instances
  add column if not exists booth_sales_sponsor_open_at  timestamptz,
  add column if not exists booth_sales_general_open_at  timestamptz;

comment on column public.conference_instances.booth_sales_sponsor_open_at is
  'When sponsors (active sponsor_agreements) can begin selecting booths.';
comment on column public.conference_instances.booth_sales_general_open_at is
  'When general exhibitor booth selection opens (FCFS).';


-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.conference_booths (
  id               uuid        primary key default gen_random_uuid(),
  conference_id    uuid        not null references public.conference_instances(id) on delete cascade,
  booth_number     text        not null,
  zone             text        not null check (zone in ('connected', 'standard')),

  -- SVG overlay position (centre, 1920×1080 coordinate space)
  map_cx           numeric     not null,
  map_cy           numeric     not null,
  map_w            numeric     not null default 69,
  map_h            numeric     not null default 55,

  -- Lifecycle
  status           text        not null default 'available'
                     check (status in ('available', 'sponsor_hold', 'reserved', 'sold', 'waitlisted')),

  -- Assignment — populated after purchase completes
  organization_id  uuid        references public.organizations(id) on delete set null,
  registration_id  uuid        references public.conference_registrations(id) on delete set null,
  order_id         uuid        references public.conference_orders(id) on delete set null,

  -- Soft hold while the buyer completes checkout (20-min window)
  reserved_at      timestamptz,
  reserved_until   timestamptz,
  sold_at          timestamptz,

  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique(conference_id, booth_number)
);

create index if not exists idx_conference_booths_conference
  on public.conference_booths(conference_id, status);

create index if not exists idx_conference_booths_org
  on public.conference_booths(organization_id)
  where organization_id is not null;

create index if not exists idx_conference_booths_reserved_until
  on public.conference_booths(reserved_until)
  where status = 'reserved';


-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conference_booths enable row level security;

-- Floor plan is publicly visible (anyone can see availability on the website)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'conference_booths'
      and policyname = 'conference_booths_public_read'
  ) then
    create policy "conference_booths_public_read"
      on public.conference_booths for select
      using (true);
  end if;
end $$;

-- Admins can do everything
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'conference_booths'
      and policyname = 'conference_booths_admin_all'
  ) then
    create policy "conference_booths_admin_all"
      on public.conference_booths for all
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid()
            and global_role in ('admin', 'super_admin')
        )
      )
      with check (
        exists (
          select 1 from public.profiles
          where id = auth.uid()
            and global_role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: reserve_booth
-- Atomically soft-holds a booth for 20 minutes while the buyer pays.
-- Returns 'ok' on success, 'unavailable' if already taken.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reserve_booth(
  p_booth_id      uuid,
  p_org_id        uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  -- Read current status with a row lock
  select status into v_status
  from public.conference_booths
  where id = p_booth_id
  for update;

  if not found then
    return 'not_found';
  end if;

  -- Allow claiming an expired reservation (reserved_until in the past)
  if v_status = 'reserved' then
    if (select reserved_until from public.conference_booths where id = p_booth_id) > now() then
      return 'unavailable';
    end if;
  elsif v_status <> 'available' then
    return 'unavailable';
  end if;

  update public.conference_booths
  set
    status          = 'reserved',
    organization_id = p_org_id,
    reserved_at     = now(),
    reserved_until  = now() + interval '20 minutes',
    updated_at      = now()
  where id = p_booth_id;

  return 'ok';
end;
$$;

grant execute on function public.reserve_booth(uuid, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: release_expired_booth_holds
-- Resets holds whose 20-min window has elapsed. Call from a cron job.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.release_expired_booth_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.conference_booths
  set
    status          = 'available',
    organization_id = null,
    reserved_at     = null,
    reserved_until  = null,
    updated_at      = now()
  where status = 'reserved'
    and reserved_until < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.release_expired_booth_holds() to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: confirm_booth_sale
-- Marks a booth as sold after payment is confirmed.
-- Called by the server-side payment webhook / admin approval handler.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.confirm_booth_sale(
  p_booth_id       uuid,
  p_org_id         uuid,
  p_order_id       uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_org    uuid;
begin
  select status, organization_id into v_status, v_org
  from public.conference_booths
  where id = p_booth_id
  for update;

  if not found then
    return 'not_found';
  end if;

  -- Must be reserved by this org (or be a sponsor_hold being confirmed)
  if v_status not in ('reserved', 'sponsor_hold') then
    return 'not_reserved';
  end if;

  if v_status = 'reserved' and v_org <> p_org_id then
    return 'wrong_org';
  end if;

  update public.conference_booths
  set
    status          = 'sold',
    organization_id = p_org_id,
    order_id        = p_order_id,
    reserved_at     = null,
    reserved_until  = null,
    sold_at         = now(),
    updated_at      = now()
  where id = p_booth_id;

  return 'ok';
end;
$$;

grant execute on function public.confirm_booth_sale(uuid, uuid, uuid) to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: 2027 conference booths
-- Conditional on the conference instance existing (year=2027, edition_code='00').
-- If not yet created, run this migration again after creating the conference,
-- or insert the rows manually after creating the instance.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_conf_id uuid;
begin
  select id into v_conf_id
  from public.conference_instances
  where year = 2027 and edition_code = '00'
  limit 1;

  if v_conf_id is null then
    raise notice 'Conference 2027/00 not found — skipping booth seed. Re-run after creating the instance.';
    return;
  end if;

  -- Set sale window dates
  update public.conference_instances
  set
    booth_sales_sponsor_open_at = '2026-07-15 00:00:00 America/Toronto',
    booth_sales_general_open_at = '2026-08-04 10:00:00 America/Toronto'
  where id = v_conf_id
    and booth_sales_sponsor_open_at is null;

  -- Insert all 60 booths (no-op if already seeded)
  insert into public.conference_booths
    (conference_id, booth_number, zone, map_cx, map_cy, map_w, map_h)
  values
    -- ── Connected booths (31) ──────────────────────────────────────────────

    -- Top perimeter row (even-numbered, face north wall)
    (v_conf_id, '100', 'connected',  969, 159, 69, 55),
    (v_conf_id, '102', 'connected', 1039, 159, 69, 55),
    (v_conf_id, '104', 'connected', 1108, 159, 69, 55),
    (v_conf_id, '106', 'connected', 1177, 159, 69, 55),
    (v_conf_id, '108', 'connected', 1246, 159, 69, 55),
    (v_conf_id, '110', 'connected', 1314, 159, 69, 55),
    (v_conf_id, '112', 'connected', 1383, 159, 69, 55),

    -- Island block 1 – north face (odd 101–109)
    (v_conf_id, '101', 'connected', 1036, 272, 69, 55),
    (v_conf_id, '103', 'connected', 1102, 272, 69, 55),
    (v_conf_id, '105', 'connected', 1170, 272, 69, 55),
    (v_conf_id, '107', 'connected', 1239, 272, 69, 55),
    (v_conf_id, '109', 'connected', 1307, 272, 69, 55),

    -- Island block 1 – south face (even 200–208)
    (v_conf_id, '200', 'connected', 1029, 327, 69, 55),
    (v_conf_id, '202', 'connected', 1099, 327, 69, 55),
    (v_conf_id, '204', 'connected', 1167, 327, 69, 55),
    (v_conf_id, '206', 'connected', 1236, 327, 69, 55),
    (v_conf_id, '208', 'connected', 1305, 327, 69, 55),

    -- Island block 2 – north face (odd 201–209)
    (v_conf_id, '201', 'connected', 1033, 441, 69, 55),
    (v_conf_id, '203', 'connected', 1100, 441, 69, 55),
    (v_conf_id, '205', 'connected', 1168, 441, 69, 55),
    (v_conf_id, '207', 'connected', 1237, 441, 69, 55),
    (v_conf_id, '209', 'connected', 1305, 441, 69, 55),

    -- Island block 2 – south face (even 300, 302, 304, 306, 308 → Connected)
    (v_conf_id, '300', 'connected', 1029, 496, 69, 55),
    (v_conf_id, '302', 'connected', 1100, 496, 69, 55),
    (v_conf_id, '304', 'connected', 1167, 496, 69, 55),
    (v_conf_id, '306', 'connected', 1236, 496, 69, 55),
    (v_conf_id, '308', 'connected', 1305, 496, 69, 55),

    -- Standalone booth (centre aisle, non-rotated portrait)
    (v_conf_id, '600', 'connected',  911, 275,  54, 67),

    -- Right wall – north cluster (non-rotated portrait)
    (v_conf_id, '700', 'connected', 1428, 264,  55, 69),
    (v_conf_id, '702', 'connected', 1428, 333,  55, 69),
    (v_conf_id, '704', 'connected', 1428, 401,  55, 69),

    -- ── Standard booths (29) ──────────────────────────────────────────────

    -- Left cluster – bottom row (horizontal)
    (v_conf_id,  '01', 'standard',  783, 676, 69, 55),
    (v_conf_id,  '02', 'standard',  713, 676, 69, 55),
    (v_conf_id,  '03', 'standard',  644, 676, 69, 55),

    -- Left cluster – standalone portrait
    (v_conf_id,  '04', 'standard',  539, 581,  55, 69),

    -- Left cluster – 2×2 block (mixed orientation)
    (v_conf_id,  '05', 'standard',  696, 558, 69, 55),  -- horizontal
    (v_conf_id,  '06', 'standard',  758, 551,  55, 69), -- portrait
    (v_conf_id,  '07', 'standard',  758, 483,  55, 69), -- portrait
    (v_conf_id,  '08', 'standard',  696, 476, 69, 55),  -- horizontal

    -- Island block 3 – north face (odd 301–309 → Standard)
    (v_conf_id, '301', 'standard', 1033, 608, 69, 55),
    (v_conf_id, '303', 'standard', 1100, 608, 69, 55),
    (v_conf_id, '305', 'standard', 1168, 608, 69, 55),
    (v_conf_id, '307', 'standard', 1237, 608, 69, 55),
    (v_conf_id, '309', 'standard', 1305, 608, 69, 55),

    -- Island block 3 – south face (even 400–408 → Standard)
    (v_conf_id, '400', 'standard', 1029, 663, 69, 55),
    (v_conf_id, '402', 'standard', 1099, 663, 69, 55),
    (v_conf_id, '404', 'standard', 1166, 663, 69, 55),
    (v_conf_id, '406', 'standard', 1235, 663, 69, 55),
    (v_conf_id, '408', 'standard', 1304, 663, 69, 55),

    -- Island block 4 – north face (odd 403–409 → Standard)
    (v_conf_id, '403', 'standard', 1099, 775, 69, 55),
    (v_conf_id, '405', 'standard', 1167, 775, 69, 55),
    (v_conf_id, '407', 'standard', 1236, 775, 69, 55),
    (v_conf_id, '409', 'standard', 1304, 775, 69, 55),

    -- Island block 4 – south face (even 502–508 → Standard)
    (v_conf_id, '502', 'standard', 1099, 830, 69, 55),
    (v_conf_id, '504', 'standard', 1167, 830, 69, 55),
    (v_conf_id, '506', 'standard', 1236, 830, 69, 55),
    (v_conf_id, '508', 'standard', 1305, 830, 69, 55),

    -- Right wall – south cluster (non-rotated portrait)
    (v_conf_id, '714', 'standard', 1428, 742,  55, 69),
    (v_conf_id, '716', 'standard', 1428, 810,  55, 69),
    (v_conf_id, '718', 'standard', 1428, 879,  55, 69)

  on conflict (conference_id, booth_number) do nothing;

  raise notice 'Seeded % booths for conference 2027/00.',
    (select count(*) from public.conference_booths where conference_id = v_conf_id);
end;
$$;
