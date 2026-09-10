import { describe, it, expect } from "vitest";
import {
  ORG_ACCESS_ACTIVE_STATUSES,
  PUBLIC_LISTABLE_ORG_STATUSES,
  isOrgAccessActive,
  isOrgPubliclyListable,
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

  it("⛔ lists a grace org publicly — mid-renewal is not lapsed", () => {
    // Changed 2026-09-10. This test previously asserted the OPPOSITE, as the way
    // it encoded "the two questions are separate". The separation is real and
    // still enforced below; excluding grace from the directory was never the
    // point of it, and it was quietly wrong.
    //
    // ⚠️ How it surfaced: searching "Calculators" on /partners ranked Randmar
    // FIRST in the search API, then rendered a page with no Randmar on it — the
    // page loads only publicly-listable orgs, and Randmar is in grace. Nothing
    // errored. 29 of 75 partners and 20 of 52 member stores were missing from the
    // public directory for the same reason, every autumn, while renewals ran.
    expect(PUBLIC_LISTABLE_ORG_STATUSES).toContain("grace");
    expect(isOrgPubliclyListable("grace")).toBe(true);
  });

  it("keeps the two questions as separate constants even where they agree", () => {
    // ⛔ The real protection, and the reason the old assertion existed. These now
    // agree on grace, which is exactly when someone is tempted to delete one and
    // point both call sites at the other. They answer different questions and
    // will diverge again — `reactivated` and `locked` are where they will differ
    // next — so they must stay independently editable.
    expect(PUBLIC_LISTABLE_ORG_STATUSES).not.toBe(ORG_ACCESS_ACTIVE_STATUSES);
    for (const s of ORG_ACCESS_ACTIVE_STATUSES) expect(isOrgAccessActive(s)).toBe(true);
    for (const s of PUBLIC_LISTABLE_ORG_STATUSES) expect(isOrgPubliclyListable(s)).toBe(true);
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
