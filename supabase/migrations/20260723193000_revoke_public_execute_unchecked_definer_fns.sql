-- Close a privilege-escalation gap: these SECURITY DEFINER functions perform
-- privileged writes with NO internal check of who's calling them, and had
-- EXECUTE available to anon/authenticated (via a PUBLIC grant, or in
-- exec_sql's case an explicit grant to both roles). Found via a routine
-- Supabase advisor check (anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable).
--
-- publish_policy_draft / rollback_policy_to_version: the app's own
-- safeguards (requireSuperAdmin() + typed "CONFIRM" on high-risk keys, in
-- lib/actions/policy.ts) only protect the path through the Next.js app.
-- Called directly via PostgREST with just the anon key, either RPC would
-- publish or roll back live policy (e.g. billing rates) with zero checks.
--
-- execute_admin_transfer: trusts p_request_id alone — no check that the
-- caller is the nominated successor or a global admin (that check lives in
-- lib/actions/admin-transfer.ts, again app-layer only). Anyone who obtains
-- a pending admin_transfer_requests id could force-complete an org-admin
-- handoff.
--
-- exec_sql: regex-limited to ALTER TABLE ... ADD COLUMN (not arbitrary
-- SQL), but still let any anon caller mutate the schema of any table.
-- Zero call sites anywhere in the app — entirely unused dead surface.
--
-- Safe to revoke: all three legitimate app call sites (lib/actions/policy.ts,
-- lib/actions/admin-transfer.ts) go through createAdminClient() — the
-- service-role key, which has its own separate explicit grant on each
-- function and is untouched by revoking PUBLIC/anon/authenticated.

REVOKE EXECUTE ON FUNCTION public.publish_policy_draft(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rollback_policy_to_version(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_admin_transfer(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
