import { describe, expect, it } from "vitest";
import {
  claimGaps,
  claimWindowOpen,
  distanceAmountCents,
  lineProblem,
  payeeGaps,
  validatePayeeAnswer,
  type ExpenseCategory,
  type ExpenseLine,
  type Payee,
} from "../rules";

/**
 * The travel bursary as configured (Steve, 2026-10-29): hotel up to $665 tax
 * included, and EITHER airfare (no cap) OR mileage at $0.73/km.
 */
const hotel: ExpenseCategory = {
  key: "hotel",
  label: "Hotel",
  help: null,
  measure: "amount",
  capCents: 66500,
  rateCentsPerKm: null,
  requiresReceipt: true,
  choiceGroup: null,
};
const airfare: ExpenseCategory = { ...hotel, key: "airfare", label: "Airfare", capCents: null, choiceGroup: "travel" };
const mileage: ExpenseCategory = {
  ...hotel,
  key: "mileage",
  label: "Mileage",
  measure: "distance",
  capCents: null,
  rateCentsPerKm: 73,
  requiresReceipt: false,
  choiceGroup: "travel",
};
const categories = [hotel, airfare, mileage];

const line = (over: Partial<ExpenseLine>): ExpenseLine => ({
  categoryKey: "hotel",
  amountCents: 0,
  taxCents: 0,
  distanceKm: null,
  description: null,
  receiptCount: 0,
  ...over,
});

const payee: Payee = {
  type: "organization",
  name: "University of Somewhere",
  email: "ap@example.edu",
  phone: null,
  addressLine1: "1 College Rd",
  addressLine2: null,
  city: "Calgary",
  province: "AB",
  postalCode: "T2N 1N4",
  country: "Canada",
};

describe("the hotel cap", () => {
  it("allows exactly $665 with tax", () => {
    expect(lineProblem(hotel, line({ amountCents: 60000, taxCents: 6500 }))).toBeNull();
  });

  it("refuses a cent over, counting the tax", () => {
    expect(lineProblem(hotel, line({ amountCents: 60000, taxCents: 6501 }))).toMatch(/\$665/);
  });

  it("airfare has no cap", () => {
    expect(lineProblem(airfare, line({ categoryKey: "airfare", amountCents: 250000, taxCents: 30000 }))).toBeNull();
  });
});

describe("mileage", () => {
  it("is km times $0.73", () => {
    expect(distanceAmountCents(812, 73)).toBe(59276);
    expect(distanceAmountCents(100.5, 73)).toBe(7337);
  });

  it("carries no tax", () => {
    expect(lineProblem(mileage, line({ categoryKey: "mileage", distanceKm: 10, amountCents: 730, taxCents: 5 }))).toBe(
      "Mileage has no tax."
    );
  });
});

describe("what stands between a claim and submitting it", () => {
  const hotelLine = line({ amountCents: 50000, taxCents: 6000, receiptCount: 1 });

  it("nothing, for a hotel with a receipt and a full payee", () => {
    expect(claimGaps({ categories, lines: [hotelLine], payee })).toEqual([]);
  });

  it("a receipt for anything that needs one", () => {
    expect(claimGaps({ categories, lines: [{ ...hotelLine, receiptCount: 0 }], payee })).toEqual([
      "Attach a receipt for Hotel.",
    ]);
  });

  it("mileage needs no receipt", () => {
    const m = line({ categoryKey: "mileage", distanceKm: 400, amountCents: 29200 });
    expect(claimGaps({ categories, lines: [m], payee })).toEqual([]);
  });

  it("airfare or mileage, not both", () => {
    const a = line({ categoryKey: "airfare", amountCents: 40000, receiptCount: 1 });
    const m = line({ categoryKey: "mileage", distanceKm: 400, amountCents: 29200 });
    expect(claimGaps({ categories, lines: [a, m], payee })).toEqual(["Claim Airfare or Mileage, not both."]);
  });

  it("an empty slot doesn't count as choosing it", () => {
    const a = line({ categoryKey: "airfare", amountCents: 40000, receiptCount: 1 });
    const empty = line({ categoryKey: "mileage" });
    expect(claimGaps({ categories, lines: [a, empty], payee })).toEqual([]);
  });

  it("only the slots this claim allows", () => {
    const a = line({ categoryKey: "airfare", amountCents: 40000, receiptCount: 1 });
    expect(claimGaps({ categories, lines: [a], payee, allowedKeys: ["hotel"] })).toEqual([
      "Airfare isn't part of this claim.",
    ]);
  });

  it("at least one expense", () => {
    expect(claimGaps({ categories, lines: [], payee })).toEqual(["Add at least one expense."]);
  });
});

describe("who we're paying", () => {
  it("must be declared first", () => {
    expect(payeeGaps({ ...payee, type: null })).toEqual(["Choose who we're paying."]);
  });

  it("needs a name, an email and a full mailing address", () => {
    expect(payeeGaps({ ...payee, name: " ", city: null })).toEqual([
      "Enter the name we should pay.",
      "Enter the full mailing address for payment.",
    ]);
  });

  it("refuses a payee type the program doesn't allow", () => {
    expect(validatePayeeAnswer("type", "other", ["organization", "claimant"]).valid).toBe(false);
    expect(validatePayeeAnswer("type", "claimant", ["organization", "claimant"])).toEqual({
      valid: true,
      clean: "claimant",
    });
  });

  it("checks the email's shape", () => {
    expect(validatePayeeAnswer("email", "not-an-email", ["organization"]).valid).toBe(false);
  });
});

describe("the claim window", () => {
  const opens = "2027-02-04T12:00:00Z";
  const closes = "2027-03-07T08:00:00Z";

  it("is shut before the conference ends", () => {
    expect(claimWindowOpen(opens, closes, new Date("2027-02-01T12:00:00Z"))).toBe(false);
  });

  it("is open late on March 6 on the west coast", () => {
    expect(claimWindowOpen(opens, closes, new Date("2027-03-07T07:59:00Z"))).toBe(true);
  });

  it("is shut from the boundary on", () => {
    expect(claimWindowOpen(opens, closes, new Date("2027-03-07T08:00:00Z"))).toBe(false);
  });
});

describe("applyClaimCaps", async () => {
  const { applyClaimCaps } = await import("../rules");
  it("takes the lower of the program cap and the claim's own", () => {
    const [capped] = applyClaimCaps([{ ...hotel, capCents: 88637 }], { hotel: 66478 });
    expect(capped.capCents).toBe(66478);
    const [kept] = applyClaimCaps([{ ...hotel, capCents: 50000 }], { hotel: 66477 });
    expect(kept.capCents).toBe(50000);
  });
  it("caps a slot the program left open, and leaves others alone", () => {
    const [a] = applyClaimCaps([airfare], { hotel: 66477 });
    expect(a.capCents).toBeNull();
    const [b] = applyClaimCaps([airfare], { airfare: 1000 });
    expect(b.capCents).toBe(1000);
  });
});
