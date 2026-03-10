-- Chunk 18: Operations observability foundations.
-- Adds audit log + ops alert lifecycle with strict admin-scoped RLS.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text null,
  entity_id uuid null,
  actor_id uuid null references public.profiles(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'webhook', 'cron')),
  details jsonb not null default '{}'::jsonb,
  ip_address text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_action
  on public.audit_log(action);

create index if not exists idx_audit_log_entity
  on public.audit_log(entity_type, entity_id);

create index if not exists idx_audit_log_actor
  on public.audit_log(actor_id);

create index if not exists idx_audit_log_created
  on public.audit_log(created_at desc);

create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  is_acknowledged boolean not null default false,
  acknowledged_by uuid null references public.profiles(id) on delete set null,
  acknowledged_at timestamptz null,
  owner_id uuid null references public.profiles(id) on delete set null,
  due_at timestamptz null,
  resolved_by uuid null references public.profiles(id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ops_alerts_status_severity_created
  on public.ops_alerts(status, severity, created_at desc);

create index if not exists idx_ops_alerts_rule_status
  on public.ops_alerts(rule_key, status);

create index if not exists idx_ops_alerts_owner
  on public.ops_alerts(owner_id);

create index if not exists idx_ops_alerts_due
  on public.ops_alerts(due_at);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ops_alerts_updated_at on public.ops_alerts;
create trigger trg_ops_alerts_updated_at
before update on public.ops_alerts
for each row
execute function public.set_updated_at_timestamp();

alter table public.audit_log enable row level security;
alter table public.ops_alerts enable row level security;

grant select, insert on public.audit_log to authenticated;
grant select, insert, update on public.ops_alerts to authenticated;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read
  on public.audit_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists audit_log_admin_insert on public.audit_log;
create policy audit_log_admin_insert
  on public.audit_log
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists ops_alerts_admin_read on public.ops_alerts;
create policy ops_alerts_admin_read
  on public.ops_alerts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists ops_alerts_admin_insert on public.ops_alerts;
create policy ops_alerts_admin_insert
  on public.ops_alerts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists ops_alerts_admin_update on public.ops_alerts;
create policy ops_alerts_admin_update
  on public.ops_alerts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );
