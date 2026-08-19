/**
 * The board roster — who may vote, and how to reach them in Circle.
 *
 * `profiles.global_role = 'admin'` IS the director roster. Verified 2026-08-19
 * against two independent sources that agree exactly: 9 admin profiles, and 9
 * rows in the `board_of_directors` site_content section (which drives the
 * public About page, complete with officer titles). The 3 `super_admin`
 * accounts are CSC staff — they administer the site but hold no board seat and
 * do not vote.
 *
 * The bylaw denominator is a constant, not a count. `EXPECTED_BOARD_SIZE` and
 * `VOTE_THRESHOLD` below are the rule; the roster query is how we find the
 * people. When those two disagree, that is a fact worth stopping on rather than
 * quietly re-deriving the denominator from whatever the table happens to hold.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDirectorCircleId, isCircleOverridden } from "@/lib/board/director-circle-overrides";

/** Board size fixed by the bylaws. Changing this is a governance decision. */
export const EXPECTED_BOARD_SIZE = 9;

/** Votes in favour needed to carry. Majority of the whole board. */
export const VOTE_THRESHOLD = 5;

export interface Director {
  profileId: string;
  name: string;
  /** Contact email, which is not necessarily the Circle account email. */
  email: string | null;
  /** Circle community_member_id, or null if we cannot reach them there. */
  circleMemberId: number | null;
  /** True when the Circle link came from the manual override, not the contact row. */
  circleViaOverride: boolean;
}

export interface Roster {
  directors: Director[];
  /** The bylaw denominator — always EXPECTED_BOARD_SIZE, never directors.length. */
  boardSize: number;
  threshold: number;
  /** Set when the roster query disagrees with the bylaw size. */
  sizeMismatch: string | null;
  /** Directors with no reachable Circle account. */
  unreachable: Director[];
}

/**
 * Loads the sitting directors.
 *
 * Deliberately does NOT throw on a size mismatch — reporting a wrong-sized
 * board is more useful than a stack trace, and callers that must not proceed
 * (opening a new vote) can check `sizeMismatch` themselves.
 */
export async function loadBoardRoster(): Promise<Roster> {
  const db = createAdminClient();

  const { data: profiles, error } = await db
    .from("profiles")
    .select("id, display_name")
    .eq("global_role", "admin");

  if (error) throw new Error(`[board/roster] failed to load directors: ${error.message}`);

  const profileIds = (profiles ?? []).map((p) => p.id as string);

  // A director may hold contact rows in more than one org (the (person, org)
  // key), so collapse to one contact per profile, preferring one that actually
  // carries a Circle link.
  const { data: contacts } = await db
    .from("contacts")
    .select("profile_id, email, circle_id")
    .in("profile_id", profileIds.length ? profileIds : ["00000000-0000-0000-0000-000000000000"]);

  const contactByProfile = new Map<string, { email: string | null; circle_id: string | null }>();
  for (const c of contacts ?? []) {
    const pid = c.profile_id as string;
    const existing = contactByProfile.get(pid);
    if (!existing || (!existing.circle_id && c.circle_id)) {
      contactByProfile.set(pid, {
        email: (c.email as string) ?? null,
        circle_id: (c.circle_id as string) ?? null,
      });
    }
  }

  const directors: Director[] = (profiles ?? []).map((p) => {
    const profileId = p.id as string;
    const contact = contactByProfile.get(profileId);
    const circleMemberId = resolveDirectorCircleId(profileId, contact?.circle_id);
    return {
      profileId,
      name: (p.display_name as string) ?? "Unknown director",
      email: contact?.email ?? null,
      circleMemberId,
      circleViaOverride: !contact?.circle_id && isCircleOverridden(profileId),
    };
  });

  directors.sort((a, b) => a.name.localeCompare(b.name));

  const sizeMismatch =
    directors.length === EXPECTED_BOARD_SIZE
      ? null
      : `Board roster has ${directors.length} directors (profiles.global_role='admin') but the bylaws fix the board at ${EXPECTED_BOARD_SIZE}. ` +
        `Voting is suspended until the roster and the bylaw agree — a wrong denominator silently changes what a majority means.`;

  return {
    directors,
    boardSize: EXPECTED_BOARD_SIZE,
    threshold: VOTE_THRESHOLD,
    sizeMismatch,
    unreachable: directors.filter((d) => d.circleMemberId === null),
  };
}

/** True if this profile currently holds a board seat, i.e. may cast a ballot. */
export async function isSittingDirector(profileId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .eq("global_role", "admin")
    .maybeSingle();
  return !!data;
}
