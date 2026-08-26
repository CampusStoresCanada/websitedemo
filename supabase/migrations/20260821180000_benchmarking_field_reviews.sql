-- Field-level question review, for the content reviewers (store directors).
--
-- One row per (survey, field, reviewer). Reviewers walk the instrument and say
-- whether each question can be misread, then supply the worked example only a
-- practitioner can write. Steve resolves; contested items drive the agenda for
-- the live settle session.
--
-- Deliberately NOT visible reviewer-to-reviewer: seeing someone else's verdict
-- first anchors you to it, and the whole value of a panel is independent reads.
-- The facilitator view (admin) sees everything.

create table if not exists public.benchmarking_field_reviews (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.benchmarking_surveys(id) on delete cascade,
  field_name text not null,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,

  -- the reviewer's verdict on the question as written
  status text not null default 'pending'
    check (status in ('pending', 'ok', 'ambiguous', 'needs_example')),
  comment text,

  -- what only a practitioner can supply
  proposed_example text,
  proposed_example_credit text,
  proposed_help_text text,

  -- Steve's disposition
  resolution text not null default 'open'
    check (resolution in ('open', 'applied', 'declined', 'for_session')),
  resolution_note text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (survey_id, field_name, reviewer_id)
);

create index if not exists bfr_survey_field_idx
  on public.benchmarking_field_reviews (survey_id, field_name);
create index if not exists bfr_reviewer_idx
  on public.benchmarking_field_reviews (reviewer_id);
create index if not exists bfr_open_idx
  on public.benchmarking_field_reviews (survey_id)
  where resolution = 'open' and status <> 'ok';

drop trigger if exists set_bfr_updated_at on public.benchmarking_field_reviews;
create trigger set_bfr_updated_at
  before update on public.benchmarking_field_reviews
  for each row execute function public.update_updated_at_column();

alter table public.benchmarking_field_reviews enable row level security;

-- A content reviewer reads and writes only their own rows.
drop policy if exists bfr_own_select on public.benchmarking_field_reviews;
create policy bfr_own_select on public.benchmarking_field_reviews
  for select to authenticated
  using (reviewer_id = auth.uid());

-- Admins see every review — this is the facilitator view.
drop policy if exists bfr_admin_all on public.benchmarking_field_reviews;
create policy bfr_admin_all on public.benchmarking_field_reviews
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
  ));

-- Writes go through server actions on the admin client, so no INSERT/UPDATE
-- policy for the session client: a GRANT without a matching policy silently
-- writes zero rows and reports success.
grant select on public.benchmarking_field_reviews to authenticated;

comment on table public.benchmarking_field_reviews is
  'Content reviewers'' verdicts on survey question wording, plus the worked examples they author. One row per (survey, field, reviewer). Reviewers cannot see each other''s rows by design.';
