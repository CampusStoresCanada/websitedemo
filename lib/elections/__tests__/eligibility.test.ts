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
  it("admits an active member whose renewal is still outstanding", () => {
    const v = evaluateOrgEligibility(org({ membershipExpiresAt: null }), "active_status", AGM);
    expect(v.isEligible).toBe(true);
    expect(v.reasonCode).toBe("eligible_renewal_outstanding");
    expect(v.reason).toMatch(/not yet completed its renewal/);
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

describe("active_status_and_dated_expiry rule (the default)", () => {
  it("rejects an outstanding renewal, and says how to fix it", () => {
    // A store one payment away from eligible must be told that, not handed a
    // verdict it cannot act on.
    const v = evaluateOrgEligibility(
      org({ membershipExpiresAt: null }),
      "active_status_and_dated_expiry",
      AGM
    );
    expect(v.isEligible).toBe(false);
    expect(v.reasonCode).toBe("renewal_outstanding");
    expect(v.reason).toMatch(/Completing the renewal restores eligibility/);
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
  const mixed = (rule: "active_status" | "active_status_and_dated_expiry") => [
    ...Array.from({ length: 33 }, (_, i) =>
      evaluateOrgEligibility(
        org({ organizationId: `unrenewed-${i}`, membershipExpiresAt: null }),
        rule,
        AGM
      )
    ),
    ...Array.from({ length: 19 }, (_, i) =>
      evaluateOrgEligibility(org({ organizationId: `renewed-${i}` }), rule, AGM)
    ),
  ];

  it("separates current members from long-cancelled ones", () => {
    // "19 of 80" reads as a catastrophe; "19 of 52" is the real picture. The
    // other 28 left the association and are not a gap to close.
    const verdicts = [
      ...mixed("active_status_and_dated_expiry"),
      ...Array.from({ length: 28 }, (_, i) =>
        evaluateOrgEligibility(
          org({ organizationId: `gone-${i}`, membershipStatus: "canceled" }),
          "active_status_and_dated_expiry",
          AGM
        )
      ),
    ];
    const s = summarizeEligibility(verdicts);
    expect(s.total).toBe(80);
    expect(s.currentMembers).toBe(52);
    expect(s.notCurrentMembers).toBe(28);
    expect(s.eligible + s.recoverableByRenewing).toBe(s.currentMembers);
  });

  it("counts how many are one renewal away from voting", () => {
    // Mid-renewal-cycle shape as at 2026-08-21. This number IS the electorate
    // and has to be watched, not reported once.
    const s = summarizeEligibility(mixed("active_status_and_dated_expiry"));
    expect(s.total).toBe(52);
    expect(s.eligible).toBe(19);
    expect(s.recoverableByRenewing).toBe(33);
    // Nobody is ineligible for a reason they cannot fix themselves.
    expect(s.ineligible).toBe(s.recoverableByRenewing);
  });

  it("shows what the lenient rule would enfranchise instead", () => {
    const s = summarizeEligibility(mixed("active_status"));
    expect(s.eligible).toBe(52);
    // 33 of those 52 would be voting without having paid for the year.
    expect(s.eligibleOnOutstandingRenewal).toBe(33);
  });
});
