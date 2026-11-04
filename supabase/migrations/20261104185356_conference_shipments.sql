-- Conference shipping station: attendees ship boxes home with Purolator.
--
-- Design: docs/purolator/SHIPPING_STATION_DESIGN.md. One row per booking, one
-- row per box. A row exists only once Purolator has booked the shipment: a
-- failed booking saves nothing (last year's app saved a fake tracking number
-- and invoiced it).
--
-- The old `shipments` table stays as last year's read-only archive. It is not
-- reused: its columns encode one box per shipment and billing the estimate.

-- Where the station's boxes ship FROM (the venue's loading dock, not the
-- conference's city). Purolator needs a street address; location_venue is a name.
alter table public.conference_instances
  add column if not exists shipping_origin jsonb;

comment on column public.conference_instances.shipping_origin is
  'Ship-from address for the shipping station: {companyName, streetAddress[], city, provinceStateCode, postalZipCode, phoneNumber?}';

create table public.conference_shipments (
  id                          uuid primary key default gen_random_uuid(),
  conference_id               uuid not null references public.conference_instances(id) on delete restrict,
  -- Who is shipping. Nullable so a person removed from the roster never takes
  -- a booked (and billable) shipment with them.
  conference_person_id        uuid references public.conference_people(id) on delete set null,
  -- Who pays: the institution invoiced, or whose Purolator account was used.
  organization_id             uuid references public.organizations(id) on delete set null,
  booked_by                   uuid references auth.users(id) on delete set null,

  -- Printed on the label as "REF:" and carried onto Purolator's invoice, so a
  -- bill line can be matched back here. Short because Purolator caps it at 30.
  reference                   text not null unique,

  billing_mode                text not null check (billing_mode in ('csc_rebill', 'institution_account')),
  -- The account Purolator bills: CSC's, or the institution's own.
  purolator_account           text not null,
  -- 'sandbox' rows are rehearsals against Purolator's test system: nothing
  -- ships and nothing is billed.
  purolator_environment       text not null check (purolator_environment in ('sandbox', 'production')),
  service_id                  text not null,

  -- Destination, as sent to Purolator.
  receiver_company            text,
  receiver_attention          text,
  receiver_street             text[] not null,
  receiver_city               text not null,
  receiver_province           text not null,
  receiver_postal_code        text not null,
  receiver_phone              text,

  shipment_pin                text not null,
  status                      text not null default 'booked'
                                check (status in ('booked', 'voided', 'billed', 'no_charge')),

  -- What we told them at booking, frozen: base, each surcharge, each tax, total (cents).
  quote                       jsonb,
  -- What Purolator actually billed, entered or imported after the event.
  actual                      jsonb,
  actual_entered_by           uuid references auth.users(id) on delete set null,
  actual_entered_at           timestamptz,
  invoice_id                  uuid references public.invoices(id) on delete set null,

  -- Quote this to Purolator support.
  purolator_request_reference text,

  voided_at                   timestamptz,
  voided_by                   uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index conference_shipments_conference_idx on public.conference_shipments (conference_id, created_at desc);
create index conference_shipments_person_idx on public.conference_shipments (conference_person_id);
create index conference_shipments_pin_idx on public.conference_shipments (shipment_pin);

create table public.conference_shipment_packages (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references public.conference_shipments(id) on delete cascade,
  piece_number  integer not null check (piece_number >= 1),
  weight_lb     numeric(7,2) not null check (weight_lb > 0),
  length_in     numeric(6,2) not null check (length_in > 0),
  width_in      numeric(6,2) not null check (width_in > 0),
  height_in     numeric(6,2) not null check (height_in > 0),
  -- One tracking number per box: what an invoice line is matched on.
  package_pin   text not null,
  created_at    timestamptz not null default now(),
  unique (shipment_id, piece_number)
);

create index conference_shipment_packages_pin_idx on public.conference_shipment_packages (package_pin);

-- Access: every read and write goes through server code on the service role.
-- No grants to anon/authenticated and no policies: a session-client query
-- fails loudly instead of matching zero rows (see db-access-baseline.ts).
revoke all on public.conference_shipments, public.conference_shipment_packages from anon, authenticated;
alter table public.conference_shipments         enable row level security;
alter table public.conference_shipment_packages enable row level security;
