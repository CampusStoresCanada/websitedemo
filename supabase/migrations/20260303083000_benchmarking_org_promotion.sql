-- Promote verified benchmarking current-state fields into organizations with audit log.

create table if not exists public.benchmarking_promotions (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references public.benchmarking(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  promoted_fields text[] not null default '{}',
  source_snapshot jsonb not null default '{}'::jsonb,
  target_before_snapshot jsonb,
  target_after_snapshot jsonb,
  promoted_by uuid references public.profiles(id),
  promoted_at timestamptz not null default now(),
  note text,
  unique (benchmarking_id, organization_id)
);

create index if not exists idx_benchmarking_promotions_org
  on public.benchmarking_promotions(organization_id, promoted_at desc);

create index if not exists idx_benchmarking_promotions_benchmarking
  on public.benchmarking_promotions(benchmarking_id, promoted_at desc);

alter table public.benchmarking_promotions enable row level security;

drop policy if exists benchmarking_promotions_select_admin on public.benchmarking_promotions;
create policy benchmarking_promotions_select_admin
  on public.benchmarking_promotions
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

-- Writes are service-role only from server actions.
drop policy if exists benchmarking_promotions_no_direct_write on public.benchmarking_promotions;
create policy benchmarking_promotions_no_direct_write
  on public.benchmarking_promotions
  for all
  to authenticated
  using (false)
  with check (false);
