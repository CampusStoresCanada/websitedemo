import { describe, expect, it } from "vitest";
import {
  redactFigures,
  REDACTED_CURRENCY,
  REDACTED_PERCENT,
  REDACTED_COUNT,
} from "../figures";
import { PRESENTATION_LEVELS } from "../mode";

describe("redactFigures", () => {
  it("passes figures straight through when nobody is presenting", () => {
    const f = redactFigures(null);

    expect(f.redacting).toBe(false);
    expect(f.currency("$1.2M")).toBe("$1.2M");
    expect(f.percent("12.4%")).toBe("12.4%");
    expect(f.count("18,400")).toBe("18,400");
  });

  it("replaces figures with tokens while presenting", () => {
    const f = redactFigures("member");

    expect(f.redacting).toBe(true);
    expect(f.currency("$1.2M")).toBe(REDACTED_CURRENCY);
    expect(f.percent("12.4%")).toBe(REDACTED_PERCENT);
    expect(f.count("18,400")).toBe(REDACTED_COUNT);
  });

  it("redacts at every audience, not just member", () => {
    for (const level of PRESENTATION_LEVELS) {
      expect(redactFigures(level).currency("$980K")).toBe(REDACTED_CURRENCY);
    }
  });

  /**
   * ⛔ The edit-mode opt-out. A store correcting a figure has to see the figure;
   * redacting it is how a wrong number ends up in the record.
   */
  it("never redacts while the field is editable", () => {
    const f = redactFigures("member", true);

    expect(f.redacting).toBe(false);
    expect(f.currency("$1.2M")).toBe("$1.2M");
  });

  /**
   * "—" and "N/A" mean "we do not hold this", which is a different statement
   * from "withheld for the screen share". Replacing them would invent data.
   */
  it("leaves the empty states alone", () => {
    const f = redactFigures("member");

    expect(f.currency("—")).toBe("—");
    expect(f.currency("N/A")).toBe("N/A");
    expect(f.count(undefined)).toBeUndefined();
    expect(f.currency(null)).toBeNull();
  });

  /**
   * Not a confidentiality boundary — the figures are still in the payload, this
   * only changes what is painted. Recorded as a test so nobody later mistakes
   * it for a server-side withholding gate.
   */
  it("is a rendering change only — the caller still holds the real value", () => {
    const real = "$1,284,000";
    const f = redactFigures("member");

    expect(f.currency(real)).toBe(REDACTED_CURRENCY);
    expect(real).toBe("$1,284,000");
  });
});
