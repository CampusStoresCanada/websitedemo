import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/ops/alerts", () => ({ raiseAlertIfNotOpen: vi.fn() }));
vi.mock("@/lib/data", () => ({ isFeatureEnabled: vi.fn() }));

import { expenseBillLines, expenseVendorName } from "../expense-bills";

const categories = [
  { key: "hotel", label: "Hotel", measure: "amount", rateCentsPerKm: null },
  { key: "airfare", label: "Airfare", measure: "amount", rateCentsPerKm: null },
  { key: "mileage", label: "Mileage", measure: "distance", rateCentsPerKm: 73 },
];

describe("the payable's lines", () => {
  it("posts the tax as its own line", () => {
    const lines = expenseBillLines({
      categories,
      lines: [{ categoryKey: "hotel", amountCents: 58850, taxCents: 7650, distanceKm: null, description: null }],
      accountId: "77",
      taxCodeId: null,
    });
    expect(lines.map((l) => [l.Description, l.Amount])).toEqual([
      ["Hotel", 588.5],
      ["Hotel: tax paid", 76.5],
    ]);
    expect(lines[0].AccountBasedExpenseLineDetail).toEqual({ AccountRef: { value: "77" } });
  });

  it("describes mileage by its distance and rate, with no tax line", () => {
    const lines = expenseBillLines({
      categories,
      lines: [{ categoryKey: "mileage", amountCents: 59276, taxCents: 0, distanceKm: 812, description: "Lethbridge to Calgary" }],
      accountId: "77",
      taxCodeId: "3",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].Description).toBe("Mileage: 812 km at $0.73/km (Lethbridge to Calgary)");
    expect(lines[0].AccountBasedExpenseLineDetail.TaxCodeRef).toEqual({ value: "3" });
  });
});

describe("the vendor's name", () => {
  it("never collides with the school's customer record", () => {
    expect(expenseVendorName("University of Guelph")).toBe("University of Guelph (Expense claims)");
  });
});
