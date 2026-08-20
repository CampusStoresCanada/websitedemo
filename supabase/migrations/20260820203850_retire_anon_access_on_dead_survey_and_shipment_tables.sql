-- shipments, survey_invitations and survey_responses were built as anonymous
-- token-link flows: an emailed survey link (recipient not logged in) and a
-- public shipping-request form. The authorization was meant to be "you hold a
-- valid unexpired token" — that intent survives only in the POLICY NAMES.
-- Every expression is `using (true)`:
--
--   "Anyone can view invitations by token"  -> no token check; all 232 tokens listable
--   "Users can view their own responses"    -> no ownership check
--   "Users can update their own responses"  -> no ownership check (0 updates ever)
--   "Allow public read access on shipments" -> 42 names, emails, street addresses
--
-- The anon key ships in the browser bundle, so "public" here means the public
-- internet, and the read exposure was the larger half of the problem.
--
-- Both features are retired. No application code references any of the three
-- tables (only lib/database.types.ts, which is generated from the schema).
-- Last real writes: shipments 2026-01-29, surveys 2026-04-01. Table stats have
-- never been reset, so those cumulative counters cover all time — and the only
-- recent reads in pg_stat_user_tables were this investigation's own probes.
--
-- Revoking privileges AND dropping the policies, not just one:
-- dropping policies alone would leave the GRANTs in place, which is the silent
-- 0-rows-and-success trap that ate organizations.procurement_info for a month
-- (see 20260820194843_db_access_drift_audit.sql). Removing both leaves an
-- unambiguous "service_role only" — service_role holds BYPASSRLS and its own
-- grants, so admin tooling and any future export still work.
--
-- Data is untouched: 42 shipments, 232 invitations, 84 responses. Retiring the
-- tables themselves is a separate decision — the responses are real member
-- feedback. If the survey feature is ever revived, rebuild it server-side
-- behind a token check in app code, not with an open policy.
--
-- Verified after applying, with the real anon key: SELECT on all three and
-- INSERT on survey_responses all return 42501.

REVOKE ALL PRIVILEGES ON TABLE public.shipments FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.survey_invitations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.survey_responses FROM anon, authenticated;

DROP POLICY IF EXISTS "Allow public insert access on shipments" ON public.shipments;
DROP POLICY IF EXISTS "Allow public update access on shipments" ON public.shipments;
DROP POLICY IF EXISTS "Allow public read access on shipments" ON public.shipments;

DROP POLICY IF EXISTS "Anyone can view invitations by token" ON public.survey_invitations;
DROP POLICY IF EXISTS "Authenticated users can view all invitations" ON public.survey_invitations;
DROP POLICY IF EXISTS "Anyone can update invitation tracking" ON public.survey_invitations;

DROP POLICY IF EXISTS "Users can create survey responses" ON public.survey_responses;
DROP POLICY IF EXISTS "Users can view their own responses" ON public.survey_responses;
DROP POLICY IF EXISTS "Authenticated users can view all responses" ON public.survey_responses;
DROP POLICY IF EXISTS "Users can update their own responses" ON public.survey_responses;
