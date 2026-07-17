/**
 * Reads the persistent, non-httpOnly cookie AuthProvider sets whenever it
 * resolves a signed-in visitor's permissionState (lib/auth/permissions.ts).
 * Lets logged-out UI distinguish "known member/org admin/admin/partner —
 * nudge them to log back in" from "no record of this visitor — nudge join",
 * without touching the auth session itself.
 */

const COOKIE_NAME = "csc_had_session";

const RECOGNIZED_PERSONAS = new Set([
  "member",
  "org_admin",
  "partner",
  "admin",
  "super_admin",
]);

function readPersonaCookieValue(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

/** True for any visitor we've ever resolved an identity for — including the pre-rollout legacy "1" value and "public" (signed in, no org/admin role). */
export function hadPriorSession(): boolean {
  return readPersonaCookieValue() !== null;
}

/** True only for a previously-resolved member, org admin, partner, admin, or super admin — the decisive "log back in" case. */
export function hasKnownAccountPersona(): boolean {
  const value = readPersonaCookieValue();
  return value !== null && RECOGNIZED_PERSONAS.has(value);
}
