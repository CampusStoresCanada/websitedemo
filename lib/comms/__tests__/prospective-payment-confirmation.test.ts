import { beforeEach, describe, expect, it, vi } from "vitest";

const triggerAutomation = vi.fn(async (_options: { variableValues: Record<string, string> }) => undefined);
vi.mock("../automation", () => ({ triggerAutomation: (options: { variableValues: Record<string, string> }) => triggerAutomation(options) }));

import { triggerProspectiveBoothPaymentConfirmation } from "../conference-triggers";

/**
 * The email a pay-first buyer gets the moment Stripe confirms.
 *
 * Two things it got wrong for anyone who was not buying a booth, both found
 * setting up Oxford University Press for Big Ideas Day (2026-11):
 *   - it called every purchase "Booth <name>"
 *   - it quoted the pre-tax sum on the payment row, not what the card was charged
 */

type Row = { id: string; email: string; company_name: string; amount_cents: number; booth: { name: string; kind: string } };

const fakeDb = (row: Row | null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) }),
      }),
    }),
  }) as unknown as Parameters<typeof triggerProspectiveBoothPaymentConfirmation>[0]["db"];

const bigIdeas: Row = {
  id: "pay-1",
  email: "buyer@example.test",
  company_name: "Oxford University Press Canada",
  amount_cents: 110000,
  booth: { name: "Big Ideas Day — Publisher", kind: "registration" },
};

const sentVariables = () => triggerAutomation.mock.calls[0][0].variableValues;

describe("pay-first payment confirmation", () => {
  beforeEach(() => triggerAutomation.mockClear());

  it("quotes what the card was charged, tax included", async () => {
    await triggerProspectiveBoothPaymentConfirmation({ db: fakeDb(bigIdeas), paymentId: "pay-1", chargedCents: 124300 });
    expect(sentVariables().amount_paid).toBe("$1,243.00");
  });

  it("falls back to the pre-tax sum when Stripe gave no total", async () => {
    await triggerProspectiveBoothPaymentConfirmation({ db: fakeDb(bigIdeas), paymentId: "pay-1", chargedCents: null });
    expect(sentVariables().amount_paid).toBe("$1,100.00");
  });

  it("names a non-booth purchase as it is", async () => {
    await triggerProspectiveBoothPaymentConfirmation({ db: fakeDb(bigIdeas), paymentId: "pay-1" });
    expect(sentVariables().purchase_label).toBe("Big Ideas Day — Publisher");
  });

  it("still calls a booth a booth", async () => {
    const booth = { ...bigIdeas, booth: { name: "204", kind: "booth" } };
    await triggerProspectiveBoothPaymentConfirmation({ db: fakeDb(booth), paymentId: "pay-1" });
    expect(sentVariables().purchase_label).toBe("Booth 204");
  });

  it("sends nothing when the payment is not there", async () => {
    await triggerProspectiveBoothPaymentConfirmation({ db: fakeDb(null), paymentId: "missing" });
    expect(triggerAutomation).not.toHaveBeenCalled();
  });
});
