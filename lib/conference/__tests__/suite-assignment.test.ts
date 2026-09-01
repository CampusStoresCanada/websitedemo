import { describe, expect, it } from "vitest";

import { buildSuiteOrgAssignmentsBySuiteId, reservedSuiteIds } from "../suite-assignment";

/**
 * The "one org, one suite" rule is GONE, by the ED's ruling (2026-09-01):
 * a second suite buys throughput, not time. Ookami Promo bought booths 200 and
 * 202 and may run both — they just cannot meet the same person twice, which the
 * solver enforces as DUPLICATE_EXHIBITOR_ORG, keyed by delegate → organization
 * across every assignment regardless of suite.
 *
 * What replaces it is the reservation below: a room you bought stays yours.
 */
describe("reservedSuiteIds", () => {
  it("reserves every suite that has a holder", () => {
    expect(reservedSuiteIds({ s1: "org-a", s2: "org-b" })).toEqual(new Set(["s1", "s2"]));
  });

  it("reserves BOTH suites when one org holds two", () => {
    // The case that used to be a hard error. Ookami's second room is still
    // theirs — it must never fall into the free-fill pool.
    expect(reservedSuiteIds({ s1: "org-a", s2: "org-a" })).toEqual(new Set(["s1", "s2"]));
  });

  it("leaves an unsold suite free to be filled", () => {
    expect(reservedSuiteIds({})).toEqual(new Set());
  });
});

describe("buildSuiteOrgAssignmentsBySuiteId", () => {
  it("keys the assignment map by suite id, not suite number", () => {
    const suites = [
      { id: "s1", suite_number: 1 },
      { id: "s2", suite_number: 2 },
    ];
    const byNumber = { "1": "org-a", "2": "org-b" };

    expect(buildSuiteOrgAssignmentsBySuiteId(suites, byNumber)).toEqual({
      s1: "org-a",
      s2: "org-b",
    });
  });

  it("omits suites with no assignment", () => {
    const suites = [{ id: "s1", suite_number: 1 }];
    expect(buildSuiteOrgAssignmentsBySuiteId(suites, {})).toEqual({});
  });
});
