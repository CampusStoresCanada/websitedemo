-- Let a survey be open to a named few before it is open to everyone.
--
-- Beta stores fill the real survey a week early so anything awkward surfaces
-- while it can still be fixed. Until now the only states were closed (nobody)
-- and open (all 52), so the only way to test with real people was to open the
-- doors — which cannot be undone once someone starts filing.
--
-- 'beta' sits between them: the survey is live, but only for stores flagged on
-- their recipient row. Everyone else sees the same "not open yet" page they
-- saw the day before.

alter table public.benchmarking_surveys
  drop constraint if exists benchmarking_surveys_status_check;

alter table public.benchmarking_surveys
  add constraint benchmarking_surveys_status_check
  check (status in ('draft', 'beta', 'open', 'closed', 'processing', 'complete'));

-- The recipient row already exists for every store in the cycle, so the beta
-- list lives there rather than in a second table that could disagree with it.
alter table public.benchmarking_recipients
  add column if not exists is_beta boolean not null default false;

create index if not exists benchmarking_recipients_beta_idx
  on public.benchmarking_recipients (survey_id)
  where is_beta;

comment on column public.benchmarking_recipients.is_beta is
  'This store may file while the survey is in beta, before it opens to everyone.';
