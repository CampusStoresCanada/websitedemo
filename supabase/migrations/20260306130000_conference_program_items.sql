-- Chunk: Conference Program Builder foundation
-- Adds a reusable conference program/event model beyond meeting-only parameters.

create table if not exists public.conference_program_items (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  item_type text not null check (
    item_type in (
      'meeting',
      'meal',
      'education',
      'trade_show',
      'offsite',
      'move_in',
      'move_out',
      'custom'
    )
  ),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_label text,
  audience_mode text not null default 'all_attendees' check (
    audience_mode in ('all_attendees', 'target_roles', 'manual_curated')
  ),
  target_roles text[] not null default '{}'::text[],
  is_required boolean not null default false,
  display_order integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_conference_program_items_conference_start
  on public.conference_program_items(conference_id, starts_at, display_order);

create index if not exists idx_conference_program_items_type
  on public.conference_program_items(conference_id, item_type);

alter table public.conference_program_items enable row level security;

create policy "Authenticated users can read conference program items"
  on public.conference_program_items
  for select
  to authenticated
  using (true);

comment on table public.conference_program_items is
  'Canonical conference schedule/program blocks (meetings, meals, education, trade show, offsite, move-in/out, etc.)';

comment on column public.conference_program_items.audience_mode is
  'How attendees are targeted: all_attendees, target_roles, manual_curated';

comment on column public.conference_program_items.target_roles is
  'Audience role tags used when audience_mode = target_roles (e.g., delegate, exhibitor, staff)';

