-- A second reporting system, removed before anybody filed into it.
--
-- benchmarking_issues duplicated `flags`, which the site-wide toolkit already
-- writes and which already carries a status, a resolver and resolution notes.
-- Two tables would have meant a member who flagged something got an answer from
-- one queue or the other depending on which page they happened to be standing
-- on, and two places to look when nobody answered.
--
-- The survey now uses the same + -> Flag -> Describe as every other page. What
-- is survey-specific is the ROUTING: a flag raised inside the survey goes to
-- the committee rather than to the store's own admins, because in the survey
-- the store is the one reporting.

drop table if exists public.benchmarking_issues;
