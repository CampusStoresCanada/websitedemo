import type { GlobalRole } from "@/lib/auth/types";
import type { ViewerLevel } from "@/lib/visibility/defaults";

/**
 * Presentation mode — a staff account watching itself on a screen share.
 *
 * CSC staff are the only accounts that see everything: `applyFieldMask` returns
 * the row untouched for admin/super_admin (lib/visibility/engine.ts), and
 * `resolveOrgPageBenchmarking` hands staff `{ show: "detail" }` before it asks
 * a single disclosure question (lib/benchmarking/org-page-visibility.ts). That
 * is correct for doing the job and wrong for doing it in front of a room — the
 * September 2026 town hall puts members and partners in the same call while
 * someone drives the site from a staff account.
 *
 * The fix rests on a separation the codebase already makes:
 *
 *   viewerLevel  — what you are SHOWN.   Read in ~96 places via getViewerContext.
 *   globalRole   — what you may DO.      Read by requireAdmin/canManageOrganization.
 *
 * Nothing that authorises a write consults `viewerLevel`; `updateField` gates on
 * `canManageOrganization`, which reads `globalRole`. So lowering the first while
 * leaving the second alone yields exactly the thing that was wanted: the pages
 * render as a member (or partner, or the public) sees them, while the person
 * driving keeps every capability they had.
 *
 * ⚠️ This masks SERVER-SIDE — the withheld fields never enter the page payload,
 * so a screen share cannot leak what the browser was never sent. It is not a
 * blur over live data and must never be reimplemented as one.
 *
 * This module is imported by CLIENT components (the indicator bar, the admin
 * card) for its labels and types, so it must stay free of server-only imports —
 * the write lives in ./store.ts for that reason, not for tidiness.
 *
 * ⛔ What it does NOT cover, by construction: the admin consoles under /admin
 * and /benchmarking/admin read through `createAdminClient()` and never call
 * `getViewerContext()`, so there is no viewerLevel there to lower. Those routes
 * are BLOCKED while presentation mode is on (see components/presentation/
 * PresentationBlock.tsx) rather than masked — a page that is sensitive
 * end-to-end should be shut, not filtered.
 */

/** Key inside profiles.preferences (see 20260825180000_profiles_preferences). */
export const PREFERENCE_KEY = "presentation_mode";

/**
 * The audience being impersonated for display.
 *
 * Not a boolean because the town hall run of show asks for two of these in
 * sequence — "partner view, then member view of the same store" — and an
 * account that can only be "not staff" cannot show the difference.
 */
export type PresentationLevel = "member" | "partner" | "public";

export const PRESENTATION_LEVELS: readonly PresentationLevel[] = [
  "member",
  "partner",
  "public",
] as const;

export const PRESENTATION_LABELS: Record<PresentationLevel, string> = {
  member: "Member",
  partner: "Partner",
  public: "Public (signed out)",
};

function isPresentationLevel(value: unknown): value is PresentationLevel {
  return (
    typeof value === "string" &&
    (PRESENTATION_LEVELS as readonly string[]).includes(value)
  );
}

/** Shared with ./store.ts so the read and the write agree on what a bag is. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Who may turn this on.
 *
 * Restricted to the roles that have something to hide. This is not a privacy
 * control for members — a member who switched themselves to "public" would
 * quietly lose access to things they are entitled to and have no way to
 * explain why, which is the failure mode the Circle badge pause was
 * deliberately allow-listed to avoid.
 */
export function canUsePresentationMode(role: GlobalRole): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * Read the stored level off a profile row. Absent, malformed, or held by an
 * account that may not use it all read as off.
 *
 * Takes the already-fetched profile rather than querying: `getIdentitySnapshot`
 * selects `profiles.*` once per request, so this costs nothing on a path that
 * runs for every page render.
 */
export function readPresentationMode(
  profile: { preferences?: unknown } | null | undefined,
  role: GlobalRole,
): PresentationLevel | null {
  if (!canUsePresentationMode(role)) return null;
  if (!isRecord(profile?.preferences)) return null;

  const stored = profile.preferences[PREFERENCE_KEY];
  return isPresentationLevel(stored) ? stored : null;
}

/**
 * Clamp a resolved viewer level to the presented audience.
 *
 * ⛔ This may only ever LOWER. The guard is the first line rather than a rank
 * comparison: presentation mode is available to staff alone, so the only level
 * it is ever asked to replace is `admin` or `super_admin` — the top of the
 * ladder, from which every target is a reduction. Anything else passes through
 * untouched, so a stray preference on a non-staff row cannot promote anyone.
 *
 * "public" maps to `public` and not `authenticated` on purpose: it is there to
 * answer "what does someone who isn't signed in see", and `authenticated` is a
 * different, narrower question nobody asks from a stage.
 */
export function applyPresentationMode(
  actual: ViewerLevel,
  mode: PresentationLevel | null,
): ViewerLevel {
  if (!mode) return actual;
  if (actual !== "admin" && actual !== "super_admin") return actual;
  return mode;
}
