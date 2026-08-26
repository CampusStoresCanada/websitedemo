import { describe, it, expect } from "vitest";
import {
  shiftFor,
  markValue,
  traceLeak,
  MAX_SHIFT,
  MIN_MARKABLE_VALUE,
  type LeakObservation,
} from "../canary";

/**
 * The expensive failure here is not a leak going untraced. It is a member
 * opening the report, seeing their own revenue off by $40, and concluding the
 * whole exercise is unreliable. That costs the participation the survey exists
 * to win, so rule 1 gets tested from several directions.
 */

const A = "org-a";
const B = "org-b";
const C = "org-c";

describe("a store's own figures", () => {
  it("are never marked", () => {
    expect(
      shiftFor({ recipientOrgId: A, targetOrgId: A, fieldKey: "revenue", value: 6_489_350 }),
    ).toBe(0);
  });

  it("come back exactly as filed", () => {
    const filed = 6_489_350;
    expect(
      markValue({ recipientOrgId: A, targetOrgId: A, fieldKey: "revenue", value: filed }),
    ).toBe(filed);
  });

  it("stay unmarked across every field", () => {
    for (const f of ["revenue", "revenue_per_student", "revenue_per_sqft", "headcount"]) {
      expect(shiftFor({ recipientOrgId: A, targetOrgId: A, fieldKey: f, value: 5_000_000 })).toBe(0);
    }
  });
});

describe("how big the mark is", () => {
  it("never exceeds the cap", () => {
    for (let i = 0; i < 200; i++) {
      const s = shiftFor({
        recipientOrgId: `r${i}`,
        targetOrgId: B,
        fieldKey: "revenue",
        value: 6_489_350,
      });
      expect(Math.abs(s)).toBeLessThanOrEqual(MAX_SHIFT);
    }
  });

  it("is invisible as a proportion of the figure", () => {
    const value = 6_489_350;
    const s = shiftFor({ recipientOrgId: A, targetOrgId: B, fieldKey: "revenue", value });
    // Under a thousandth of a percent. Nobody re-forecasts on this.
    expect(Math.abs(s) / value).toBeLessThan(0.00002);
  });

  it("cannot reorder two stores — the closest real pair differs by thousands", () => {
    // Two stores $5,000 apart, the tightest gap worth worrying about.
    const lower = 2_000_000;
    const upper = 2_005_000;
    for (let i = 0; i < 100; i++) {
      const r = `r${i}`;
      const l = markValue({ recipientOrgId: r, targetOrgId: B, fieldKey: "revenue", value: lower })!;
      const u = markValue({ recipientOrgId: r, targetOrgId: C, fieldKey: "revenue", value: upper })!;
      expect(l).toBeLessThan(u);
    }
  });
});

describe("what is left alone", () => {
  it("ignores figures below the floor, where a shift would show", () => {
    expect(
      shiftFor({ recipientOrgId: A, targetOrgId: B, fieldKey: "revenue", value: 50_000 }),
    ).toBe(0);
  });

  it("ignores ratios — $50 on revenue-per-student is an error, not a mark", () => {
    expect(
      shiftFor({ recipientOrgId: A, targetOrgId: B, fieldKey: "revenue_per_student", value: 228 }),
    ).toBe(0);
  });

  it("passes nulls through", () => {
    expect(
      markValue({ recipientOrgId: A, targetOrgId: B, fieldKey: "revenue", value: null }),
    ).toBeNull();
  });

  it("marks a figure at the floor", () => {
    const s = shiftFor({
      recipientOrgId: A,
      targetOrgId: B,
      fieldKey: "revenue",
      value: MIN_MARKABLE_VALUE,
    });
    expect(Math.abs(s)).toBeGreaterThan(0);
  });
});

describe("stability", () => {
  it("gives the same recipient the same figure every time", () => {
    const args = { recipientOrgId: A, targetOrgId: B, fieldKey: "revenue", value: 6_489_350 };
    const first = markValue(args);
    for (let i = 0; i < 50; i++) expect(markValue(args)).toBe(first);
  });

  it("gives different recipients different figures", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 52; i++) {
      seen.add(
        markValue({
          recipientOrgId: `member-${i}`,
          targetOrgId: B,
          fieldKey: "revenue",
          value: 6_489_350,
        })!,
      );
    }
    // 52 recipients over 121 possible shifts: collisions exist, which is why a
    // trace uses several figures rather than one. Most must still differ.
    expect(seen.size).toBeGreaterThan(35);
  });
});

describe("tracing a leak", () => {
  const recipients = Array.from({ length: 52 }, (_, i) => `member-${i}`);
  const truth: { targetOrgId: string; fieldKey: string; trueValue: number }[] = [
    { targetOrgId: B, fieldKey: "revenue", trueValue: 6_489_350 },
    { targetOrgId: C, fieldKey: "revenue", trueValue: 4_556_582 },
    { targetOrgId: "org-d", fieldKey: "revenue", trueValue: 2_403_194 },
    { targetOrgId: "org-e", fieldKey: "revenue", trueValue: 10_827_161 },
  ];

  function leakFrom(recipientOrgId: string): LeakObservation[] {
    return truth.map((t) => ({
      ...t,
      observedValue: markValue({ recipientOrgId, ...t, value: t.trueValue })!,
    }));
  }

  it("identifies the culprit outright from four figures", () => {
    const ranked = traceLeak(leakFrom("member-17"), recipients);
    expect(ranked[0].recipientOrgId).toBe("member-17");
    expect(ranked[0].matched).toBe(4);
    // And nobody else explains all four.
    expect(ranked.filter((r) => r.matched === 4)).toHaveLength(1);
  });

  it("never loses the real recipient, however few figures leaked", () => {
    // The guarantee that matters is no false negatives: whoever it was must
    // always survive. How many others survive alongside them is luck of the
    // hash — sometimes one figure is enough, sometimes it is a shortlist — and
    // that is the caller's problem to read, not a property to assert.
    for (const who of ["member-3", "member-20", "member-51"]) {
      const ranked = traceLeak(leakFrom(who).slice(0, 1), recipients);
      const survivors = ranked.filter((r) => r.markable > 0 && r.matched === r.markable);
      expect(survivors.map((r) => r.recipientOrgId)).toContain(who);
    }
  });

  it("an UNALTERED figure clears almost everyone — it points at the store itself", () => {
    // A store sees its own figures unmarked, so an unaltered leak is evidence
    // the source was the store whose numbers they are. Every recipient whose
    // fingerprint would have altered it is excluded outright.
    const observations: LeakObservation[] = [
      { targetOrgId: B, fieldKey: "revenue", trueValue: 6_489_350, observedValue: 6_489_350 },
    ];
    const ranked = traceLeak(observations, recipients);
    const excluded = ranked.filter((r) => r.markable > 0 && r.matched === 0);
    expect(excluded.length).toBeGreaterThanOrEqual(50);
  });

  it("treats a coincidental zero shift as no evidence, not as a match", () => {
    // Roughly one recipient in 121 draws a zero shift on a given figure. They
    // cannot be implicated by an unaltered value and must not be scored as
    // agreeing with it either — silence is not confirmation.
    const observations: LeakObservation[] = [
      { targetOrgId: B, fieldKey: "revenue", trueValue: 6_489_350, observedValue: 6_489_350 },
    ];
    const ranked = traceLeak(observations, recipients);
    const noEvidence = ranked.filter((r) => r.markable === 0);
    expect(noEvidence.every((r) => r.matched === 0)).toBe(true);
  });

  it("returns every candidate, never a bare answer", () => {
    const ranked = traceLeak(leakFrom("member-9"), recipients);
    expect(ranked).toHaveLength(52);
  });
});
