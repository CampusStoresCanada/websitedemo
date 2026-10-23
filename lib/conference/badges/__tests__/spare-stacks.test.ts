import { describe, expect, it } from "vitest";
import { spareStacks } from "../print-stock";

/**
 * ⛔ Spares are one stack per badge LOOK (Stephen, 2026-10-20) — never dealt out
 * across registration types, where small types rounded to zero.
 */
const types = [
  { entityId: "exh", name: "Exhibitor Staff", sold: 108 },
  { entityId: "cexh", name: "Connected Exhibitor Staff", sold: 68 },
  { entityId: "full", name: "Full Conference", sold: 19 },
  { entityId: "bid", name: "Big Ideas Day", sold: 2 },
  { entityId: "thu", name: "Thursday Day Pass", sold: 0 },
];
const exhibitorTypeIds = new Set(["exh", "cexh"]);
const twoLooks = (id: string) => (exhibitorTypeIds.has(id) ? "navy" : "red");

describe("spare stacks", () => {
  it("makes one stack per look, each pool to its own types", () => {
    const stacks = spareStacks({ types, exhibitorTypeIds, lookOf: twoLooks, counts: { exhibitor: 48, member: 35 } });
    expect(stacks.map((s) => [s.label, s.count, s.typeIds])).toEqual([
      ["Exhibitor", 48, ["exh", "cexh"]],
      ["Delegate", 35, ["full", "bid", "thu"]],
    ]);
  });

  it("covers a type that has sold nothing yet — it can still need a card", () => {
    const stacks = spareStacks({ types, exhibitorTypeIds, lookOf: twoLooks, counts: { exhibitor: 48, member: 35 } });
    expect(stacks.find((s) => s.typeIds.includes("thu"))?.count).toBe(35);
  });

  it("prints each stack as the best-selling type of that look", () => {
    const stacks = spareStacks({ types, exhibitorTypeIds, lookOf: twoLooks, counts: { exhibitor: 48, member: 35 } });
    expect(stacks.map((s) => s.variantTypeId)).toEqual(["exh", "full"]);
  });

  it("a third look gets a third stack, sharing its pool by seats sold", () => {
    const threeLooks = (id: string) => (exhibitorTypeIds.has(id) ? "navy" : id === "bid" ? "green" : "red");
    const stacks = spareStacks({ types, exhibitorTypeIds, lookOf: threeLooks, counts: { exhibitor: 48, member: 35 } });
    const delegate = stacks.filter((s) => s.key.startsWith("delegate"));
    expect(delegate).toHaveLength(2);
    expect(delegate.reduce((n, s) => n + s.count, 0)).toBe(35);
  });

  it("makes nothing when spares are zero", () => {
    expect(spareStacks({ types, exhibitorTypeIds, lookOf: twoLooks, counts: { exhibitor: 0, member: 0 } })).toEqual([]);
  });
});

import { renderScheduleLabel } from "../render-html";
import { DEFAULT_BADGE_TEMPLATE_CONFIG_V1, type BadgePersonRecord } from "../template";

describe("the schedule sticker for a spare", () => {
  const item = (n: number) => ({
    id: `i${n}`, name: `Session number ${n} with a reasonably long title`, kind: "session",
    dayName: `Day ${Math.floor(n / 7) + 1}`, date: "2027-02-02", startTime: "09:00", endTime: "10:00", venueName: "Vista Salon",
  });
  const person = (n: number) =>
    ({ access: null, agenda: Array.from({ length: n }, (_, i) => item(i)), qrPayload: "" }) as unknown as BadgePersonRecord;
  const template = DEFAULT_BADGE_TEMPLATE_CONFIG_V1;
  const room =
    ((template.back.qr.y - (template.back.blocks ?? []).filter((b) => b.flow)[0].y) / template.canvas.dpi) * 25.4;

  it("is as long as a short schedule, at full size", () => {
    const out = renderScheduleLabel({ template, person: person(1), widthMm: 62 });
    expect(out.heightMm).toBeGreaterThan(5);
    expect(out.heightMm).toBeLessThan(40);
    expect(out.html).toContain("scale(1.0000)");
  });

  // ⛔ Never into the QR: the roll is narrower than the card's column, so a
  // long schedule wraps more and would run past the room on the card.
  it("never runs past the room above the QR — a long one scales down", () => {
    const out = renderScheduleLabel({ template, person: person(28), widthMm: 62 });
    expect(out.heightMm).toBeLessThanOrEqual(Math.ceil(room));
  });

  it("prints nothing for nobody's schedule", () => {
    expect(renderScheduleLabel({ template, person: person(0), widthMm: 62 }).html).toBe("");
  });
});
