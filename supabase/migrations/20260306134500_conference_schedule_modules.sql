-- Modular schedule-design configuration per conference.

create table if not exists public.conference_schedule_modules (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  module_key text not null check (
    module_key in ('meetings', 'trade_show', 'education', 'meals', 'offsite', 'custom')
  ),
  enabled boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conference_id, module_key)
);

create index if not exists idx_conference_schedule_modules_conference
  on public.conference_schedule_modules(conference_id, module_key);

alter table public.conference_schedule_modules enable row level security;

create policy "Authenticated users can read conference schedule modules"
  on public.conference_schedule_modules
  for select
  to authenticated
  using (true);

comment on table public.conference_schedule_modules is
  'Feature-module selection and module-specific setup config for conference schedule design wizard.';

