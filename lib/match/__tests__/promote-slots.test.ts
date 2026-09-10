import { describe, it, expect } from "vitest";
import { promoteIntoSlots } from "../edge-view";

type Row = { id: string; isNew?: boolean };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, isNew: id.startsWith("n") }));
const ids = (out: { item: Row }[]) => out.map((o) => o.item.id);

describe("promoteIntoSlots", () => {
  it("lifts one promoted candidate in and pushes the displaced one DOWN, never out", () => {
    // "d" loses its slot to "n1" and moves below it. It must not disappear: a
    // member asking for ten suggestions would silently get nine, and the thing
    // thrown away is the best one we had left to say.
    const list = rows("a", "b", "c", "d", "n1");
    const out = promoteIntoSlots(list, (r) => !!r.isNew, { slots: 1, within: 4 });
    expect(ids(out)).toEqual(["a", "b", "c", "n1", "d"]);
    expect(out.find((o) => o.item.id === "n1")!.promoted).toBe(true);
    expect(out.find((o) => o.item.id === "d")!.promoted).toBe(false);
  });

  it("⛔ changes NOTHING when one already ranks there on merit", () => {
    // A promotion that fires when the candidate would have made it anyway is a
    // thumb pressing on its own side, and makes the boost impossible to judge.
    const list = rows("n1", "a", "b", "c", "n2");
    const out = promoteIntoSlots(list, (r) => !!r.isNew, { slots: 1, within: 4 });
    expect(ids(out)).toEqual(["n1", "a", "b", "c", "n2"]);
    expect(out.every((o) => !o.promoted)).toBe(true);
  });

  it("is bounded — exactly `slots` positions move, never the whole list", () => {
    const list = rows("a", "b", "c", "d", "e", "n1", "n2", "n3");
    const out = promoteIntoSlots(list, (r) => !!r.isNew, { slots: 2, within: 5 });
    // The measured failure of the multiplier: 7 of the top 8 replaced. Not here.
    expect(ids(out).slice(0, 5)).toEqual(["a", "b", "c", "n1", "n2"]);
    expect(out.filter((o) => o.promoted)).toHaveLength(2);
    // Everything else survives, in order, below the promoted pair.
    expect(ids(out)).toEqual(["a", "b", "c", "n1", "n2", "d", "e", "n3"]);
  });

  it("keeps the list the same length and loses nobody", () => {
    const list = rows("a", "b", "c", "d", "n1", "n2");
    const out = promoteIntoSlots(list, (r) => !!r.isNew, { slots: 2, within: 4 });
    expect(out).toHaveLength(list.length);
    expect(new Set(ids(out))).toEqual(new Set(list.map((r) => r.id)));
  });

  it("does nothing when there is nobody to promote", () => {
    const list = rows("a", "b", "c");
    expect(ids(promoteIntoSlots(list, (r) => !!r.isNew, { slots: 2 }))).toEqual(["a", "b", "c"]);
  });

  it("is deterministic — same input, same list", () => {
    const list = rows("a", "b", "c", "d", "n1", "n2", "n3");
    const once = ids(promoteIntoSlots(list, (r) => !!r.isNew, { slots: 2, within: 4 }));
    const twice = ids(promoteIntoSlots(list, (r) => !!r.isNew, { slots: 2, within: 4 }));
    expect(once).toEqual(twice);
  });

  it("promotes nothing when slots is zero", () => {
    const list = rows("a", "n1");
    expect(promoteIntoSlots(list, (r) => !!r.isNew, { slots: 0 }).every((o) => !o.promoted)).toBe(true);
  });
});
