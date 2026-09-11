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

/**
 * A stand-in nomination, so the nominee's page and the co-signer's page can be
 * previewed before any nomination exists.
 *
 * These two are the only member-facing pages reachable solely by a token, so
 * there is no URL an admin can visit to see them — which meant the committee
 * could inspect every page a member touches EXCEPT the two that decide whether
 * a nomination happens. Describing them in a chat window is not a preview.
 *
 * Typed as the real NominationView, so the shape cannot drift from the thing it
 * imitates without the compiler saying so; only the values are invented, and
 * every one of them is bracketed so a screenshot can never pass for real data.
 *
 * ⛔ Not persisted, and not reachable without the admin gate — isAdminPreview
 * is checked before this is ever built.
 */

import type { NominationView } from "./service";

export function sampleNomination(opts: {
  electionId: string;
  cosignersRequired: number;
  nominationsCloseAt: string;
}): NominationView {
  return {
    id: "preview",
    electionId: opts.electionId,
    status: "accepted",
    source: "member",
    nomineeContactId: "preview",
    nomineeProfileId: null,
    nomineeOrganizationId: "preview",
    nomineeName: "[the nominee's name]",
    organizationName: "[their institution]",
    bio: "",
    platform: "",
    candidateAcceptedAt: null,
    candidateDeclinedAt: null,
    storePermissionGrantedAt: null,
    withdrawnAt: null,
    withdrawalRequestedAt: null,
    acceptToken: "preview",
    cosignatures: {
      required: opts.cosignersRequired,
      valid: 1,
      satisfied: false,
      signingOrganizationIds: ["preview"],
      problems: [],
      signedByDirectors: [],
    },
    candidate: { eligible: true, blocking: [], unverifiable: [] },
    completeness: {
      complete: false,
      missing: [
        "The nominee has not accepted yet.",
        "Their institution has not given permission.",
        `One more institution needs to co-sign (${opts.cosignersRequired} required).`,
      ],
    },
  };
}
