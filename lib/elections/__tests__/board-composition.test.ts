/**
 * What the board would look like, not just what the nominees add.
 *
 * The panel showed the nominee pool against the membership and stopped there.
 * A committee asking "would this board still have a college on it" had to do
 * the arithmetic in their head against a roster held somewhere else.
 *
 * ⚠️ The two readings have DIFFERENT denominators and must never share a bar.
 * Nominees are a share of the membership; the board is a share of the board.
 */
import { describe, it, expect } from "vitest";
import { buildRepresentationSnapshot, type OrgProfile } from "../representation";

const org = (name: string, province: string, fte: number | null, type: string): OrgProfile => ({
  organizationId: name,
  name,
  province,
  fte,
  institutionTypeConfirmed: type,
});

const UNI_EAST = org("East U", "Ontario", 30_000, "university");
const COLLEGE_WEST = org("West College", "Alberta", 4_000, "college");
const UNI_WEST = org("West U", "Alberta", 25_000, "university");

const membership = [UNI_EAST, COLLEGE_WEST, UNI_WEST];

describe("the board projection", () => {
  it("adds the nominees to the directors who continue", () => {
    const s = buildRepresentationSnapshot([COLLEGE_WEST], membership, [UNI_EAST, UNI_WEST], 2);
    expect(s.continuingCount).toBe(2);
    expect(s.boardSize).toBe(3);

    const type = s.dimensions.find((d) => d.key === "institution_type")!;
    expect(type.board.college).toBe(1);
    expect(type.board.university).toBe(2);
  });

  it("keeps the nominee counts a share of the MEMBERSHIP, untouched", () => {
    const s = buildRepresentationSnapshot([COLLEGE_WEST], membership, [UNI_EAST, UNI_WEST], 2);
    const type = s.dimensions.find((d) => d.key === "institution_type")!;
    expect(type.nominees.college).toBe(1);
    expect(type.membership.college).toBe(1);
    expect(type.membership.university).toBe(2);
  });

  it("counts a continuing director's institution once, not twice", () => {
    // The same institution continuing AND nominating is two seats, not one.
    const s = buildRepresentationSnapshot([UNI_EAST], membership, [UNI_EAST], 2);
    const type = s.dimensions.find((d) => d.key === "institution_type")!;
    expect(type.board.university).toBe(2);
    expect(s.boardSize).toBe(2);
  });

  it("covers every dimension, not only institution type", () => {
    const s = buildRepresentationSnapshot([COLLEGE_WEST], membership, [UNI_EAST], 2);
    for (const d of s.dimensions) {
      expect(Object.keys(d.board).length).toBeGreaterThan(0);
    }
    expect(s.dimensions.find((d) => d.key === "region")!.board.western).toBe(1);
    expect(s.dimensions.find((d) => d.key === "region")!.board.eastern).toBe(1);
  });
});

describe("certainty versus ceiling", () => {
  it("is a certainty when no more stand than there are seats", () => {
    expect(buildRepresentationSnapshot([COLLEGE_WEST], membership, [UNI_EAST], 2).everyNomineeFits)
      .toBe(true);
  });

  it("is a ceiling when more stand than there are seats", () => {
    const s = buildRepresentationSnapshot(
      [COLLEGE_WEST, UNI_WEST, UNI_EAST],
      membership,
      [UNI_EAST],
      2
    );
    expect(s.everyNomineeFits).toBe(false);
  });
});

describe("callers that have not been updated", () => {
  it("still work, and simply show no board", () => {
    const s = buildRepresentationSnapshot([COLLEGE_WEST], membership);
    expect(s.continuingCount).toBe(0);
    expect(s.boardSize).toBe(1);
    expect(s.dimensions.every((d) => d.board !== undefined)).toBe(true);
  });
});
