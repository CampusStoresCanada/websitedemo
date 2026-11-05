import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const HOTEL_TASK = {
  id: "t1", name: "Book your hotel room", description: "…",
  sort_order: 0, active: true, audience: "person",
};

/** Minimal stub of the two queries loadPersonalTasks makes. */
function stubDb(opts: {
  tasks?: typeof HOTEL_TASK[];
  hotelCode?: string | null;
  ack?: { task_id: string; state: string; evidence: string | null } | null;
}) {
  const tasks = opts.tasks ?? [HOTEL_TASK];
  return {
    from(table: string) {
      if (table === "conference_checklists") {
        const res = Promise.resolve({
          data: [{ id: "c1", deadline_at: "2027-01-08T00:00:00Z", conference_checklist_tasks: tasks }],
        });
        return { select: () => ({ eq: () => ({ eq: () => res }) }) };
      }
      if (table === "conference_people") {
        const res = Promise.resolve({ data: { hotel_confirmation_code: opts.hotelCode ?? null } });
        return { select: () => ({ eq: () => ({ maybeSingle: () => res }) }) };
      }
      // acknowledgements
      const res = Promise.resolve({ data: opts.ack ? [opts.ack] : [] });
      return { select: () => ({ eq: () => ({ in: () => res }) }) };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (db: any) =>
  (await import("../checklist-tasks")).loadPersonalTasks(db, "conf", "person-1");

describe("loadPersonalTasks", () => {
  it("is pending when nothing has been said or captured", async () => {
    const [t] = await load(stubDb({}));
    expect(t.state).toBe("pending");
    expect(t.derived).toBe(false);
  });

  it("counts an existing hotel confirmation code as done without a tick", async () => {
    // The column predates this feature and was read by nothing. Anyone who
    // already told us where they're staying must not be asked again.
    const [t] = await load(stubDb({ hotelCode: "ABC123" }));
    expect(t.state).toBe("done");
    expect(t.derived).toBe(true);
    expect(t.evidence).toBe("ABC123");
  });

  it("honours a not-applicable answer — the stop-asking-me state", async () => {
    const [t] = await load(stubDb({ ack: { task_id: "t1", state: "not_applicable", evidence: null } }));
    expect(t.state).toBe("not_applicable");
  });

  it("lets captured data win over a stale not-applicable answer", async () => {
    // Said "staying elsewhere", then booked in the block after all.
    const [t] = await load(stubDb({
      hotelCode: "ZZ999",
      ack: { task_id: "t1", state: "not_applicable", evidence: null },
    }));
    expect(t.state).toBe("done");
  });

  it("ignores org-audience tasks — those are the company's to answer", async () => {
    const orgTask = { ...HOTEL_TASK, id: "t2", name: "Place your Stronco order", audience: "org" };
    expect(await load(stubDb({ tasks: [orgTask] }))).toEqual([]);
  });

  it("ignores inactive tasks", async () => {
    expect(await load(stubDb({ tasks: [{ ...HOTEL_TASK, active: false }] }))).toEqual([]);
  });

  it("puts the soonest deadline first, whatever checklist it came from", async () => {
    // Tasks arrive from several checklists at once. Ordering by sort_order
    // alone interleaves them into an order that reads as arbitrary.
    const later = { ...HOTEL_TASK, id: "t2", name: "Later thing", sort_order: 0 };
    const db = {
      from(table: string) {
        if (table === "conference_checklists") {
          return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [
            { id: "c1", deadline_at: "2027-01-08T00:00:00Z", conference_checklist_tasks: [HOTEL_TASK] },
            { id: "c2", deadline_at: "2026-11-01T00:00:00Z", conference_checklist_tasks: [later] },
          ] }) }) }) };
        }
        if (table === "conference_people") {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: {} }) }) }) };
        }
        return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [] }) }) }) };
      },
    };
    const tasks = await load(db);
    expect(tasks.map((t) => t.name)).toEqual(["Later thing", "Book your hotel room"]);
  });

  it("carries the checklist deadline onto each task", async () => {
    const [t] = await load(stubDb({}));
    expect(t.deadline).toBe("2027-01-08T00:00:00Z");
  });
});

describe("personIdsInTaskScope", async () => {
  const { personIdsInTaskScope } = await import("../checklist-tasks");
  /**
   * The CANCOLL consent is asked of whoever holds the funded registration, not
   * of the school: a colleague on the ordinary Full Conference Registration is
   * outside it, and handing the funded seat to someone else moves the ask.
   */
  const FUNDED = "funded-registration";
  const FULL = "full-registration";
  const entities = new Map([
    [FUNDED, { kind: "registration", attributes: { funded_by: "cancoll", funds_offer_id: FULL } }],
    [FULL, { kind: "registration" }],
    ["booth-109", { kind: "booth" }],
  ]);
  const seats = [
    { seatId: "s-funded", entityId: FUNDED, holderPersonId: "jackie" },
    { seatId: "s-full", entityId: FULL, holderPersonId: "colleague" },
    { seatId: "s-empty", entityId: FULL, holderPersonId: null },
    { seatId: "s-booth", entityId: "booth-109", holderPersonId: "vendor" },
  ];

  it("returns null for a task with no scope, which is asked of everyone", () => {
    expect(personIdsInTaskScope(seats, entities, {})).toBeNull();
  });

  it("asks only the holder of the named registration", () => {
    expect([...personIdsInTaskScope(seats, entities, { scope_entity_id: FUNDED })!]).toEqual(["jackie"]);
  });

  it("follows the seat when it is reassigned", () => {
    const moved = [{ seatId: "s-funded", entityId: FUNDED, holderPersonId: "colleague" }];
    expect([...personIdsInTaskScope(moved, entities, { scope_entity_id: FUNDED })!]).toEqual(["colleague"]);
  });

  /**
   * The travel bursary delegate: whoever holds the school's supported seat.
   * On the CANCOLL-funded seat too: only the person taking the bursary can
   * agree to its terms (Steve, 2026-11-05).
   */
  it("asks the holder of a bursary-designated seat, and follows a swap", () => {
    const scope = { scope_designation: "bursary_delegate" };
    expect(personIdsInTaskScope(seats, entities, scope, new Set(["s-full"]))).toEqual(new Set(["colleague"]));
    const swapped = [{ seatId: "s-full", entityId: FULL, holderPersonId: "new-buyer" }];
    expect(personIdsInTaskScope(swapped, entities, scope, new Set(["s-full"]))).toEqual(new Set(["new-buyer"]));
  });

  it("asks the holder of a designated CANCOLL-funded seat as well", () => {
    const scope = { scope_designation: "bursary_delegate" };
    const holder = seats.find((s) => s.seatId === "s-funded")?.holderPersonId;
    expect(personIdsInTaskScope(seats, entities, scope, new Set(["s-funded"]))).toEqual(new Set([holder]));
  });

  it("asks nobody when the designated seats were not loaded", () => {
    expect(personIdsInTaskScope(seats, entities, { scope_designation: "bursary_delegate" })).toEqual(new Set());
  });

  it("scopes by kind, and ANDs a kind with a named thing", () => {
    expect(personIdsInTaskScope(seats, entities, { scope_entity_kind: "booth" })).toEqual(new Set(["vendor"]));
    expect(
      personIdsInTaskScope(seats, entities, { scope_entity_kind: "booth", scope_entity_id: FUNDED })
    ).toEqual(new Set());
  });
});
