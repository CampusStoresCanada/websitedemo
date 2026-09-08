/**
 * Per-conference badge scan and schedule rules.
 *
 * ⛔ These were `const`s in the scan and agenda code — CSC's answers compiled in
 * as everyone's. A conference whose organisations are typed differently silently
 * stopped asking attendees before sharing their details, and one split across
 * two blocks of dates lost half its schedule off every badge. Neither failed
 * loudly, which is what made them worth moving.
 *
 * ⛔ CONFERENCE-scoped, deliberately. They briefly lived in `policy_values`,
 * which was wrong twice: those are global, so one conference's vocabulary would
 * rewrite every other conference's consent gate; and writing them means a
 * draft/validate/publish cycle, which is absurd weight for an operator ticking
 * "Sponsor" while building a badge.
 */

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The five ways a badge can be scanned, derived from the PAIR.
 *
 * ⛔ A direction is a fact about who is standing there. Where it goes is a
 * DECISION, and belongs to the conference — which is the half that was still
 * hardcoded after the org-type classification moved out.
 */
export const SCAN_DIRECTIONS = [
  "self",
  "attendeeToCompany",
  "attendeeToAttendee",
  "companyToCompany",
  "companyToAttendee",
] as const;
export type ScanDirection = (typeof SCAN_DIRECTIONS)[number];

/**
 * Where a direction lands.
 *
 * `capture` is the only one that discloses anything, and only after the
 * attendee says so. `circle` needs a community to send people to — a conference
 * without one points those scans somewhere else instead of dead-ending.
 */
export const SCAN_DESTINATIONS = ["org", "circle", "capture", "map", "none"] as const;
export type ScanDestination = (typeof SCAN_DESTINATIONS)[number];

export type BadgeScanRules = {
  /** Scans BY these organisation types capture leads. */
  disclosingOrgTypes: string[];
  /** People at these organisation types ARE the attendees the gate protects. */
  attendeeOrgTypes: string[];
  /**
   * An organisation type on NEITHER list. True asks the attendee before
   * anything is shared; false treats the scan as internal and never asks.
   */
  unlistedOrgTypeDiscloses: boolean;
  /** Days explicitly chosen for the printed schedule. */
  onsiteDayIds: string[];
  /** What happens to a day nobody has chosen. */
  unlistedDayMode: "derive" | "include" | "exclude";
  /** Where each direction sends the scanner. */
  destinations: Record<ScanDirection, ScanDestination>;
};

/**
 * What the four directions do unless a conference says otherwise.
 *
 * Not a claim that every conference wants this — it is what CSC decided, kept
 * as the starting point so a new conference is usable before anyone opens the
 * editor. Scanning a peer goes to their community profile because that is a bid
 * to connect with a person; scanning a company's staffer is a company lookup.
 */
export const DEFAULT_SCAN_DESTINATIONS: Record<ScanDirection, ScanDestination> = {
  self: "map",
  attendeeToCompany: "org",
  attendeeToAttendee: "circle",
  companyToCompany: "org",
  companyToAttendee: "capture",
};

/**
 * What an unconfigured conference gets.
 *
 * ⛔ Both lists EMPTY with the fallback ON, so every scan of an attendee asks.
 * Noisy and obvious, which is the point: the opposite default would quietly
 * stop asking, and that is the exact silent failure these rules exist to
 * remove. Nothing here names an organisation type — a default that assumed
 * "Vendor Partner" would just be the old hardcoding with extra steps.
 */
export const UNCONFIGURED_BADGE_SCAN_RULES: BadgeScanRules = {
  disclosingOrgTypes: [],
  attendeeOrgTypes: [],
  unlistedOrgTypeDiscloses: true,
  onsiteDayIds: [],
  unlistedDayMode: "derive",
  destinations: DEFAULT_SCAN_DESTINATIONS,
};

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * ⚠️ Null and empty are different answers. Null means nobody has configured
 * this conference, so the conservative defaults apply. An explicit empty list
 * is a decision — "no organisation type captures leads here" — and is kept.
 */
export function normalizeBadgeScanRules(value: unknown): BadgeScanRules {
  if (!value || typeof value !== "object") return UNCONFIGURED_BADGE_SCAN_RULES;
  const raw = value as Record<string, unknown>;
  const mode = raw.unlistedDayMode;
  return {
    disclosingOrgTypes: asStrings(raw.disclosingOrgTypes),
    attendeeOrgTypes: asStrings(raw.attendeeOrgTypes),
    unlistedOrgTypeDiscloses: raw.unlistedOrgTypeDiscloses !== false,
    onsiteDayIds: asStrings(raw.onsiteDayIds),
    unlistedDayMode: mode === "include" || mode === "exclude" ? mode : "derive",
    destinations: normalizeDestinations(raw.destinations),
  };
}

/** Unknown or missing directions fall back one at a time, not all-or-nothing. */
function normalizeDestinations(value: unknown): Record<ScanDirection, ScanDestination> {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out = {} as Record<ScanDirection, ScanDestination>;
  for (const direction of SCAN_DIRECTIONS) {
    const candidate = raw[direction];
    out[direction] = (SCAN_DESTINATIONS as readonly string[]).includes(candidate as string)
      ? (candidate as ScanDestination)
      : DEFAULT_SCAN_DESTINATIONS[direction];
  }
  return out;
}

/**
 * The rules for one conference.
 *
 * Never throws: a badge run must still produce badges when this read fails, and
 * the fallback it lands on is the loud one, not the silent one.
 */
export async function getBadgeScanRules(conferenceId: string): Promise<BadgeScanRules> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("conference_instances")
      .select("badge_scan_rules")
      .eq("id", conferenceId)
      .maybeSingle();
    return normalizeBadgeScanRules(data?.badge_scan_rules);
  } catch {
    return UNCONFIGURED_BADGE_SCAN_RULES;
  }
}
