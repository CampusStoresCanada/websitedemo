create table comms_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  category text not null default 'all',
  reason text,
  created_at timestamptz not null default now(),
  unique (email, category)
);

create index comms_suppressions_email_idx on comms_suppressions (email);

alter table comms_suppressions enable row level security;

create policy admin_read_comms_suppressions on comms_suppressions
  for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );

create policy admin_write_comms_suppressions on comms_suppressions
  for all
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );
