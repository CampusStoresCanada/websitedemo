-- A super_admin can schedule a future conference status transition in
-- advance; a cron (app/api/cron/conference-scheduled-transitions) executes
-- it later via the same performConferenceStatusTransition() core used for
-- immediate transitions, so legality/readiness are re-checked at run time
-- and a manual change made in the meantime always wins over a stale
-- schedule. See lib/actions/conference-schedule.ts.

create table if not exists public.conference_scheduled_transitions (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  target_status text not null,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'executed', 'canceled', 'failed')),
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  executed_at timestamptz null,
  canceled_by uuid null references public.profiles(id) on delete set null,
  canceled_at timestamptz null,
  error text null,
  updated_at timestamptz not null default now()
);

-- One pending schedule per (conference, target status) at a time — prevents
-- accidentally queuing two conflicting future transitions to the same target.
create unique index if not exists idx_conference_scheduled_transitions_pending_target
  on public.conference_scheduled_transitions(conference_id, target_status)
  where status = 'pending';

-- The cron's own lookup: due pending rows.
create index if not exists idx_conference_scheduled_transitions_due
  on public.conference_scheduled_transitions(status, run_at);

create index if not exists idx_conference_scheduled_transitions_conference
  on public.conference_scheduled_transitions(conference_id);

drop trigger if exists trg_conference_scheduled_transitions_updated_at
  on public.conference_scheduled_transitions;
create trigger trg_conference_scheduled_transitions_updated_at
before update on public.conference_scheduled_transitions
for each row
execute function public.set_updated_at_timestamp();

alter table public.conference_scheduled_transitions enable row level security;

grant select, insert, update on public.conference_scheduled_transitions to authenticated;

-- RLS is a defense-in-depth backstop here, not the primary gate — the real
-- actions (lib/actions/conference-schedule.ts) require requireSuperAdmin()
-- and use the service-role client. Mirrors the ops_alerts admin-role policy
-- shape (supabase/migrations/20260303101500_chunk18_ops_observability.sql).
drop policy if exists conference_scheduled_transitions_admin_read
  on public.conference_scheduled_transitions;
create policy conference_scheduled_transitions_admin_read
  on public.conference_scheduled_transitions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists conference_scheduled_transitions_admin_insert
  on public.conference_scheduled_transitions;
create policy conference_scheduled_transitions_admin_insert
  on public.conference_scheduled_transitions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role = 'super_admin'
    )
  );

drop policy if exists conference_scheduled_transitions_admin_update
  on public.conference_scheduled_transitions;
create policy conference_scheduled_transitions_admin_update
  on public.conference_scheduled_transitions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role = 'super_admin'
    )
  );
