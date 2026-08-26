-- Who looked at whose figures, and when (launch plan §5A).
--
-- The canary marks tell you which copy leaked. This tells you that a copy was
-- made at all, and by whom — the two answer different questions, and a trace
-- without an access log leaves you knowing the report was forwarded but not
-- when it left the building.
--
-- Kept deliberately thin. It records that a member opened a report and what
-- was in scope, not what they read or how long for. A log that tracks reading
-- behaviour is surveillance of the membership, which is not what anyone agreed
-- to and would itself become a confidentiality problem.
create table if not exists public.benchmarking_report_access (
  id uuid primary key default gen_random_uuid(),
  survey_fiscal_year integer not null,
  -- The organisation the copy was prepared for. This is the value that matches
  -- a canary trace, so it is the column a leak investigation joins on.
  recipient_organization_id uuid not null references public.organizations(id),
  viewed_by uuid references public.profiles(id),
  -- How many named peer rows were visible in that copy. A copy that showed
  -- nothing cannot be the source of a leak of named figures.
  named_peer_count integer not null default 0,
  viewed_at timestamptz not null default now()
);

comment on table public.benchmarking_report_access is
  'One row per time a member opened their comparison report. Pairs with the canary marks: the marks identify which copy leaked, this identifies when copies were made. Deliberately records access, never reading behaviour.';

create index if not exists benchmarking_report_access_recipient_idx
  on public.benchmarking_report_access (recipient_organization_id, viewed_at desc);

alter table public.benchmarking_report_access enable row level security;

-- No session-role grant at all: written and read through createAdminClient()
-- behind a route guard, like everything else on this surface. A member has no
-- business reading who else opened a report.
revoke all on public.benchmarking_report_access from anon, authenticated;
