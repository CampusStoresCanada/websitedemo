create table conference_entity_usage_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_id uuid not null references conference_entities(id) on delete cascade,
  conference_id uuid not null references conference_instances(id) on delete cascade,
  intended_quantity integer not null check (intended_quantity >= 0),
  declared_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_id, conference_id)
);

create index conference_entity_usage_intents_org_idx on conference_entity_usage_intents (organization_id);

alter table conference_entity_usage_intents enable row level security;

create policy admin_all_conference_entity_usage_intents on conference_entity_usage_intents
  for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.global_role = any (array['admin','super_admin'])));

create policy org_members_read_own_usage_intents on conference_entity_usage_intents
  for select
  using (exists (
    select 1 from user_organizations uo
    where uo.organization_id = conference_entity_usage_intents.organization_id
      and uo.user_id = auth.uid()
      and uo.status = 'active'
  ));
