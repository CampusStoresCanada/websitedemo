-- Sales asked by CATEGORY, not by a fixed set of columns. §2 and §3 share this
-- shape; course materials adds units. Vocabulary is the NACS taxonomy, the same
-- list partners choose from and the publication indexes.
create table if not exists benchmarking_categories (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references benchmarking(id) on delete cascade,
  scope text not null,
  department text not null,
  split_by_subcategory boolean not null default false,
  buyer_contact_ids uuid[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (benchmarking_id, scope, department)
);

create table if not exists benchmarking_category_lines (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references benchmarking_categories(id) on delete cascade,
  subcategory text,
  retail_sales numeric,
  online_sales numeric,
  gross_margin_pct numeric,
  inventory_open numeric,
  inventory_close numeric,
  units_sold integer,
  units_available integer,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists benchmarking_category_locations (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references benchmarking_categories(id) on delete cascade,
  location_id uuid not null references benchmarking_locations(id) on delete cascade,
  sqft integer,
  created_at timestamptz not null default now(),
  unique (category_id, location_id)
);

create index if not exists benchmarking_categories_submission_idx
  on benchmarking_categories (benchmarking_id, scope, position);
create index if not exists benchmarking_category_lines_idx
  on benchmarking_category_lines (category_id, position);
