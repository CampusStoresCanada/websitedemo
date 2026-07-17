-- Close a live data-exposure gap: these 3 tables had RLS disabled, making
-- them fully readable/writable by anyone with the public anon key via the
-- Supabase REST API, bypassing all app-level auth.
--
-- Safe to enable with zero policies: every real access path in the codebase
-- (lib/actions/prospective-booth-checkout.ts, prospective-registration-checkout.ts,
-- lib/actions/applications.ts, lib/actions/conference-bursary.ts,
-- lib/stripe/webhook-processing.ts, app/conference/.../exhibit/success,
-- app/conference/.../attend/success) uses createAdminClient() — the
-- service-role key, server-only — which bypasses RLS unconditionally.
-- No anon/authenticated code path touches these tables, so a default-deny
-- (RLS enabled, no policies) has no functional effect on the app.

ALTER TABLE prospective_booth_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospective_registration_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE conference_bursary_applications ENABLE ROW LEVEL SECURITY;
