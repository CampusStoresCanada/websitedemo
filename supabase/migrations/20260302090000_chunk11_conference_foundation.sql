-- Chunk 11: Conference Data Model + Registration Foundation
-- Idempotent bootstrap migration so schema changes are tracked in-repo.

create extension if not exists pgcrypto;

create table if not exists public.conference_instances (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year integer not null,
  edition_code text not null default '00',
  status text not null default 'draft'
    check (status in ('draft','registration_open','registration_closed','scheduling','active','completed','archived')),
  location_city text,
  location_province text,
  location_venue text,
  timezone text not null default 'America/Toronto',
  tax_jurisdiction text,
  tax_rate_pct numeric,
  stripe_tax_rate_id text,
  start_date date,
  end_date date,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  on_sale_at timestamptz,
  board_decision_at timestamptz,
  duplicated_from_id uuid references public.conference_instances(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_conference_year_edition
  on public.conference_instances(year, edition_code);

create table if not exists public.conference_parameters (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  conference_days integer not null,
  meeting_slots_per_day integer not null,
  slot_duration_minutes integer not null,
  slot_buffer_minutes integer not null default 0,
  meeting_start_time time not null,
  meeting_end_time time not null,
  flex_time_start time,
  flex_time_end time,
  total_meeting_suites integer not null,
  delegate_target_meetings integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(conference_id)
);

create table if not exists public.conference_products (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  price_cents integer not null,
  currency text not null default 'CAD',
  is_taxable boolean not null default true,
  is_tax_exempt boolean not null default false,
  capacity integer,
  current_sold integer not null default 0,
  max_per_account integer,
  display_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_conference_products_conf
  on public.conference_products(conference_id);

create table if not exists public.conference_product_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.conference_products(id) on delete cascade,
  rule_type text not null check (rule_type in ('requires_product','requires_org_type','requires_registration','max_quantity','custom')),
  rule_config jsonb not null,
  error_message text not null,
  display_order integer not null default 0
);

create table if not exists public.conference_registrations (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  registration_type text not null check (registration_type in ('delegate','exhibitor','staff','observer')),
  linked_registration_id uuid references public.conference_registrations(id),
  status text not null default 'draft' check (status in ('draft','submitted','confirmed','canceled')),
  meeting_outcome_intent text[],
  meeting_structure text,
  advance_needs text,
  differentiator text,
  sales_readiness jsonb,
  buying_cycles_targeted text[],
  one_thing_to_remember text,
  badge_organization_id uuid references public.organizations(id),
  delegate_name text,
  delegate_title text,
  delegate_email text,
  delegate_work_phone text,
  functional_roles text[],
  purchasing_authority text,
  category_responsibilities text[],
  buying_timeline text[],
  top_priorities text[],
  meeting_intent text[],
  success_definition text,
  travel_consent_given boolean default false,
  legal_name text,
  date_of_birth date,
  preferred_departure_airport text,
  nexus_trusted_traveler boolean,
  seat_preference text,
  dietary_restrictions text,
  accessibility_needs text,
  emergency_contact_name text,
  emergency_contact_phone text,
  gender text,
  mobile_phone text,
  top_5_preferences uuid[],
  blackout_list uuid[],
  primary_category text,
  secondary_categories text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(conference_id, user_id, registration_type)
);

create index if not exists idx_conf_reg_conference
  on public.conference_registrations(conference_id);
create index if not exists idx_conf_reg_org
  on public.conference_registrations(organization_id);

create table if not exists public.conference_staff (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id),
  organization_id uuid not null references public.organizations(id),
  registration_id uuid not null references public.conference_registrations(id),
  user_id uuid references public.profiles(id),
  name text not null,
  email text not null,
  phone text,
  accommodation_type text check (accommodation_type in ('full','meals_only','none')),
  extracurricular_registered boolean default false,
  badge_organization_id uuid references public.organizations(id),
  created_at timestamptz not null default now()
);

create table if not exists public.conference_legal_versions (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id),
  document_type text not null check (document_type in ('code_of_conduct','terms_and_conditions','refund_policy','privacy_notice')),
  version integer not null,
  content text not null,
  effective_at timestamptz not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(conference_id, document_type, version)
);

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  legal_version_id uuid not null references public.conference_legal_versions(id),
  accepted_at timestamptz not null default now(),
  ip_address text,
  unique(user_id, legal_version_id)
);

-- ─────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────

alter table public.conference_instances enable row level security;
alter table public.conference_parameters enable row level security;
alter table public.conference_products enable row level security;
alter table public.conference_product_rules enable row level security;
alter table public.conference_registrations enable row level security;
alter table public.conference_staff enable row level security;
alter table public.conference_legal_versions enable row level security;
alter table public.legal_acceptances enable row level security;

-- Conference instances: any authenticated user can read
create policy "Authenticated users can read conferences"
  on public.conference_instances for select
  to authenticated
  using (true);

-- Conference parameters: authenticated can read
create policy "Authenticated users can read conference parameters"
  on public.conference_parameters for select
  to authenticated
  using (true);

-- Conference products: authenticated can read
create policy "Authenticated users can read conference products"
  on public.conference_products for select
  to authenticated
  using (true);

-- Conference product rules: authenticated can read
create policy "Authenticated users can read product rules"
  on public.conference_product_rules for select
  to authenticated
  using (true);

-- Conference registrations: users can read their own
create policy "Users can read own registrations"
  on public.conference_registrations for select
  to authenticated
  using (user_id = auth.uid());

-- Conference staff: users can read staff for their own registrations
create policy "Users can read staff for own registrations"
  on public.conference_staff for select
  to authenticated
  using (
    registration_id in (
      select id from public.conference_registrations where user_id = auth.uid()
    )
  );

-- Conference legal versions: authenticated can read
create policy "Authenticated users can read legal versions"
  on public.conference_legal_versions for select
  to authenticated
  using (true);

-- Legal acceptances: users can read their own
create policy "Users can read own legal acceptances"
  on public.legal_acceptances for select
  to authenticated
  using (user_id = auth.uid());

-- Legal acceptances: users can insert their own
create policy "Users can insert own legal acceptances"
  on public.legal_acceptances for insert
  to authenticated
  with check (user_id = auth.uid());
