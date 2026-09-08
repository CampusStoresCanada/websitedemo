import { describe, it, expect } from "vitest";
import {
  currentStanding,
  suppressedFromProspects,
  needsReconfirming,
  type RatingRow,
} from "../rating-standing";

const at = (iso: string) => new Date(iso);
const row = (
  memberOrgId: string,
  axis: RatingRow["axis"],
  value: RatingRow["value"],
  ratedAt: string
): RatingRow => ({ memberOrgId, axis, value, ratedAt });

describe("currentStanding", () => {
  it("takes the newest assertion per axis, not the first one stored", () => {
    const rows = [
      row("m1", "fit", "not_a_fit", "2026-01-01T00:00:00Z"),
      row("m1", "fit", "would_approach", "2026-06-01T00:00:00Z"),
    ];
    expect(currentStanding(rows, "m1", at("2026-07-01T00:00:00Z")).fit?.value)
      .toBe("would_approach");
  });

  it("keeps the two axes independent — a fit verdict never answers the relationship", () => {
    const rows = [row("m1", "fit", "not_a_fit", "2026-06-01T00:00:00Z")];
    const s = currentStanding(rows, "m1", at("2026-07-01T00:00:00Z"));
    expect(s.fit?.value).toBe("not_a_fit");
    expect(s.relationship).toBeUndefined();
  });

  it("does not round a partial month up", () => {
    // Said on the 30th, read on the 1st: not yet a month old.
    const rows = [row("m1", "relationship", "is_customer", "2026-01-30T00:00:00Z")];
    expect(currentStanding(rows, "m1", at("2026-02-01T00:00:00Z")).relationship?.ageMonths)
      .toBe(0);
  });
});

describe("decay windows differ by what is being claimed", () => {
  const claimedAt = "2026-01-01T00:00:00Z";

  it("is_customer goes stale at six months — a lost account must not hide a store forever", () => {
    const rows = [row("m1", "relationship", "is_customer", claimedAt)];
    expect(currentStanding(rows, "m1", at("2026-06-15T00:00:00Z")).relationship?.stale).toBe(false);
    expect(currentStanding(rows, "m1", at("2026-07-02T00:00:00Z")).relationship?.stale).toBe(true);
  });

  it("not_a_fit stands far longer — asking twice a year about the same wrong store is nagging", () => {
    const rows = [row("m1", "fit", "not_a_fit", claimedAt)];
    expect(currentStanding(rows, "m1", at("2027-01-02T00:00:00Z")).fit?.stale).toBe(false);
    expect(currentStanding(rows, "m1", at("2027-08-02T00:00:00Z")).fit?.stale).toBe(true);
  });
});

describe("suppressedFromProspects", () => {
  it("hides a store the partner currently sells to", () => {
    const rows = [row("m1", "relationship", "is_customer", "2026-06-01T00:00:00Z")];
    expect(suppressedFromProspects(rows, "m1", at("2026-07-01T00:00:00Z"))).toBe(true);
  });

  it("⛔ brings the store back once the claim goes stale", () => {
    // "We sold to them 8 months ago" is not a reason to keep hiding them; it is
    // a reason to ask whether they still do.
    const rows = [row("m1", "relationship", "is_customer", "2026-01-01T00:00:00Z")];
    expect(suppressedFromProspects(rows, "m1", at("2026-09-01T00:00:00Z"))).toBe(false);
  });

  it("⛔ never suppresses on not_a_fit, however confident", () => {
    // That verdict grades the ENGINE. If it also hid rows, an evaluation label
    // would have become a filter, and nobody could tell whether the engine got
    // better or had simply been told to stop guessing.
    const rows = [row("m1", "fit", "not_a_fit", "2026-06-01T00:00:00Z")];
    expect(suppressedFromProspects(rows, "m1", at("2026-07-01T00:00:00Z"))).toBe(false);
  });

  it("respects an explicit not_customer without hiding anything", () => {
    const rows = [row("m1", "relationship", "not_customer", "2026-06-01T00:00:00Z")];
    expect(suppressedFromProspects(rows, "m1", at("2026-07-01T00:00:00Z"))).toBe(false);
  });
});

describe("needsReconfirming", () => {
  it("returns only faded claims, oldest first, and leaves fresh ones alone", () => {
    const rows = [
      row("old", "relationship", "is_customer", "2025-01-01T00:00:00Z"),
      row("mid", "fit", "wrong_time", "2026-01-01T00:00:00Z"),
      row("new", "fit", "would_approach", "2026-08-01T00:00:00Z"),
    ];
    const out = needsReconfirming(rows, at("2026-09-01T00:00:00Z"));
    expect(out.map((o) => o.memberOrgId)).toEqual(["old", "mid"]);
    expect(out[0].ageMonths).toBeGreaterThan(out[1].ageMonths);
  });

  it("a superseded claim does not resurface on the strength of its old date", () => {
    const rows = [
      row("m1", "relationship", "is_customer", "2025-01-01T00:00:00Z"),
      row("m1", "relationship", "not_customer", "2026-08-01T00:00:00Z"),
    ];
    expect(needsReconfirming(rows, at("2026-09-01T00:00:00Z"))).toEqual([]);
  });
});
