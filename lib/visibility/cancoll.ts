import { CANCOLL_CERT } from "@/lib/certifications";
import type { ViewerContext } from "./viewer";

/**
 * Who may see the CANCOLL badge.
 *
 * CANCOLL is not a claim about the org — it's a purchasing-group relationship,
 * and the rule is reciprocal: it shows only to orgs that are themselves in that
 * relationship, on either side. Both sides are real and populated —
 * 51 member stores and 9 vendor partners carry `is_cancoll_member` — so
 * "holders see each other" is a genuine audience rather than an empty set.
 *
 * ⚠️ This deliberately does NOT include "is a CSC member". That was the old
 * rule, spelled four different ways across four render sites (PartnerProfile,
 * DirectoryTable, and twice in OrgDetailPanel). Being a member is not the same
 * as being in the purchasing group, and 29 of the 80 member orgs are not.
 *
 * The other eight certifications are self-declared public claims and are NOT
 * gated here — no member org holds one (measured: zero), so scoping them to
 * holders would hide every badge from every buyer, which is the whole audience.
 * Their reciprocal counterpart is the member's `preferred_certifications`, and
 * that pairing is already expressed as emphasis (CertificationBadges'
 * highlightSet), not as a gate.
 */
export function maySeeCancoll(opts: {
  /** Does the VIEWER's own org carry CANCOLL? */
  isCancollMember: boolean;
  /** CSC staff see everything. */
  isCscStaff: boolean;
  /**
   * Is the viewer looking at their own org? An org always sees its own
   * standing — it's the one fact it can't be told it doesn't hold, and its
   * admin needs it to render the toggle.
   */
  isOwnOrg?: boolean;
}): boolean {
  return opts.isCscStaff || opts.isOwnOrg === true || opts.isCancollMember;
}

/**
 * Server-side adapter over {@link maySeeCancoll}. Takes primitives rather than
 * a ViewerContext so the client render sites (MapExplore, DirectoryTable) can
 * call the same rule instead of restating it — restating it is how one rule
 * became four subtly different ones.
 */
export function viewerMaySeeCancoll(
  viewer: Pick<ViewerContext, "viewerLevel" | "viewerIsCancollMember">,
  isOwnOrg = false
): boolean {
  return maySeeCancoll({
    isCancollMember: viewer.viewerIsCancollMember,
    isCscStaff: viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin",
    isOwnOrg,
  });
}

/**
 * Remove CANCOLL from a certifications array unless the viewer qualifies.
 *
 * Applied server-side, before serialisation, so the name never reaches a client
 * that shouldn't have it — the render-time filter in CertificationBadges hides
 * the badge but would still ship the string in the page payload, which matters
 * now that `organizations.certifications` is publicly visible.
 */
export function gateCancoll(certifications: string[], maySee: boolean): string[] {
  if (maySee) return certifications;
  return certifications.filter((c) => c !== CANCOLL_CERT.name);
}
