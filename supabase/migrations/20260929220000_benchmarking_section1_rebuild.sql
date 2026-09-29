-- Annual key dates: forward-looking institutional dates for the year ahead.
-- On the ORGANISATION, not the submission — they outlive any one survey and the
-- admin calendar should be able to read them. The survey confirms them yearly.
create table if not exists organization_key_dates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  label text not null,
  occurs_on date,
  ends_on date,
  academic_year integer,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists organization_key_dates_org_idx
  on organization_key_dates (organization_id, academic_year, position);

-- Hours move to the location. A store with a seasonal kiosk and a main shop does
-- not have one set of hours; asking for one produced a number describing neither.
alter table benchmarking_locations
  add column if not exists hours jsonb,
  add column if not exists hours_vary_seasonally boolean;

alter table benchmarking
  add column if not exists inventory_count_style text,
  add column if not exists inventory_count_style_other text,
  add column if not exists does_book_buyback boolean,
  add column if not exists service_status jsonb;

-- 44 of 50 active member stores have no horizontal logo on file.
alter table organizations
  add column if not exists logo_confirmed_at timestamptz,
  add column if not exists logo_confirmed_by uuid references profiles(id);
