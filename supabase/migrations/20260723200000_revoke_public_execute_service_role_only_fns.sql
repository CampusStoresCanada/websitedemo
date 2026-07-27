-- Continuation of 20260723193000: close the same anon/authenticated
-- EXECUTE-via-PUBLIC gap on the rest of the SECURITY DEFINER functions
-- flagged by the Supabase advisor, verified one by one against actual app
-- call sites before including here.
--
-- assign_grant_seat, confirm_booth_sale, create_conference_order_from_cart,
-- find_rfp_notification_recipients, mint_prospective_booth_purchase,
-- mint_prospective_registration_purchase: every real call site uses
-- createAdminClient() (service role), which has its own separate grant and
-- is untouched by this revoke.
--
-- find_organizations_by_email_domain, get_user_permission_state,
-- handle_new_user, mint_v3_for_order, release_expired_booth_holds,
-- trigger_notion_sync, unassign_grant_seat: zero call sites anywhere in the
-- app's TypeScript. Either invoked internally from other SECURITY DEFINER
-- functions/triggers (unaffected by this revoke — nested calls run as the
-- definer, not the original external caller) or fully dead.
--
-- reserve_booth, submit_booth_approval_request: zero call sites in the app
-- (superseded by the v3 entity/offer commerce model) AND had a real bug —
-- neither verified the caller actually belongs to the org_id passed in, so
-- any authenticated user could reserve a booth or submit a paid approval
-- request on behalf of an org they have no relationship to. Dead + broken:
-- revoke rather than fix, since nothing should be calling these at all.
--
-- NOT included here: transition_membership_state. It's called via the
-- session-scoped client (not service role) from both real user actions and
-- system triggers (Stripe webhooks, renewal cron) with zero internal check
-- either way — a real vulnerability, but revoking PUBLIC would break the
-- legitimate system-triggered paths too. Needs an internal auth.uid() check
-- that distinguishes system triggers from user triggers, not a grant
-- revoke. Tracked separately.

REVOKE EXECUTE ON FUNCTION public.assign_grant_seat(uuid, uuid, uuid, integer, text, text, text, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_booth_sale(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_conference_order_from_cart(uuid, uuid, uuid, text, numeric, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_organizations_by_email_domain(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_rfp_notification_recipients(text[], text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_permission_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mint_prospective_booth_purchase(uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mint_prospective_registration_purchase(uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mint_v3_for_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_expired_booth_holds() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_notion_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unassign_grant_seat(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_booth(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_booth_approval_request(uuid, uuid, uuid, jsonb, integer, integer, integer, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
