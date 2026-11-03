import { describe, expect, it } from "vitest";
import { fundedRegistrationAllowed, isFundedOffer, type FundedRegistrationBuyer } from "../entity-pricing";

/**
 * Who gets the CANCOLL-funded registration.
 *
 * The CSC/CANCOLL MOU (2027): CANCOLL pays the $299 Registration Fee for one
 * delegate from each Dual Member, meaning a current CSC member that is on
 * CANCOLL's membership list when it registers. Until Steve switches the program
 * on, only test organisations may reach it.
 */

const FULL_REGISTRATION = "a8fc5a0b-47a0-49df-aade-fd09ad5a034d";

const live = { funded_by: "cancoll", funds_offer_id: FULL_REGISTRATION, funding_live: true };
const off = { funded_by: "cancoll", funds_offer_id: FULL_REGISTRATION, funding_live: false };

const school = (overrides: Partial<FundedRegistrationBuyer> = {}): FundedRegistrationBuyer => ({
  id: "org-1",
  type: "Member",
  membershipStatus: "active",
  isCancollMember: true,
  isTest: false,
  ...overrides,
});

describe("isFundedOffer", () => {
  it("needs both the funder and the registration it stands in for", () => {
    expect(isFundedOffer(live)).toBe(true);
    expect(isFundedOffer({ funded_by: "cancoll" })).toBe(false);
    expect(isFundedOffer({ funds_offer_id: FULL_REGISTRATION })).toBe(false);
    expect(isFundedOffer(null)).toBe(false);
  });
});

describe("fundedRegistrationAllowed, program live", () => {
  it("admits a current member on the CANCOLL list", () => {
    expect(fundedRegistrationAllowed(live, school())).toBe(true);
  });

  it("admits a school in grace: its renewal is in flight, it is still a member", () => {
    expect(fundedRegistrationAllowed(live, school({ membershipStatus: "grace" }))).toBe(true);
    expect(fundedRegistrationAllowed(live, school({ membershipStatus: "reactivated" }))).toBe(true);
  });

  it("refuses a CSC member that is not on the CANCOLL list", () => {
    expect(fundedRegistrationAllowed(live, school({ isCancollMember: false }))).toBe(false);
    expect(fundedRegistrationAllowed(live, school({ isCancollMember: null }))).toBe(false);
  });

  /** 12 canceled members still carry the flag (2026-10-27). Membership in only one organization is not enough. */
  it("refuses a flagged school whose CSC membership has lapsed", () => {
    expect(fundedRegistrationAllowed(live, school({ membershipStatus: "canceled" }))).toBe(false);
    expect(fundedRegistrationAllowed(live, school({ membershipStatus: "locked" }))).toBe(false);
    expect(fundedRegistrationAllowed(live, school({ membershipStatus: null }))).toBe(false);
  });

  /** 9 active Vendor Partners carry the flag too. The MOU funds institutions, not suppliers. */
  it("refuses a flagged vendor partner", () => {
    expect(fundedRegistrationAllowed(live, school({ type: "Vendor Partner" }))).toBe(false);
  });

  it("refuses an offer that is not a funded one", () => {
    expect(fundedRegistrationAllowed({ funding_live: true }, school())).toBe(false);
  });

  it("refuses with no buyer", () => {
    expect(fundedRegistrationAllowed(live, null)).toBe(false);
  });
});

describe("fundedRegistrationAllowed, program switched off", () => {
  it("refuses a real school that would otherwise qualify", () => {
    expect(fundedRegistrationAllowed(off, school())).toBe(false);
    expect(fundedRegistrationAllowed({ funded_by: "cancoll", funds_offer_id: FULL_REGISTRATION }, school())).toBe(false);
  });

  it("admits a qualifying test organisation, so it can be walked end to end", () => {
    expect(fundedRegistrationAllowed(off, school({ isTest: true }))).toBe(true);
  });

  it("still applies the real rules to a test organisation", () => {
    expect(fundedRegistrationAllowed(off, school({ isTest: true, isCancollMember: false }))).toBe(false);
  });

  /** Same as isDirectPurchaseOnly: a stored string is a data error, and failing closed is the safe direction. */
  it("does not treat the string \"true\" as switched on", () => {
    expect(fundedRegistrationAllowed({ ...off, funding_live: "true" }, school())).toBe(false);
  });
});
