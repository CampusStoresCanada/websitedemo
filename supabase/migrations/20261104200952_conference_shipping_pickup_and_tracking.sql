-- The shipping station's single Purolator pickup, and tracking.
--
-- Pickup (Steve, 2026-11-04): ONE pickup for the whole conference, on the
-- Friday morning after it, from the hotel's loading dock. Every shipment is
-- booked PRESCHEDULED; staff book the pickup once from the War Room with
-- everything added up, and update it if more boxes come in. Purolator issues
-- a new confirmation number on every change, so the row keeps the latest.
--
-- conference_instances.shipping_pickup holds the settings (date, window,
-- location, the venue contact). For CSC 2027 it was set directly, not here:
-- 2027-02-05, 08:00-12:00, LoadingDock, Tiffany Burt at the Hilton.
--
-- Tracking: what Purolator's tracking last said, refreshed by a cron
-- (/api/cron/shipping-tracking) until each shipment is delivered.

alter table public.conference_instances
  add column if not exists shipping_pickup jsonb;

comment on column public.conference_instances.shipping_pickup is
  'The single Purolator pickup for the shipping station: {date, anyTimeAfter, untilTime, location, contact:{name, company, phone, email}, instructions}';

create table public.conference_shipping_pickups (
  id                          uuid primary key default gen_random_uuid(),
  conference_id               uuid not null references public.conference_instances(id) on delete restrict,
  confirmation_number         text not null,
  pickup_date                 date not null,
  total_pieces                integer not null,
  total_weight_lb             numeric(9,2) not null,
  purolator_environment       text not null check (purolator_environment in ('sandbox', 'production')),
  booked_by                   uuid references auth.users(id) on delete set null,
  booked_at                   timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  voided_at                   timestamptz,
  voided_by                   uuid references auth.users(id) on delete set null
);

-- One live pickup per conference.
create unique index conference_shipping_pickups_one_live
  on public.conference_shipping_pickups (conference_id) where voided_at is null;

alter table public.conference_shipments
  add column if not exists tracking_code text,
  add column if not exists tracking_status text,
  add column if not exists tracking_last_event text,
  add column if not exists tracking_checked_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_to text;

revoke all on public.conference_shipping_pickups from anon, authenticated;
alter table public.conference_shipping_pickups enable row level security;
