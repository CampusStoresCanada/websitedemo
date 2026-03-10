-- Chunk 20B: war-room scanner foundations.

create table if not exists public.conference_badge_tokens (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  person_id uuid not null references public.conference_people(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  unique (conference_id, token_hash)
);

create index if not exists idx_conference_badge_tokens_person
  on public.conference_badge_tokens(conference_id, person_id);

create table if not exists public.conference_check_in_events (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  person_id uuid references public.conference_people(id) on delete set null,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references public.profiles(id),
  check_in_source text not null check (check_in_source in ('qr', 'manual')),
  scan_token_id uuid references public.conference_badge_tokens(id) on delete set null,
  device_id text,
  result_state text not null check (result_state in ('valid', 'already_checked_in', 'invalid_token', 'revoked_token', 'not_found')),
  created_at timestamptz not null default now()
);

create index if not exists idx_conference_check_in_events_conf_time
  on public.conference_check_in_events(conference_id, checked_in_at desc);
create index if not exists idx_conference_check_in_events_person_time
  on public.conference_check_in_events(person_id, checked_in_at desc);

alter table public.conference_badge_tokens enable row level security;
alter table public.conference_check_in_events enable row level security;

grant select, insert, update on public.conference_badge_tokens to authenticated;
grant select, insert on public.conference_check_in_events to authenticated;

drop policy if exists conference_badge_tokens_admin_rw on public.conference_badge_tokens;
create policy conference_badge_tokens_admin_rw
  on public.conference_badge_tokens
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists conference_check_in_events_admin_rw on public.conference_check_in_events;
create policy conference_check_in_events_admin_rw
  on public.conference_check_in_events
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );

