-- Chunk 20A: durable conference entitlement assignment lifecycle history.

create table if not exists public.conference_entitlement_assignment_events (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid references public.conference_people(id) on delete set null,
  conference_entitlement_id uuid not null references public.conference_order_items(id) on delete cascade,
  previous_user_id uuid references public.profiles(id) on delete set null,
  next_user_id uuid references public.profiles(id) on delete set null,
  previous_status text,
  next_status text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system')),
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_conf_entitlement_assignment_events_conf
  on public.conference_entitlement_assignment_events(conference_id, created_at desc);
create index if not exists idx_conf_entitlement_assignment_events_entitlement
  on public.conference_entitlement_assignment_events(conference_entitlement_id, created_at desc);
create index if not exists idx_conf_entitlement_assignment_events_person
  on public.conference_entitlement_assignment_events(person_id, created_at desc);

alter table public.conference_entitlement_assignment_events enable row level security;

grant select, insert on public.conference_entitlement_assignment_events to authenticated;

drop policy if exists conference_entitlement_assignment_events_select_scoped
  on public.conference_entitlement_assignment_events;
create policy conference_entitlement_assignment_events_select_scoped
  on public.conference_entitlement_assignment_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
    or exists (
      select 1
      from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = conference_entitlement_assignment_events.organization_id
        and uo.status = 'active'
    )
  );

drop policy if exists conference_entitlement_assignment_events_insert_admin
  on public.conference_entitlement_assignment_events;
create policy conference_entitlement_assignment_events_insert_admin
  on public.conference_entitlement_assignment_events
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

