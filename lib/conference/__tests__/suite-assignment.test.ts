import { describe, expect, it } from "vitest";

import { buildSuiteOrgAssignmentsBySuiteId } from "../suite-assignment";

/**
 * "One org, one suite" is GONE (ED, 2026-09-01): a second suite buys throughput,
 * not time — Ookami Promo bought booths 200 and 202 and may run both. The limit
 * that matters, no delegate meeting the same org twice, is enforced in the
 * solver as DUPLICATE_EXHIBITOR_ORG.
 *
 * `reservedSuiteIds` is gone too, subsumed: with the free-fill deleted, a suite
 * is only ever reached through a pin and pins come only from holders, so no
 * exhibitor can land in a room they do not hold. That rule is tested where it
 * now lives — lib/scheduler/__tests__/generate.test.ts.
 */
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
