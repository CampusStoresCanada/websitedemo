-- Who to phone about these numbers (brief §1).
--
-- `respondent_user_id` records which login pressed submit, which is an audit
-- fact and not a contact. A reviewer holding a flagged figure in November needs
-- a name, a title, an address and a phone — and needs them as they were AT
-- SUBMISSION, because the person who compiled the figures is often not the
-- person on the org's contact record a year later, and staff move.
--
-- Snapshotted rather than joined for exactly that reason: joining to contacts
-- would silently re-point last year's submission at this year's staff, and the
-- reviewer would ring someone who never saw the numbers.
alter table public.benchmarking
  add column if not exists respondent_name text,
  add column if not exists respondent_title text,
  add column if not exists respondent_email text,
  add column if not exists respondent_phone text;

comment on column public.benchmarking.respondent_name is
  'The person who compiled these figures, as they were at submission. Snapshot, not a join — staff move, and a flag raised in November must reach whoever actually did the work.';
