-- Chunk 20D follow-up: persist badge setup wizard progress server-side.

create table if not exists public.badge_setup_sessions (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  last_step integer not null default 1 check (last_step >= 1 and last_step <= 10),
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  unique (conference_id)
);

alter table public.badge_setup_sessions enable row level security;

grant select, insert, update on public.badge_setup_sessions to authenticated;

drop policy if exists badge_setup_sessions_admin_rw on public.badge_setup_sessions;
create policy badge_setup_sessions_admin_rw
  on public.badge_setup_sessions
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
