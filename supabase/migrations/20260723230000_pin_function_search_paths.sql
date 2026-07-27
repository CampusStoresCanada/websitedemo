-- Closes function_search_path_mutable (16 functions) from the advisor
-- sweep. An unset search_path lets a caller who can create objects
-- (schemas/tables/functions) shadow what an unqualified reference inside
-- the function resolves to — most dangerous for SECURITY DEFINER
-- functions (find_organizations_by_email_domain, find_rfp_notification_
-- recipients, get_user_permission_state, handle_new_user,
-- increment_share_link_use, trigger_notion_sync), but pinned for all 16
-- as standard hardening, matching the pattern already used by every
-- SECURITY DEFINER function fixed earlier this session (execute_admin_
-- transfer, publish_policy_draft, etc. — all already had
-- `SET search_path TO 'public'`).
--
-- Verified every definition first, since this can silently break a
-- function if it relies on an extension living outside `public`:
--   - 14 of 16 reference only public-schema tables (some already
--     schema-qualified, some bare — both resolve correctly once `public`
--     is pinned) or nothing at all (the four trivial updated_at triggers).
--     trigger_notion_sync's vault.* and net.* calls are already fully
--     schema-qualified, so pinning to `public` doesn't affect them.
--   - search_partner_embeddings uses the pgvector `<=>` operator
--     unqualified, and the `vector` extension lives in `extensions`, not
--     `public` — needs `extensions` in the path too.
--   - ensure_conference_badge_token_for_person calls digest() (pgcrypto)
--     unqualified, and pgcrypto also lives in `extensions` — same fix.

ALTER FUNCTION public.handle_new_user() SET search_path TO 'public';
ALTER FUNCTION public.pcc_set_updated_at() SET search_path TO 'public';
ALTER FUNCTION public.get_user_permission_state(uuid) SET search_path TO 'public';
ALTER FUNCTION public.find_organizations_by_email_domain(text) SET search_path TO 'public';
ALTER FUNCTION public.run_travel_retention_purge(uuid, uuid, timestamptz, text[]) SET search_path TO 'public';
ALTER FUNCTION public.update_updated_at_column() SET search_path TO 'public';
ALTER FUNCTION public.set_updated_at_timestamp() SET search_path TO 'public';
ALTER FUNCTION public.set_updated_at() SET search_path TO 'public';
ALTER FUNCTION public.mark_embedding_stale() SET search_path TO 'public';
ALTER FUNCTION public.increment_share_link_use(uuid) SET search_path TO 'public';
ALTER FUNCTION public.trigger_notion_sync() SET search_path TO 'public';
ALTER FUNCTION public.find_rfp_notification_recipients(text[], text) SET search_path TO 'public';
ALTER FUNCTION public.resolve_person_access(uuid, uuid) SET search_path TO 'public';
ALTER FUNCTION public.mint_entity_offer_purchase(uuid, uuid, integer, text, integer, text) SET search_path TO 'public';

ALTER FUNCTION public.search_partner_embeddings(vector, text, integer) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.ensure_conference_badge_token_for_person(uuid, uuid, uuid) SET search_path TO 'public', 'extensions';
