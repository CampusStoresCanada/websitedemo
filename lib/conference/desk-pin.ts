/**
 * The check-in desk PIN — hashing and the rules, with no database.
 *
 * ⛔ Stephen's design (2026-10-19): each staff member has their OWN PIN, set on
 * first use of the desk after a normal password sign-in. It guards two things
 * only — coming back from hand-over mode, and approving an invoice. Forgotten:
 * sign in with the password again and choose a new one. Five wrong tries clear
 * it, which drops the desk back to a password sign-in.
 *
 * Stored as "scrypt$<salt>$<hash>", never the digits. A 4–6 digit PIN is a
 * small space, so the real defence is the five-try limit, not the hash; the
 * hash only stops a database read from handing out PINs.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const DESK_PIN_MAX_ATTEMPTS = 5;

/** 4 to 6 digits, nothing else. */
export function isValidDeskPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function hashDeskPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function deskPinMatches(pin: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(pin, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * After a wrong guess: how many are left, and whether the PIN is now gone.
 * `failedBefore` is the count already stored.
 */
export function afterWrongPin(failedBefore: number): { failed: number; left: number; lockedOut: boolean } {
  const failed = failedBefore + 1;
  return { failed, left: Math.max(0, DESK_PIN_MAX_ATTEMPTS - failed), lockedOut: failed >= DESK_PIN_MAX_ATTEMPTS };
}

/**
 * May this person choose a new PIN right now?
 *
 * ⛔ A fresh password sign-in always may — that is "forgot my PIN". Knowing
 * the current PIN may change it. Nothing else, and that includes having NO PIN:
 * five wrong tries delete it, so "no PIN, just set one" without a fresh sign-in
 * would turn the lockout into a reset anyone at the iPad could use.
 */
export function deskPinChangeAllowed(params: { currentPinOk: boolean; signedInRecently: boolean }): boolean {
  return params.signedInRecently || params.currentPinOk;
}
