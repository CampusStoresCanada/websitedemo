import { describe, expect, it } from "vitest";
import { isProbablyARace, RACE_WINDOW_MS } from "../webhook-race";

/**
 * Guards the discriminator that decides whether an unmatched Resend event is
 * retried or discarded. Getting it wrong in one direction loses delivery data
 * silently (the 2026-09-21 Town Hall send: 96 recorded of 496 actual); wrong
 * in the other, every test send burns six retries.
 */
describe("isProbablyARace", () => {
  const now = Date.parse("2026-09-21T15:15:00.000Z");

  it("treats an event for a just-sent email as a race worth retrying", () => {
    expect(isProbablyARace("2026-09-21T15:14:59.000Z", now)).toBe(true);
  });

  it("still retries near the edge of the window", () => {
    const justInside = new Date(now - RACE_WINDOW_MS + 1000).toISOString();
    expect(isProbablyARace(justInside, now)).toBe(true);
  });

  it("accepts rather than retries once past the window — an untracked email, not a race", () => {
    const justOutside = new Date(now - RACE_WINDOW_MS - 1000).toISOString();
    expect(isProbablyARace(justOutside, now)).toBe(false);
  });

  it("accepts a test send from hours ago instead of burning six retries on it", () => {
    expect(isProbablyARace("2026-09-21T09:00:00.000Z", now)).toBe(false);
  });

  it("accepts when the timestamp is missing or unparseable — absence is not evidence of a race", () => {
    expect(isProbablyARace(undefined, now)).toBe(false);
    expect(isProbablyARace(null, now)).toBe(false);
    expect(isProbablyARace("", now)).toBe(false);
    expect(isProbablyARace("not a date", now)).toBe(false);
  });

  it("does not treat a future timestamp as expired", () => {
    expect(isProbablyARace("2026-09-21T15:16:00.000Z", now)).toBe(true);
  });
});
