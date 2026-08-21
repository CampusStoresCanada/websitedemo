import { describe, it, expect } from "vitest";
import { CSC_ELECTIONS_CONFIG } from "../config";
import {
  evaluateCosignatures,
  evaluateCandidateEligibility,
  evaluateNominationCompleteness,
} from "../nomination";

const sig = (org: string, contact: string, signed = true) => ({
  organizationId: org,
  contactId: contact,
  signedAt: signed ? "2026-10-01T00:00:00Z" : null,
  revokedAt: null,
});

const MEMBER = { source: "member" as const, nomineeContactId: "nom", nomineeOrganizationId: "org-nom" };

describe("co-signatures", () => {
  it("is satisfied by two distinct institutions", () => {
    const s = evaluateCosignatures([sig("org-1", "c1"), sig("org-2", "c2")], CSC_ELECTIONS_CONFIG, MEMBER);
    expect(s.satisfied).toBe(true);
    expect(s.valid).toBe(2);
  });

  it("does not count two colleagues at the same store as two signatures", () => {
    const s = evaluateCosignatures([sig("org-1", "c1"), sig("org-1", "c2")], CSC_ELECTIONS_CONFIG, MEMBER);
    expect(s.satisfied).toBe(false);
    expect(s.problems.join(" ")).toMatch(/different member institutions/);
  });

  it("ignores unsigned and revoked signatures", () => {
    const revoked = { ...sig("org-2", "c2"), revokedAt: "2026-10-05T00:00:00Z" };
    const s = evaluateCosignatures([sig("org-1", "c1"), sig("org-3", "c3", false), revoked], CSC_ELECTIONS_CONFIG, MEMBER);
    expect(s.valid).toBe(1);
    expect(s.satisfied).toBe(false);
  });

  it("rejects a nominee co-signing themselves", () => {
    const s = evaluateCosignatures([sig("org-nom", "nom"), sig("org-2", "c2")], CSC_ELECTIONS_CONFIG, MEMBER);
    expect(s.problems.join(" ")).toMatch(/cannot co-sign their own/);
  });

  it("exempts the nominating committee's own slate", () => {
    const s = evaluateCosignatures([], CSC_ELECTIONS_CONFIG, {
      ...MEMBER,
      source: "nominating_committee",
    });
    expect(s.required).toBe(0);
    expect(s.satisfied).toBe(true);
  });

  it("surfaces director signatures without treating them as a problem", () => {
    // Every CSC director is also an org admin, so the board can satisfy the
    // two-signature rule among themselves. That is allowed — it just belongs in
    // the audit trail rather than happening invisibly.
    const s = evaluateCosignatures([sig("org-1", "director-a"), sig("org-2", "director-b")], CSC_ELECTIONS_CONFIG, {
      ...MEMBER,
      sittingDirectorContactIds: ["director-a", "director-b"],
    });
    expect(s.satisfied).toBe(true);
    expect(s.signedByDirectors.sort()).toEqual(["director-a", "director-b"]);
    expect(s.problems).toEqual([]);
  });

  it("honours a config that drops the requirement entirely", () => {
    const relaxed = {
      ...CSC_ELECTIONS_CONFIG,
      nominations: { ...CSC_ELECTIONS_CONFIG.nominations, cosignersRequired: 0 },
    };
    expect(evaluateCosignatures([], relaxed, MEMBER).satisfied).toBe(true);
  });
});

describe("candidate eligibility", () => {
  const base = {
    contactId: "c",
    displayName: "Sam Willis",
    organizationId: "org-1",
    isMemberStoreEmployee: true,
    consecutiveTermsServed: 1,
  };

  it("admits an employee under the term cap", () => {
    expect(evaluateCandidateEligibility(base, CSC_ELECTIONS_CONFIG).eligible).toBe(true);
  });

  it("blocks a non-employee of a member store", () => {
    const r = evaluateCandidateEligibility({ ...base, isMemberStoreEmployee: false }, CSC_ELECTIONS_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.blocking.join(" ")).toMatch(/not recorded as an employee/);
  });

  it("blocks at the three-consecutive-term cap", () => {
    const r = evaluateCandidateEligibility({ ...base, consecutiveTermsServed: 3 }, CSC_ELECTIONS_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.blocking.join(" ")).toMatch(/limit of 3/);
  });

  it("reports missing term history as unverifiable rather than passing it", () => {
    // No term history exists in the database today. Returning "eligible" from
    // absent data is how an ineligible candidate reaches a ballot.
    const r = evaluateCandidateEligibility({ ...base, consecutiveTermsServed: null }, CSC_ELECTIONS_CONFIG);
    expect(r.blocking).toEqual([]);
    expect(r.unverifiable.join(" ")).toMatch(/cannot be checked/);
  });

  it("skips the cap when config disables it", () => {
    const noCap = {
      ...CSC_ELECTIONS_CONFIG,
      candidacy: { ...CSC_ELECTIONS_CONFIG.candidacy, maxConsecutiveTerms: null },
    };
    const r = evaluateCandidateEligibility({ ...base, consecutiveTermsServed: null }, noCap);
    expect(r.unverifiable).toEqual([]);
    expect(r.eligible).toBe(true);
  });
});

describe("completeness", () => {
  const cosigs = evaluateCosignatures([sig("org-1", "c1"), sig("org-2", "c2")], CSC_ELECTIONS_CONFIG, MEMBER);
  const candidate = { eligible: true, blocking: [], unverifiable: [] };
  const complete = {
    candidateAcceptedAt: "2026-10-02T00:00:00Z",
    candidateDeclinedAt: null,
    storePermissionGrantedAt: "2026-10-03T00:00:00Z",
    withdrawnAt: null,
    bio: "Twenty years in campus retail.",
    platform: "Focus on shared procurement.",
  };

  it("passes a fully assembled nomination", () => {
    expect(evaluateNominationCompleteness(complete, cosigs, candidate, CSC_ELECTIONS_CONFIG).complete).toBe(true);
  });

  it("treats acceptance and store permission as two separate consents", () => {
    const r = evaluateNominationCompleteness(
      { ...complete, storePermissionGrantedAt: null },
      cosigs,
      candidate,
      CSC_ELECTIONS_CONFIG
    );
    expect(r.complete).toBe(false);
    expect(r.missing.join(" ")).toMatch(/has not yet granted permission/);
  });

  it("requires a bio and a statement", () => {
    const r = evaluateNominationCompleteness(
      { ...complete, bio: "   ", platform: null },
      cosigs,
      candidate,
      CSC_ELECTIONS_CONFIG
    );
    expect(r.missing.join(" ")).toMatch(/biography is required/);
    expect(r.missing.join(" ")).toMatch(/statement is required/);
  });

  it("blocks on unverifiable term history, not just on failures", () => {
    const r = evaluateNominationCompleteness(
      complete,
      cosigs,
      { eligible: true, blocking: [], unverifiable: ["Term history missing."] },
      CSC_ELECTIONS_CONFIG
    );
    expect(r.complete).toBe(false);
  });
});
