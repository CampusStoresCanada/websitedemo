-- Who receives the survey at each member store, confirmed by a human.
--
-- This is also the respondent model. A confirmed row IS the designated
-- benchmarking respondent for that store in that cycle — per-survey rather
-- than a column on organizations, because the right person changes and last
-- year's answer should not silently become this year's.
--
-- Prioritisation is the point: the stores we hear least from are the ones we
-- know least about, so the queue surfaces non-participants and thin contact
-- records first rather than listing 52 stores alphabetically.

create or replace function public.csc_region(p_province text)
returns text
language sql
immutable
as $$
  select case
    when p_province in ('Newfoundland and Labrador','Nova Scotia','New Brunswick','Prince Edward Island') then 'Atlantic'
    when p_province = 'Quebec' then 'Quebec'
    when p_province = 'Ontario' then 'Ontario'
    when p_province in ('Manitoba','Saskatchewan','Alberta') then 'Prairies'
    when p_province in ('British Columbia','Yukon','Northwest Territories','Nunavut') then 'West'
    else 'Unknown'
  end;
$$;

comment on function public.csc_region is
  'Province to CSC benchmarking region. Matches the peer-group dimension used in the reports.';

create table if not exists public.benchmarking_recipients (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.benchmarking_surveys(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'unconfirmed'
    check (status in ('unconfirmed','confirmed','corrected','unknown','escalated')),
  assigned_to uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (survey_id, organization_id)
);

create index if not exists benchmarking_recipients_survey_idx
  on public.benchmarking_recipients (survey_id);
create index if not exists benchmarking_recipients_assigned_idx
  on public.benchmarking_recipients (assigned_to)
  where status = 'unconfirmed';

drop trigger if exists set_benchmarking_recipients_updated_at on public.benchmarking_recipients;
create trigger set_benchmarking_recipients_updated_at
  before update on public.benchmarking_recipients
  for each row execute function public.update_updated_at_column();

alter table public.benchmarking_recipients enable row level security;

drop policy if exists benchmarking_recipients_rep_select on public.benchmarking_recipients;
create policy benchmarking_recipients_rep_select on public.benchmarking_recipients
  for select to authenticated
  using (public.has_capability(auth.uid(), 'benchmarking.recipient_confirm'));

drop policy if exists benchmarking_recipients_admin_all on public.benchmarking_recipients;
create policy benchmarking_recipients_admin_all on public.benchmarking_recipients
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.global_role in ('admin','super_admin')
  ));

grant select on public.benchmarking_recipients to authenticated;

comment on table public.benchmarking_recipients is
  'Confirmed survey recipient per member store per cycle. A confirmed row is the designated benchmarking respondent for that organization.';
