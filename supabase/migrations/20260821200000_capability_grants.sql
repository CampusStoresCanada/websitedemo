-- Time-boxed, narrow, attributed capability grants.
--
-- A grant is not a role. A role says "this person is an admin" and persists
-- until someone remembers to remove it. A grant says "Frederico may review
-- benchmarking questions, because he is on the 2026 panel, until 15 October"
-- — and then it stops being true on its own.
--
-- Three properties make this worth having over a boolean on profiles:
--   1. ends_at is NOT NULL. Everything dissolves. Indefinite access is a role.
--   2. reason is NOT NULL. A grant nobody can explain is a grant to revoke.
--   3. The table is the contribution record. At the AGM, "who outside the
--      board did work for us this year" is a query, not a memory exercise.

create table if not exists public.capability_grants (
  id uuid primary key default gen_random_uuid(),

  subject_id uuid not null references public.profiles(id) on delete cascade,

  -- Narrow and dotted: 'benchmarking.content_review', not 'admin'.
  capability text not null,

  -- Optional narrowing. scope_id null = the capability everywhere it applies.
  scope_type text,
  scope_id uuid,

  -- Why this person has this. Shown in the AGM report, so write it for a human.
  reason text not null,

  granted_by uuid references public.profiles(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,

  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoked_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint capability_grants_window_valid check (ends_at > starts_at)
);

create index if not exists capability_grants_active_idx
  on public.capability_grants (subject_id, capability)
  where revoked_at is null;
create index if not exists capability_grants_capability_idx
  on public.capability_grants (capability);
create index if not exists capability_grants_window_idx
  on public.capability_grants (starts_at, ends_at);

drop trigger if exists set_capability_grants_updated_at on public.capability_grants;
create trigger set_capability_grants_updated_at
  before update on public.capability_grants
  for each row execute function public.update_updated_at_column();

-- The check. STABLE + SECURITY DEFINER so RLS policies can call it.
create or replace function public.has_capability(
  p_subject uuid,
  p_capability text,
  p_scope_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.capability_grants g
    where g.subject_id = p_subject
      and g.capability = p_capability
      and g.revoked_at is null
      and now() >= g.starts_at
      and now() < g.ends_at
      and (g.scope_id is null or p_scope_id is null or g.scope_id = p_scope_id)
  );
$$;

comment on function public.has_capability is
  'True when the subject holds an unexpired, unrevoked grant for this capability. Use in RLS and server guards instead of a role boolean.';

-- The AGM report. Includes expired and revoked grants: the work still happened.
create or replace view public.capability_contributions as
  select
    g.subject_id,
    p.display_name,
    g.capability,
    g.reason,
    g.scope_type,
    g.scope_id,
    g.starts_at,
    g.ends_at,
    g.revoked_at,
    granter.display_name as granted_by_name,
    (g.revoked_at is null and now() >= g.starts_at and now() < g.ends_at) as is_active
  from public.capability_grants g
  join public.profiles p on p.id = g.subject_id
  left join public.profiles granter on granter.id = g.granted_by;

alter table public.capability_grants enable row level security;

drop policy if exists capability_grants_own_select on public.capability_grants;
create policy capability_grants_own_select on public.capability_grants
  for select to authenticated
  using (subject_id = auth.uid());

drop policy if exists capability_grants_admin_all on public.capability_grants;
create policy capability_grants_admin_all on public.capability_grants
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
  ));

grant select on public.capability_grants to authenticated;
grant select on public.capability_contributions to authenticated;
grant execute on function public.has_capability(uuid, text, uuid) to authenticated;

comment on table public.capability_grants is
  'Time-boxed, attributed capability grants. Every grant expires (ends_at NOT NULL) and carries a human-readable reason. Supersedes profiles.is_benchmarking_reviewer and profiles.is_benchmarking_content_reviewer.';
