-- Continuation of the RLS advisory sweep. "contacts" had public INSERT,
-- public UPDATE, and authenticated-role DELETE policies with no
-- restriction at all (USING/WITH CHECK true) — the same shape as
-- organizations in 20260723210000.
--
-- Verified before touching this:
--   - The only real INSERT is lib/identity/lifecycle.ts, via
--     createAdminClient().
--   - The only real UPDATE is lib/actions/profile.ts, via
--     createAdminClient().
--   - There is no hard DELETE on contacts anywhere in the codebase.
--     lib/actions/delete-contact.ts (requireAuthenticated() +
--     canManageOrganization() checked) archives via lib/identity/
--     lifecycle.ts's archivePersonContact(), which is an UPDATE
--     (archived_at) through createAdminClient() — never a real DELETE.
--     The "authenticated can delete" policy has zero legitimate caller.
--
-- NOT included here: the public SELECT policy. Unlike the write
-- policies, it's load-bearing for real public pages — components/map/
-- MapExplore.tsx queries it directly from the browser (rendered via
-- MapHero on the homepage, /partners, and /members), and lib/snapshots/
-- capture.ts reads it server-side for public org profiles. Tracked
-- separately — needs an actual scoping decision (a restricted public
-- view/columns, or routing through a server action that applies the
-- existing lib/visibility/engine.ts masking instead of querying Supabase
-- directly from the browser), not a blanket revoke.
--
-- Also NOT touched: "Users can read their organization's contacts" — a
-- narrower authenticated-scoped SELECT policy that's currently moot
-- (superseded by the public one) but harmless and will matter once the
-- public policy above is actually narrowed.

DROP POLICY IF EXISTS "Allow public insert access on contacts" ON public.contacts;
DROP POLICY IF EXISTS "Allow public update access on contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can delete contacts" ON public.contacts;
