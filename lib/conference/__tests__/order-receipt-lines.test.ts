import { describe, expect, it } from "vitest";
import { orderLinesAfterChanges } from "../order-receipt-lines";

// York University's order, 2026-11-09: one funded registration, one day pass.
const york = [
  { purchaseId: "p-full", name: "Full Conference Registration (covered by CANCOLL)", quantity: 1, unitPriceCents: 0 },
  { purchaseId: "p-tue", name: "Tuesday Day Pass", quantity: 1, unitPriceCents: 19900 },
];

describe("orderLinesAfterChanges", () => {
  it("lists the order as bought when nothing changed", () => {
    expect(orderLinesAfterChanges(york, [])).toEqual([
      { name: "Full Conference Registration (covered by CANCOLL)", quantity: 1, amountCents: 0, changedFrom: null },
      { name: "Tuesday Day Pass", quantity: 1, amountCents: 19900, changedFrom: null },
    ]);
  });

  it("shows a changed day pass as the new day, at the price paid", () => {
    const lines = orderLinesAfterChanges(york, [{ fromPurchaseId: "p-tue", toPurchaseId: "p-wed", toName: "Wednesday Day Pass" }]);
    expect(lines[1]).toEqual({ name: "Wednesday Day Pass", quantity: 1, amountCents: 19900, changedFrom: "Tuesday Day Pass" });
  });

  it("splits a line when only some of its units changed", () => {
    const lines = orderLinesAfterChanges(
      [{ purchaseId: "p-tue", name: "Tuesday Day Pass", quantity: 3, unitPriceCents: 19900 }],
      [{ fromPurchaseId: "p-tue", toPurchaseId: "p-wed", toName: "Wednesday Day Pass" }]
    );
    expect(lines).toEqual([
      { name: "Tuesday Day Pass", quantity: 2, amountCents: 39800, changedFrom: null },
      { name: "Wednesday Day Pass", quantity: 1, amountCents: 19900, changedFrom: "Tuesday Day Pass" },
    ]);
  });

  it("follows a change of a change to where it ended", () => {
    const lines = orderLinesAfterChanges(york, [
      { fromPurchaseId: "p-tue", toPurchaseId: "p-wed", toName: "Wednesday Day Pass" },
      { fromPurchaseId: "p-wed", toPurchaseId: "p-thu", toName: "Thursday Day Pass" },
    ]);
    expect(lines[1]).toMatchObject({ name: "Thursday Day Pass", changedFrom: "Tuesday Day Pass" });
  });

  it("says nothing changed when it was changed back", () => {
    const lines = orderLinesAfterChanges(york, [
      { fromPurchaseId: "p-tue", toPurchaseId: "p-wed", toName: "Wednesday Day Pass" },
      { fromPurchaseId: "p-wed", toPurchaseId: "p-tue2", toName: "Tuesday Day Pass" },
    ]);
    expect(lines[1]).toEqual({ name: "Tuesday Day Pass", quantity: 1, amountCents: 19900, changedFrom: null });
  });

  it("ignores changes that belong to another order", () => {
    const lines = orderLinesAfterChanges(york, [{ fromPurchaseId: "p-other", toPurchaseId: "p-x", toName: "Wednesday Day Pass" }]);
    expect(lines.map((l) => l.name)).toEqual(["Full Conference Registration (covered by CANCOLL)", "Tuesday Day Pass"]);
  });
});
