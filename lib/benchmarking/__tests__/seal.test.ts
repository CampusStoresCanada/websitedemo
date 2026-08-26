import { describe, it, expect } from "vitest";
import { sealStateFor, sealMessage, type SurveyStatusRow } from "../seal";

/**
 * The rule has two ways to fail and they cost opposite things.
 *
 * Sealing too early takes away a store's right to withdraw while the cycle is
 * still live — the right that made late withdrawal safe to offer at all.
 * Sealing too late lets a store's name vanish from a comparison other members
 * have already read and acted on.
 */

const surveys = (rows: [number, string][]): SurveyStatusRow[] =>
  rows.map(([fiscal_year, status]) => ({ fiscal_year, status }));

describe("while the cycle is live", () => {
  it("is open when no successor survey exists at all", () => {
    expect(sealStateFor(2026, surveys([[2026, "open"]])).sealed).toBe(false);
  });

  it("stays open while the successor is only a draft", () => {
    // Creating next year's record is planning, not publishing.
    expect(sealStateFor(2026, surveys([[2027, "draft"]])).sealed).toBe(false);
  });

  it("stays open while the successor is in BETA", () => {
    // Beta is a handful of named stores filing early so we can fix what breaks.
    // Nothing is published from it, and sealing on that would be sealing on a
    // rehearsal.
    expect(sealStateFor(2026, surveys([[2027, "beta"]])).sealed).toBe(false);
  });

  it("stays open when a survey for the SAME year is open", () => {
    // A year does not seal itself. This is the case that would silently freeze
    // every store the moment collection began.
    expect(sealStateFor(2026, surveys([[2026, "open"]])).sealed).toBe(false);
  });

  it("stays open when an EARLIER year is open", () => {
    expect(sealStateFor(2026, surveys([[2025, "open"]])).sealed).toBe(false);
  });
});

describe("once the successor opens", () => {
  it("seals", () => {
    const s = sealStateFor(2026, surveys([[2027, "open"]]));
    expect(s.sealed).toBe(true);
    expect(s.sealedByFiscalYear).toBe(2027);
  });

  it("STAYS sealed after the successor closes", () => {
    // The trap: reading status === 'open' alone would unseal 2026 the day 2027
    // stopped collecting, which is the exact opposite of what sealing means.
    for (const later of ["closed", "processing", "complete"]) {
      expect(sealStateFor(2026, surveys([[2027, later]])).sealed).toBe(true);
    }
  });

  it("names the earliest successor that opened, not the newest", () => {
    // 2028 being open does not change the fact that 2026 froze when 2027 did.
    const s = sealStateFor(
      2026,
      surveys([
        [2027, "complete"],
        [2028, "open"],
      ]),
    );
    expect(s.sealedByFiscalYear).toBe(2027);
  });

  it("seals a year whose immediate successor was skipped", () => {
    // No 2027 cycle ever ran; 2028 opened. 2026 is still historic and must
    // freeze — a gap in the series is not a licence to keep editing.
    const s = sealStateFor(2026, surveys([[2028, "open"]]));
    expect(s.sealed).toBe(true);
    expect(s.sealedByFiscalYear).toBe(2028);
  });
});

describe("what the store is told", () => {
  it("says nothing while the year is still open", () => {
    expect(sealMessage(sealStateFor(2026, surveys([[2027, "draft"]])))).toBeNull();
  });

  it("names both years and points at what they CAN still change", () => {
    const msg = sealMessage(sealStateFor(2026, surveys([[2027, "open"]])))!;
    expect(msg).toContain("FY2026");
    expect(msg).toContain("FY2027");
    // A refusal that does not say what to do instead is just a wall.
    expect(msg).toMatch(/FY2027 submission is where to set this/);
  });
});
