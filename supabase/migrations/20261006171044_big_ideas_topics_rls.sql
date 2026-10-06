-- RLS on, no policies. Every read and write goes through a server action on
-- createAdminClient(), which bypasses RLS; the session client has no business
-- touching these directly.
--
-- ⚠️ A GRANT without a policy is the silent-failure shape in this codebase:
-- the write returns 0 rows with error:null and reads as success. Enabling RLS
-- with no policy at all fails loudly instead.
alter table public.conference_topics enable row level security;
alter table public.conference_topic_ballots enable row level security;
alter table public.conference_topic_ballot_selections enable row level security;
