-- ─────────────────────────────────────────────────────────────────
-- Chunk 24: Events (Non-Conference)
--
-- Tables: events, event_registrations, event_waitlist, event_checkins
-- ─────────────────────────────────────────────────────────────────

-- ── events ────────────────────────────────────────────────────────

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  title         text not null,
  description   text,
  body_html     text,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  location      text,
  virtual_link  text,
  is_virtual    boolean not null default false,
  audience_mode text not null default 'members_only'
                check (audience_mode in ('public', 'members_only')),
  capacity      integer,          -- null = unlimited
  status        text not null default 'pending_review'
                check (status in ('pending_review', 'draft', 'published', 'cancelled', 'completed')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_events_status     on public.events(status);
create index if not exists idx_events_starts_at  on public.events(starts_at);
create index if not exists idx_events_created_by on public.events(created_by);

alter table public.events enable row level security;

-- anon: only published public events
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'events' and policyname = 'events_anon_read') then
    create policy "events_anon_read" on public.events for select to anon using (status = 'published' and audience_mode = 'public');
  end if;
end $$;

-- authenticated: all published events (both audience modes)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'events' and policyname = 'events_member_read') then
    create policy "events_member_read" on public.events for select to authenticated using (status = 'published');
  end if;
end $$;

-- creators see their own events regardless of status
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'events' and policyname = 'events_creator_read') then
    create policy "events_creator_read" on public.events for select to authenticated using (created_by = auth.uid());
  end if;
end $$;

-- all writes go through admin client (server actions bypass RLS)

-- ── event_registrations ──────────────────────────────────────────

create table if not exists public.event_registrations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'registered'
                check (status in ('registered', 'cancelled', 'waitlisted', 'promoted')),
  registered_at timestamptz not null default now(),
  cancelled_at  timestamptz,
  unique (event_id, user_id)
);

create index if not exists idx_event_reg_event on public.event_registrations(event_id);
create index if not exists idx_event_reg_user  on public.event_registrations(user_id);

alter table public.event_registrations enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_registrations' and policyname = 'event_reg_owner_read') then
    create policy "event_reg_owner_read" on public.event_registrations for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ── event_waitlist ───────────────────────────────────────────────

create table if not exists public.event_waitlist (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  position    integer not null,
  joined_at   timestamptz not null default now(),
  promoted_at timestamptz,
  unique (event_id, user_id)
);

create index if not exists idx_event_waitlist_event on public.event_waitlist(event_id, position);

alter table public.event_waitlist enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_waitlist' and policyname = 'event_waitlist_owner_read') then
    create policy "event_waitlist_owner_read" on public.event_waitlist for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ── event_checkins ───────────────────────────────────────────────

create table if not exists public.event_checkins (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  checked_in_at   timestamptz not null default now(),
  checked_in_by   uuid references auth.users(id) on delete set null,
  unique (event_id, user_id)
);

create index if not exists idx_event_checkins_event on public.event_checkins(event_id);

alter table public.event_checkins enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_checkins' and policyname = 'event_checkin_owner_read') then
    create policy "event_checkin_owner_read" on public.event_checkins for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
