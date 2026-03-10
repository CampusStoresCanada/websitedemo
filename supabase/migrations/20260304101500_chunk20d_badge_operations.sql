-- Chunk 20D: Badge operations foundation (backend-first).
-- Adds badge template config, print job/event history, and immutable person badge token helpers.

create extension if not exists pgcrypto;

create table if not exists public.badge_template_configs (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  config_version integer not null check (config_version > 0),
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  field_mapping jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conference_id, config_version)
);

create unique index if not exists idx_badge_template_active_per_conf
  on public.badge_template_configs(conference_id)
  where status = 'active';

create table if not exists public.badge_print_jobs (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  person_id uuid references public.conference_people(id) on delete set null,
  pipeline_type text not null
    check (pipeline_type in ('preprinted', 'onsite_reprint')),
  status text not null
    check (status in ('queued', 'rendering', 'rendered', 'pdf_generated', 'sent_to_printer', 'printed', 'failed', 'canceled', 'delivered')),
  transport_method text not null default 'pdf'
    check (transport_method in ('pdf', 'printer_bridge')),
  printer_bridge_state text not null default 'unknown'
    check (printer_bridge_state in ('unknown', 'healthy', 'degraded', 'offline')),
  batch_order_mode text,
  batch_order_direction text
    check (batch_order_direction in ('asc', 'desc')),
  template_version integer,
  reprint_reason text
    check (reprint_reason in ('damaged', 'lost', 'name_change', 'ops_override')),
  reprint_note text,
  output_artifact_url text,
  metadata jsonb not null default '{}'::jsonb,
  initiated_by uuid references public.profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_badge_print_jobs_conf_created
  on public.badge_print_jobs(conference_id, created_at desc);

create index if not exists idx_badge_print_jobs_conf_status
  on public.badge_print_jobs(conference_id, status);

create table if not exists public.badge_print_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.badge_print_jobs(id) on delete cascade,
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  person_id uuid references public.conference_people(id) on delete set null,
  event_type text not null
    check (event_type in ('queued', 'rendering', 'rendered', 'pdf_generated', 'sent_to_printer', 'printed', 'failed', 'canceled', 'delivered', 'reprint_requested')),
  event_status text not null default 'info'
    check (event_status in ('info', 'success', 'error')),
  message text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_badge_print_events_job_time
  on public.badge_print_events(job_id, created_at desc);

create index if not exists idx_badge_print_events_conf_time
  on public.badge_print_events(conference_id, created_at desc);

-- Ensure immutable one-token-per-person-per-conference model.
delete from public.conference_badge_tokens t
using public.conference_badge_tokens newer
where t.conference_id = newer.conference_id
  and t.person_id = newer.person_id
  and t.created_at < newer.created_at;

drop index if exists idx_conference_badge_tokens_one_active_per_person;
create unique index if not exists idx_conference_badge_tokens_one_per_person
  on public.conference_badge_tokens(conference_id, person_id);

alter table public.conference_badge_tokens
  add column if not exists token_format text not null default 'person_uuid'
    check (token_format in ('person_uuid'));

create or replace function public.ensure_conference_badge_token_for_person(
  p_conference_id uuid,
  p_person_id uuid,
  p_actor_id uuid default null
)
returns table(token_id uuid, qr_payload text)
language plpgsql
as $$
declare
  v_token_hash text;
  v_token_id uuid;
begin
  v_token_hash := encode(digest(p_person_id::text, 'sha256'), 'hex');

  insert into public.conference_badge_tokens (
    conference_id,
    person_id,
    token_hash,
    created_by,
    token_format,
    revoked_at,
    revoked_by
  )
  values (
    p_conference_id,
    p_person_id,
    v_token_hash,
    p_actor_id,
    'person_uuid',
    null,
    null
  )
  on conflict (conference_id, person_id)
  do update set
    token_hash = excluded.token_hash,
    token_format = 'person_uuid',
    revoked_at = null,
    revoked_by = null
  returning id into v_token_id;

  return query
  select v_token_id, p_person_id::text;
end;
$$;

alter table public.badge_template_configs enable row level security;
alter table public.badge_print_jobs enable row level security;
alter table public.badge_print_events enable row level security;

grant select, insert, update on public.badge_template_configs to authenticated;
grant select, insert, update on public.badge_print_jobs to authenticated;
grant select, insert on public.badge_print_events to authenticated;

drop policy if exists badge_template_configs_admin_rw on public.badge_template_configs;
create policy badge_template_configs_admin_rw
  on public.badge_template_configs
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists badge_print_jobs_admin_rw on public.badge_print_jobs;
create policy badge_print_jobs_admin_rw
  on public.badge_print_jobs
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists badge_print_events_admin_rw on public.badge_print_events;
create policy badge_print_events_admin_rw
  on public.badge_print_events
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );
