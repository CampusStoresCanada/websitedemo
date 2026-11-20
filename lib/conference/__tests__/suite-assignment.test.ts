import { describe, expect, it } from "vitest";

import { buildSuiteOrgAssignmentsBySuiteId, pinSuiteExhibitors } from "../suite-assignment";

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

describe("pinSuiteExhibitors", () => {
  const seat = (registrationId: string, organizationId: string, userId = "") => ({
    registrationId,
    organizationId,
    userId,
  });

  it("ties a suite to the company's named seat, not whichever seat comes first", () => {
    const suites = [{ id: "s1", suite_number: 100 }];
    const { pinnedSeatBySuiteId, schedulable } = pinSuiteExhibitors(suites, { s1: "org-a" }, [
      seat("a-unnamed", "org-a"),
      seat("z-named", "org-a", "user-1"),
    ]);
    expect(pinnedSeatBySuiteId).toEqual({ s1: "z-named" });
    // The other staff seat has no room of its own, so it is not scheduled.
    expect(schedulable.map((e) => e.registrationId)).toEqual(["z-named"]);
  });

  it("lets an unnamed seat stand in for a company that has named nobody", () => {
    const { pinnedSeatBySuiteId } = pinSuiteExhibitors(
      [{ id: "s1", suite_number: 100 }],
      { s1: "org-a" },
      [seat("b", "org-a"), seat("a", "org-a")]
    );
    expect(pinnedSeatBySuiteId).toEqual({ s1: "a" });
  });

  it("gives two suites two different seats, and leaves a room empty rather than reuse one", () => {
    const suites = [
      { id: "s1", suite_number: 200 },
      { id: "s2", suite_number: 202 },
      { id: "s3", suite_number: 204 },
    ];
    const held = { s1: "org-a", s2: "org-a", s3: "org-b" };
    const two = pinSuiteExhibitors(suites, held, [seat("a1", "org-a"), seat("a2", "org-a"), seat("c1", "org-c")]);
    expect(two.pinnedSeatBySuiteId).toEqual({ s1: "a1", s2: "a2" });
    // org-c holds no suite: no meetings. org-b has no seat: its room stays empty.
    expect(two.schedulable.map((e) => e.registrationId)).toEqual(["a1", "a2"]);

    const one = pinSuiteExhibitors(suites, held, [seat("a1", "org-a")]);
    expect(one.pinnedSeatBySuiteId).toEqual({ s1: "a1" });
  });
});
