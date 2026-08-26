-- Explanations attached to a store's figure.
--
-- A reviewer looking at a flagged number decides it isn't wrong, it's
-- interesting, and writes down why. That explanation then has to survive two
-- checks before anyone else sees it: the Secretary, and the store whose number
-- it describes.
--
-- Default is private. A note only becomes visible to other members if the
-- respondent agrees, or if the Secretary explicitly overrides their silence —
-- and an override is recorded as one, so a note never looks store-approved
-- when it wasn't.

create table if not exists public.benchmarking_notes (
  id uuid primary key default gen_random_uuid(),
  delta_flag_id uuid references public.delta_flags(id) on delete set null,
  survey_id uuid not null references public.benchmarking_surveys(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  field_name text not null,
  note text not null,
  author_id uuid not null references public.profiles(id),
  status text not null default 'draft'
    check (status in ('draft','secretary_review','respondent_review','published','private')),
  secretary_decision text check (secretary_decision in ('approved','declined')),
  secretary_id uuid references public.profiles(id),
  secretary_at timestamptz,
  respondent_decision text check (respondent_decision in ('agreed','objected')),
  respondent_id uuid references public.profiles(id),
  respondent_at timestamptz,
  published_on_override boolean not null default false,
  override_by uuid references public.profiles(id),
  override_at timestamptz,
  override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bn_survey_org_idx on public.benchmarking_notes (survey_id, organization_id);
create index if not exists bn_field_idx on public.benchmarking_notes (survey_id, field_name);
create index if not exists bn_awaiting_secretary_idx on public.benchmarking_notes (survey_id) where status = 'secretary_review';
create index if not exists bn_awaiting_respondent_idx on public.benchmarking_notes (organization_id) where status = 'respondent_review';

drop trigger if exists set_benchmarking_notes_updated_at on public.benchmarking_notes;
create trigger set_benchmarking_notes_updated_at
  before update on public.benchmarking_notes
  for each row execute function public.update_updated_at_column();

alter table public.benchmarking_notes enable row level security;

drop policy if exists bn_author_select on public.benchmarking_notes;
create policy bn_author_select on public.benchmarking_notes
  for select to authenticated using (author_id = auth.uid());

drop policy if exists bn_respondent_select on public.benchmarking_notes;
create policy bn_respondent_select on public.benchmarking_notes
  for select to authenticated
  using (exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = benchmarking_notes.organization_id
      and uo.user_id = auth.uid() and uo.status = 'active'
  ));

-- Reciprocity: you see other stores' explanations because you filed your own.
drop policy if exists bn_participant_select on public.benchmarking_notes;
create policy bn_participant_select on public.benchmarking_notes
  for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.user_organizations uo
      join public.benchmarking b
        on b.organization_id = uo.organization_id
       and b.fiscal_year = (
         select s.fiscal_year from public.benchmarking_surveys s where s.id = benchmarking_notes.survey_id
       )
      where uo.user_id = auth.uid() and uo.status = 'active'
        and uo.role = 'org_admin' and b.status in ('submitted','verified')
    )
  );

drop policy if exists bn_admin_all on public.benchmarking_notes;
create policy bn_admin_all on public.benchmarking_notes
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.global_role in ('admin','super_admin')
  ));

grant select on public.benchmarking_notes to authenticated;

comment on table public.benchmarking_notes is
  'Explanations of why a figure is unusual but correct. Private by default; published only on the respondent''s agreement or a recorded Secretary override.';
