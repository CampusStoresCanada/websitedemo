import { describe, it, expect } from "vitest";
import {
  ORG_ACCESS_ACTIVE_STATUSES,
  PUBLIC_LISTABLE_ORG_STATUSES,
  isOrgAccessActive,
} from "../status";

/**
 * Two different questions that were sharing one constant:
 *   PUBLIC_LISTABLE — does this org appear to the world?
 *   ORG_ACCESS_ACTIVE — is this org a current, entitled member?
 *
 * The partner exports asked the first while meaning the second, so every
 * member in grace was withheld from partners who had paid for that list —
 * 20 of 52 stores on the day it was found, because renewals run Aug–Oct and
 * grace is exactly where a member sits while theirs is in flight.
 */
describe("entitlement is not public listing", () => {
  it("counts a member in grace as entitled", () => {
    expect(isOrgAccessActive("grace")).toBe(true);
    expect(ORG_ACCESS_ACTIVE_STATUSES).toContain("grace");
  });

  it("does not count grace as publicly listable — the two sets differ on purpose", () => {
    expect(PUBLIC_LISTABLE_ORG_STATUSES).not.toContain("grace");
    expect(ORG_ACCESS_ACTIVE_STATUSES).not.toEqual(PUBLIC_LISTABLE_ORG_STATUSES);
  });

  it("still withholds a lapsed org from both", () => {
    for (const status of ["locked", "canceled", "applied", "approved"] as const) {
      expect(ORG_ACCESS_ACTIVE_STATUSES).not.toContain(status);
      expect(PUBLIC_LISTABLE_ORG_STATUSES).not.toContain(status);
      expect(isOrgAccessActive(status)).toBe(false);
    }
  });

  it("keeps isOrgAccessActive and the array as one answer", () => {
    for (const status of ORG_ACCESS_ACTIVE_STATUSES) {
      expect(isOrgAccessActive(status)).toBe(true);
    }
  });
});
