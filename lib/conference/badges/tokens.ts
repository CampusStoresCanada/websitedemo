/**
 * Badge scan tokens — what the QR code on a badge actually carries.
 *
 * ⛔ The QR used to encode `conference_people.id` verbatim (`tokenMap.set(id, id)`),
 * which meant three things at once: a phone camera had no URL to open, the
 * printed code was a live database primary key, and it could never be revoked
 * without reprinting the badge.
 *
 * The token is DERIVED from its own row id rather than stored, so:
 *   - reprinting a job reproduces the same code (the row id does not move),
 *   - the database never holds the plaintext, only its hash,
 *   - revoking is `revoked_at` plus a fresh row, which yields a new code.
 *
 * The secret is `SUPABASE_SERVICE_ROLE_KEY`, matching lib/email/eventActionTokens.ts,
 * so this needs no new environment variable in any deployment.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";

/** Marks rows whose token is derived this way; older rows are `person_uuid`. */
export const BADGE_TOKEN_FORMAT = "hmac_v1";

/** Route prefix the QR points at. See badgeScanUrl for why not `/s/`. */
export const BADGE_SCAN_PATH = "/scan";

/**
 * 16 base64url chars ≈ 96 bits — far beyond guessing, and short enough that the
 * whole URL stays a low-density QR that scans reliably at badge size.
 */
const TOKEN_LENGTH = 16;

function secret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return key;
}

/** The plaintext token for a badge-token row. Deterministic, never stored. */
export function deriveBadgeToken(conferenceId: string, tokenRowId: string): string {
  return createHmac("sha256", secret())
    .update(`badge:${conferenceId}:${tokenRowId}`)
    .digest("base64url")
    .slice(0, TOKEN_LENGTH);
}

/** What goes in the `token_hash` column. Lookup key for an incoming scan. */
export function hashBadgeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare, so a stored hash cannot be probed byte by byte. */
export function badgeTokenMatches(token: string, storedHash: string): boolean {
  const computed = Buffer.from(hashBadgeToken(token), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/**
 * The URL a phone opens when it scans the badge.
 *
 * `/s/` was the obvious path and is already taken — it resolves share links and
 * snapshots. Overloading it would make token resolution ambiguous across three
 * unrelated schemes, so badge scans live at `/scan/`.
 *
 * One route for every badge: the server reads the viewer's session to learn who
 * is scanning, resolves the token to learn who is being scanned, and decides the
 * outcome from that pair. The printed code therefore never has to change when
 * the behaviour behind it does — which matters, because badges print in January
 * and the behaviour is still being designed.
 */
export function badgeScanUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca").replace(/\/+$/, "");
  // A badge is permanent. Generating a print run against a dev environment would
  // put `http://localhost:3000/s/...` on every card, and no one would notice
  // until someone scanned one in February. Local renders must opt in.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base)) {
    if (process.env.BADGE_ALLOW_LOCAL_SCAN_URL !== "1") {
      throw new Error(
        `Refusing to print badge scan URLs against ${base}. Set NEXT_PUBLIC_APP_URL to the ` +
          `public site, or set BADGE_ALLOW_LOCAL_SCAN_URL=1 for a throwaway local render.`
      );
    }
  }
  return `${base}${BADGE_SCAN_PATH}/${token}`;
}

/**
 * The token inside whatever a scanner actually handed us.
 *
 * ⛔ A camera reads the WHOLE QR, and the QR is a URL. The check-in desk hashes
 * what it is given, so once badges carried `https://…/scan/<token>` instead of a
 * bare id, every badge came back `invalid_token` — a failure that would first
 * appear at the desk on day one with a queue forming.
 *
 * Accepts a bare token, the full scan URL, or that URL with query or hash
 * noise, and is deliberately in the ONE reader both the desk and `/scan` use.
 */
export function tokenFromScannedValue(raw: string): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (!/^https?:\/\//i.test(value) && !value.includes("/")) return value;
  const withoutQuery = value.split(/[?#]/)[0];
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

/** A badge-token row as every reader needs it. */
export type BadgeTokenRow = {
  id: string;
  person_id: string;
  conference_id: string;
  revoked_at: string | null;
};

/**
 * THE reader for `conference_badge_tokens`.
 *
 * ⛔ There were two: the check-in desk hashed the token itself, and the scan
 * route hashed it again. Same table, same sha256, same revoked check, written
 * twice — which is how the desk and the scan route eventually disagree about
 * whether a badge is valid. Same lesson as loadSeatHoldings().
 *
 * Returns the row or null; it decides no policy. Whether a revoked token is
 * "revoked" or merely "invalid" is the caller's distinction to make, because
 * the desk shows an operator a different message than a phone does.
 *
 * @param conferenceId scope the lookup; omit to resolve from the token alone.
 */
export async function findBadgeTokenRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any,
  params: { token: string; conferenceId?: string }
): Promise<BadgeTokenRow | null> {
  // Normalised here, not at each call site: the desk and the scan route are two
  // callers with two input shapes, and only one of them ever sees a bare token.
  const token = tokenFromScannedValue(params.token ?? "");
  if (!token) return null;
  let query = db
    .from("conference_badge_tokens")
    .select("id, person_id, conference_id, revoked_at")
    .eq("token_hash", hashBadgeToken(token));
  if (params.conferenceId) query = query.eq("conference_id", params.conferenceId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data as BadgeTokenRow;
}
