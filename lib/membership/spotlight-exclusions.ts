/**
 * Orgs held out of the automated new-partner spotlight.
 *
 * Some partners need to be introduced by a human, on a schedule a human
 * chooses, with context an automated template can't carry. Excluding them here
 * — at the source query — keeps them out of every spotlight surface at once:
 * the "New to the Network" hero slide, the derived "New Partner" badge, and
 * the personalized-slide weighting.
 *
 * This is deliberately NOT a suppression of the org itself. They are a real,
 * active partner and appear everywhere a partner normally appears — the
 * directory, the map, search. All that is withheld is the automated fanfare.
 *
 * TEMPORARY SHAPE: once `ghost_announcements` exists (Phase 1 of the plan),
 * this becomes a `skipped` row in that table with a reason and an actor, which
 * is a better home for it — auditable, and editable without a deploy. Until
 * then a documented constant beats an undocumented special case.
 */

export interface SpotlightExclusion {
  organizationId: string;
  /** For logs and review. Not used for matching. */
  name: string;
  reason: string;
}

export const SPOTLIGHT_EXCLUSIONS: readonly SpotlightExclusion[] = [
  {
    organizationId: "2ccd6f38-6d66-4a76-8016-6098168574ce",
    name: "Ambassador Education Solutions",
    reason:
      "The board asked for carefully considered context before members meet this partner — their model touches how stores themselves operate, which is not something a templated welcome can frame. Being handled entirely by hand, outside this system. " +
      "Remove this entry once that introduction has been made.",
  },
];

const EXCLUDED_IDS = new Set(SPOTLIGHT_EXCLUSIONS.map((e) => e.organizationId));

/** True if this org is held out of the automated spotlight. */
export function isSpotlightExcluded(organizationId: string): boolean {
  return EXCLUDED_IDS.has(organizationId);
}
