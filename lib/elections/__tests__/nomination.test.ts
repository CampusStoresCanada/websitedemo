import { describe, it, expect } from "vitest";
import { CSC_ELECTIONS_CONFIG } from "../config";
import {
  evaluateCosignatures,
  evaluateCandidateEligibility,
  evaluateNominationCompleteness,
  resolveBoardInvitations,
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

  it("blocks at the consecutive-term cap", () => {
    const r = evaluateCandidateEligibility({ ...base, consecutiveTermsServed: 4 }, CSC_ELECTIONS_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.blocking.join(" ")).toMatch(/limit of 4/);
  });

  it("is the cap, not the document, that decides whether a three-term director may stand", () => {
    // The live stake of the two disagreeing by-law copies. Shannon Blackadder
    // and Jason Kack have each served three consecutive terms and are both up
    // in 2027: eligible under the "(Final)" copy's four, barred under three.
    const threeTermer = { ...base, displayName: "Three-term director", consecutiveTermsServed: 3 };
    const capFour = CSC_ELECTIONS_CONFIG;
    const capThree = {
      ...CSC_ELECTIONS_CONFIG,
      candidacy: { ...CSC_ELECTIONS_CONFIG.candidacy, maxConsecutiveTerms: 3 },
    };
    expect(evaluateCandidateEligibility(threeTermer, capFour).eligible).toBe(true);
    expect(evaluateCandidateEligibility(threeTermer, capThree).eligible).toBe(false);
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

describe("a store in its grace period", () => {
  const inGrace = {
    contactId: "c",
    displayName: "Sam Willis",
    organizationId: "org-1",
    // Still a member: may be nominated, may co-sign.
    isMemberStoreEmployee: true,
    // Has not renewed for the year that covers the meeting.
    institutionRenewedThroughAgm: false,
    renewalReason:
      "Lakeland College's membership expires 2026-08-31, before the AGM on 2027-01-21. Renewing for the coming year restores eligibility immediately.",
    consecutiveTermsServed: 1,
  };

  it("can be nominated, but is kept off the ballot", () => {
    // The rule the board actually set: nominate in grace, yes; on the ballot,
    // only once renewed. Blocking rather than unverifiable — it is a known fact
    // with a known fix and a known deadline.
    const r = evaluateCandidateEligibility(inGrace, CSC_ELECTIONS_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.blocking.join(" ")).toMatch(/expires 2026-08-31/);
    expect(r.unverifiable).toEqual([]);
  });

  it("shows up on the committee's chase list with the reason", () => {
    const cosigs = evaluateCosignatures(
      [sig("org-1", "c1"), sig("org-2", "c2")],
      CSC_ELECTIONS_CONFIG,
      MEMBER
    );
    const r = evaluateNominationCompleteness(
      {
        candidateAcceptedAt: "2026-10-02T00:00:00Z",
        candidateDeclinedAt: null,
        storePermissionGrantedAt: "2026-10-03T00:00:00Z",
        withdrawnAt: null,
        bio: "Twenty years in campus retail.",
        platform: "Shared procurement.",
      },
      cosigs,
      evaluateCandidateEligibility(inGrace, CSC_ELECTIONS_CONFIG),
      CSC_ELECTIONS_CONFIG
    );
    expect(r.complete).toBe(false);
    expect(r.missing.join(" ")).toMatch(/Renewing for the coming year/);
  });

  it("clears the moment the renewal lands", () => {
    const renewed = { ...inGrace, institutionRenewedThroughAgm: true, renewalReason: null };
    expect(evaluateCandidateEligibility(renewed, CSC_ELECTIONS_CONFIG).eligible).toBe(true);
  });

  it("is not checked at all when the caller does not distinguish the two", () => {
    const { institutionRenewedThroughAgm, renewalReason, ...unaware } = inGrace;
    void institutionRenewedThroughAgm;
    void renewalReason;
    expect(evaluateCandidateEligibility(unaware, CSC_ELECTIONS_CONFIG).eligible).toBe(true);
  });
});

describe("resolveBoardInvitations — fanning the ask out to the board", () => {
  const board = [
    { contactId: "d1", organizationId: "org-a" },
    { contactId: "d2", organizationId: "org-b" },
    { contactId: "d3", organizationId: "org-c" },
  ];

  it("invites every director at another institution", () => {
    const out = resolveBoardInvitations(board, [], {
      contactId: "nom",
      organizationId: "org-z",
    });
    expect(out.map((d) => d.contactId)).toEqual(["d1", "d2", "d3"]);
  });

  it("skips a director at the nominee's own store", () => {
    // S2(c) wants the two co-signatures from institutions other than the one
    // already putting the name forward.
    const out = resolveBoardInvitations(board, [], {
      contactId: "nom",
      organizationId: "org-b",
    });
    expect(out.map((d) => d.contactId)).toEqual(["d1", "d3"]);
  });

  it("skips the nominee when the nominee is a sitting director", () => {
    const out = resolveBoardInvitations(board, [], {
      contactId: "d2",
      organizationId: "org-z",
    });
    expect(out.map((d) => d.contactId)).toEqual(["d1", "d3"]);
  });

  it("does not ask someone twice who was already invited directly", () => {
    const out = resolveBoardInvitations(board, [{ contactId: "d1" }], {
      contactId: "nom",
      organizationId: "org-z",
    });
    expect(out.map((d) => d.contactId)).toEqual(["d2", "d3"]);
  });

  it("ignores directors with no contact or no store on record", () => {
    const out = resolveBoardInvitations(
      [{ contactId: "", organizationId: "org-a" }, { contactId: "d9", organizationId: "" }],
      [],
      { contactId: "nom", organizationId: "org-z" }
    );
    expect(out).toEqual([]);
  });

  it("returns nothing when the whole board sits at the nominee's store", () => {
    // Then the ask genuinely cannot be fanned out, and the caller is left with
    // whatever direct invitations it had — not a false sense of coverage.
    const sameStore = board.map((d) => ({ ...d, organizationId: "org-a" }));
    expect(
      resolveBoardInvitations(sameStore, [], { contactId: "nom", organizationId: "org-a" })
    ).toEqual([]);
  });
});
