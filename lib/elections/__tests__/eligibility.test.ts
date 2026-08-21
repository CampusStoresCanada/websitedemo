import { describe, it, expect } from "vitest";
import {
  evaluateOrgEligibility,
  expiryCoversAgm,
  summarizeEligibility,
  type OrgEligibilityFacts,
} from "../eligibility";

const AGM = "2027-01-20";

const org = (over: Partial<OrgEligibilityFacts> = {}): OrgEligibilityFacts => ({
  organizationId: "org-1",
  name: "Test University",
  membershipStatus: "active",
  membershipExpiresAt: "2027-08-31",
  isVotingProgram: true,
  ...over,
});

describe("expiryCoversAgm", () => {
  it("is tri-state — null means unknown, not lapsed", () => {
    expect(expiryCoversAgm(null, AGM)).toBeNull();
    expect(expiryCoversAgm("2027-08-31", AGM)).toBe(true);
    expect(expiryCoversAgm("2026-12-01", AGM)).toBe(false);
  });

  it("tolerates a timestamp, not just a date", () => {
    expect(expiryCoversAgm("2027-08-31 00:00:00", AGM)).toBe(true);
  });
});

describe("active_status rule", () => {
  it("admits an active member with no recorded expiry", () => {
    // This is the case that matters: 33 of CSC's 52 active member stores have
    // no expiry on record. The conference purchase gate rejects all of them.
    const v = evaluateOrgEligibility(org({ membershipExpiresAt: null }), "active_status", AGM);
    expect(v.isEligible).toBe(true);
    expect(v.reasonCode).toBe("eligible_expiry_unknown");
    expect(v.reason).toMatch(/could not be confirmed/);
  });

  it("admits grace and reactivated", () => {
    for (const status of ["active", "grace", "reactivated"]) {
      expect(evaluateOrgEligibility(org({ membershipStatus: status }), "active_status", AGM).isEligible).toBe(true);
    }
  });

  it("rejects locked, canceled, and unknown", () => {
    for (const status of ["locked", "canceled", "applied", null]) {
      const v = evaluateOrgEligibility(org({ membershipStatus: status }), "active_status", AGM);
      expect(v.isEligible).toBe(false);
      expect(v.reasonCode).toBe("membership_not_active");
    }
  });

  it("rejects a non-voting program regardless of status", () => {
    const v = evaluateOrgEligibility(org({ isVotingProgram: false }), "active_status", AGM);
    expect(v.isEligible).toBe(false);
    expect(v.reasonCode).toBe("not_a_voting_program");
  });
});

describe("active_status_and_dated_expiry rule", () => {
  it("rejects a missing expiry, and says it is a data gap not a lapse", () => {
    const v = evaluateOrgEligibility(
      org({ membershipExpiresAt: null }),
      "active_status_and_dated_expiry",
      AGM
    );
    expect(v.isEligible).toBe(false);
    expect(v.reason).toMatch(/data gap, not a lapse/);
  });

  it("rejects an expiry that lands before the AGM", () => {
    const v = evaluateOrgEligibility(
      org({ membershipExpiresAt: "2026-12-31" }),
      "active_status_and_dated_expiry",
      AGM
    );
    expect(v.reasonCode).toBe("membership_expires_before_agm");
  });

  it("admits an expiry that covers the AGM", () => {
    expect(
      evaluateOrgEligibility(org(), "active_status_and_dated_expiry", AGM).isEligible
    ).toBe(true);
  });
});

describe("summary", () => {
  it("reports how many verdicts the strict rule would flip", () => {
    const verdicts = [
      ...Array.from({ length: 33 }, (_, i) =>
        evaluateOrgEligibility(
          org({ organizationId: `null-${i}`, membershipExpiresAt: null }),
          "active_status",
          AGM
        )
      ),
      ...Array.from({ length: 19 }, (_, i) =>
        evaluateOrgEligibility(org({ organizationId: `dated-${i}` }), "active_status", AGM)
      ),
    ];
    const s = summarizeEligibility(verdicts);
    expect(s.total).toBe(52);
    expect(s.eligible).toBe(52);
    // The number that has to be on screen before anyone picks a rule.
    expect(s.wouldFailStrictRule).toBe(33);
  });
});
