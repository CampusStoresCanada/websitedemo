-- Per-account preference bag on profiles.
--
-- profiles is 1:1 with auth.users, which is the right grain for a personal
-- setting. contacts is deliberately NOT used here: a person can hold several
-- contact rows (one per organization), so contacts.metadata would store an
-- account preference on a per-(person, org) row.
--
-- First consumer: circle_badge_paused — a personal off-switch for the header's
-- Circle notification poll, which bills two Circle API calls per refresh.
alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

comment on column public.profiles.preferences is
  'Per-account UI preferences. Keys: circle_badge_paused (bool) — suppresses the header Circle notification poll for this account.';
