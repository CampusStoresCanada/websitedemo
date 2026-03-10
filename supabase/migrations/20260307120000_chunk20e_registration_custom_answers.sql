alter table public.conference_registrations
  add column if not exists registration_custom_answers jsonb not null default '{}'::jsonb;

