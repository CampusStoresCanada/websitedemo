// ---------------------------------------------------------------------------
// Event tag taxonomy + user tag derivation
//
// Tags live in events.metadata.tags (string[]).
// A user's "profile tags" are derived from their org record — no user action
// required. Matching is a simple set intersection.
// ---------------------------------------------------------------------------

// ---- Vocabulary -----------------------------------------------------------

export const PROVINCE_TAGS = [
  "British Columbia",
  "Alberta",
  "Saskatchewan",
  "Manitoba",
  "Ontario",
  "Quebec",
  "New Brunswick",
  "Nova Scotia",
  "Prince Edward Island",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Yukon",
  "Nunavut",
] as const;

export const DEPARTMENT_TAGS = [
  "Apparel",
  "Convenience & Grocery",
  "Course Materials",
  "Emblematic Gifts",
  "General Merchandise",
  "Gifts & Stationery",
  "Health & Beauty",
  "School & Office Supplies",
  "Sports & Recreation",
  "Store Operations",
  "Technology",
  "Tradebooks",
] as const;

export const MEMBER_ROLE_TAGS = [
  "store-manager",
  "buyer",
  "board-member",
  "new-member",
  "all-members",
  "partner",
] as const;

export const MEMBER_ROLE_LABELS: Record<string, string> = {
  "store-manager": "Store Managers",
  "buyer":         "Buyers",
  "board-member":  "Board Members",
  "new-member":    "New Members",
  "all-members":   "All Members",
  "partner":       "Partners",
};

export type ProvinceTag    = typeof PROVINCE_TAGS[number];
export type DepartmentTag  = typeof DEPARTMENT_TAGS[number];
export type MemberRoleTag  = typeof MEMBER_ROLE_TAGS[number];
export type EventTag       = ProvinceTag | DepartmentTag | MemberRoleTag | string;

// ---- User tag derivation --------------------------------------------------

export interface OrgProfile {
  province:          string | null;
  nacs_department:   string | null;
  nacs_classes:      string[] | null;
  is_cancoll_member: boolean | null;
}

/**
 * Derive a set of interest tags from a user's organization profile.
 * These are matched against event metadata.tags for "For you" highlighting.
 */
export function deriveUserTags(org: OrgProfile): string[] {
  const tags = new Set<string>();

  if (org.province)        tags.add(org.province);
  if (org.nacs_department) tags.add(org.nacs_department);
  for (const cls of org.nacs_classes ?? []) tags.add(cls);

  return [...tags];
}

// ---- Event tag matching ---------------------------------------------------

/**
 * Returns true if any of the event's metadata.tags intersect with the user's
 * derived tags. Gracefully handles missing/malformed metadata.
 */
export function eventMatchesUserTags(
  eventMetadata: unknown,
  userTags: string[]
): boolean {
  if (!userTags.length) return false;
  if (!eventMetadata || typeof eventMetadata !== "object") return false;

  const meta = eventMetadata as Record<string, unknown>;
  const tags = meta["tags"];
  if (!Array.isArray(tags) || tags.length === 0) return false;

  const userTagSet = new Set(userTags.map((t) => t.toLowerCase()));
  return tags.some((t) => userTagSet.has(String(t).toLowerCase()));
}

// ---- Tag group helpers for the admin UI -----------------------------------

export const TAG_GROUPS = [
  {
    label: "Province / Region",
    tags:  PROVINCE_TAGS as readonly string[],
  },
  {
    label: "Department",
    tags:  DEPARTMENT_TAGS as readonly string[],
  },
  {
    label: "Member Role",
    tags:   MEMBER_ROLE_TAGS as readonly string[],
    labels: MEMBER_ROLE_LABELS,
  },
] as const;
