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

/**
 * Seeing a later stage of the cycle without waiting for it.
 *
 * Greg asked whether the cycle could be fast-forwarded when the outcome is
 * already decided. Almost none of it can, and deliberately: every date the
 * timeline refuses to jump is a right the by-law gives someone else. Closing
 * nominations early takes away Part V S2(c)'s window for additional
 * nominations; sealing early discards the ballots of members who had until the
 * published date to vote; announcing early announces a result at a meeting
 * that has not happened. The one genuine fast-forward — a slate no larger than
 * the seats, acclaimed, the whole ballot phase dropped — is already in the
 * timeline and removes four stages on its own.
 *
 * What was actually missing is the ability to LOOK. So the calendar moves and
 * nothing else: the committee can see what October 23rd offers them without
 * being able to do any of it eight weeks early.
 *
 * ⛔ Every action is stripped of its runnability here. Without this, a preview
 * dated after the close would render a live "Close nominations" button —
 * turning a viewing tool into a way to do the exact thing the dates forbid.
 * The server actions refuse independently, but no one should ever get far
 * enough to rely on that: this module already learned what one unguarded
 * button costs.
 */
export const DATE_PREVIEW_BLOCK = "Date preview — actions are disabled.";

export function asOfDate(searchParams: { asOf?: string } | undefined): string | null {
  const raw = searchParams?.asOf;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  // Rejects 2026-13-40 and friends, which would otherwise sort as a valid string.
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

export function disableActions<T extends { action: { blockedBy: string | null } | null }>(
  stages: T[]
): T[] {
  return stages.map((stage) =>
    stage.action ? { ...stage, action: { ...stage.action, blockedBy: DATE_PREVIEW_BLOCK } } : stage
  );
}
