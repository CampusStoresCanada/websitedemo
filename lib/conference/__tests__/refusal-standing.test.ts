import { describe, it, expect } from "vitest";
import {
  holdsThisCycle,
  enforcedPairs,
  awaitingAnswer,
  annualWindow,
  type RefusalRow,
} from "../refusal-standing";

/** This year's ask, ahead of the 2027 conference. */
const ASKED = new Date("2026-08-01T00:00:00Z");
const WINDOW = annualWindow(ASKED); // survives 2 missed asks

const at = (iso: string) => new Date(iso).toISOString();
const row = (over: Partial<RefusalRow> = {}): RefusalRow => ({
  declaring_org_id: "member",
  refused_org_id: "vendor",
  first_declared_at: at("2026-08-15T00:00:00Z"),
  ...over,
});

describe("annualWindow", () => {
  it("honours statements back through the grace period", () => {
    expect(WINDOW.askedAt).toEqual(ASKED);
    expect(WINDOW.honourSince.getUTCFullYear()).toBe(2023);
  });

  it("tightens when grace is reduced", () => {
    expect(annualWindow(ASKED, 0).honourSince.getUTCFullYear()).toBe(2025);
  });
});

describe("holdsThisCycle", () => {
  it("holds when they answered this year", () => {
    expect(holdsThisCycle(row(), WINDOW)).toBe(true);
  });

  it("⛔ still holds when they simply ignored the question", () => {
    // "Humans are exceptional at ignoring annoyances." A missed answer usually
    // means the form went unread, not that the relationship healed.
    expect(holdsThisCycle(row({ first_declared_at: at("2025-08-15") }), WINDOW)).toBe(true);
    expect(holdsThisCycle(row({ first_declared_at: at("2024-08-15") }), WINDOW)).toBe(true);
  });

  it("fades only after several ignored asks", () => {
    // Not mentioning it again is how a relationship recovers — but it takes
    // years of silence, not one skipped form.
    expect(holdsThisCycle(row({ first_declared_at: at("2022-08-15") }), WINDOW)).toBe(false);
  });

  it("errs toward holding — the costs are not symmetric", () => {
    // Holding a stale blackout costs one meeting. Dropping a live one puts
    // somebody in a small room with the person they refused to meet.
    const borderline = row({ first_declared_at: at("2023-08-15") });
    expect(holdsThisCycle(borderline, WINDOW)).toBe(true);
  });

  it("drops immediately when a human withdraws it", () => {
    expect(holdsThisCycle(row({ retired_at: at("2026-08-20") }), WINDOW)).toBe(false);
  });

  it("resets on re-affirmation", () => {
    expect(
      holdsThisCycle(row({ first_declared_at: at("2015-01-01"), reaffirmed_at: at("2026-08-20") }), WINDOW)
    ).toBe(true);
  });
});

describe("enforcedPairs", () => {
  it("returns only what must be removed before scoring", () => {
    const rows = [
      row({ refused_org_id: "answered" }),
      row({ refused_org_id: "silent-but-recent", first_declared_at: at("2025-08-15") }),
      row({ refused_org_id: "faded", first_declared_at: at("2021-08-15") }),
      row({ refused_org_id: "withdrawn", retired_at: at("2026-08-20") }),
    ];
    expect(enforcedPairs(rows, WINDOW).map((p) => p.refusedOrgId)).toEqual([
      "answered",
      "silent-but-recent",
    ]);
  });

  it("is one-directional — A refusing B is not B refusing A", () => {
    expect(enforcedPairs([row({ declaring_org_id: "a", refused_org_id: "b" })], WINDOW)).toEqual([
      { declaringOrgId: "a", refusedOrgId: "b" },
    ]);
  });
});

describe("awaitingAnswer", () => {
  it("⚠️ lists orgs whose blackout IS still enforced but who have not replied", () => {
    // The filter cannot show this difference: enforced-and-answered looks
    // identical to enforced-but-silent until the grace quietly runs out.
    const rows = [
      row({ declaring_org_id: "quiet", first_declared_at: at("2025-08-15") }),
      row({ declaring_org_id: "answered", first_declared_at: at("2026-08-15") }),
    ];
    expect(awaitingAnswer(rows, WINDOW)).toEqual(["quiet"]);
    expect(enforcedPairs(rows, WINDOW)).toHaveLength(2);
  });

  it("one answer covers the org — the question was 'any blackouts?', not per-pair", () => {
    const rows = [
      row({ declaring_org_id: "org", refused_org_id: "old", first_declared_at: at("2024-01-01") }),
      row({ declaring_org_id: "org", refused_org_id: "new", first_declared_at: at("2026-08-15") }),
    ];
    expect(awaitingAnswer(rows, WINDOW)).toEqual([]);
  });

  it("does not chase an org that withdrew rather than went quiet", () => {
    const rows = [row({ declaring_org_id: "org", first_declared_at: at("2024-01-01"), retired_at: at("2024-06-01") })];
    expect(awaitingAnswer(rows, WINDOW)).toEqual([]);
  });
});
