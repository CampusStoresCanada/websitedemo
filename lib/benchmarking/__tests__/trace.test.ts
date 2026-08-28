import { describe, it, expect } from "vitest";
import { buildTraceReport, type ResolvedObservation } from "../trace";
import { markValue } from "../canary";

/**
 * The failure that costs most here is not a leak going untraced. It is
 * accusing the wrong member. A trace starts a conversation with a store that
 * pays to be here, so a coincidence presented as a finding is expensive in a
 * way a shortlist never is.
 */

const RECIPIENTS = Array.from({ length: 12 }, (_, i) => ({
  organizationId: `member-${i}`,
  organizationName: `Member ${i}`,
  viewedReport: i % 2 === 0,
  wasRecipient: true,
}));

const TARGETS = [
  { organizationId: "store-a", organizationName: "Store A", fieldKey: "revenue", trueValue: 6_489_350 },
  { organizationId: "store-b", organizationName: "Store B", fieldKey: "revenue", trueValue: 4_556_582 },
  { organizationId: "store-c", organizationName: "Store C", fieldKey: "revenue", trueValue: 10_827_161 },
];

/** The figures a given recipient's copy would have shown. */
const leakFrom = (who: string): ResolvedObservation[] =>
  TARGETS.map((t) => ({
    organizationId: t.organizationId,
    organizationName: t.organizationName,
    fieldKey: t.fieldKey,
    observedValue: markValue({
      recipientOrgId: who,
      targetOrgId: t.organizationId,
      fieldKey: t.fieldKey,
      value: t.trueValue,
    })!,
    trueValue: t.trueValue,
    markable: true,
    note: null,
  }));

describe("reading a leaked copy", () => {
  it("finds the recipient it was prepared for", () => {
    const r = buildTraceReport({
      fiscalYear: 2025,
      observations: leakFrom("member-7"),
      candidates: RECIPIENTS,
    });
    expect(r.survivors.map((s) => s.organizationId)).toContain("member-7");
  });

  it("rules out everyone whose copy would have differed", () => {
    // Exclusion is the reliable half: a recipient whose fingerprint disagrees
    // on even one figure could not have produced this document.
    const r = buildTraceReport({
      fiscalYear: 2025,
      observations: leakFrom("member-3"),
      candidates: RECIPIENTS,
    });
    expect(r.candidates.filter((c) => c.verdict === "excluded").length).toBeGreaterThan(8);
  });

  it("reports a tie as a tie rather than picking the first row", () => {
    const r = buildTraceReport({
      fiscalYear: 2025,
      observations: leakFrom("member-5"),
      candidates: RECIPIENTS,
    });
    if (r.survivors.length > 1) {
      expect(r.summary).toMatch(/tie/i);
    } else {
      expect(r.summary).toMatch(/strong lead|not proof/i);
    }
  });

  it("never states a conclusion as proof", () => {
    const r = buildTraceReport({
      fiscalYear: 2025,
      observations: leakFrom("member-2"),
      candidates: RECIPIENTS,
    });
    expect(r.summary).not.toMatch(/\bculprit\b|\bguilty\b|\bproves\b/i);
  });
});

describe("refusing to guess", () => {
  it("says so when nothing carries a mark", () => {
    const tooSmall: ResolvedObservation[] = [
      {
        organizationId: "store-a",
        organizationName: "Store A",
        fieldKey: "revenue_per_student",
        observedValue: 315,
        trueValue: 315,
        markable: false,
        note: "Too small to carry a mark",
      },
    ];
    const r = buildTraceReport({ fiscalYear: 2025, observations: tooSmall, candidates: RECIPIENTS });
    expect(r.markableCount).toBe(0);
    expect(r.survivors).toHaveLength(0);
    expect(r.summary).toMatch(/cannot narrow the field/i);
  });

  it("excludes everyone when a figure was transcribed wrongly", () => {
    // One wrong digit must not quietly resolve to the nearest candidate.
    const bad = leakFrom("member-4");
    bad[0] = { ...bad[0], observedValue: bad[0].observedValue + 7 };
    const r = buildTraceReport({ fiscalYear: 2025, observations: bad, candidates: RECIPIENTS });
    expect(r.survivors).toHaveLength(0);
    expect(r.summary).toMatch(/transcribed wrongly|not taken from/i);
  });

  it("does not treat an unmarkable figure as agreement", () => {
    const r = buildTraceReport({
      fiscalYear: 2025,
      observations: [{ ...leakFrom("member-1")[0], markable: false }],
      candidates: RECIPIENTS,
    });
    expect(r.markableCount).toBe(0);
    expect(r.candidates.every((c) => c.matched === 0)).toBe(true);
  });
});
