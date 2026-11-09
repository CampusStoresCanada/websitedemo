import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Changing a registration emails two people (Steve, 2026-11-09): the person
 * on the ticket gets their registration confirmation again, showing the new
 * one, and the buyer on the order gets an updated receipt. Each send is keyed
 * to the change, so the confirmation sent at checkout does not swallow it.
 */

const { requireAdminMock, createAdminClientMock, seatsMock, regConfirmMock, orderUpdatedMock, auditMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  seatsMock: vi.fn(),
  regConfirmMock: vi.fn(),
  orderUpdatedMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/conference/seats", () => ({ loadSeatHoldings: seatsMock }));
vi.mock("@/lib/conference/included-seats", () => ({ seatIncludedEvents: vi.fn() }));
vi.mock("@/lib/policy/engine", () => ({ getProgramsConfig: vi.fn(async () => []), resolveConferenceTier: () => "member" }));
vi.mock("@/lib/comms/conference-triggers", () => ({
  triggerConferenceRegistrationConfirmation: regConfirmMock,
  triggerConferenceOrderUpdated: orderUpdatedMock,
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: auditMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { changeRegistration } from "../conference-registration-change";
import { indexById } from "@/lib/conference/entity-graph";
import type { BuildEntity, EntityRefView } from "@/lib/actions/conference-entities";

const CONF = "conf-1";

function thing(p: Partial<BuildEntity> & { id: string; kind: string; name: string }): BuildEntity {
  return {
    isForSale: false, priceCents: null, currency: "CAD", attributes: {}, needsDefinition: false,
    inventory: null, tierPrices: {}, qboItemId: null, salesWindow: null, refs: [], ...p,
  } as BuildEntity;
}
const who: EntityRefView[] = [{ toEntityId: "member", toName: "Member", toKind: "audience", role: "who", quantity: null }];

const byId = indexById([
  thing({ id: "member", kind: "audience", name: "Member", attributes: { source_role: "member" } }),
  thing({ id: "tue", kind: "registration", name: "Tuesday Day Pass", isForSale: true, priceCents: 19900, refs: who }),
  thing({ id: "wed", kind: "registration", name: "Wednesday Day Pass", isForSale: true, priceCents: 19900, refs: who }),
]);

/** Each table answers from fixed rows; filters are not applied. */
function mockDb(rows: Record<string, unknown[]>) {
  const rpc = vi.fn(async () => ({ data: { change_id: "change-1", holder_person_id: "person-lisa" }, error: null }));
  const from = (table: string) => {
    const list = rows[table] ?? [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "is", "not", "update"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: list[0] ?? null, error: null });
    chain.single = async () => ({ data: list[0] ?? null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null });
    return chain;
  };
  return { from, rpc };
}

describe("changeRegistration emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ ok: true, ctx: { userId: "steve" } });
    seatsMock.mockResolvedValue({
      seats: [{ seatId: "seat-lisa", organizationId: "york", balanceId: "bal-1", entityId: "tue", entityKind: "registration", entityName: "Tuesday Day Pass", holderName: "Lisa Febbraio", holderPersonId: "person-lisa" }],
      entitiesById: byId,
    });
    createAdminClientMock.mockReturnValue(
      mockDb({
        entity_balances: [{ id: "bal-1", purchase_id: "pur-tue" }],
        entity_purchases: [{ id: "pur-tue", price_cents: 19900, order_item_id: "item-tue" }],
        organizations: [{ id: "york", name: "York University", type: "Member" }],
        conference_entities: [{ kind: "registration", name: "Wednesday Day Pass", attributes: {} }],
        conference_people: [{ display_name: "Lisa Febbraio", contact_email: "febbraio@yorku.ca" }],
        conference_registration_changes: [{ from_purchase_id: "pur-tue" }],
        conference_order_items: [{ order_id: "order-york" }],
      })
    );
  });

  it("sends the person on the ticket their registration, showing the new pass", async () => {
    const result = await changeRegistration({ conferenceId: CONF, seatId: "seat-lisa", toEntityId: "wed" });
    expect(result.success).toBe(true);
    expect(regConfirmMock).toHaveBeenCalledTimes(1);
    expect(regConfirmMock.mock.calls[0][0]).toMatchObject({
      personId: "person-lisa",
      attendeeEmail: "febbraio@yorku.ca",
      orgName: "York University",
      registrationRole: "Wednesday Day Pass",
      triggerEventKey: "conference_registration_confirmation:person-lisa:change:change-1",
    });
  });

  it("sends the buyer on the original order the updated receipt", async () => {
    await changeRegistration({ conferenceId: CONF, seatId: "seat-lisa", toEntityId: "wed" });
    expect(orderUpdatedMock).toHaveBeenCalledTimes(1);
    expect(orderUpdatedMock.mock.calls[0][0]).toMatchObject({
      orderId: "order-york",
      changeId: "change-1",
      changeSentence: "Lisa Febbraio is now on the Wednesday Day Pass instead of the Tuesday Day Pass.",
    });
  });

  it("sends nothing when the change is refused", async () => {
    const result = await changeRegistration({ conferenceId: CONF, seatId: "seat-lisa", toEntityId: "not-offered" });
    expect(result.success).toBe(false);
    expect(regConfirmMock).not.toHaveBeenCalled();
    expect(orderUpdatedMock).not.toHaveBeenCalled();
  });

  it("keeps the change when an email fails", async () => {
    regConfirmMock.mockRejectedValueOnce(new Error("Resend down"));
    const result = await changeRegistration({ conferenceId: CONF, seatId: "seat-lisa", toEntityId: "wed" });
    expect(result.success).toBe(true);
  });
});
