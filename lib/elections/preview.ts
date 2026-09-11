/**
 * Admin preview of the member-facing election pages.
 *
 * Greg asked to see the nomination form and the ballot before members do —
 * reasonably, since until now the only way to know what they looked like was
 * to be an eligible member store, which CSC's own staff are not.
 *
 * ⚠️ This bypasses what a page DISPLAYS. It bypasses nothing that WRITES.
 * Every server action re-derives the actor from the session and refuses anyone
 * who is not an administrator of an eligible member institution —
 * submitNominationAction and saveBallotAction both do this independently of
 * whatever the page rendered. So a preview cannot nominate, cannot vote, and
 * cannot be made to by editing the URL: the worst an admin can do here is look
 * at a form that will refuse them.
 *
 * Gated on the global role alone. It deliberately takes no organization from
 * the query string — "render this page as that store sees it" is one typo away
 * from a member-data leak, and nothing here needs it.
 */

import { getServerAuthState } from "@/lib/auth/server";

export async function isAdminPreview(
  searchParams: { preview?: string } | undefined
): Promise<boolean> {
  if (searchParams?.preview !== "1") return false;
  const auth = await getServerAuthState();
  return auth.globalRole === "admin" || auth.globalRole === "super_admin";
}

/** Shown on every previewed page, so a screenshot can never be mistaken for the real thing. */
export const PREVIEW_BANNER =
  "Preview — this is what an eligible member sees. Nothing here can be submitted from your account.";
