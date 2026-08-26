import { describe, expect, it } from "vitest";
import { isInRsvpSyncWindow } from "../event-sync";

/**
 * This window is the only thing bounding the hourly RSVP cron's Circle calls.
 * Without it the loop re-read the attendee list of every event ever synced,
 * forever — ~1,000 calls a day for RSVPs that could no longer change.
 */
describe("isInRsvpSyncWindow", () => {
  const now = Date.parse("2026-08-26T12:00:00Z");
  const at = (iso: string) => ({ starts_at: iso, ends_at: iso });

  it("syncs an event happening now", () => {
    expect(isInRsvpSyncWindow(at("2026-08-26T11:00:00Z"), now)).toBe(true);
  });

  it("keeps syncing for a day after the event ends", () => {
    expect(isInRsvpSyncWindow(at("2026-08-25T23:00:00Z"), now)).toBe(true);
  });

  it("drops the event once the trailing day is up", () => {
    expect(isInRsvpSyncWindow(at("2026-08-25T11:00:00Z"), now)).toBe(false);
  });

  it("drops events far in the past — the case that caused the leak", () => {
    expect(isInRsvpSyncWindow(at("2025-11-02T04:59:00Z"), now)).toBe(false);
  });

  it("picks an event up 60 days before it starts, not sooner", () => {
    expect(isInRsvpSyncWindow(at("2026-10-20T12:00:00Z"), now)).toBe(true);
    expect(isInRsvpSyncWindow(at("2026-12-01T12:00:00Z"), now)).toBe(false);
  });

  it("falls back to starts_at when ends_at is missing", () => {
    expect(
      isInRsvpSyncWindow({ starts_at: "2026-08-26T11:00:00Z", ends_at: null }, now)
    ).toBe(true);
    expect(
      isInRsvpSyncWindow({ starts_at: "2025-11-02T04:59:00Z", ends_at: null }, now)
    ).toBe(false);
  });

  it("fails open on an undated event rather than silently dropping it", () => {
    expect(isInRsvpSyncWindow({ starts_at: null, ends_at: null }, now)).toBe(true);
  });

  it("reads a zone-less Supabase timestamp as UTC, not server-local", () => {
    // Bare "2026-08-26 11:00:00" must not shift by the runtime's offset.
    expect(isInRsvpSyncWindow(at("2026-08-26 11:00:00"), now)).toBe(true);
  });

  it("fails open on an unparseable timestamp", () => {
    expect(isInRsvpSyncWindow(at("not a date"), now)).toBe(true);
  });
});
