import { describe, it, expect } from "vitest";
import { CSC_ELECTIONS_CONFIG } from "../config";
import { planNomination } from "../service";

const base = {
  nominatorOrganizationId: "org-a",
  nominatorOrganizationName: "A University",
  nominatorContactId: "contact-nominator",
  nomineeContactId: "contact-nominee",
};

describe("planNomination", () => {
  it("counts the nominating institution as one of the two signatures", () => {
    // Putting a name forward IS that institution's support. Making them
    // separately sign their own nomination is a step that only exists because
    // of how the table is shaped.
    const plan = planNomination(CSC_ELECTIONS_CONFIG, base);
    expect(plan.isSelfNomination).toBe(false);
    expect(plan.automatic).toHaveLength(1);
    expect(plan.stillNeeded).toBe(1);
  });

  it("a self-nomination needs one MORE institution, not fewer", () => {
    // The nominee cannot co-sign themselves, so their own store's signature is
    // unavailable — a self-nominator has to find two other institutions.
    const plan = planNomination(CSC_ELECTIONS_CONFIG, {
      ...base,
      nomineeContactId: base.nominatorContactId,
    });
    expect(plan.isSelfNomination).toBe(true);
    expect(plan.automatic).toHaveLength(0);
    expect(plan.stillNeeded).toBe(2);
  });

  it("honours a config that permits self-co-signature", () => {
    const permissive = {
      ...CSC_ELECTIONS_CONFIG,
      nominations: { ...CSC_ELECTIONS_CONFIG.nominations, selfCosignatureAllowed: true },
    };
    const plan = planNomination(permissive, {
      ...base,
      nomineeContactId: base.nominatorContactId,
    });
    expect(plan.automatic).toHaveLength(1);
    expect(plan.stillNeeded).toBe(1);
  });

  it("needs nobody when the requirement is zero", () => {
    const none = {
      ...CSC_ELECTIONS_CONFIG,
      nominations: { ...CSC_ELECTIONS_CONFIG.nominations, cosignersRequired: 0 },
    };
    expect(planNomination(none, base).stillNeeded).toBe(0);
  });
});
