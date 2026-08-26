import { describe, expect, it } from "vitest";
import {
  evaluateProxyholder,
  isProxyValidForMeeting,
  requiresSignedDocument,
  type ProxyGrantorFacts,
  type ProxyPersonFacts,
} from "../proxy";

/**
 * By-Law No. 1 Part VII S7. The rule these pin is narrow and easy to widen by
 * accident: a proxyholder is EITHER an employee of the appointing store OR the
 * primary contact of another member store. "Any member may carry any member's
 * vote" is the wrong rule and is what this file exists to prevent.
 */

const memberStore = (id: string): ProxyGrantorFacts => ({
  organizationId: id,
  organizationType: "Member",
  organizationMembershipStatus: "active",
});

function person(over: Partial<ProxyPersonFacts> = {}): ProxyPersonFacts {
  return {
    contactId: "c1",
    name: "Sam Reader",
    organizationId: "org-a",
    organizationType: "Member",
    organizationMembershipStatus: "active",
    isPrimaryContact: false,
    active: true,
    ...over,
  };
}

describe("evaluateProxyholder — route 1, own store", () => {
  it("accepts any employee of the appointing store, primary or not", () => {
    const r = evaluateProxyholder(memberStore("org-a"), person({ organizationId: "org-a", isPrimaryContact: false }));
    expect(r.eligible).toBe(true);
    expect(r.route).toBe("own_store");
  });

  it("still accepts them when they are also the primary contact", () => {
    const r = evaluateProxyholder(memberStore("org-a"), person({ organizationId: "org-a", isPrimaryContact: true }));
    expect(r.eligible).toBe(true);
    expect(r.route).toBe("own_store");
  });
});

describe("evaluateProxyholder — route 2, another member store", () => {
  it("accepts the primary contact of a different member store", () => {
    const r = evaluateProxyholder(memberStore("org-a"), person({ organizationId: "org-b", isPrimaryContact: true }));
    expect(r.eligible).toBe(true);
    expect(r.route).toBe("other_primary");
  });

  it("REFUSES an ordinary employee of another member store", () => {
    // The whole point of S7. A store's staff cannot carry another store's vote;
    // only its designated primary contact can.
    const r = evaluateProxyholder(memberStore("org-a"), person({ organizationId: "org-b", isPrimaryContact: false }));
    expect(r.eligible).toBe(false);
    expect(r.refusal).toBe("other_store_contact_not_primary");
  });

  it("refuses a vendor partner's primary contact", () => {
    const r = evaluateProxyholder(
      memberStore("org-a"),
      person({ organizationId: "org-v", organizationType: "Vendor Partner", isPrimaryContact: true })
    );
    expect(r.eligible).toBe(false);
    expect(r.refusal).toBe("other_store_not_a_member_store");
  });

  it("refuses the primary contact of a lapsed member store", () => {
    const r = evaluateProxyholder(
      memberStore("org-a"),
      person({ organizationId: "org-b", organizationMembershipStatus: "grace", isPrimaryContact: true })
    );
    expect(r.eligible).toBe(false);
    expect(r.refusal).toBe("other_store_not_in_good_standing");
  });
});

describe("evaluateProxyholder — the appointing store", () => {
  it("refuses a vendor partner trying to appoint anyone", () => {
    const grantor: ProxyGrantorFacts = {
      organizationId: "org-v",
      organizationType: "Vendor Partner",
      organizationMembershipStatus: "active",
    };
    const r = evaluateProxyholder(grantor, person({ organizationId: "org-v" }));
    expect(r.eligible).toBe(false);
    expect(r.refusal).toBe("grantor_not_a_member_store");
  });

  it("refuses a member store whose membership is not current", () => {
    // No vote to assign. Same line eligibility.ts draws for the ballot.
    const grantor: ProxyGrantorFacts = {
      organizationId: "org-a",
      organizationType: "Member",
      organizationMembershipStatus: "grace",
    };
    const r = evaluateProxyholder(grantor, person({ organizationId: "org-a" }));
    expect(r.eligible).toBe(false);
    expect(r.refusal).toBe("grantor_not_in_good_standing");
  });

  it("accepts 'reactivated' as good standing", () => {
    const grantor: ProxyGrantorFacts = {
      organizationId: "org-a",
      organizationType: "Member",
      organizationMembershipStatus: "reactivated",
    };
    expect(evaluateProxyholder(grantor, person({ organizationId: "org-a" })).eligible).toBe(true);
  });

  it("matches organizations.type case-insensitively", () => {
    // The column is capitalised ("Member"); a lowercase comparison would refuse
    // every appointment with a misleading message rather than erroring.
    const grantor: ProxyGrantorFacts = {
      organizationId: "org-a",
      organizationType: "member",
      organizationMembershipStatus: "active",
    };
    expect(evaluateProxyholder(grantor, person({ organizationId: "org-a" })).eligible).toBe(true);
  });
});

describe("evaluateProxyholder — refusals that are not about the store", () => {
  it("refuses an archived contact", () => {
    const r = evaluateProxyholder(memberStore("org-a"), person({ organizationId: "org-a", active: false }));
    expect(r.refusal).toBe("proxyholder_inactive");
  });

  it("refuses a contact with no organization", () => {
    const r = evaluateProxyholder(memberStore("org-a"), person({ organizationId: null }));
    expect(r.refusal).toBe("proxyholder_has_no_organization");
  });

  it("always gives a reason that states the rule", () => {
    const r = evaluateProxyholder(memberStore("org-a"), person({ organizationId: "org-b", isPrimaryContact: false }));
    expect(r.reason).toMatch(/primary contact/i);
    expect(r.reason.length).toBeGreaterThan(20);
  });
});

describe("isProxyValidForMeeting — S7(c), one meeting only", () => {
  it("is valid for the meeting it was given for", () => {
    expect(isProxyValidForMeeting({ meetingId: "m1", revokedAt: null }, "m1")).toBe(true);
  });

  it("is NOT valid for a different meeting", () => {
    // A proxy cannot carry to next year's AGM.
    expect(isProxyValidForMeeting({ meetingId: "m1", revokedAt: null }, "m2")).toBe(false);
  });

  it("is not valid once revoked", () => {
    expect(isProxyValidForMeeting({ meetingId: "m1", revokedAt: "2027-01-20T00:00:00Z" }, "m1")).toBe(false);
  });
});

describe("requiresSignedDocument — S7(a)", () => {
  it("requires the document for paper and facsimile", () => {
    expect(requiresSignedDocument("paper")).toBe(true);
    expect(requiresSignedDocument("facsimile")).toBe(true);
  });

  it("does not require one online, where the actor is the evidence", () => {
    expect(requiresSignedDocument("online")).toBe(false);
  });
});
