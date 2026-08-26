-- Split the single benchmarking reviewer capability into two.
--
-- Two different groups do two different jobs at two different times:
--   * content reviewers  — store directors, Sept, correcting question wording
--                          and authoring worked examples. Must NOT reach the
--                          QA dashboard or see other stores' submissions.
--   * QA verifiers       — board committee, Nov/Dec, resolving flagged data.
--
-- profiles.is_benchmarking_reviewer keeps its existing meaning (QA verifier),
-- so no existing code path changes behaviour. The content capability is new.

alter table public.profiles
  add column if not exists is_benchmarking_content_reviewer boolean not null default false;

comment on column public.profiles.is_benchmarking_content_reviewer is
  'Store directors reviewing survey question wording and authoring worked examples. Read/write on field config only - NOT submission data.';

comment on column public.profiles.is_benchmarking_reviewer is
  'Board QA committee: resolves delta flags and verifies submissions. Distinct from is_benchmarking_content_reviewer.';

create index if not exists profiles_benchmarking_content_reviewer_idx
  on public.profiles (is_benchmarking_content_reviewer)
  where is_benchmarking_content_reviewer;
