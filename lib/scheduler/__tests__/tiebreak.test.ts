import { describe, expect, it } from "vitest";
import { deterministicOrder } from "../tiebreak";

describe("deterministicOrder", () => {
  it("is reproducible for same seed and inputs", () => {
    const input = ["a", "b", "c", "d"];
    const first = deterministicOrder(input, 42, (item) => item);
    const second = deterministicOrder(input, 42, (item) => item);
    expect(first).toEqual(second);
  });

  it("changes order with different seeds", () => {
    const input = ["a", "b", "c", "d"];
    const first = deterministicOrder(input, 42, (item) => item);
    const second = deterministicOrder(input, 7, (item) => item);
    expect(first).not.toEqual(second);
  });
});
