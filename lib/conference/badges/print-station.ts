/**
 * Print stations — the rules, with no database.
 *
 * ⛔ A print station is the laptop beside the Brother QL. It prints what the
 * desk queues ("Send to print queue") STRAIGHT to the printer, at each
 * sticker's exact length, cut between stickers. A browser's print dialog cannot
 * do that: the printer driver overrides the page size with its own paper (a
 * 120 mm back came out as two 100 mm pieces, 2026-10-21). Proven the same day:
 * direct printing lines up with the card to fractions of a millimetre.
 *
 * Each station has its own key: one per laptop, per conference, revocable,
 * shown once and stored as a SHA-256 hash.
 */

import { createHash, randomBytes } from "crypto";

/** Recognisable in a config file, and in a leaked paste. */
export const PRINT_STATION_KEY_PREFIX = "cscps_";

export function newPrintStationKey(): string {
  return PRINT_STATION_KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashPrintStationKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** The key from an `Authorization: Bearer <key>` header, or null. */
export function keyFromAuthorization(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  const key = match?.[1] ?? null;
  return key && key.startsWith(PRINT_STATION_KEY_PREFIX) ? key : null;
}

/** The laptop checks in every few seconds; past this it is offline. */
export const STATION_ONLINE_SECONDS = 30;

export function stationOnline(lastSeenAt: string | null, now: Date = new Date()): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt.endsWith("Z") || lastSeenAt.includes("+") ? lastSeenAt : `${lastSeenAt}Z`);
  return Number.isFinite(seen) && now.getTime() - seen <= STATION_ONLINE_SECONDS * 1000;
}

/**
 * A job a station claimed and never reported back (the laptop slept, the cable
 * came out) goes back to the queue after this, so another station — or the
 * same one, restarted — can print it.
 */
export const CLAIM_EXPIRES_SECONDS = 120;

export function claimExpired(claimedAt: string | null, now: Date = new Date()): boolean {
  if (!claimedAt) return true;
  const at = Date.parse(claimedAt.endsWith("Z") || claimedAt.includes("+") ? claimedAt : `${claimedAt}Z`);
  return !Number.isFinite(at) || now.getTime() - at > CLAIM_EXPIRES_SECONDS * 1000;
}
