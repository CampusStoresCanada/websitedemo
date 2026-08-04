create table comms_conditions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  subject text not null,
  reference_id uuid,
  field text not null,
  operator text not null,
  value text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_comms_conditions_updated_at
  before update on comms_conditions
  for each row execute function set_updated_at();

alter table comms_conditions enable row level security;

create policy admin_read_comms_conditions on comms_conditions
  for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );

create policy admin_write_comms_conditions on comms_conditions
  for all
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );
