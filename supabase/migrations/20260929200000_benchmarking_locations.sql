-- Square footage is asked per LOCATION, and a store can have several.
-- benchmarking is one column per question, which cannot express "N locations,
-- each with M other-spaces". So locations are rows, and the sqft_* columns on
-- benchmarking become the roll-up rather than the question — every existing
-- reader (sales per square foot, the cuts, the exports) keeps working.
--
-- The name is internal: it appears in the store's own results and nowhere public.
create table if not exists benchmarking_locations (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references benchmarking(id) on delete cascade,
  name text not null,
  sqft_salesfloor integer,
  sqft_storage integer,
  sqft_office integer,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "Other" is a list, not a field: a loading bay AND a classroom AND a photo
-- studio are different spaces, and one number loses why each exists.
create table if not exists benchmarking_location_other_spaces (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references benchmarking_locations(id) on delete cascade,
  description text not null,
  sqft integer,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists benchmarking_locations_submission_idx
  on benchmarking_locations (benchmarking_id, position);
create index if not exists benchmarking_location_other_idx
  on benchmarking_location_other_spaces (location_id, position);
