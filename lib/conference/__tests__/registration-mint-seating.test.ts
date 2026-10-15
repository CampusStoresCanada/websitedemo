import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ WHICH SEAT A NAME LANDS ON DECIDES WHETHER A BADGE PRINTS.
 *
 * One registration mints more than one seat — mint_v3_for_order expands the
 * `includes` graph, so a Full Conference Registration also lands a Meet &
 * Greet Reception seat and a Wednesday Offsite seat, all under one purchase.
 * The attendee zip used to pair the buyer's name with whichever of those
 * sorted first by `id`, an arbitrary uuid.
 *
 * Observed 2026-09-16 on a real catalogue: a quantity-1 registration seated
 * the buyer on the RECEPTION and left the registration seat open. badges/run.ts
 * then skips them — "a badge is only ever for a registration seat" — so the one
 * person a name was actually supplied for is the one who gets no badge.
 *
 * ⚠️ The shared makeFakeDb is filter-blind: it replays queued rows whatever the
 * query asked for, so it cannot tell a filtered read from an unfiltered one.
 * This file uses a fake that HONOURS .eq/.in/.is/.order on the seats table,
 * which is the only way for the assertion to mean anything.
 */

const { resolveAssigneeForEmailMock, findExistingUserByEmailMock, triggerConfirmationMock } = vi.hoisted(() => ({
  resolveAssigneeForEmailMock: vi.fn(),
  findExistingUserByEmailMock: vi.fn(),
  triggerConfirmationMock: vi.fn(),
}));

vi.mock("@/lib/actions/conference-people", () => ({ resolveAssigneeForEmail: resolveAssigneeForEmailMock }));
vi.mock("@/lib/actions/conference-entity-commerce", () => ({ findExistingUserByEmail: findExistingUserByEmailMock }));
vi.mock("../../comms/conference-triggers", () => ({
  triggerConferenceRegistrationConfirmation: triggerConfirmationMock,
}));

import { mintRegistrationAttendeesFromOrder } from "../registration-mint";

const REGISTRATION = "entity-registration";
const RECEPTION = "entity-reception";
const OFFSITE = "entity-offsite";

type Seat = { id: string; entity_id: string; seat_index: number; holder_person_id: string | null };

/**
 * ⛔ The reception seat sorts FIRST by id, deliberately. On the real catalogue
 * the order is a uuid coin-flip; pinning the losing arrangement here makes the
 * regression deterministic instead of one-in-three.
 */
function seatFixture(): Seat[] {
  return [
    { id: "aaa-reception", entity_id: RECEPTION, seat_index: 1, holder_person_id: null },
    { id: "bbb-offsite", entity_id: OFFSITE, seat_index: 1, holder_person_id: null },
    { id: "ccc-registration", entity_id: REGISTRATION, seat_index: 1, holder_person_id: null },
  ];
}

/** Records the seat id each claim targeted, and filters seat reads for real. */
function makeSeatAwareDb(
  seats: Seat[],
  attendees: Array<{ name: string; email: string | null }> = [{ name: "Suzie McUzie", email: null }]
) {
  const claimed: string[] = [];

  const queues: Record<string, unknown[]> = {
    organizations: [{ name: "University of Saskatchewan" }],
    conference_order_items: [
      [
        {
          id: "item-1",
          metadata: { attendees },
          offer: { id: REGISTRATION, name: "Full Conference Registration", kind: "registration", attributes: null },
        },
      ],
    ],
    entity_purchases: [[{ id: "purchase-1" }]],
    entity_balances: [[{ id: "bal-reg" }, { id: "bal-reception" }, { id: "bal-offsite" }]],
    conference_people: attendees.map((_, i) => ({ id: `person-${i + 1}` })),
  };

  const from = vi.fn((table: string) => {
    const filters: Array<{ method: string; args: unknown[] }> = [];
    let isUpdate = false;

    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "not", "order", "limit", "single", "maybeSingle", "insert", "upsert"]) {
      builder[m] = vi.fn((...args: unknown[]) => {
        filters.push({ method: m, args });
        return builder;
      });
    }
    builder.update = vi.fn((...args: unknown[]) => {
      isUpdate = true;
      filters.push({ method: "update", args });
      return builder;
    });

    const resolve = () => {
      if (table === "entity_balance_seats") {
        if (isUpdate) {
          const idEq = filters.find((f) => f.method === "eq" && f.args[0] === "id");
          if (idEq) claimed.push(idEq.args[1] as string);
          return { data: null, error: null };
        }
        // ⚠️ Apply the filters the production query actually asked for.
        let rows = [...seats];
        for (const f of filters) {
          if (f.method === "eq") rows = rows.filter((r) => (r as never as Record<string, unknown>)[f.args[0] as string] === f.args[1]);
          if (f.method === "in") {
            // balance_id is not modelled per-seat; every seat belongs to the purchase.
            if (f.args[0] !== "balance_id") rows = rows.filter((r) => (f.args[1] as unknown[]).includes((r as never as Record<string, unknown>)[f.args[0] as string]));
          }
          if (f.method === "is" && f.args[0] === "holder_person_id" && f.args[1] === null) {
            rows = rows.filter((r) => r.holder_person_id === null);
          }
        }
        const orders = filters.filter((f) => f.method === "order").map((f) => f.args[0] as string);
        rows.sort((a, b) => {
          for (const key of orders) {
            const av = (a as never as Record<string, unknown>)[key];
            const bv = (b as never as Record<string, unknown>)[key];
            if (av === bv) continue;
            return (av as number | string) < (bv as number | string) ? -1 : 1;
          }
          return 0;
        });
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      const queue = queues[table];
      const next = Array.isArray(queue) && queue.length > 0 ? queue.shift() : null;
      return { data: next ?? null, error: null };
    };

    builder.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(ok, bad);
    return builder;
  });

  return { db: { from } as never, claimed };
}

beforeEach(() => {
  vi.clearAllMocks();
  findExistingUserByEmailMock.mockResolvedValue(null);
  resolveAssigneeForEmailMock.mockResolvedValue({ canonicalPersonId: null });
  triggerConfirmationMock.mockResolvedValue(undefined);
});

describe("seating a named attendee from a paid order", () => {
  it("⛔ seats them on the REGISTRATION, not on an event the registration includes", async () => {
    const { db, claimed } = makeSeatAwareDb(seatFixture());

    await mintRegistrationAttendeesFromOrder(db, "order-1", "conf-1", "org-1");

    expect(claimed).toEqual(["ccc-registration"]);
  });

  it("leaves the included event seats open for the org to allocate", async () => {
    // Those seats are the organisation's to hand out, exactly like a booth's.
    // Consuming one here would also silently reduce what the org appears to own.
    const { db, claimed } = makeSeatAwareDb(seatFixture());

    await mintRegistrationAttendeesFromOrder(db, "order-1", "conf-1", "org-1");

    expect(claimed).not.toContain("aaa-reception");
    expect(claimed).not.toContain("bbb-offsite");
  });

  it("seats two attendees on the registration seats in seat-number order", async () => {
    // Three registration seats, two names: seat_index must decide which two,
    // not the uuid order the old query fell back on.
    const seats = seatFixture();
    seats.push({ id: "zzz-registration-2", entity_id: REGISTRATION, seat_index: 2, holder_person_id: null });
    seats.push({ id: "aa0-registration-3", entity_id: REGISTRATION, seat_index: 3, holder_person_id: null });
    const { db, claimed } = makeSeatAwareDb(seats, [
      { name: "Suzie McUzie", email: null },
      { name: "Ada Lovelace", email: null },
    ]);

    await mintRegistrationAttendeesFromOrder(db, "order-1", "conf-1", "org-1");

    expect(claimed).toEqual(["ccc-registration", "zzz-registration-2"]);
  });
});
