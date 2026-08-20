/**
 * Who is currently inside the 90-day new-partner spotlight.
 *
 * One source for every spotlight surface — the "New to the Network" hero
 * slide, the derived "New Partner" badge, and (later) the personalized-slide
 * weighting. Reads `membership_state_log` via fetchRecentFirstActivations(),
 * which is also where the exclusion list is applied, so nothing that opts out
 * of the spotlight can leak through one surface but not another.
 */

import {
  fetchRecentFirstActivations,
  NEWEST_ORG_WINDOW_DAYS,
} from "@/lib/homepage-slides";

/**
 * The activation date for one org, or null if it is not currently spotlighted.
 *
 * Returns YYYY-MM-DD, which is what newPartnerCertification() expects.
 */
export async function getNewPartnerJoinedOn(
  organizationId: string
): Promise<string | null> {
  const activations = await fetchRecentFirstActivations(NEWEST_ORG_WINDOW_DAYS, 100);
  return activations.find((a) => a.organizationId === organizationId)?.activatedOn ?? null;
}

/** Every org currently in the window, keyed by id — for list views. */
export async function getSpotlightMap(): Promise<Map<string, string>> {
  const activations = await fetchRecentFirstActivations(NEWEST_ORG_WINDOW_DAYS, 100);
  return new Map(activations.map((a) => [a.organizationId, a.activatedOn]));
}
