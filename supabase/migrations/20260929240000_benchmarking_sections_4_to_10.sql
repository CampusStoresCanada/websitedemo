create table if not exists benchmarking_other_income (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references benchmarking(id) on delete cascade,
  kind text not null default 'other',
  service_name text,
  label text not null,
  amount numeric,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists benchmarking_other_income_idx on benchmarking_other_income (benchmarking_id, position);

create table if not exists benchmarking_other_expenses (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references benchmarking(id) on delete cascade,
  label text not null,
  amount numeric,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists benchmarking_other_expenses_idx on benchmarking_other_expenses (benchmarking_id, position);

-- ICBA asks the manager's years in post. The bench matters more.
create table if not exists benchmarking_staff (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references benchmarking(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  name text not null,
  employment_type text,
  years_in_campus_retail integer,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists benchmarking_staff_idx on benchmarking_staff (benchmarking_id, position);

alter table benchmarking
  add column if not exists contrib_discounts numeric,
  add column if not exists contrib_rent_to_institution numeric,
  add column if not exists contrib_commissions numeric,
  add column if not exists contrib_donations numeric,
  add column if not exists contrib_scholarships numeric,
  add column if not exists contrib_bad_debt numeric,
  add column if not exists contrib_rebates numeric,
  add column if not exists contrib_other_agreements numeric,
  add column if not exists contrib_local_marketing numeric,
  add column if not exists contrib_student_wages numeric,
  add column if not exists wages_full_time numeric,
  add column if not exists wages_part_time numeric,
  add column if not exists wages_student numeric,
  add column if not exists wages_seasonal numeric,
  add column if not exists seasonal_employees numeric,
  add column if not exists expense_advertising numeric,
  add column if not exists expense_telephone numeric,
  add column if not exists expense_store_supplies numeric,
  add column if not exists expense_it numeric,
  add column if not exists expense_postage numeric,
  add column if not exists expense_depreciation numeric,
  add column if not exists expense_professional_services numeric,
  add column if not exists expense_education_travel numeric,
  add column if not exists expense_insurance numeric,
  add column if not exists expense_card_fees numeric,
  add column if not exists expense_university_admin numeric,
  add column if not exists expense_utilities numeric,
  add column if not exists shrink_at_cost numeric,
  add column if not exists shrink_at_retail numeric,
  add column if not exists ia_ea_operated_by text,
  add column if not exists ia_ea_operated_by_other text,
  add column if not exists ia_ea_software text,
  add column if not exists ia_ea_institution_amount numeric,
  add column if not exists ia_ea_count_as_revenue boolean,
  add column if not exists reviewed_at timestamptz;
