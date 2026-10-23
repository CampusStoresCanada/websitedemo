-- The check-in desk PIN: one per staff member, hashed, server-only.
--
-- Set on first use of the desk (after a normal password sign-in). Guards two
-- things only: coming back from hand-over mode (an attendee paid on the iPad)
-- and approving an invoice. Five wrong tries clear it, which drops the desk
-- back to a password sign-in; signing in again lets them set a new one.
--
-- ⛔ Never the digits: pin_hash is "scrypt$<salt>$<hash>". RLS on with NO
-- policies, so only the service role (server code) can read or write it.

create table if not exists public.desk_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.desk_pins enable row level security;
revoke all on public.desk_pins from anon, authenticated;
