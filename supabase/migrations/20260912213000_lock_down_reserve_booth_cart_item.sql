-- reserve_booth_cart_item was executable by PUBLIC — so by `anon`, over the
-- REST API, without signing in.
--
-- It is SECURITY DEFINER and checks nothing about its caller, and two of its
-- parameters are supplied by that caller: p_max_booths is the per-org booth cap
-- and p_expires_at is when the hold lapses. An anonymous caller could therefore
-- pass a large cap and an expiry years out and hold every booth on the floor
-- plan indefinitely — release_expired_booth_holds() only releases holds that
-- have actually expired, so it would never clean them up. Worse, the conflict
-- path returns the holding organization's NAME, so the holds could be made to
-- look like a named member had taken the floor.
--
-- It only ever writes cart_items, so no order, payment or entitlement was ever
-- reachable this way. Denial of inventory during booth sales, not theft.
--
-- Nothing legitimate loses access. The sole caller in every branch of this
-- repository is lib/actions/conference-commerce.ts, a "use server" module using
-- createAdminClient() (SUPABASE_SERVICE_ROLE_KEY), and service_role keeps its
-- own explicit grant. No other database function references it, no edge
-- function does, and no trigger can — it takes six arguments.
--
-- Deliberately NOT touching current_capabilities, max_delegable_until,
-- has_capability or increment_share_link_use, which the linter flags for the
-- same reason: AuthProvider calls current_capabilities from the browser, and
-- increment_share_link_use has no grant other than PUBLIC, so revoking either
-- would break a live path. Those need the caller fixed first — resolving the
-- subject from auth.uid() instead of trusting a parameter — not just a revoke.

revoke execute on function public.reserve_booth_cart_item(
  uuid, uuid, uuid, uuid, timestamp with time zone, integer
) from public, anon, authenticated;
