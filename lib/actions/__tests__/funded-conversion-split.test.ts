import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A CANCOLL switch and its refund are two steps (2026-11-06).
 *
 * The switch moves no money and works before CANCOLL has paid. The refund is
 * locked until CANCOLL's first invoice is recorded as paid, refunds the card
 * once, and claims the conversion row so a second click cannot add the refund
 * to the order again.
 */

const { requireAdminMock, createAdminClientMock, auditMock, refundsCreate, seatsMock, alertMock, qbMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  auditMock: vi.fn(),
  refundsCreate: vi.fn(),
  seatsMock: vi.fn(),
  alertMock: vi.fn(),
  qbMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: auditMock }));
vi.mock("@/lib/ops/alerts", () => ({ raiseAlertIfNotOpen: alertMock }));
vi.mock("@/lib/quickbooks/conference-export", () => ({ enqueueQBConferenceRefund: qbMock }));
vi.mock("@/lib/stripe/client", () => ({ stripe: { refunds: { create: refundsCreate } } }));
vi.mock("@/lib/conference/seats", () => ({ loadSeatHoldings: seatsMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { convertSeatToFunded, refundFundedConversion } from "../conference-funded-conversion";

const CONF = "conf-1";
const FUNDED = "funded-1";
const BASE = "base-1";
const ORG = "org-1";

/** Every table answers from fixed rows; filters are recorded, not applied. */
function mockDb(opts: { firstInvoicePaidAt: string | null; conversion?: Record<string, unknown>; claimRows?: number }) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const rows: Record<string, unknown[]> = {
    conference_entities: [
      {
        id: FUNDED,
        name: "Full Conference Registration (covered by CANCOLL)",
        attributes: {
          funded_by: "cancoll",
          funds_offer_id: BASE,
          funding_live: true,
          first_invoice_paid_at: opts.firstInvoicePaidAt,
        },
      },
    ],
    organizations: [
      { id: ORG, name: "Test School", type: "Member", membership_status: "active", is_cancoll_member: true, is_test: false },
    ],
    entity_balances: [{ id: "bal-1", purchase_id: "pur-1" }],
    entity_purchases: [{ id: "pur-1", order_item_id: "item-1" }],
    conference_order_items: [{ id: "item-1", order_id: "order-1", quantity: 1, unit_price_cents: 29900, tax_cents: 3887 }],
    conference_orders: [{ id: "order-1", status: "paid", stripe_payment_intent_id: "pi_1", refund_amount_cents: 0 }],
    conference_funded_conversions: opts.conversion ? [opts.conversion] : [],
    conference_people: [],
  };
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "gt", "order"]) chain[m] = () => chain;
    chain.update = (values: Record<string, unknown>) => {
      pendingUpdate = values;
      updates.push({ table, values });
      return chain;
    };
    chain.maybeSingle = async () => ({ data: rows[table]?.[0] ?? null, error: null });
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (v: unknown) => void) => {
      if (pendingUpdate && table === "conference_funded_conversions") {
        const n = opts.claimRows ?? 1;
        return resolve({ data: Array.from({ length: n }, () => ({ id: "conv-1" })), error: null });
      }
      return resolve({ data: rows[table] ?? [], error: null });
    };
    return chain;
  };
  return { db: { from, rpc }, rpc, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, ctx: { userId: "admin-1" } });
  seatsMock.mockResolvedValue({
    seats: [{ seatId: "seat-1", entityId: BASE, organizationId: ORG, balanceId: "bal-1", holderName: "Pat Delegate" }],
  });
  refundsCreate.mockResolvedValue({ id: "re_1" });
});

describe("convertSeatToFunded", () => {
  it("switches before CANCOLL has paid, without touching Stripe", async () => {
    const { db, rpc } = mockDb({ firstInvoicePaidAt: null });
    createAdminClientMock.mockReturnValue(db);

    const result = await convertSeatToFunded({ conferenceId: CONF, seatId: "seat-1" });

    expect(result).toEqual({ success: true, data: { refundCents: 29900 + 3887 } });
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "convert_registration_to_funded",
      expect.objectContaining({
        p_seat_id: "seat-1",
        p_cumulative_refund_cents: null,
        p_refund_id: null,
        p_refund_cents: 29900 + 3887,
      })
    );
  });
});

describe("refundFundedConversion", () => {
  const owed = {
    id: "conv-1",
    organization_id: ORG,
    seat_id: "seat-1",
    source_order_id: "order-1",
    refund_cents: 33787,
    refunded_at: null,
  };

  it("is locked until CANCOLL's first invoice is recorded as paid", async () => {
    const { db } = mockDb({ firstInvoicePaidAt: null, conversion: owed });
    createAdminClientMock.mockReturnValue(db);

    const result = await refundFundedConversion({ conferenceId: CONF, conversionId: "conv-1" });

    expect(result.success).toBe(false);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("refunds the card once and records it on the conversion and the order", async () => {
    const { db, rpc, updates } = mockDb({ firstInvoicePaidAt: "2026-12-01", conversion: owed });
    createAdminClientMock.mockReturnValue(db);

    const result = await refundFundedConversion({ conferenceId: CONF, conversionId: "conv-1" });

    expect(result).toEqual({ success: true, data: { refunded: "stripe", refundCents: 33787 } });
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1", amount: 33787 }),
      { idempotencyKey: "cancoll-conversion-refund:conv-1" }
    );
    expect(updates).toContainEqual({
      table: "conference_funded_conversions",
      values: expect.objectContaining({ refund_id: "re_1", refunded_at: expect.any(String) }),
    });
    expect(rpc).toHaveBeenCalledWith("process_conference_order_refund", { p_order_id: "order-1", p_refund_amount_cents: 33787 });
  });

  it("does not add the refund to the order again when another click already recorded it", async () => {
    const { db, rpc } = mockDb({ firstInvoicePaidAt: "2026-12-01", conversion: owed, claimRows: 0 });
    createAdminClientMock.mockReturnValue(db);

    const result = await refundFundedConversion({ conferenceId: CONF, conversionId: "conv-1" });

    expect(result.success).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith("process_conference_order_refund", expect.anything());
  });

  it("refuses a switch that was already paid back", async () => {
    const { db } = mockDb({ firstInvoicePaidAt: "2026-12-01", conversion: { ...owed, refunded_at: "2026-12-02T00:00:00Z" } });
    createAdminClientMock.mockReturnValue(db);

    const result = await refundFundedConversion({ conferenceId: CONF, conversionId: "conv-1" });

    expect(result).toEqual({ success: false, error: "That school has already been paid back." });
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});
