-- Possible-duplicate hold on signup applications.
--
-- An application that looks like an organization we already have must not move
-- on its own. Before this, a duplicate partner submission landed in
-- pending_review like any other, and the hourly board-vote cron picked it up
-- and opened a board vote — asking nine directors to approve an organization
-- the board had already approved years earlier.
--
-- The hold is deliberately separate from `status`: the application really is
-- pending_review, and every other admin surface should keep treating it that
-- way. What's blocked is the *automation* (see findApplicationsNeedingVote),
-- until a human looks at the matches and clears it.
--
-- Held while duplicate_hold_at is not null and duplicate_cleared_at is null.

alter table public.signup_applications
  add column if not exists duplicate_hold_at     timestamptz,
  add column if not exists duplicate_matches     jsonb,
  add column if not exists duplicate_cleared_at  timestamptz,
  add column if not exists duplicate_cleared_by  uuid;

comment on column public.signup_applications.duplicate_hold_at is
  'Set when duplicate screening found possible matches. Non-null + duplicate_cleared_at null = held; automation must skip this application.';
comment on column public.signup_applications.duplicate_matches is
  'Snapshot of the DuplicateOrgMatch[] that triggered the hold, as seen at screening time.';
comment on column public.signup_applications.duplicate_cleared_at is
  'Set when an admin resolved the hold, whether by merging, rejecting, or judging the matches to be false positives.';
comment on column public.signup_applications.duplicate_cleared_by is
  'Admin who cleared the hold.';

-- Partial index: the automation asks "which pending_review applications are NOT
-- held", so the held set is the one worth indexing and it stays small.
create index if not exists signup_applications_duplicate_hold_idx
  on public.signup_applications (duplicate_hold_at)
  where duplicate_hold_at is not null and duplicate_cleared_at is null;
