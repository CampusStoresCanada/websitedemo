/**
 * null is not zero.
 *
 * countConsecutiveTerms distinguishes "we have no record" from "they have never
 * served", and the nomination screen treats the first as unverifiable rather
 * than eligible. The whole point of the no-service marker is to let a human
 * turn the first into the second — so the thing worth pinning is that a
 * zero-length, non-counting row actually reads back as 0 and not as a term.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: { term_start: string; term_end: string | null; counts_toward_cap: boolean }[] | null = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain= {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: rows, error: null }),
      };
      return chain;
    },
  }),
}));

const BODY = "body-1";

beforeEach(() => {
  rows = [];
});

describe("countConsecutiveTerms", () => {
  it("returns null when nothing is on record", async () => {
    const { countConsecutiveTerms } = await import("../service");
    rows = [];
    expect(await countConsecutiveTerms(BODY, "p1", null)).toBeNull();
  });

  it("returns 0 for the no-service marker, not null", async () => {
    const { countConsecutiveTerms } = await import("../service");
    rows = [{ term_start: "2026-09-25", term_end: "2026-09-25", counts_toward_cap: false }];
    expect(await countConsecutiveTerms(BODY, "p1", null)).toBe(0);
  });

  it("counts real terms", async () => {
    const { countConsecutiveTerms } = await import("../service");
    rows = [
      { term_start: "2022-01-01", term_end: "2024-01-01", counts_toward_cap: true },
      { term_start: "2024-01-01", term_end: "2026-01-01", counts_toward_cap: true },
    ];
    expect(await countConsecutiveTerms(BODY, "p1", null)).toBe(2);
  });

  it("excludes a mid-term appointment that does not count", async () => {
    const { countConsecutiveTerms } = await import("../service");
    rows = [
      { term_start: "2023-06-01", term_end: "2024-01-01", counts_toward_cap: false },
      { term_start: "2024-01-01", term_end: "2026-01-01", counts_toward_cap: true },
    ];
    expect(await countConsecutiveTerms(BODY, "p1", null)).toBe(1);
  });

  it("needs a person — no identifier means no answer, not zero", async () => {
    const { countConsecutiveTerms } = await import("../service");
    expect(await countConsecutiveTerms(BODY, null, null)).toBeNull();
  });
});
