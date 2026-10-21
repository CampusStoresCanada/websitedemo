-- Print stations: the laptop beside the Brother QL that prints what the desk
-- queues, straight to the printer at each sticker's exact length.
--
-- ⛔ Its own key, not a person's login and not a site secret: one per laptop,
-- per conference, revocable, shown once and stored only as a SHA-256 hash.
-- What the key can do is narrow — claim and print this conference's queued
-- reprint stickers, and report the printer's state.
--
-- RLS on with NO policies: only server code (service role) reads or writes.

create table if not exists public.print_stations (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  label text not null,
  key_hash text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- Heartbeat: the desk shows a station as online when this is recent.
  last_seen_at timestamptz,
  -- What the printer last said: "ready", or its own error ("Replace media error").
  printer_status text,
  printer_media text
);

create index if not exists idx_print_stations_conference on public.print_stations(conference_id);

alter table public.print_stations enable row level security;
revoke all on public.print_stations from anon, authenticated;
