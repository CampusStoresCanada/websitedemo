-- "This question is broken", said where the question is.
--
-- The beta invitation asks people to tell us afterwards which question made
-- them stop and what they had to guess at. Afterwards is the problem: by the
-- time somebody writes that email they are describing a question they met an
-- hour ago, in words that no longer point at it. Captured in place, a report
-- carries the section and the field with it and a reviewer can go and look.
--
-- ⛔ Open to every respondent, not only beta testers. A member hitting a broken
-- question during the real round is exactly who we want to hear from, and the
-- worst outcome is a guess nobody ever hears about.

create table if not exists public.benchmarking_issues (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references public.benchmarking(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fiscal_year integer not null,
  reported_by uuid,
  section_id text,
  field_name text,
  body text not null,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'fixed', 'not_a_problem')),
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists benchmarking_issues_open_idx
  on public.benchmarking_issues (fiscal_year, status, created_at desc);
create index if not exists benchmarking_issues_org_idx
  on public.benchmarking_issues (organization_id, fiscal_year);

alter table public.benchmarking_issues enable row level security;

comment on table public.benchmarking_issues is
  'Problems respondents reported while filling the survey, captured with the section and field they were on.';
