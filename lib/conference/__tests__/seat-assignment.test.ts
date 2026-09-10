import { describe, expect, it, vi } from "vitest";
import { assignSeat, releaseSeat } from "../seat-assignment";

vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: vi.fn(async () => {}) }));

const SEAT = {
  id: "seat-1",
  conference_id: "conf-1",
  organization_id: "org-rocket",
  entity_id: "entity-reception",
  holder_person_id: null as string | null,
};

/**
 * A fake that models the ONE property that matters: the update is conditional,
 * so it returns zero rows when the guard does not match. That is the race a
 * read-then-write would lose silently.
 */
function fakeDb(seat: typeof SEAT, opts: { rowsUpdated?: number } = {}) {
  return {
    from() {
      const q: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: seat, error: null }),
        update(patch: Record<string, unknown>) {
          q.patch = patch;
          return {
            eq: () => q.chain2,
            ...(q.chain2 as object),
          };
        },
      };
      const rows = opts.rowsUpdated ?? 1;
      q.chain2 = {
        eq: () => q.chain2,
        is: () => q.chain2,
        select: async () => ({
          data: Array.from({ length: rows }, () => ({ id: seat.id })),
          error: null,
        }),
      };
      return chain;
    },
  };
}

describe("assigning a seat", () => {
  it("gives an unheld seat to a person at the same organisation", async () => {
    const res = await assignSeat({
      db: fakeDb({ ...SEAT }), seatId: "seat-1", personId: "p1",
      organizationId: "org-rocket", actorId: "u1", reason: "walk-up",
    });
    expect(res.ok).toBe(true);
  });

  it("⛔ refuses when somebody was named while the form was open", async () => {
    const res = await assignSeat({
      db: fakeDb({ ...SEAT }, { rowsUpdated: 0 }), seatId: "seat-1", personId: "p1",
      organizationId: "org-rocket", actorId: "u1", reason: "walk-up",
    });
    expect(res).toMatchObject({ ok: false, code: "already_held" });
  });

  it("refuses a seat already held, without writing", async () => {
    const res = await assignSeat({
      db: fakeDb({ ...SEAT, holder_person_id: "someone" }), seatId: "seat-1",
      personId: "p1", organizationId: "org-rocket", actorId: "u1", reason: "walk-up",
    });
    expect(res).toMatchObject({ ok: false, code: "already_held" });
  });

  it("⛔ never hands one store's paid ticket to another store's staff", async () => {
    const res = await assignSeat({
      db: fakeDb({ ...SEAT }), seatId: "seat-1", personId: "p1",
      organizationId: "org-someone-else", actorId: "u1", reason: "walk-up",
    });
    expect(res).toMatchObject({ ok: false, code: "wrong_organization" });
  });
});

describe("releasing a ticket", () => {
  it("hands it back to the pool, still owned by the org", async () => {
    const res = await releaseSeat({
      db: fakeDb({ ...SEAT, holder_person_id: "p1" }), seatId: "seat-1",
      personId: "p1", actorId: "u1", reason: "not going",
    });
    expect(res.ok).toBe(true);
  });

  it("refuses to release a ticket the person does not hold", async () => {
    const res = await releaseSeat({
      db: fakeDb({ ...SEAT, holder_person_id: "someone-else" }), seatId: "seat-1",
      personId: "p1", actorId: "u1", reason: "stale screen",
    });
    expect(res).toMatchObject({ ok: false, code: "not_held_by_person" });
  });

  it("⛔ refuses when it changed hands while the screen was open", async () => {
    const res = await releaseSeat({
      db: fakeDb({ ...SEAT, holder_person_id: "p1" }, { rowsUpdated: 0 }),
      seatId: "seat-1", personId: "p1", actorId: "u1", reason: "race",
    });
    expect(res).toMatchObject({ ok: false, code: "not_held_by_person" });
  });
});
