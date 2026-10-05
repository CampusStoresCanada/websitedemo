import { describe, it, expect } from "vitest";
import { iaEaContradiction } from "@/lib/benchmarking/iaea-consistency";

const withFormat = [{ department: "Inclusive or Equitable Access" }];
const withoutFormat = [{ department: "Print — New" }];

describe("Inclusive and Equitable Access consistency", () => {
  it("flags a store that sells through a program it says it does not run", () => {
    expect(
      iaEaContradiction({
        courseMaterialCategories: withFormat,
        programType: "Neither",
      }),
    ).toMatch(/Section 3 has an Inclusive or Equitable Access line/);
  });

  it("says nothing when the store names its program", () => {
    for (const type of ["Inclusive Access", "Equitable Access", "Both"]) {
      expect(
        iaEaContradiction({
          courseMaterialCategories: withFormat,
          programType: type,
        }),
      ).toBeNull();
    }
  });

  it("says nothing when there is no such format in section 3", () => {
    expect(
      iaEaContradiction({
        courseMaterialCategories: withoutFormat,
        programType: "Neither",
      }),
    ).toBeNull();
  });

  it("holds its tongue while section 10 is unanswered", () => {
    // Mid-survey is not a contradiction. Flagging an unanswered question as a
    // disagreement would accuse a store of an error it has not made yet.
    expect(
      iaEaContradiction({
        courseMaterialCategories: withFormat,
        programType: null,
      }),
    ).toBeNull();
  });
});
