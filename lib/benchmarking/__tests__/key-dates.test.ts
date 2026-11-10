import { describe, it, expect } from "vitest";
import { keyDateYear, isLegacyKeyDate } from "../key-dates";

/*
  The one rule that decides which block a stored key date belongs to.

  It exists because the survey form and the printed worksheet both group the
  same rows, and a second copy of this is how they would come to disagree about
  where a store's own date went. Tested on its own so neither caller has to be
  running for the rule to be checked.

  Background: the question asked for "the year ahead" until 2026-11-10, when
  Karin Stonehouse asked which year it actually wanted. Of the ten stores that
  had entered semester dates, five had read it each way.
*/
describe("keyDateYear", () => {
  const FY = 2026;

  it("files a declared reported year under reported", () => {
    expect(keyDateYear(2026, FY)).toBe("reported");
  });

  it("files a declared next year under ahead", () => {
    expect(keyDateYear(2027, FY)).toBe("ahead");
  });

  /*
    ⛔ The decision Steve made on 2026-11-10: rows carrying no year were
    entered under directions that said "the year ahead", so that is what they
    were answering. Not a guess about the row, an application of the
    instruction that was on screen when it was written.
  */
  it("files a year-less row under ahead, per the directions in force", () => {
    expect(keyDateYear(null, FY)).toBe("ahead");
  });

  /*
    An older year still reads as historical rather than ahead. A store
    reporting FY2026 that kept an FY2024 date has not given us a future date,
    and bucketing it forward would put a two-year-old deadline in the block CSC
    plans from.
  */
  it("treats an older declared year as reported, not ahead", () => {
    expect(keyDateYear(2024, FY)).toBe("reported");
  });

  it("moves with the survey year rather than a fixed date", () => {
    expect(keyDateYear(2027, 2027)).toBe("reported");
    expect(keyDateYear(2028, 2027)).toBe("ahead");
  });
});

describe("isLegacyKeyDate", () => {
  it("is true only for a row that never declared a year", () => {
    expect(isLegacyKeyDate(null)).toBe(true);
    expect(isLegacyKeyDate(2026)).toBe(false);
    expect(isLegacyKeyDate(2027)).toBe(false);
  });

  /*
    The distinction the whole approach rests on. A legacy row and a row a store
    deliberately filed under next year both sit in the ahead block, but only
    the legacy one is offered the correction — and only the legacy one would
    become a permanent falsehood if we backfilled a year into it.
  */
  it("separates a placed row from a declared one", () => {
    expect(keyDateYear(null, 2026)).toBe(keyDateYear(2027, 2026));
    expect(isLegacyKeyDate(null)).not.toBe(isLegacyKeyDate(2027));
  });
});
