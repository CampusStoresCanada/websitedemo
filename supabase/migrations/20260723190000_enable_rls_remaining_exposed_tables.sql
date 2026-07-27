-- Close a live data-exposure gap: these 15 tables had RLS disabled, making
-- them fully readable/writable by anyone with the public anon key via the
-- Supabase REST API, bypassing all app-level auth. Same class of issue as
-- 20260717000000_enable_rls_prospective_payment_tables.sql, found via a
-- routine advisory check while working on an unrelated conference task.
--
-- Two tables carry real stakes:
--   - app_settings: stores QuickBooks OAuth tokens (see
--     app/api/admin/qbo/oauth/callback/route.ts), otherwise readable/
--     writable by anyone with the anon key.
--   - people / users: live registrant PII feeding public conference
--     registration (app/conference/[year]/[edition]/register/page.tsx),
--     badge PDF generation, and lib/identity/lifecycle.ts.
-- The rest (tags, organization_tags, person_tags, posts, sync_log,
-- activities, notion_schema_cache, metadata_privacy_rules, sync_operations,
-- event_ticket_types, market_nudge_log, _prisma_migrations) are lower
-- stakes individually but share the same hole.
--
-- Safe to enable with zero policies: every real access path found for all
-- 15 tables goes through createAdminClient() — the service-role key,
-- server-only — which bypasses RLS unconditionally (confirmed for
-- app_settings, people, users, tags, event_ticket_types, market_nudge_log;
-- the remainder have zero rows and zero app-code references at all). No
-- anon/authenticated code path touches any of these tables, so a
-- default-deny (RLS enabled, no policies) has no functional effect on the
-- app.

ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notion_schema_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_privacy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_nudge_log ENABLE ROW LEVEL SECURITY;
