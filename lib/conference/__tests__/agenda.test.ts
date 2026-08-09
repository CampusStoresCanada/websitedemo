import { describe, expect, it } from "vitest";

import type { BuildEntity, EntityRefView } from "../../actions/conference-entities";
import { deriveAgenda } from "../agenda";

type RefSpec = [role: string, toId: string, toName: string, toKind: string];

function ent(
  id: string,
  kind: string,
  name: string,
  attributes: Record<string, string | number | null>,
  refs: RefSpec[] = []
): BuildEntity {
  return {
    id,
    kind,
    name,
    isForSale: false,
    priceCents: null,
    currency: "CAD",
    attributes,
    needsDefinition: false,
    inventory: null,
    qboItemId: null,
    salesWindow: null,
    tierPrices: {},
    refs: refs.map<EntityRefView>(([role, toEntityId, toName, toKind]) => ({
      role,
      toEntityId,
      toName,
      toKind,
      quantity: null,
    })),
  };
}

// A small but representative slice of the real catalog: two days, a couple of
// trade-show blocks, meals that nest different ways, an event with an included
// dinner, plus structural things that must NOT appear on the agenda.
function fixture(): BuildEntity[] {
  return [
    ent("day-tue", "day", "Tue, Feb 2", { date: "2027-02-02" }),
    ent("day-thu", "day", "Thu, Feb 4", { date: "2027-02-04" }),

    ent("ts-tue", "session", "Trade Show Tuesday", { start_time: "09:00", end_time: "15:30" }, [
      ["when", "day-tue", "Tue, Feb 2", "day"],
    ]),
    ent("lunch-tue", "meal", "Lunch - Tuesday", { start_time: "12:00", end_time: "12:45" }, [
      ["when", "day-tue", "Tue, Feb 2", "day"],
      ["where", "vista", "Vista Salon", "venue"],
      ["who", "aud-member", "Member", "audience"],
    ]),
    ent("bfast-tue", "meal", "Breakfast - Tuesday", { start_time: "08:00", end_time: "09:00" }, [
      ["when", "day-tue", "Tue, Feb 2", "day"],
    ]),
    ent("recep", "event", "Meet & Greet Reception", { start_time: "17:30", end_time: "21:00" }, [
      ["when", "day-tue", "Tue, Feb 2", "day"],
      ["includes", "dinner", "Dinner", "meal"],
    ]),
    ent("dinner", "meal", "Dinner", { start_time: "18:30", end_time: "20:00" }, [
      ["when", "day-tue", "Tue, Feb 2", "day"],
    ]),

    // Thursday lunch's `when` points at the trade-show block (a session), not a
    // day — date must resolve transitively, and it must nest under the block.
    ent("ts-thu", "session", "Trade Show Thursday", { start_time: "09:00", end_time: "14:00" }, [
      ["when", "day-thu", "Thu, Feb 4", "day"],
    ]),
    ent("lunch-thu", "meal", "Lunch - Thursday", { start_time: "12:00", end_time: "13:30" }, [
      ["when", "ts-thu", "Trade Show Thursday", "session"],
    ]),

    // Structural — never agenda rows.
    ent("vista", "venue", "Vista Salon", { capacity: 400 }),
    ent("601", "booth", "601", { number: "601" }),
    ent("aud-member", "audience", "Member", { source_role: "member" }),
  ];
}

describe("deriveAgenda", () => {
  const agenda = deriveAgenda(fixture(), "America/Toronto");
  const byId = new Map(agenda.map((a) => [a.id, a]));

  it("includes only scheduled things, never structural ones", () => {
    const ids = new Set(agenda.map((a) => a.id));
    expect(ids).toEqual(
      new Set(["ts-tue", "lunch-tue", "bfast-tue", "recep", "dinner", "ts-thu", "lunch-thu"])
    );
    for (const structural of ["day-tue", "day-thu", "vista", "601", "aud-member"]) {
      expect(ids.has(structural)).toBe(false);
    }
  });

  it("resolves the day directly and through a transitive `when` chain", () => {
    expect(byId.get("ts-tue")!.dayKey).toBe("2027-02-02");
    expect(byId.get("lunch-thu")!.dayKey).toBe("2027-02-04"); // via ts-thu → day-thu
  });

  it("computes DST-correct absolute instants", () => {
    expect(byId.get("ts-tue")!.startsAtUtc).toBe("2027-02-02T14:00:00.000Z"); // 09:00 EST
    expect(byId.get("ts-tue")!.endsAtUtc).toBe("2027-02-02T20:30:00.000Z"); // 15:30 EST
  });

  it("nests a meal inside a containing block by time", () => {
    expect(byId.get("lunch-tue")!.parentId).toBe("ts-tue");
    expect(byId.get("lunch-tue")!.depth).toBe(1);
  });

  it("nests via an explicit `when` at a timed thing", () => {
    expect(byId.get("lunch-thu")!.parentId).toBe("ts-thu");
  });

  it("nests via an `includes` edge", () => {
    expect(byId.get("dinner")!.parentId).toBe("recep");
  });

  it("keeps non-contained and container rows at the top level", () => {
    expect(byId.get("bfast-tue")!.parentId).toBeNull(); // 08:00–09:00 starts before the block
    expect(byId.get("ts-tue")!.parentId).toBeNull();
    expect(byId.get("recep")!.parentId).toBeNull();
  });

  it("carries where/who metadata", () => {
    expect(byId.get("lunch-tue")!.locationLabel).toBe("Vista Salon");
    expect(byId.get("lunch-tue")!.audienceNames).toEqual(["Member"]);
  });
});
