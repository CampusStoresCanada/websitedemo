-- Lock down the capability surface.
--
-- Three objects created 2026-08-24 were readable by every signed-in user:
--
--   capability_contributions      a VIEW, owner postgres, security_invoker=off.
--                                 That combination made it run with the owner's
--                                 rights, so it bypassed RLS on everything it
--                                 joined — including contacts, and including
--                                 governance_role_assignments, which is RLS-on
--                                 with no policies precisely so nobody reads it
--                                 directly. The view handed both out anyway.
--   governance_role_capabilities  policy USING (true) for authenticated.
--   capability_delegates          policy USING (true) for authenticated.
--
-- No escalation was possible: no role but service_role ever held INSERT/UPDATE/
-- DELETE, and anon held nothing at all. This was a read exposure of the whole
-- governance roster — who holds which role, on which body, their term dates and
-- the appointing resolution or notes behind the appointment.
--
-- These follow the house pattern instead: guard at the route, read with
-- createAdminClient(). The three pages that read the view (/admin/access,
-- /benchmarking/committee, /benchmarking/admin) already guard on admin or
-- committee-lead and now read with the service role, so nothing needs a
-- direct grant.
--
-- has_capability() is SECURITY DEFINER, so capability checks keep working
-- without any of these grants.

-- capability_contributions (view) ------------------------------------------
-- security_invoker=on so that if this is ever re-granted, the caller's own RLS
-- applies rather than postgres's. Defence in depth behind the revoke below.
alter view public.capability_contributions set (security_invoker = on);

revoke select on public.capability_contributions from anon;
revoke select on public.capability_contributions from authenticated;

-- governance_role_capabilities ---------------------------------------------
drop policy if exists "governance_role_capabilities_read" on public.governance_role_capabilities;
revoke select on public.governance_role_capabilities from anon;
revoke select on public.governance_role_capabilities from authenticated;

-- capability_delegates -----------------------------------------------------
drop policy if exists "capability_delegates_read" on public.capability_delegates;
revoke select on public.capability_delegates from anon;
revoke select on public.capability_delegates from authenticated;

-- governance_role_assignments is already RLS-on with no policies and no grant
-- to anon or authenticated. Left as is: deny-by-default is the intent.
