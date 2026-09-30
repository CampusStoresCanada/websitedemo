-- Beta testers, appointed the same way as reviewers.
--
-- A beta tester is a person the office asks to fill the survey early and try to
-- break it. Appointing them through capability_contributions rather than a flag
-- means they arrive with a TERM and an audit trail, exactly like question
-- review and QA verification, and they fall out of the cohort on their own when
-- the term ends rather than sitting there until somebody remembers.
--
-- ⛔ Not the same question as benchmarking_recipients.is_beta. That decides
-- which cohort an INVITATION EMAIL counts a store in. This decides whether a
-- person may file before the doors open. Related, genuinely different, and
-- conflating them would mean you could not invite a store early without also
-- granting it access, or grant access without mailing it.

insert into public.governance_role_capabilities (role_key, capability, appointable)
values
  ('benchmarking_beta_tester', 'benchmarking.beta_tester', true),
  -- Carried by office, like every other benchmarking capability.
  ('benchmarking_committee_lead', 'benchmarking.beta_tester', false),
  ('secretary', 'benchmarking.beta_tester', false)
on conflict do nothing;
