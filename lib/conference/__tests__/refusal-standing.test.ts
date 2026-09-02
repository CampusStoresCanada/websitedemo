import { describe, it, expect } from "vitest";
import {
  holdsThisCycle,
  enforcedPairs,
  awaitingAnswer,
  type RefusalRow,
} from "../refusal-standing";

/** This year's ask went out ahead of the conference. */
const ASKED = new Date("2026-08-01T00:00:00Z");

const at = (iso: string) => new Date(iso).toISOString();

const row = (over: Partial<RefusalRow> = {}): RefusalRow => ({
  declaring_org_id: "member",
  refused_org_id: "vendor",
  first_declared_at: at("2026-08-15T00:00:00Z"),
  ...over,
});

describe("holdsThisCycle", () => {
  it("holds when they answered this year's ask", () => {
    expect(holdsThisCycle(row(), ASKED)).toBe(true);
  });

  it("holds when an old blackout was re-affirmed this year", () => {
    expect(
      holdsThisCycle(
        row({ first_declared_at: at("2023-01-01"), reaffirmed_at: at("2026-08-20") }),
        ASKED
      )
    ).toBe(true);
  });

  it("⛔ does NOT hold when last year's blackout was never renewed", () => {
    // This is the point, not an oversight. Not mentioning it again is how a
    // relationship recovers, and it is the only way most of them ever will —
    // nobody writes in to announce a grudge is over.
    expect(holdsThisCycle(row({ first_declared_at: at("2025-08-15") }), ASKED)).toBe(false);
  });

  it("does not hold once withdrawn, however recently stated", () => {
    expect(holdsThisCycle(row({ retired_at: at("2026-08-20") }), ASKED)).toBe(false);
  });

  it("counts an answer given exactly at the ask", () => {
    expect(holdsThisCycle(row({ first_declared_at: ASKED.toISOString() }), ASKED)).toBe(true);
  });
});

describe("enforcedPairs", () => {
  it("returns only what must be removed before scoring", () => {
    const rows = [
      row({ refused_org_id: "renewed", first_declared_at: at("2020-01-01"), reaffirmed_at: at("2026-08-10") }),
      row({ refused_org_id: "fresh" }),
      row({ refused_org_id: "stale", first_declared_at: at("2025-08-15") }),
      row({ refused_org_id: "withdrawn", retired_at: at("2026-08-20") }),
    ];
    expect(enforcedPairs(rows, ASKED).map((p) => p.refusedOrgId)).toEqual(["renewed", "fresh"]);
  });

  it("is one-directional — A refusing B is not B refusing A", () => {
    const pairs = enforcedPairs([row({ declaring_org_id: "a", refused_org_id: "b" })], ASKED);
    expect(pairs).toEqual([{ declaringOrgId: "a", refusedOrgId: "b" }]);
  });
});

describe("awaitingAnswer", () => {
  it("lists orgs with an old blackout that have not replied", () => {
    // Distinguishes "said no blackouts" from "has not replied yet", which the
    // filter alone cannot show.
    const rows = [
      row({ declaring_org_id: "quiet", first_declared_at: at("2025-08-15") }),
      row({ declaring_org_id: "answered", first_declared_at: at("2026-08-15") }),
    ];
    expect(awaitingAnswer(rows, ASKED)).toEqual(["quiet"]);
  });

  it("does not chase an org that answered about any of its blackouts", () => {
    // One answer covers the question; it was "any blackouts?", not per-pair.
    const rows = [
      row({ declaring_org_id: "org", refused_org_id: "old", first_declared_at: at("2025-01-01") }),
      row({ declaring_org_id: "org", refused_org_id: "new", first_declared_at: at("2026-08-15") }),
    ];
    expect(awaitingAnswer(rows, ASKED)).toEqual([]);
  });

  it("does not chase an org that withdrew rather than went quiet", () => {
    const rows = [row({ declaring_org_id: "org", first_declared_at: at("2025-01-01"), retired_at: at("2025-06-01") })];
    expect(awaitingAnswer(rows, ASKED)).toEqual([]);
  });
});
