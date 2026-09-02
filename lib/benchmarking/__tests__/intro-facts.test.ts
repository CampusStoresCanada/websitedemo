import { describe, it, expect } from "vitest";
import {
  surveyScope,
  confidentialityPoints,
  DELIVERABLES,
  WHAT_TO_GATHER,
} from "../intro-facts";
import { DEFAULT_FIELD_CONFIG } from "../default-field-config";
import { MIN_CUT_SIZE } from "../disclosure";

/**
 * This page is read by a store deciding whether to hand over its financials.
 * Every assertion here exists because an overstatement on that page is not a
 * cosmetic bug — it is the thing the page is for, failing.
 */

describe("the scope we quote", () => {
  it("is measured from the config that actually renders", () => {
    const s = surveyScope(DEFAULT_FIELD_CONFIG);
    expect(s.sections).toBe(DEFAULT_FIELD_CONFIG.sections.length);
    expect(s.fields).toBe(
      DEFAULT_FIELD_CONFIG.sections.reduce((n, sec) => n + sec.fields.length, 0),
    );
  });

  it("cannot drift from the form", () => {
    // The number on the page moves when a section is added, because it is
    // derived rather than typed. This is the whole reason it is a function.
    const trimmed = {
      ...DEFAULT_FIELD_CONFIG,
      sections: DEFAULT_FIELD_CONFIG.sections.slice(0, 2),
    };
    expect(surveyScope(trimmed).sections).toBe(2);
    expect(surveyScope(trimmed).fields).toBeLessThan(surveyScope(DEFAULT_FIELD_CONFIG).fields);
  });

  it("counts the financial fields separately, because those are the work", () => {
    const s = surveyScope(DEFAULT_FIELD_CONFIG);
    expect(s.financialFields).toBeGreaterThan(0);
    expect(s.financialFields).toBeLessThanOrEqual(s.fields);
  });
});

describe("the confidentiality promises", () => {
  it("quotes the minimum group size from the constant that enforces it", () => {
    const points = confidentialityPoints(MIN_CUT_SIZE);
    expect(points.some((p) => p.heading.includes(String(MIN_CUT_SIZE)))).toBe(true);
    // If someone raises the threshold, the page follows without an edit.
    expect(confidentialityPoints(7).some((p) => p.heading.includes("7"))).toBe(true);
  });

  it("never promises anonymity, only that figures are unnamed", () => {
    // Aggregate-only is not anonymity — a store can be identified by
    // subtraction, which is why the minimum-group rule exists. Saying
    // "anonymous" would be the one word on this page we cannot stand behind.
    const text = confidentialityPoints().map((p) => p.heading + " " + p.body).join(" ");
    expect(text).not.toMatch(/\banonymous(ly)?\b(?!, it is)/i);
  });

  it("says the store's own figures are never altered", () => {
    // The marks make forwarded copies traceable. A store must not be left
    // wondering whether we changed what it filed.
    const text = confidentialityPoints().map((p) => p.body).join(" ");
    expect(text).toMatch(/your own figures are never altered/i);
  });
});

describe("what we promise to deliver", () => {
  it("marks every item as built or not, with no third state", () => {
    for (const d of DELIVERABLES) expect(typeof d.built).toBe("boolean");
  });

  it("has at least one thing that exists today", () => {
    // A page listing only future promises is a prospectus, not a survey intro.
    expect(DELIVERABLES.filter((d) => d.built).length).toBeGreaterThan(0);
  });

  it("DOES promise year-over-year this cycle, because FY2025 is on file", () => {
    // I originally marked this 2027, conflating "first year collected through
    // this system" with "first year we have data for". All 39 FY2025 rows carry
    // revenue, COGS, net profit, HR expense and online sales, so every metric in
    // YOY_METRICS has a 2025 baseline and movement lands with the 2026 results.
    const yoy = DELIVERABLES.find((d) => /year-over-year/i.test(d.title))!;
    expect(yoy.built).toBe(true);
    expect(yoy.when).not.toBe("2027");
  });

  it("still holds inventory metrics back to 2027, for a real reason", () => {
    // Different constraint entirely: GMROI and turns average TWO year-end
    // inventory figures, and fye_inventory_value is null for all 39 FY2025
    // rows — the question was not asked. First pair is 2026 and 2027.
    const inv = DELIVERABLES.find((d) => /GMROI/i.test(d.title))!;
    expect(inv.built).toBe(false);
    expect(inv.when).toBe("2027");
  });

  it("keeps the PDF package honestly flagged as not yet built", () => {
    // Committed for this cycle, and not shipped at the time of writing. If
    // this flips to true, the route has to exist.
    const pdf = DELIVERABLES.find((d) => /PDF/i.test(d.title))!;
    expect(pdf.built).toBe(false);
  });
});

describe("what a store needs to hand", () => {
  it("names the year-end statements first, since that is the blocker", () => {
    expect(WHAT_TO_GATHER[0]).toMatch(/year-end financial statements/i);
  });

  it("states no completion time", () => {
    // We have never measured one: the 2025 cycle was collected outside this
    // system and its rows carry a backfill timestamp. Inventing a number would
    // make the first sentence on the trust page the first promise we break.
    const text = WHAT_TO_GATHER.join(" ");
    expect(text).not.toMatch(/\b\d+\s*(minutes|mins|hours|hrs)\b/i);
  });
});
