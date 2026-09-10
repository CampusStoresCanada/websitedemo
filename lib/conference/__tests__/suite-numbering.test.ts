import { describe, expect, it } from "vitest";

/**
 * The suite number a meeting is assigned to must be the number a person can
 * walk to.
 *
 * A suite is the meeting use of a booth of the same number — `booth --includes-->
 * suite`, 31 of them on CSC 2027, one per $6,000 booth. So the entity's NAME is
 * the only thing tying a scheduled meeting to a physical location.
 *
 * The loader derived it from `attributes.suite_number` falling back to array
 * POSITION. That attribute is only set by syncSuiteCount; 29 of the 31 were made
 * by hand and have it null. Seeding would have written 100, 101, then 3, 4, 5…
 * — colliding, and pointing nowhere.
 *
 * Mirrors lib/conference/meeting-geometry-loader.ts. Kept as a pure re-statement
 * because the loader itself needs a database.
 */
function suiteNumberOf(
  row: { name: string; attributes: Record<string, unknown> },
  index: number
): number {
  const fromAttribute = Number(row.attributes.suite_number);
  const fromName = Number(row.name);
  return Number.isFinite(fromAttribute) && fromAttribute > 0
    ? Math.floor(fromAttribute)
    : Number.isFinite(fromName) && fromName > 0
      ? Math.floor(fromName)
      : index + 1;
}

describe("a suite is numbered for the booth it is in", () => {
  it("reads the name when the attribute is absent", () => {
    // The regression: this returned 3, and a member sent to "suite 3" would be
    // looking for a booth that does not exist.
    expect(suiteNumberOf({ name: "102", attributes: {} }, 2)).toBe(102);
  });

  it("keeps every CSC 2027 suite distinct and truthful", () => {
    const csc2027 = [
      { name: "100", attributes: { suite_number: 100 } },
      { name: "101", attributes: { suite_number: 101 } },
      { name: "102", attributes: {} },
      { name: "103", attributes: {} },
      { name: "112", attributes: {} },
    ];
    const numbers = csc2027.map(suiteNumberOf);
    expect(numbers).toEqual([100, 101, 102, 103, 112]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("still prefers an explicitly set attribute over the name", () => {
    // syncSuiteCount stamps this, and an admin who set it meant it.
    expect(suiteNumberOf({ name: "999", attributes: { suite_number: 7 } }, 0)).toBe(7);
  });

  it("falls back to position only for a name that is not a number", () => {
    // No conference has one yet. Better an invented number than a crash — but
    // it must never be reached ahead of a real one.
    expect(suiteNumberOf({ name: "Boardroom", attributes: {} }, 4)).toBe(5);
  });

  it("ignores a zero or negative number rather than trusting it", () => {
    expect(suiteNumberOf({ name: "0", attributes: {} }, 3)).toBe(4);
    expect(suiteNumberOf({ name: "-2", attributes: {} }, 3)).toBe(4);
  });
});
