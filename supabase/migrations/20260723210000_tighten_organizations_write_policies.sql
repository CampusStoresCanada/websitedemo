-- Close the last open finding from the RLS advisory sweep (rls_policy_always_true):
-- "organizations" had public INSERT and public UPDATE policies with no
-- restriction at all (USING/WITH CHECK true for the `public` pseudo-role,
-- i.e. anon + authenticated) — anyone could create or rewrite any of the
-- 213 real organization records via the anon key.
--
-- Verified every real write path before touching this:
--   - Org creation happens only in approveApplication() (lib/actions/
--     applications.ts), requireAdmin()-gated, via createAdminClient().
--   - Every legitimate UPDATE path (quickbooks/export.ts, sponsorship.ts,
--     procurement.ts, manage-partner-links.ts, user-management.ts, the
--     onboarding-wizard steps in applications.ts, the Circle backfill
--     route) already used createAdminClient().
--   - Two paths had correct app-layer auth checks but wrote via the
--     session client, relying on this exact open policy — fixed in code
--     (not here) to use createAdminClient(): lib/actions/
--     update-certifications.ts (updateCertifications/updateCancollStatus)
--     and lib/actions/upload-organization-image.ts.
--   - app/api/geocode/route.ts had NO auth check at all and used the raw
--     anon client — fixed in code to require admin auth + service role.
--   - The only client-side (browser, anon-key) code touching
--     `organizations` at all is components/auth/SignupForm.tsx, and it
--     only ever SELECTs (email-domain lookup, org picker) — never inserts
--     or updates.
--
-- The public SELECT policy is untouched — a public member directory is a
-- real, intentional feature of this site.

DROP POLICY IF EXISTS "Allow public insert access on organizations" ON public.organizations;
DROP POLICY IF EXISTS "Allow public update access on organizations" ON public.organizations;
